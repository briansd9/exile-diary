const Jimp = require('jimp');
const path = require('path');
const convert = require('color-convert');
const moment = require('moment');
const chokidar = require('chokidar');
const logger = require("./Log").getLogger(__filename);
const EventEmitter = require('events');

var settings;
var watcher;
var app = require('electron').app || require('electron').remote.app;
var emitter = new EventEmitter();

function start() {

  settings = require('./settings').get();
  
  if(watcher) {
    try {
      watcher.close();
      watcher.unwatch(settings.screenshotDir);
    } 
    catch(err) {}
  }  

  if (settings.screenshotDir) {
    logger.info("Watching " + settings.screenshotDir);
    watcher = chokidar.watch(
      `${settings.screenshotDir}`,
      {usePolling: true, awaitWriteFinish: true, ignoreInitial: true, disableGlobbing: true}
    );
    watcher.on("add", (path) => {
      logger.info("Cropping new screenshot: " + path);
      process(path);
    });
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

        // chop off top 24px of area info - blank
        image.crop(xBounds, 24, image.bitmap.width - xBounds, yBounds[0] - 24);
        // then take only rightmost 260px of area info (no area name is longer than this)
        if (image.bitmap.width > 260) {
          image.crop(image.bitmap.width - 260, 0, 260, image.bitmap.height);
        }
        image.color([
          {apply: 'red', params: [99]},
          {apply: 'blue', params: [-99]},
          {apply: 'green', params: [-99]},
          {apply: 'saturate', params: [100]},
        ]);
        enhanceImage(image, scaleFactor);
        image.write(path.join(app.getPath("temp"), filename + "." + path.basename(file, ".png") + ".area.png"));

        image2.crop(xBounds, yBounds[0], image2.bitmap.width - xBounds, yBounds[1] - yBounds[0]);
        image2.color([
          {apply: 'red', params: [-50]},
          {apply: 'green', params: [-50]},
        ]);
        enhanceImage(image2, scaleFactor);
        image2.write(path.join(app.getPath("temp"), filename + "." + path.basename(file, ".png") + ".mods.png"));
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

function getXBounds(image, yBounds) {

  var numCols = 40;
  var blueArray = [];

  for (var x = image.bitmap.width - 1; x > 0; x--) {
    var pixCount = 0;
    for (var y = yBounds[0]; y < yBounds[1]; y++) {
      var pixel = image.getPixelColor(x, y);
      if (isBlue(pixel)) {
        pixCount++;
      }
    }
    blueArray.push(pixCount);
    if (blueArray.length === numCols) {
      var blueAvg = blueArray.reduce((acc, curr) => {
        return acc + curr;
      }) / numCols;
      if (blueAvg < 3) {
        return x;
      }
      blueArray.shift();
    }

  }

  return 0;

}

/* 
 * Detects the bottom edge of the list of map mods.
 * 
 * The map mod list is a solid block of pixels that are either black or blue,
 * in the upper-right corner of the screen 
 */
function getYBounds(image) {

  var numRows = 20;
  var numCols = 200;
  var pixArray = [];
  var blueArray = [];
  var blueStarted = false;
  var lowerBound = 0;

  // start from top of image
  for (var y = 0; y < image.bitmap.height; y++) {
    var bluePixels = 0;
    var blackPixels = 0;
    // scan a row of pixels from left to right starting {numCols} px from the right edge,
    // counting the number of blue or black pixels in the row
    for (var x = image.bitmap.width - numCols; x < image.bitmap.width; x++) {
      var pixel = image.getPixelColor(x, y);
      if (isBlue(pixel)) {
        bluePixels++;
      } else if (isBlack(pixel, 20)) {
        blackPixels++;
      }
    }

    // number of blue or black pixels in row          
    pixArray.push(bluePixels + blackPixels);
    // number of blue pixels only
    blueArray.push(bluePixels);

    // when {numRows} rows have been scanned, get running average
    if (pixArray.length === numRows) {
      // average number of blue/black pixels
      var totalAvg = pixArray.reduce((acc, curr) => {
        return acc + curr;
      }) / numRows;
      // average number of blue pixels
      var blueAvg = blueArray.reduce((acc, curr) => {
        return acc + curr;
      }) / numRows;

      if (totalAvg > (numRows * 0.95)) {
        if (blueAvg > 25 && !blueStarted) {
          // if the top of the mod list has not already been found, 
          // mark it if average blue/black pixels is > 95% and average blue pixels > 25
          blueStarted = true;
          lowerBound = y - numRows;
        } else if (blueStarted && (blueAvg < 25 || (bluePixels + blackPixels < (numRows * 0.7)))) {
          // if top of mod list has already been found, check if we've gone past the bottom:
          // average blue pixels in past {numRows} rows < 25, or current row has less than 70% blue/black pixels
          // if so, return bounds of mod list
          return [lowerBound, y];
        }
      } else if (blueStarted) {
        // also return bounds of mod list if top has already been found 
        // and average blue/black pixels in past {numRows} rows < 95%
        return [lowerBound, y];
      }

      // only keep pixel count for last {numRows} rows
      pixArray.shift();
      blueArray.shift();

    }

  }
}

function isBlue(pixel) {
  var rgba = Jimp.intToRGBA(pixel);
  var hsv = convert.rgb.hsl([rgba.r, rgba.g, rgba.b]);
  // blue pixels: hue 240 and saturation + value > 40
  return (hsv[0] < 242 && hsv[0] > 238 && hsv[1] + hsv[2] > 40);
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

module.exports.start = start;
module.exports.emitter = emitter;
