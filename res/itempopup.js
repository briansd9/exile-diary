const frameTypes = [
  "normal",
  "magic",
  "rare",
  "unique",
  "gem",
  "currency",
  null, // divination card
  "quest",
  "prophecy",
  "relic"          
];

const valueColourNames = {
  0 : "colourDefault",
  1 : "colourAugmented",
  2 : "colourUnmet",
  3 : "colourPhysicalDamage",
  4 : "colourFireDamage",
  5 : "colourColdDamage",
  6 : "colourLightningDamage",
  7 : "colourChaosDamage",
  12 : "colourHarvestRed",
  13 : "colourHarvestGreen",
  14 : "colourHarvestBlue"
};

var maxLength = -1;

function setMaxLength(str) {
  if(str.length > maxLength) {
    //console.log(`Setting new maxLength ${str.length} -> [${str}]`);
    maxLength = str.length;
  }
}

function createPopup(data) {
  try {
    if(data.frameType === 6) {
      return createDivCardPopup(data);
    } else {
      return createItemPopup(data);
    }
  } catch(e) {
    let log = require('./modules/Log').getLogger(__filename);
    log.info("Error creating item popup: " + e);
    log.info(JSON.stringify(data));
  }
}

function createDivCardPopup(data) {
  
  let containerDiv = $(`<div id='${data.id}_${data.arrayIndex}_popup' style='position:relative;' class='itemPopupContainer newItemPopup divinationCard'/>`);
  containerDiv.append(`<div class='cardFace'><img src='https://web.poecdn.com/image/divination-card/${data.artFilename}.png'/></div>`);
  
  fixStackSize(data);
  
  let d = $("<div class='itemBoxContent'/>");
  d.append($(`
    <div class="itemHeader">
      <span class="l"></span>
      <div class="itemName typeLine">
        <span class="lc" style='position:relative;top:3px;'>${data.typeLine}</span>
      </div>
      <span class="r"></span>
    </div>
    <div class="stackSize">${data.pickupStackSize || data.stackSize}/${data.maxStackSize}</div>
  `));
  d.append(getDivCardMods(data));
  d.append(getDivCardFlavourText(data));
  
  containerDiv.append(d);
  return containerDiv;
 
}

function getDivCardMods(data) {
  
  if(!data.explicitMods) return null;
  
  let str = "<div class='explicitModsWrapper'><div class='explicitModsContainer'>";
  
  let mods = data.explicitMods[0].split("\r\n");
  for(let i = 0; i < mods.length; i++) {
    str += `
      <div class='explicitMod'>
        <span class='lc'>
          ${parseMod(mods[i])}
          <br/>
        </span>
      </div>
    `;
  }
  
  str += "</div></div>";
  return str;
  
  function parseMod(str) {

    let parsedStr = '';
    let fontSize = null;
    
    let sizeMatch = str.match(/<size:[0-9]+>/g);    
    if(sizeMatch) {
      fontSize = sizeMatch[0].replace(/[a-z<>:]/g, "");
      str = str.replace(/<size:[0-9]+>/, "");
    }
    
    let markup = str.match(/<([^{}<>]+)>/g);
    let text = str.match(/{([^{}<>]+)}/g);
    for(let i = 0; i < markup.length; i++) {
      parsedStr += `<span style='${fontSize ? `font-size:${fontSize/2}px` : ""}' class='${markup[i].replace(/[<>]/g, "")}'>${text[i].replace(/[{}]/g, "")}</span> `;
    }
    
    return parsedStr;    
  }
  
}

