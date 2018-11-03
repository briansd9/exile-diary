const qs = require("querystring");
const EventEmitter = require('events');
const moment = require('moment');
const momentDurationFormatSetup = require("moment-duration-format");
const logger = require("./Log").getLogger(__filename);
const Utils = require("./Utils");

var emitter = new EventEmitter();
var DB;

function search(formData) {
  DB = require('./DB').getDB();
  var data = qs.parse(formData);
  var query = getSQL(data);
  var mapIDs = [];
  logger.info(query.sql);
  logger.info(`Params: ${query.params}`);
  DB.all(query.sql, query.params, (err, rows) => {
    logger.info(`${rows.length} rows returned`);
    rows.forEach(row => mapIDs.push(row.id));
    emitter.emit("mapSearchResults", rows);
    getStatSummary(mapIDs);
  });
}

async function getStatSummary(mapIDs) {
  var totalXP = 0;
  var totalTime = 0;
  var allItems = [];
  for(var i = 0; i < mapIDs.length; i++) {
    totalXP += await getXP(mapIDs[i]);
    totalTime += await getTime(mapIDs[i]);
    allItems = allItems.concat(await getItems(mapIDs[i]));
  }
  allItems = mergeItems(allItems);
  emitter.emit("mapSummaryResults", { numMaps : mapIDs.length, totalXP: totalXP, totalTime: totalTime, items: allItems });  
}

function mergeItems(arr) {
  var items = {};
  for(var i = 0; i < arr.length; i++) {
    var item = arr[i];
    if(!item.chaosValue) continue;
    if(!item.stackSize) item.stackSize = 1;
    var typeLine = Utils.getBaseName(item);
    if(items[typeLine]) {
      items[typeLine].stackSize += item.stackSize;
      items[typeLine].chaosValue += item.chaosValue;
    } else {
      items[typeLine] = item;
    }
      //logger.info(`${item.typeLine} ${stackableItems[item.typeLine].stackSize} -> ${stackableItems[item.typeLine].chaosValue}`);
  }
  return Object.values(items);
}

async function getItems(mapID) {
  var items = [];
  return new Promise( (resolve, reject) => {
    DB.all(`
      select e.id, e.event_text
      from mapruns m, events e 
      where m.id = ? and e.id between m.firstevent and m.lastevent and e.event_type='entered'
    `, [mapID], async (err, rows) => {
      for(var i = 1; i < rows.length; i++) {
        if(!Utils.isTown(rows[i-1].event_text)) {
          items = items.concat(await getItemsFromEvent(rows[i].id));
        }
      }
      resolve(items);
    });
  });
}

async function getItemsFromEvent(eventID) {
  var items = [];
  return new Promise( (resolve, reject) => {
    DB.all("select rawdata from items where event_id = ?", [eventID], async (err, rows) => {
      for(var i = 0; i < rows.length; i++) {
        var item = JSON.parse(rows[i].rawdata);
        var sockets = Utils.getSockets(item);
        if(sockets) {
          if(sockets.replace(/[DV\- ]/g, "").length === 6) {
            if(sockets.replace(/[RGBWDV ]/g, "").length === 5) {
              item.icon = "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyModValues.png?scale=1&scaleIndex=0";
              item.name = "";
              item.w = 1;
              item.h = 1;
              item.stackSize = 1;
              item.typeLine = "Divine Orb";
              item.chaosValue = await getItemValue(eventID, item);
              item.typeLine = "6-link items";
            } else {
              item.icon = "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyRerollSocketNumbers.png?scale=1&scaleIndex=0";
              item.name = "";
              item.w = 1;
              item.h = 1;
              item.stackSize = 7;
              item.typeLine = "Jeweller's Orb";
              item.chaosValue = await getItemValue(eventID, item);
              item.stackSize = 1;
              item.typeLine = "6-socket items";
            }
            items.push(item);
          } else {
            item.chaosValue = await getItemValue(eventID, item);
            items.push(item);
          }
        } else {
          item.chaosValue = await getItemValue(eventID, item);
          items.push(item);
        }
      }
      resolve(items);
    });
  });
}

async function getItemValue(timestamp, item) {
  
  var baseName = Utils.getBaseName(item);
  if(baseName === "Chaos Orb") return item.stackSize;
  
  var stackSize = item.stackSize || 1;
  
  return new Promise( (resolve, reject) => {
    DB.get("select value from rates where date <= ? and item = ? order by date desc limit 1", [timestamp, baseName], (err, row) => {
      if(row) {
        //logger.info(`${timestamp} : ${baseName} x ${stackSize} = ${row.value * stackSize}`);
        resolve(row.value * stackSize);
      } else {
        resolve(null);
      }
    })
  });
  
}

async function getXP(mapID) {
  return new Promise( (resolve, reject) => {
    DB.all("select id, xp from mapruns where id <= ? order by id desc limit 2", [mapID], (err, rows) => {
      //logger.info(`XP earned for ${mapID} is ${rows[0].xp - rows[1].xp}`);
      resolve(rows[0].xp - rows[1].xp);
    })
  });
}

async function getTime(mapID) {
  return new Promise( (resolve, reject) => {
    DB.get("select firstevent, lastevent from mapruns where id = ?", [mapID], (err, row) => {
      var startTime = moment(row.firstevent, "YYYYMMDDHHmmss");
      var endTime = moment(row.lastevent, "YYYYMMDDHHmmss");
      var runningTime = endTime.diff(startTime, "seconds");
      //logger.info(`${startTime} ${endTime} ${runningTime}`);
      resolve(runningTime);
    })
  });
}


