const ItemPricer = require('./ItemPricer');
const FilterParser = require('./FilterParser');
const logger = require('./Log').getLogger(__filename);
const Constants = require('./Constants');
const Utils = require('./Utils');

const boolStats = [
  "abyssalDepths", 
  "vaalSideAreas", 
  "blightedMap", 
  "blightEncounter", 
  "strangeVoiceEncountered", 
  "elderDefeated"
];

const shaperBattlePhases = [
  {name: "start"},
  {name: "boss1", endpoint: true},
  {name: "boss2", endpoint: true},
  {name: "boss3", endpoint: true},
  {name: "boss4", endpoint: true},
  {name: "phase1start"},
  {name: "phase2start", endpoint: true},
  {name: "phase3start", endpoint: true},
  {name: "completed", endpoint: true}
];

async function get(char, league) {
  
  let charList = (char === "all" ? await getCharList(league) : [ char ]);
  if(league === "all") {
    league = null;
  }
  
  let totalStats = { unrighteousTurnedToAsh: 0 };
  let areaStats = {};
  let bigDrops = [];
  
  for(let j = 0; j < charList.length; j++) {

    let DB = require('./DB').getDB(charList[j]);
    logger.info(`Getting stats for [${charList[j]}] in [${league}]`);
  
    let allMaps = await new Promise((resolve, reject) => {
      DB.all(`
        select areainfo.name, mapruns.* 
        from areainfo, mapruns ${league ? ", leaguedates" : ""}
        where mapruns.id = areainfo.id
        and json_extract(runinfo, '$.ignored') is null
        ${league ? ` and leaguedates.league = '${league}' ` : ""}
        ${league ? " and mapruns.id between leaguedates.start and leaguedates.end " : ""}
        order by mapruns.id desc
      `, (err, rows) => {
        resolve(rows);
      });
    });    
    if(!allMaps) continue;

    for(let i = 0; i < allMaps.length; i++) {

      let m = allMaps[i];

      m.runinfo = JSON.parse(m.runinfo);
      if(!m.runinfo) continue;
      
      m.areaType = (m.runinfo.blightedMap ? "blightedMaps" : Utils.getAreaType(m.name));

      // Laboratory area name no longer unique :-(
      if(m.name === "Laboratory" && m.runinfo.heistRogues && Object.keys(m.runinfo.heistRogues).length > 0) {
        m.areaType = "heist";
      }

      if(m.areaType === "heist" && m.runinfo.heistRogues && Object.keys(m.runinfo.heistRogues).length > 1) {
        m.areaType = "grandHeist";
      }

      mergeRunInfo(totalStats, m);
      mergeAreaStats(areaStats, m);

    }

    totalStats.unrighteousTurnedToAsh += await getUnrighteousTurnedToAsh(charList[j], league);  
    bigDrops = bigDrops.concat(await getBigDrops(charList[j], league));
    
  }
  
  if(charList.length === 1) {
    totalStats.trials = await getTrials(charList[0]);
  }
  
  return({ totalStats : totalStats, areaStats : areaStats, bigDrops: bigDrops });

}

async function getCharList(league) {
  let leagueDB = require('./DB').getLeagueDB(league);
  return new Promise((resolve, reject) => {
     leagueDB.all(" select name from characters ", (err, rows) => {
       if(err) {
         logger.info("Error getting character list!");
         resolve([]);
       } else {
         resolve(rows.map( row => row.name));
       }
     })
  });
}

async function getUnrighteousTurnedToAsh(char, league) {
  let DB = require('./DB').getDB(char);
  return new Promise((resolve, reject) => {
    DB.get(`
      select count(1) as count 
      from events ${league ? ", leaguedates" : ""}
      where event_text like 'Sister Cassia: And the unrighteous were turned to ash!%'
      ${league ? ` and leaguedates.league = '${league}' and events.id between leaguedates.start and leaguedates.end ` : ""}
    `, (err, row)  => {
      if(err) {
        resolve(0);
      }
      resolve(row.count);
    });
  });  
}

