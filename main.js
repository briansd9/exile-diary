// Modules to control application life and create native browser window
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const logger = require("./modules/Log").getLogger(__filename);
const ClientTxtWatcher = require("./modules/ClientTxtWatcher");
const DB = require("./modules/DB");
const OCRWatcher = require("./modules/OCRWatcher");
const RateGetter = require("./modules/RateGetter");
const RunParser = require('./modules/RunParser');
const InventoryGetter = require('./modules/InventoryGetter');
const MapSearcher = require('./modules/MapSearcher');
const ScreenshotWatcher = require("./modules/ScreenshotWatcher");
const Settings = require("./modules/settings");
const { autoUpdater } = require("electron-updater");
const StashGetter = require("./modules/StashGetter");
const Utils = require("./modules/Utils");
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const activeWin = require('active-win');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let overlayWindow;

const lock = app.requestSingleInstanceLock();
if(!lock) {
  app.quit();
} else {
  // Someone tried to run a second instance, we should focus our window.
  if (mainWindow) {
    if (mainWindow.isMinimized())
      mainWindow.restore();
    mainWindow.focus();
  }
}

var characterCheckStatus;

function checkCurrentCharacterLeague() {
  
  return new Promise( async (resolve, reject) => {
    
    DB.getDB(true);
    var settings = Settings.get();
    characterCheckStatus = null;
    
    logger.info("Checking current character league...");
    if(!settings.accountName || !settings.poesessid || !settings.activeProfile || !settings.activeProfile.characterName) {
      logger.info("Can't check, info missing from settings");
      characterCheckStatus = "error";
      resolve();
    }
  
    var requestParams = {
      hostname: 'www.pathofexile.com',
      path: `/character-window/get-characters?accountName=${encodeURIComponent(settings.accountName)}`,
      method: 'GET',
      headers: {
        Referer: 'http://www.pathofexile.com/',
        Cookie: `POESESSID=${settings.poesessid}`
      }
    };

    var request = require('https').request(requestParams, (response) => {
      var body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          var foundChar = false;
          var data = JSON.parse(body);
          if(data.error && data.error.message === "Forbidden") {
            characterCheckStatus = "error";
            resolve();
          } else {
            for(var i = 0; i < data.length; i++) {
              if(data[i].name === settings.activeProfile.characterName) {
                foundChar = true;
                logger.info(JSON.stringify(data[i]));
                checkLeague(settings, data[i].league);
                characterCheckStatus = "valid";
                break;
              }
            }
            if(!foundChar) {
              characterCheckStatus = "notFound";
            }
            resolve();
          }
        } catch (err) {
          logger.info(`Error checking character status: ${err}`);
          characterCheckStatus = "error";
          resolve();
        }
      });
      response.on('error', (err) => {
        logger.info(`Error checking character status: ${err}`);
        characterCheckStatus = "error";
        resolve();
      });
    });
    request.on('error', (err) => {
      logger.info(`Error checking character status: ${err}`);
      characterCheckStatus = "error";
      resolve();
    });
    request.end();
    
  });
}

function checkLeague(settings, foundLeague) {
  
  if(settings.activeProfile.league !== foundLeague) {
    logger.info(`Updating ${settings.activeProfile.characterName} from ${settings.activeProfile.league} to ${foundLeague}`);
    settings.activeProfile.league = foundLeague;
    Settings.set("activeProfile", settings.activeProfile);
  }
  var db = DB.getDB(true);
  db.run(
    "insert into leagues(timestamp, league) values(?, ?)", 
    [moment().format('YYYYMMDDHHmmss'), foundLeague], 
    (err) => {
      if(err && err.code !== "SQLITE_CONSTRAINT") {
        logger.info(`Error inserting new league: ${JSON.stringify(err)}`);
      }
    }      
  );
}

function init() {
  
  return new Promise((resolve, reject) => {
  
    logger.info("Initializing components");

    global.messages = [];

    // remove settings file from cache, then restart all components 
    // to make sure they're using the current settings file
    var settingsPath = path.join(app.getPath("userData"), "settings.json");
    if(fs.existsSync(settingsPath)) {
      delete require.cache[require.resolve(settingsPath)];
      checkCurrentCharacterLeague().then(() => {
        logger.info("Done checking, character status is " + characterCheckStatus);
        if(characterCheckStatus === "valid") {
          logger.info("Starting components");
          DB.getDB(true);
          RateGetter.update();
          ClientTxtWatcher.start();
          ScreenshotWatcher.start();
          OCRWatcher.start();
        }
        resolve(true);
      });
    } else {
      resolve(false);
    }
    
  });


}


