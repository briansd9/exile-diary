const logger = require('./Log').getLogger(__filename);
const Utils = require('./Utils');
const EventEmitter = require('events');
const ClientTxtWatcher = require('./ClientTxtWatcher');
const ItemPricer = require('./ItemPricer');
const OCRWatcher = require('./OCRWatcher');
const XPTracker = require('./XPTracker');
const Constants = require('./Constants');
const https = require('https');

var DB;
var emitter = new EventEmitter();

async function tryProcess(obj) {
  
  var event = obj.event;
  var mode = obj.mode;
  
  DB = require('./DB').getDB();
  var lastUsedEvent = await getLastUsedEvent();
  if(!lastUsedEvent) return;
  
  var firstEvent = await getNextMapEvent(lastUsedEvent);
  if(!firstEvent) return;
  logger.info("Map event found:");
  logger.info(JSON.stringify(firstEvent));
  
  logger.info(`${event.area} -> ${firstEvent.area}`);
  if(Utils.isLabArea(event.area) && Utils.isLabArea(firstEvent.area)) {
    logger.info("Still in lab, not processing");
    return;
  } else if(event.area === firstEvent.area) {
    if(event.area === "Azurite Mine") {
      logger.info("Still in delve, not processing");
      return;
    } else if(event.area === "Memory Void") {
      logger.info("Still in memory, not processing");
      return;
    }else if(event.server === firstEvent.server) {
      logger.info(`Still in same area ${event.area}, not processing`);
      return;
    }
  }

  var prevMapStartEvent = await getPrevMapStartEvent();
  logger.info("Prev map start event found:");
  logger.info(JSON.stringify(prevMapStartEvent));
  if(prevMapStartEvent.area === firstEvent.area && prevMapStartEvent.server === firstEvent.server) {
    logger.info(`Previous map run in ${firstEvent.area} was already processed`);
    logger.info(`prevmapstart: ${prevMapStartEvent.area} ${prevMapStartEvent.server}`);
    logger.info(`firstevent: ${firstEvent.area} ${firstEvent.server}`);
    logger.info(`event: ${event.area} ${event.server}`);
    return;
  }
  
  var lastEvent = await getLastTownEvent(event, firstEvent, mode);
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
  }
  
  
  var xp = (XPTracker.isMaxXP() ? Constants.MAX_XP : await getXP(firstEvent.timestamp, lastEvent.timestamp));
  var xpDiff = await getXPDiff(xp);
  var items = await checkItems(areaInfo, firstEvent.timestamp, lastEvent.timestamp);
  var killCount  = await getKillCount(firstEvent.timestamp, lastEvent.timestamp);
  var ignoreMapRun = false;
  
  DB.run("insert into areainfo(id, name) values(?, ?)", [firstEvent.timestamp, firstEvent.area], (err) => {
    if (err) {
      logger.info(`Error manually inserting areainfo (${firstEvent.timestamp} ${firstEvent.area}): ${err}`);
    }        
  });
  
  // if no items picked up, no kills, and no xp gained, log map run but ignore it (profit = -1, kills = -1)
  if(!items.count && !xpDiff && !killCount) {
    items.value = -1;
    killCount = -1;
    ignoreMapRun = true;
    logger.info("No items or xp gained, map run will be logged as invisible");
  }
  
  var runArr = [
    areaInfo.id, 
    firstEvent.timestamp, lastEvent.timestamp, 
    mapStats.iiq || null, mapStats.iir || null, mapStats.packsize || null, 
    items.value, xp, killCount
  ];
  insertMapRun(runArr).then(() => {
    if(!ignoreMapRun) {
      emitter.emit(
        "runProcessed", 
        {
          name: areaInfo.name, id: areaInfo.id, 
          gained: items.value, xp: xpDiff, kills: killCount,
          firstevent: firstEvent.timestamp, lastevent: lastEvent.timestamp
        }
      );
    }
  });
  
  return 1;
  
  function getNextMapEvent(lastUsedEvent) {
    logger.info(`Last used event is ${lastUsedEvent}`);
    return new Promise( (resolve, reject) => {
      DB.all(
        `
          select id, event_text, server from events 
          where event_type='entered' 
          and (event_text <> ifnull((select event_text from events, mapruns where mapruns.lastevent = ? and events.id = mapruns.firstevent), '')
          or server <> ifnull((select server from events, mapruns where mapruns.lastevent = ? and events.id = mapruns.firstevent), ''))
          and id > ?
          order by id
        `, [lastUsedEvent, lastUsedEvent, lastUsedEvent], (err, rows) => {
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
  
  function getLastTownEvent(currEvent, mapEvent, mode) {
    
    var sql;
    switch(mode) {
      case "automatic":
        sql = "select * from events where event_type='entered' and id > ? and id < ? order by id desc";
        break;
      case "manual":
        sql = "select * from events where event_type='entered' and id > ? and id <= ? order by id desc";
        break;
      default:
        logger.info(`Invalid mode for getLastTownEvent: ${mode}`);
        return;
    }
    
    return new Promise( (resolve, reject) => {
      DB.all(sql, [mapEvent.timestamp, currEvent.timestamp], (err, rows) => {
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



async function process() {
  
  DB = require('./DB').getDB();

  var currArea = await getCurrAreaInfo();
  if(!currArea) {
    logger.info("No unprocessed area info found");
    var lastEvent = await new Promise( async (resolve, reject) => {
      DB.get(" select * from events where event_type='entered' order by id desc ", (err, row) => {
        if(err) {
          logger.info(`Error getting last inserted event: ${err}`);
          resolve();
        } else {
          if(!row) {
            logger.info("No last inserted event found!");
            resolve();
          } else {
            resolve({
              timestamp: row.id,
              area: row.event_text,
              server: row.server
            });
          }
        }
      })
    });
    if(lastEvent) {
      logger.info("Will try processing from event: " + JSON.stringify(lastEvent));
      tryProcess({
        event: lastEvent,
        mode: "manual"
      });
    }
    return;
    
  }

  var mods = await getMapMods(currArea.id);
  if(!mods) return;

  logger.info(`Processing run in ${currArea.name}`);
  
  var mapStats = getMapStats(mods);
  
  var lastUsedEvent = await getLastUsedEvent();
  if(!lastUsedEvent) return;
  
  var firstEvent = await getFirstEvent(currArea, lastUsedEvent);
  if(!firstEvent) return;
  
  var lastEvent = await getLastEvent(currArea, firstEvent);
  if(!lastEvent) return;
  
  var xp = (XPTracker.isMaxXP() ? Constants.MAX_XP : await getXP(firstEvent, lastEvent));
  var xpDiff = await getXPDiff(xp);
  var items = await checkItems(currArea, firstEvent, lastEvent);
  var killCount  = await getKillCount(firstEvent, lastEvent);
  var ignoreMapRun = false;
  
  // if no items picked up, no kills, and no xp gained, log map run but ignore it (profit = -1, kills = -1)
  if(!items.count && !xpDiff && !killCount) {
    items.value = -1;
    killCount = -1;
    ignoreMapRun = true;
    logger.info("No items or xp gained, map run will be logged as invisible");
  }
  
  var runArr = [
    currArea.id, 
    firstEvent, lastEvent, 
    mapStats.iiq, mapStats.iir, mapStats.packsize, 
    items.value, xp, killCount
  ];
  insertMapRun(runArr).then(() => {
    if(!ignoreMapRun) {
      emitter.emit(
        "runProcessed", 
        {
          name: currArea.name, id: currArea.id, 
          gained: items.value, xp: xpDiff, kills: killCount,
          firstevent: firstEvent, lastevent: lastEvent
        }
      );
    }
  });
  
  
  return 1;
  
}

async function getKillCount(firstEvent, lastEvent) {
  logger.info(`Kill count between ${firstEvent} and ${lastEvent}`);
  return new Promise((resolve, reject) => {
    var totalKillCount = 0;
    DB.all(`
      select * from incubators where incubators.timestamp = (select max(timestamp) from incubators where timestamp <= ?)
      union all
      select * from incubators where incubators.timestamp between ? and ?
      order by timestamp
    `, [firstEvent, firstEvent, lastEvent], (err, rows) => {
      if (err) {
        logger.info(`Failed to get kill count: ${err}`);
      } else {
        if(rows.length > 1) {
          var incubators = [];
          rows.forEach((row) => {
            incubators.push(JSON.parse(row.data));
          });
          for(var i = 1; i < incubators.length; i++) {
            var prev = incubators[i-1];
            var curr = incubators[i];
            var killCount = 0;
            Object.keys(prev).forEach((key) => {
              if(curr[key] && curr[key].progress - prev[key].progress > killCount) {
                killCount = curr[key].progress - prev[key].progress;
              }
            });
            totalKillCount += killCount;
          }
        }
      }
      logger.info(`Total kill count is ${totalKillCount}`);
      resolve(totalKillCount > 0 ? totalKillCount : null);
    });
  });
}

async function getXP(firstEvent, lastEvent) {
  return new Promise( (resolve, reject) => {
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
  var settings = require('./settings').get();  
  var requestParams = {
    hostname: 'www.pathofexile.com',
    path: `/character-window/get-characters?accountName=${encodeURIComponent(settings.accountName)}`,
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
            }
          });
          if(xp === -1) {
            logger.info('Failed to get xp!');
            resolve(null);
          } else {
            logger.info("Manually retrieved xp: " + xp);
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

async function getLastInventoryTimestamp() {
  return new Promise( (resolve, reject) => {
    DB.get("select timestamp from lastinv", (err, row) => {
      if(err) {
        logger.info(`Error getting timestamp for last inventory: ${err}`);
        resolve(-1);
      } else {
        if(!row) {
          logger.info("No last inventory yet");
          resolve(-1);
        } else {
          resolve(row.timestamp);
        }
      }
    })
  });  
}

async function checkItems(area, firstevent, lastevent) {

  var lastinv;

  while(true) {
    logger.info("Getting inventory timestamp");
    lastinv = await getLastInventoryTimestamp();
    logger.info("Got " + lastinv);
    if(lastinv >= lastevent) {
      break;
    } else {
      logger.info(`Last inventory not yet processed (${lastinv} < ${lastevent}), waiting 3 seconds`);
      await Utils.sleep(3000);
    }
  }
  
  logger.info(`Getting chaos value of items from ${area.id} ${area.name}`);
  var allItems = await getItems(area.id, firstevent, lastevent);
  logger.info(`Total profit is ${allItems.value} in ${allItems.count} items`);
  return allItems;


  
}

function getXPDiff(currentXP) {
  return new Promise( (resolve, reject) => {
    DB.get( " select xp from mapruns order by id desc limit 1 ", (err, row) => {
      if(!err) {
        logger.info(`current xp: ${currentXP}, previous: ${row.xp}`)
        resolve(currentXP - row.xp);
      } else {
        logger.info(`Error getting XP gained: ${err}`);
        resolve(null);
      }
    });
  });
}

function getItems(areaID, firstEvent, lastEvent) {
  return new Promise((resolve, reject) => {
    DB.all(
      " select id, event_text from events where id between ? and ? and event_type = 'entered' order by id ",
      [firstEvent, lastEvent],
      async (err, rows) => {
        if(err) {
          logger.info(`Unable to get item values for ${areaID}: ${err}`);
          resolve(false);
        } else {
          var numItems = 0;
          var totalProfit = 0;
          for(var i = 1; i < rows.length; i++) {
            var prevRow = rows[i - 1];
            if(!Utils.isTown(prevRow.event_text)) {
              var items = await getItemsFor(rows[i].id);
              numItems += items.count;
              totalProfit += Number.parseFloat(items.value);
            }
          }
          totalProfit = Number(totalProfit).toFixed(2);
          resolve({count: numItems, value: totalProfit});
        }
      });
  });
}

function getItemsFor(event) {
  var count = 0;
  var totalValue = 0;
  var itemArr = [];
  return new Promise( (resolve, reject) => {
    DB.all( " select * from items where event_id = ? ", [event], async (err, rows) => {
      if (err) {
        logger.info(`Error getting item values for ${event}: ${err}`);
        resolve(null);
      } else {
        for(var i = 0; i < rows.length; i++) {
          count++;
          var item = rows[i];
          if(item.value) {
            totalValue += item.value;
          } else {
            
            var value = await ItemPricer.price(item);
            if(!value) {
              value = 0;
            }
            
            if(value.isVendor) {
              totalValue += value.val;
              value = 0;
            } else {
              totalValue += value;
            }
            
            itemArr.push([value, item.id, item.event_id]);
            
          }
        }
        if(itemArr.length > 0) {
          updateItemValues(itemArr);
        }
        resolve({count: count, value: totalValue});
      }
    });
  });
}

function updateItemValues(arr) {
  DB.serialize(() => {
    DB.run("begin transaction", (err) => {
      if(err) {
        logger.info(`Error beginning transaction to insert items: ${err}`);
      } else {
        logger.info("Transaction started");
      }
    });
    var stmt = DB.prepare(`update items set value = ? where id = ? and event_id = ?`);
    arr.forEach(item => {
      stmt.run(item, (err) => {
        if(err) {
          logger.error(`Unable to set item value for item ${JSON.stringify(item)}`);
        }
//        } else {
//          logger.info(`Updated item value ${item[0]} for ${item[1]} in event ${item[2]}`);
//        }
      });
    });
    stmt.finalize( (err) => {
      if(err) {
        logger.warn(`Error inserting items for ${event}: ${err}`);
        DB.run("rollback", (err) => {
          if (err) {
            logger.info(`Error rolling back failed item insert: ${err}`);
          }        
        });
      } else {
        DB.run("commit", (err) => {
          if (err) {
            logger.info(`Error committing item insert: ${err}`);
          } else {
            logger.info("Transaction committed");
          }        
        });
      }
    });
  });
}

async function insertMapRun(arr) {
  return new Promise( (resolve, reject) => {
    DB.run(`
      insert into mapruns(id, firstevent, lastevent, iiq, iir, packsize, gained, xp, kills) values (?, ?, ?, ?, ?, ?, ?, ?, ?) 
    `, arr, (err) => {
      if(err) {
        logger.error(`Unable to insert map run ${JSON.stringify(arr)}: ${err}`);
      } else {
        logger.info(`Map run processed successfully: ${JSON.stringify(arr)}`);
      }
      resolve();
    });
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
    DB.get("select * from areainfo where id > (select max(id) from mapruns) order by id desc", (err, row) => {
      if(err) {
        logger.error(`Unable to get last area info: ${err}`);
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

function getPrevMapStartEvent() {
  return new Promise( (resolve, reject) => {
    DB.get("select * from events where id = (select firstevent from mapruns order by id desc limit 1);", (err, row) => {
      if(err) {
        logger.error(`Unable to get previous map start event: ${err}`);
        resolve("");
      } else if(!row) {
        logger.info("No unused event found");
        resolve("");
      } else {
        resolve({
          area: row.event_text,
          server: row.server
        });
      }
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

async function recheckGained(mapID) {
  DB = require('./DB').getDB();  
  return new Promise( (resolve, reject) => {
    DB.get("select id, firstevent, lastevent, gained from mapruns where id = ?", [mapID], async (err, row) => {
      if(row && row.gained !== -1) {
        var allItems = await getItems(row.id, row.firstevent, row.lastevent);
        if(allItems.value - row.gained !== 0) {
          console.log(`update mapruns set gained = ${allItems.value} where id = ${row.id} -- was: ${row.gained}`);
        }
      }
      resolve(null);
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
module.exports.recheckGained = recheckGained;