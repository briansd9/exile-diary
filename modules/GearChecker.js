const logger = require("./Log").getLogger(__filename);
const Utils = require("./Utils");
const https = require('https');
const zlib = require('zlib');
const { deepEqual } = require('fast-equals');

var DB;
var settings;

const gearSlots = [
  "Helm",
  "Amulet",
  "BodyArmour",
  "Gloves",
  "Ring",
  "Ring2",
  "Belt",
  "Boots"  
//  "Weapon", 
//  "Weapon2",
//  "Offhand",
//  "Offhand2"
];

// special handling for these - can contain more than one item
const multiGearSlots = [
  "Weapons",
  "AmuletSockets",
  "BeltSockets",
  "BodyArmourSockets",
  "BootsSockets",
  "GlovesSockets",
  "HelmSockets",
  "RingSockets",
  "Ring2Sockets",
  "WeaponsSockets",
  "Flask",    
  "TreeJewels" 
];

const equipmentSlots = [
  "Helm",
  "Amulet",
  "BodyArmour",
  "Gloves",
  "Ring",
  "Ring2",
  "Belt",
  "Boots",
  "Weapons",
  "Flask",    
  "TreeJewels"   
];

const flaskIgnoreProperties = [
  "Lasts %0 Seconds",
  "Consumes %0 of %1 Charges on use",
  "Currently has %0 Charge",
  "Currently has %0 Charges"
];

async function check(timestamp, eqp) {
  
  DB = require('./DB').getDB();
  settings = require('./settings').get();
  
  let currGear = {};
  
  let eqpKeys = Object.keys(eqp);
  for(let i = 0; i < eqpKeys.length; i++) {
    
    let item = eqp[eqpKeys[i]];
    if(!item.inventoryId) continue;
    
    let inv = item.inventoryId;
    // put all weapons into one set, to avoid unnecessary change logs for weapon swaps :-\
    if(["Weapon", "Weapon2", "Offhand", "Offhand2"].includes(inv)) {
      inv = "Weapons";
    }
    
    if(item.socketedItems) {
      // bind socketed items to gear slot instead, to avoid unnecessary change logs when changing gear but keeping the same gems
      if(inv !== "Weapons") {
        currGear[inv + "Sockets"] = item.socketedItems;
      } else {
        // put all weapon gem sets into one set :-\
        currGear["WeaponsSockets"] = currGear["WeaponsSockets"] || [];
        currGear["WeaponsSockets"] = [ ...currGear["WeaponsSockets"], ...item.socketedItems ];
      }
    }
    
    // avoid unnecessary change logs when migrating to a different league
    delete item.league;
    // ignore incubators on item
    delete item.incubatedItem;    
    
    if(inv === "Flask" || inv === "Weapons") {
      currGear[inv] = currGear[inv] || [];
      currGear[inv].push(item);
    } else {
      currGear[inv] = item;
    }
    
  }
  
  let jewels = await getEquippedJewels();
  if(jewels) {
    currGear["TreeJewels"] = [];
    for(let i = 0; i < jewels.length; i++) {
      currGear["TreeJewels"].push(jewels[i]);
    }
  } else {
    logger.info("Error getting equipped jewels, will not check diffs for now");
    return;
  }
  
  let prevGear = await getPreviousEquipment(timestamp, currGear);
  if(!prevGear) {
    logger.info("Error getting previous gear, will not check diffs for now");
    return;
  } else if(prevGear === "none") {
    insertEquipment(timestamp, currGear);
  } else {
    compareEquipment(timestamp, prevGear, currGear);
  }
  
}

function getEquippedJewels() {

  let league = encodeURIComponent(settings.activeProfile.league);
  let accountName = encodeURIComponent(settings.accountName);
  let characterName = encodeURIComponent(settings.activeProfile.characterName);
  let queryPath = `/character-window/get-passive-skills?league=${league}&accountName=${accountName}&character=${characterName}`;
  let requestParams = require('./Utils').getRequestParams(queryPath, settings.poesessid);

  return new Promise((resolve, reject) => {
    var request = https.request(requestParams, (response) => {
      var body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          var data = JSON.parse(body);
          if( !data.items || (data.error && data.error.message === "Forbidden") ) {
            logger.info(`Failed to get skill tree, returning null`);
            resolve(null);
          } else {
            resolve(data.items);
          }
        } catch(err) {
          logger.info(`Failed to get skill tree: ${err}`);
          resolve(null);
        }
      });
      response.on('error', (err) => {
        logger.info(`Failed to get skill tree: ${err}`);
        resolve(null);
      });
    });
    request.on('error', (err) => {
      logger.info(`Failed to get skill tree: ${err}`);
      resolve(null);
    });
    request.end();
  });

}

