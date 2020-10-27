const logger = require('./Log').getLogger(__filename);
const Constants = require('./Constants');
const EventEmitter = require('events');
const Parser = require('./FilterParser');
const ClientTxtWatcher = require('./ClientTxtWatcher');
const Utils = require('./Utils');

class MapRun extends EventEmitter {

  constructor(mapID, char) {
    super();
    this.init(mapID, char);
  }

  async init(mapID, char) {
    this.id = mapID;
    this.DB = require('./DB').getDB(char);
    this.parser = await Parser.get(mapID, char);
    this.nav = {
      prev : await this.getPrevMap(mapID),
      next : await this.getNextMap(mapID),
    }
    this.info = await this.getInfo(mapID);
    this.mods = await this.getMods(mapID);
    this.events = await this.getEvents(mapID);
    this.items = await this.getItems(mapID);
    this.league = await this.getLeague(mapID);
    
    if(this.info.level) {
      this.parser.setAreaLevel(this.info.level);
    }
    
    this.emit("MapRunReady", mapID);
  }

  async getPrevMap(mapID) {
    return new Promise((resolve, reject) => {
      this.DB.get("select id from mapruns where id < ? and ifnull(gained, 0) != -1 and ifnull(kills, 0) != -1 order by id desc limit 1", [mapID], (err, row) => {
        if (err) {
          logger.error(`Unable to get previous map: ${err}`);
          resolve(null);
        } else {
          resolve (row && row.id !== -1 ? row.id : null);
        }
      });
    });
  }

  async getNextMap(mapID) {
    return new Promise((resolve, reject) => {
      this.DB.get("select id from mapruns where id > ? and ifnull(gained, 0) != -1 and ifnull(kills, 0) != -1 order by id limit 1", [mapID], (err, row) => {
        if (err) {
          logger.error(`Unable to get next map: ${err}`);
          resolve(null);
        } else {
          resolve (row && row.id !== -1 ? row.id : null);
        }
      });
    });
  }

  async getInfo(mapID) {
    return new Promise((resolve, reject) => {
      this.DB.get(`
        select name, level, depth, iiq, iir, packsize, xp, kills, runinfo,
        (select xp from mapruns m where m.id < mapruns.id and xp is not null order by m.id desc limit 1) prevxp
        from areainfo, mapruns where mapruns.id = ? and areainfo.id = ?
      `, [mapID, mapID], (err, row) => {
        if (err) {
          logger.error(`Unable to get map info: ${err}`);
          resolve(null);
        } else {
          let info = {
            name: row.name,
            level: row.level,
            depth: row.depth,
            iiq: row.iiq,
            iir: row.iir,
            packsize: row.packsize,
            xp: row.xp,
            prevxp: row.prevxp,
            kills: row.kills
          };
          Object.assign(info, JSON.parse(row.runinfo));
          resolve(info);
        }
      });
    });
  }

  async getMods(mapID) {
    return new Promise((resolve, reject) => {
      var arr = [];
      this.DB.all("select mod from mapmods where area_id = ? order by cast(id as integer)", [mapID], (err, rows) => {
        if (err) {
          logger.error(`Unable to get next map: ${err}`);
          resolve(null);
        } else {
          rows.forEach(row => arr.push(row.mod));
          resolve(arr);
        }
      });
    });
  }

  async getEvents(mapID) {
    return new Promise((resolve, reject) => {
      var events = [];
      this.DB.all(`
              select events.* from mapruns, events 
              where mapruns.id = ?
              and events.id between mapruns.firstevent and mapruns.lastevent 
              order by events.id;
            `, [mapID], (err, rows) => {
        if (err) {
          logger.info(`Failed to get run events: ${err}`);
        } else {
          rows.forEach(row => {
            if(row.event_type !== "chat") {
              events.push({
                id: row.id,
                event_type: row.event_type,
                event_text: row.event_text
              });
            }
          });
          resolve(events);
        }
      });
    });
  }

  async getItems(mapID) {
    return new Promise((resolve, reject) => {
      var items = {};
      this.DB.all(`
              select events.id, items.rarity, items.icon, items.value, items.stacksize, items.rawdata from mapruns, events, items
              where mapruns.id = ?
              and events.id between mapruns.firstevent and mapruns.lastevent
              and items.event_id = events.id;
            `, [mapID], async (err, rows) => {
        if (err) {
          logger.info(`Failed to get run events: ${err}`);
          resolve(null);
        } else {
          for(var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var data = JSON.parse(row.rawdata);
            if(!items[row.id]) {
              items[row.id] = [];
            }
            var secretName = "";
            if(row.rarity === "Unique") {
              secretName = Utils.getItemName(row.icon);
              if(secretName) {
                if(secretName === "Starforge" && data.elder) {
                  secretName = "Voidforge";
                }
              }
            }
            if(secretName || row.value || row.stacksize) {
              if(secretName) data.secretName = secretName;
              if(row.value) data.value = row.value;
              if(row.stacksize) data.pickupStackSize = row.stacksize;
              items[row.id].push(JSON.stringify(data));
            } else {
              items[row.id].push(row.rawdata);
            }

          }
          resolve(items);
        }
      });
    });
  }

  async getLeague(mapID) {
    return new Promise((resolve, reject) => {
      this.DB.get(`select league from leagues where timestamp < ? order by timestamp desc limit 1`, [mapID], async (err, row) => {
        if (err) {
          logger.info(`Failed to get league: ${err}`);
          resolve(null);
        } else {
          resolve(row.league);
        }
      });
    });
  }

}

module.exports = MapRun;