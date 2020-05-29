const URL = require('url');
const Query = require('querystring');
const Constants = require('./Constants');
const ItemCategoryParser = require('./ItemCategoryParser');
const ItemData = require('./ItemData');
const logger = require("./Log").getLogger(__filename);
const moment = require('moment');
const momentDurationFormatSetup = require("moment-duration-format");
const zlib = require('zlib');

class Utils {
  
  static getParams(url) {
    try {
      return Query.parse(URL.parse(url).query);
    } catch (err) {
      return null;
    }
  }

  static isTown(str) {
    for(var i = 0; i < Constants.townstrings.length; i++) {
      if(str == Constants.townstrings[i]) {
        return true;
      }
    }
    if(str.endsWith("Hideout") && !str.includes("Syndicate")) {
      return true;
    }
    return false;
  }
  
  static isLabArea(str) {
    for(var i = 0; i < Constants.labAreas.length; i++) {
      if(str.includes(Constants.labAreas[i])) {
        return true;
      }
    }
    return false;
  }
  
  static getDisplayName(item, htmlDisplay = true) {
    
    let baseName = this.getBaseName(item);
    let uniqueName = this.getItemName(item.icon);
    let suffix = this.getSuffix(item);
    
    let displayName = "";
    
    if(uniqueName) {
      displayName = uniqueName + ", ";
    }
    
    if(!item.typeLine.endsWith("Map")) {
      displayName += baseName;
    } else {
      displayName += item.typeLine.replace("Superior ", "");
    }
    
    if(suffix) {
      displayName += `<br/><span class='itemSuffix'>(${suffix})</span>`;
    }
    
    return displayName;
    
  }
  
  static getBaseName(item) {
    if(item.typeLine) {
      return Utils.getBaseNameJSON(item);
    } else {
      logger.info("Invalid item format:");
      logger.info(JSON.stringify(item, null, " "));
    }
  }
  
  static getSuffix(item) {
    
    // special case for pseudo-items
    if(item.typeLine === "6-link Items" || item.typeLine === "6-socket Items" ) {
      return "";
    }
    
    if(item.frameType === 4) {  // skill gems
      
      var suffix = "";
      var name = item.typeLine.replace("Superior ", "");
      var level = ItemData.getGemLevel(item);
      var quality = ItemData.getQuality(item);
      
      switch(name) {
        case "Empower Support":
        case "Enlighten Support":
        case "Enhance Support":
          if(level >= 2) {
            return `Level ${level}`;
          }
          break;
        default:
          if(level >= 20 || (name === "Brand Recall" && level >= 6) ) {
            suffix += `Level ${level}`;
          }
          if(quality >= 20) {
            suffix += `${(suffix ? ", " : "")}${quality}% Quality`;
          }
          return suffix;
          break;
      }      
      
    } else if(item.icon.includes("Helmets") && item.enchantMods) {  //enchanted helmets
      
      return `${item.enchantMods[0]}`;
      
    } else if(item.typeLine.endsWith("Map")) {
      
      for(let i = 0; i < item.properties.length; i++) {
        let prop = item.properties[i];
        if(prop.name === "Map Tier") {
          return `T${prop.values[0][0]}`;
        }
      }
      return "";
      
    } else if(item.typeLine === "Ivory Watchstone") {
      
      if(!item.identified) {
        var name = this.getItemName(item.icon);
        if(Constants.watchstoneMaxCharges[name]) {
          return `${Constants.watchstoneMaxCharges[name]} uses remaining`;
        };
      } else {
        for(var i = 0; i < item.explicitMods.length; i++) {
          var mod = item.explicitMods[i];
          if(mod.endsWith("uses remaining")) {
            return mod;
            break;
          }
        }
      }      
      
    } else {
      
      // suffix only displayed for normal, magic, rare, unique equipment
      if(!ItemCategoryParser.isNonStackable(item.typeLine) || item.frameType > 3) {
        return "";
      }
      
      let suffixes = [];
      
      // ilvl and influence are irrelevant for uniques
      if(item.frameType !== 3) {
        if(item.influences) {
          Object.keys(item.influences).forEach(inf => suffixes.push(`${inf.charAt(0).toUpperCase()}${inf.slice(1)}`));
        }
        if(item.frameType !== 3 && item.ilvl && item.ilvl >= 82) {
          suffixes.push(`Lvl ${item.ilvl}`);
        }
      }
      
      var sockets = ItemData.getSockets(item);
      for(var i = 0; i < sockets.length; i++) {
        if(sockets[i].length >= 5) {
          suffixes.push(`${sockets[i].length}L`);
        }
      }
      
      return suffixes.join(", ");
      
    }
      
  }
  
