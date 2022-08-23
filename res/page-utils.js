
$(document).ready(() => {
  var width = require('@electron/remote').getCurrentWindow().getBounds().width;
  setZoomFactor(Math.min(width, 1100) / 1100);
});

require('electron').ipcRenderer.on("rescale", (event, f) => {
  setZoomFactor(f);
});

function setZoomFactor(f) {
  require('electron').webFrame.setZoomFactor(f);
}

function openShell(dir) {
  require("electron").shell.openExternal(dir);
}