function getDivCardFlavourText(data) {
  
  if(!data.flavourText) return null;
  
  let str = "<div class='flavourTextWrapper'><div class='flavourTextContainer'><div class='flavourText'>";
  let fontSize = null;
  let flavourTextStr = "";
  
  for(let i = 0; i < data.flavourText.length; i++) {
    let f = data.flavourText[i];    
    let sizeMatch = f.match(/<size:[0-9]+>/g);
    if(sizeMatch) {
      fontSize = sizeMatch[0].replace(/[a-z<>:]/g, "");
      f = f.replace(/<size:[0-9]+>/, "");
    }
    f = f.replace("\r", "<br/>").replace(/[{}]/g, "");
    flavourTextStr += f;
  }
  
  str += `<span class='lc' style='${fontSize ? `font-size:${fontSize/2}px` : ""}'>${flavourTextStr}</span>`;
  str += "</div></div></div>";
  
  return str;

}


function createItemPopup(data) {
  
  maxLength = -1;
  
  let d = $(`<div id='${data.id}_${data.arrayIndex}_popup' style='white-space:nowrap;'/>`);
        
  let t = $(`<table class='newItemPopup'/>`);
  if(frameTypes[data.frameType]) {
    t.addClass(`${frameTypes[data.frameType]}Popup`);
  } else {
    // divination cards - special handling required
    return null;
  }

  t.append(getHeader(data));
  
  fixStackSize(data);
  
  let contentRow = $("<tr />");
  let contentCell = $("<td class='itemInfo' />");
  let textArray = [];
  
  var textFunctions = [
    getProperties,
    getItemLevelAndRequirements,
    getEnchantMods,
    getImplicitMods,
    getUnidentified,
    getSecDescrText,
    getExplicitMods,
    getAdditionalProperties,
    getFlavourText,
    getFlavourTextParsed,
    getProphecyText,
    getDescrText,
    getIncubatedItem
  ];
  
  for(let i = 0; i < textFunctions.length; i++) {
    let func = textFunctions[i];
    if(data.hybrid && (func === getAdditionalProperties || func === getDescrText)) continue;
    let text = func(data);
    if(text) {
      textArray.push(text);
    }
  }
  
  if(data.hybrid) {  
    textArray.push(getHybridHeader(data));
    for(let i = 0; i < textFunctions.length; i++) {
      let func = textFunctions[i];
      let text = func(data.hybrid);
      if(text) {
        textArray.push(text);
      }
    }
    textArray.push(getAdditionalProperties(data));
    textArray.push(getDescrText(data));
  }  
  
  if(textArray.length > 0) {
    for(let i = 0; i < textArray.length; i++) {
      if(textArray[i]) {
        contentCell.append(textArray[i]);
        if(i < textArray.length - 1) {
          contentCell.append($("<div class='separator'>"));
        }
      }
    }
    contentCell.css("width", `${maxLength * 0.9}ch`);
  }
  //console.log(`${data.typeLine} maxlength is ${maxLength}`);

  contentRow.append(contentCell);
  t.append(contentRow);
  
  let backgroundImageStyle = "";
  if(data.shaper) {
    backgroundImageStyle = `background-image: url("res/img/itemicons/ShaperBackground${data.w}x${data.h}.png")`;
  } else if (data.elder) {
    backgroundImageStyle = `background-image: url("res/img/itemicons/ElderBackground${data.w}x${data.h}.png")`;
  }
  
  d.append($(`
    <div style='border: 1px solid #333;display:inline-block;padding:4px;background-color:rgba(0,0,0);vertical-align:top;z-index:1998'>
      <span class='stackSize' style='top:12px;left:18px;'>${data.maxStackSize ? data.pickupStackSize || data.stackSize : ""}</span>
      <img style='vertical-align:top;${backgroundImageStyle}' src="${data.icon}"/>
    </div>
  `));
  d.append(t);
  
  return d.get(0);

}

function fixStackSize(data) {
  if(!data.properties || !data.maxStackSize) return;
  for(var i = 0; i < data.properties.length; i++) {
    let prop = data.properties[i];
    if(prop.name === "Stack Size") {
      prop.values[0][0] = `${data.pickupStackSize || data.stackSize}/${data.maxStackSize}`;
      return;
    }
  }
}

