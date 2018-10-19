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

var areaInfo = null;
var mapMods = null;

async function processPrev(eventType, data) {
  if(eventType === "areaInfo") {
    logger.info("Detected areainfo complete");
    areaInfo = data;
  }
  if(eventType === "mapMods") {
    logger.info("Detected mapmods complete");
    mapMods = data;
  }
  if(areaInfo && mapMods) {
    logger.info("Automatically processing previous run");
    await process();
    areaInfo = null;
    mapMods = null;
  }
}

async function processAll() {
  
  DB = require('./DB').getDB();
  
  DB.each(`
    select areainfo.name, areainfo.id, mapruns.firstevent, mapruns.lastevent 
    from areainfo, mapruns 
    where mapruns.id = areainfo.id and mapruns.gained is null
    limit 25
  `, (err, row) => {
      logger.info(JSON.stringify(row));
      checkProfit( { id : row.id, name: row.name }, row.firstevent, row.lastevent );
    }
  );
    
}

async function process() {
  
  DB = require('./DB').getDB();

  var currArea = await getCurrAreaInfo();
  if(!currArea) return;
  
//  logger.info("Retrieved: " + JSON.stringify(currArea));
//  logger.info("From prev: " + JSON.stringify(areaInfo));
  
  logger.info(`Processing run in ${currArea.name}`);
  
  var mods = await getMapMods(currArea.id)
  
//  logger.info("Retrieved: " + JSON.stringify(mods));
//  logger.info("From prev: " + JSON.stringify(mapMods));
  
  var mapStats = getMapStats(mods);
  
  var lastUsedEvent = await getLastUsedEvent();
  if(!lastUsedEvent) return;
  
  var firstEvent = await getFirstEvent(currArea, lastUsedEvent);
  if(!firstEvent) return;
  
  var lastEvent = await getLastEvent(currArea, firstEvent);
  if(!lastEvent) return;
  
  var xp = await getXP();
  
  var runArr = [currArea.id, firstEvent, lastEvent, mapStats.iiq, mapStats.iir, mapStats.packsize, xp];
  
  insertEvent(runArr);
  checkProfit(currArea, firstEvent, lastEvent);
  
  return 1;
  
}

async function getXP() {
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

async function checkProfit(area, firstEvent, lastEvent) {

  var lastinv = await new Promise( async (resolve, reject) => {
      DB.get("select timestamp from lastinv", (err, row) => {
        if(err) {
          resolve(-1);
        } else {
          resolve(row.timestamp);
        }
      })
    });
  
  if(lastinv < lastEvent) {
    logger.info(`Last inventory not yet processed (${lastinv} < ${lastEvent}), waiting 3 seconds`);
    setTimeout(function() { checkProfit(area, firstEvent, lastEvent) }, 3000);
  } else {
    //logger.info(`Getting chaos value of items from ${area.id} ${area.name}`);
    getItemValues(area, firstEvent, lastEvent).then( (success) => {
      if(success) {
        emitter.emit("runProcessed", {name: area.name, id: area.id});
      }
    });
  }
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
              resolve(true);
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
    DB.get("select * from areainfo where id not in (select id from mapruns) order by id", (err, row) => {
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
      if(err) {
        logger.error(`Unable to get last map mods: ${err}`);
        resolve([]);
      }
      resolve(rows);
    });    
  });
}

function getMapStats(arr) {
  var mapStats = {};
  arr.forEach( (row) => {
    var mod = row.mod;
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
module.exports.processAll = processAll;
module.exports.processPrev = processPrev;
module.exports.emitter = emitter;
