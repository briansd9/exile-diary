const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const StringMatcher = require('./StringMatcher');
const logger = require("./Log").getLogger(__filename);
const EventEmitter = require('events');

var DB;
var watcher;
var emitter = new EventEmitter();
var app = require('electron').app || require('electron').remote.app;
var areaInfo;
var mapMods;

const watchPaths = [
  path.join(app.getPath('userData'), '.temp_capture', "*.area.png"),
  path.join(app.getPath('userData'), '.temp_capture', "*.mods.png")
];

function test(filename) {
  DB = null;
  processImage(filename);
}

function start() {
  
  areaInfo = null;
  mapMods = null;
  DB = require('./DB').getDB();
  
  if (watcher) {
    try {
      watcher.close();
      watcher.unwatch(watchPaths);
    } catch (err) {
    }
  }

  watcher = chokidar.watch(watchPaths, {usePolling: true, awaitWriteFinish: true, ignoreInitial: true});
  watcher.on("add", (path) => {
    processImage(path);
  });

}

function processImage(file) {
  
  logger.info("Performing OCR on " + file + "...");  

  var TesseractWorker = require('tesseract.js').create({ langPath: process.resourcesPath });
  
  TesseractWorker.recognize(file, {
    lang: "eng",
    tessedit_char_whitelist: "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:-',%+"
  }).then((result) => {
      
      var filename = path.basename(file);
      var timestamp = filename.substring(0, filename.indexOf("."));
      var lines = [];
      result.lines.forEach(line => {
        lines.push(line.text.trim());
      });

      if (file.indexOf("area") > -1) {
        
        var area = getAreaInfo(lines);
        DB.run(
          "insert into areainfo(id, name, level, depth) values(?, ?, ?, ?)",
          [timestamp, area.name, area.level, area.depth],
          (err) => {
            if(err) {
              cleanFailedOCR(err, timestamp);
            } else {
              areaInfo = area;
              checkAreaInfoComplete();
            }
          }
        );

      } else if (file.indexOf("mods") > -1) {
        
        try {
          var mods = getModInfo(lines);
          var mapModErr = null;
          for (var i = 0; i < mods.length; i++) {
            DB.run(
              "insert into mapmods(area_id, id, mod) values(?, ?, ?)",
              [timestamp, i, mods[i]],
              (err) => {
                if(err && !mapModErr) {
                  mapModErr = err;
                }
              }
            );
          }
          if(mapModErr) {
            cleanFailedOCR(mapModErr, timestamp);
          } else {
            mapMods = mods;
            checkAreaInfoComplete();
          }
        }
        catch(e) {
          cleanFailedOCR(e, timestamp);
        }
        
      }
      
    }).catch(err => {
      cleanFailedOCR(err);
    }).finally(() => {
      fs.unlinkSync(file);
      TesseractWorker.terminate();
      logger.info("Completed OCR on " + file, " deleting");
    });
}

function checkAreaInfoComplete() {
  if(areaInfo && mapMods) {
    emitter.emit("areaInfoComplete", {areaInfo: areaInfo, mapMods: mapMods});
    areaInfo = null;
    mapMods = null;
  }
}

function cleanFailedOCR(e, timestamp) {
  areaInfo = null;
  mapMods = null;
  logger.info("Error processing screenshot: " + e);
  emitter.emit("OCRError");
  if(timestamp) {
    DB.serialize(() => {
      DB.run("delete from areainfo where id = ?", [timestamp], (err) => {
        if(err) {
          logger.info(`Error cleaning areainfo for failed OCR: ${err}`);
        }        
      });
      DB.run("delete from mapmods where area_id = ?", [timestamp], (err) => {
        if(err) {
          logger.info(`Error cleaning mapmods for failed OCR: ${err}`);
        }        
      });
    });
  }
}

function getAreaInfo(lines) {

  var areaInfo = {};

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!areaInfo.name) {
      var str = StringMatcher.getMap(line);
      if (str.length > 0) {
        areaInfo.name = str;
        continue;
      }
    } else {
      // after area name is found, extract monster level
      var levelMatch = line.match(/Level: ([1-9][0-9])?/);
      if (levelMatch) {
        areaInfo.level = levelMatch.pop();
        continue;
      }
      depthMatch = line.match(/Depth: ([1-9][0-9]+)?/);
      if (depthMatch) {
        areaInfo.depth = depthMatch.pop();
        break;
      }
    }
  }

  if (!areaInfo.depth) {
    areaInfo.depth = null;
  }
  return areaInfo;

}

function getModInfo(lines) {

  var mods = [];
  for (var i = 0; i < lines.length; i++) {
    var mod = StringMatcher.getMod(lines[i]);
    if (mod.length > 0) {
      mods.push(mod);
    }
  }
  return mods;
  
}

module.exports.start = start;
module.exports.test = test;
module.exports.emitter = emitter;