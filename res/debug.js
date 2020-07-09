let RunParser = require('./modules/RunParser');
RunParser.emitter.on("logMessage", (str) => {
  $("#debugOutput").append(`${str}\r\n`);
  $("#debugOutput").scrollTop($("#debugOutput")[0].scrollHeight);    
});

function recheckGained() {
  $("#recheckGainedButton").prop("disabled", true);
  $("#debugOutput").html("");
  RunParser.recheckGained().then(() => {
    $("#recheckGainedButton").prop("disabled", false);
    $("#debugOutput").append(`Done.`);
  });
}