  // for items in JSON format
  static getBaseNameJSON(item) {
    
    // 3.10 clean basetype finally included in itemdata hallelujah!!!!!!
    if(item.extended && item.extended.baseType) {
      return item.extended.baseType;
    }
    
    var name = item.typeLine.replace("Superior ", "");
    if(item.frameType === 3 && item.typeLine.endsWith(" Map")) {
      name = (item.identified ? item.name : this.getUniqueMap(name));
    } else if (item.identified && item.frameType === 1 && item.typeLine.includes(" Map")) {
      name = this.getBaseFromMagicMap(name);
    }
    return name;
  }

  static getUniqueMap(m) {
    return Constants.uniqueMaps[m.replace('Superior ', '')];
  }

  static getBaseFromMagicMap(m) {
    var baseMap = "";
    for (var i = 0; i < Constants.baseMaps.length; i++) {
      var elder = "Elder " + Constants.baseMaps[i];
      var shaped = "Shaped " + Constants.baseMaps[i];
      var blighted = "Blighted " + Constants.baseMaps[i];
      if (m.indexOf(shaped) !== -1 && shaped.length > baseMap.length) {
        baseMap = shaped;
      } else if (m.indexOf(elder) !== -1 && elder.length > baseMap.length) {
        baseMap = elder;
      } else if (m.indexOf(blighted) !== -1 && blighted.length > baseMap.length) {
        baseMap = blighted;
      } else if (m.indexOf(Constants.baseMaps[i]) !== -1 && Constants.baseMaps[i].length > baseMap.length) {
        baseMap = Constants.baseMaps[i];
      }
    }
    return baseMap;
  }
  
  static getDeathCount(deaths) {
    return (deaths == 0 ? "-" : (deaths <= 6 ? "&#x1f480;".repeat(deaths) : `&#x1f480; x ${deaths}`));
  }
  
  static getMapTierString(map) {
    if(map.depth) {
      return `D${map.depth}`;
    } else if(map.level) {
      return (map.level <= 67 ? `L${map.level}` : `T${map.level-67}`);
    } else {
      return "";      
    }
  }
  
  static formatSignedNumber(n, parens = false) {
    var f = new Intl.NumberFormat();
    var sign = (n > 0 ? "+" : "");
    var css = (n < 0 ? "negative" : "positive");
    return `<span class='${css}'>${parens ? '(' : ''}${sign}${f.format(n)}${parens ? ')' : ''}</span>`;
  }
  
