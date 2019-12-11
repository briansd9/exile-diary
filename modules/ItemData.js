const ItemCategoryParser = require("./ItemCategoryParser");

var Rarity = {
	Normal: 0,
	Magic: 1,
	Rare: 2,
	Unique: 3,

	getName: function (i) {
		switch (i) {
			case 0: return "Normal";
			case 1: return "Magic";
			case 2: return "Rare";
			case 3: return "Unique";
			default: throw 'Invalid Rarity: ' + i
		}
	},

	isValid: function (i) {
	    return 0 <= i && i <= 3
	},

	parse: function (str) {
		switch (str.toLowerCase()) {
			case 'normal': return 0;
			case 'magic': return 1;
			case 'rare': return 2;
			case 'unique': return 3;
			default: throw "Invalid Rarity: " + str;
		}
	}
};

var Influence = {
    None: 0,
    Shaper: 1,
    Elder: 2,

    getName: function (i) {
        switch (i) {
            case 0: return 'None';
            case 1: return 'Shaper';
            case 2: return 'Elder';
            default: throw 'Invalid Influence: ' + i
        }
    },

    isValid: function (i) {
        return 0 <= i && i <= 2
    },

    parse: function (str) {
        switch (str.toLowerCase()) {
            case 'none': return 0;
            case 'shaper': return 1;
            case 'elder': return 2;
            default: throw 'Invalid Influence: ' + str
        }
    }
}

class ItemData {

 static validate(item) {
    function assertTrue (expr, msg) {
        if (!expr) {
            throw msg;
        }
    }

	function assertNotNullOrEmpty (str, msg) {
        if (!str || (str === '')) {
            throw msg;
        }
    }

    function assertInRange (value, min, max, msg) {
        if (isNaN(value) || value < min || value > max) {
            throw msg;
        }
    }

	function assertInArray (value, array, msg) {
		if (!ArrayUtils.contains(array, value)) {
			throw msg;
		}
	}

	//assertNotNullOrEmpty( item.name, 'Item has no name' );
    assertInRange( item.itemLevel, 1, 100, 'Invalid ItemLevel' );
    assertInRange( item.dropLevel, 1, 100, 'Invalid DropLevel' );
    assertInRange( item.quality, 0, 23, 'Invalid Quality' );
	assertTrue( Rarity.isValid( item.rarity, 'Invalid Rarity' ));
    assertNotNullOrEmpty( item.itemClass, 'Item has no Class' );
    assertNotNullOrEmpty( item.baseType, 'Item has no BaseType' );
    assertInRange( item.width, 1, 3, 'Invalid width' );
    assertInRange( item.height, 1, 5, 'Invalid height' );
	assertInArray( item.identified, [true, false], 'Invalid Identified property' );
	assertInArray( item.corrupted, [true, false], 'Invalid Corrupted property' );
	assertTrue( Influence.isValid( item.influence, 'Invalid Influence' ));
	assertInArray( item.shapedMap, [true, false], 'Invalid ShapedMap property' );
	var maxSockets = Math.min( 6, item.width * item.height );
	assertInRange( ItemData.countSockets( item.sockets ), 0, maxSockets, 'Too many sockets for this item size' );
}

static areEqual(data, item) {
	return data.name === item.name
		&& data.itemLevel === item.itemLevel
		&& data.dropLevel === item.dropLevel
		&& data.quality === item.quality
		&& data.rarity === item.rarity
		&& data.itemClass === item.itemClass
		&& data.baseType === item.baseType
		&& data.width === item.width
		&& data.height === item.height
		&& data.identified === item.identified
		&& data.corrupted === item.corrupted
		&& ArrayUtils.areEqual( data.sockets, item.sockets );
}

static countSockets(sockets) {
  
  if(!sockets) return 0;
  
	var result = 0;  
	sockets.forEach( function(group) {
    if(!group.includes("DV")) {
      result += group.length;
    }
	});
	return result;
}

static getQuality(data) {
  if(!data.properties) return null;
  for(var i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Quality") {
      return (data.properties[i].values[0][0]).slice(1, -1);
    }
  }
  return null;
}

static getLevelRequirement(data) {

  if(data.properties) {
    for(var i = 0; i < data.properties.length; i++) {
      if(data.properties[i].name === "Map Tier") {
        return Number(data.properties[i].values[0][0]) + 67;
      }
    }
  }

  if(!data.requirements) return null;
  for(var i = 0; i < data.requirements.length; i++) {
    if(data.requirements[i].name === "Level") {
      return data.requirements[i].values[0][0];
    }
  }
  return null;

}
	
