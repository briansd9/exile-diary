let debugLogger = require('./modules/Log').getLogger(__filename);

function debugLog(str) {
  debugLogger.info(str);
  if($("#debugOutput").length) {
    $("#debugOutput").append(`${str}\r\n`);
    $("#debugOutput").scrollTop($("#debugOutput")[0].scrollHeight);
  }
}

function debugClear() {
  $("#debugOutput").html("");
}

async function updateUltimatum() {

  const r = require('./modules/RunParser');
  const DB = require('./modules/DB').getDB();
  const Constants = require('./modules/Constants');
  let queries = {};
  let updateStmt = DB.prepare(" update mapruns set runinfo = ? where id = ? ");
  await DB.all( " select id, firstevent, lastevent, runinfo from mapruns order by id ", async (err, rows) => {
    for(let row of rows) {
      DB.all(
        " select * from events where event_type='leagueNPC' and id between :first and :last and event_text like 'The Trialmaster%' order by id ",
        [ row.firstevent, row.lastevent ],
        async(err, events) => {
          if(events.length) {
            
            let obj = JSON.parse(row.runinfo);
            let ult = [];
            
            for(let i = 0; i < events.length; i++) {
              let evt = events[i];
              let line = r.getNPCLine(evt.event_text);
              if(Constants.ultimatumQuotes.start.includes(line.text)) {
                ult.push({ start : evt.id });
              } else {
                let currUlt = ult[ult.length - 1];
                if(!currUlt) {
                  debugLog(`Ultimatum event without start event: [${evt.id} ${line.text}]`);
                  continue;
                }
                if(Constants.ultimatumQuotes.lost.includes(line.text)) {
                  currUlt.lost = evt.id;
                } else if(Constants.ultimatumQuotes.tookReward.includes(line.text)) {
                  currUlt.tookReward = evt.id;
                } else if(Constants.ultimatumQuotes.won.includes(line.text)) {
                  currUlt.won = evt.id;
                } else if(Constants.ultimatumQuotes.trialmasterDefeated.includes(line.text)) {
                  currUlt.trialmasterDefeated = evt.id;
                } else if(Constants.ultimatumQuotes.mods[line.text]) {
                  currUlt.rounds = currUlt.rounds || {};            
                  currUlt.rounds[evt.id] = Constants.ultimatumQuotes.mods[line.text];
                  if(currUlt.rounds[evt.id].includes("/") && currUlt.rounds[evt.id].includes("Ruin")) {
                    console.log("Found ambiguous mod " + currUlt.rounds[evt.id]);
                    currUlt.isAmbiguous = true;
                  }
                }
              } 
            }
            
            for(let u of ult) {

              if(!u.isAmbiguous) continue;

              delete(u.isAmbiguous);

              let keys = Object.keys(u.rounds);
              let ruin = false, ruin2 = false, ruin3 = false, sruin = false, sruin2 = false, sruin3 = false;

              for(let i = 0; i < keys.length; i++) {
                let mod = u.rounds[keys[i]];
                switch(mod) {
                  case "Ruin II": 
                    ruin2 = true; 
                    break;                
                  case "Ruin III": 
                    ruin3 = true;
                    break;
                  case "Stalking Ruin": 
                    sruin = true;
                    break;
                  case "Ruin / Stalking Ruin III":
                    if(i === 0 || !sruin2 || sruin3) {
                      u.rounds[keys[i]] = "Ruin";
                      ruin = true;
                    } else if(ruin) {
                      u.rounds[keys[i]] = "Stalking Ruin III";
                      sruin3 = true;
                    }
                    break;
                  case "Ruin II / Stalking Ruin II":
                    if(sruin2 || (ruin && !sruin)) {
                      u.rounds[keys[i]] = "Ruin II";
                      ruin2 = true;
                    } else if(ruin2 || (sruin && !ruin)) {
                      u.rounds[keys[i]] = "Stalking Ruin II";
                      sruin2 = true;
                    }
                    break;
                }

              }

              // make a second pass if needed
              if(Object.values(u.rounds).includes("Ruin / Stalking Ruin III") || Object.values(u.rounds).includes("Ruin II / Stalking Ruin II")) {

                for(let i = 0; i < keys.length; i++) {
                  let mod = u.rounds[keys[i]];
                  switch(mod) {
                    case "Ruin / Stalking Ruin III":
                      if(sruin3 || (ruin2 && !ruin)) {
                        u.rounds[keys[i]] = "Ruin";
                        ruin = true;
                      } else if(!sruin3) {
                        // if only sruin and sruin2 are true, this case is STILL ambiguous, but fuck it let's just assume this
                        u.rounds[keys[i]] = "Stalking Ruin III";
                        sruin3 = true;
                      }
                      break;
                    case "Ruin II / Stalking Ruin II":
                      if(ruin && ruin3 && !ruin2) {
                        u.rounds[keys[i]] = "Ruin II";
                        ruin2 = true;
                      } else if(sruin && sruin3 && !sruin2) {
                        u.rounds[keys[i]] = "Stalking Ruin II";
                        sruin2 = true;
                      }
                      break;
                  }
                }                  

              }

              
            }
            
            obj.ultimatum = ult;
            
            let d = await execStmt(updateStmt, [JSON.stringify(obj), row.id]);
            if(d) {
              debugLog(`Updated ultimatum info for map ${row.id}`);
            } else {
              debugLog(`Error updating map ${row.id} : ${err}`);              
            }
          }
        }
      )
    }
  });
}

