const EventEmitter = require('events');
const logger = require("./Log").getLogger(__filename);
const moment = require('moment');
const https = require('https');
const Utils = require('./Utils');
const ItemParser = require('./ItemParser');
const ItemPricer = require('./ItemPricer');
const RateGetterV2 = require('./RateGetterV2');

var emitter = new EventEmitter();

class StashGetter {
  
  constructor() {
    if(!StashGetter.instance) {
      logger.info("Starting StashGetter instance");
      StashGetter.instance = this;
    } else {
      logger.info("Returning existing StashGetter instance");
    }
    this.initialize();
    return StashGetter.instance;
  }
  
  initialize() {
    
    this.settings = require('./settings').get();
    if(this.settings) {
      
      this.league = this.settings.activeProfile.league;
      this.DB = require('./DB').getDB(this.settings.activeProfile.characterName);
      this.leagueDB = require('./DB').getLeagueDB(this.league);
      this.offlineStashChecked = false;
      
      // clear any existing scheduled stash check
      clearTimeout(this.nextStashGetTimer);
      
      emitter.removeAllListeners("scheduleNewStashCheck");
      emitter.on("scheduleNewStashCheck", () => {
        clearTimeout(this.nextStashGetTimer);
        // default 5 min between checks
        let interval = 300;
        if(this.settings.netWorthCheck && this.settings.netWorthCheck.interval) {
          interval = this.settings.netWorthCheck.interval;
        }
        if(!this.offlineStashChecked) {
          logger.info(`Next net worth check in ${interval} seconds`);
        }
        this.nextStashGetTimer = setTimeout(() => { this.tryGet(); }, interval * 1000);
      })
      
    }
    
  }
  
  async tryGet() {
    
    if(!this.league) {
      logger.info("No league set (first run?) - returning");
      return;
    }
    
    if(this.settings.netWorthCheck && this.settings.netWorthCheck.enabled === false) {
      logger.info("Net worth checking is disabled ??? - returning");
      return;
    }
    
    let poeActive = (await Utils.poeRunning()) && !(global.afk);
    if(!poeActive) {
      if(this.offlineStashChecked) {
        emitter.emit("scheduleNewStashCheck");
        return;
      } else {
        logger.info("PoE not running or in AFK mode - suspending net worth check temporarily");
        this.offlineStashChecked = true;
      }
    } else {
      this.offlineStashChecked = false;
    }
    
    this.get();
    
  }
    

  async getLastStashAge() {
    return new Promise((resolve, reject) => {
      this.leagueDB.get("select ifnull(max(timestamp), -1) as timestamp from stashes where items <> '{}' ", (err, row) => {
        if(err) {      
          logger.info(`Error getting latest stash: ${err}`);
          resolve(false);
        } else if(row.timestamp === -1) {
          logger.info("No stashes found in db - will retrieve now");
          resolve(Number.MAX_SAFE_INTEGER);
        } else {
          var now = moment();
          var then  = moment(row.timestamp, 'YYYYMMDDHHmmss');
          var diff = moment.duration(now.diff(then)).asHours();
          logger.info(`Last retrieved full stash ${row.timestamp} is ${Number(diff).toFixed(2)} hours old`);
          resolve(diff);
        }
      });
    });
  }  

  async reachedMapLimit(limit) {
    return new Promise((resolve, reject) => {
      this.leagueDB.get("select ifnull(max(timestamp), -1) as timestamp from stashes where items <> '{}' ", (err, row) => {
        if(err) {      
          logger.info(`Error getting latest stash: ${err}`);
          resolve(false);
        }
        if(row.timestamp == -1) {
          logger.info("No stashes found in db - will retrieve now");
          resolve(true);
        } else {
          this.DB.get("select count(1) as count from mapruns where id > ? and json_extract(runinfo, '$.ignored') is null", [row.timestamp], (err, maps) => {
            if(err) {      
              logger.info(`Error getting map count: ${err}`);
              resolve(false);
            }
            logger.info(`${maps.count} map runs since last retrieved full stash (set to retrieve every ${limit})`);
            resolve(maps.count >= limit);
          });
        }
      });
    });
  }
  
  async checkFullStashInterval() {
    
    if(this.settings.stashCheck.enabled === false) {
      return false;
    }
    
    let interval = this.settings.stashCheck.interval;
    let units = this.settings.stashCheck.units;

    switch(units) {
      case "hours":
        let lastStashAge = await this.getLastStashAge();
        return (lastStashAge >= interval);
      case "maps":
        return (await this.reachedMapLimit(interval));
      default:
        logger.info(`Invalid stash check interval: [${interval}] [${units}]`);
        return false;
    }
    
  }

