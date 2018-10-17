const logger = require("./Log").getLogger(__filename);
const moment = require('moment');
const https = require('https');
const Utils = require('./Utils');
const RateGetter = require('./RateGetter');

var DB;
var settings;

async function get() {

  settings = require('./settings').get();
  DB = require('./DB').getDB();
  
  var timestamp = moment().format("YYYYMMDD000000");
  
  var hasStash = await checkExistingStash(timestamp);
  if(hasStash) {
    logger.info(`Found existing stash for ${timestamp}`);
    return;
  }
  
  rates = await RateGetter.getFor(timestamp);
  
  var params = {
    league : settings.activeProfile.league,
    accountName : settings.accountName,
    poesessid : settings.poesessid,
    rates : rates
  };
  
  var numTabs = await getNumTabs(params);
  var tabs = {
    value : 0,
    items : []
  };
  
  for(var i = 0; i < numTabs; i++) {
    var tabData = await getTab(i, params);
    if(tabData.items.length > 0) {
      tabs.value += Number(tabData.value);
      tabs.items = tabs.items.concat(tabData.items);
    }
  }
  
  if(tabs.items.length > 0) {
    logger.info(`Total value ${tabs.value} in ${tabs.items.length} items`);
    DB.run(" insert into stashes(timestamp, items, value) values(?, ?, ?) ", [timestamp, JSON.stringify(tabs.items), tabs.value] );
  }

}

function checkExistingStash(timestamp) {
  return new Promise( (resolve, reject) => {
    DB.all("select * from stashes where timestamp = ? limit 1", [timestamp], (err, row) => {
      if(err) {
        logger.info(`Failed to check for existing stash: ${err}`);
        resolve();
      } else {
        resolve(row && row.length > 0);
      }
    })    
  });
}

function getNumTabs(s) {
  
  var requestParams = {
    hostname: 'www.pathofexile.com',
    path: `/character-window/get-stash-items?league=${s.league}&accountName=${s.accountName}`,
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
          logger.info(`${s.accountName} has ${data.numTabs} tabs in ${s.league}`);
          resolve(data.numTabs);
        } catch(err) {
          logger.info(`Failed to get current inventory: ${err}`);
          resolve();
        }
      });
      response.on('error', (err) => {
        logger.info(`Failed to get current inventory: ${err}`);
        resolve();
      });
    });
    request.on('error', (err) => {
      logger.info(`Failed to get current inventory: ${err}`);
      resolve();
    });
    request.end();
  });
}

async function getTab(tabIndex, s) {
  
  var requestParams = {
    hostname: 'www.pathofexile.com',
    path: `/character-window/get-stash-items?league=${s.league}&accountName=${s.accountName}&tabIndex=${tabIndex}`,
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
          logger.info(`Failed to get tab ${tabIndex}: ${err}`);
          resolve();
        }
      });
      response.on('error', (err) => {
        logger.info(`Failed to get tab ${tabIndex}: ${err}`);
        resolve();
      });
    });
    request.on('error', (err) => {
      logger.info(`Failed to get tab ${tabIndex}: ${err}`);
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

module.exports.get = get;