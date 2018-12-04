const moment = require('moment');
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
  "/api/data/itemoverview?type=Map"
];

var DB;
var settings;

/*
 * get today's rates from POE.ninja 
 */
async function update() {
  
  settings = require('./settings').get();
  DB = require('./DB').getDB();
  
  var league = settings.activeProfile.league;

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
  
  logger.info(`Getting new rates for ${today}`);
  getRates(today, league);

}

function getRates(date, league) {
  ratePaths.forEach(path => {
    var fullPath = `${path}&league=${league}&date=${moment().format("Y-MM-DD")}`;
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
      insertRate(date, JSON.parse(body));
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
    DB.run("begin transaction");
    data.lines.forEach( line => {

      var item = line.currencyTypeName || line.name;
      var value = line.chaosValue || line.chaosEquivalent;
      
      // ugly hacks for maps not uniquely identified by name
      if(item.endsWith("Map") && line.variant !== "Atlas2") {
        return;
      }
      if(item === "The Beachhead") {
        item += " (" + line.variant + ")";
      }
      
      DB.run("insert into rates(date, item, value) values(?, ?, ?)", [date, item, value], (err) => {
        if(err) {
          logger.info(`${err} -> [${date}] [${item}] [${value}]`);
        }
      });
    });
    DB.run("commit");
  });
}

function hasExistingRates(date) {
  return new Promise((resolve, reject) => {
    DB.all("select * from rates where date = ? limit 1", [date], (err, row) => {
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
function getFor(timestamp) {
  
  DB = require('./DB').getDB();
  return new Promise((resolve, reject) => {
    DB.get("select distinct date from rates where date <= ? order by date desc", [timestamp], (err, row) => {
      if(err) {
        logger.info(`Unable to get rates for ${timestamp}: ${err}`);
        resolve(null);
      } else if(!row) {
        logger.info(`No rates found for ${timestamp}`);
        resolve(null);
      } else {
        DB.all("select item, value from rates where date = ?", [row.date], (err, rows) => {
          if(err) {
            logger.info(`Unable to get rates for ${timestamp}: ${err}`);
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