const levenshtein = require('js-levenshtein');
const logger = require("./Log").getLogger(__filename);
const Constants = require('./Constants');

class StringMatcher {

  static getMap(str) {
    return this.getClosest(str, Constants.areas);
  }

  static getMod(str) {
    if (str.length < 10) {
      return "";
    }
    var ret = "";
    ret = this.getClosest(str, Constants.mods);
    if (ret.indexOf("#") > -1) {
      var matches = str.match(/[1-9][0-9]*/g);
      if (matches) {
        ret = ret.replace("#", matches.pop());
      } else {
        throw new Error(`No number replacement found: [${str}] -> [${ret}]`);
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
      } else if (score < minLevenshtein) {
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