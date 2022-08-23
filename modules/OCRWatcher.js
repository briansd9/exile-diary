const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const StringMatcher = require('./StringMatcher');
const logger = require("./Log").getLogger(__filename);
const EventEmitter = require('events');
const { createWorker } = require('tesseract.js');

var DB;
var watcher;
var emitter = new EventEmitter();
var app = require('electron').app || require('@electron/remote').app;
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

  const worker = createWorker({ langPath: process.resourcesPath, gzip: false });

  (async () => {
    try {
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      await worker.setParameters({
        tessedit_char_whitelist: "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:-',%+"
      })
      const { data: { text } } = await worker.recognize(file);

      const filename = path.basename(file);
      const timestamp = filename.substring(0, filename.indexOf("."));
      const lines = [];
      text.split('\n').forEach(line => {
        lines.push(line.trim());
      });

      if (file.indexOf("area") > -1) {
        
        const area = getAreaInfo(lines);
        const areaName = await getAreaNameFromDB(timestamp);
        if(areaName) {
          logger.info(`Got last entered area from db: ${areaName}`);
          area.name = areaName;
        } else {
          logger.info(`Got last entered area from ocr: ${area.name}`);
        }
        
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
    

    } catch (e) {
      logger.error('Error in fetching OCR text')
      logger.error(e);
    }

    fs.unlinkSync(file);
    worker.terminate();
    logger.info("Completed OCR on " + file + ", deleting");
  })();
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
    }
    var levelMatch = line.match(/Level: ([1-9][0-9])?/);
    if (levelMatch) {
      areaInfo.level = levelMatch.pop();
      continue;
    }
    depthMatch = line.match(/Depth: ([1-9][0-9]+)?/);
    if (depthMatch) {
      areaInfo.depth = depthMatch.pop();
      continue;
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

function getAreaNameFromDB(timestamp) {
  return new Promise((resolve, reject) => {
    DB.get("select event_text as area from events where event_type='entered' and id < ? order by id desc limit 1", [timestamp], (err, row)=> {
      if(err) {
        logger.info(`Error getting previous XP: ${err}`);
        resolve(null);
      } else {
        resolve(row ? row.area : null);
      }
    });
  });
}

module.exports.start = start;
module.exports.test = test;
module.exports.emitter = emitter;