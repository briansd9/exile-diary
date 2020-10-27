const EventEmitter = require('events');
const logger = require("./Log").getLogger(__filename);
const moment = require('moment');
const https = require('https');
const Utils = require('./Utils');
const ItemParser = require('./ItemParser');
const ItemPricer = require('./ItemPricer');

var DB;
var leagueDB;
var settings;
var nextStashGetTimer;
var emitter = new EventEmitter();

async function tryGet() {

  settings = require('./settings').get();
  DB = require('./DB').getDB();
  leagueDB = require('./DB').getLeagueDB();

  var interval, units;
  try {
    interval = settings.stashCheck.interval;
    units = settings.stashCheck.units;
  } catch(e) {
    interval = 24;
    units = "hours";
  }

  switch(units) {
    case "hours":
      tryGetByTime();
      break;
    case "maps":
      tryGetByMapRuns();
      break;
    default:
      logger.info(`Invalid stash check interval: [${interval}] [${units}]`);
      return;
  }
  
  async function tryGetByMapRuns() {
    let shouldGet = await reachedMapLimit(interval);
    if(shouldGet) {
      get();
    }
  }

  async function tryGetByTime() {
    clearTimeout(nextStashGetTimer);
    let lastStashAge = await getLastStashAge();
    if(lastStashAge >= interval) {
      get();
      nextStashGetTimer = setTimeout(() => { tryGet(); }, interval * 60 * 60 * 1000);
      logger.info(`Set new timer for getting stash in ${Number(interval * 60 * 60).toFixed(2)} sec`);
    }
    else {
      nextStashGetTimer = setTimeout(() => { tryGet(); }, (interval - lastStashAge) * 60 * 60 * 1000);
      logger.info(`Set new timer for getting stash in ${Number((interval - lastStashAge) * 60 * 60).toFixed(2)} sec`);
    }    
  }
  
}

function getLastStashAge() {
  return new Promise((resolve, reject) => {
    leagueDB.get("select ifnull(max(timestamp), -1) as timestamp from stashes", (err, row) => {
      if(err) {      
        logger.info(`Error getting latest stash: ${err}`);
        resolve(false);
      } else if(row.timestamp === -1) {
        logger.info("No stashes found in db - will retrieve now");
        resolve(true);
      } else {
        var now = moment();
        var then  = moment(row.timestamp, 'YYYYMMDDHHmmss');
        var diff = moment.duration(now.diff(then)).asHours();
        logger.info(`Last retrieved stash ${row.timestamp} is ${Number(diff).toFixed(2)} hours old`);
        resolve(diff);
      }
    });
  });
}

function reachedMapLimit(limit) {
  return new Promise((resolve, reject) => {
    leagueDB.get("select ifnull(max(timestamp), -1) as timestamp from stashes", (err, row) => {
      if(err) {      
        logger.info(`Error getting latest stash: ${err}`);
        resolve(false);
      }
      if(row.timestamp == -1) {
        logger.info("No stashes found in db - will retrieve now");
        resolve(true);
      } else {
        DB.get("select count(1) as count from mapruns where id > ? and ifnull(gained, 0) != -1 and ifnull(kills, 0) != -1", [row.timestamp], (err, maps) => {
          if(err) {      
            logger.info(`Error getting map count: ${err}`);
            resolve(false);
          }
          logger.info(`${maps.count} map runs since last retrieved stash (set to retrieve every ${limit})`);
          resolve(maps.count >= limit);
        });
      }
    });
  });
}