static getSockets(data) {
  
  if(!data.sockets) return [];
  
  var sockets = [];
  var currGroup = 0;
  var currSockets = "";
  
  for(var i = 0; i < data.sockets.length; i++) {
    var s = data.sockets[i];
    if(s.group === currGroup) {
      currSockets += s.sColour;
    } else {
      sockets.push(currSockets);
      currGroup = s.group;
      currSockets = s.sColour;
    }
  }
  sockets.push(currSockets);
  
  return sockets;
  
}
	
static getRarity(data) {
  return (data.frameType < 1 || data.frameType > 3) ? 0 : data.frameType;
}

static getGemLevel(data) {
  
  if(!data.properties) return false;
  
  if(data.frameType !== 4) return false;
  
  for(var i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Level") {
      return (data.properties[i].values[0][0].replace(" (Max)", ""));
    }
  }
  return false;
}

static getInfluence(data) {
  if(data.elder) return Influence.Elder;
  else if(data.shaper) return Influence.Shaper;
  else return Influence.None;
}

static getMapTier(data) {
  if(!data.properties) return null;
  for(var i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Map Tier") {
      return (data.properties[i].values[0][0]);
    }
  }
  return null;
}


static isShapedMap(data) {
  if(!data.properties) return false;
  for(var i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Map Tier") {
      return (data.properties[i].values[0][1] === 1 && data.properties[i].values[0][0] < 16);
    }
  }
  return false;
}

static isElderMap(data) {
  if(!data.properties) return false;
  for(var i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Map Tier") {
      return (data.properties[i].values[0][1] === 1 && data.properties[i].values[0][0] === 16);
    }
  }
  return false;
}

static isBlightedMap(data) {
  if(!data.properties) return false;
  return data.icon.includes("mb=1");
}