async function getTrials(char) {
  let DB = require('./DB').getDB(char);
  return new Promise((resolve, reject) => {
    DB.all(`
      select trial, sum(runtime) as totaltime, count(1) as totalmaps 
      from
        (select id,
        firstevent, lastevent, 
        strftime('%s', substr(lastevent, 1, 4) || '-' || substr(lastevent, 5, 2) || '-' || substr(lastevent, 7, 2) || ' ' || substr(lastevent, 9, 2) || ':' || substr(lastevent, 11, 2) || ':' || substr(lastevent, 13, 2)) -
        strftime('%s', substr(firstevent, 1, 4) || '-' || substr(firstevent, 5, 2) || '-' || substr(firstevent, 7, 2) || ' ' || substr(firstevent, 9, 2) || ':' || substr(firstevent, 11, 2) || ':' || substr(firstevent, 13, 2))
        as runtime from mapruns where id > 0) 
          as times,
        (select min(id) as id, event_text as trial from events where event_text='Trial of Swirling Fear'
        union select min(id) as id, event_text as trial from events where event_text='Trial of Lingering Pain'
        union select min(id) as id, event_text as trial from events where event_text='Trial of Piercing Truth'
        union select min(id) as id, event_text as trial from events where event_text='Trial of Stinging Doubt'
        union select min(id) as id, event_text as trial from events where event_text='Trial of Crippling Grief'
        union select min(id) as id, event_text as trial from events where event_text='Trial of Burning Rage') 
          as trials
      where times.firstevent < trials.id
      group by trial
      order by 2
    `, (err, rows)  => {
      if(err) {
        resolve(null);
      } else {
        resolve(rows);
      }
    });
  });  
}

async function getAreaByName(area, areaType, char, league) {
  
  let charList = (char === "all" ? await getCharList(league) : [ char ]);
  if(league === "all") {
    league = null;
  }
  
  let maps = [];
  
  for(let j = 0; j < charList.length; j++) {
    
    let DB = require('./DB').getDB(charList[j]);

    let q = await new Promise((resolve, reject) => {
      DB.all(`
        select mapruns.* 
        from areainfo, mapruns ${league ? ", leaguedates" : ""}
        where mapruns.id = areainfo.id
        and areainfo.name = ?
        and json_extract(runinfo, '$.blightedMap') is ${areaType.startsWith("blightedMaps") ? " not null " : " null "}
        ${areaType.startsWith("heist") ? "and json_extract(runinfo, '$.heistRogues') is not null" : ""}
        ${areaType.startsWith("grandHeist") ? "and json_array_length(json_extract(runinfo, '$.heistRogues')) > 1" : ""}
        and json_extract(runinfo, '$.ignored') is null
        ${league ? ` and leaguedates.league = '${league}' ` : ""}
        ${league ? " and mapruns.id between leaguedates.start and leaguedates.end " : ""}
        order by mapruns.id
      `, [area], (err, rows) => {
        if(err) {
          logger.info("Error getting area stats: " + err);
          resolve(null);        
        } else {
          resolve(rows);
        }
      });
    });

    q.forEach(map => {
      let info = JSON.parse(map.runinfo);
      maps.push({
        char: charList[j],
        id: map.id,
        time: Number(Utils.getRunningTime(map.firstevent, map.lastevent, "s", { useGrouping : false })),
        gained: map.gained || 0,
        kills: map.kills || 0,
        deaths: info.deaths || 0
      });
    });
    
  }
  
  return maps;
  
}

