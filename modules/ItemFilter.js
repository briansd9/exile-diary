const logger = require('./Log').getLogger(__filename);
const ItemCategoryParser = require("./ItemCategoryParser");
const itemTypes = ["nonunique", "unique", "gem", "map", "divcard", "prophecy", "oil", "fragment", "delve", "catalyst", "essence", "incubator", "currency"];

var settings;
var itemFilters;

function load() {
  
  itemFilters = {};  
  itemTypes.forEach(type => {
    itemFilters[type] = {};
  });
  settings = require("./settings").get();
  
  // backward compatibility - preserve previous minItemValue functionality  
  if(settings.minItemValue) {
    itemFilters["nonunique"] = {ignore: true, minValue: settings.minItemValue};
    itemFilters["unique"] = {ignore: true, minValue: settings.minItemValue};
    itemFilters["gem"] = {ignore: true, minValue: settings.minItemValue};
  }
  
  // if new itemFilter setting is present, overwrite previous minItemValue
  if(settings.itemFilter) {
    itemFilters = settings.itemFilter;
  }
  
  logger.info(`Loaded: ${JSON.stringify(itemFilters)}`);
  
}

function filter(item) {
  
  if(!itemFilters) load();
  
  // gem, div card, prophecy can be determined by frametype
  switch(item.frameType) {
    case 4:
      return itemFilters.gem;
    case 6:
      return itemFilters.divcard;
    case 8:
      return itemFilters.prophecy;
    // no default case - if none of the above, fall through
  }
  
  // gear - nonunique, unique  
  let typeLine = ItemCategoryParser.getEquipmentBaseType(item.typeLine);
  if(ItemCategoryParser.isNonStackable(typeLine)) {
    switch(item.frameType) {
      case 3:
      case 9:
        // 3 = unique, 9 = relic
        return itemFilters.unique;
      default:
        return itemFilters.nonunique;
    }
  }
  
  // stackable items
  let cat = ItemCategoryParser.getCategory(item, true);
  switch(cat) {
    case "Maps":
      return itemFilters.map;
    case "Map Fragments":
    case "Labyrinth Items": // offering to the goddess
    case "Misc Map Items": // maven's invitation
      return itemFilters.fragment;
    case "Currency":
    case "Stackable Currency":
      return itemFilters.currency;
    case "Incubator":
      return itemFilters.incubator;
  }
    
  if(Array.isArray(cat)) {
    if(cat[0] === "Map Fragments") {
      return itemFilters.fragment;
    } else if(cat[0] === "Stackable Currency") {
      return itemFilters.currency;
    } else {  // only remaining case is cat[0] === "Currency"
      switch(cat[1]) {
        case "Oil":
          return itemFilters.oil;
        case "Catalyst":
          return itemFilters.catalyst;
        case "Essence":
          return itemFilters.essence;
        case "Resonator":
        case "Fossil":
          return itemFilters.delve;
        default:
          return itemFilters.currency;
      }
    }    
  }
  
  // default case: return empty filter
  return {};
  
}

function getForCategory(cat) {  
  if(!itemTypes.includes(cat)) return null;  
  if(!itemFilters) load();  
  return itemFilters[cat];  
}

module.exports.load = load;
module.exports.filter = filter;
module.exports.getForCategory = getForCategory;