  async get(interval = 10) {

    if(!RateGetterV2.ratesReady) {
      if(interval > 60) {
        logger.info("Maximum retries exceeded, deferring to next stash getting interval");
      } else {
        logger.info(`Price list not yet ready, retrying in ${interval} seconds`);
        setTimeout(() => { this.get(interval + 10); }, interval * 1000);
      }
      return;
    }
    
    var watchedTabs = null;
    if(this.settings.tabs && this.settings.tabs[this.settings.activeProfile.league]) {
      watchedTabs = this.settings.tabs[this.settings.activeProfile.league];
      if(watchedTabs.length === 0) {
        emitter.emit("noStashTabsSelected");
        return;
      }
    } else {
      logger.info("Tabs to monitor not yet set, will retrieve all");
    }
    
    let getFullStash = await this.checkFullStashInterval();
    var timestamp = moment().format("YYYYMMDDHHmmss");  

    var params = {
      league : this.league,
      tabs : watchedTabs,
      accountName : this.settings.accountName,
      poesessid : this.settings.poesessid,
      timestamp: timestamp
    };

    var tabList = await this.getTabList(params);
    if(!tabList) {
      logger.info("Failed to get tab list, will try again later");
      emitter.emit("scheduleNewStashCheck");
      return;
    }

    var tabs = {
      value : 0,
      items : []
    };

    for(var i = 0; i < tabList.length; i++) {
      if(i > 0) {
        // 1.5 sec delay to prevent hitting stash API rate limit (45 in 60 sec)
        await this.timer(1500);
      }
      var t = tabList[i];
      var tabData = await this.getTab(t, params);
      if(tabData === -1) {
        logger.info(`Failed to get data for tab ${t.name}, aborting stash retrieval - will try again later`);
        emitter.emit("scheduleNewStashCheck");
        return;
      }
      if(tabData && tabData.items && tabData.items.length > 0) {
        //logger.info(`${t.type} "${t.name}" in ${this.league} has total value ${Number(tabData.value)}`);
        tabs.value += Number(tabData.value);
        tabs.items = tabs.items.concat(tabData.items);
      }
    };

    if(tabs.items.length > 0) {

      this.leagueDB.get("select value, length(items) as len from stashes order by timestamp desc limit 1", async (err, row) => {
        if(err) {
          logger.info(`Error getting previous ${this.league} stash before ${timestamp}: ${err}`);
          emitter.emit("scheduleNewStashCheck");
        } else {
          if(row && (Number(tabs.value).toFixed(2) === Number(row.value).toFixed(2)) ) {
            logger.info(`No change in ${this.league} stash value (${Number(tabs.value).toFixed(2)}) since last update`);
            emitter.emit("netWorthUpdated");
            emitter.emit("scheduleNewStashCheck");
          } else {          
            let rawdata = (getFullStash ? await Utils.compress(tabs.items) : "{}");
            this.leagueDB.run(" insert into stashes(timestamp, items, value) values(?, ?, ?) ", [timestamp, rawdata, tabs.value], (err) => {
              if(err) {      
                logger.info(`Error inserting ${this.league} stash ${timestamp} with value ${tabs.value}: ${err}`);
                emitter.emit("scheduleNewStashCheck");
              } else {
                logger.info(`Inserted ${this.league} stash ${timestamp} with value ${tabs.value}`);
                this.leagueDB.get(" select value from stashes where timestamp < ? order by timestamp desc limit 1 ", [timestamp], (err, row) => {
                  if(err) {
                    logger.info(`Error getting previous ${this.league} stash before ${timestamp}: ${err}`);
                    emitter.emit("scheduleNewStashCheck");
                  } else {
                    if(getFullStash) {
                      let change = (row && row.value ? Number(tabs.value - row.value).toFixed(2) : "new");
                      emitter.emit("fullStashUpdated", {
                        value: Number(tabs.value).toFixed(2),
                        change: change,
                        league: this.league
                      });
                    } else {
                      emitter.emit("netWorthUpdated");
                    }
                    emitter.emit("scheduleNewStashCheck");
                  }
                });
              }
            });
          }
        }
      });

    } else {
      logger.info(`No items found in ${this.league} stash, returning`);
      emitter.emit("scheduleNewStashCheck");
    }

  }
  
  timer(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  getTabList(s) {

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

  async getTab(t, s) {

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
            var tabData = await this.parseTab(data.items, s.timestamp);
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

  async parseTab(items, timestamp) {

    var totalValue = 0;
    var tabItems = [];

    for(var i = 0; i < items.length; i++) {
      var item = items[i];
      var parsedItem = this.parseItem(item, timestamp);
      var val = await ItemPricer.price(parsedItem, this.league);

      // vendor recipes handled manually
      totalValue += (val.isVendor ? 0 : val);
      tabItems.push(item);
    }

    return {
      value : totalValue.toFixed(2),
      items : tabItems
    };

  }

  parseItem(rawdata, timestamp) {
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

}

module.exports = StashGetter;
module.exports.emitter = emitter;
