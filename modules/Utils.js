const URL = require('url');
const Query = require('querystring');
const Constants = require('./Constants');
const logger = require("./Log").getLogger(__filename);
const moment = require('moment');
const momentDurationFormatSetup = require("moment-duration-format");

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
      if(str.includes(Constants.townstrings[i])) {
        return true;
      }
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
  
  static getBaseName(item) {
    if(item.typeLine) {
      return Utils.getBaseNameJSON(item);
    } else if(item.typeline) {
      return Utils.getBaseNameDB(item);
    } else {
      logger.info("Invalid item format:");
      logger.info(JSON.stringify(item, null, " "));
    }
  }

  // for items in JSON format
  static getBaseNameJSON(item) {
    var name = item.typeLine.replace("Superior ", "");
    if(item.frameType === 3 && item.typeLine.endsWith(" Map")) {
      name = (item.identified ? item.name : this.getUniqueMap(name));
    }
    if (item.identified && item.frameType === 1 && item.typeLine.includes(" Map")) {
      name = this.getBaseFromMagicMap(name);
    }
    return name;
  }

  // for items in DB row format
  static getBaseNameDB(item) {
    var name = item.typeline.replace("Superior ", "");
    if (!item.identified && item.rarity === "Unique" && item.typeline.endsWith(" Map")) {
      name = this.getUniqueMap(name);
    } else if (item.identified && item.rarity === "Magic" && item.typeline.includes(" Map")) {
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
      if (m.indexOf(shaped) !== -1 && shaped.length > baseMap.length) {
        baseMap = shaped;
      } else if (m.indexOf(elder) !== -1 && elder.length > baseMap.length) {
        baseMap = elder;
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
  
  static formatSignedNumber(n) {
    var f = new Intl.NumberFormat();
    var sign = (n > 0 ? "+" : "");
    var css = (n < 0 ? "negative" : "positive");
    return `<span class='${css}'>${sign}${f.format(n)}</span>`;
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
    } else {
      var name = Utils.getBaseName(item);
      var stacksize = (item.stacksize || item.stackSize || 1);
      if (name === "Chaos Orb") {
        value = stacksize;
      } else if(rates[name]) {
        value = rates[name] * stacksize;
      }
    }
    
    return (value ? Number(value.toFixed(2)) : 0);
    
  }
  
  static addMapRow(rowsObject, map, first = false, ssf = false) {

    var row = $("<tr class='mapRow'>");
    row.click(()=>{
      window.location.href=`map.html?id=${map.id}`
      //window.open(`map.html?id=${map.id}`); 
    });

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
    
    if(!ssf) {
      row.append($("<td>").append(Number(map.gained).toFixed(2)));
    }
    
    var deaths = Utils.getDeathCount(map.deaths);
    row.append($("<td>").append(deaths));

    if(first) {
      rowsObject.prepend(row);
    } else {
      rowsObject.append(row);
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
  
  static getRunningTime(firstevent, lastevent) {
    return moment.duration(moment(lastevent, "YYYYMMDDHHmmss").diff(moment(firstevent, "YYYYMMDDHHmmss"))).format();
  }

  static getXPRate(xp, firstevent, lastevent) {
    var time = moment.duration(moment(lastevent, "YYYYMMDDHHmmss").diff(moment(firstevent, "YYYYMMDDHHmmss"))).format("s", {useGrouping: false});
    var f = new Intl.NumberFormat();
    return f.format(Math.round(xp * 3600 / time));
  }

}




module.exports = Utils;