const levenshtein = require('js-levenshtein');
const logger = require("./Log").getLogger(__filename);
const Constants = require('./Constants');

var allAreas;

class StringMatcher {
  
  static getMap(str) {
    if(!allAreas) {
      allAreas = [];
      let keys = Object.keys(Constants.areas);
      for(let i = 0; i < keys.length; i++) {
        allAreas.push( ...Constants.areas[keys[i]] );
      }
    }
    return this.getClosest(str, allAreas);
  }

  static getMod(str) {
    if (str.length < 10) {
      return "";
    }
    var ret = "";
    ret = this.getClosest(str, Constants.mapMods);
    if (ret.indexOf("#") > -1) {
      var matches = str.match(/[1-9][0-9]*/g);
      if (matches) {
        ret = ret.replace("#", matches.pop());
      } else {
        var tempStr = str.replace("S", "5");
        var tempMatches = tempStr.match(/[1-9][0-9]*/g);
        if(tempMatches) {
          ret = ret.replace("#", tempMatches.pop());
        } else {
          throw new Error(`No number replacement found: [${str}] -> [${ret}]`);
        }
      }
    }
    return ret;
  }

  static getClosest(str, arr) {
    var minLevenshtein = 999;
    var ret = "";
    for (var i = 0; i < arr.length; i++) {

      var match = arr[i];
      var score = levenshtein(str.toUpperCase(), match.toUpperCase());
      if (score === 0) {
        return match;
      } else if (score < minLevenshtein || (score === minLevenshtein && match.indexOf("#") < 0) ) {
        minLevenshtein = score;
        ret = match;
      }

    }

    // don't return match if too different
    if (minLevenshtein / str.length > 0.5) {
      //logger.info("Correction factor too high (" + str + " -> " + ret + " = " + (minLevenshtein / str.length) + "), returning");
      return "";
    }

    //logger.info(`Returning [${str}] => [${ret}] with score of ${minLevenshtein} (correction factor: ${(minLevenshtein / str.length)}`);
    return ret;
  }

}



module.exports = StringMatcher;