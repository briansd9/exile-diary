const logger = require("./Log").getLogger(__filename);
const https = require('https');
const moment = require('moment');
const EventEmitter = require('events');

var DB;
var settings;
var emitter = new EventEmitter();

class SkillTreeWatcher {

  constructor() {

    DB = require('./DB').getDB();
    settings = require('./settings').get();

    var league = encodeURIComponent(settings.activeProfile.league);
    var accountName = encodeURIComponent(settings.accountName);
    var characterName = encodeURIComponent(settings.activeProfile.characterName);

    this.queryPath = `/character-window/get-passive-skills?league=${league}&accountName=${accountName}&character=${characterName}`;

    logger.info(`Skill tree watcher started with query path ${this.queryPath}`);

  }

  async checkPassiveTree(timestamp) {
    
    var prevTree = await this.getPrevTree();    
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
              let currTree = JSON.stringify(data.hashes);
              logger.info(`prevtree: ${prevTree}`);
              logger.info(`currtree: ${currTree}`);
              if(currTree !== prevTree) {
                this.insertPassiveTree(timestamp, currTree);
              }
            }
          } catch(err) {
            logger.info(`Failed to get current skill tree: ${err}`);
            resolve({});
          }
        });
        response.on('error', (err) => {
          logger.info(`Failed to get current skill tree: ${err}`);
          resolve({});
        });
      });
      request.on('error', (err) => {
        logger.info(`Failed to get current skill tree: ${err}`);
        resolve({});
      });
      request.end();
    });
  }
  
  getPrevTree() {
    return new Promise((resolve, reject) => {
      DB.get("select timestamp, data from passives order by timestamp desc limit 1", (err, row) => {
        if (err) {
          logger.info(`Failed to get previous passive tree: ${err}`);
          resolve(null);
        }
        if(!row) {
          resolve(null);
        } else {
          resolve(row.data);
        }
      });
    });    
  }
  
  insertPassiveTree(timestamp, data) {
    DB.run(
      "insert into passives(timestamp, data) values(?, ?)", [timestamp, data], (err) => {
        if (err) {
          logger.info(`Unable to insert current passive tree: ${err}`);
        } else {
          logger.info(`Updated current passive tree at ${timestamp} (length: ${data.length})`);
        }
      }
    );
  }  

}

module.exports = SkillTreeWatcher;
module.exports.emitter = emitter;