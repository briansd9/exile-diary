const logger = require('./Log').getLogger(__filename);
const Utils = require('./Utils');
const EventEmitter = require('events');
const ClientTxtWatcher = require('./ClientTxtWatcher');
const RateGetter = require('./RateGetter');
const settings = require('./settings').get();
const OCRWatcher = require('./OCRWatcher');
const https = require('https');

var DB;
var emitter = new EventEmitter();

async function tryProcess(event) {
  
  DB = require('./DB').getDB();
  var lastUsedEvent = await getLastUsedEvent();
  if(!lastUsedEvent) return;
  
  var firstEvent = await getNextMapEvent(lastUsedEvent);
  if(!firstEvent) return;
  logger.info("Map event found:");
  logger.info(JSON.stringify(firstEvent));
  
  if(Utils.isLabArea(event.area) && Utils.isLabArea(firstEvent.area)) {
    logger.info("Still in lab, not processing");
    return;
  } else if(event.area === firstEvent.area) {
    if(event.area === "Azurite Mine") {
      logger.info("Still in delve, not processing");
      return;
    } else if(event.server === firstEvent.server) {
      logger.info(`Still in same area ${event.area}, not processing`);
      return;
    }
  }
  
  var lastEvent = await getLastTownEvent(event, firstEvent);
  if(!lastEvent) return;
  logger.info("Last town event found:");
  logger.info(JSON.stringify(lastEvent));

  
  var mapStats;
  var areaInfo = await getAreaInfo(firstEvent, lastEvent);
  if(areaInfo) {
    mapStats = getMapStats(await getMapMods(areaInfo.id));
  } else {
    areaInfo = { 
      id: firstEvent.timestamp,
      name: firstEvent.area
    };
    mapStats = {
      iiq: null,
      iir: null,
      packsize: null
    };
    DB.run("insert into areainfo(id, name, level) values(?, ?, '')", [firstEvent.timestamp, firstEvent.area]);
  }

  var xp = await getXP(firstEvent.timestamp, lastEvent.timestamp);
  
  var runArr = [areaInfo.id, firstEvent.timestamp, lastEvent.timestamp, mapStats.iiq || null, mapStats.iir || null, mapStats.packsize || null, xp];
  
  insertEvent(runArr);
  checkProfit(areaInfo, firstEvent.timestamp, lastEvent.timestamp);
  
  return 1;
  
  function getNextMapEvent(lastUsedEvent) {
    return new Promise( (resolve, reject) => {
      DB.all("select id, event_text, server from events where event_type='entered' and id > ? order by id", [lastUsedEvent], (err, rows) => {
        if(err) {
          logger.error(`Unable to get next map event: ${err}`);
          resolve();
        }
        if(!rows) {
          logger.info("No valid next map event found");
          resolve();
        } else {
          var foundEvent = false;
          for(var i = 0; i < rows.length; i++) {
            if(!Utils.isTown(rows[i].event_text)) {
              foundEvent = true;
              resolve({
                timestamp: rows[i].id,
                area: rows[i].event_text,
                server: rows[i].server
              });
            }
          }
          if(!foundEvent) {
            logger.info("No valid next map event found");
            resolve();
          }
        }
      });    
    });
  }
  
  function getLastTownEvent(currEvent, mapEvent) {
    return new Promise( (resolve, reject) => {
      DB.all("select * from events where event_type='entered' and id > ? and id < ? order by id desc", [mapEvent.timestamp, currEvent.timestamp], (err, rows) => {
        if(err) {
          logger.error(`Unable to get last event: ${err}`);
          resolve();
        } else {
          var lastTownVisit = null;
          for(var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if(Utils.isTown(row.event_text)) {
              lastTownVisit = {
                timestamp: rows[i].id,
                area: rows[i].event_text,
                server: rows[i].server
              }
            } else {
              break;
            }
          }
          if(!lastTownVisit) {
            logger.info("No last event found!");
            resolve();
          } else {
            resolve(lastTownVisit);
          }
        }
      });    
    });
  }  
  
  function getAreaInfo(firstEvent, lastEvent) {
    return new Promise( (resolve, reject) => {
      DB.get("select * from areainfo where id > ? and id < ? and name = ? order by id desc", [firstEvent.timestamp, lastEvent.timestamp, firstEvent.area], (err, row) => {
        if(err) {
          logger.error(`Unable to get area info: ${err}`);
          resolve();
        }
        if(!row) {
          logger.info(`No area info found between ${firstEvent.timestamp} and ${lastEvent.timestamp}`);
          resolve();
        }
        resolve(row);
      });    
    });
  }
  
}