function recheckGained(startDate) {
  
  let RunParser = require('./modules/RunParser');
  RunParser.emitter.removeAllListeners("logMessage");
  RunParser.emitter.on("logMessage", (str) => { debugLog(str); });
  
  $(".debugButton").prop("disabled", true);
  
  if(!startDate) { 
    startDate = $("#recheckGainedStartValue").val().substring(0, 8) + "000000"; 
  }
  
  RunParser.recheckGained(startDate).then(() => {
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
  
  let fs = require("fs");
  let app = require('electron').app || require('electron').remote.app;
  let dataDir = fs.readdirSync(app.getPath("userData"));
  dataDir = dataDir.filter( file => file.endsWith(".db") );
  
  for(let i = 0; i < dataDir.length; i++) {
    let char = dataDir[i].slice(0, -3);
    debugLog(`Updating database for character ${char}`);
    await migrateLeagueDBData(char, true);
    debugLog(`Done updating database for character ${char}`);
    $("#debugOutput").append(`\r\n`);
  }
  
  $(".debugButton").prop("disabled", false);
  $("#debugOutput").append(`Done.`);
  
}

function execSql(sql) {
  sql = sql || $("#debugOutput").val();
  let DB = require('./modules/DB').getDB();
  DB.run(sql, [], function(err) {
    $("#debugsql").hide();
    $("#debugOutput").attr("readonly");
    if(err) {
      $("#debugOutput").val(err.toString());
    } else {
      $("#debugOutput").val(`Records changed: ${this.changes}.`);
    }
  });
}

async function updateAtlasRegions() {
  let m = require('./modules/Constants').atlasRegions;
  let r = {};
  for(let map in m) {
    r[m[map]] = r[m[map]] || [];
    r[m[map]].push(map);
  }
  for(let reg in r) {
    debugLog(`Updating maps in ${reg}`);
    let maps = r[reg];
    let mapStr = "";
    for(let i = 0; i < maps.length; i++) {
      mapStr += `${i > 0 ? "," : ""} "${maps[i]}"`;
    }
    let sql = `
      update mapruns set runinfo = json_insert(runinfo, "$.atlasRegion", "${reg}") 
      where id in ( select id from areainfo where id > 20210116000000 and name in (${mapStr}));
    `;
    let DB = require('./modules/DB').getDB();
    DB.run(sql, [], function(err) {
      $("#debugsql").hide();
      $("#debugOutput").attr("readonly");
      if(err) {
        debugLog(`Error updating maps in ${reg}`);
        debugLog(err.toString());
      } else {
        debugLog(`Updated ${this.changes} map runs in ${reg}.`);
      }
    });    
  }
}

async function v0286fix() {
  
  $(".debugButton").prop("disabled", true);
  
  let DB = require('./modules/DB').getDB();  
  debugLog("Starting...\n");
  
  await devalueRogueMarkers();
  await fixConquerorBattleCounts();
  await fixZanaBlightedMaps();
  await getMavenEvents();
  await recheckGained("20210115000000");
  
  async function devalueRogueMarkers() {
    debugLog("Setting value of Rogue's Marker drops to zero...");
    return new Promise( async (resolve, reject) => {
      DB.run(" update items set value = 0 where typeline = 'Rogue''s Marker' and value > 0 ", function(err) {
        if(err) {
          debugLog(err.toString());
        } else {
          debugLog(`${this.changes} records changed.\n`);
        }
        resolve(1);
      });
    });
  }
  
  async function fixConquerorBattleCounts() {

    debugLog("Fixing Conqueror and Sirus battle counts...");
    
    return new Promise( async (resolve, reject) => {
      
      DB.run("begin transaction");
      let conqs = require('./modules/Constants').conquerors;
      let runs = await getMapsSql(" select * from mapruns where id > 20210115000000 and runinfo like '%conq%' and runinfo like '%sirus%' ");
      let updateStmt = DB.prepare(" update mapruns set runinfo = ? where id = ? ");
      
      for(let i = 0; i < runs.length; i++) {
        let run = runs[i];
        let obj = JSON.parse(run.runinfo);
        delete obj.sirusBattle;
        conqs.forEach(c => {
          if(obj.conqueror[c]) {
            obj.conqueror[c].encountered = true;
            delete(obj.conqueror[c].battle);
          }
        });
        let str = JSON.stringify(obj);
        let d = await execStmt(updateStmt, [str, run.id]);
        if(d) {
          debugLog(`Fixed conqueror battle count for map ${i+1} of ${runs.length} with id ${run.id}.`);
        } else {
          debugLog(`Error conqueror battle count for map ${i+1} of ${runs.length} with id ${run.id}.`);
        }
      }
      
      if(runs.length === 0) {
        debugLog(`Didn't find any that needed fixing.\n`);
      }
      
      DB.run("commit");
      resolve(1);
      
    });
    
  }
  
  async function fixZanaBlightedMaps() {

    debugLog("Fixing Zana blighted map missions...");
    
    return new Promise( async (resolve, reject) => {
      
      DB.run("begin transaction");
      let runs = await getMapsSql(" select * from mapruns where id > 20210115000000 and runinfo like '%blightedMap%' and runinfo like '%Zana%' ");
      let updateStmt = DB.prepare(" update mapruns set runinfo = ? where id = ? ");
      
      for(let i = 0; i < runs.length; i++) {
        let run = runs[i];
        let obj = JSON.parse(run.runinfo);
        delete obj.blightedMap;
        obj.masters["Zana, Master Cartographer"].blightedMissionMap = true;
        let str = JSON.stringify(obj);
        let d = await execStmt(updateStmt, [str, run.id]);
        if(d) {
          debugLog(`Fixed Zana blighted mission for map ${i+1} of ${runs.length} with id ${run.id}.`);
        } else {
          debugLog(`Error fixing Zana blighted mission for map ${i+1} of ${runs.length} with id ${run.id}.`);
        }
      }
      
      if(runs.length === 0) {
        debugLog(`Didn't find any that needed fixing.\n`);
      }
      
      DB.run("commit");
      resolve(1);
      
    });
    
  }
  
  async function getMavenEvents() {
    
    debugLog("Updating maps with Maven events...");
    
    return new Promise( async (resolve, reject) => {
      
      DB.run("begin transaction");
      let mavenQuotes = require('./modules/Constants').mavenQuotes;
      let Utils  = require('./modules/Utils');
      let runs = await getMapsSql(`
        select * from mapruns where id > 20210115000000
        and exists(select 1 from events where id between mapruns.firstevent and mapruns.lastevent and event_text like 'The Maven%');
      `);
      let updateStmt = DB.prepare(" update mapruns set runinfo = ? where id = ? ");
      
      for(let j = 0; j < runs.length; j++) {
        let run = runs[j];
        let obj = JSON.parse(run.runinfo);
        let mapEvents = await getMavenMapEvents(run.firstevent, run.lastevent);
        for(let i = 0; i < mapEvents.length; i++) {
          if(!obj.maven) {
            obj.maven = { firstLine : mapEvents[i].id };
          } else {
            let eventType = mavenQuotes[mapEvents[i].text];
            if(eventType) {
              obj.maven[eventType] = mapEvents[i].id;
            }
          }
        }
        if(obj.maven) {
          if(obj.maven.bossKilled) {
            obj.bossBattle = {};
            obj.bossBattle.time = Utils.getRunningTime(obj.maven.firstLine, obj.maven.bossKilled, "s", { useGrouping : false } );
            let deaths = await getBossBattleDeaths(obj.maven.firstLine, obj.maven.bossKilled);
            if(deaths) {
              obj.bossBattle.deaths = deaths;
            }
          }
          let str = JSON.stringify(obj);
          let d = await execStmt(updateStmt, [str, run.id]);
          if(d) {
            debugLog(`Added Maven events for map ${j+1} of ${runs.length} with id ${run.id} ${obj.bossBattle ? ` - boss killed in ${obj.bossBattle.time} sec ${ obj.bossBattle.deaths ? `- ${obj.bossBattle.deaths} deaths` : ""}` : ""}`);
          } else {
            debugLog(`Error adding Maven events for map with id ${run.id}`);
          }
        }
      }
      
      DB.run("commit");
      resolve(1);
      
    });
    
    function getBossBattleDeaths(start, end) {
      return new Promise( (resolve, reject) => {
        DB.get(`select count(1) as count from events where event_type='slain' and id between ? and ? order by id`, [start, end], async (err, row) => {        
          if(err) {
            debugLog(err.toString());
            resolve(0);
          } else {
            resolve(row.count);
          }
        });
      });
    }
    
    function getMavenMapEvents(firstevent, lastevent) {
      return new Promise( (resolve, reject) => {
        DB.all(`
          select id, substr(event_text, 12) as text from events 
          where event_type='leagueNPC' and event_text like 'The Maven:%' 
          and id between ? and ? order by id
        `, [firstevent, lastevent], async (err, evts) => {        
          if(err) {
            debugLog(err.toString());
            resolve([]);
          } else {
            resolve(evts);
          }
        });
      });
    }
    
  }
  
  function getMapsSql(sql) {
    return new Promise( (resolve, reject) => {
      DB.all(sql, (err, runs) => {
        if(err) {
          debugLog(err.toString());
          resolve([]);
        } else {
          resolve(runs);
        }
      });
    });
  }
  
  
}

async function execStmt(stmt, data) {
  return new Promise( (resolve, reject) => {
    stmt.run(data, async (err) => {
      if(err) {
        console.log(err);
        debugLog(`Error executing statement: ${err}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });       
}

async function migrateLeagueDBData(char, force = false) {

  let db = await require('./modules/DB').initDB(char);
  let Utils = require('./modules/Utils');

  return new Promise( async (resolve, reject) => {

    db.serialize(async () => {

      await Utils.sleep(200);

      let ver = await getUserVersion();
      if(!ver && ver !== 0) {
        debugLog("Error getting DB version");
        resolve(false);
      } else if(ver >= 6 && !force) {
        debugLog("DB version >= 6, already updated");
        resolve(false);
      } else {

        $("#loadingText").html("Updating database to new version, please wait...")
        $("#loading").show();
        $("#mainContent").hide();
        
        if(force) {
          debugLog("Manually migrating league info to separate db");
        } else {
          debugLog("User version < 6, will migrate league info to separate db");
        }

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
              let d = await execStmt(stashStmt, [s.timestamp, s.items, s.value]);
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
              let d = await execStmt(ratesStmt, [s.date, s.data]);
              if(d) {
                debugLog(`Inserted rates for ${s.date}`);
              } else {
                debugLog(`Error inserting rates for ${s.date}`);
              }
            }
          }

          let charStmt = leagueDB.prepare(" insert into characters values(?)");
          let d = await execStmt(charStmt, [ char ]);
          if(d) {
            debugLog(`Inserted charName ${char}`);
          } else {
            debugLog(`Error inserting charName ${char}`);
          }

        }
        
        if(ver < 6) {
          await setUserVersion(6);
        }

        debugLog("Ended migration");

        $("#loadingImg").attr("src", "res/img/loadingcomplete.png");
        $("#loadingText").html("Update complete!");        
        await Utils.sleep(200);

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

  async function execStmt(stmt, data) {
    return new Promise( (resolve, reject) => {
      stmt.run(data, async (err) => {
        if(err) {
          debugLog(`Error executing statement: ${err}`);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });       
  }

}
