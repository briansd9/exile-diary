const logger = require("./Log").getLogger(__filename);
const https = require('https');
const { deepEqual } = require('fast-equals');

var DB;
var settings;

const gearSlots = [
  "Amulet",
  "Belt",
  "BodyArmour",
  "Boots",  
  "Gloves",
  "Helm",
  "Ring",
  "Ring2"
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
      delete(item.socketedItems);
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
  }
  
  let prevGear = await getPreviousEquipment(timestamp, currGear);
  if(!prevGear) {
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
        resolve(null);
      } else {
        logger.info("Returning previous equipment");
        resolve(JSON.parse(row.data));
      }
    });
  });
  
}

function compareEquipment(timestamp, prev, curr) {
  
  let diffs = {};
  
  for(var slot of gearSlots) {
    
    logger.info(`Checking ${slot}`);
    
    if(!prev[slot] && curr[slot]) {
      logger.info(`Diff: new equipment in ${slot}`);
      addDiff(slot, null, curr[slot]);
    } else if(!prev[slot] && curr[slot]) {
      logger.info(`Diff: removed equipment in ${slot}`);
      addDiff(slot, prev[slot], null);
    } else {     
      if(!deepEqual(prev[slot], curr[slot])) {
        addDiff(slot, prev[slot], curr[slot]);
      } else {
        logger.info(`No diffs found in ${slot}`);
      }
    }
  }
  
  for(var slot of multiGearSlots) {
    
    logger.info(`Checking ${slot}`);
    
    prev[slot] = prev[slot] || [];
    curr[slot] = curr[slot] || [];
    
    // create copies of the items, as some properties will have to be removed before comparing
    let prevTemp = [];
    let currTemp = [];
    let prevOriginal = {};
    let currOriginal = {};
    
    for(let i = 0; i < prev[slot].length; i++) {
      prevOriginal[prev[slot][i].id] = JSON.parse(JSON.stringify(prev[slot][i]));
      prevTemp.push(getTempItem(slot, prev[slot][i]));
    }
    for(let i = 0; i < curr[slot].length; i++) {
      currOriginal[curr[slot][i].id] = JSON.parse(JSON.stringify(curr[slot][i]));
      currTemp.push(getTempItem(slot, curr[slot][i]));
    }
    
    for(let i = prevTemp.length - 1; i >= 0; i--) {
      let p = prevTemp[i];
      for(let j = currTemp.length - 1; j >= 0; j--) {
        let c = currTemp[j];
        if(deepEqual(p, c)) {
          prevTemp.splice(i, 1);
          currTemp.splice(j, 1);
          break;
        }
      }
    }
    
    if(prevTemp.length > 0 || currTemp.length > 0) {
      let prevRet = [];
      let currRet = [];
      prevTemp.forEach( item => { prevRet.push(prevOriginal[item.id]); });
      currTemp.forEach( item => { currRet.push(currOriginal[item.id]); });
      addDiff(slot, prevRet, currRet);
    } else {
      logger.info(`No diffs found in ${slot}`);
    }
    
  }
  
  if(Object.keys(diffs).length > 0) {
    insertEquipment(timestamp, curr, diffs);
  } else {
    logger.info("No diffs found in equipment, returning");
  }
  
  
  
  
  function getTempItem(slot, item) {
    let tempItem = Object.assign({}, item);
    if(slot === "Flask") {
      // remove current number of charges 
      // remove flask icon (changes depending on charges)
      for(let i = 0; i < tempItem.properties.length; i++) {
        if(tempItem.properties[i].name === "Currently has %0 Charges") {
          tempItem.properties.splice(i, 1);
          break;
        }
      }
      delete tempItem.icon;
    } else if(slot === "Weapons") {
      // remove requirements (may be changed by socketed gems)
      // remove inventory id (ignore weapon swaps)
      delete tempItem.requirements;
      delete tempItem.inventoryId;
    } else {
      // remove additionalProperties (only contains XP on skill gems)
      delete tempItem.additionalProperties;          
    }
    return tempItem;
  }
  
  function addDiff(s, p, c) {
    logger.info(`Diffs found in ${slot}`);
    diffs[s] = { prev: p, curr: c };
  }
  
}

function insertEquipment(timestamp, currData, diffData = "") {
  let data = JSON.stringify(currData);
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