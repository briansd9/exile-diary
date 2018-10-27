const ipcRender = require('electron').ipcRenderer;

//console.log("preloading");

ipcRender.on('get-content-size', function() {
  var height = Math.max( document.body.scrollHeight, document.body.offsetHeight,
                         document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight );
  ipcRender.send('return-content-size', {
    width: window.innerWidth,
    height: height,
    windowHeight: window.innerHeight,
    windowWidth: window.innerWidth,
    scrollBarWidth: window.innerWidth - document.body.clientWidth
  });
});

ipcRender.on('move-page-to', function(events, page) {
    logger.info('Capturing page ' + page);
    window.scrollTo(0, window.innerHeight * (page - 1) )
    setTimeout(function() {
        ipcRender.send('return-move-page', page);
    }, 100)
});
