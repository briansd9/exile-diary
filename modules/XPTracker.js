const logger = require("./Log").getLogger(__filename);
const moment = require('moment');

async function logXP(timestamp, currXP) {
  var DB = require('./DB').getDB();
  var timestamp = moment().format('YMMDDHHmmss');
  var prevXP = await getPrevXP(DB);
  if(prevXP !== currXP) {
    logger.info(`XP update ${timestamp}: ${prevXP} -> ${currXP}`);
    DB.run("insert into xp(timestamp, xp) values(?, ?)", [timestamp, currXP]);
  }
}

function getPrevXP(DB) {
  return new Promise((resolve, reject) => {
    DB.get("select xp from xp order by timestamp desc limit 1", (err, row)=> {
      if(row) {
        resolve(row.xp);
      } else {
        resolve(0);
      }
    });
  });
}

module.exports.logXP = logXP;