static createItem(itemdata)
{
  var obj = {};
  
	obj.rawData = itemdata;
	obj.name = itemdata.name.replace("<<set:MS>><<set:M>><<set:S>>", "").replace(/<>/g, "");
  obj.id = itemdata.id;

	obj.itemLevel = Math.max(1, itemdata.ilvl);
	obj.dropLevel = Math.max(1, ItemData.getLevelRequirement(itemdata));

	obj.quality = ItemData.getQuality(itemdata);
	obj.rarity = ItemData.getRarity(itemdata);

	obj.itemClass = ItemCategoryParser.getCategory(itemdata);
	obj.baseType = itemdata.typeLine.replace("<<set:MS>><<set:M>><<set:S>>", "").replace(/<>/g, "");
	obj.identified = itemdata.identified || false;
	obj.corrupted = itemdata.corrupted || false;
	obj.influence = ItemData.getInfluence(itemdata);
	obj.shapedMap = ItemData.isShapedMap(itemdata);
	obj.elderMap = ItemData.isElderMap(itemdata);
  obj.blightedMap = ItemData.isBlightedMap(itemdata);
  obj.mapTier = ItemData.getMapTier(itemdata);
	obj.stackSize = itemdata.stackSize;

  obj.veiled = itemdata.veiled;
  obj.synthesised = itemdata.synthesised || false;
  obj.fractured  = itemdata.fractured || false;
  
  obj.explicitMods = itemdata.explicitMods;
  obj.enchantMods = itemdata.enchantMods;
  
  if(obj.itemClass === "Prophecy") {
    obj.name = obj.baseType;
    obj.baseType = obj.itemClass;
    obj.itemClass = "Currency";
  }

	obj.width = itemdata.w;
	obj.height = itemdata.h;

	obj.sockets = ItemData.getSockets(itemdata);
	obj.gemLevel = ItemData.getGemLevel(itemdata);

	obj.outerElement = null;
	obj.domElement = null;
	obj.matchingRule = null;

	obj.getDisplayName = function() {
		if (!this.identified && this.quality > 0) {
			return this.baseType;
		}
		if (!this.identified || !this.name) {
      var name = (this.stackSize > 1 ? this.stackSize + " x " : "") + this.baseType;
      if(this.gemLevel) {
        if(this.quality > 0) name = "Superior " + name;
        if(this.gemLevel > 1) name += ` (Level ${this.gemLevel})`;
      }
      return name;
		}
		else {
			return this.name + (this.baseType === "Prophecy" ? "" : "<BR>" + this.baseType);
		}
	}

	obj.getNumSockets = function() {
		return ItemData.countSockets( this.sockets );
	}
  
	obj.hasExplicitMod = function(mod) {
    if(mod === "Veil" && this.veiled) {
      return true;
    } else {
      return this.explicitMods && this.explicitMods.includes( mod );
    }
	}  

	obj.hasEnchantment = function(mod) {
    if(!this.enchantMods) {
      return false;
    }
    var str = mod.replace("Enchantment ", "");
    return this.enchantMods.some(function(mod) {
      return mod.includes(str);
    });
	}  

	obj.draw = function() {
		var outerDiv = document.createElement( 'div' );
		outerDiv.className = 'item-container';
    outerDiv.id = this.id;

		var itemDiv = document.createElement( 'div' );
		itemDiv.className = 'item';

    var iconDiv = this.getItemIcon();
    if(iconDiv) {
      itemDiv.append(iconDiv);
    }

		var itemName = document.createElement( 'span' );
    itemName.classList.add('item-name');
		itemName.innerHTML = this.getDisplayName();
                
		itemDiv.appendChild( itemName );

		if (this.getNumSockets() > 0 && !this.sockets.includes("DV")) {
			itemDiv.appendChild( drawSockets(this) );
		}

		outerDiv.appendChild( itemDiv );

                
		this.outerElement = outerDiv;
		this.domElement = itemDiv;
                
		return outerDiv;

	}
  
  obj.getItemIcon = function() {
    var icon = null;
    if(this.veiled) {
      icon = "veiled";
    } else if(this.synthesised) {
      icon = "synthesised";
    } else if(this.fractured) {
      icon = "fractured";
    } else {
      switch(this.influence) {
        case Influence.Shaper:
          icon = "shaper";
          break;
        case Influence.Elder:
          icon = "elder";
          break;
        default:
          break;
      }
    }
    if(icon) {
      var iconDiv = document.createElement('span');
      iconDiv.innerHTML = `<img src='res/img/${icon}.png' style='width:24px;height:24px;margin:4px 4px 0px 0px'/>`;
      return iconDiv;
    } else {
      return null;
    }    
  }

	obj.setVisibility = function (visibility) {
		if (this.itemClass === 'Quest Items' || this.itemClass === 'Labyrinth Item' || this.itemClass === 'Labyrinth Trinket') {
			visibility = true;
		}
		visibility = true;
		this.outerElement.className = (visibility ? 'item-container' : 'hidden-item-container');
		this.domElement.style.visibility = (visibility ? 'visible' : 'hidden');
	}

	obj.setTextColor = function (color) {
		getLabel( this ).style.color = buildCssColor( color );
	}

	obj.removeBorder = function() {
		this.domElement.style.border = '';
	}

	obj.setBorderColor = function (color) {
		this.domElement.style.border = '1px solid ' + buildCssColor( color );
	}

	obj.setBackgroundColor = function (color) {
		this.domElement.style.backgroundColor = buildCssColor( color );
	}

	obj.setFontSize = function (size) {
		var actualSize = MathUtils.remap( size, 18, 45, 8, 24 );
		getLabel( this ).style.fontSize = (actualSize).toString() + 'px';
	}
  
  return obj;

	function buildCssColor (color) {
		var r = color.r;
		var g = color.g;
		var b = color.b;
		var a = 1;
		if (color.hasOwnProperty( 'a' )) {
			a = color.a / 255; // CSS wants its alpha value between 0 and 1
		}
		return 'rgba(' + r.toString() + ',' + g.toString() + ',' + b.toString() + ',' + a.toString() + ')';
	}

	function getLabel (self) {
		for (var i=0; i < self.domElement.children.length; i++) {
			var child = self.domElement.children[i];
			if ((child.tagName.toLowerCase() === 'span') && child.classList.contains('item-name')) {
				return child;
			}
		}
		return null;
	}

	function getSocketsDiv (self) {
		for (var i=0; i < self.domElement.children.length; i++) {
			var child = self.domElement.children[i];
			if (child.className === 'sockets') {
				return child;
			}
		}
	}

	function computeSocketPadding (numSockets) {

		// The height values as computed by the formula below:
		//	1: 4,
		//	2: 4,
		//	3: 10,
		//	4: 10,
		//	5: 16,
		//	6: 16

		var width = ( numSockets == 1 ) ? 4 : 10;
		var height = ( Math.ceil( numSockets / 2 ) - 1 ) * 6 + 4;

		var result = {};
		result.x = 2 + ( 10 - width ) / 2;
		result.y = 2 + ( 16 - height ) / 2;
		return result;
	}

	function computeSocketPaddingSingleColumn (numSockets) {
		// 1: 4
		// 2: 10
		// 3: 16

		var width = 4;
		var height = (numSockets - 1) * 6 + 4;

		var result = {};
		result.x = 2 + ( 10 - width ) / 2;
		result.y = 2 + ( 16 - height ) / 2;
		return result;
	}

	function drawSocket (socketColor) {
		var socket = document.createElement( 'div' );
		socket.className = 'socket';

		switch (socketColor) {
			case 'R':
				socket.style.backgroundColor = '#ff0000';
				break;
			case 'G':
				socket.style.backgroundColor = '#80ff33';
				break;
			case 'B':
				socket.style.backgroundColor = '#8888ff';
				break;
			case 'W':
				socket.style.backgroundColor = '#ffffff';
				break;
			case 'A':
				socket.style.backgroundColor = '#3b3b3b';
				break;
		}

		return socket;
	}

	function drawLink (x, y, padding) {
		var link = document.createElement( 'div' );

		// Doesn't have to be efficient, this is only run once during startup.
		var xy = x.toString() + '/' + y.toString();
		switch (xy) {
			// case '0/0' is not possible because link is created at the second socket!
			case '1/0':
			case '0/1':
			case '1/2':
				link.className = 'link-horizontal';
				link.style.left = (3 + padding.x).toString() + 'px';
				link.style.top = ((y * 6) + 1 + padding.y).toString() + 'px';
				break;
			case '1/1':
			case '0/2':
				link.className = 'link-vertical';
				link.style.left = ((x * 6) + 1 + padding.x).toString() + 'px';
				link.style.top = (((y-1) * 6) + 3 + padding.y).toString() + 'px';
				break;
		}

		return link;
	}

	function drawLinkSingleColumn (y, padding) {
		var link = document.createElement( 'div' );
		link.className = 'link-vertical';
		link.style.left = (1 + padding.x).toString() + 'px';
		link.style.top = (((y-1) * 6) + 3 + padding.y).toString() + 'px';
		return link;
	}

	function incrementSocketPos (x, y) {
		// x0 y0 -> x+1
		// x1 y0 -> y+1
		// x1 y1 -> x-1
		// x0 y1 -> y+1
		// x0 y2 -> x+1

		var xdir = (y % 2 == 1) ? -1 : 1;
		var xstop = (y % 2 == 1) ? 0 : 1;

		if (x != xstop) {
			x += xdir;
		}
		else {
			y += 1;
		}

		return { x:x, y:y };
	}

	function drawSockets (item) {
		if (item.width === 1) {
			return drawSocketsSingleColumn( item );
		} else {
			return drawSocketsTwoColumns( item );
		}
	}

	function drawSocketsTwoColumns (item) {
		var socketsDiv = document.createElement( 'div' );
		socketsDiv.className = 'sockets';

		var padding = computeSocketPadding( item.getNumSockets() );

		var x = 0;
		var y = 0;
		var linked = false;

		item.sockets.forEach( function(group) {
			linked = false;
			var chars = group.split( '' );
			chars.forEach( function(socketColor) {
				var socket = drawSocket( socketColor );
				socket.style.left = (padding.x + (x * 6)).toString() + 'px';
				socket.style.top = (padding.y + (y * 6)).toString() + 'px';
				socketsDiv.appendChild( socket );

				if (linked) {
					var link = drawLink( x, y, padding );
					socketsDiv.appendChild( link );
				}

				var newXY = incrementSocketPos( x, y );
				x = newXY.x;
				y = newXY.y;

				linked = true;
			});
		});

		return socketsDiv;
	}

	function drawSocketsSingleColumn (item) {
		var socketsDiv = document.createElement( 'div' );
		socketsDiv.className = 'sockets';

		var padding = computeSocketPaddingSingleColumn( item.getNumSockets() );

		var y = 0;
		var linked = false;

		item.sockets.forEach( function (group) {
			linked = false;
			var chars = group.split('');
			chars.forEach( function(socketColor) {
				var socket = drawSocket( socketColor );
				socket.style.left = (padding.x).toString() + 'px';
				socket.style.top = (padding.y + (y * 6)).toString() + 'px';
				socketsDiv.appendChild( socket );

				if (linked) {
					var link = drawLinkSingleColumn( y, padding );
					socketsDiv.appendChild( link );
				}

				y += 1
				linked = true;
			});
		});

		return socketsDiv;
	}
};

}

module.exports = ItemData;
module.exports.Rarity = Rarity;
module.exports.Influence = Influence;