async function process(runInfo) {
  
  DB = require('./DB').getDB();

  var currArea = await getCurrAreaInfo();
  if(!currArea) return;

  var mods = await getMapMods(currArea.id);
  if(!mods) return;
  
  if(runInfo) {
    var currentRun = { areaInfo: currArea, mapMods: mods };
    if(isSameRun(currentRun, runInfo)) {
      logger.info("No new run started yet, will not automatically process previous run");
      return;
    }      
  }
  
  logger.info(`Processing run in ${currArea.name}`);
  
  var mapStats = getMapStats(mods);
  
  var lastUsedEvent = await getLastUsedEvent();
  if(!lastUsedEvent) return;
  
  var firstEvent = await getFirstEvent(currArea, lastUsedEvent);
  if(!firstEvent) return;
  
  var lastEvent = await getLastEvent(currArea, firstEvent);
  if(!lastEvent) return;
  
  var xp = await getXP(firstEvent, lastEvent);
  
  var runArr = [currArea.id, firstEvent, lastEvent, mapStats.iiq, mapStats.iir, mapStats.packsize, xp];
  
  insertEvent(runArr);
  checkProfit(currArea, firstEvent, lastEvent);
  
  return 1;
  
}

function isSameRun(run1, run2) {
  
  // use of != is deliberate, areaInfo.level can be returned as either number or string
  if(run1.areaInfo.name != run2.areaInfo.name || run1.areaInfo.level != run2.areaInfo.level) {
    return false;
  }
  
  if(JSON.stringify(run1.mapMods) !== JSON.stringify(run2.mapMods)) {
    return false;
  }
  
  return true;  
}

async function getXP(firstEvent, lastEvent) {
  return new Promise( async (resolve, reject) => {
    DB.get(" select timestamp, xp from xp where timestamp between ? and ? order by timestamp desc limit 1 ", [firstEvent, lastEvent], async (err, row) => {
      if(err || !row) {
        logger.info(`Failed to get XP between ${firstEvent} and ${lastEvent} from local DB, retrieving manually`);
        resolve(await getXPManual());
      } else {
        logger.info(`Got XP from DB: ${row.xp} at ${row.timestamp}`);
        resolve(row.xp);
      }
    })    
  });
}
  
  
async function getXPManual() {
  var requestParams = {
    hostname: 'www.pathofexile.com',
    path: '/character-window/get-characters?accountName=joshagarrado',
    method: 'GET',
    headers: {
      Referer: 'http://www.pathofexile.com/',
      Cookie: `POESESSID=${settings.poesessid}`
    }
  };
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
          var xp = -1;
          data.forEach(char => {
            if(char.name === settings.activeProfile.characterName && char.league === settings.activeProfile.league) {
              xp = char.experience;
              //logger.info("Got xp: " + xp);
            }
          });
          if(xp === -1) {
            logger.info('Failed to get xp!');
            resolve(null);
          } else {
            resolve(xp);
          }
        } catch(err) {
          logger.info(`Failed to get xp: ${err}`);
          resolve(null);
        }
      });
      response.on('error', (err) => {
        logger.info(`Failed to get xp: ${err}`);
        resolve(null);
      });
    });
    request.on('error', (err) => {
      logger.info(`Failed to get xp: ${err}`);
      resolve(null);
    });
    request.end();
  });
}

async function checkProfit(area, firstevent, lastevent) {

  var lastinv = await new Promise( async (resolve, reject) => {
      DB.get("select timestamp from lastinv", (err, row) => {
        if(err) {
          resolve(-1);
        } else {
          resolve(row.timestamp);
        }
      })
    });
  
  if(lastinv < lastevent) {
    logger.info(`Last inventory not yet processed (${lastinv} < ${lastevent}), waiting 3 seconds`);
    setTimeout(function() { checkProfit(area, firstevent, lastevent) }, 3000);
  } else {
    logger.info(`Getting chaos value of items from ${area.id} ${area.name}`);
    var totalProfit = await getItemValues(area, firstevent, lastevent);
    logger.info("Total profit is " + totalProfit);
    if(totalProfit) {
      var xp = await getXPDiff(area.id);
      emitter.emit("runProcessed", {name: area.name, id: area.id, gained: totalProfit, xp: xp, firstevent: firstevent, lastevent: lastevent});
    }
  }
}

function getXPDiff(id) {
  return new Promise( (resolve, reject) => {
    DB.all( " select xp from mapruns where id <= ? order by id desc limit 2", [id], (err, rows) => {
      if(!err) {
        resolve(rows[0].xp - rows[1].xp);
      } else {
        logger.info("Error: " + err);
      }
    });
  });
}