function getHeader(data) {
  
  let row = $("<tr class='itemHeader' />");
  let cell = $("<td style='padding-bottom: 4px;' />");
  
  let subTable = $("<table width='100%' height='100%' />");
  let subRow  = $("<tr height='100%' />");

  subRow.append(getLeftInfluence(data));  
  
  let subCell = $("<td style='text-align:center;' />");
  if(data.name) {
    row.addClass("doubleLine");
    subCell.append($(`<div class='itemName'><span class='lc'>${data.name}</span></div>`));
    setMaxLength(data.name);
  } else if(data.secretName) {
    row.addClass("doubleLine");
    subCell.append($(`<div class='itemName secretName'><span class='lc'>${data.secretName}</span></div>`));
    setMaxLength(data.secretName);
  }
  
  if(data.hybrid) {
    subCell.append($(`<div class='itemName typeLine'><span class='lc'>${data.hybrid.baseTypeName}</span></div>`));    
    setMaxLength(data.hybrid.baseTypeName);
  } else {
    subCell.append($(`<div class='itemName typeLine'><span class='lc'>${data.typeLine}</span></div>`));
    setMaxLength(data.typeLine);
  }  
  
  subRow.append(subCell);
  
  subRow.append(getRightInfluence(data));
  subTable.append(subRow);
  
  cell.append(subTable);
  row.append(cell);
  
  return row;
  
}

function getHybridHeader(data) {
  
  let div = $(`
    <div class='itemName typeLine ${data.hybrid.isVaalGem ? "vaalHeader" : "hybridHeader"}'>
      <span class='lc'>${data.typeLine}</span>
    </div>
  `);
  
  setMaxLength(data.typeLine);
  return div;
  
}

function getLeftInfluence(data) {
  let inf = $("<td class='l symbol'> </td>");
  
  if(data.influences) {
    let i = Object.keys(data.influences);
    inf.addClass(i[0]);
  } else if(data.veiled) {
    inf.addClass("veiled");
  } else if(data.synthesised) {
    inf.addClass("synthetic");
  } else if(data.fractured) {
    inf.addClass("fractured");
  }
  return inf;
}

function getRightInfluence(data) {
  let inf = $("<td class='r symbol'> </td>");  
  if(data.influences) {
    let i = Object.keys(data.influences);
    inf.addClass(i[Math.max(0, i.length - 1)]);
  } else if(data.veiled) {
    inf.addClass("veiled");
  } else if(data.synthesised) {
    inf.addClass("synthetic");
  } else if(data.fractured) {
    inf.addClass("fractured");
  }  
  return inf;
}

function getProperties(data) {
  if(!data.properties) return null;
  let div = $("<div/>");
  for(let i = 0; i < data.properties.length; i++) {
    let propString = getPropertyString(data.properties[i]);
    setMaxLength($(propString).text());
    div.append($(`<div>${propString}</div>`));
  }
  return div;
}


function getItemLevelAndRequirements(data) {
  if(!data.requirements && data.ilvl === 0) return null;
  if(data.isVaalGem) return null; // already displayed under base gem
  let div = $("<div/>");
  if(data.ilvl) {
    div.append($(`<div class='itemLevel'><span>Item Level: </span><span class='colourDefault'>${data.ilvl}</span></div>`));
  }
  if(data.requirements) {
    let reqString = "Requires ";
    for(let i = 0; i < data.requirements.length; i++) {
      reqString += getPropertyString(data.requirements[i]);
      if(i < data.requirements.length - 1) {
        reqString += ", ";
      }
    }
    reqString = reqString.replace(":", "");
    div.append($(`<div>${reqString}</div>`));
    setMaxLength($(div).text());
  }
  if(data.ilvl && !data.requirements) {
    div.addClass("itemLevelOnly");
  }
  return div;
}

