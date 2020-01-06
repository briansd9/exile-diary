  const logger = require('./Log').getLogger(__filename);
  const Constants = require('./Constants');
  const ItemData = require('./ItemData');
  const ItemCategoryParser = require("./ItemCategoryParser");
  const ItemParser = require('./ItemParser');
  const Utils = require('./Utils');
  const zlib = require('zlib');  
  const settings = require('./settings').get();
  

  const baseTypeRarities = ["Normal", "Magic", "Rare"];
  const baseTypeCategories = [
    "Amulets",
    "Belts",
    "Body Armours",
    "Boots",
    "Bows",
    "Claws",
    "Daggers",
    "Gloves",
    "Helmets",
    "One Hand Axes",
    "One Hand Maces",
    "One Hand Swords",
    "Quivers",
    "Rings",
    "Rune Dagger",
    "Sceptres",
    "Shields",
    "Staves",
    "Two Hand Axes",
    "Two Hand Maces",
    "Two Hand Swords",
    "Wands",
    "Warstaff"
  ];

  var ratesCache = {};

  function getRatesFor(timestamp) {

    var activeProfile = settings.activeProfile;
    if (activeProfile.league.includes("SSF") && !activeProfile.overrideSSF) {
      return null;
    }

    var date = timestamp.substring(0, 8);
    if(ratesCache[date]) {
      return ratesCache[date];
    }

    var DB = require('./DB').getDB();
    return new Promise((resolve, reject) => {
      DB.get("select date, data from fullrates where date <= ? order by date desc", [timestamp], async (err, row) => {
        if(err) {
          logger.info(`Unable to get rates for ${timestamp}: ${err}`);
          resolve(null);
        } else {
          if(!row || !row.data) {
            logger.info(`No rates found for ${timestamp}`);
            resolve(null);
          } else {
            zlib.inflate(row.data, (err, buffer) => {
              if(err) {
                // old data - compression not implemented yet, just parse directly
                ratesCache[row.date] = JSON.parse(row.data);
              } else {
                ratesCache[row.date] = JSON.parse(buffer);
              }
              resolve(ratesCache[row.date]);
            });
          }
        }
      });
    });
  }

  async function price(item) {

    if(item.rarity === "Quest Item") {
      // can't be traded
      return 0;
    }
    if(item.category === "Captured Beast") {
      // not handling for now - captured beasts are not acquired as map loot
      // might be relevant for calculating net worth though?
      return 0;
    }
    
    let rates = await getRatesFor(item.event_id);
    if(!rates) {
      return null;
    }
    
    item.parsedItem = JSON.parse(item.rawdata);
    var helmetBaseValue;

    if(item.rarity === "Unique") {
      if(item.category === "Maps") {
        return getUniqueMapValue();
      }
      else {
        // handle helmet enchants - if item is a helmet, don't return value yet
        if(item.category === "Helmets") {
          helmetBaseValue = getUniqueItemValue();
        } else {
          return getUniqueItemValue();
        }
      }
    } else {
      // value not tracked for non-unique flasks and jewels
      if( (item.typeline.includes("Flask") || item.typeline.includes("Jewel")) && baseTypeRarities.includes(item.rarity) ) {
        return 0;
      }
    }
    
    if(item.typeline === "Ivory Watchstone") {
      return getWatchstoneValue();      
    }    
    if(item.category === "Map Fragments" || item.typeline === "Offering to the Goddess" || (item.typeline.includes("Timeless") && item.typeline.includes("Splinter"))) {
      return getFragmentValue();
    }
    if(item.rarity === "Currency" || item.typeline.includes("Incubator")) {
      return getCurrencyValue();
    }
    if(item.category === "Maps") {
      return getMapValue();
    }
    if(item.rarity === "Divination Card") {
      return getValueFromTable("DivinationCard");
    }
    if(item.rarity === "Prophecy") {
      return getValueFromTable("Prophecy");
    }

    if(item.category.includes("Skill Gems")) {
      return getGemValue();
    }

    if(baseTypeRarities.includes(item.rarity) && baseTypeCategories.includes(item.category)) {
      // handle helmet enchants - if item is a helmet, don't return value yet
      if(item.category === "Helmets") {
        helmetBaseValue = getBaseTypeValue();
      } else {
        return getBaseTypeValue();
      }
    }

    if(helmetBaseValue >= 0) {
      var helmetEnchantValue = getHelmetEnchantValue();
      return Math.max(helmetBaseValue, helmetEnchantValue);
    }

    logger.info("Unable to get value for item:");
    logger.info(JSON.stringify(item.parsedItem));
    return 0;
    
    /* sub-functions for getting value per item type*/    
    function getHelmetEnchantValue() {
      if(!item.parsedItem.enchantMods) return 0;
      var identifier = item.parsedItem.enchantMods;
      var value = rates["HelmetEnchant"][identifier];
      if(!value) {
        //logger.info(`Could not find value for ${identifier}`);
        return 0;
      } else {
        //console.log(`${identifier} => ${value}`);
        return value;
      }

    }
    
    function getWatchstoneValue() {
      var identifier = item.name || Constants.getItemName(item.icon);
      var value = rates["Watchstone"][identifier] * (item.stacksize || 1);
      if(!value) {
        //logger.info(`Could not find value for ${item.typeline}`);
        return 0;
      } else {
        //console.log(`${item.typeline} => ${value}`);
        return value;
      }
    }

    function getValueFromTable(table) {
      var value = rates[table][item.typeline] * (item.stacksize || 1);
      if(!value) {
        //logger.info(`Could not find value for ${item.typeline}`);
        return 0;
      } else {
        //console.log(`${item.typeline} => ${value}`);
        return value;
      }
    }

    function getGemValue() {
      var identifier = item.typeline.replace("Superior ", "");
      var level = ItemData.getGemLevel(item.parsedItem);
      var quality = ItemData.getQuality(item.parsedItem);

      switch(identifier) {
        case "Empower Support":
        case "Enlighten Support":
        case "Enhance Support":
          if(level >= 2) identifier += ` L${level}`;
          break;
        case "Brand Recall":
          if(level >= 6) identifier += ` L${level}`;
          if(quality >= 20) identifier += ` Q${quality}`;
          break;
        default:
          if(level >= 20) identifier += ` L${level}`;
          if(quality >= 20) identifier += ` Q${quality}`;
          break;
      }

      if(item.parsedItem.corrupted) {
        identifier += " (Corrupted)";
      }

      var value = rates["SkillGem"][identifier] * (item.stacksize || 1);
      if(!value) {
        //logger.info(`Could not find value for ${identifier}`);
        return 0;
      } else {
        //console.log(`${identifier} => ${value}`);
        return value;
      }

    }

    function getMapValue() {

      var name = item.typeline.replace("Superior ", "");
      var tier = ItemData.getMapTier(item.parsedItem);
      var series = getSeries(item.parsedItem.icon);

      if(item.rarity === "Magic" && item.identified) {
        // strip affixes from magic item name
        name = Utils.getBaseFromMagicMap(name);
        // special handling for name collision >:\
        if(name === "Vaal Temple Map" && tier < 16) {
          name = "Temple Map";
        }
      }

      var identifier = `${name} T${tier} ${series}`;

      var value = rates["Map"][identifier] * (item.stacksize || 1);
      if(!value) {
        //logger.info(`Could not find value for ${identifier}, item follows`);
        //logger.info(item.rawdata);
        return 0;
      } else {
        //console.log(`${identifier} => ${value}`);
        return value;
      }

      function getSeries(icon) {
        if(icon.includes("mn=")) {
          if(icon.includes("mn=1")) return "Atlas2-3.4";
          if(icon.includes("mn=2")) return "Atlas2";
          if(icon.includes("mn=3")) return "Synthesis";
          if(icon.includes("mn=4")) return "Legion";
          if(icon.includes("mn=5")) return "Blight";
          if(icon.includes("mn=6")) return "Metamorph";
        } else {
          if(icon.includes("2DItems/Maps/AtlasMaps")) return "Atlas";
          if(icon.includes("2DItems/Maps/Map")) return "Pre 2.4";
          if(icon.includes("2DItems/Maps/act4maps")) return "Pre 2.0";
        }
        throw new Error("Invalid map image URL: " + icon);
      }
    }

    function getBaseTypeValue() {

      if(item.parsedItem.ilvl < 82) return 0;

      var identifier = item.typeline.replace("Superior ", "");
      if(identifier.endsWith("Talisman")) return 0;

      if(item.rarity === "Magic" && item.identified) {
        // strip affixes from magic item name
        identifier = ItemCategoryParser.getEquipmentBaseType(identifier);
      }
      identifier += ` L${item.parsedItem.ilvl > 86 ? 86 : item.parsedItem.ilvl}`;
      if(item.parsedItem.shaper) {
        identifier += " Shaper";
      } else if(item.parsedItem.elder) {
        identifier += " Elder";
      }
      //logger.info("IDentifier is " + identifier);

      var value = rates["BaseType"][identifier];
      if(!value) {
        //logger.info(`Could not find value for ${identifier}`);
        return 0;
      } else {
        //console.log(`${identifier} => ${value}`);
        return value * (item.stacksize || 1);
      }

    }

    function getCurrencyValue() {
      if(item.typeline === "Chaos Orb") {
        return item.stacksize;
      }
      var value = rates["Currency"][item.typeline] * (item.stacksize || 1);
      if(!value) {
        //logger.info(`Could not find value for ${item.typeline}`);
        return 0;
      } else {
        //console.log(`${item.typeline} => ${value}`);
        return value;
      }
    }

    function getFragmentValue() {
      var value = rates["Fragment"][item.typeline]  * (item.stacksize || 1);
      if(!value) {
        //logger.info(`Could not find value for ${item.typeline}, item follows`);
        //logger.info(item.rawdata);
        return 0;
      } else {
        //console.log(`${item.typeline} => ${value}`);
        return value;
      }
    }

    function getUniqueMapValue() {

      var name = item.name || Constants.getItemName(item.icon);
      var tier = ItemData.getMapTier(item.parsedItem);
      var typeline = item.typeline.replace("Superior ", "");

//      if(name === "Oba's Cursed Trove" && tier == 7 && typeline === "Underground Sea Map") {
//        // poe.ninja bug workaround
//        typeline = "Primordial Blocks Map";
//      }

      var identifier = `${name} T${tier} ${typeline}`;
      var value = rates["UniqueMap"][identifier] * (item.stacksize || 1);
      if(!value) {
        //logger.info(`Could not find value for ${identifier}, item follows`);
        //logger.info(item.rawdata);
        return 0;
      } else {
        //console.log(`${identifier} => ${value}`);
        return value;
      }
    }

    function getUniqueItemValue() {

      var identifier = item.name || Constants.getItemName(item.icon);

      if(identifier === "Grand Spectrum" || identifier === "Combat Focus") {
        identifier += ` ${item.typeline}`;
      } else if(identifier === "Impresence") {
        var variant = item.icon.replace("https://web.poecdn.com/image/Art/2DItems/Amulets/Elder", "").replace(".png", "");
        identifier += ` (${variant})`;
      }

      var links = getLinks(item.parsedItem);
      identifier += links;
      identifier += getAbyssSockets(item, identifier);

      var value;

      if(item.identified === 0) {
        var arr;
        if(identifier === "Agnerod") {
          arr = [
            `Agnerod East${links}`,
            `Agnerod North${links}`,
            `Agnerod South${links}`,
            `Agnerod West${links}`
          ];
        } else if(identifier === "Atziri's Splendour") {
          arr = [
            `Atziri's Splendour${links} (Armour)`,
            `Atziri's Splendour${links} (Armour/ES)`,
            `Atziri's Splendour${links} (Armour/ES/Life)`,
            `Atziri's Splendour${links} (Armour/Evasion)`,
            `Atziri's Splendour${links} (Armour/Evasion/ES)`,
            `Atziri's Splendour${links} (ES)`,
            `Atziri's Splendour${links} (Evasion)`,
            `Atziri's Splendour${links} (Evasion/ES)`,
            `Atziri's Splendour${links} (Evasion/ES/Life)`
          ];
        } else if(identifier === "Yriel's Fostering") {
          arr = [
            `Yriel's Fostering${links} (Bleeding)`,
            `Yriel's Fostering${links} (Maim)`,
            `Yriel's Fostering${links} (Poison)`
          ];
        } else if(identifier === "Doryani's Invitation") {
          arr = [
            `Doryani's Invitation (Cold)`,
            `Doryani's Invitation (Fire)`,
            `Doryani's Invitation (Lightning)`,
            `Doryani's Invitation (Physical)`
          ];
        } else if(identifier === "Volkuur's Guidance") {
          arr = [
            `Volkuur's Guidance (Cold)`,
            `Volkuur's Guidance (Fire)`,
            `Volkuur's Guidance (Lightning)`
          ];
        } else if(identifier === "Vessel of Vinktar") {
          arr = [
            "Vessel of Vinktar (Added Attacks)",
            "Vessel of Vinktar (Penetration)",
            "Vessel of Vinktar (Added Spells)",
            "Vessel of Vinktar (Conversion)"
          ];
        }
        if(arr) {
          value = getValueUnidWithVariants(arr);
        }
      }

      if(!value) value = rates["UniqueItem"][identifier];

      if(!value) {
        //logger.info(`Could not find value for ${identifier}, item follows`);
        //logger.info(item.rawdata);
        return 0;
      } else {
        
        //console.log(`${identifier} => ${value}`);
        return value * (item.stacksize || 1);
      }

    }

    function getValueUnidWithVariants(arr) {

      var min = 9999999;
      var max = -1;

      arr.forEach(ident => {
        var val = rates["UniqueItem"][ident];
        if(val < min) min = val;
        if(val > max) max = val;
      })

      return (min + max) / 2;

    }

    function getLinks(item) {
      var sockets = ItemData.getSockets(item);
      for(var i = 0; i < sockets.length; i++) {
        if(sockets[i].length >= 5) {
          return ` ${sockets[i].length}L`;
        }
      }
      return "";
    }

    function getAbyssSockets(identifier) {

      const abyssItems = [
        "Bubonic Trail",
        "Tombfist",
        "Lightpoacher",
        "Shroud of the Lightless"
        // currently bugged on poe.ninja
        //"Hale Negator",
        //"Command of the Pit"
      ];
      if(!abyssItems.includes(identifier)) return "";

      var numAbyssSockets = item.sockets.match(/A/g).length;
      switch(numAbyssSockets) {
        case 1:
          return ` (1 Jewel)`;
          break;
        case 2:
          return ` (2 Jewels)`;
          break;
        default:
          return "";
          break;
      }

    }    

  }

  async function getCurrencyByName(timestamp, type) {
    var rates = await getRatesFor(timestamp);
    var value = rates["Currency"][type];
    if(!value) {
      //logger.info(`Could not find value for ${item.typeline}`);
      return 0;
    } else {
      //logger.info(`${type} => ${value}`);
      return value;
    }
  }

  module.exports.price = price;
  module.exports.getRatesFor = getRatesFor;
  module.exports.getCurrencyByName = getCurrencyByName;