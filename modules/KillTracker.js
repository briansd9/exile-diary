const EventEmitter = require('events');
const logger = require("./Log").getLogger(__filename);
const moment = require('moment');

var emitter = new EventEmitter();

const incubatorGearSlots = [
  "Helm",
  "BodyArmour",
  "Gloves",
  "Boots",
  "Ring",
  "Ring2",
  "Amulet",
  "Boots",
  "Weapon",
  "Offhand",
  "Trinket"
  // weapon2 and offhand2 not included - alternate weapon set does not accumulate monster kills
  // seems inconsistent with gem leveling??
];

async function logKillCount(timestamp, eqp) {

  var incubators = {};
  Object.keys(eqp).forEach((key) => {
    var item = eqp[key];
    if (item.incubatedItem) {
      incubators[key] = {
        gearSlot: item.inventoryId,
        itemType: item.incubatedItem.name,
        level: item.incubatedItem.level,
        progress: item.incubatedItem.progress,
        total: item.incubatedItem.total
      };
    }
  });

  var settings = require('./settings').get();
  if(settings.activeProfile.enableIncubatorAlert) {
     // emit any missing incubators
     var emptySlotIcons = Object.values(eqp).filter(item=>incubatorGearSlots.indexOf(item.inventoryId) >= 0 && !(item.incubatedItem)).map(item=>[item.inventoryId, item.icon]);
     emitter.emit("incubatorsMissing", emptySlotIcons)
  }


  var DB = require('./DB').getDB();
  var currIncubators = JSON.stringify(incubators);
  var prevIncubators = await getPrevIncubators(DB);
  if (prevIncubators === currIncubators) {
    return;
  } else {
    DB.run("insert into incubators(timestamp, data) values(?, ?)", [timestamp, currIncubators], (err) => {
      if (err) {
        logger.info(`Error inserting incubator data for ${timestamp}): ${err}`);
      } else {
        emitter.emit("incubatorsUpdated", incubators);
      }
    });
  }

}

function getPrevIncubators(DB) {
  return new Promise((resolve, reject) => {
    DB.get("select data from incubators order by timestamp desc limit 1", (err, row) => {
      if (err) {
        logger.info(`Error getting previous incubators: ${err}`);
      }
      if (row) {
        resolve(row.data);
      } else {
        resolve("");
      }
    });
  });
}

module.exports.logKillCount = logKillCount;
module.exports.emitter = emitter;
