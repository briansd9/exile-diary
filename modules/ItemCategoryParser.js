const logger = require("./Log").getLogger(__filename);
const data = require('../res/data/itemCategories.json');

const equipmentBaseTypes = data.equipmentBaseTypes;
const gemBaseTypes = data.gemBaseTypes;
const otherBaseTypes = data.otherBaseTypes;
const nonStackableBaseTypes = [].concat(Object.keys(equipmentBaseTypes), Object.keys(gemBaseTypes));

const metamorphSamples = [
  "BrainInventory", "LungInventory", "HeartInventory", "LiverInventory", "EyeballInventory"
];

const nonStackableBulkItems = [
  'Map Fragments',
  'Prophecy',
  'Labyrinth Items',
  'Maps',
  'Incubator',
  'Atlas Region Upgrade Item'    
];

function getCategory(item, subcategory = false) {
  
  var t = item.typeLine;
  if(!t) return null;
  
  if(t.includes("Contract:")) {
    return data.heistQuestItems.includes(t) ? "Quest Items" : "Contract";
  }
  
  if(t.includes("Blueprint:")) {
    return "Blueprint";
  }
  
  if(otherBaseTypes[t]) {
    if(!subcategory && Array.isArray(otherBaseTypes[t])) {
      return otherBaseTypes[t][0];
    } else {
      return otherBaseTypes[t];
    }
  }
  
  switch(item.frameType) {
    case 4:
      var n = t.replace(/(Superior|Anomalous|Divergent) /g, "");
      if(gemBaseTypes[n]) {
        return gemBaseTypes[n];
      } else {
        logger.info(`No base type found for gem [${t}]`);
        return "";
      }
    case 5:  
      if(t.startsWith("Captured Soul")) {
        return "Pantheon Soul";
      } else if(t.endsWith("Seed") || t.endsWith("Grain") || t.endsWith("Bulb") || t.endsWith("fruit")) {
        return "Harvest Seed";
      }
      return "Labyrinth Items";
    case 6:
      return "Divination Card";
    case 7:
      return "Quest Items";
    case 8:
      return "Prophecy";
  }
  
  if(t.endsWith("Scarab")) {
    return "Map Fragments";
  }
  
  // Maligaro's Map quest item has frameType 7, already detected above as a quest item
  if(t.includes(" Map")) {
    return "Maps";
  }

  if(t.endsWith("Incubator")) {
    return "Incubator";
  }
  
  if(t.endsWith("Piece")) {
    return "Harbinger Item Piece";
  }
  
  if(item.icon.includes("BestiaryOrbFull")) {
    return "Captured Beast";
  }
  
  // 3.9 metamorph inventory organs
  for(var i = 0; i < metamorphSamples.length; i++) {
    if(item.icon.includes(metamorphSamples[i])) return "Metamorph Sample";
  }
  
  // equipment - search by hardcoded basetype
  t = t.replace("Superior ", "");
  
  // non-magic equipment
  if(item.frameType !== 1) {
    if(equipmentBaseTypes[t]) {
      return equipmentBaseTypes[t];
    }
  }
  
  // magic equipment - typeline is polluted by prefixes $%&*#^@!!!
  var keys = Object.keys(equipmentBaseTypes);
  for(var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if(t.includes(key)) {
      return equipmentBaseTypes[key];
    }
  }
  
  logger.info(`No category found for item ${item.id || "(no id)"}! JSON follows:`);
  logger.info(JSON.stringify(item));
  return null;  

}

function getEquipmentBaseType(str) {
  var types = Object.keys(equipmentBaseTypes);
  for(var i = 0; i < types.length; i++) {
    if(str.includes(types[i])) {
      return types[i];
    }
  }
  return null;
}

function isNonStackable(str) {
  return nonStackableBaseTypes.includes(str);
}

module.exports.getCategory = getCategory;
module.exports.getEquipmentBaseType = getEquipmentBaseType;
module.exports.isNonStackable = isNonStackable;
module.exports.nonStackableBulkItems = nonStackableBulkItems;