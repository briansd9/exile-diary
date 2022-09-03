const { app, Menu, Tray, BrowserWindow, dialog, ipcMain } = require('electron');
const logger = require("./modules/Log").getLogger(__filename);
const ClientTxtWatcher = require("./modules/ClientTxtWatcher");
const DB = require("./modules/DB");
const KillTracker = require('./modules/KillTracker');
const OCRWatcher = require("./modules/OCRWatcher");
const RateGetterV2 = require("./modules/RateGetterV2");
const RunParser = require('./modules/RunParser');
const InventoryGetter = require('./modules/InventoryGetter');
const ItemFilter = require('./modules/ItemFilter');
const MapSearcher = require('./modules/MapSearcher');
const ScreenshotWatcher = require("./modules/ScreenshotWatcher");
const Settings = require("./modules/settings");
const { autoUpdater } = require("electron-updater");
const StashGetter = require("./modules/StashGetter");
const SkillTreeWatcher = require("./modules/SkillTreeWatcher");
const Utils = require("./modules/Utils");
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { overlayWindow: OW } = require('electron-overlay-window');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let overlayWindow;
let trayIcon;

const lock = app.requestSingleInstanceLock();
if(!lock) {
  if(trayIcon) {
    trayIcon.destroy();
  }
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


async function checkCurrentActiveCharacter() {
  
  return new Promise( async (resolve, reject) => {
    
    var settings = Settings.get();
    
    logger.info("Getting current active league...");
    if(!settings || !settings.accountName || !settings.poesessid) {
      
      logger.info("Can't check, info missing from settings");
      characterCheckStatus = "error";
      resolve();
      
    } else {
    
      var path = `/character-window/get-characters?accountName=${encodeURIComponent(settings.accountName)}`;
      var requestParams = Utils.getRequestParams(path, settings.poesessid);

      var request = require('https').request(requestParams, (response) => {
        var body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', async () => {
          try {
            var foundChar = false;
            var data = JSON.parse(body);
            if(data.error && data.error.message === "Forbidden") {
              characterCheckStatus = "error";
              resolve();
            } else {
              for(var i = 0; i < data.length; i++) {
                if(data[i].lastActive) {
                  foundChar = true;
                  logger.info("Last active character:");
                  logger.info(JSON.stringify(data[i]));
                  Settings.set("activeProfile", {
                    characterName : data[i].name,
                    league: data[i].league,
                    overrideSSF : settings.activeProfile.overrideSSF,
                    noGearCheck : settings.activeProfile.noGearCheck
                  });
                  await DB.initDB();
                  await DB.initLeagueDB();
                  showActiveCharacterMessage(data[i]);
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
      
    }
    
  });
  
}

async function checkCurrentCharacterLeague() {
  
  var settings = Settings.get();
  if(settings.autoSwitch) {
    return await checkCurrentActiveCharacter();
  } else {
    
    return new Promise( async (resolve, reject) => {

      await DB.initDB();
      await DB.initLeagueDB();
      characterCheckStatus = null;
      logger.info("Checking current character league...");
      if(!settings || !settings.accountName || !settings.poesessid || !settings.activeProfile || !settings.activeProfile.characterName) {

        logger.info("Can't check, info missing from settings");
        characterCheckStatus = "error";
        resolve();

      } else {

        var path = `/character-window/get-characters?accountName=${encodeURIComponent(settings.accountName)}`;
        var requestParams = Utils.getRequestParams(path, settings.poesessid);

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
                    showActiveCharacterMessage(data[i]);
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

      }

    });
  }
}

function checkLeague(settings, foundLeague) {
  
  if(settings.activeProfile.league !== foundLeague) {
    logger.info(`Updating ${settings.activeProfile.characterName} from ${settings.activeProfile.league} to ${foundLeague}`);
    settings.activeProfile.league = foundLeague;
    Settings.set("activeProfile", settings.activeProfile);
  }
  var db = DB.getDB();
  db.run(
    "insert or ignore into leagues(timestamp, league) values(?, ?)", 
    [moment().format('YYYYMMDDHHmmss'), foundLeague], 
    (err) => {
      if(err) {
        logger.info(`Error inserting new league: ${JSON.stringify(err)}`);
      }
    }      
  );
  if(Utils.isPrivateLeague(foundLeague)) {
    if(!settings.privateLeaguePriceMaps || !settings.privateLeaguePriceMaps[foundLeague]) {
      addMessage(`<span onclick='window.location="config.html";' style='cursor:pointer;' class='eventText'>${foundLeague} is a private league, please click here to change item pricing settings</span>`, true);
    }
  }
}

async function init() {
  
  return new Promise(async (resolve, reject) => {
  
    logger.info("Initializing components");
    
    if(!global.messages) {
      global.messages = [
        {
          timestamp: moment().format("YYYY-MM-DD HH:mm:ss"),          
          text: `Exile Diary v${app.getVersion()} started`
        }        
      ];
    }

    // remove settings file from cache, then restart all components 
    // to make sure they're using the current settings file
    var settingsPath = path.join(app.getPath("userData"), "settings.json");
    var tmpSettings = Settings.get();
    if(fs.existsSync(settingsPath) && tmpSettings) {
      delete require.cache[require.resolve(settingsPath)];
      await checkCurrentCharacterLeague();
      logger.info("Done checking, character status is " + characterCheckStatus);
      if(characterCheckStatus === "valid") {
        logger.info("Starting components");
        setTimeout( () => {
          let r = new RateGetterV2();
          r.update();
        }, 1000);
        ClientTxtWatcher.start();
        ScreenshotWatcher.start();
        OCRWatcher.start();
        ItemFilter.load();
      }
      resolve(true);
    } else {
      if(fs.existsSync(settingsPath) && !tmpSettings) {
        addMessage("<span class='eventText'>Settings file corrupted, please enter your account information again (no other data was lost)</span>");
      }
      resolve(false);
    }
    
  });


}

function initWindow(window) {
  
  var webContents = window.webContents;
  
  StashGetter.emitter.removeAllListeners();
  StashGetter.emitter.on("invalidSessionID", () => {
    addMessage(`<span class='eventText'>Unable to get stash information. Please check your POESESSID</span>`, true);
  });
  StashGetter.emitter.on("noStashTabsSelected", () => {
    addMessage(`<span class='eventText'>No stash tabs are selected for monitoring.</span>`, true);
    addMessage(`
      <span class='eventText' style='cursor:pointer;' onclick='window.location.href="config.html?loadStash=true";'>
        Please click on this message to select some.
      </span>
    `);
  });
  StashGetter.emitter.on("netWorthUpdated", () => {
    webContents.send("netWorthUpdated");
  });
  StashGetter.emitter.on("fullStashUpdated", (data) => {
    webContents.send("netWorthUpdated");
    addMessage(
      `
        <span style='cursor:pointer;' onclick='window.location.href="stash.html";'>
        Net worth update for <span class='eventText'>${data.league}</span> league:
        <span class='eventText'>${data.value}</span> <img src='res/img/c.png' class='currencyText'>
        ${data.change === "new" ? "" : ` (${Utils.formatSignedNumber(Number(data.change).toFixed(2))})`}
        </span>
      `,
      true
    );
  });
  setTimeout( () => { let s = new StashGetter(); s.tryGet(); }, 1000);
  
  InventoryGetter.emitter.removeAllListeners();
  InventoryGetter.emitter.on("invalidSessionID", () => {
    addMessage(`<span class='eventText'>Unable to get inventory information. Please check your POESESSID</span>`);
  });
  
  SkillTreeWatcher.emitter.removeAllListeners();
  SkillTreeWatcher.emitter.on("invalidSessionID", () => {
    addMessage(`<span class='eventText'>Unable to get character information. Please check your POESESSID</span>`);
  });  
  
  OCRWatcher.emitter.removeAllListeners();
  OCRWatcher.emitter.on("OCRError", () => {
    addMessage("Error getting area info from screenshot. Please try again", true)
  });
  OCRWatcher.emitter.on("areaInfoComplete", (info) => {
    const tier = Utils.getMapTierString({ level: parseInt(info.areaInfo.level) });
    const stats = `IIR: ${info.mapStats.iir} / IIQ: ${info.mapStats.iiq} / Pack Size: ${info.mapStats.packsize}`;
    addMessage(`Got area info for <span class='eventText'>${info.areaInfo.name}</span> (${tier} - ${stats})`, true);
  });
  
  ScreenshotWatcher.emitter.removeAllListeners();
  ScreenshotWatcher.emitter.on("OCRError", () => {
    addMessage("Error getting area info from screenshot. Please try again", true);
  });  
  ScreenshotWatcher.emitter.on("tooMuchScreenshotClutter", (totalSize) => {
    var settings = Settings.get();
    var dir = settings.screenshotDir.replace(/\\/g, "\\\\");    
    addMessage(`Screenshot folder contains <span class='eventText'>${totalSize}</span> screenshots. Click <span class='eventText' style='cursor:pointer;' onclick='openShell("${dir}")'>here</span> to open it for cleanup`);
  });  
  
  RunParser.emitter.removeAllListeners();
  RunParser.emitter.on("runProcessed", (run) => {
    
    var f = new Intl.NumberFormat();
    addMessage(
      `<span style='cursor:pointer;' onclick='window.location.href="map.html?id=${run.id}";'>`      
        + `Completed run in <span class='eventText'>${run.name}</span> `
        + `(${Utils.getRunningTime(run.firstevent, run.lastevent)}`
        + (run.gained ? `, ${run.gained} <img src='res/img/c.png' class='currencyText'>` : "")
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
  
  KillTracker.emitter.removeAllListeners();
  KillTracker.emitter.on("incubatorsUpdated", (incubators) => {
    webContents.send("incubatorsUpdated", incubators);
  });
  
  RateGetterV2.emitter.removeAllListeners();
  RateGetterV2.emitter.on("gettingPrices", () => {
    addMessage("<span class='eventText'>Getting item prices from poe.ninja...</span>")
  });
  RateGetterV2.emitter.on("doneGettingPrices", () => {
    addMessage("<span class='eventText'>Finished getting item prices from poe.ninja</span>")
  });
  RateGetterV2.emitter.on("gettingPricesFailed", () => {
    addMessage("<span class='eventText removeRow' onclick='rateGetterRetry(this);'>Error getting item prices from poe.ninja, <span class='retry'>click on this message to try again</span></span>")
  });
  
  ClientTxtWatcher.emitter.removeAllListeners();
  ClientTxtWatcher.emitter.on("localChatDisabled", () => {
    addMessage("<span class='eventText'>Unable to track area changes. Please check if local chat is enabled.</span>", true);
  });
  ClientTxtWatcher.emitter.on("switchedCharacter", async (c) => {
    // clear message section to remove now-invalid links to previous character's map runs
    global.messages = [];
    await init();
    if(mainWindow) {
      await initWindow(mainWindow);
      mainWindow.loadFile('index.html');
    }
  });
  ClientTxtWatcher.emitter.on("clientTxtFileError", (path) => {
    addMessage(`<span class='eventText'>Error reading ${path}. Please check if the file exists.</span>`, true);
  });
  ClientTxtWatcher.emitter.on("clientTxtNotUpdated", (path) => {
    addMessage(`<span class='eventText'>${path} has not been updated recently even though the game is running. Please check if PoE is using a different Client.txt file.</span>`, true);
  });
  
}

async function createWindow() {

  logger.info(`Starting Exile Diary v${app.getVersion()}`);
  
  await init();
    
  var downloadingUpdate = false;
  
  ipcMain.on("reinitialize", async (event) => {
    await init();
    if(mainWindow) {
      await initWindow(mainWindow);
    }
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
  ipcMain.on("showOverlay", () => {
    overlayWindow.showInactive();
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
  ipcMain.on('pastebin-success', (event, url) => {
    addMessage(`Map list uploaded to <a class='opn-link' href='${url}'>${url}</a>`);
  });
  ipcMain.on('pastebin-error', () => {
    addMessage(`Error uploading map list, please try again`);
  });
  ipcMain.on('rateGetterRetry', function(event) {
    let r = new RateGetterV2();
    r.update();
  });

  require('./modules/electron-capture/src/main');
  require('@electron/remote/main').initialize()
  
  const isDev = require('electron-is-dev');
  if(!isDev) {
    Menu.setApplicationMenu(null);
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: `Exile Diary v${app.getVersion()}`,
    backgroundColor: `#000000`,
    x: 0,
    y: 0,
    show: false,
    transparent: false,
    icon: path.join(__dirname, "res/img/icons/png/64x64.png"),
    webPreferences: {
        preload: path.join(__dirname, "/modules/electron-capture/src/preload.js"),
        nodeIntegration: true,
        contextIsolation: false
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
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    opacity: 0.75,
    show: false,
    skipTaskbar: true,
    webPreferences: { 
      nodeIntegration: true,
      contextIsolation: false 
    }
  });
  overlayWindow.loadFile("overlay.html");

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
    global.ssf = settings.activeProfile && settings.activeProfile.league && settings.activeProfile.league.includes("SSF");
    if(settings.activeProfile.overrideSSF === true) {
      global.ssf = false;
    }    
    global.hardcore = settings.activeProfile && settings.activeProfile.league && settings.activeProfile.league.includes("Hardcore");
    mainWindow.loadFile('index.html');
  }

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    if(trayIcon) {
      trayIcon.destroy();
    }
    overlayWindow.destroy();
    overlayWindow = null;
    mainWindow = null;
  });
  
  mainWindow.on('minimize', customMinimize);

  mainWindow.webContents.on('new-window', function(event, urlToOpen) {
    event.preventDefault();
    var win = new BrowserWindow({
      modal: true,
      show: false,
      frame: false,
      titleBarStyle: "hidden",
      width: Math.floor(mainWindow.getBounds().width * 0.85),
      height: Math.floor(mainWindow.getBounds().height * 0.85),
      parent: mainWindow,
      webPreferences: { 
        nodeIntegration: true,
        contextIsolation: false 
      }
    });
    win.loadURL(urlToOpen);
    win.once('ready-to-show', () => {
      win.show();
    });
    event.newGuest = win;
  });  

  initWindow(mainWindow);
  
  if(settings && settings.mainWindowBounds) {
    mainWindow.setBounds(settings.mainWindowBounds);
  } else {
    mainWindow.maximize();
  }
  
  if(process.argv.includes("--start-minimized")) {
    mainWindow.minimize();
  } else {
    mainWindow.show();
  }
    
}

function customMinimize(event) {
  try {
    let s = Settings.get();
    if(s.minimizeToTray) {
      if(!trayIcon) {
        trayIcon = new Tray(path.join(__dirname, "res/img/icons/win/ExileDiary.ico"));
        trayIcon.setToolTip(`Exile Diary v${app.getVersion()}\n${s.activeProfile.characterName} (${s.activeProfile.league} league)`);
        trayIcon.setContextMenu(
          Menu.buildFromTemplate([
            { label: 'Quit', role: 'quit' } 
          ])
        );
        trayIcon.on('double-click', () => {
          if(mainWindow) {
            mainWindow.show();
          }
        });
      }
      event.preventDefault();
      mainWindow.hide();
    } else {
      if(trayIcon) {
        trayIcon.destroy();
      }
    }
  } catch(e) {
    // just swallow error and minimize normally
    mainWindow.minimize();
  }
}

function showActiveCharacterMessage(char) {
  addMessage(`Now tracking: <span class='eventText'>${char.name}</span> (level ${char.level} ${char.class} in ${char.league} league)`, true);
}

function addMessage(text, sendToOverlay = false) {
  var msg = {
    timestamp: moment().format("YYYY-MM-DD HH:mm:ss"),
    text: text
  };
  global.messages.push(msg);
  global.messages = global.messages.slice(-10);
  if(mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send("message", msg);
  }
  
  var settings = Settings.get();
  if(overlayWindow && overlayWindow.webContents && sendToOverlay && settings.overlayEnabled) {
    (async () => {
      if(!global.isAttached) {
        overlayWindow.setBounds({
          ...OW.WINDOW_OPTS,
          width: 200,
          height: 40
        });

        OW.attachTo(overlayWindow, 'Path of Exile');
        global.isAttached = true;
      }
      overlayWindow.webContents.send("message", msg);
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
  
  let opts = {    
    type: "question",
    buttons: [ "Save to file", "Upload to imgur", "Cancel" ],
    title: "Exile Diary",
    message: "Screenshot generated",
    detail: "Where should the generated screenshot be saved?",
    checkboxLabel: "Don't ask again"  
  };
  
  dialog.showMessageBox(opts).then( result => {
    switch(result.response) {
      case 0:
        if(result.checkboxChecked) {
          Settings.set("screenshotMode", "local");
        }
        saveLocal(img);
        break;
      case 1:
        if(result.checkboxChecked) {
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
  let fileName = `screenshot-${moment().format("YYYYMMDDhhmmss")}.png`;
  let opts = {
    defaultPath: fileName,
    filters: [{ name: 'PNG', extensions: ['png'] }]
  };
  dialog.showSaveDialog(opts).then(r => {
    if(r.filePath) {
      let Jimp = require('jimp');
      Jimp.read(Buffer.from(img, 'base64')).then(imgdata => imgdata.write(r.filePath));
    }
  });
}

function saveExport(sheetData) {
  let fileName = `export-${moment().format("YYYYMMDDhhmmss")}.xlsx`;
  let opts = {
    defaultPath: fileName,
    filters: [{ name: 'XLSX', extensions: ['xlsx'] }]
  };
  dialog.showSaveDialog(opts).then(r => {
    if(r.filePath) {
      let XLSX = require('xlsx');
      XLSX.writeFile(sheetData, r.filePath);
    }
  });          
}

function saveToImgur(img) {
  
  addMessage("Uploading screenshot...");
  var imgur = require('imgur');
  imgur.setClientId('ba8f73761b94a1d');
  imgur.uploadBase64(img)
    .then(json => {
      console.log(json);
      if(json && json.error && json.error.message) {
        addMessage(`Error uploading image: ${json.error.message}`);
      } else {
        logger.info(`Delete link for uploaded image is http://imgur.com/delete/${json.deletehash}`);
        addMessage(`Screenshot uploaded to <a class='opn-link' href='${json.link}'>${json.link}</a>`);
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

app.on('browser-window-created', (_, window) => {
  require('@electron/remote/main').enable(window.webContents)
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    if(trayIcon) {
      trayIcon.destroy();
    }
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
  
