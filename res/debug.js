let debugLogger = require('./modules/Log').getLogger(__filename);

function debugLog(str) {
  debugLogger.info(str);
  if($("#debugOutput").length) {
    $("#debugOutput").append(`${str}\r\n`);
    $("#debugOutput").scrollTop($("#debugOutput")[0].scrollHeight);    
  }
}

function recheckGained() {
  
  let RunParser = require('./modules/RunParser');
  RunParser.emitter.removeAllListeners("logMessage");
  RunParser.emitter.on("logMessage", (str) => { debugLog(str); });
  
  $(".debugButton").prop("disabled", true);
  $("#debugOutput").html("");
  RunParser.recheckGained().then(() => {
    $(".debugButton").prop("disabled", false);
    $("#debugOutput").append(`Done.`);
  });
  
}

function checkGearDuplicates() {
  
  $("#debugOutput").html("");
  $(".debugButton").prop("disabled", true);

  let DB = require('./modules/DB').getDB();
  let itemsEqual = require('./modules/GearChecker').itemsEqual;
  
  DB.all(" select timestamp, diff from gear ", (err, rows) => {
    if(rows) {
      for(let a = 0; a < rows.length; a++) {
        debugLog(`Checking ${a+1} of ${rows.length}`);
        let row = rows[a];
        let hasDiff = false;
        let diff = JSON.parse(row.diff);
        let keys = Object.keys(diff);
        keys.forEach( key => {
          let gearSlot = diff[key];
          if(gearSlot.prev && gearSlot.curr) {
            if(Array.isArray(gearSlot.prev)) {
              for(let i = gearSlot.prev.length - 1; i > -1; i--) {
                for(let j = gearSlot.curr.length - 1; j > -1; j--) {
                  let prevObj = gearSlot.prev[i];
                  let currObj = gearSlot.curr[j];
                  if(itemsEqual(prevObj, currObj)) {
                    gearSlot.prev.splice(i, 1);
                    gearSlot.curr.splice(j, 1);
                    hasDiff = true;
                  }
                }
              }
              if(gearSlot.prev.length === 0 && gearSlot.curr.length === 0) {
                debugLog(`${row.timestamp} : Multi gear slot ${key} contains no changes, deleting`);
                delete diff[key];
                hasDiff = true;
              }
              
            } else {
              if(itemsEqual(gearSlot.prev, gearSlot.curr)) {
                debugLog(`${row.timestamp} : Items in gear slot ${key} not actually different, deleting`);
                delete diff[key];
                hasDiff = true;
              }
            }
          }
        });
        if(hasDiff) {
          let str = JSON.stringify(diff);
          if(str === "{}") {
            debugLog("Diff is now empty, deleting");
            DB.run("delete from gear where timestamp = ?", [row.timestamp], (err) => {
              if(err) {
                debugLog("Failed to delete diff: " + err);
              } else {
                debugLog("Empty diff successfully deleted");
              }
            })
          } else {
            debugLog("Updating diff");
            DB.run("update gear set diff = ? where timestamp = ?", [JSON.stringify(diff), row.timestamp], (err) => {
                if(err) {
                  debugLog("Failed to update diff: " + err);
                } else {
                  debugLog("Diff successfully updated");
                }
            });
          }
        }
      }
    }
    $(".debugButton").prop("disabled", false);
    debugLog("Done.");
  });
  
}


async function migrateAll() {
  
  $(".debugButton").prop("disabled", true);
  $("#debugOutput").html("");
  
  let fs = require("fs");
  let app = require('electron').app || require('electron').remote.app;
  let dataDir = fs.readdirSync(app.getPath("userData"));
  dataDir = dataDir.filter( file => file.endsWith(".db") );
  
  for(let i = 0; i < dataDir.length; i++) {
    let char = dataDir[i].slice(0, -3);
    debugLog(`Updating database for character ${char}`);
    await migrateLeagueDBData(char);
    debugLog(`Done updating database for character ${char}`);
  }
  
  $(".debugButton").prop("disabled", false);
  $("#debugOutput").append(`Done.`);
  
}