function convertNumeric(data) {
  var keys = Object.keys(data);
  keys.forEach(key => {
    if(key === "mapname" || key === "levelmode") return;
    if(data[key]) data[key] = Number(data[key]);
  });
}

function getSQL(q) {
  
  var str = ` 
    select areainfo.*, mapruns.*,
    (select count(1) from events e where e.id between mapruns.firstevent and mapruns.lastevent and e.event_type = 'slain') deaths
    from areainfo,
  `;
  
  if(q.mapcount) {
    str += ` (select * from mapruns order by id desc limit ${q.mapcount} ) mapruns `
  } else {
    str += " mapruns ";
  }
    
  str += " where areainfo.id = mapruns.id ";
  var params = [];
  
  if(q.mapname) {
    str += " and name like ? ";
    params.push(`%${q.mapname}%`);
  }

  if(q.iiqmin && q.iiqmax) {
    str += " and iiq between ? and ? ";
    params.push(q.iiqmin, q.iiqmax);
  } else if(q.iiqmin) {
    str += " and iiq >= ? ";
    params.push(q.iiqmin);
  } else if(q.iiqmax) {
    str += " and iiq <= ? ";
    params.push(q.iiqmax);
  }
  
  if(q.iirmin && q.iirmax) {
    str += " and iir between ? and ? ";
    params.push(q.iirmin, q.iirmax);
  } else if(q.iirmin) {
    str += " and iir >= ? ";
    params.push(q.iirmin);
  } else if(q.iirmax) {
    str += " and iir <= ? ";
    params.push(q.iirmax);
  }
  
  if(q.packsizemin && q.packsizemax) {
    str += " and packsize between ? and ? ";
    params.push(q.packsizemin, q.packsizemax);
  } else if(q.packsizemin) {
    str += " and packsize >= ? ";
    params.push(q.packsizemin);
  } else if(q.packsizemax) {
    str += " and packsize <= ? ";
    params.push(q.packsizemax);
  }
  
  if(q.playerlevelmin && q.playerlevelmax) {
    if(q.playerlevelmin === q.playerlevelmax) {
      q.playerlevelmax++;
    }
    str += ` and (
      firstevent between
        (select id from events where event_type = 'level' and event_text = ?) 
        and (select id from events where event_type = 'level' and event_text = ?)
      or lastevent between
        (select id from events where event_type = 'level' and event_text = ?) 
        and (select id from events where event_type = 'level' and event_text = ?)
    )`;
    params.push(q.playerlevelmin, q.playerlevelmax, q.playerlevelmin, q.playerlevelmax);
  } else if(q.playerlevelmin) {
    str += " and lastevent > (select id from events where event_type = 'level' and event_text = ?) ";
    params.push(q.playerlevelmin);
  } else if(q.playerlevelmax) {
    str += " and firstevent < (select id from events where event_type = 'level' and event_text = ?) ";
    params.push(q.playerlevelmax);
  }
  
  
  if(q.profitmin && q.profitmax) {
    str += " and gained between ? and ? ";
    params.push(q.profitmin, q.profitmax);
  } else if(q.profitmin) {
    str += " and gained >= ? ";
    params.push(q.profitmin);
  } else if(q.profitmax) {
    str += " and gained <= ? ";
    params.push(q.profitmax);
  }
  
  if(q.levelmode === "delveDepth") {
    if(q.levelmin && q.levelmax) {
      str += " and depth between ? and ? ";
      params.push(q.levelmin, q.levelmax);
    } else if(q.levelmin) {
      str += " and depth >= ? ";
      params.push(q.levelmin);
    } else if(q.levelmax) {
      str += " and depth <= ? ";
      params.push(q.levelmax);
    }    
  } else {
    if(q.levelmode === "mapTier") {
      if(q.levelmin) q.levelmin = Number(q.levelmin) + 67;      
      if(q.levelmax) q.levelmax = Number(q.levelmax) + 67;
    }
    if(q.levelmin && q.levelmax) {
      str += " and level between ? and ? ";
      params.push(q.levelmin, q.levelmax);
    } else if(q.levelmin) {
      str += " and level >= ? ";
      params.push(q.levelmin);
    } else if(q.levelmax) {
      str += " and level <= ? ";
      params.push(q.levelmax);
    }
    if( q.levelmode === "mapTier" && (q.levelmin || q.levelmax) ) {
      str += " and depth is null ";
    }
  }
  
  if(q.deathsmin || q.deathsmax) {
    str += `
      and exists( select 1 from (
        select mr.id, ifnull(x.deaths, 0) as deaths 
        from mapruns mr left join 
        (
          select m.id, count(1) as deaths 
          from mapruns m join events e on (e.id between m.firstevent and m.lastevent)
          where e.event_type = 'slain' 
          group by m.id
        ) x 
        on mr.id = x.id
       ) runs
    `;
    if(q.deathsmin && q.deathsmax) {
      str += " where cast(deaths as integer) between ? and ? ";
      params.push(q.deathsmin, q.deathsmax);
    }
    else if (q.deathsmin) {
      str += " where cast(deaths as integer) >= ? ";
      params.push(q.deathsmin);
    }
    else if(q.deathsmax) {
      str += " where cast(deaths as integer) <= ? ";
      params.push(q.deathsmax);
    }
    str += " and runs.id = mapruns.id )";
  }
  
  return {
    sql : str,
    params : params
  };
  
}

module.exports.search = search;
module.exports.emitter = emitter;