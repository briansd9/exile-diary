class MapTable {

  static DEFAULT = [ "date", "area", "level", "iiq", "iir", "packsize", "time", "xpRate", "c", "deaths", "kills" ];
  static fmt = new Intl.NumberFormat();

  static COLUMNS = {
    date: { label: "Date", f: map => moment(map.id, "YYYYMMDDHHmmss").format("YYYY-MM-DD HH:mm:ss") },
    area: { label: "Area", f: map => map.name },
    region: { label: "Atlas Region", f: map => map.runinfo.atlasRegion || "" },
    level: { label: "Level", f: map => Utils.getMapTierString(map) },
    iiq: { label: "IIQ", f: map => (map.iiq ? `+${map.iiq}%` : '') },
    iir: { label: "IIR", f: map => (map.iir ? `+${map.iir}%` : '') },
    packsize: { label: "Pack Size", f: map => (map.packsize ? `+${map.packsize}%` : '') },
    time: { label: "Time", f: map => Utils.getRunningTime(map.firstevent, map.lastevent) },
    xp: { label: "XP", f: map => this.fmt.format(map.xpgained) },
    xpRate: { label: "XP/hr", f: map => map.xpgained > 0 ? Utils.getXPRate(map.xpgained, map.firstevent, map.lastevent) : "" },
    c: { label: "<img class='currencyText' src='res/img/c.png'>", f: map => Number(map.gained).toFixed(2) },
    cRate: { 
      label: "<img class='currencyText' src='res/img/c.png'>/hr", 
      f: map => Number( map.gained * 3600 / Utils.getRunningTime(map.firstevent, map.lastevent, "s", {useGrouping:false}) ).toFixed(2)
    },
    deaths: { label: "Deaths", f: map => Utils.getDeathCount(map.deaths) },
    kills: { label: "Kills", f: map => map.kills > 0 ? this.fmt.format(map.kills) : "" },
    encounters: { label: "Encounters", f: map => this.getEncounters(map.runinfo) }
  };
  
  static getEncounters(r) {
    
    let str = "";
    if(r.maven) {
      str += Utils.getEncounterIcon("maven");
    }
    if(r.elderGuardian) {
      let id = r.elderGuardian.replace("The ", "").toLowerCase();
      str += Utils.getEncounterIcon(id);
    }
    if(r.masters) {
      Object.keys(r.masters).forEach(m => {
        if(r.masters[m].encountered) {
          let id = m.substr(0, m.indexOf(",")).toLowerCase();
          str += Utils.getEncounterIcon(id);
        }
      })
    }
    if(r.conqueror) {
      Object.keys(r.conqueror).forEach(c => {
        let id = c.substr(c.indexOf("the") + 4).toLowerCase();
        str += Utils.getEncounterIcon(id);
      })
    }
    if(r.strangeVoiceEncountered) {
      str += Utils.getEncounterIcon("delirium");
    }
    if(r.blightEncounter) {
      str += Utils.getEncounterIcon("blight");
    }
    if(r.blightedMap) {
      str += Utils.getEncounterIcon("blightedmap");
    }
    if(r.metamorph) {
      str += Utils.getEncounterIcon("metamorph");
    }
    if(r.oshabiBattle) {
      str += Utils.getEncounterIcon("oshabi");
    }
    if(r.abnormalDisconnect) {
      str += Utils.getEncounterIcon("abnormalDisconnect");
    }
    if(r.ultimatum) {
      str += Utils.getEncounterIcon("ultimatum");
    }
    return `<div style='text-align: left;padding-left:10px;' class='mapEncounterCell'>${str}</div>`;
  }
  
}