async function get() {

  settings = require('./settings').get();
  leagueDB = require('./DB').getLeagueDB();
  
  var timestamp = moment().format("YYYYMMDDHHmmss");  
  
  var watchedTabs = null;
  if(settings.tabs && settings.tabs[settings.activeProfile.league]) {
    watchedTabs = settings.tabs[settings.activeProfile.league];
  } else {
    logger.info("Tabs to monitor not yet set, will retrieve all");
  }
  
  var params = {
    league : settings.activeProfile.league,
    tabs : watchedTabs,
    accountName : settings.accountName,
    poesessid : settings.poesessid,
    timestamp: timestamp
  };
  
  var tabList = await getTabList(params);
  if(!tabList) {
    logger.info("Failed to get tab list, will try again later");
    return;
  }
  
  var tabs = {
    value : 0,
    items : []
  };
  
  for(var i = 0; i < tabList.length; i++) {
    if(i > 0) {
      // 1.5 sec delay to prevent hitting stash API rate limit (45 in 60 sec)
      await timer(1500);
    }
    var t = tabList[i];
    logger.info(`Checking tab ${t.name} of type ${t.type}`);
    var tabData = await getTab(t, params);
    if(tabData === -1) {
      logger.info(`Failed to get data for tab ${t.name}, aborting stash retrieval - will try again later`);
      return;
    }
    if(tabData && tabData.items && tabData.items.length > 0) {
      tabs.value += Number(tabData.value);
      tabs.items = tabs.items.concat(tabData.items);
    }
  };
  
  if(tabs.items.length > 0) {
    
    var rawdata = await Utils.compress(tabs.items);
    
    leagueDB.get("select value, length(items) as len from stashes order by timestamp desc limit 1", (err, row) => {
      if(err) {
        logger.info(`Error getting previous stash before ${timestamp}: ${err}`);
      } else {
        if(row && (Number(tabs.value).toFixed(2) === Number(row.value).toFixed(2)) ) {
          logger.info(`No change in stash value (${Number(tabs.value).toFixed(2)}) since last update`);
        } else {          
          leagueDB.run(" insert into stashes(timestamp, items, value) values(?, ?, ?) ", [timestamp, rawdata, tabs.value], (err) => {
            if(err) {      
              logger.info(`Error inserting stash ${timestamp} with value ${tabs.value}: ${err}`);
            } else {
              logger.info(`Inserted stash ${timestamp} with value ${tabs.value}`);
              leagueDB.get(" select value from stashes where timestamp < ? order by timestamp desc limit 1 ", [timestamp], (err, row) => {
                if(err) {
                  logger.info(`Error getting previous stash before ${timestamp}: ${err}`);
                } else {
                  if(row && row.value) {
                    emitter.emit("netWorthUpdated", {
                      value: Number(tabs.value).toFixed(2),
                      change: Number(tabs.value - row.value).toFixed(2)
                    });
                  } else {
                    emitter.emit("netWorthUpdated", {
                      value: Number(tabs.value).toFixed(2),
                      change: "new"
                    });
                  }
                }
              });
            }
          });
        }
      }
    });
    
  } else {
    logger.info("No items found, returning");
  }

}

function timer(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function getTabList(s) {
  
  var path = `/character-window/get-stash-items?league=${encodeURIComponent(s.league)}&accountName=${encodeURIComponent(s.accountName)}&tabs=1`;
  var requestParams = Utils.getRequestParams(path, s.poesessid);
  
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
          if(data.error && data.error.message === "Forbidden") {
            emitter.emit("invalidSessionID");
            resolve();
          } else if(data.tabs) {
            var tabList = [];
            data.tabs.forEach(tab => {
              // if tabs to watch not yet set, default to previous behavior (get all tabs)
              if( s.tabs === null || s.tabs.includes(tab.id)) {
                tabList.push({ index: tab.i, name: tab.n, type: tab.type });
              }
            });
            logger.info(`Retrieving tabs for ${s.accountName} in ${s.league}`);
            resolve(tabList);
          } else {
            logger.info(`Error getting tabs; data follows: ${body}`);
            resolve();
          }
        } catch(err) {
          logger.info(`Failed to get tabs: ${err}`);
          resolve();
        }
      });
      response.on('error', (err) => {
        logger.info(`Failed to get number of tabs: ${err}`);
        resolve();
      });
    });
    request.on('error', (err) => {
      logger.info(`Failed to get number of tabs: ${err}`);
      resolve();
    });
    request.end();
  });
}

async function getTab(t, s) {
  
  var path = `/character-window/get-stash-items?league=${encodeURIComponent(s.league)}&accountName=${encodeURIComponent(s.accountName)}&tabIndex=${t.index}`;
  var requestParams = Utils.getRequestParams(path, s.poesessid);

  return new Promise((resolve, reject) => {
    var request = https.request(requestParams, (response) => {
      var body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', async () => {
        try {
          var data = JSON.parse(body);
          var tabData = await parseTab(data.items, s.timestamp);
          resolve(tabData);
        } catch(err) {
          logger.info(`Failed to get tab ${t.name}: ${err}`);
          resolve(-1);
        }
      });
      response.on('error', (err) => {
        logger.info(`Failed to get tab ${t.name}: ${err}`);
        resolve(-1);
      });
    });
    request.on('error', (err) => {
      logger.info(`Failed to get tab ${t.name}: ${err}`);
      resolve(-1);
    });
    request.end();
  });
  
}

async function parseTab(items, timestamp) {
  
  var totalValue = 0;
  var tabItems = [];
  
  for(var i = 0; i < items.length; i++) {
    var item = items[i];
    var parsedItem = parseItem(item, timestamp);
    var val = await ItemPricer.price(parsedItem);
    
    // vendor recipes handled manually
    totalValue += (val.isVendor ? 0 : val);
    
    tabItems.push(item);
  }
  
  return {
    value : totalValue.toFixed(2),
    items : tabItems
  };
  
}

function parseItem(rawdata, timestamp) {
  var arr = ItemParser.parseItem(rawdata);
  return {
    id : arr[0],
    event_id: timestamp,
    icon: arr[2], 
    name: arr[3],
    rarity: arr[4],
    category: arr[5],
    identified: arr[6],
    typeline: arr[7],
    sockets: arr[8],
    stacksize: arr[9],
    rawdata: arr[10]
  };
}

module.exports.tryGet = tryGet;
module.exports.get = get;
module.exports.emitter = emitter;
module.exports.nextStashGetTimer = nextStashGetTimer;