function initWindow(window) {
  
  var webContents = window.webContents;
  
  StashGetter.emitter.removeAllListeners();
  StashGetter.emitter.on("invalidSessionID", () => {
    addMessage(`<span class='eventText'>Unable to get stash information. Please check your POESESSID</span>`);
  });
  StashGetter.emitter.on("netWorthUpdated", (data) => {
    addMessage(
      `
        <span style='cursor:pointer;' onclick='window.location.href="stash.html";'>
        Net worth update: 
        <span class='eventText'>${data.value}</span>
        <img src='res/img/c.png' style='vertical-align:middle'>
        ${data.change === 0 ? "" : `(${Utils.formatSignedNumber(data.change)})`}
        </span>
      `,
      true
    );
  });
  
  InventoryGetter.emitter.removeAllListeners();
  InventoryGetter.emitter.on("invalidSessionID", () => {
    addMessage(`<span class='eventText'>Unable to get inventory information. Please check your POESESSID</span>`);
  });
  
  OCRWatcher.emitter.removeAllListeners();
  OCRWatcher.emitter.on("OCRError", () => {
    addMessage("Error getting area info from screenshot. Please try again", true)
  });
  OCRWatcher.emitter.on("areaInfoComplete", (info) => {
    addMessage(`Got area info for <span class='eventText'>${info.areaInfo.name}</span>`, true);
  });
  
  ScreenshotWatcher.emitter.removeAllListeners();
  ScreenshotWatcher.emitter.on("OCRError", () => {
    addMessage("Error getting area info from screenshot. Please try again", true);
  });  
  
  RunParser.emitter.removeAllListeners();
  RunParser.emitter.on("runProcessed", (run) => {
    
    StashGetter.tryGet();

    var f = new Intl.NumberFormat();
    addMessage(
      `<span style='cursor:pointer;' onclick='window.location.href="map.html?id=${run.id}";'>`      
        + `Completed run in <span class='eventText'>${run.name}</span> `
        + `(${Utils.getRunningTime(run.firstevent, run.lastevent)}`
        + (run.gained ? `, ${run.gained} <img src='res/img/c.png' style='vertical-align:middle'>` : "")
        + (run.kills ? `, ${f.format(run.kills)} kills` : "")
        + (run.xp ? `, ${f.format(run.xp)} XP` : "")
        + `)</span>`,
      true
    );
    webContents.send("runProcessed", run);
    
  });
  
  MapSearcher.emitter.removeAllListeners();
  MapSearcher.emitter.on("mapSearchResults", (rows) => {
    webContents.send("mapSearchResults", rows);
  });
  MapSearcher.emitter.on("mapSummaryResults", (data) => {
    webContents.send("mapSummaryResults", data);
  });
  
}

async function createWindow() {

  logger.info("Starting");
  
  await init();
  
  var downloadingUpdate = false;
  
  ipcMain.on("reinitialize", async (event) => {
    await init();
    event.sender.send("done-initializing");
  });
  ipcMain.on("searchMaps", (event, data) => {
    MapSearcher.search(data);
  });
  ipcMain.on("screenshotCaptured", (event, img) => {
    saveScreenshot(img);
  });
  ipcMain.on("exportSheetReady", (event, sheetData) => {
    saveExport(sheetData);
  });
  ipcMain.on("hideOverlay", () => {
    overlayWindow.hide();
  });
  ipcMain.on('download-update', function(event) {
    if(!downloadingUpdate) {
      downloadingUpdate = true;
      addMessage(`<span class='eventText'>Downloading...</span>`);
      logger.info("Now downloading update");
      autoUpdater.downloadUpdate();
    }
  });  
  ipcMain.on('apply-update', function(event) {
    logger.info("Quitting to install update");
    autoUpdater.quitAndInstall();
  });  

  require('./modules/electron-capture/src/main');

  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: `Exile Diary v${app.getVersion()}`,
    backgroundColor: `#000000`,
    show: false,
    transparent: false,
    icon: path.join(__dirname, "res/img/icons/png/64x64.png"),
    webPreferences: {
        preload: __dirname + '/modules/electron-capture/src/preload.js'
    }
  });
  
  var windowMoving;
  function saveWindowBounds() {
    clearTimeout(windowMoving);
    windowMoving = setTimeout(writeBounds, 1000);
    function writeBounds() {      
      try {
        Settings.set("mainWindowBounds", mainWindow.getBounds());
      } catch(e) {}
      // swallow exception that occurs on closing app
    }
  }
  mainWindow.on("resize", saveWindowBounds);
  mainWindow.on("move", saveWindowBounds);
  
  var windowScaling;
  function scaleWindow() {
    clearTimeout(windowScaling);
    windowScaling = setTimeout(setZoom, 250);
    function setZoom() {
      var width = mainWindow.getBounds().width;
      mainWindow.webContents.send("rescale", Math.min(width, 1100) / 1100);
    }
  }
  mainWindow.on("resize", scaleWindow);
    
  
  overlayWindow = new BrowserWindow({
    maxHeight: 40,
    x: 0,
    y: 100,
    frame: false,
    isMovable: true,
    alwaysOnTop: true,
    closable: false,
    //resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    opacity: 0.75,
    show: false,
    skipTaskbar: true
  });
  overlayWindow.loadFile("overlay.html");

  addMessage(`Exile Diary v${app.getVersion()} started`);
  
  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.on('update-available', (info) => {
    global.updateInfo = info;
    logger.info(JSON.stringify(info));
    addMessage(`<span class='eventText' style='cursor:pointer' onclick='downloadUpdate()'>An update to version ${info.version} is available, click here to download</span>`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    addMessage(`<span class='eventText' style='cursor:pointer' onclick='applyUpdate()'>Update to version ${info.version} has been downloaded, click here to install it now (requires restart)</span>`);
  });
  autoUpdater.checkForUpdates();

  // and load the index.html of the app.
  var settings = Settings.get();
  if(!settings) {
    mainWindow.loadFile('config.html');
  } else if(characterCheckStatus === "notFound") {
    global.validCharacter = false;
    addMessage(`Character <span class='eventText'>${settings.activeProfile.characterName}</span> not found in <span class='eventText'>${settings.activeProfile.league}</span> league!`);
    mainWindow.loadFile('config.html');
  } else if(characterCheckStatus === "error") {
    global.validCharacter = false;
    addMessage(`<span class='eventText'>Error getting account info. Please check your character name and POESESSID</span>`);
    mainWindow.loadFile('config.html');
  } else {
    global.validCharacter = true;
    global.ssf = (settings.activeProfile && settings.activeProfile.league && settings.activeProfile.league.includes("SSF"));
    global.hardcore = (settings.activeProfile && settings.activeProfile.league && settings.activeProfile.league.includes("Hardcore"));
    mainWindow.loadFile('index.html');
  }

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    overlayWindow.destroy();
    overlayWindow = null;
    mainWindow = null;
  });

  mainWindow.webContents.on('new-window', function(event, urlToOpen) {
    event.preventDefault();
  });  

  initWindow(mainWindow);
  
  if(settings && settings.mainWindowBounds) {
    mainWindow.setBounds(settings.mainWindowBounds);
  } else {
    mainWindow.maximize();
  }
  mainWindow.show();
    
}

