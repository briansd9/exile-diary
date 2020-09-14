let RunParser = require('./modules/RunParser');
let debugLogger = require('./modules/Log').getLogger(__filename);

RunParser.emitter.on("logMessage", (str) => {
  debugLog(str);
});

function debugLog(str) {
  debugLogger.info(str);
  $("#debugOutput").append(`${str}\r\n`);
  $("#debugOutput").scrollTop($("#debugOutput")[0].scrollHeight);    
}

function recheckGained() {
  $("#recheckGainedButton").prop("disabled", true);
  $("#debugOutput").html("");
  RunParser.recheckGained().then(() => {
    $("#recheckGainedButton").prop("disabled", false);
    $("#debugOutput").append(`Done.`);
  });
}

function checkGearDuplicates() {
  
  $("#debugOutput").html("");
  let DB = require('./modules/DB').getDB();
  let itemsEqual = require('./modules/GearChecker').itemsEqual;
  
  DB.all(" select timestamp, diff from gear ", (err, rows) => {
    if(rows) {
      for(let a = 0; a < rows.length; a++) {
        debugLog(`Checking ${a+1} of ${rows.length}`);
        let row = rows[a];
        let hasDiff = false;
        let diff = JSON.parse(row.diff);
        let keys = Object.keys(diff);
        keys.forEach( key => {
          let gearSlot = diff[key];
          if(gearSlot.prev && gearSlot.curr) {
            if(Array.isArray(gearSlot.prev)) {
              for(let i = gearSlot.prev.length - 1; i > -1; i--) {
                for(let j = gearSlot.curr.length - 1; j > -1; j--) {
                  let prevObj = gearSlot.prev[i];
                  let currObj = gearSlot.curr[j];
                  if(itemsEqual(prevObj, currObj)) {
                    gearSlot.prev.splice(i, 1);
                    gearSlot.curr.splice(j, 1);
                    hasDiff = true;
                  }
                }
              }
              if(gearSlot.prev.length === 0 && gearSlot.curr.length === 0) {
                debugLog(`${row.timestamp} : Multi gear slot ${key} contains no changes, deleting`);
                delete diff[key];
                hasDiff = true;
              }
              
            } else {
              if(itemsEqual(gearSlot.prev, gearSlot.curr)) {
                debugLog(`${row.timestamp} : Items in gear slot ${key} not actually different, deleting`);
                delete diff[key];
                hasDiff = true;
              }
            }
          }
        });
        if(hasDiff) {
          let str = JSON.stringify(diff);
          if(str === "{}") {
            debugLog("Diff is now empty, deleting");
            DB.run("delete from gear where timestamp = ?", [row.timestamp], (err) => {
              if(err) {
                debugLog("Failed to delete diff: " + err);
              } else {
                debugLog("Empty diff successfully deleted");
              }
            })
          } else {
            debugLog("Updating diff");
            DB.run("update gear set diff = ? where timestamp = ?", [JSON.stringify(diff), row.timestamp], (err) => {
                if(err) {
                  debugLog("Failed to update diff: " + err);
                } else {
                  debugLog("Diff successfully updated");
                }
            });
          }
        }
      }
    }
    debugLog("Done.");
  });
  
}