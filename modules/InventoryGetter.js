const logger = require("./Log").getLogger(__filename);
const https = require('https');
const moment = require('moment');
const XPTracker = require('./XPTracker');
const KillTracker = require('./KillTracker');
const EventEmitter = require('events');

var DB;
var settings;
var emitter = new EventEmitter();

class InventoryGetter extends EventEmitter {

  constructor() {

    super();
    
    DB = require('./DB').getDB();
    settings = require('./settings').get();

    var league = encodeURIComponent(settings.activeProfile.league);
    var accountName = encodeURIComponent(settings.accountName);
    var characterName = encodeURIComponent(settings.activeProfile.characterName);

    this.queryPath = `/character-window/get-items?league=${league}&accountName=${accountName}&character=${characterName}`;

    this.on("xp", XPTracker.logXP);
    this.on("equipment", KillTracker.logKillCount);

    logger.info(`Inventory getter started with query path ${this.queryPath}`);

  }

  /*
   * function name not completely accurate -- does not perform full diff, only gets items added in current inventory
   */
  async getInventoryDiffs(timestamp) {
    return new Promise(async (resolve, reject) => {
      var previnv = await this.getPreviousInventory();
      var currinv = await this.getCurrentInventory(timestamp);
      var diff = await this.compareInventories(previnv, currinv);
      resolve(diff);
    });
  }

  compareInventories(prev, curr) {

    return new Promise((resolve, reject) => {

      //logger.info("Comparing inventories...");

      var prevKeys = Object.keys(prev);
      var currKeys = Object.keys(curr);

      var diff = {};

      currKeys.forEach(key => {
        if (!prevKeys.includes(key)) {
          diff[key] = curr[key];
        } else {
          var elem = this.compareElements(prev[key], curr[key]);
          if (elem) {
            diff[key] = elem;
          }
        }
      });
      
      this.updateLastInventory(curr);
      resolve(diff);

    });

  }

  compareElements(prev, curr) {
    if (prev.stackSize && curr.stackSize && curr.stackSize > prev.stackSize) {
      var obj = Object.assign({}, curr);
      obj.stackSize -= prev.stackSize;
      return obj;
    } else if(prev.name !== curr.name || prev.typeLine !== curr.typeLine) {
      // for items that transform (fated uniques, upgraded breachstones, etc)
      return curr;
    }
    return null;
  }

  getPreviousInventory() {
    return new Promise((resolve, reject) => {
      DB.all("select timestamp, inventory from lastinv order by timestamp desc", (err, rows) => {
        if (err) {
          logger.info(`Failed to get previous inventory: ${err}`);
          resolve({});
        }
        if (rows.length === 0) {
          resolve({});
        } else {
          resolve(JSON.parse(rows[0].inventory));
        }
      });
    });
  }

  getCurrentInventory(timestamp) {

    var ig = this;
    var requestParams = require('./Utils').getRequestParams(this.queryPath, settings.poesessid);
    
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
              resolve({});
            } else {
              var inv = this.getInventory(data);
              ig.emit("xp", timestamp, data.character.experience);
              ig.emit("equipment", timestamp, inv.equippedItems);
              resolve(inv.mainInventory);
            }
          } catch(err) {
            logger.info(`Failed to get current inventory: ${err}`);
            resolve({});
          }
        });
        response.on('error', (err) => {
          logger.info(`Failed to get current inventory: ${err}`);
          resolve({});
        });
      });
      request.on('error', (err) => {
        logger.info(`Failed to get current inventory: ${err}`);
        resolve({});
      });
      request.end();
    });
  }

  updateLastInventory(data) {
    var dataString = JSON.stringify(data);
    DB.serialize(() => {
      DB.run("delete from lastinv", (err) => {
        if (err) {
          logger.info(`Unable to delete last inventory: ${err}`);
        }        
      });
      var timestamp = moment().format('YYYYMMDDHHmmss')
      DB.run(
        "insert into lastinv(timestamp, inventory) values(?, ?)",
        [timestamp, dataString],
        (err) => {
        if (err) {
          logger.info(`Unable to update last inventory: ${err}`);
        } else {
          logger.info(`Updated last inventory at ${timestamp} (length: ${dataString.length})`);
        }
      }
      );
    });
  }

  getInventory(inv) {
    var mainInventory = {};
    var equippedItems = {};
    inv.items.forEach(item => {
      if (item.inventoryId === "MainInventory") {
        mainInventory[item.id] = item;
      } else {
        mainInventory[item.id] = item;
        equippedItems[item.id] = item;
        if(item.socketedItems) {
          for(let i = 0; i < item.socketedItems.length; i++) {
            let socketedItem = item.socketedItems[i];
            mainInventory[socketedItem.id] = socketedItem;
            equippedItems[socketedItem.id] = socketedItem;
          }
        }
      }
    });
    return {
      mainInventory: mainInventory,
      equippedItems: equippedItems
    };
  }

}

module.exports = InventoryGetter;
module.exports.emitter = emitter;