const moment = require('moment');
const Constants = require('./Constants');
const logger = require("./Log").getLogger(__filename);
const https = require('https');
const Utils = require('./Utils');
const zlib = require('zlib');

const rateTypes = {
  "Currency" : cleanCurrency, 
  "Fragment" : cleanCurrency,
  "Oil" : cleanNameValuePairs,
  "Incubator" : cleanNameValuePairs,
  "Scarab" : cleanNameValuePairs,
  "Fossil" : cleanNameValuePairs,
  "Resonator" : cleanNameValuePairs,
  "Essence" : cleanNameValuePairs,
  "DivinationCard" : cleanNameValuePairs,
  "Prophecy" : cleanNameValuePairs,
  "SkillGem" : cleanGems,
  "BaseType" : cleanBaseTypes,
  "HelmetEnchant" : cleanEnchants,
  "UniqueMap" : cleanUniqueMaps,
  "Map" : cleanMaps,
  "UniqueJewel" : cleanUniqueItems,
  "UniqueFlask" : cleanUniqueItems,
  "UniqueWeapon" : cleanUniqueItems,
  "UniqueArmour" : cleanUniqueItems,
  "UniqueAccessory" : cleanUniqueItems,
  "Watchstone" : cleanWatchstones,
  "Vial" : cleanNameValuePairs,
  "DeliriumOrb" : cleanNameValuePairs
  // RIP harvest :-(
  // "Seed" : cleanSeeds 
};

const specialGems = ["Empower Support", "Enlighten Support", "Enhance Support"];
  
var DB;
var settings;
var league;

/*
 * get today's rates from POE.ninja 
 */
async function update() {
  
  settings = require('./settings').get();
  DB = require('./DB').getDB();
  league = settings.activeProfile.league;
  
  if(!league) {
    return;
  }
  // no need for exchange rates in SSF
  if (league.includes("SSF")) {
    if(!settings.activeProfile.overrideSSF) {
      return;
    } else {
      // override ssf and get item prices from corresponding trade league
      league = league.replace("SSF ", "");
    }    
  }

  var today = moment().format("YMMDD");  
  var hasExisting = await hasExistingRates(today);

  if (hasExisting) {
    logger.info(`Found existing rates for ${today}`);
    return;
  }
  
  logger.info(`Getting new rates in ${league} for ${today}`);
  getRates(today);

}

async function getRates(date) {
  
  var tempRates = {};
  
  try {
    for(var key in rateTypes) {
      logger.info(`Getting prices for item type ${key}`);
      var process = rateTypes[key];
      var data = await getNinjaData(getNinjaURL(key));
      tempRates[key] = process(data);
    }
    logger.info("Finished getting prices from poe.ninja");
  } catch(e) {
    logger.info("Error getting rates: " + e);
  }
  
  var rates = {};
  rates["UniqueItem"] = Object.assign(
    tempRates["UniqueJewel"],
    tempRates["UniqueFlask"],
    tempRates["UniqueWeapon"],
    tempRates["UniqueArmour"],
    tempRates["UniqueAccessory"]
  );
  rates["Currency"] = Object.assign(
    tempRates["Currency"], 
    tempRates["Oil"],
    tempRates["DeliriumOrb"],
    tempRates["Incubator"],
    tempRates["Fossil"],
    tempRates["Resonator"],
    tempRates["Essence"],
    tempRates["Vial"]
  );
  rates["Fragment"] = Object.assign(
      tempRates["Fragment"], 
      tempRates["Scarab"]
  );
  rates["DivinationCard"] = tempRates["DivinationCard"];
  rates["Prophecy"] = tempRates["Prophecy"];
  rates["SkillGem"] = tempRates["SkillGem"];
  rates["BaseType"] = tempRates["BaseType"];
  rates["HelmetEnchant"] = tempRates["HelmetEnchant"];
  rates["UniqueMap"] = tempRates["UniqueMap"];
  rates["Map"] = tempRates["Map"];
  rates["Watchstone"] = tempRates["Watchstone"];
  rates["Seed"] = tempRates["Seed"];
  
  var data = await Utils.compress(rates);
  DB.run("insert into fullrates(date, data) values(?, ?)", [date, data], (err) => {
    if(err) {
      logger.info(`Error inserting rates for ${date}: [${err}]`);
    } else {
      logger.info(`Successfully inserted rates for ${date}`);
    }
  });
  
}