// these go in the same section w/o separator: explicit, crafted, veiled mods; corrupted status
function getExplicitMods(data) {
  if(!data.explicitMods && !data.craftedMods && !data.veiledMods && !data.corrupted) return null;
  let div = $("<div/>");
  if(data.explicitMods) {
    for(let i = 0; i < data.explicitMods.length; i++) {
      // horrible hack for incubator mod - actually two lines separated by \r\n
      let arr = data.explicitMods[i].split(/[\r\n]+/);
      for(let j = 0; j < arr.length; j++) {
        // horrible hack for essences - one mod line is blank
        if(arr[j] === "") arr[j] = "&nbsp;";
        if(data.typeLine && data.typeLine.includes("Incubator")) {
          let num = arr[j].match(/[0-9]+/g);
          if(num) {
            let f = new Intl.NumberFormat();
            arr[j] = arr[j].replace(num, f.format(num));
          }
        }
        div.append($(`<div class='explicitMod'>${arr[j]}</div>`));
        setMaxLength(arr[j]);
      }
    }
  }
  if(data.craftedMods) {
    for(let i = 0; i < data.craftedMods.length; i++) {
      let str = data.craftedMods[i].replace("\r\n", "<br/>");
      if(str.includes(">{")) {
        str = replaceColorTags(str);
      }
      div.append($(`<div class='craftedMod'>${str}</div>`));
      setMaxLength(str);
    }
  }
  if(data.veiledMods) {
    for(let i = 0; i < data.veiledMods.length; i++) {
      let mod = data.veiledMods[i].toLowerCase();
      if(mod.includes("prefix")) {
        div.append($(`<div class='veiledMod'><span class='lc prefix ${mod}'>Veiled Prefix</span></div>`));
      } else if(mod.includes("suffix")) {
        div.append($(`<div class='veiledMod'><span class='lc suffix ${mod}'>Veiled Suffix</span></div>`));
      } 
    }
  }
  
  if(data.corrupted && (!data.hybrid || !data.hybrid.isVaalGem)) {
    div.append($(`<div class='colourUnmet'><span class='lc'>Corrupted</span></div>`));
  }
  if(data.isVaalGem) {
    div.append($(`<div class='colourUnmet'><span class='lc'>Corrupted</span></div>`));
  }
  
  return div;
}

function replaceColorTags(str) {
  // only used for horticrafting stations (so far)
  // "<white>{Augment} an item with a new <white>{Defence} modifier with Lucky values (81)"
  let r = /(<[a-z]+>)({[a-z]+})/i;
  let m = str.match(r);
  let x = 0;
  while(m) {
    let fullText = m[0];
    let tag = m[1].substring(1, m[1].length - 1);
    let text = m[2].substring(1, m[2].length - 1);
    str = str.replace(fullText, `<span style='color:${tag};'>${text}</span>`);
    m = str.match(r);
    if(x++ > 10) {
      // prevent infinite loops from bad input - only replace up to 10 tags
      break;
    }
  }
  return str;
}

function getAdditionalProperties(data) {
  if(!data.additionalProperties) return null;
  let div = $("<div/>");
  for(let i = 0; i < data.additionalProperties.length; i++) {
    let prop = data.additionalProperties[i];
    if(prop.name === "Experience") {
      let f = new Intl.NumberFormat();
      let xpString = prop.values[0][0].split("/");
      let currXP = f.format(xpString[0]);
      let maxXP = f.format(xpString[1]);
      let progress = Math.floor(prop.progress * 100);
      div.append($(`
        <div class="additionalProperty">
          <span class="lc">
            <span class="experienceBar"><span class="fill"><span style="width: ${progress}%;"></span></span></span>
            <span class="colourDefault">${currXP}/${maxXP}</span>
          </span>
        </div>
      `));
    }
  }
  return div;
}

function getIncubatedItem(data) {
  if(!data.incubatedItem) return null;
  let div = $("<div/>");
  let i = data.incubatedItem;
  let f = new Intl.NumberFormat();
  let progress = Math.floor(i.progress / i.total * 100);
  let level = i.level + (i.level === 68 ? "+" : "");
  div.append($(`
    <div class="incubated">
      <div class="text"><span>Incubating ${i.name}</span></div>
      <span class="experienceBar"><span class="fill"><span style="width: ${progress}%;"></span></span></span>
      <div class="descrText"><span><span class="progress">${f.format(i.progress)}/${f.format(i.total)}</span> Level ${level} Monster Kills</span></div>
    </div>  
  `));
  return div;
}

