const sqlite3 = require('sqlite3');
const path = require('path');
const logger = require("./Log").getLogger(__filename);
const Utils = require("./Utils");

class DB {
  
  static getDB(char) {
    if(!char) {
      var settings = require('./settings').get();
      if(!settings) {
        logger.info("No settings file found, can't get DB");
        return null;
      }
      if (!settings.activeProfile || !settings.activeProfile.characterName) {
        logger.info("No active profile selected, can't get DB");
        return null;
      }
      char = settings.activeProfile.characterName;
    }
    var app = require('electron').app || require('electron').remote.app;
    var db = new sqlite3.cached.Database(path.join(app.getPath("userData"), `${char}.db`));
    return db;
  }
  
  static getLeagueDB(league) {
    if(!league) {
      var settings = require('./settings').get();
      if(!settings || !settings.activeProfile || !settings.activeProfile.league) {
        logger.info("Unable to get league DB");
        return null;
      } else {
        league = settings.activeProfile.league;
      }
    }
    var app = require('electron').app || require('electron').remote.app;    
    var db = new sqlite3.cached.Database(path.join(app.getPath("userData"), `${league}.leaguedb`));
    return db;
  }
  
  static async initDB(char) {
    if(!char) {
      var settings = require('./settings').get();
      if(!settings) {
        logger.info("No settings file found, can't initialize DB");
        return null;
      }
      if (!settings.activeProfile || !settings.activeProfile.characterName) {
        logger.info("No active profile selected, can't initialize DB");
        return null;
      }
      char = settings.activeProfile.characterName;
    }
    var app = require('electron').app || require('electron').remote.app;    
    var db = new sqlite3.cached.Database(path.join(app.getPath("userData"), `${char}.db`));    
    await this.init(db, initSQL, maintSQL);
    logger.info(`Completed initializing db for ${char}`);
    // allow time for DB file changes to be written
    await Utils.sleep(500);
    return db;
  }
  
  static async initLeagueDB(league, char) {    
    var settings = require('./settings').get();
    if(!league) {
      if(!settings || !settings.activeProfile || !settings.activeProfile.league) {
        logger.info("Unable to get league DB");
        return null;
      } else {
        league = settings.activeProfile.league;
      }
    }
    var app = require('electron').app || require('electron').remote.app;    
    var db = new sqlite3.cached.Database(path.join(app.getPath("userData"), `${league}.leaguedb`));
    await this.init(db, leagueInitSQL);
    await Utils.sleep(250);
    
    if(!char) {
      await this.addCharacter(db, settings.activeProfile.characterName);
      await Utils.sleep(250);
    }
    
    return db;
  }
  
  static async addCharacter(db, char) {
    return new Promise( (resolve, reject) => {
      db.run(" insert into characters values (?) ", [char], (err) => {
        if(err) {
          if(!err.message.includes("UNIQUE constraint failed")) {
            logger.info(`Error adding character ${char} to league db: ${err.message}`);
          }
        } else {
          logger.info(`Character ${char} added to league db`);
        }
        resolve(1);
      });
    });
  }
  

  static async init(db, sqlList, maintSqlList) {
    logger.info("Initializing " + path.basename(db.filename));
    return new Promise((resolve, reject) => {
      db.get("pragma user_version", (err, row) => {
        if(err) {
          logger.info("Error reading database version: " + err);
          reject(err);
        } else {
          let ver = row.user_version;
          logger.info(`Database version is ${ver}`);
          db.serialize(() => {
            for(let i = 0; i < sqlList.length; i++) {
              if(ver === 0 || i > ver) {
                logger.info(`Running initialization SQL for version ${i}`);
                for(let j = 0; j < sqlList[i].length; j++) {
                  let sql = sqlList[i][j];
                  logger.info(sql);
                  db.run(sql, (err) => {
                    if(err) {
                      if(!err.toString().includes("duplicate column name")) {
                        logger.info(`Error initializing DB: ${err}`);
                        reject(err);
                      }
                    }
                  });
                }
              }
            }
            if(maintSqlList) {
              for(let i = 0; i < maintSqlList.length; i++) {
                db.run(maintSqlList[i], (err) => {
                  if(err) {
                    logger.info(`Error running DB maintenance: ${err}`);
                    reject(err);
                  }
                });
              }
              logger.info("DB maintenance complete");
            }
            resolve();
          });
        }
      });
    });
  }
  
}