function mergeAreaStats(areaStats, map) {
  
  areaStats[map.areaType] = areaStats[map.areaType] || { count: 0, gained: 0, kills: 0, time: 0, deaths: 0 };
  
  let as = areaStats[map.areaType];  
  as.count++;
  as.gained += map.gained;
  as.kills += map.kills;
  let runningTime = Number(Utils.getRunningTime(map.firstevent, map.lastevent, "s", { useGrouping : false }));
  as.time += runningTime;
  if(map.runinfo.deaths) {
    as.deaths += map.runinfo.deaths;
  }
  
  as.areas = as.areas || {};
  let asa = as.areas;  
  asa[map.name] = asa[map.name] || { count: 0, gained: 0, kills: 0, time: 0, deaths: 0 };
  let asam = asa[map.name];  
  asam.count++;
  asam.gained += map.gained;
  asam.kills += map.kills;
  asam.time += runningTime;
  if(map.runinfo.deaths) {
    asam.deaths += Number(map.runinfo.deaths);
  }
  
}

function mergeRunInfo(totalStats, map) {
  
  let info = map.runinfo;
  
  totalStats.kills = (totalStats.kills || 0) + Number(map.kills);
  totalStats.gained = (totalStats.gained || 0) + Number(map.gained);
  
  boolStats.forEach( stat => {
    if(info[stat]) {
      totalStats[stat] = ++totalStats[stat] || 1;
    }
  });
  
  ["beastRecipes", "deaths"].forEach(countStat => {
    if(info[countStat]) {
      totalStats[countStat] = (totalStats[countStat] || 0) + info[countStat];
    }
  });


  if(info.shrines) {
    totalStats.shrines = totalStats.shrines || {};
    for(let i = 0; i < info.shrines.length; i++) {
      let sh = info.shrines[i];
      totalStats.shrines[sh] = ++totalStats.shrines[sh] || 1;
    }
  }

  if(info.simulacrumProgress) {
    totalStats.simulacrum = totalStats.simulacrum || { started: 0, completed: 0 };
    totalStats.simulacrum.started++;
    if(info.simulacrumProgress.completed) {
      totalStats.simulacrum.completed++;
    }
  }

  if(info.shaperBattle) {
    
    totalStats.shaper = totalStats.shaper || { started: 0, completed: 0 };
    totalStats.shaperPhases = totalStats.shaperPhases || {};
    
    totalStats.shaper.started++;
    if(info.shaperBattle.completed) {
      totalStats.shaper.completed++;
    }
    
    for(let i = 0; i < shaperBattlePhases.length; i++) {
      if(shaperBattlePhases[i].endpoint) {
        let curr = shaperBattlePhases[i].name;
        let prev = shaperBattlePhases[i-1].name;
        if(!info.shaperBattle[prev] || !info.shaperBattle[curr]) {
          continue;
        }
        let runningTime = Number(Utils.getRunningTime(info.shaperBattle[prev], info.shaperBattle[curr], "s", { useGrouping : false }));
        totalStats.shaperPhases[curr] = totalStats.shaperPhases[curr] || { count: 0, totalTime: 0 };
        totalStats.shaperPhases[curr].count++;
        totalStats.shaperPhases[curr].totalTime += runningTime;
      }
    }
    
  }

  if(info.mastermindBattle) {
    totalStats.mastermind = totalStats.mastermind || { started: 0, completed: 0 };
    totalStats.mastermind.started++;
    if(info.mastermindBattle.completed) {
      totalStats.mastermind.completed++;
    }
  }

  if(info.labyrinth) {
    totalStats.labyrinth = totalStats.labyrinth || { started: 0, completed: 0, argusKills: 0, darkshrines: {} };
    totalStats.labyrinth.started++;
    if(info.labyrinth.completed) {
      totalStats.labyrinth.completed++;
    }
    if(info.labyrinth.argusKilled) {
      totalStats.labyrinth.argusKills++;
    }
    if(info.labyrinth.darkshrines) {
      let ds = info.labyrinth.darkshrines;
      for(let i = 0; i < ds.length; i++) {
        totalStats.labyrinth.darkshrines[ds[i]] = ++totalStats.labyrinth.darkshrines[ds[i]] || 1;
      }
    }
  }

  if(info.masters) {
    totalStats.masters = totalStats.masters || {};
    let keys = Object.keys(info.masters);
    for(let i = 0; i < keys.length; i++) {
      let m = keys[i];
      totalStats.masters[m] = totalStats.masters[m] || { encounters: 0, completed: 0 };
      totalStats.masters[m].encounters++;
      let minfo = info.masters[m];
      if(minfo.favourGained) {
        totalStats.masters[m].completed++;
      }
      ["beasts", "incursions", "sulphite", "favourGained"].forEach( elem => {
        totalStats.masters[m][elem] = (totalStats.masters[m][elem] || 0);
        if(minfo[elem]) {
          totalStats.masters[m][elem] += (minfo[elem] || 0);
        }
      });
      if(minfo.tier3Rooms) {
        totalStats.atzoatl = totalStats.atzoatl || {};
        totalStats.atzoatl.temples = ++totalStats.atzoatl.temples || 1;
        for(let j = 0; j < minfo.tier3Rooms.length; j++) {
          totalStats.atzoatl[minfo.tier3Rooms[j]] = ++totalStats.atzoatl[minfo.tier3Rooms[j]] || 1;
        }
      }
      if(minfo.missionMap) {
        totalStats.masters[m].missionMaps = totalStats.masters[m].missionMaps || {};
        totalStats.masters[m].missionMaps[minfo.missionMap] = ++totalStats.masters[m].missionMaps[minfo.missionMap] || 1;
      }
    }
  }

  if(info.syndicate) {
    totalStats.syndicate = totalStats.syndicate || {};
    let keys = Object.keys(info.syndicate);
    for(let i = 0; i < keys.length; i++) {
      let s = keys[i];
      totalStats.syndicate[s] = totalStats.syndicate[s] || { encounters: 0, kills: 0, killedBy: 0, safehouseLeaderKills: 0 };
      totalStats.syndicate[s].encounters++;
      let sinfo = info.syndicate[s];
      if(sinfo.defeated) {
        totalStats.syndicate[s].kills = (totalStats.syndicate[s].kills || 0) + sinfo.defeated;
      }
      if(sinfo.killedPlayer) {
        totalStats.syndicate[s].killedBy = (totalStats.syndicate[s].killedBy || 0) + sinfo.killedPlayer;
      }
      if(sinfo.safehouseLeaderDefeated) {
        totalStats.syndicate[s].safehouseLeaderKills++;
      }
    }
  }
  
  
  if(info.sirusBattle) {
    totalStats.sirusBattle = totalStats.sirusBattle || { started: 0, completed: 0, dieBeamsFired: 0, dieBeamKills: 0, orbs: 0, lastPhaseTime: 0 };
    totalStats.sirusBattle.started++;
    if(info.sirusBattle.completed) {
      totalStats.sirusBattle.completed++;
      if(info.sirusBattle.finalPhaseStart) {
        let lastPhaseTime = Utils.getRunningTime(info.sirusBattle.finalPhaseStart, info.sirusBattle.completed, "s", { useGrouping : false });
        totalStats.sirusBattle.lastPhaseTime += Number(lastPhaseTime);
      }
    }
    if(info.sirusBattle.dieBeamsFired) {
      totalStats.sirusBattle.dieBeamsFired += info.sirusBattle.dieBeamsFired;
    }
    if(info.sirusBattle.dieBeamKills) {
      totalStats.sirusBattle.dieBeamKills += info.sirusBattle.dieBeamKills;
    }
    if(info.sirusBattle.droppedOrb) {
      totalStats.sirusBattle.orbs++;
    }
      
  }

  if(info.legionGenerals) {
    totalStats.legionGenerals = totalStats.legionGenerals || { encounters: 0, kills: 0 };
    let keys = Object.keys(info.legionGenerals);
    for(let i = 0; i < keys.length; i++) {
      let g = keys[i];
      totalStats.legionGenerals[g] = totalStats.legionGenerals[g] || { encounters: 0, kills: 0 };
      totalStats.legionGenerals[g].encounters++;
      totalStats.legionGenerals.encounters++;
      if(info.legionGenerals[g].defeated) {
        totalStats.legionGenerals[g].kills++;
        totalStats.legionGenerals.kills++;
      }
    }
  }
  
  if(info.conqueror) {
    totalStats.conquerors = totalStats.conquerors || {};
    for(var conq in info.conqueror) {
      totalStats.conquerors[conq] = totalStats.conquerors[conq] || { encounters: 0, battles: 0, kills: 0, orbs: 0 };
      let c = info.conqueror[conq];
      if(c.encountered) {
        totalStats.conquerors[conq].encounters++;
      }
      if(c.battle) {
        totalStats.conquerors[conq].battles++;
      }
      if(c.defeated) {
        totalStats.conquerors[conq].kills++;
      }
      if(c.droppedOrb) {
        totalStats.conquerors[conq].orbs++;
      }
    }
  }
  
  if(info.metamorph) {
    for(var key in info.metamorph) {
      totalStats.metamorph = totalStats.metamorph || { encounters: 0 };
      totalStats.metamorph.encounters++;
      totalStats.metamorph[key] = (totalStats.metamorph[key] || 0) + info.metamorph[key];
    }
  }
  
  if(info.heistRogues && Object.keys(info.heistRogues).length > 0) {
    let isNormalHeist;
    totalStats.heist = totalStats.heist || { heists: 0, heistsCompleted: 0, grandHeists: 0, rogues: {} };
    if(Object.keys(info.heistRogues).length === 1) {
      isNormalHeist = true;
      totalStats.heist.heists++;
      if(info.heistCompleted) {
        totalStats.heist.heistsCompleted++;
      }
    } else if(Object.keys(info.heistRogues).length > 1) {
      isNormalHeist = false;
      totalStats.heist.grandHeists++;
    }
    let rogues = Array.isArray(info.heistRogues) ? info.heistRogues : Object.keys(info.heistRogues);
    rogues.forEach(r => {
      totalStats.heist.rogues[r] = totalStats.heist.rogues[r] || { heists: 0, heistsCompleted: 0, grandHeists: 0 };
      if(isNormalHeist) {
        totalStats.heist.rogues[r].heists++;
        if(info.heistCompleted) {
          totalStats.heist.rogues[r].heistsCompleted++;
        }
      } else {
        totalStats.heist.rogues[r].grandHeists++;
      }
    });
  }

}



