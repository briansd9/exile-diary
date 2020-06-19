const sqlite3 = require('sqlite3');
const path = require('path');
const logger = require("./Log").getLogger(__filename);

class DB {
  
  static getDB(startup = false) {

    var settings = require('./settings').get();
    if(!settings) {
      logger.info("No settings file found, can't initialize DB");
      return null;
    }
    if (!settings.activeProfile || !settings.activeProfile.characterName) {
      logger.info("No active profile selected, can't initialize DB");
      return null;
    }

    var app = require('electron').app || require('electron').remote.app;
    
    var db = new sqlite3.cached.Database(path.join(app.getPath("userData"), settings.activeProfile.characterName + ".db"));
    
    if(startup) {
      logger.info(`Initializing database for ${settings.activeProfile.characterName}`);
      this.init(db);
    }

    return db;

  }

  static init(db) {
    db.get("pragma user_version", (err, row) => {
      if(err) {
        logger.info("Error reading database version: " + err);
      } else {
        let ver = row.user_version;
        logger.info(`Database version is ${ver}`);
        db.serialize(() => {
          for(let i = 0; i < initSQL.length; i++) {
            if(ver === 0 || i > ver) {
              logger.info(`Running initialization SQL for version ${i}`);
              for(let j = 0; j < initSQL[i].length; j++) {
                let sql = initSQL[i][j];
                logger.info(sql);
                db.run(sql, (err) => {
                  if(err) {
                    if(!err.toString().includes("duplicate column name")) {
                      logger.info(`Error initializing DB: ${err}`);
                    }
                  }
                });
              }
            }
          }
          for(let i = 0; i < maintSQL.length; i++) {
            db.run(maintSQL[i], (err) => {
              if(err) {
                logger.info(`Error running DB maintenance: ${err}`);
              }
            });
          }
          
        });
      }
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
        primary key (id, event_type)
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
      create table if not exists rates (
        date text not null,
        item text not null,
        value number not null,
        primary key (date, item)
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
    `insert or ignore into mapruns(id, firstevent, lastevent, gained, kills) values(-1, -1, -1, -1, -1)`,
    `
      create table if not exists filters (
        timestamp text primary key not null,
        text text
      )
    `,
    `
      create table if not exists stashes (
        timestamp text primary key not null,
        items text not null,
        value text not null
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
    `alter table mapruns add kills number`,
    `
      create table if not exists fullrates (
        date text primary key not null,
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
  
  // version 2 - change primary key of events table to prevent collisions
  [
    `pragma user_version = 2`,
    `
      create table if not exists events_copy (
        id text not null,
        event_type text not null,
        event_text text,
        server text,
        primary key (id, event_type, event_text)
      )
    `,
    `insert into events_copy(id, event_type, event_text, server) select id, event_type, event_text, server from events`,
    `drop table events`,
    `alter table events_copy rename to events`,
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
  ]
  
  
];

// db maintenance - execute on every app start
const maintSQL = [
   `delete from incubators where timestamp < (select min(timestamp) from (select timestamp from incubators order by timestamp desc limit 25))`
];

module.exports = DB;