const logger = require("./Log").getLogger(__filename);
const Utils = require("./Utils");
const rarities = ['Normal', 'Magic', 'Rare', 'Unique', 'Gem', 'Currency', 'Divination Card', 'Quest Item', 'Prophecy', 'Relic'];

async function insertItems(items, timestamp) {
  return new Promise( async (resolve, reject) => {
    logger.info(`Inserting items for ${timestamp}`);
    var DB = require('./DB').getDB();
    
    var hasKey = await hasExistingKey(items);
    if(hasKey) {
      logger.info("Duplicate items found, returning");
      resolve();
    }
    
    var stmt = DB.prepare(
      `
        insert into items (id, event_id, icon, name, rarity, category, identified, typeline, sockets, stacksize, rawdata)
        values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );
    Object.keys(items).forEach((key) => {
      stmt.run(parseItem(items[key], timestamp));
    });
    stmt.finalize( (err) => {
      if(err) {
        logger.warn(`Error inserting items for ${timestamp}: ${err}`);
      }
      resolve();
    });
  });
}

async function hasExistingKey(items) {
  
  return new Promise( (resolve, reject) => {
    
    var checkDuplicates = false;
    
    if(items.length === 0) resolve(false);

    var keys = Object.keys(items);
    var query = "select count(1) as count from items where id in (";
    for(var i = 0; i < keys.length; i++) {
      
      // only check duplication for non-stackable items
      if(!items[keys[i]].stacksize && !items[keys[i]].stackSize) continue;

      if(checkDuplicates) query += ",";
      query += `'${keys[i]}'`;
      checkDuplicates = true;
      
    }
    query += ")";

    if(!checkDuplicates) {
      logger.info("No non-stackable items found, not checking duplicates");
      resolve(false);
    }

    logger.info(query);
    var DB = require('./DB').getDB();
    DB.get(query, (err, row) => {
      if(err) {
        logger.warn(`Error checking inventory keys: ${err}`);
        resolve(false);
      } else {
        logger.info(`${row.count} duplicate items found in DB`);
        resolve(row.count !== 0);
      }
    });
    
  });
    
  
}

function parseItem(item, timestamp) {
  var id = item.id;
  var icon = getImageUrl(item.icon);
  var name = stripTags(item.name);
  var rarity = rarities[item.frameType];
  var category = getCategory(item);
  var identified = item.identified;
  var typeline = stripTags(item.typeLine);
  var stacksize = item.stackSize || null;
  var sockets = Utils.getSockets(item);
  var rawdata = JSON.stringify(item);
  //logger.info([id, timestamp, icon, name, rarity, category, identified, typeline, sockets, stacksize]);
  return [id, timestamp, icon, name, rarity, category, identified, typeline, sockets, stacksize, rawdata];
}

function getImageUrl(url) {
  // flask image urls are in a very strange form, just return as is
  if (url.includes("web.poecdn.com/gen")) {
    return url;
  } else {
    // stripping identifier from end
    return url.substring(0, url.indexOf("?"));
  }
}

function stripTags(name) {
  if(!name) {
    return null;
  }
  return name.replace("<<set:MS>><<set:M>><<set:S>>", "");
}

function getCategory(item) {

  var cat = item.category;
  if (!(cat instanceof String)) {
    cat = Object.keys(item.category)[0];
    if (item.category[cat] && item.category[cat].length > 0) {
      cat = item.category[cat][0];
    }
  }

  switch (cat) {
    case "claw":
    case "shield":
    case "sceptre":
    case "ring":
    case "helmet":
    case "wand":
    case "belt":
    case "dagger":
    case "quiver":
    case "bow":
    case "amulet":
      return cat.substring(0, 1).toUpperCase() + cat.substring(1) + "s";
    case "boots":
    case "gems":
    case "gloves":
      return cat.substring(0, 1).toUpperCase() + cat.substring(1);
    case "supportgem":
      return "Support Skill Gems";
    case "activegem":
      return "Active Skill Gems";
    case "currency":
    case "fossil":
    case "resonator":
      return "Currency";
    case "onesword":
      return "One Hand Swords";
    case "onemace":
      return "One Hand Maces";
    case "oneaxe":
      return "One Hand Axes";
    case "twosword":
      return "Two Hand Swords";
    case "twomace":
      return "Two Hand Maces";
    case "twoaxe":
      return "Two Hand Axes";
    case "flasks":
      if (item.typeLine.includes("Life"))
        return "Life Flasks";
      if (item.typeLine.includes("Mana"))
        return "Mana Flasks";
      if (item.typeLine.includes("Hybrid"))
        return "Hybrid Flasks";
      if (item.typeLine.includes("Diamond"))
        return "Critical Utility Flasks";
      return "Utility Flasks";
    case "jewels":
      return "Jewel";
    case "abyss":
      return "Abyss Jewel";
    case "chest":
      return "Body Armours";
    case "staff":
      return "Staves";
    case "cards":
      return "Divination Card";
    case "soul":
      return "Pantheon Soul";
    case "misc":
      if (item.frameType === 7)
        return "Quest Items";
      if (item.frameType === 5)
        return "Labyrinth Items";
    case "maps":
      if (item.typeLine.includes("Map"))
        return "Maps";
      return "Map Fragments";
    case "piece":
      return "Harbinger Item Piece";
    default:
      logger.warn("No item class found! category: " + cat);
      logger.warn(JSON.stringify(item));
  }
}

/*
function checkSockets(item) {
  logger.info("Item id is " + item.id);
  var sockets = getSockets(item);
  logger.info("Item sockets is " + sockets);
  var DB = require('./DB').getDB();
  DB.run("update items set sockets = ? where id = ?", [sockets, item.id]);
}
*/




module.exports.insertItems = insertItems;