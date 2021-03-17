const logger = require("./Log").getLogger(__filename);
const path = require('path');

function get() {
  var app = require('electron').app || require('electron').remote.app;
  var settings = null;
  try {
    settings = require(path.join(app.getPath("userData"), "settings.json"));
  } catch (err) {
    logger.info(err);
    logger.info("Unable to load settings.json");
    // do nothing if file doesn't exist
  }
  return settings;
}

function set(key, value) {
  var app = require('electron').app || require('electron').remote.app;
  var fs = require('fs');
  var settingsPath = path.join(app.getPath("userData"), "settings.json");
  if(fs.existsSync(settingsPath)) {
    var settings = require(settingsPath);
    settings[key] = value;
    var tempFilePath = path.join(app.getPath("userData"), "settings.json.bak");
    fs.writeFile(tempFilePath, JSON.stringify(settings), (err) => {
      if(err) {
        logger.info("Error writing temp settings file: " + err.message);
      } else {
        logger.info(`Renaming ${settingsPath}`);
        fs.rename(tempFilePath, settingsPath, (err2) => {
          if(err2) {
            logger.info("Error copying temp settings file: " + err2.message);
          } else {
            if(key !== "mainWindowBounds") {
              logger.info(`Set "${key}" to ${JSON.stringify(value)}`);
            }
          }
        });
      }
    });    
  }  
}

module.exports.get = get;
module.exports.set = set;