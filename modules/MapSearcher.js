const qs = require("querystring");
const EventEmitter = require('events');
const moment = require('moment');
const momentDurationFormatSetup = require("moment-duration-format");
const logger = require("./Log").getLogger(__filename);
const Utils = require("./Utils");
const ItemPricer = require('./ItemPricer');
const ItemCategoryParser = require('./ItemCategoryParser');

var emitter = new EventEmitter();
var settings;
var DB;

function search(formData) {
  DB = require('./DB').getDB();
  settings = require('./settings').get();
  var data = qs.parse(formData);
  var query = getSQL(data);
  var mapIDs = [];
  logger.info(query.sql);
  logger.info(`Params: ${query.params}`);
  DB.all(query.sql, query.params, (err, rows) => {
    if(err) {
      logger.info(`Error retrieving search results: ${err}`);
      return;
    }
    var totalXP = 0;
    var totalKills = 0;
    logger.info(`${rows.length} rows returned`);
    rows.forEach((row) => {
      totalXP += row.xpgained;
      totalKills += row.kills || 0;
      mapIDs.push(row.id);
    });
    emitter.emit("mapSearchResults", rows);
    if(data.getItems) {
      getStatSummary(totalXP, totalKills, mapIDs);
    } else {
      logger.info("Not getting items");
    }
  });
}

async function getStatSummary(totalXP, totalKills, mapIDs) {
  var totalTime = 0;
  logger.info("Getting items for map summary");
  var allItems = [];
  for(var i = 0; i < mapIDs.length; i++) {
    totalTime += await getTime(mapIDs[i]);
    allItems = allItems.concat(await getItems(mapIDs[i]));
  }
  allItems = mergeItems(allItems);
  logger.info("Done getting items");
  emitter.emit("mapSummaryResults", { numMaps : mapIDs.length, totalXP: totalXP, totalKills: totalKills, totalTime: totalTime, items: allItems });  
}

function mergeItems(arr) {
  var items = {};
  for(var i = 0; i < arr.length; i++) {
    var item = arr[i];
    if(!item.chaosValue) continue;
    if(!item.stackSize) item.stackSize = 1;
    var typeLine = Utils.getBaseName(item);
    var suffix = Utils.getSuffix(item);
    if(item.frameType === 3) {
      typeLine += " " + item.icon;
    }
    if(suffix) {
      typeLine += " " + suffix;
    }
    if(items[typeLine]) {
      items[typeLine].stackSize += item.stackSize;
      items[typeLine].chaosValue += item.chaosValue;
    } else {
      items[typeLine] = item;
    }
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
      if(err) {
        logger.info(`Error getting items: ${err}`);
        resolve(null);
      }
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
    DB.all("select rawdata, stacksize, category, sockets, value from items where event_id = ?", [eventID], async (err, rows) => {
      if(err) {
        logger.info(`Error getting items: ${err}`);
        resolve(null);
      }
      for(var i = 0; i < rows.length; i++) {
        
        var item = JSON.parse(rows[i].rawdata);
        
        if(rows[i].value) {
          item.chaosValue = rows[i].value;
        } else {
          // backward compatibility - value not stored with item in old versions
          item.chaosValue = await getItemValue(eventID, item);
        }
        
        var sockets = rows[i].sockets;
        if(sockets) {
          if(!item.chaosValue) {       
            item.chaosValue = null;
            // check if item has 6 sockets (filter out delve sockets by replacing "DV")
            if(sockets.replace(/[DV\- ]/g, "").length === 6) {
              // check if item has 6 links (links are indicated by a - between sockets)
              if(sockets.replace(/[RGBWDV ]/g, "").length === 5) {
                item.icon = "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyModValues.png?scale=1&scaleIndex=0";
                item.name = "";
                item.w = 1;
                item.h = 1;
                item.stackSize = 1;
                item.frameType = 6;
                item.typeLine = "Divine Orb";
                item.chaosValue = await getCurrencyValue(eventID, item);
                item.typeLine = "6-link Items";
              } else {
                item.icon = "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyRerollSocketNumbers.png?scale=1&scaleIndex=0";
                item.name = "";
                item.w = 1;
                item.h = 1;
                item.stackSize = 7;
                item.frameType = 6;
                item.typeLine = "Jeweller's Orb";
                item.chaosValue = await getCurrencyValue(eventID, item);
                item.stackSize = 1;
                item.typeLine = "6-socket Items";
              }
            } else {
              // item has less than 6 sockets - check if it has RGB links
              var socketGroups = sockets.split(" ");
              for(var j = 0; j < socketGroups.length; j++) {
                var s = socketGroups[j];
                if(s.includes("R") && s.includes("G") && s.includes("B")) {
                  item.icon = "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyRerollSocketColours.png?scale=1&scaleIndex=0";
                  item.name = "";
                  item.w = 1;
                  item.h = 1;
                  item.stackSize = 1;
                  item.frameType = 6;
                  item.typeLine = "Chromatic Orb";
                  item.chaosValue = await getCurrencyValue(eventID, item);
                  item.typeLine = "R-G-B linked Items";
                  break;
                }
              }
            }            
          }          
        }
        
        if(item.chaosValue) items.push(item);
        
      }
      resolve(items);
    });
  });
}

