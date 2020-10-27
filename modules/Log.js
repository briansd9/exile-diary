const winston = require('winston');
const path = require('path');

class Log {

  static getLogger(module) {
    
    var app = require('electron').app || require('electron').remote.app;

    module = path.basename(module);
    return winston.createLogger({
      level: "verbose",
      transports: [
        new winston.transports.File({ 
          filename: path.join(app.getPath("userData"), "log.txt"),
          maxsize: 8388608,
          maxFiles: 1,
          tailable: true
        }),
        new winston.transports.Console()
      ],
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.printf(info => `${info.timestamp} [${info.level}] ${module.padEnd(20)} > ${info.message}`)
      )
    });
  }

}

module.exports = Log;