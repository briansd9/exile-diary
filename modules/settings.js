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
    fs.writeFile(settingsPath, JSON.stringify(settings), (err) => {
      if(err) {
        logger.info("Error writing settings! " + err.message);
        throw err;
      } else {
        if(key !== "mainWindowBounds") {
          logger.info(`Set "${key}" to ${JSON.stringify(value)}`);
        }
      }
    });    
  }  
}

module.exports.get = get;
module.exports.set = set;