async function getCurrencyValue(timestamp, item) {
  
  var stackSize = item.stackSize || 1;
  var currency = item.typeLine;
  
  return new Promise( (resolve, reject) => {
    DB.get("select value from rates where date <= ? and item = ? order by date desc limit 1", [timestamp, currency], async (err, row) => {
      if(row) {
        resolve(row.value * stackSize);
      } else {
        var currValue = await ItemPricer.getCurrencyByName(timestamp, currency);
        resolve(currValue * stackSize);
      }
    })
  });
  
}

async function getItemValue(timestamp, item) {
  
  var baseName = Utils.getBaseName(item);
  
  // item names requiring special handling
  switch(baseName) {
    case "Chaos Orb":
      return item.stackSize;
      break;
    case "The Beachhead":
      for(var i = 0; i < item.properties.length; i++) {
        var prop = item.properties[i];
        if(prop.name === "Map Tier") {
          baseName = `${baseName} (T${prop.values[0][0]})`;
          break;
        }
      }
      break;
    case "A Master Seeks Help":
      var masters = ["Alva", "Niko", "Einhar", "Jun", "Zana"];
      for(var i = 0; i < masters.length; i++) {
        if(item.prophecyText && item.prophecyText.includes(masters[i])) {
          baseName = `${baseName} (${masters[i]})`;
          break;
        }
      }
      break;
    case "Rebirth":
    case "The Twins":
      baseName = `${baseName} (${item.prophecyText ? "Prophecy" : "Divination Card"})`;
      break;
    default:
      break;
  }
          
  var stackSize = item.stackSize || 1;
  
  return new Promise( (resolve, reject) => {
    DB.get("select value from rates where date <= ? and item = ? order by date desc limit 1", [timestamp, baseName], (err, row) => {
      if(row) {
        resolve(row.value * stackSize);
      } else {
        resolve(null);
      }
    })
  });
  
}

async function getTime(mapID) {
  return new Promise( (resolve, reject) => {
    DB.get("select firstevent, lastevent from mapruns where id = ?", [mapID], (err, row) => {
      if(err) {
        logger.info(`Error getting running time: ${err}`);
        resolve(null);
      }
      var startTime = moment(row.firstevent, "YYYYMMDDHHmmss");
      var endTime = moment(row.lastevent, "YYYYMMDDHHmmss");
      var runningTime = endTime.diff(startTime, "seconds");
      resolve(runningTime);
    });
  });
}

function getSQL(q) {
  
  var str = ` 
    select areainfo.*, mapruns.*,
    (mapruns.xp - (select xp from mapruns m where m.id < mapruns.id and xp is not null order by m.id desc limit 1)) xpgained,
    (select count(1) from events e where e.id between mapruns.firstevent and mapruns.lastevent and e.event_type = 'slain') deaths
    from areainfo, 
  `;
  
  if(q.mapcount) {
    str += ` (select * from mapruns where gained > -1 order by id desc limit ${q.mapcount} ) mapruns `;
  } else {
    str += " (select * from mapruns where gained > -1) mapruns ";
  }
    
  str += " where areainfo.id = mapruns.id and ifnull(mapruns.gained, 0) != -1 and ifnull(mapruns.kills, 0) != -1 ";
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