async function getBigDrops(char, league) {
  
  let DB = require('./DB').getDB(char);
  let drops = await new Promise((resolve, reject) => {
    DB.all(`
      select leaguedates.league, mapruns.id as map_id, areainfo.name as area, items.*
      from items, mapruns, areainfo, leaguedates
      where items.value > 10 
      and items.event_id between mapruns.firstevent and mapruns.lastevent
      and mapruns.id = areainfo.id
      ${league ? ` and leaguedates.league = '${league}' ` : ""}
      and map_id between leaguedates.start and leaguedates.end
    `, (err, rows) => {
      if(err) {
        logger.info("Error getting big drops: " + err.message);
        resolve(null);
      } else {
        resolve(rows);
      }
    });
  });
  
  let exaltPrices = {};
  
  for(let i = drops.length - 1; i > -1; i--) {
    let item = drops[i];
    let date = item.event_id.substring(0, 8);
    if(!exaltPrices[date]) {
      exaltPrices[date] = await ItemPricer.getCurrencyByName(date, "Exalted Orb", item.league);
    }
    if(item.value < exaltPrices[date]) {
      drops.splice(i, 1);
    } else {
      item.parser = await FilterParser.get(item.event_id, char);
      item.exaltValue = item.value / exaltPrices[date];
    }
  }
  
  return drops;
  
}

module.exports.get = get;
module.exports.getAreaByName = getAreaByName;