function getEnchantMods(data) {
  if(!data.enchantMods) return null;
  let div = $("<div/>");
  for(let i = 0; i < data.enchantMods.length; i++) {
    let str = data.enchantMods[i].replace("\r\n", "<br/>");
    div.append($(`<div class='enchantMod'>${str}</div>`));
    setMaxLength(str);
  }
  return div;
}

function getImplicitMods(data) {
  if(!data.implicitMods) return null;
  let div = $("<div/>");
  for(let i = 0; i < data.implicitMods.length; i++) {
    let str = data.implicitMods[i].replace("\r\n", "<br/>");
    div.append($(`<div class='implicitMod'>${str}</div>`));
    setMaxLength(str);
  }
  return div;
}

function getUnidentified(data) {
  // hybrid-type gems - no identified property, but always IDed
  if(data.baseTypeName) return null;  
  return data.identified ? null : $("<div style='color:#d20000;'>Unidentified</div>");
}

function getSecDescrText(data) {
  return data.secDescrText ? $(`<div class='secDescrText'>${data.secDescrText}</div>`) : null;
}

function getDescrText(data) {
  if(!data.descrText) return null;
  let div = $("<div/>");
  div.append($(`<div class='descrText'>${data.descrText}</div>`));
  return div;
}

function getFlavourTextParsed(data) {
  
  if(!data.flavourTextParsed) return null;
  
  let lineArr = [];
  let line = [];
  for(let i = 0; i < data.flavourTextParsed.length; i++) {
    let f = data.flavourTextParsed[i];
    if(f === "\r\n") {
      if(line.length) {
        lineArr.push(line.slice(0));
        line = [];
      }
    } else if(f.type === "class" && f.class === "glyph") {
      line.push(f.id);
    } 
  }
  if(line.length) lineArr.push(line);
  
  let str = "<div class='flavourText' style='text-align:center;display:inline-block;'><table>";
  for(let i = 0; i < lineArr.length; i++) {
    let s = "<tr><td style='text-align:center;'><span class='lc'/>";
    for(let j = 0; j < lineArr[i].length; j++) {
      s += `<span class='PoEMarkup glyph ${lineArr[i][j]}'></span>`;
    }
    s += "</span></td></tr>";
    str += s;
  }
  return str;
  
}

function getFlavourText(data) {
  if(!data.flavourText) return null;
  let div = $("<div/>");
  for(let i = 0; i < data.flavourText.length; i++) {
    let arr = data.flavourText[i].split("\r\n");
    for(let j = 0; j < arr.length; j++) {
      div.append(`<div class='flavourText'>${arr[j]}</div>`);
      setMaxLength(arr[j]);
    }
  }
  return div;
}


function getProphecyText(data) {
  return data.prophecyText ? $(`<div class='colourDefault'>${data.prophecyText}</div>`) : null;
}

function getPropertyString(prop) {  
  
  if(!prop.values || !prop.values.length) {
    return prop.name;
  } else {
    switch(prop.displayMode) {
      case 0:
        return `<span>${prop.name}: ${formatValue(prop.values[0])}</span>`;
      case 1:
        return `<span>${formatValue(prop.values[0])} ${prop.name}</span>`;
      case 2:
        // progress bar type value - handle this later
        return null;
      case 3:
        let str = prop.name;
        for(let i = 0; i < prop.values.length; i++) {
          str = str.replace(`%${i}`, formatValue(prop.values[i]));
        }
        return `<span>${str}</span>`;
    }
  }  
  
}


function formatValue(val) {
  return `<span class='${valueColourNames[val[1]]}'>${val[0]}</span>`;
}