function addMessage(text, sendToOverlay = false) {
    
  var msg = {
    timestamp: moment().format("YYYY-MM-DD HH:mm:ss"),
    text: text
  };
  global.messages.push(msg);
  global.messages = global.messages.slice(-10);
  mainWindow.webContents.send("message", msg);
  
  var settings = Settings.get();
  if(sendToOverlay && settings.overlayEnabled) { 
    (async () => {
      var win = await activeWin();
      if(win.title === "Path of Exile" && win.owner.name.startsWith("PathOfExile")) {
        overlayWindow.webContents.send("message", msg);
        overlayWindow.show();
      }
    })();
  }
}

function saveScreenshot(img) {
  
  img = (img.split(','))[1];
  
  var settings = Settings.get();
  if(settings.screenshotMode) {
    switch(settings.screenshotMode) {
      case "local":
        saveLocal(img);
        return;
      case "imgur":
        saveToImgur(img);
        return;
    }
  }
  
  dialog.showMessageBox({    
    type: "question",
    buttons: [
      "Save to file",
      "Upload to imgur",
      "Cancel"
    ],
    title: "Exile Diary",
    message: "Screenshot generated",
    detail: "Where should the generated screenshot be saved?",
    checkboxLabel: "Don't ask again"  
  }, (buttonIndex, checked) => {
    switch(buttonIndex) {
      case 0:
        if(checked) {
          Settings.set("screenshotMode", "local");
        }
        saveLocal(img);
        break;
      case 1:
        if(checked) {
          Settings.set("screenshotMode", "imgur");
        }
        saveToImgur(img);
        break;
      default:
        break;
    }
  });  
}

function saveLocal(img) {
  var fileName = `screenshot-${moment().format("YYYYMMDDhhmmss")}.png`;
  dialog.showSaveDialog(
    {
      defaultPath: fileName,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    },
    (savePath) => { 
      if(savePath) {
        var Jimp = require('jimp');
        Jimp.read(Buffer.from(img, 'base64')).then(imgdata => imgdata.write(savePath));
      }
    }
  );
}

function saveExport(sheetData) {
  var fileName = `export-${moment().format("YYYYMMDDhhmmss")}.xlsx`;
  dialog.showSaveDialog(
    {
      defaultPath: fileName,
      filters: [{ name: 'XLSX', extensions: ['xlsx'] }]
    },
    (savePath) => { 
      if(savePath) {
        const XLSX = require('xlsx');
        XLSX.writeFile(sheetData, savePath);
      }
    }
  );          
}

function saveToImgur(img) {
  
  addMessage("Uploading screenshot...");
  var imgur = require('imgur');
  imgur.setClientId('ba8f73761b94a1d');
  imgur.uploadBase64(img)
    .then(json => {
      if(json.data.error) {
        addMessage(`Error uploading image: ${json.data.error.message}`);
      } else {
        logger.info(`Delete link for uploaded image is http://imgur.com/delete/${json.data.deletehash}`);
        addMessage(`Screenshot uploaded to <a class='opn-link' href='${json.data.link}'>${json.data.link}</a>`);
      }
    })
    .catch(err => {
      addMessage(`Error uploading image: ${err}`);
    });
  
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});