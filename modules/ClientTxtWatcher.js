const Tail = require('nodejs-tail');
const logger = require("./Log").getLogger(__filename);
const InventoryGetter = require('./InventoryGetter');
const ItemParser = require('./ItemParser');
const RunParser = require('./RunParser');

var DB;
var settings;
var tail;
var inv;

function start() {

  DB = require('./DB').getDB();
  settings = require('./settings').get();

  if (tail) {
    try {
      tail.close();
    } catch (err) {
      logger.info(err);
    }
  }

  if (settings.clientTxt) {

    logger.info(`Watching ${settings.clientTxt}`);

    tail = new Tail(`${settings.clientTxt}`, {usePolling: true, disableGlobbing: true});
    inv = new InventoryGetter();

    tail.on("line", (line) => {
      if(line.endsWith(`] @From ${settings.activeProfile.characterName}: end`)) {
        logger.info("Detected map end signal, processing last map run");
        RunParser.process();
      } else {
        var timestamp = line.substring(0, 19).replace(/[^0-9]/g, '');
        var event = getEvent(line);
        if (event) {
          insertEvent(event, timestamp);
          if (event.type === "entered") {
            inv.getInventoryDiffs(timestamp).then(async (diff) => {
              if (diff && Object.keys(diff).length > 0) {
                await ItemParser.insertItems(diff, timestamp);
              }
            });
          }
        }
      }
    });
    tail.watch();
  }

}

function insertEvent(event, timestamp) {
  DB.run(
    "insert into events(id, event_type, event_text) values(?, ?, ?)",
    [timestamp, event.type, event.text],
    (err) => {
    if (err) {
      logger.info("Failed to insert event: " + err);
    } else {
      logger.info(`Inserted event ${timestamp} -> ${event.type} ${event.text}`);
    }
  }
  );
}

function getEvent(str) {
  if (str.indexOf("] :") > -1 || str.indexOf("] @") > -1) {
    if (str.indexOf("You have entered") > -1) {
      str = str.trim();
      var area = str.substring(str.indexOf("You have entered") + 17);
      if (area.indexOf("Maelstr") > -1) {
        area = "Maelstrom of Chaos";
      }
      return {
        type: "entered",
        text: area.substring(0, area.length - 1)
      };
    } else if (str.indexOf("has been slain") > -1) {
      return {
        type: "slain",
        text: ""
      };
    } else if (str.indexOf("is now level") > -1) {
      return {
        type: "level",
        text: Number.parseInt(str.substring(str.indexOf("is now level") + 12))
      };
    } else if (str.indexOf("@From") > -1 || str.indexOf("@To") > -1) {
      if(str.indexOf(`@From ${settings.activeProfile.characterName}`) > 0) {
        return;
      }
      if(str.indexOf(`@To ${settings.activeProfile.characterName}`) > 0) {
        return;
      }
      return {
        type: "chat",
        text: str.substring(str.indexOf("@")).trim()
      };
    }
  }
}


module.exports.start = start;