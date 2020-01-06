const Tail = require('nodejs-tail');
const logger = require("./Log").getLogger(__filename);
const InventoryGetter = require('./InventoryGetter');
const ItemParser = require('./ItemParser');
const RunParser = require('./RunParser');
const Utils  = require('./Utils');
const Constants = require('./Constants');

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
      if(line.toLowerCase().endsWith(`] @to ${settings.activeProfile.characterName.toLowerCase()}: end`)) {
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
        logger.info(`Error inserting event ${timestamp} -> ${event.type} ${event.text} ${event.instanceServer || ""}  : ${err}`);
      } else {
        if(event.type !== "chat" && event.type !== "note") {
          logger.info(`Inserted event ${timestamp} -> ${event.type} ${event.text} ${event.instanceServer || ""}`);
        }
      }
    }
  );
}

function getEvent(arg) {
  
  var str = arg.substring(arg.indexOf("] ") + 2);

  var masterString = hasMaster(str);
  var conquerorString = hasConqueror(str);
  if(masterString) {
    return {
      type: "master",
      text: masterString.trim(),
      instanceServer: ""
    };
  } else if(conquerorString) {
    return {
      type: "conqueror",
      text: conquerorString.trim(),
      instanceServer: ""
    };
  } else if(str.startsWith(":")) {
    if (str.includes("You have entered")) {
      var area = str.substring(str.indexOf("You have entered") + 17);
      return {
        type: "entered",
        text: area.substring(0, area.length - 1),
        instanceServer: lastInstanceServer
      };
    } else if(str.includes(`${settings.activeProfile.characterName} has been slain`)) {
      return {
        type: "slain",
        text: "",
        instanceServer: ""
      };
    } else if(str.includes("is now level")) {
      return {
        type: "level",
        text: Number.parseInt(str.substring(str.indexOf("is now level") + 12)),
        instanceServer: ""
      };
    } else if(str.includes("Mission Complete")) {
      return {
        type: "favourGained",
        text: str.replace(/[^0-9]/g, ''),
        instanceServer: ""
      };
    }
  } else if(str.startsWith("@") && (str.includes("@From") || str.includes("@To"))) {
    var fromString = `@from ${settings.activeProfile.characterName.toLowerCase()}:`;
    if(str.toLowerCase().indexOf(fromString) > -1) {
      var msg = str.substring(str.toLowerCase().indexOf(fromString) + fromString.length).trim();
      if(msg === "end") {
        return;
      } else {
        return {
          type: "note",
          text: msg
        };
      }
    }
    if(str.toLowerCase().includes(`@to ${settings.activeProfile.characterName.toLowerCase()}`)) {
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
  
  for(var i = 0; i < Constants.masters.length; i++) {
    var master = Constants.masters[i];
    if(str.startsWith(master)) {
      if(str.startsWith("Zana") && !str.includes("Still sane, exile?")) {
        continue;
      } else {
        return str;      
      }
    }
  }
  
  // 3.8.0: Jun sometimes does not talk at all during missions; scan for Syndicate member lines instead
  for(var i = 0; i < Constants.syndicateMembers.length; i++) {
    var synd = Constants.syndicateMembers[i];
    if(str.startsWith(synd)) {
      return `Jun, Veiled Master: [${str}]`;
    }
  }
  
  return false;
  
}

function hasConqueror(str) {
  for(var i = 0; i < Constants.conquerors.length; i++) {
    var conq = Constants.conquerors[i];
    if(str.startsWith(conq)) {
      return str;      
    }
  }
  return false;
}

async function getOldConquerorEvents() {
  
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
    var timestamp = line.substring(0, 19).replace(/[^0-9]/g, '');
    var conqString  = hasConqueror(str);
    if(conqString) {
      DB.run(
        "insert into events(id, event_type, event_text, server) values(?, ?, ?, ?)",
        [timestamp, "conqueror", conqString.trim(), ""],
        (err) => {
          if (err) {
            logger.info("Failed to insert event: " + err.message);
          } else {
            logger.info(`Inserted conqueror event ${timestamp} -> ${conqString}`);
          }
        }
      );        
    }
  });
    
  
}

module.exports.start = start;
module.exports.getOldConquerorEvents = getOldConquerorEvents;
