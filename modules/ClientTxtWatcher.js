const Tail = require('nodejs-tail');
const logger = require("./Log").getLogger(__filename);
const InventoryGetter = require('./InventoryGetter');
const ItemParser = require('./ItemParser');
const RunParser = require('./RunParser');
const Utils  = require('./Utils');

var DB;
var settings;
var tail;
var inv;

var lastInstanceServer = null;
const instanceServerRegex = /[0-9:\.]+$/;

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
      if(line.toLowerCase().endsWith(`] @from ${settings.activeProfile.characterName.toLowerCase()}: end`)) {
        logger.info("Detected map end signal, processing last map run");
        RunParser.process();
      } else if(line.includes("Connecting to instance server at")) {
        lastInstanceServer = (instanceServerRegex.exec(line))[0];
        logger.info("Instance server found: " + lastInstanceServer);
      } else {
        var timestamp = line.substring(0, 19).replace(/[^0-9]/g, '');
        var event = getEvent(line);
        if (event) {
          insertEvent(event, timestamp);
          if (event.type === "entered") {
            if(!Utils.isTown(event.text)) {
              logger.info(`Entered map area ${event.text}, will try processing previous area`);
              RunParser.tryProcess({
                event: { timestamp: timestamp, area: event.text, server: event.instanceServer },
                mode: "automatic"
              });
            }
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
    "insert into events(id, event_type, event_text, server) values(?, ?, ?, ?)",
    [timestamp, event.type, event.text, event.instanceServer],
    (err) => {
      if (err) {
        logger.info("Failed to insert event: " + err);
      } else {
        if(event.type !== "chat") {
          logger.info(`Inserted event ${timestamp} -> ${event.type} ${event.text} ${event.instanceServer}`);
        }
      }
    }
  );
}

function getEvent(arg) {
  var str = arg.substring(arg.indexOf("] ") + 2);
  if(hasMaster(str)) {
    return {
      type: "master",
      text: str.trim(),
      instanceServer: ""
    };
  }
  else if(str.startsWith(":")) {
    if (str.indexOf("You have entered") > -1) {
      str = str.trim();
      var area = str.substring(str.indexOf("You have entered") + 17);
      if (area.indexOf("Maelstr") > -1) {
        area = "Maelstrom of Chaos ";
      }
      return {
        type: "entered",
        text: area.substring(0, area.length - 1),
        instanceServer: lastInstanceServer
      };
    } else if (str.indexOf("has been slain") > -1) {
      return {
        type: "slain",
        text: "",
        instanceServer: ""
      };
    } else if (str.indexOf("is now level") > -1) {
      return {
        type: "level",
        text: Number.parseInt(str.substring(str.indexOf("is now level") + 12)),
        instanceServer: ""
      };
    }
  } else if(str.startsWith("@") && str.indexOf("@From") > -1 || str.indexOf("@To") > -1) {
    if(str.indexOf(`@From ${settings.activeProfile.characterName}`) > 0) {
      return;
    }
    if(str.indexOf(`@To ${settings.activeProfile.characterName}`) > 0) {
      return;
    }
    return {
      type: "chat",
      text: str.substring(str.indexOf("@")).trim(),
      instanceServer: ""
    };
  }
}

function hasMaster(str) {
  
  if(str.startsWith("Einhar") || str.startsWith("Niko") || str.startsWith("Alva") || str.startsWith("Jun")) return true;
  
  // filter out shaper/elder fight dialogue
  if(str.startsWith("Zana") && str.includes("Still sane, exile?")) return true;
  
  return false;
  
}

async function getOldMasterEvents() {
  
  DB = require('./DB').getDB();
  settings = require('./settings').get();

  var fs = require('fs');
  var readline = require('readline');
  
  var minTimestamp = await new Promise((resolve, reject) => {
    DB.get("select min(id) as id from events", (err, row) => { resolve(row.id); })
  });
  
  console.log(`Min timestamp is ${minTimestamp}`);

  var rl = readline.createInterface({
      input: fs.createReadStream(settings.clientTxt),
      terminal: false
  });
    
  rl.on('line', function(line) {
    var str = line.substring(line.indexOf("] ") + 2);
    if(hasMaster(str)) {
      var timestamp = line.substring(0, 19).replace(/[^0-9]/g, '');
      if(timestamp > minTimestamp) {
        var text = str.trim();
        DB.run(
          "insert into events(id, event_type, event_text, server) values(?, ?, ?, ?)",
          [timestamp, "master", text, ""],
          (err) => {
            if (err) {
              logger.info("Failed to insert event: " + err);
            } else {
              logger.info(`Inserted event ${timestamp} -> ${text}`);
            }
          }
        );        
      }
    }
  });
  
}

module.exports.start = start;
module.exports.getOldMasterEvents = getOldMasterEvents;