function getPreviousEquipment(timestamp) {
  
  return new Promise((resolve, reject) => {
    DB.get("select data from gear where timestamp < ? order by timestamp desc limit 1", [timestamp], (err, row) => {
      if(err) {
        logger.info(`Unable to retrieve previous equipment: ${err}`);
        resolve(null);
      } else if(!row) {
        logger.info(`No previous equipment found!`);
        resolve("none");
      } else {
        logger.info("Returning previous equipment");
        zlib.inflate(row.data, (err, buffer) => {
          if(err) {
            // old data - compression not implemented yet, just parse directly
            resolve(JSON.parse(row.data));
          } else {
            resolve(JSON.parse(buffer.toString()));
          }
        });        
      }
    });
  });
  
}

function compareEquipment(timestamp, prev, curr) {
  
  let diffs = {};
  
  for(var slot of gearSlots) {
    
    if(!prev[slot] && curr[slot]) {
      addDiff(slot, null, curr[slot]);
    } else if(!prev[slot] && curr[slot]) {
      addDiff(slot, prev[slot], null);
    } else {     
      if(!itemsEqual(prev[slot], curr[slot])) {
        addDiff(slot, prev[slot], curr[slot]);
      }
    }
  }
  
  for(var slot of multiGearSlots) {
    
    prev[slot] = prev[slot] || [];
    curr[slot] = curr[slot] || [];
    
    let prevTemp = JSON.parse(JSON.stringify(prev[slot]));
    let currTemp = JSON.parse(JSON.stringify(curr[slot]));
    
    for(let i = prevTemp.length - 1; i >= 0; i--) {
      let p = prevTemp[i];
      for(let j = currTemp.length - 1; j >= 0; j--) {
        let c = currTemp[j];
        if(itemsEqual(p, c)) {
          //logger.info(`Found same ${slot} in prev${i} and curr${j}`);
          prevTemp.splice(i, 1);
          currTemp.splice(j, 1);
          break;
        }
      }
    }

    if(prevTemp.length > 0 || currTemp.length > 0) {
      addDiff(slot, prevTemp, currTemp);
    } else {
      //logger.info(`No diffs found in ${slot}`);
    }
    
  }
  
  if(Object.keys(diffs).length > 0) {
    logger.info("Inserting equipment diff");
    insertEquipment(timestamp, curr, diffs);
  } else {
    logger.info("No diffs found in equipment, returning");
  }
  
  function addDiff(s, p, c) {
    logger.info(`Diffs found in ${s}`);
    diffs[s] = { prev: p, curr: c };
  }
  
}

function itemsEqual(a, b) {
  if(!a || !b) return (a == b);
  return deepEqual(getTempItem(a), getTempItem(b));
}

function getTempItem(item) {
  
  let tempItem;
  try {
    tempItem = JSON.parse(JSON.stringify(item));
  } catch(e) {
    logger.info(`Error parsing, item follows`);
    logger.info(JSON.stringify(item));
  }
  
  if(tempItem.inventoryId === "Flask") {
    // ignore flask charges and enchantment mods
    delete tempItem.enchantMods;
    for(let i = tempItem.properties.length - 1; i >= 0; i--) {
      if(flaskIgnoreProperties.includes(tempItem.properties[i].name)) {
        tempItem.properties.splice(i, 1);
      }
    }
  }
  
  // remove icon (ignore flask icon changes)
  delete tempItem.icon;
  // remove inventory id (ignore weapon swaps)
  delete tempItem.inventoryId;
  // remove requirements (may be changed by socketed gems)
  delete tempItem.requirements;
  // remove additionalProperties (only contains XP on skill gems)
  delete tempItem.additionalProperties;          
  // remove socketed items
  delete tempItem.socketedItems;
  
  // ignore jewel socket position on tree
  delete tempItem.x;
  delete tempItem.y;
  
  return tempItem;
  
}

async function insertEquipment(timestamp, currData, diffData = "") {
  let data = await Utils.compress(currData);
  let diff = JSON.stringify(diffData);
  DB.run("insert into gear(timestamp, data, diff) values(?, ?, ?)", [timestamp, data, diff], (err) => {
    if(err) {
      logger.info(`Unable to insert equipment: ${err}`);
    } else {
      logger.info(`Updated last equipment at ${timestamp} (data length: ${data.length}, diff length: ${diff.length})`);
    }
  });
}

module.exports.check = check;
module.exports.itemsEqual = itemsEqual;
module.exports.gearSlots = gearSlots;
module.exports.multiGearSlots = multiGearSlots;
module.exports.equipmentSlots = equipmentSlots;