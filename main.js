// Modules to control application life and create native browser window
const {app, BrowserWindow, dialog, ipcMain} = require('electron');
const logger = require("./modules/Log").getLogger(__filename);
const ClientTxtWatcher = require("./modules/ClientTxtWatcher");
const OCRWatcher = require("./modules/OCRWatcher");
const RateGetter = require("./modules/RateGetter");
const RunParser = require('./modules/RunParser');
const MapSearcher = require('./modules/MapSearcher');
const ScreenshotWatcher = require("./modules/ScreenshotWatcher");

const StashGetter = require("./modules/StashGetter");
const Utils = require("./modules/Utils");
const moment = require('moment');
const fs = require('fs');
const path = require('path');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

var shouldQuit = app.makeSingleInstance(function (commandLine, workingDirectory) {
  // Someone tried to run a second instance, we should focus our window.
  if (mainWindow) {
    if (mainWindow.isMinimized())
      mainWindow.restore();
    mainWindow.focus();
  }
});

function init() {
  
  logger.info("Initializing components");
  
  // remove settings file from cache, then restart all components 
  // to make sure they're using the current settings file
  
  var settingsPath = path.join(app.getPath("userData"), "settings.json");
  if(fs.existsSync(settingsPath)) {
    delete require.cache[require.resolve(settingsPath)];
    require("./modules/DB").getDB(true);
    RateGetter.update();
    StashGetter.get();
    ClientTxtWatcher.start();
    ScreenshotWatcher.start();
    OCRWatcher.start();
  }

  global.messages = [];

}

function initWindow(window) {
  
  var webContents = window.webContents;
  
  OCRWatcher.emitter.removeAllListeners();
  OCRWatcher.emitter.on("OCRError", () => {
    webContents.send("OCRError");
  });
  OCRWatcher.emitter.on("areaInfoComplete", (info) => {
    addMessage(`Started tracking run in <span class='eventText'>${info.areaInfo.name}</span>`);
    RunParser.process(info);
  });
  
  ScreenshotWatcher.emitter.removeAllListeners();
  ScreenshotWatcher.emitter.on("OCRError", () => {
    webContents.send("OCRError");
  });  
  
  RunParser.emitter.removeAllListeners();
  RunParser.emitter.on("runProcessed", (run) => {
    addMessage(
      `Completed run in <span class='eventText'>${run.name}</span> `
      + `(${Utils.getRunningTime(run.firstevent, run.lastevent)}, `
      + `${run.gained} <img src='res/c.png' style='vertical-align:middle'>, `
      + `${new Intl.NumberFormat().format(run.xp)} XP)`
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

function createWindow() {

  logger.info("Starting");
  
  init();
  
  ipcMain.on("reinitialize", (event) => {
    init();
    event.sender.send("done-initializing");
  });
  ipcMain.on("searchMaps", (event, data) => {
    MapSearcher.search(data);
  });
  ipcMain.on("screenshotCaptured", (event, img) => {
    saveScreenshot(img);
  });
  
  if (shouldQuit) {
    app.quit();
    return;
  }
  
  require('./modules/electron-capture/src/main');
  
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: `Exile Diary v${app.getVersion()}`,
    minWidth: 1100,
    backgroundColor: `#000000`,
    show: false,
    icon: path.join(__dirname, "res/icons/png/64x64.png"),
    webPreferences: {
        preload: __dirname + '/modules/electron-capture/src/preload.js'
    }
  });
  
  //mainWindow.setMenu(null);

  // and load the index.html of the app.
  if(!require("./modules/settings").get()) {
    mainWindow.loadFile('config.html');
  } else {
    mainWindow.loadFile('index.html');
  }
  
  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
  
  mainWindow.webContents.on('new-window', function(event, urlToOpen) {
    event.preventDefault();
  });  
  
  initWindow(mainWindow);
  
  addMessage("Exile Diary started");
  
  mainWindow.maximize();
  mainWindow.show();
  
}

function addMessage(text) {
  var msg = {
    timestamp: moment().format("YYYY-MM-DD hh:mm:ss"),
    text: text
  };
  global.messages.push(msg);
  global.messages = global.messages.slice(-10);
  mainWindow.webContents.send("message", msg);
  mainWindow.once('focus', () => mainWindow.flashFrame(false));
  mainWindow.flashFrame(true);
  
}

function saveScreenshot(img) {
  
  img = (img.split(','))[1];
  
  var settings = require('./modules/settings').get();
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
          require('./modules/settings').set("screenshotMode", "local");
        }
        saveLocal(img);
        break;
      case 1:
        if(checked) {
          require('./modules/settings').set("screenshotMode", "imgur");
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