const logger = require("./Log").getLogger(__filename);
const moment = require('moment');

async function logKillCount(timestamp, eqp) {
  
  var incubators = {};
  Object.keys(eqp).forEach((key) => {
    var item = eqp[key];
    if(item.incubatedItem) {
      incubators[key] = {
        level: item.incubatedItem.level,
        progress: item.incubatedItem.progress,
        total: item.incubatedItem.total
      };
    }
  });
  
  var DB = require('./DB').getDB();
  var currIncubators = JSON.stringify(incubators);
  var prevIncubators = await getPrevIncubators(DB);
  if(prevIncubators === currIncubators) {
    logger.info("Incubators are the same, returning");
  } else {
    DB.run("insert into incubators(timestamp, data) values(?, ?)", [timestamp, currIncubators], (err) => {
      if(err) {
        logger.info(`Error inserting incubator data for ${timestamp}): ${err}`);
      }
    });
  }

}

function getPrevIncubators(DB) {
  return new Promise((resolve, reject) => {
    DB.get("select data from incubators order by timestamp desc limit 1", (err, row)=> {
      if(err) {
        logger.info(`Error getting previous incubators: ${err}`);
      }
      if(row) {
        resolve(row.data);
      } else {
        resolve("");
      }
    });
  });
}

module.exports.logKillCount = logKillCount;