const initSQL = [
  
  // version 0 - db initialize
  [
    `
      create table if not exists areainfo (
        id text primary key not null,
        name text not null,
        level number,
        depth number
      )
    `,
    `
      create table if not exists mapmods (
        area_id text not null,
        id text not null,
        mod text not null,
        primary key (area_id, id)
      )
    `,
    `
      create table if not exists events (
        id text not null,
        event_type text not null,
        event_text text,
        server text,
        primary key (id, event_type, event_text)
      )
    `,
    `
      create table if not exists items (
        event_id text not null, 
        id text not null,
        icon text not null,
        name text,
        rarity text not null,
        category text not null,
        identified number not null,
        typeline text not null,
        sockets text,
        stacksize number,
        rawdata text,
        primary key (event_id, id)
      )
    `,
    `
      create table if not exists lastinv (
        timestamp text not null,
        inventory text not null
      )
    `,
    `
      create table if not exists xp (
        timestamp text primary key not null,
        xp number not null
      )
    `,  
    `
      create table if not exists mapruns (
        id text primary key not null,
        firstevent text unique not null,
        lastevent text unique not null,
        iiq number,
        iir number,
        packsize number,
        gained number,
        xp number
      )
    `,
    `
      create table if not exists filters (
        timestamp text primary key not null,
        text text
      )
    `,
    `
      create table if not exists leagues (
        timestamp text not null,
        league text primary key not null
      )
    `,
    `
      create table if not exists incubators ( 
        timestamp text primary key not null,
        data text not null
      )
    `,
    `alter table items add value number`
  ],
  
  // version 1 - testing db versioning
  // every addition to initSQL must increment user_version 
  [
    `pragma user_version = 1`
  ],
  
  // version 2 - add runinfo
  [
    `pragma user_version = 2`,
    `alter table mapruns add runinfo text`
  ],
  
  // version 3 - add gear checker
  [
    `pragma user_version = 3`,
    `
      create table if not exists gear (
        timestamp text not null,
        data text not null,
        diff text,
        primary key (timestamp)
      )
    `
  ],
  
  
  // version 4 - fixes critical bug that caused previous versions to fail on first run
  [
    `pragma user_version = 4`,
    `alter table mapruns add kills number`,
    `insert or ignore into mapruns(id, firstevent, lastevent, gained, kills) values(-1, -1, -1, -1, -1)`
  ],
  
  // version 5 - league start and end dates
  [
    'pragma user_version = 5',
    `
      create view if not exists leaguedates as
        select league, timestamp as start, 
        (select ifnull(min(timestamp), 99999999999999) from leagues l2 where l2.timestamp > leagues.timestamp) as end
        from leagues
        order by start
    `
  ]
  
  // version 6 - migration of fullrates and stashes to separate league DB
  // not incremented here, requires extra processing (see debug.js)
  
];

// db maintenance - execute on every app start
const maintSQL = [
   `delete from incubators where timestamp < (select min(timestamp) from (select timestamp from incubators order by timestamp desc limit 25))`
];

const leagueInitSQL = [
  [ 
    `pragma user_version = 1`,
    `
      create table if not exists characters (
        name text primary key not null
      )
    `,
    `
      create table if not exists fullrates (
        date text primary key not null,
        data text not null
      )
    `,
    `
      create table if not exists stashes (
        timestamp text primary key not null,
        items text not null,
        value text not null
      )
    `
  ]
];

module.exports = DB;