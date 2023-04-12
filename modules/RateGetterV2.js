const EventEmitter = require('events');
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
  "Vial" : cleanNameValuePairs,
  "DeliriumOrb" : cleanNameValuePairs,
  "Invitation" : cleanNameValuePairs,
  "Artifact" : cleanNameValuePairs
  // Old Categories
  // "Prophecy" : cleanNameValuePairs,
  // "Watchstone" : cleanWatchstones,
  // RIP harvest :-(
  // "Seed" : cleanSeeds 
};

const specialGems = ["Empower Support", "Enlighten Support", "Enhance Support"];
var ratesReady;
var nextRateGetTimer;
var emitter = new EventEmitter();

class RateGetterV2 {
  
  constructor() {
    
    clearTimeout(nextRateGetTimer);
    RateGetterV2.ratesReady = false;
    this.settings = require('./settings').get();
    this.league = this.settings.activeProfile.league;
    this.priceCheckLeague = null;
    this.DB = require('./DB').getLeagueDB(this.league);
    
    if(this.league.includes("SSF") && this.settings.activeProfile.overrideSSF) {
      // override ssf and get item prices from corresponding trade league
      // TODO undocumented league naming convention change in 3.13... must check this every league from now on
      // as of 3.13 "SSF Ritual HC" <--> "Hardcore Ritual"
      let l = this.league.replace("SSF", "").trim();
      if(l.includes("HC")) {
        l = "Hardcore " + l.replace("HC", "").trim();
      }
      this.priceCheckLeague = l;
    }    
    
  }

/*
 * get today's rates from POE.ninja 
 */
  async update(isForced = false) {
    
    if(!this.league) {
      logger.info("No league set, will not attempt to get prices");
      return;
    }

    // no need for exchange rates in SSF
    if(this.league.includes("SSF") && !this.settings.activeProfile.overrideSSF) {
      return;
    }
    
    if(Utils.isPrivateLeague(this.league)) {
      if(this.settings.privateLeaguePriceMaps && this.settings.privateLeaguePriceMaps[this.league]) {
        logger.info(`Private league ${this.league} will use prices from ${this.settings.privateLeaguePriceMaps[this.league]}`);
        this.league = this.settings.privateLeaguePriceMaps[this.league];
      } else {
        logger.info(`No price map set for private league ${this.league}, will not attempt to get prices`);
        return;
      }
    }
    
    const today = moment().format("YMMDD");  
    const hasExisting = await this.hasExistingRates(today);

    if (hasExisting) {
      logger.info(`Found existing ${this.league} rates for ${today}`);

      if(!isForced) {
        RateGetterV2.ratesReady = true;
        this.scheduleNextUpdate();
        return;
      } else {
        await this.cleanRates(today);
      }
    }

    emitter.emit("gettingPrices");
    logger.info(`Getting new ${this.league} rates for ${today}`);
    this.getRates(today);

  }
  
  async cleanRates(date) {
    return this.DB.run("DELETE FROM fullrates WHERE date = ?", [date], (err) => {
      if(err) {
        logger.info("Error cleaning rates: " + err);
        return;
      }
    })
  }

  scheduleNextUpdate() {
    
    // schedule next rate update at 10 seconds after midnight
    let d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 10);
    let interval = d - Date.now();
    logger.info(`Set new timer for updating prices in ${Number(interval / 1000).toFixed(2)} sec`);
    
