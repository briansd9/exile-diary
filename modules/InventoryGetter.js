const logger = require("./Log").getLogger(__filename);
const DB = require('./DB').getDB();
const https = require('https');
const moment = require('moment');
const XPTracker = require('./XPTracker');
const EventEmitter = require('events');

class InventoryGetter extends EventEmitter {

  constructor() {

    super();

    this.settings = require('./settings').get();

    var league = this.settings.activeProfile.league;
    var accountName = encodeURIComponent(this.settings.accountName);
    var characterName = encodeURIComponent(this.settings.activeProfile.characterName);

    this.queryPath = `/character-window/get-items?league=${league}&accountName=${accountName}&character=${characterName}`;

    this.on("xp", XPTracker.logXP);

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
    var requestParams = {
        hostname: 'www.pathofexile.com',
        path: this.queryPath,
        method: 'GET',
        headers: {
          Referer: 'http://www.pathofexile.com/',
          Cookie: `POESESSID=${this.settings.poesessid}`
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
            ig.emit("xp", timestamp, data.character.experience);
            resolve(this.getMainInventory(data));
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
      DB.run(
        "insert into lastinv(timestamp, inventory) values(?, ?)",
        [moment().format('YYYYMMDDHHmmss'), dataString],
        (err) => {
        if (err) {
          logger.info(`Unable to update last inventory: ${err}`);
        } else {
          //logger.info(`Updated last inventory`);
        }
      }
      );
    });
  }

  getMainInventory(inv) {
    var items = {};
    inv.items.forEach(item => {
      if (item.inventoryId === "MainInventory") {
        items[item.id] = item;
      }
    });
    return items;
  }

}

module.exports = InventoryGetter;