  static getItemValue(item, rates) {
    
    // SSF - no item values
    if(!rates) return 0;
    
    var value = 0;
    
    if(item.sockets) {
      var sockets = (typeof item.sockets === "string" ? item.sockets : Utils.getSockets(item));
      if(sockets.replace(/[DV\- ]/g, "").length === 6) {
        if(sockets.replace(/[RGBWDV ]/g, "").length === 5) {
          value = rates["Divine Orb"];
        } else {
          value = 7 * rates["Jeweller's Orb"];
        }
      } else {
        var s = sockets.replace(/-/g, "");
        if(s.includes("RGB") || s.includes("RBG") || s.includes("BGR") || s.includes("BRG") || s.includes("GRB") || s.includes("GBR")) {
          value = rates["Chromatic Orb"];
        }
      }
    }
    
    if(!value) {
      var name = Utils.getBaseName(item);
      var stacksize = (item.stacksize || item.stackSize || 1);
      
      // item names requiring special handling
      
      switch(name) {
        case "Chaos Orb":
          value = stacksize;
          break;
        case "The Beachhead":
          for(var i = 0; i < item.properties.length; i++) {
            var prop = item.properties[i];
            if(prop.name === "Map Tier") {
              value = rates[`${name} (T${prop.values[0][0]})`];
              break;
            }
          }
          break;
        case "A Master Seeks Help":
          var masters = ["Alva", "Niko", "Einhar", "Jun", "Zana"];
          for(var i = 0; i < masters.length; i++) {
            if(item.prophecyText && item.prophecyText.includes(masters[i])) {
              value = rates[`${name} (${masters[i]})`];
              break;
            }
          }
          break;
        case "Rebirth":
        case "The Twins":
          value = rates[`${name} (${item.prophecyText ? "Prophecy" : "Divination Card"})`] * stacksize;
          break;
        default:
          value = rates[name] * stacksize;
          break;
      }
      
    }
    
    return (value ? Number(value.toFixed(2)) : 0);
    
  }
  
  static addMapRow(param) {
    
    var map = param.data;

    var row = $("<tr class='mapRow'>");
    
    if(param.modal) {
      row.click(()=>{
        window.open(`map.html?id=${map.id}&modal=true`);
      });
    } else {
      row.click(()=>{
        window.location.href=`map.html?id=${map.id}`;
        //window.open(`map.html?id=${map.id}`); 
      });
    }

    var timestamp = moment(map.id, "YYYYMMDDHHmmss").format("YYYY-MM-DD HH:mm:ss");
    row.append($("<td>").append(timestamp));

    row.append($("<td>").append(map.name));

    var tier = Utils.getMapTierString(map);
    row.append($("<td>").append(tier));

    row.append($("<td>").append(map.iiq ? `+${map.iiq}%` : ''));
    row.append($("<td>").append(map.iir ? `+${map.iir}%` : ''));
    row.append($("<td>").append(map.packsize ? `+${map.packsize}%` : ''));

    var runningTime = Utils.getRunningTime(map.firstevent, map.lastevent);
    row.append($("<td>").append(runningTime));
    
    var xpRate = (map.xpgained > 0 ? Utils.getXPRate(map.xpgained, map.firstevent, map.lastevent) : "-");
    row.append($("<td>").append(xpRate));
    
    if(!param.ssf) {
      row.append($("<td>").append(Number(map.gained).toFixed(2)));
    }
    
    if(!param.hardcore) {
      var deaths = Utils.getDeathCount(map.deaths);
      row.append($("<td>").append(deaths));
    }

    row.append($("<td>").append(map.kills > 0 ? (new Intl.NumberFormat()).format(map.kills) : "-"));

    if(param.first) {
      param.table.prepend(row);
    } else {
      param.table.append(row);
    }

  }
  
  static getSockets(item) {

    if (!item.sockets)
      return null;

    var sockets = item.sockets;

    var currGroup = 0;
    var currSockets = "";
    var str = "";

    sockets.forEach((sock) => {
      if (sock.group === currGroup) {
        if (currSockets.length > 0)
          currSockets += "-";
        currSockets += sock.sColour;
      } else {
        str += (str.length > 0 ? " " : "") + currSockets;
        currGroup = sock.group;
        currSockets = sock.sColour;
      }
    });

    str += (str.length > 0 ? " " : "") + currSockets;

    return str;

  }
  
  static getRunningTime(firstevent, lastevent, format = null) {
    return moment.duration(moment(lastevent, "YYYYMMDDHHmmss").diff(moment(firstevent, "YYYYMMDDHHmmss"))).format(format);
  }

  static getXPRate(xp, firstevent, lastevent) {
    var time = moment.duration(moment(lastevent, "YYYYMMDDHHmmss").diff(moment(firstevent, "YYYYMMDDHHmmss"))).format("s", {useGrouping: false});
    var f = new Intl.NumberFormat();
    return f.format(Math.round(xp * 3600 / time));
  }


