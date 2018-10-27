const fs = require('fs')
const mergeImages = require('merge-img');
const { BrowserWindow, ipcMain, app } = require('electron')

let tempDir = app.getPath('userData') + '/.temp_capture', canvas = null, contentSize = null, captureTimes = 1
let targetWindow = null, callback = null, options = {}

ipcMain.on('start-capture', function(events){
  targetWindow.webContents.send('get-content-size')
})
ipcMain.on('return-content-size', function (events, size) {
  contentSize = size
  captureTimes = Math.ceil(contentSize.height/contentSize.windowHeight)
  targetWindow.webContents.send('move-page-to', 1)
})
ipcMain.on('return-move-page', function (events, page) {
  let options = {
    x: 0,
    y: 0,
    width: contentSize.windowWidth,
    height: contentSize.windowHeight
  }
  if (page === captureTimes) {
    options.height = contentSize.height - ((captureTimes - 1) * contentSize.windowHeight)
    options.y = contentSize.windowHeight - options.height
  }
  targetWindow.capturePage(options, function (image) {
    if (!fsExistsSync(tempDir)) {
      fs.mkdirSync(tempDir)
    }
    fs.writeFile(tempDir + '/' + page + '.png', image.toPNG(), function(err){
      if (page !== captureTimes) {
        targetWindow.webContents.send('move-page-to', page + 1)
      } else {
        targetWindow.webContents.send('done-capturing')
        flattenPNG()
      }
    })
  })
})

function flattenPNG () {
  let fileNames = []
  for (var i = 1 ; i <= captureTimes; i++) {
    fileNames.push(tempDir + '/' + i + '.png')
  }
  mergeImages(fileNames, {direction: true}).then(img => {
    for(var i = 0; i < fileNames.length; i++) {
      fs.unlink(fileNames[i]);
    }
    img.crop(0, 0, img.bitmap.width - contentSize.scrollBarWidth, img.bitmap.height);
    callback(img);
  })
  
}

function fsExistsSync(path) {
  try {
    fs.accessSync(path, fs.F_OK);
  } catch (e) {
    return false;
  }
  return true;
}

BrowserWindow.prototype.captureFullPage = function(_callback, _options){
  targetWindow = this
  callback = _callback
  options = _options || {}
  canvas = null
  this.webContents.executeJavaScript(`
      var ipcRender = require('electron').ipcRenderer;
      ipcRender.send('start-capture');
  `)
}