  const logger = require('./Log').getLogger(__filename);
  const Constants = require('./Constants');
  const ItemData = require('./ItemData');
  const ItemCategoryParser = require("./ItemCategoryParser");
  const ItemParser = require('./ItemParser');
  const ItemFilter = require('./ItemFilter');
  const Utils = require('./Utils');
  const zlib = require('zlib');  
  const settings = require('./settings').get();  

  const baseTypeRarities = ["Normal", "Magic", "Rare"];
  const nonPricedCategories = [
    // captured beasts are not acquired as map loot
    // might be relevant for calculating net worth though?
    "Captured Beast",
      // value not tracked for heist items
    "Contract",
    "Blueprint",
    "Trinket",
    "Heist Brooch",
    "Heist Cloak",
    "Heist Gear",
    "Heist Tool"      
  ];

  const log = false;
  
  var ratesCache = {};

  function getRatesFor(timestamp, league) {
    
    if(!league) {
      league = settings.activeProfile.league;
    }    

    if (league.includes("SSF") && !settings.activeProfile.overrideSSF) {
      return null;
    }
    
    if(!ratesCache[league]) {
      ratesCache[league] = {};
    }
    
    var date = timestamp.substring(0, 8);
    if(ratesCache[league][date]) {
      return ratesCache[league][date];
    }

    var DB = require('./DB').getLeagueDB(league);
    return new Promise((resolve, reject) => {
      DB.get("select date, data from fullrates where date <= ? or date = (select min(date) from fullrates) order by date desc", [date], async (err, row) => {
        if(err) {
          logger.info(`Unable to get rates for ${date}: ${err}`);
          resolve(null);
        } else {
          if(!row || !row.data) {
            logger.info(`No rates found for ${date}`);
            resolve(null);
          } else {
            zlib.inflate(row.data, (err, buffer) => {
              if(err) {
                // old data - compression not implemented yet, just parse directly
                ratesCache[league][row.date] = JSON.parse(row.data);
              } else {
                ratesCache[league][row.date] = JSON.parse(buffer);
              }
              resolve(ratesCache[league][row.date]);
            });
          }
        }
      });
    });
  }

  async function price(item, league) {
    
    // Absolutely unreasonable amounts of pricing trouble. Enough of this!
    if(item.typeline === "Rogue's Marker") {
      return 0;
    }
    
    if(item.rarity === "Quest Item") {
      // can't be traded
      return 0;
    }
    if(nonPricedCategories.includes(item.category)) {
      return 0;
    }
    
    let rates = await getRatesFor(item.event_id, league);
    if(!rates) {
      return 0;
    }
    
    item.parsedItem = JSON.parse(item.rawdata);
    
    var minItemValue = 0;
    var filter = ItemFilter.filter(item.parsedItem);
    if(filter && filter.ignore) {
      if(filter.minValue) {
        if(filter.option && filter.option === "fullStack" && item.parsedItem.maxStackSize) {
          // logger.info(`Minvalue is ${filter.minValue}, stacksize of ${item.parsedItem.typeLine} is ${item.parsedItem.maxStackSize}, minvalue per card is ${filter.minValue/item.parsedItem.maxStackSize}`);
          minItemValue = filter.minValue / item.parsedItem.maxStackSize;
        } else {
          minItemValue = filter.minValue;
        }
      } else {
        // unconditional ignore - stop here and get vendor recipe instead, if any
        return getVendorRecipeValue();
      }
    }
    
    if(item.typeline.includes("Watchstone")) {
      return getWatchstoneValue();      
    }    
    
    var helmetBaseValue;

    if(item.rarity === "Unique") {
      if(item.category === "Maps") {
        return getUniqueMapValue();
      } else {
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
    
    if(item.typeline.includes("Maven's Invitation")) {
      return getValueFromTable("Invitation");
    }    
    if(
      item.category === "Map Fragments" 
      || (item.category === "Labyrinth Items" && item.typeline.endsWith("to the Goddess")) 
      || item.typeline === "Simulacrum Splinter" 
      || item.typeline === "Crescent Splinter" 
      || (item.typeline.includes("Timeless") && item.typeline.includes("Splinter"))
      || (item.typeline.startsWith("Splinter of"))
    ) {
      return getValueFromTable("Fragment");
    }
    if(item.category === "Harvest Seed") {
      return getSeedValue();
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
    if(item.category && item.category.includes("Skill Gems")) {
      return getGemValue();
    }

    if(baseTypeRarities.includes(item.rarity) && Constants.baseTypeCategories.includes(item.category)) {
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

    logger.info(`Unable to get value for item ${item.id || "(no id)"}:`);
    logger.info(JSON.stringify(item.parsedItem));
    return 0;
    
    /* sub-functions for getting value per item type*/    

    function getValueFromTable(table, identifier = null) {
      
      // RIP harvest :-(
      if(table === "Seed") return 0;
      
      if(!rates[table]) {
        logger.info(`No price list found for category ${table}, returning 0`);
        return 0;
      }
      
      if(!identifier) {
        identifier = item.typeline;
      }
      
      // special handling for currency shards - always price at 1/20 of the whole orb
      if(Constants.shardTypes[identifier]) {
        let wholeOrb = Constants.shardTypes[identifier];
        let shardValue = rates[table][wholeOrb] / 20;
        let stackValue = shardValue * item.stacksize;
        if(log) {
          if(shardValue >= minItemValue) {
            logger.info(`[${table}] : ${identifier} => ${shardValue} x ${item.stacksize} = ${stackValue}`);
          } else {
            logger.info(`[${table}] : ${identifier} => ${shardValue} < ${minItemValue}, ignoring`);
          }
        }
        return(shardValue >= minItemValue ? stackValue : 0);
      }
      
      if(settings.alternateSplinterPricing && Constants.fragmentTypes[identifier]) {
        let f = Constants.fragmentTypes[identifier];
        let splinterValue = rates[f.itemType || "Fragment"][f.item] / f.stackSize;
        let stackValue = splinterValue * item.stacksize;
        if(splinterValue >= minItemValue) {
          logger.info(`Using alternate splinter pricing : ${identifier} => ${splinterValue} x ${item.stacksize} = ${stackValue}`);
        } else {
          logger.info(`Using alternate splinter pricing : ${identifier} => ${splinterValue} < ${minItemValue}, ignoring`);
        }
        return(splinterValue >= minItemValue ? stackValue : 0);
      }      
      
      // handle items that stack - minItemValue is for exactly 1 of the item
      let unitValue = rates[table][identifier];
      
      if(!unitValue) {
        if(log) {
          logger.info(`[${table}] : ${identifier} => No value found, returning 0`);
        }
        return 0;
      } else if(unitValue < minItemValue) {
        if(log) {
          logger.info(`[${table}] : ${identifier} => ${unitValue} < ${minItemValue}, ignoring`);
        }
        return 0;
      }
      
      let value = unitValue * (item.stacksize || 1);
      if(log) {
        if(value >= minItemValue) {
          logger.info(`[${table}] : ${identifier} => ${value}`);            
        } else {
          logger.info(`[${table}] : ${identifier} => ${value} < ${minItemValue}, ignoring`);
        }
      }
      return(value >= minItemValue ? value : 0);

    }
    
    function getHelmetEnchantValue() {
      if(!item.parsedItem.enchantMods) return 0;
      var identifier = item.parsedItem.enchantMods;
      return getValueFromTable("HelmetEnchant", identifier);      
    }    

    function getWatchstoneValue() {
      var identifier = ( item.rarity === "Magic" ? Utils.getWatchstoneBaseType(item.typeline) : (item.name || Utils.getItemName(item.icon)) );
      if(!item.identified) {
        if(Constants.watchstoneMaxCharges[identifier]) {
          identifier += `, ${Constants.watchstoneMaxCharges[identifier]} uses remaining`;
        };
      } else {
        for(var i = 0; i < item.parsedItem.explicitMods.length; i++) {
          var mod = item.parsedItem.explicitMods[i];
          if(mod.endsWith("uses remaining")) {
            identifier += `, ${mod}`;
            break;
          }
        }
      }
      return getValueFromTable("Watchstone", identifier);
    }

    function getGemValue() {
      
      let typeline = item.typeline.replace("Superior ", "");
      let level = ItemData.getGemLevel(item.parsedItem);
      let quality = ItemData.getQuality(item.parsedItem);
      let corrupted = item.parsedItem.corrupted;      
      let identifier = getFullGemIdentifier(typeline, level, quality, corrupted);
      
      let value = getValueFromTable("SkillGem", identifier);      
      if(!value && item.parsedItem.hybrid && item.parsedItem.hybrid.baseTypeName) {
        let altIdentifier = getFullGemIdentifier(item.parsedItem.hybrid.baseTypeName, level, quality, corrupted);
        value = value = getValueFromTable("SkillGem", altIdentifier);
      }
      
      let vendorValue = getVendorRecipeValue();
      return(vendorValue ? Math.max(value, vendorValue.val) : value);
      
    }
    
    function getFullGemIdentifier(str, level, quality, corrupted) {
      switch(str) {
        case "Empower Support":
        case "Enlighten Support":
        case "Enhance Support":
          if(level >= 2) str += ` L${level}`;
          break;
        case "Brand Recall":
          if(level >= 6) str += ` L${level}`;
          if(quality >= 20) str += ` Q${quality}`;
          break;
        default:
          if(level >= 20) str += ` L${level}`;
          if(quality >= 20) {
            str += ` Q${quality}`;
          }
          break;
      }
      if(corrupted) {
        str += " (Corrupted)";
      }
      return str;
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
      // workaround poe.ninja bug
      var tempIdentifier = identifier.replace("Delirium", "Delerium");
      return getValueFromTable("Map", identifier) || getValueFromTable("Map", tempIdentifier);

      function getSeries(icon) {
        
        if(icon.includes("https://web.poecdn.com/gen/image/")) {
          return getSeriesBase64(icon);          
        }
        
        if(icon.includes("mn=")) {
          if(icon.includes("mn=1")) return "Atlas2-3.4";
          if(icon.includes("mn=2")) return "Atlas2";
          if(icon.includes("mn=3")) return "Synthesis";
          if(icon.includes("mn=4")) return "Legion";
          if(icon.includes("mn=5")) return "Blight";
          if(icon.includes("mn=6")) return "Metamorph";
          if(icon.includes("mn=7")) return "Delirium";
          if(icon.includes("mn=8")) return "Harvest";
          if(icon.includes("mn=9")) return "Heist";
          if(icon.includes("mn=10")) return "Ritual";
          if(icon.includes("mn=11")) return "Expedition";
        } else {
          if(icon.includes("2DItems/Maps/AtlasMaps")) return "Atlas";
          if(icon.includes("2DItems/Maps/Map")) return "Pre 2.4";
          if(icon.includes("2DItems/Maps/act4maps")) return "Pre 2.0";
        }
        logger.info(`Invalid map item icon: ${icon}`);
        return "";
      }
      
    }
    
    function getSeriesBase64(icon) {
      
      var data = Utils.getBase64EncodedData(icon);
      
      if(data.mn) {
        switch(data.mn) {
          case 1: return "Atlas2-3.4";
          case 2: return "Atlas2";
          case 3: return "Synthesis";
          case 4: return "Legion";
          case 5: return "Blight";
          case 6: return "Metamorph";
          case 7: return "Delirium";
          case 8: return "Harvest";
          case 9: return "Heist";
          case 10: return "Ritual";
          case 11: return "Expedition";
        }
      } else {
        if(data.f.includes("2DItems/Maps/AtlasMaps")) return "Atlas";
        if(data.f.includes("2DItems/Maps/Map")) return "Pre 2.4";
        if(data.f.includes("2DItems/Maps/act4maps")) return "Pre 2.0";
      }
      
      logger.info(`Invalid map item icon: ${icon}`);
      return "";
      
    }
    
    function getSeedValue() {

      var identifier = item.typeline + (getSeedLevel() >= 76 ? " L76+" : "");
      return getValueFromTable("Seed", identifier);
      
      function getSeedLevel() {
        for(let i = 0; i < item.parsedItem.properties.length; i++) {
          let prop = item.parsedItem.properties[i];
          if(prop.name === "Spawns a Level %0 Monster when Harvested") {
            return prop.values[0][0];
          }
        }
      }

    }
    

    function getBaseTypeValue() {

      if(item.parsedItem.ilvl < 82) {
        return getVendorRecipeValue();
      }

      var identifier = item.typeline.replace("Superior ", "");
      if(identifier.endsWith("Talisman")) return 0;

      if(item.rarity === "Magic" && item.identified) {
        // strip affixes from magic item name
        identifier = ItemCategoryParser.getEquipmentBaseType(identifier);
      }
      identifier += ` L${item.parsedItem.ilvl > 86 ? 86 : item.parsedItem.ilvl}`;
      if(item.parsedItem.influences) {
        let inf = item.parsedItem.influences;
        if(inf.shaper) {
          identifier += " Shaper";  
        } else if(inf.elder) {
          identifier += " Elder";  
        } else if(inf.crusader) {
          identifier += " Crusader";  
        } else if(inf.redeemer) {
          identifier += " Redeemer";  
        } else if(inf.warlord) {
          identifier += " Warlord";  
        } else if(inf.hunter) {
          identifier += " Hunter";  
        }
      }

      let value = getValueFromTable("BaseType", identifier);
      let vendorValue = getVendorRecipeValue();
      return(vendorValue ? Math.max(value, vendorValue.val) : value);

    }
    
    function getVendorRecipeValue() {
      
      var vendorValue;
      
      var sockets = ItemData.getSockets(item.parsedItem);
      if(sockets.length) {
        if(ItemData.countSockets(sockets) === 6) {
          if(sockets.length === 1) {
            vendorValue = rates["Currency"]["Orb of Fusing"] * 20;
          } else {
            vendorValue = rates["Currency"]["Jeweller's Orb"] * 7;
          }
        } else {
          for(var i = 0; i < sockets.length; i++) {
            if(sockets[i].includes("R") && sockets[i].includes("G") && sockets[i].includes("B")) {
              vendorValue = rates["Currency"]["Chromatic Orb"];
            }
          }
        }
      } else if(item.category && item.category.includes("Skill Gems")) {
        let quality = ItemData.getQuality(item.parsedItem);
        if(quality >= 20) {
          vendorValue = rates["Currency"]["Gemcutter's Prism"];
        }
      }
      
      if(!vendorValue) {
        return 0;
      } else {
        
        let currFilter = ItemFilter.getForCategory("currency");
        if(currFilter.ignore) {
          if(currFilter.minValue) {
            if(vendorValue < currFilter.minValue) {
              if(log) {
                logger.info(`Vendor value ${vendorValue} < currency min value ${currFilter.minValue}, returning`);
              }
              return 0;
            }
          } else {
            if(log) {
              logger.info(`Ignoring currency unconditionally?!? Returning 0`);
            }
            return 0;
          }
        }

        if(log) {
          logger.info("Returning vendor value " + vendorValue);
        }
        return { isVendor: true, val: vendorValue };
        
      }
      
    }
      

    function getCurrencyValue() {
      // temporary workaround poe.ninja bug
      // if(item.typeline === "Stacked Deck") return 4 * item.stacksize;
      
      switch(item.typeline) {
        case "Chaos Orb":
          if(minItemValue > 1) {
            // if we only care about currency greater than 1c in value, chaos orbs are ignored
            return 0;
          } else {
            return item.stacksize;
          }
        case "Chaos Shard":
          if(minItemValue > 1/20) {
            return 0;
          } else {
            return item.stacksize / 20;
          }
        default:
          return getValueFromTable("Currency");
      }
      
    }

    function getUniqueMapValue() {

      var name = item.name || Utils.getItemName(item.icon);
      var tier = ItemData.getMapTier(item.parsedItem);
      var typeline = item.typeline.replace("Superior ", "");

      var identifier = `${name} T${tier} ${typeline}`;
      
      return getValueFromTable("UniqueMap", identifier);
      
    }

    function getUniqueItemValue() {

      var identifier = item.name || Utils.getItemName(item.icon) || item.typeline;

      if(identifier === "Grand Spectrum" || identifier === "Combat Focus") {
        identifier += ` ${item.typeline}`;
      } else if(identifier === "Impresence") {
        var variant = item.icon.replace("https://web.poecdn.com/image/Art/2DItems/Amulets/Elder", "").replace(".png", "");
        identifier += ` (${variant})`;
      }

      var links = getLinks(item.parsedItem);
      identifier += links;
      identifier += getAbyssSockets(identifier);

      if(item.identified === 0) {
        var arr = null;
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
          return getValueUnidWithVariants(arr);
        }
      }
      
      let value = getValueFromTable("UniqueItem", identifier);
      let vendorValue = getVendorRecipeValue();
      return(vendorValue ? Math.max(value, vendorValue.val) : value);

    }

    function getValueUnidWithVariants(arr) {

      var min = 9999999;
      var max = -1;

      arr.forEach(ident => {
        var val = rates["UniqueItem"][ident];
        if(val < min) min = val;
        if(val > max) max = val;
      });
      
      var value = (min + max) / 2;
      return(value >= minItemValue ? value : 0);

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

  async function getCurrencyByName(timestamp, type, league) {
    var rates = await getRatesFor(timestamp, league);
    if(!rates) {
      return 0;
    }
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