function getItemValues(area, firstEvent, lastEvent) {
  return new Promise( async (resolve, reject) => {
    var rates = await RateGetter.getFor(area.id);
    DB.all(
      " select id, event_text from events where id between ? and ? and event_type = 'entered' order by id ",
      [firstEvent, lastEvent],
      async (err, rows) => {
        if(err) {
          logger.info(`Unable to get item values for ${area.id}: ${err}`);
          resolve(false);
        } else {
          var totalProfit = 0;
          for(var i = 1; i < rows.length; i++) {
            var prevRow = rows[i - 1];
            if(!Utils.isTown(prevRow.event_text)) {
              totalProfit += Number.parseFloat(await getItemValuesFor(rows[i].id, rates));
            }
          }
          totalProfit = Number(totalProfit).toFixed(2);
          DB.run(" update mapruns set gained = ? where id = ? ", [totalProfit, area.id], (err) => {
            if(err) {
              logger.info(`Unable to update total profit for ${area.id}: ${err}`);
              resolve(false);
            } else {
              logger.info(`Updated ${area.id} with ${totalProfit}`);
              resolve(totalProfit);
            }
          });
        }   
      });
  });
}

function getItemValuesFor(event, rates) {
  var value = 0;
  return new Promise( (resolve, reject) => {
    DB.all( " select typeline, stacksize, identified, sockets, rarity from items where event_id = ? ", [event], (err, rows) => {
      rows.forEach( (item) => {
        value += Utils.getItemValue(item, rates);
        //logger.info(`After ${name} value is now ${value}`);
      });
      resolve(value);
    });
  });
}

function insertEvent(arr) {
  DB.run(" insert into mapruns(id, firstevent, lastevent, iiq, iir, packsize, xp) values (?, ?, ?, ?, ?, ?, ?) ", arr, (err) => {
    if(err) {
      logger.error(`Unable to insert event: ${err}`);
    }
  });
}

/*
 *  first event: first time the current map area is entered
 *  only start checking events after the end of the previous map (lastUsedEvent))
 */
function getFirstEvent(area, lastUsedEvent) {
  return new Promise( (resolve, reject) => {
    DB.get("select id from events where event_type='entered' and event_text = ? and id > ? order by id", [area.name, lastUsedEvent], (err, row) => {
      if(err) {
        logger.error(`Unable to get first event: ${err}`);
        resolve();
      }
      if(!row) {
        logger.info("No valid first event found");
        resolve();
      } else {
        resolve(row.id);
      }
    });    
  });
}

/*
 *  last event: first visit to a town after the last time the current map area is entered
 *  work backward from the last event recorded in the database
 */
function getLastEvent(area, firstEvent) {
  return new Promise( (resolve, reject) => {
    DB.all("select * from events where event_type='entered' and id >= ? order by id desc", [firstEvent], (err, rows) => {
      if(err) {
        logger.error(`Unable to get last event: ${err}`);
        resolve();
      } else {
        var lastTownVisit = null;
        var areaVisitFound = false;
        for(var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if(Utils.isTown(row.event_text)) {
            lastTownVisit = row.id;            
          } else if(row.event_text === area.name && lastTownVisit) {
            areaVisitFound = true;
            resolve(lastTownVisit);
            break;
          }
        }
        if(!lastTownVisit && !areaVisitFound) {
          logger.info("No last event found!");
          resolve();
        }
      }
    });    
  });
}

function getCurrAreaInfo() {
  return new Promise( (resolve, reject) => {
    DB.get("select * from areainfo where id not in (select id from mapruns) order by id desc", (err, row) => {
      if(err) {
        logger.error(`Unable to get last area info: ${err}`);
        resolve();
      }
      if(!row) {
        logger.info("No unprocessed map runs found");
        resolve();
      }
      resolve(row);
    });    
  });
}

function getLastUsedEvent() {
  return new Promise( (resolve, reject) => {
    DB.get("select max(lastevent) as lastevent from mapruns", (err, row) => {
      if(err) {
        logger.error(`Unable to get last used event: ${err}`);
        resolve("");
      }
      if(!row) {
        logger.info("No unused event found");
        resolve("");
      }
      resolve(row.lastevent);
    });    
  });
}

function getMapMods(id) {
  return new Promise( (resolve, reject) => {
    DB.all("select mod from mapmods where area_id = ? order by cast(id as integer)", [id], (err, rows) => {
      var mods = [];
      if(err) {
        logger.error(`Unable to get last map mods: ${err}`);
      } else {
        for(var i = 0; i < rows.length; i++) {
          mods.push(rows[i].mod);
        }
      }
      resolve(mods);
    });    
  });
}

function getMapStats(arr) {
  var mapStats = {};
  arr.forEach( (mod) => {
    if(mod.endsWith("% increased Rarity of Items found in this Area")) {      
      mapStats['iir'] = mod.match(/[0-9]+/)[0];
    } else if(mod.endsWith("% increased Quantity of Items found in this Area")) {
      mapStats['iiq'] = mod.match(/[0-9]+/)[0];
    } else if(mod.endsWith("% Monster pack size")) {
      mapStats['packsize'] = mod.match(/[0-9]+/)[0];
    }
  });
  return mapStats;
}

module.exports.process = process;
module.exports.tryProcess = tryProcess;
module.exports.emitter = emitter;
