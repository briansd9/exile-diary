const moment = require('moment');
const Constants = require('./Constants');
const logger = require("./Log").getLogger(__filename);
const https = require('https');

const ratePaths = [
  "/api/data/currencyoverview?type=Currency",
  "/api/data/currencyoverview?type=Fragment",
  "/api/data/itemoverview?type=Fossil",
  "/api/data/itemoverview?type=Resonator",
  "/api/data/itemoverview?type=Essence",
  "/api/data/itemoverview?type=DivinationCard",
  "/api/data/itemoverview?type=UniqueMap",
  "/api/data/itemoverview?type=Map",
  "/api/data/itemoverview?type=Scarab",
  "/api/data/itemoverview?type=Prophecy",
  "/api/data/itemoverview?type=Incubator",
  "/api/data/itemoverview?type=Oil",
];

const CURRENT_ATLAS_SERIES = "Blight";

var DB;
var settings;

/*
 * get today's rates from POE.ninja 
 */
async function update() {
  
  settings = require('./settings').get();
  DB = require('./DB').getDB();
  
  var league = settings.activeProfile.league;
  
  if(!league) {
    return;
  }
  // no need for exchange rates in SSF
  if (league.includes("SSF")) {
    return;
  }

  var today = moment().format("YMMDD000000");  
  var hasExisting = await hasExistingRates(today);

  if (hasExisting) {
    logger.info(`Found existing rates for ${today}`);
    return;
  }
  
  logger.info(`Getting new rates in ${league} for ${today}`);
  getRates(today, league);

}

function getRates(date, league) {
  ratePaths.forEach(path => {
    var fullPath = `${path}&league=${encodeURIComponent(league)}&date=${moment().format("Y-MM-DD")}`;
    getRate(date, fullPath);
  });
}

function getRate(date, path) {
  var request = https.request({
    hostname: 'poe.ninja',
    path: path,
    method: 'GET'
  },
    (response) => {
    var body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => {
      try {
        var data = JSON.parse(body);
        insertRate(date, data);
      } catch(e) {
        logger.info(`Failed to get rates for ${date}: ${e}`);
      }
    });
    response.on('error', (e) => {
      logger.info(`Failed to get rates for ${date}: ${e}`);
    });
  });
  request.on('error', (e) => {
    logger.info(`Failed to get rates for ${date}: ${e}`);
  });
  request.end();
}

function insertRate(date, data) {
  DB.serialize(() => {
    DB.run("begin transaction", (err) => {
        if(err) {
          logger.info(`Error beginning transaction for inserting rates: ${err}`);
        }        
    });
    data.lines.forEach( line => {
      
      // special handling for maps (itemclass !== 5 filters out essences, which also have a tier)
      if(line.mapTier > 0 && line.itemClass !== 5) {
        if(line.itemClass !== 3 && line.variant !== CURRENT_ATLAS_SERIES) {
          // for non-unique maps, only get values for the current atlas series, as those are the only ones that can drop
          // logger.info(`Bypassing previous map series: ${line.name} from ${line.variant} (value ${line.chaosValue || line.chaosEquivalent})`);
          return;
        } else if(line.itemClass === 3 && line.name !== "The Beachhead") {
          // unique maps currently store no information about their atlas series. GGG plz
          var currentAtlasMap = Constants.uniqueMapsCurrentAtlas[line.name];
          if(line.mapTier !== currentAtlasMap.mapTier || line.baseType !== currentAtlasMap.baseType) {
//            logger.info(
//              `Bypassing old unique map type: ${line.name}, tier ${line.mapTier} ${line.baseType} `
//              + `(expected: tier ${currentAtlasMap.mapTier} ${currentAtlasMap.baseType})`
//            );
            return;
          }
        }
      }

      var item = line.currencyTypeName || line.name;
      var value = line.chaosValue || line.chaosEquivalent;
      
      switch(item) {
        case "The Beachhead":
        case "A Master Seeks Help":
          item += " (" + line.variant + ")";
          break;
        case "Rebirth":
        case "The Twins":
          item += (line.prophecyText ? " (Prophecy)" : " (Divination Card)");
          break;
        default:
          break;
      }
        
      DB.run("insert into rates(date, item, value) values(?, ?, ?)", [date, item, value], (err) => {
        if(err) {
          logger.info(`Error inserting rates: ${err} -> [${date}] [${item}] [${value}]`);
        }
      });
    });
    DB.run("commit", (err) => {
      if(err) {
        logger.info(`Error committing inserted rates: ${err}`);
      }        
    });
      
  });
}

function hasExistingRates(date) {
  return new Promise((resolve, reject) => {
    DB.all("select * from rates where date = ? limit 1", [date], (err, row) => {
      if (err) {
        logger.info(`Error getting rates for ${date}: ${err}`);
      }
      if (row && row.length > 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

/*
 * get rates for a specific date from DB
 */
function getFor(timestamp, repeatCount) {
  
  settings = require('./settings').get();
  var league = settings.activeProfile.league;
  if (league.includes("SSF")) {
    return;
  }  

  DB = require('./DB').getDB();
  return new Promise((resolve, reject) => {
    var date = timestamp.toString().substring(0, 8) + "000000";
    DB.get("select distinct date from rates where date = ? order by date desc", [date], async (err, row) => {
      if(err) {
        logger.info(`Unable to get rates for ${date}: ${err}`);
        resolve(null);
      } else if(!row) {
        // logger.info(`No old rates found for ${date}`);
        resolve(null);
      } else {
        DB.all("select item, value from rates where date = ?", [row.date], (err, rows) => {
          if(err) {
            logger.info(`Unable to get rates for ${date}: ${err}`);
          } else {
            var rates = {};
            rows.forEach(row => {
              rates[row.item] = row.value;
            });
            resolve(rates);
          }
        });
      }
    });
  });
}

module.exports.update = update;
module.exports.getFor = getFor;