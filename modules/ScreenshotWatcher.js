const Jimp = require('jimp');
const path = require('path');
const convert = require('color-convert');
const moment = require('moment');
const chokidar = require('chokidar');
const logger = require("./Log").getLogger(__filename);
const EventEmitter = require('events');
const fs = require('fs');

const SCREENSHOT_DIRECTORY_SIZE_LIMIT = 400;

var settings;
var watcher;
var currentWatchDirectory;

var app = require('electron').app || require('@electron/remote').app;
var emitter = new EventEmitter();

function tryClose() {
  if(watcher) {
    try {
      watcher.close();
      watcher.unwatch(currentWatchDirectory);
      watcher = null;
      currentWatchDirectory = null;
    } 
    catch(err) {
      logger.info("Error closing screenshot watcher: " + err.message);
    }
  }  
}

function start() {
  
  tryClose();

  settings = require('./settings').get();

  if (settings.screenshotDir !== "disabled") {
    logger.info("Watching " + settings.screenshotDir);
    watcher = chokidar.watch(
      `${settings.screenshotDir}`,
      {usePolling: true, awaitWriteFinish: true, ignoreInitial: true, disableGlobbing: true}
    );
    watcher.on("add", (path) => {
      logger.info("Cropping new screenshot: " + path);
      process(path);
    });
    currentWatchDirectory = settings.screenshotDir;
  } else {
    logger.info("Screenshot directory is disabled");
  }

}

async function checkScreenshotSpaceUsed() {
    var dir = fs.readdirSync(settings.screenshotDir);
    if(dir.length > SCREENSHOT_DIRECTORY_SIZE_LIMIT) {
      emitter.emit("tooMuchScreenshotClutter", dir.length); 
    }
}


function process(file) {
  var filename = moment().format("YMMDDHHmmss");
  if (file.length > 0) {
    Jimp.read(file).then(image => {
      
      try {
        // 1920 x 1080 image scaled up 3x;
        // scale differently sized images proportionately
        var scaleFactor = 3 * (1920 / image.bitmap.width);
        
        var yBounds = getYBounds(image);
        var xBounds = getXBounds(image, yBounds);

        var image2 = image.clone();

        // take only rightmost 14% of screen for area info (no area name is longer than this)
        var areaInfoWidth = Math.floor(image.bitmap.width * 0.14);
        // chop off top 24px of area info - blank
        image.crop(xBounds, 24, image.bitmap.width - xBounds, yBounds[0] - 24);
        if (image.bitmap.width > areaInfoWidth) {
          image.crop(image.bitmap.width - areaInfoWidth, 0, areaInfoWidth, image.bitmap.height);
        }
        image.color([
          {apply: 'red', params: [99]},
          {apply: 'blue', params: [-99]},
          {apply: 'green', params: [-99]},
          {apply: 'saturate', params: [100]},
        ]);
        enhanceImage(image, scaleFactor);
        image.write(path.join(app.getPath('userData'), '.temp_capture', filename + "." + path.basename(file, ".png") + ".area.png"));

        image2.crop(xBounds, yBounds[0], image2.bitmap.width - xBounds, yBounds[1] - yBounds[0]);
        image2.color([
          {apply: 'red', params: [-50]},
          {apply: 'green', params: [-50]},
        ]);
        enhanceImage(image2, scaleFactor);
        image2.write(path.join(app.getPath('userData'), '.temp_capture', filename + "." + path.basename(file, ".png") + ".mods.png"));
        logger.info("Deleting screenshot " + file);
        fs.unlinkSync(file);
        checkScreenshotSpaceUsed();
        
      } catch(e) {
        logFailedCapture(e);
      }

    });
  }

}

function enhanceImage(image, scaleFactor) {
  image.scale(scaleFactor, Jimp.RESIZE_BEZIER);
  image.invert();
  image.greyscale();
  /*
   image.convolute([
   [0, 0, 0, 0, 0],
   [0, 0, -1, 0, 0],
   [0, -1, 5, -1, 0],
   [0, 0, -1, 0, 0],
   [0, 0, 0, 0, 0]
   ]);
   */
  image.convolute([
    [-1 / 8, -1 / 8, -1 / 8],
    [-1 / 8, 2, -1 / 8],
    [-1 / 8, -1 / 8, -1 / 8]
  ]);
  image.brightness(-0.43);
  image.contrast(0.75);
}

/**
 * Detects the left border of the mods box
 * 
 * We create an array of {marginWidth} width. On every column, we check the number of blue pixels.
 * Then, we check the average of blue pixels on each column in our array.
 * If above 1, we shift and test the next column, once we get below 1, that means we got {marginWidth} columns with a low blue pixels count.
 * @param {*} image The image to iterate over
 * @param {Array} yBounds The y bounds of our mods box
 * @returns an X Boundary
 */