async function migrateLeagueDBData(char) {

  let db = await require('./modules/DB').initDB(char);
  let Utils = require('./modules/Utils');

  return new Promise( async (resolve, reject) => {

    db.serialize(async () => {

      await Utils.sleep(500);

      let ver = await getUserVersion();
      if(!ver && ver !== 0) {
        debugLog("Error getting DB version");
        resolve(false);
      } else if(ver >= 6) {
        debugLog("DB version >= 6, already updated");
        resolve(false);
      } else {

        $("#loadingText").html("Updating database to new version, please wait...")
        $("#loading").show();
        $("#mainContent").hide();

        debugLog("User version < 6, will migrate league info to separate db");

        let leagues = await getLeagues();
        if(!leagues) {
          debugLog("Error getting league list");
          resolve(false);
        }
        for(let i = 0; i < leagues.length; i++) {

          let leagueDB = await require('./modules/DB').initLeagueDB(leagues[i].league, char);

          let stashes = await getStashes(leagues[i].timestamp, (i < leagues.length - 1) ? leagues[i+1].timestamp : null);
          if(!stashes) {
            debugLog(`Failed to get stashes from char db for ${leagues[i].league}`);
          } else {
            let stashStmt = leagueDB.prepare(" insert into stashes(timestamp, items, value) values(?, ?, ?) ");
            debugLog(`Inserting ${leagues[i].league} stashes`);
            for(let j = 0; j < stashes.length; j++) {
              let s = stashes[j];
              let d = await insertData(stashStmt, [s.timestamp, s.items, s.value]);
              if(d) {
                debugLog(`Inserted stash ${s.timestamp} with value ${s.value}`);
              } else {
                debugLog(`Error inserting stash ${s.timestamp} with value ${s.value}`);
              }
            }
          }

          let rates = await getRates(leagues[i].timestamp.substring(0, 8), (i < leagues.length - 1 ? leagues[i+1].timestamp.substring(0, 8) : null));
          if(!rates) {
            debugLog(`Failed to get rates from char db for ${leagues[i].league}`);
          } else {
            let ratesStmt = leagueDB.prepare(" insert into fullrates(date, data) values(?, ?) ");
            debugLog(`Inserting ${leagues[i].league} rates`);
            for(let j = 0; j < rates.length; j++) {
              let s = rates[j];
              let d = await insertData(ratesStmt, [s.date, s.data]);
              if(d) {
                debugLog(`Inserted rates for ${s.date}`);
              } else {
                debugLog(`Error inserting rates for ${s.date}`);
              }
            }
          }

          let charStmt = leagueDB.prepare(" insert into characters values(?)");
          let d = await insertData(charStmt, [ char ]);
          if(d) {
            debugLog(`Inserted charName ${char}`);
          } else {
            debugLog(`Error inserting charName ${char}`);
          }

        }

        await setUserVersion(6);

        debugLog("Ended migration");

        $("#loadingImg").attr("src", "res/img/loadingcomplete.png");
        $("#loadingText").html("Update complete!");        
        await Utils.sleep(500);

      }
      resolve(1);                

    });
  });

  async function getUserVersion() {
    return new Promise( (resolve, reject) => {
      db.get(" pragma user_version ", (err, row) => {
        if(err) {
          debugLog("Error getting user_version: " + err);
          resolve(false);
        } else {
          resolve(row.user_version);
        }
      });
    });       
  }

  async function setUserVersion(ver) {
    return new Promise( (resolve, reject) => {
      db.run(` pragma user_version = ${ver} `, (err, row) => {
        if(err) {
          debugLog("Error setting user_version: " + err);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });       
  }        

  async function getLeagues() {
    return new Promise( (resolve, reject) => {
      db.all(" select * from leagues order by timestamp ", async (err, leagues) => {
        if(err) {
          debugLog("Error getting league list: " + err);
          resolve(false);
        } else {
          resolve(leagues);
        }
      });
    });       
  }

  async function getStashes(t1, t2) {
    let sql = ` select timestamp, items, value from stashes where timestamp > ${t1} `;
    if(t2) {
      sql += ` and timestamp < ${t2} `;
    }
    return new Promise( (resolve, reject) => {
      db.all(sql, async (err, stashes) => {
        if(err) {
          debugLog("Error getting stashes: " + err);
          resolve(false);
        } else {
          resolve(stashes);
        }
      });
    });       
  }

  async function getRates(t1, t2) {
    let sql = ` select date, data from fullrates where date >= ${t1} `;
    if(t2) {
      sql += ` and date < ${t2} `;
    }
    return new Promise( (resolve, reject) => {
      db.all(sql, async (err, rates) => {
        if(err) {
          debugLog("Error getting rates: " + err);
          resolve(false);
        } else {
          resolve(rates);
        }
      });
    });       
  }

  async function insertData(stmt, data) {
    return new Promise( (resolve, reject) => {
      stmt.run(data, async (err) => {
        if(err) {
          debugLog(`Error inserting data: ${err}`);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });       
  }

}
