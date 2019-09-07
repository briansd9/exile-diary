const logger = require("./Log").getLogger(__filename);
const Utils = require("./Utils");
const ItemCategoryParser = require("./ItemCategoryParser");
const rarities = ['Normal', 'Magic', 'Rare', 'Unique', 'Gem', 'Currency', 'Divination Card', 'Quest Item', 'Prophecy', 'Relic'];

async function insertItems(items, timestamp) {
  return new Promise( async (resolve, reject) => {

    var DB = require('./DB').getDB();
    
    var duplicateInventory = await isDuplicateInventory(items);
    if(duplicateInventory) {
      logger.info(`Duplicate items found for ${timestamp}, returning`);
      resolve();
    } else {
      logger.info(`Inserting items for ${timestamp}`);
      DB.serialize(function() {
        DB.run("begin transaction", (err) => {
          if(err) {
            logger.info(`Error beginning transaction to insert items: ${err}`);
          }
        });
        var stmt = DB.prepare(
          `
            insert into items (id, event_id, icon, name, rarity, category, identified, typeline, sockets, stacksize, rawdata)
            values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        );
        Object.keys(items).forEach((key) => {
          var itemToInsert = parseItem(items[key], timestamp);
          stmt.run(itemToInsert, (err) => {
            if(err) {
              logger.info(`Error inserting item: ${err}`);
              logger.info(JSON.stringify(itemToInsert));
            }
          });
        });
        stmt.finalize( (err) => {
          if(err) {
            logger.warn(`Error inserting items for ${timestamp}: ${err}`);
            DB.run("rollback", (err) => {
              if (err) {
                logger.info(`Error rolling back failed item insert: ${err}`);
              }        
            });
          } else {
            DB.run("commit", (err) => {
              if (err) {
                logger.info(`Error committing item insert: ${err}`);
              }        
            });
          }
        });
        logger.info(`Done inserting items for ${timestamp}`);
        resolve();
      });
    }
  });
}

async function isDuplicateInventory(items) {
  
  return new Promise( (resolve, reject) => {
    
    var checkDuplicates = false;
    var numItemsToCheck = 0;
    
    if(items.length === 0) resolve(false);

    var keys = Object.keys(items);
    var query = "select count(1) as count from items where (";
    for(var i = 0; i < keys.length; i++) {

      if(items[keys[i]].stacksize || items[keys[i]].stackSize) continue;
      
      if(checkDuplicates) {
        query += " or ";
      } else {
        checkDuplicates = true;
      }

      query += `( id = '${keys[i]}' `;
      query += `)`;
      
      numItemsToCheck++;
      
    }
    query += ")";
    
    if(!checkDuplicates) resolve(false);
    
    if(numItemsToCheck < 1) resolve(false);

    logger.info(query);
    var DB = require('./DB').getDB();
    DB.get(query, (err, row) => {
      if(err) {
        logger.warn(`Error checking inventory keys: ${err}`);
        resolve(false);
      } else {
        logger.info(`${numItemsToCheck} items in inventory, ${row.count} duplicates found in DB`);
        resolve(row.count === numItemsToCheck);
      }
    });
    
  });
    
  
}

function parseItem(item, timestamp) {
  var id = item.id;
  var icon = getImageUrl(item.icon);
  var name = stripTags(item.name);
  var rarity = rarities[item.frameType];
  var category = ItemCategoryParser.getCategory(item);
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

module.exports.insertItems = insertItems;