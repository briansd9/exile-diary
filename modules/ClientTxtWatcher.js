const Tail = require('nodejs-tail');
const logger = require("./Log").getLogger(__filename);
const EventEmitter = require('events');
const InventoryGetter = require('./InventoryGetter');
const ItemParser = require('./ItemParser');
const RunParser = require('./RunParser');
const Utils  = require('./Utils');
const Constants = require('./Constants');

var DB;
var settings;
var tail;
var inv;
var login;
var emitter = new EventEmitter();

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
      if (process.platform === 'linux') {
        // Remove carriage return
        // NOTE: PoE run on wine, the client.txt file has Windows carriage return
        //       This cause an error when trying to execute the regexp on the line
        line = JSON.stringify(line).replace(/(\\r\\n|\\n|\\r)/, '');
        line = JSON.parse(line);
      }
      if( 
        line.toLowerCase().endsWith(`] @to ${settings.activeProfile.characterName.toLowerCase()}: end`) 
        || line.toLowerCase().endsWith(`] ${settings.activeProfile.characterName.toLowerCase()}: end`) 
      ) {
        logger.info("Detected map end signal, processing last map run");
        RunParser.process();
      } else if(line.includes("Connecting to instance server at")) {
        lastInstanceServer = (instanceServerRegex.exec(line))[0];
        logger.info("Instance server found: " + lastInstanceServer);
      } else if (settings.autoSwitch && line.includes("Async connecting to") && line.includes("login.pathofexile.com")) {
        logger.info("Login found, monitoring possible character change");
        login = true;
      } else if(settings.autoSwitch && login && line.includes("entered")) {
        logger.info("Connecting to instance server after login, checking last active character");
        checkLastActiveCharacter();
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

async function checkLastActiveCharacter() {
  
  if(!login) {
    return;
  } else {
    login = false;
  }
  
  var settings = require('./settings').get();  
  var path = `/character-window/get-characters?accountName=${encodeURIComponent(settings.accountName)}`;
  var requestParams = Utils.getRequestParams(path, settings.poesessid);
  
  return new Promise((resolve, reject) => {
    var request = require('https').request(requestParams, (response) => {
      var body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          var data = JSON.parse(body);
          data.forEach(char => {
            if(char.lastActive) {
              if(char.name !== settings.activeProfile.characterName || char.league !== settings.activeProfile.league) {
                logger.info(`Changed active character ${settings.activeProfile.characterName} in ${settings.activeProfile.league} => ${char.name} in ${char.league} `);
                emitter.emit("switchedCharacter", char);
              }
              resolve(null);
            }
          });
        } catch(err) {
          logger.info(`Failed to check last active character: ${err}`);
          resolve(null);
        }
      });
      response.on('error', (err) => {
        logger.info(`Failed to check last active character: ${err}`);
        resolve(null);
      });
    });
    request.on('error', (err) => {
      logger.info(`Failed to check last active character: ${err}`);
      resolve(null);
    });
    request.end();
  });
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
  if(masterString) {
    return {
      type: "master",
      text: masterString.trim(),
      instanceServer: ""
    };
  }
  
  var conquerorString = hasConqueror(str);
  if(conquerorString) {
    return {
      type: "conqueror",
      text: conquerorString.trim(),
      instanceServer: ""
    };
  }
  
  var npcString = hasNPC(str);
  if(npcString) {
    return {
      type: "leagueNPC",
      text: npcString.trim(),
      instanceServer: ""
    };
  }
  
  if(str.startsWith(":")) {
    if (str.includes("You have entered")) {
      var area = str.substring(str.indexOf("You have entered") + 17);
      return {
        type: "entered",
        text: area.substring(0, area.length - 1),
        instanceServer: lastInstanceServer
      };
    } else if(str.includes(`${settings.activeProfile.characterName} has been slain`) || str.includes(`${settings.activeProfile.characterName} has committed suicide`)) {
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
    } else {
      let text = (str.substring(2)).trim();
      if(Constants.shrineQuotes[text] || Constants.darkshrineQuotes.includes(text)) {
        return {
          type: "shrine",
          text: text,
          instanceServer: ""
        };
      }      
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
  let npc = str.substr(0, str.indexOf(":")).trim();
  if(Constants.masters.includes(npc)) {
    return str;
  }
  // 3.8.0: Jun sometimes does not talk at all during missions; scan for Syndicate member lines instead
  if(Constants.syndicateMembers.includes(npc)) {
    return `Jun, Veiled Master: [${str}]`;
  }
  return null;
}

function hasConqueror(str) {
  let npc = str.substr(0, str.indexOf(":")).trim();
  return (Constants.conquerors.includes(npc) ? str : null);
}

function hasNPC(str) {
  let npc = str.substr(0, str.indexOf(":")).trim();
  return (Constants.leagueNPCs.includes(npc) ? str : null);
}


async function getOldNPCEvents() {
  
  DB = require('./DB').getDB();
  settings = require('./settings').get();

  var fs = require('fs');
  var readline = require('readline');
  
  var bounds = await new Promise((resolve, reject) => {
    DB.get("select min(id) as minId, max(id) as maxId from events", (err, row) => { resolve(row); })
  });
  
  logger.info(`Adding events in ${JSON.stringify(bounds)}`);

  var rl = readline.createInterface({
      input: fs.createReadStream(settings.clientTxt),
      terminal: false
  });
    
  rl.on('line', function(line) {
    
    var timestamp = line.substring(0, 19).replace(/[^0-9]/g, '');
    if(timestamp < bounds.minId || timestamp > bounds.maxId) return;
    
    var str = line.substring(line.indexOf("] ") + 2);
    var npcString = hasNPC(str);
    if(npcString) {
      DB.run(
        "insert into events(id, event_type, event_text, server) values(?, ?, ?, ?)",
        [timestamp, "leagueNPC", npcString.trim(), ""],
        (err) => {
          if (err) {
              if(!err.message.includes("UNIQUE constraint failed")) {
                logger.info("Failed to insert event: " + err.message);
              }
          } else {
            logger.info(`Inserted league NPC event ${timestamp} -> ${npcString}`);
          }
        }
      );
      return;
    }
    
    if(hasConqueror(str)) {
      DB.run(
        "insert into events(id, event_type, event_text, server) values(?, ?, ?, ?)",
        [timestamp, "conqueror", str.trim(), ""],
        (err) => {
          if (err) {
              if(!err.message.includes("UNIQUE constraint failed")) {
                logger.info("Failed to insert event: " + err.message);
              }
          } else {
            logger.info(`Inserted conqueror event ${timestamp} -> ${str}`);
          }
        }
      );
      return;
    }
    
    if(str.startsWith(":")) {      
      str = str.substring(2).trim();
      if(Constants.shrineQuotes[str] || Constants.darkshrineQuotes.includes(str)) {
        DB.run(
          "insert into events(id, event_type, event_text, server) values(?, ?, ?, ?)",
          [timestamp, "shrine", str, ""],
          (err) => {
            if (err) {
              if(!err.message.includes("UNIQUE constraint failed")) {
                logger.info("Failed to insert event: " + err.message);
              }
            } else {
              logger.info(`Inserted master event ${timestamp} -> ${str}`);
            }
          }
        );
      }
    }
  });
  
}

module.exports.start = start;
module.exports.getOldNPCEvents = getOldNPCEvents;
module.exports.emitter = emitter;