function getNinjaURL(category) {
  var url = "";
  switch(category) {
    case "Currency":
    case "Fragment":
      url = `/api/data/currencyoverview?type=${category}`;
      break;
    case "Oil":
    case "Incubator":
    case "Scarab":
    case "Fossil":
    case "Resonator":
    case "Essence":
    case "DivinationCard":
    case "Prophecy":
    case "SkillGem":
    case "BaseType":
    case "HelmetEnchant":
    case "UniqueMap":
    case "Map":
    case "UniqueJewel":
    case "UniqueFlask":
    case "UniqueWeapon":
    case "UniqueArmour":
    case "UniqueAccessory":
    case "Watchstone":
    case "Vial":
    case "DeliriumOrb":
    case "Seed":
      url = `/api/data/itemoverview?type=${category}`;
      break;
    default:
      throw new Error(`Invalid poe.ninja category [${category}]`);
      break;
  }
  return `${url}&league=${encodeURIComponent(league)}`;
}

function getNinjaData(path) {
  return new Promise((resolve, reject) => {
    var request = https.request(
      { hostname: 'poe.ninja', path: path, method: 'GET', headers: { "Accept-Encoding" : "gzip" } }, response => {
        var buffers = [];
        response.on('data', (chunk) => {
          buffers.push(chunk);
        });
        response.on('end', () => {
          try {
            var data;
            var body = Buffer.concat(buffers);
            try {
              data = zlib.gunzipSync(body);
            } catch(e) {
              logger.info("Error unzipping received data: " + e);
              reject(e);
            }
            logger.info(`Got data from ${path}, length ${body.length} (${data.length} uncompressed)`);
            resolve(JSON.parse(data));
          } catch(e) {
            logger.info(`Failed to get data from [${path}]: ${e}`);
            reject(e);
          }
        });
        response.on('error', (e) => {
          logger.info(`Failed to get data from [${path}]: ${e}`);
          reject(e);
        });
      }
    );
    request.on('error', (e) => {
      logger.info(`Failed to get data from [${path}]: ${e}`);
      reject(e);
    });
    request.end();
  });
}

function hasExistingRates(date) {
  return new Promise((resolve, reject) => {
    DB.all("select 1 from fullrates where date = ? limit 1", [date], (err, row) => {
      if (err) {
        logger.info(`Error getting rates for ${date}: ${err}`);
        resolve(false);
      }
      if (row && row.length > 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

function cleanBaseTypes(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    var identifier = item.name;
    if(item.levelRequired) identifier += ` L${item.levelRequired}`;
    if(item.variant) identifier += ` ${item.variant}`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanUniqueItems(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    var identifier = item.name;
    if(item.name === "Grand Spectrum" || item.name === "Combat Focus") identifier += ` ${item.baseType}`;
    if(item.links) identifier += ` ${item.links}L`;
    if(item.variant) identifier += ` (${item.variant})`;
    if(item.itemClass === 9) identifier += ` (Relic)`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanGems(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    var identifier = item.name;
    if(item.gemLevel !== 1) identifier += ` L${item.gemLevel}`;
    if(item.gemQuality >= 20) {
      if(!specialGems.includes(item.name)) {
        identifier += ` Q${item.gemQuality}`;
      }
    }
    if(item.corrupted) {
      identifier += " (Corrupted)";
    }
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanCurrency(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    a[item.currencyTypeName] = item.chaosEquivalent;
  });
  return a;
}

function cleanNameValuePairs(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    a[item.name] = item.chaosValue;
  });
  return a;
}

function cleanEnchants(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    if(item.icon) {
      a[item.name] = item.chaosValue;
    }
  });
  return a;
}

function cleanUniqueMaps(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    var identifier = `${item.name} T${item.mapTier} ${item.baseType}`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanMaps(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    var identifier = `${item.baseType} T${item.mapTier} ${item.variant}`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanWatchstones(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    var identifier = `${item.name}, ${item.variant} uses remaining`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanSeeds(arr) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10) return; // ignore low confidence listings
    var identifier = item.name;
    if(item.levelRequired >= 76) identifier += ` L76+`;
    a[identifier] = item.chaosValue;
  });
  return a;
}


      
module.exports.update = update;