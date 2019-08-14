const EventEmitter = require('events');
const logger = require("./Log").getLogger(__filename);
const moment = require('moment');
const https = require('https');
const Utils = require('./Utils');
const RateGetter = require('./RateGetter');

var DB;
var settings;
var emitter = new EventEmitter();

async function tryGet() {

  settings = require('./settings').get();
  DB = require('./DB').getDB();

  DB.get("select max(timestamp) as timestamp from stashes", (err, row) => {
    
    if(err) {      
      logger.info(`Error getting latest stash: ${err}`);
      return;
    }
    
    var now = moment();
    var then  = moment(row.timestamp, 'YYYYMMDDHHmmss');
    var diff = moment.duration(now.diff(then)).asHours();
    // if no interval found in settings, default to once a day
    var interval = settings.stashCheckInterval || 24;

    logger.info(`Last retrieved stash ${row.timestamp} is ${diff} hours old, min interval ${interval} )`);
    
    if(diff < interval) {
      return;
    } else {
      get();
    }
    
  });

}

async function get() {

  settings = require('./settings').get();
  DB = require('./DB').getDB();
  
  var timestamp = moment().format("YYYYMMDDHHmmss");  
  
  rates = await RateGetter.getFor(timestamp);
  if(!rates) {
    return;
  }
  
  var tabs = null;
  if(settings.tabs && settings.tabs[settings.activeProfile.league]) {
    tabs = settings.tabs[settings.activeProfile.league];
  } else {
    logger.info("Tabs to monitor not yet set, will retrieve all");
  }
  
  var params = {
    league : settings.activeProfile.league,
    tabs : tabs,
    accountName : settings.accountName,
    poesessid : settings.poesessid,
    rates : rates
  };
  
  var tabList = await getTabList(params);
  if(!tabList) {
    return;
  }
  
  var tabs = {
    value : 0,
    items : []
  };
  
  for(var i = 0; i < tabList.length; i++) {
    var t = tabList[i];
    logger.info(`Checking tab ${t.name} of type ${t.type}`);
    var tabData = await getTab(t, params);
    if(tabData.items.length > 0) {
      tabs.value += Number(tabData.value);
      tabs.items = tabs.items.concat(tabData.items);
    }
  };
  
  if(tabs.items.length > 0) {
    DB.run(" insert into stashes(timestamp, items, value) values(?, ?, ?) ", [timestamp, JSON.stringify(tabs.items), tabs.value], (err) => {
      if(err) {      
        logger.info(`Error inserting stash ${timestamp} with value ${tabs.value}: ${err}`);
      } else {
        logger.info(`Inserted stash ${timestamp} with value ${tabs.value}`);
        DB.get(" select value from stashes where timestamp < ? order by timestamp desc limit 1 ", [timestamp], (err, row) => {
          if(err) {
            logger.info(`Error getting previous stash before ${timestamp}: ${err}`);
          } else {
            logger.info(`Gained ${tabs.value - row.value} since last check`);
            emitter.emit("netWorthUpdated", {
              value: Number(tabs.value).toFixed(2),
              change: Number(tabs.value - row.value).toFixed(2)
            });
          }
        });
      }
    });
  } else {
    logger.info("No items found, returning");
  }

}

function getTabList(s) {
  
  var requestParams = {
    hostname: 'www.pathofexile.com',
    path: `/character-window/get-stash-items?league=${encodeURIComponent(s.league)}&accountName=${encodeURIComponent(s.accountName)}&tabs=1`,
    method: 'GET',
    headers: {
      Referer: 'https://www.pathofexile.com/',
      Cookie: `POESESSID=${s.poesessid}`
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
  
  var requestParams = {
    hostname: 'www.pathofexile.com',
    path: `/character-window/get-stash-items?league=${encodeURIComponent(s.league)}&accountName=${encodeURIComponent(s.accountName)}&tabIndex=${t.index}`,
    method: 'GET',
    headers: {
      Referer: 'http://www.pathofexile.com/',
      Cookie: `POESESSID=${s.poesessid}`
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
          var tabData = parseTab(data.items, s.rates);
          resolve(tabData);
        } catch(err) {
          logger.info(`Failed to get tab ${t.name}: ${err}`);
          resolve();
        }
      });
      response.on('error', (err) => {
        logger.info(`Failed to get tab ${t.name}: ${err}`);
        resolve();
      });
    });
    request.on('error', (err) => {
      logger.info(`Failed to get tab ${t.name}: ${err}`);
      resolve();
    });
    request.end();
  });
  
}

function parseTab(items, rates) {
  
  var totalValue = 0;
  var tabItems = [];
  
  for(var i = 0; i < items.length; i++) {
    var item = items[i];
    totalValue += Utils.getItemValue(item, rates);
    tabItems.push(item);
  }
  
  return {
    value : totalValue.toFixed(2),
    items : tabItems
  };
  
}

module.exports.tryGet = tryGet;
module.exports.get = get;
module.exports.emitter = emitter;