function getXBounds(image, yBounds) {
  const marginWidth = 10;
  const blueArray = [];
  const imageWidth = image.bitmap.width - 1;
  let xBoundary = 0;

  // On each column
  for(let x = imageWidth; x > 0; x--) {
    let pixelCount = 0;

    // Check pixel on every line of our restricted area
    for (let y = yBounds[0]; y < yBounds[1]; y++) {
      if (isBlue(image.getPixelColor(x, y))) {
        pixelCount++;
      }
    }

    blueArray.push(pixelCount);

    // If we have enough lines in the moving array
    if(xBoundary === 0 && blueArray.length === marginWidth) {
      const blueAvg = blueArray.reduce((acc, curr) => acc + curr) / marginWidth;
      // If first line with no blue, boundary is here
      if(blueAvg < 1) { 
        xBoundary = x;
        break;
      }
      blueArray.shift();
    }
  }

  return xBoundary;
}

/* 
 * Detects the bottom edge of the list of map mods.
 * 
 * The map mod list is a solid block of pixels that are either black or blue,
 * in the upper-right corner of the screen 
 * 
 * So we check each row of {detectionWidth} pixels from the top, in batches of {batchSize}.
 * When we find a fully black row right before a row that contains black + blue, we mark it as the first line.
 * We then check until we find either:
 *  - A non black background line right after {endDetectionHeight} lines of black -> End of the black box
 *  - A line with no blues after {endDetectionHeight} lines with no blues -> End of the mods, even on a black background
 * 
 * If we did not find the end of the box, we just return the total height as the bottom boundary.
 */
function getYBounds(image) {
  const batchSize = Math.floor(image.bitmap.height / 10); // Size of the batch of rows to check together
  const firstLineMargin = 5; // Margin to make the top line a bit more readable
  const endDetectionHeight = 20; // Height of the bottom limit we detect (Answer to "After how many pixels do we consider this box to be done?")
  const detectionWidth = 30; // Number of pixels to check for detection. We do not need the full line but we need enough pixels to start capturing blue pixels

  let isDone = false;
  let offset = 0;
  let firstLine = -1;
  let lastLine = -1;

  while(!isDone && offset < image.bitmap.height) {  
    const lines = [];

    // On each Line in a batch
    for (let y = offset; y < batchSize + offset ; y++) {  
      let bluePixels = 0;
      let blackPixels = 0;

      // Check each pixel on each line for blueness or blackness
      for (let x = image.bitmap.width - detectionWidth; x < image.bitmap.width; x++) {
        const pixelColor = image.getPixelColor(x, y);
        if (isBlue(pixelColor)) {
        bluePixels++;
        } else if (isBlack(pixelColor, 15)) {
        blackPixels++;
      }
    }

      lines.push({
        blue: bluePixels,
        black: blackPixels,
        total: bluePixels + blackPixels
      });

      // If we do not have a first line, and we are getting a first line with blues, this is the one
      if(firstLine < 0 && bluePixels > 0 && lines[lines.length - 2].blue === 0) {
        logger.info(`Found first line of the mod box with ${bluePixels} blues at y=${y}`);
        firstLine = y - firstLineMargin;
      }

      const lastLines = lines.slice(lines.length - endDetectionHeight, lines.length -2);
      const isEndOfBlackBackground = ( lastLines.length === (endDetectionHeight - 2) && blackPixels < detectionWidth && bluePixels < 1 && Math.min(...lastLines.map(line => line.black)) === detectionWidth);
      const isTooFarAfterBlueText = ( lastLines.length === (endDetectionHeight - 2) && bluePixels < 1 && Math.max(...lastLines.map(line => line.blue)) === 0 );
      
      if( firstLine > -1 && lastLine < 0 && ( isEndOfBlackBackground || isTooFarAfterBlueText ) ) {
        logger.info(`Found last line of the mod box on y=${y}`);
        lastLine = y;
        isDone = true;
        break;
        }
      }

    if(!isDone){
      offset += batchSize;
    }
    }

  if(lastLine === -1) lastLine = image.bitmap.height;
  return [firstLine, lastLine];
}

function isBlue(pixel) {
  var rgba = Jimp.intToRGBA(pixel);
  var hsv = convert.rgb.hsl([rgba.r, rgba.g, rgba.b]);
  // map mod blue:
  // hue 240
  // saturation + value > 40
  // red and green components equal and both > 70
  
  return (
    hsv[0] <= 250 
    && hsv[0] >= 235 
    && hsv[1] + hsv[2] > 40
    && Math.abs(rgba.r - rgba.g) <= 10
    && rgba.r > 70
  );
}

function isBlack(pixel, tolerance) {
  var rgba = Jimp.intToRGBA(pixel);
  var hsv = convert.rgb.hsl([rgba.r, rgba.g, rgba.b]);
  return (hsv[2] <= tolerance);
}

function logFailedCapture(e) {
  logger.info(`Error processing screenshot: ${e}`);
  emitter.emit("OCRError");
}

function test(file) {
  process(file);  
}

module.exports.start = start;
module.exports.emitter = emitter;
module.exports.test = test;