  static compress(data) {
    var json = JSON.stringify(data);
    return new Promise((resolve, reject) => {
      zlib.deflate(json, (err, buffer) => {
        if(err) {
          logger.info(`Error compressing JSON data: ${err}`);
          throw err;
        } else {
          logger.info(`JSON data successfully compressed (${json.length} to ${buffer.length} bytes)`);
          resolve(buffer);
        }
      });
    });
  }
  
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  static getItemName(icon) {
    if(icon.includes("?")) {
      icon = icon.substring(0, icon.indexOf("?"));
    }
    // unique flasks have encoded URLs, need to extract flask ID
    if(icon.includes("https://web.poecdn.com/gen/image/")) {
      var jsonData = this.getBase64EncodedData(icon);
      
      if(jsonData.f.includes("/Flasks/")) {
        return getFlaskName(jsonData.f);
      } else if(jsonData.f.includes("/Maps/")) {
        return getUniqueMapName(jsonData.f);
      } else {
        logger.info(`Invalid icon data found: ${jsonData.f}`);
        return null;
      }
      
    } else {
      return Constants.uniqueIcons[icon] || null;
    }
    
    function getFlaskName(str) {
      // 3.10 icon url generation changed - 2 part replace required now
      var flaskId = str.replace("Art/", "").replace("2DItems/Flasks/", "");
      return Constants.uniqueFlasks[flaskId] || null;
    }

    function getUniqueMapName(str) {
      var mapId = str.replace("Art/", "").replace("2DItems/Maps/", "");
      return Constants.uniqueMaps[mapId] || null;
    }
    
  }
  
  static getBase64EncodedData(iconURL) {
    var str = iconURL.replace("https://web.poecdn.com/gen/image/", "");
    str = str.substr(0, str.indexOf("/"));
    return (JSON.parse(Buffer.from(str, "base64").toString("utf8")))[2];
  }

  static getTempleRoom(q) {
    return Constants.templeRoomQuotes[q] || null;
  }  
  
  static getRequestParams(path, poesessid) {
    
    let app = require('electron').app || require('electron').remote.app;
    let params = {
      hostname: 'www.pathofexile.com',
      path: path,
      method: 'GET',
      headers: {
        "User-Agent": `exile-diary/${app.getVersion()}`,
        "Referer": 'http://www.pathofexile.com/',
        "Cookie": `POESESSID=${poesessid}`
      }
    };    
    
    return params;
    
  }
  
  static getPseudoItem(itemType) {
    switch(itemType) {
      case "6L":
        return {
          "pseudo": true,
          "w": 1,
          "h": 1,
          "icon": "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyModValues.png?scale=1&scaleIndex=0",
          "id": "6L",
          "name": "6-link Items",
          "typeLine": "6-link Items",
          "ilvl": 0,
          "frameType": 5
        };
      case "6S":
        return {
          "pseudo": true,
          "w": 1,
          "h": 1,
          "icon": "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyRerollSocketNumbers.png?scale=1&scaleIndex=0",
          "id": "6S",
          "name": "6-socket Items",
          "typeLine": "6-socket Items",
          "ilvl": 0,
          "frameType": 5
        };
      case "GCP":
        return {
          "pseudo": true,
          "w": 1,
          "h": 1,
          "icon": "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyGemQuality.png?scale=1&scaleIndex=0",
          "id": "GCP",
          "name": "20% quality Gems",
          "typeLine": "20% quality Gems",
          "ilvl": 0,
          "frameType": 5
        };
      case "RGB":
        return {
          "pseudo": true,
          "w": 1,
          "h": 1,
          "icon": "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyRerollSocketColours.png?scale=1&scaleIndex=0",
          "id": "RGB",
          "name": "R-G-B linked Items",
          "typeLine": "R-G-B linked Items",
          "ilvl": 0,
          "frameType": 5
        };
      default:
        throw new Exception(`Invalid pseudo item ${itemType}`);
    }
  }

}



module.exports = Utils;