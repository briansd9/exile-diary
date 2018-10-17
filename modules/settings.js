const logger = require("./Log").getLogger(__filename);
const path = require('path');

function get() {
  
  var app = require('electron').app || require('electron').remote.app;

  var settings = {};
  
  try {
    settings = require(path.join(app.getPath("userData"), "settings.json"));
  } catch (err) {
    logger.info("Unable to load settings.json");
    // do nothing if file doesn't exist
  }
  return settings;
}

module.exports.get = get;