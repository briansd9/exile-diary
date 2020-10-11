const ItemPricer = require('./ItemPricer');
const FilterParser = require('./FilterParser');
const logger = require('./Log').getLogger(__filename);
const DB = require('./DB').getDB();
const Constants = require('./Constants');
const Utils = require('./Utils');

async function get() {
  
  let totalStats = {};
  let areaStats = {};
  let bigDrops = [];
  
  let allMaps = await new Promise((resolve, reject) => {
    DB.all(`
      select areainfo.name, mapruns.* 
      from areainfo, mapruns 
      where mapruns.id = areainfo.id
      and ifnull(kills, 0) > -1 and ifnull(gained, 0) > -1            
      order by mapruns.id desc
    `, (err, rows) => {
      resolve(rows);
    });
  });
  
  for(let i = 0; i < allMaps.length; i++) {
    
    let m = allMaps[i];
    
    m.runinfo = JSON.parse(m.runinfo);
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
  
  totalStats.unrighteousTurnedToAsh = await getUnrighteousTurnedToAsh();  
  bigDrops = await getBigDrops();
  
  return({ totalStats : totalStats, areaStats : areaStats, bigDrops: bigDrops });

}

async function getUnrighteousTurnedToAsh() {
  return new Promise((resolve, reject) => {
    DB.get(`select count(1) as count from events where event_text like 'Sister Cassia: And the unrighteous were turned to ash!%'`, (err, row)  => {
      if(err) {
        resolve(0);
      }
      resolve(row.count);
    });
  });  
}

async function getAreaByName(area, areaType) {
  
  let maps = [];
  let q = await new Promise((resolve, reject) => {
    DB.all(`
      select mapruns.* 
      from areainfo, mapruns 
      where mapruns.id = areainfo.id
      and areainfo.name = ?
      ${areaType.startsWith("blightedMaps") ? "and json_extract(runinfo, '$.blightedMap') is not null" : ""}
      ${areaType.startsWith("heist") ? "and json_extract(runinfo, '$.heistRogues') is not null" : ""}
      ${areaType.startsWith("grandHeist") ? "and json_array_length(json_extract(runinfo, '$.heistRogues')) > 1" : ""}
      and ifnull(kills, 0) > -1 and ifnull(gained, 0) > -1
      order by mapruns.id
    `, [area], (err, rows) => {
      resolve(rows);
    });
  });
  
  q.forEach(map => {
    let info = JSON.parse(map.runinfo);
    maps.push({
      id: map.id,
      time: Number(Utils.getRunningTime(map.firstevent, map.lastevent, "s", { useGrouping : false })),
      gained: map.gained || 0,
      kills: map.kills || 0,
      deaths: info.deaths || 0
    });
  });
  
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
  
  const boolStats = [
    "abyssalDepths", 
    "vaalSideAreas", 
    "blightedMap", 
    "blightEncounter", 
    "strangeVoiceEncountered", 
    "elderDefeated"
  ];

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
    totalStats.shaper.started++;
    if(info.shaperBattle.completed) {
      totalStats.shaper.completed++;
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
        if(minfo[elem]) {
          totalStats.masters[m][elem] = (totalStats.masters[m][elem] || 0) + minfo[elem];
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

async function getBigDrops() {
  
  let drops = await new Promise((resolve, reject) => {
    DB.all(`
      select mapruns.id as map_id, areainfo.name as area, items.*
      from items, mapruns, areainfo
      where items.value > 20 
      and items.event_id between mapruns.firstevent and mapruns.lastevent
      and mapruns.id = areainfo.id
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
      exaltPrices[date] = await ItemPricer.getCurrencyByName(date, "Exalted Orb");
    }
    if(item.value < exaltPrices[date]) {
      drops.splice(i, 1);
    } else {
      item.parser = await FilterParser.get(item.event_id);
      item.exaltValue = item.value / exaltPrices[date];
    }
  }
  
  return drops;
  
}

module.exports.get = get;
module.exports.getAreaByName = getAreaByName;