    clearTimeout(nextRateGetTimer);
    nextRateGetTimer = setTimeout(() => {
      logger.info("Executing scheduled rate update");
      this.update();
    }, interval);
    
  }

  async getRates(date) {

    var tempRates = {};

    let useGzip = this.settings.hasOwnProperty("useGzip") ? this.settings.useGzip : true;
    let getLowConfidence = this.settings.hasOwnProperty("getLowConfidence") ? this.settings.getLowConfidence : false;

    try {
      for(var key in rateTypes) {
        var data;
        for(let i = 1; i <= 10; i++) {
          logger.info(`Getting prices for item type ${key}, attempt ${i} of 10`);
          try {
            data = await getNinjaData(this.getNinjaURL(key), useGzip);
            break;
          } catch(err) {
            if(i === 10) throw err;
          }
        }
        var process = rateTypes[key];
        logger.info(key);
        tempRates[key] = process(data, getLowConfidence);
      }
      logger.info("Finished getting prices from poe.ninja, processing now");
    } catch(e) {
      emitter.emit("gettingPricesFailed");
      logger.info("Error getting rates: " + e);
      return;
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
      tempRates["Vial"],
      tempRates["Artifact"]
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
    rates["Invitation"] = tempRates["Invitation"];
    rates["Seed"] = tempRates["Seed"];

    var data = await Utils.compress(rates);
    this.DB.run("insert into fullrates(date, data) values(?, ?)", [date, data], (err) => {
      if(err && !err.message.includes("UNIQUE constraint failed")) {
        emitter.emit("gettingPricesFailed");
        logger.info(`Error inserting rates for ${date}: [${err}]`);
      } else {
        emitter.emit("doneGettingPrices");
        RateGetterV2.ratesReady = true;
        logger.info(`Successfully inserted rates for ${date}`);
        this.scheduleNextUpdate();
      }
    });

  }
  
  getNinjaURL(category) {
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
      case "Invitation":
      case "Artifact":
        url = `/api/data/itemoverview?type=${category}`;
        break;
      default:
        throw new Error(`Invalid poe.ninja category [${category}]`);
        break;
    }
    
    return `${url}&league=${encodeURIComponent(this.priceCheckLeague || this.league)}`;
    
  }
  

  hasExistingRates(date) {
    return new Promise((resolve, reject) => {
      this.DB.all("select 1 from fullrates where date = ? limit 1", [date], (err, row) => {
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

}

function getNinjaData(path, useGzip) {
  return new Promise((resolve, reject) => {
    
    let headerObject = useGzip ? { "Accept-Encoding" : "gzip" } : {};
    let timeout = useGzip ? 10000 : 30000;
    
    var request = https.request({ 
        hostname: 'poe.ninja', 
        path: path, 
        method: 'GET', 
        headers: headerObject 
      }, response => {
        var buffers = [];
        response.on('data', (chunk) => {
          buffers.push(chunk);
        });
        response.on('end', () => {
          try {
            var data;
            var body = Buffer.concat(buffers);
            try {
              data = useGzip ? zlib.gunzipSync(body) : body.toString();
            } catch(e) {
              logger.info("Error unzipping received data: " + e);
            }
            logger.info(`Got data from ${path}, length ${body.length} ${ useGzip ? `(${data.length} uncompressed)` : "" }`);
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
        response.on('aborted', (e) => {
          logger.info(`Failed to get data from [${path}]: response aborted!`);
          reject(e);
        });
      }
    );
    request.on('error', (e) => {
      logger.info(`Failed to get data from [${path}]: ${e}`);
      reject(e);
    });
    request.on('timeout', () => {
      request.destroy(new Error(`Timed out after ${timeout/1000} seconds`));
    });
    request.setTimeout(timeout);
    request.end();
  });
}

function cleanBaseTypes(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    var identifier = item.name;
    if(item.levelRequired) identifier += ` L${item.levelRequired}`;
    if(item.variant) identifier += ` ${item.variant}`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanUniqueItems(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    var identifier = item.name;
    if(item.name === "Grand Spectrum" || item.name === "Combat Focus") identifier += ` ${item.baseType}`;
    if(item.links) identifier += ` ${item.links}L`;
    if(item.variant) identifier += ` (${item.variant})`;
    if(item.itemClass === 9) identifier += ` (Relic)`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanGems(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
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

function cleanCurrency(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.currencyTypeName === "Rogue's Marker") {
      return;
    }
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    a[item.currencyTypeName] = item.chaosEquivalent;
  });
  return a;
}

function cleanNameValuePairs(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    a[item.name] = item.chaosValue;
  });
  return a;
}

function cleanEnchants(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    if(item.icon) {
      a[item.name] = item.chaosValue;
    }
  });
  return a;
}

function cleanUniqueMaps(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    var identifier = `${item.name} T${item.mapTier} ${item.baseType}`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanMaps(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    var identifier = `${item.baseType} T${item.mapTier} ${item.variant}`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanWatchstones(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    var identifier = `${item.name}, ${item.variant} uses remaining`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

function cleanSeeds(arr, getLowConfidence = false) {
  var a = {};
  arr.lines.forEach(item => {
    if(item.count && item.count < 10 && !getLowConfidence) return; // ignore low confidence listings
    var identifier = item.name;
    if(item.levelRequired >= 76) identifier += ` L76+`;
    a[identifier] = item.chaosValue;
  });
  return a;
}

let Updater = new RateGetterV2();
module.exports.Getter = Updater;

module.exports.emitter = emitter;
module.exports.ratesReady = ratesReady;