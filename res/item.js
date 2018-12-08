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

function ItemData() {
	this.name = '';

	this.itemLevel = 0;
	this.dropLevel = 0;

	this.quality = 0;
	this.rarity = Rarity.Normal;

	this.itemClass = '';
	this.baseType = '';

	this.width = 1;
	this.height = 1;
	this.identified = false;
	this.corrupted = false;
	this.influence = Influence.None;
	this.shapedMap = false;

	// Sockets are stored as an array of linked socket groups.
	// An item with a single red socket and linked red and blue sockets (R R=B)
	// would store ['R','RB'] here.
	this.sockets = [];

	return this;
}

ItemData.validate = function (item) {
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

ItemData.areEqual = function (data, item) {
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

ItemData.countSockets = function (sockets) {
  
  if(!sockets) return 0;
  
	var result = 0;  
	sockets.forEach( function(group) {
    if(!group.includes("DV")) {
      result += group.length;
    }
	});
	return result;
}

ItemData.getQuality = function(data) {
  if(!data.properties) return null;
  for(i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Quality") {
      return (data.properties[i].values[0][0]).slice(1, -1);
    }
  }
  return null;
}

ItemData.getLevelRequirement = function(data) {

  if(data.properties) {
    for(i = 0; i < data.properties.length; i++) {
      if(data.properties[i].name === "Map Tier") {
        return Number(data.properties[i].values[0][0]) + 67;
      }
    }
  }

  if(!data.requirements) return null;
  for(i = 0; i < data.requirements.length; i++) {
    if(data.requirements[i].name === "Level") {
      return data.requirements[i].values[0][0];
    }
  }
  return null;

}
	
ItemData.getSockets = function(data) {
  
  if(!data.sockets) return [];
  
  var sockets = [];
  var currGroup = 0;
  var currSockets = "";
  
  for(i = 0; i < data.sockets.length; i++) {
    s = data.sockets[i];
    if(s.group == currGroup) {
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
	
ItemData.getRarity = function(data) {
  return (data.frameType < 1 || data.frameType > 3) ? 0 : data.frameType;
}

ItemData.getGemLevel = function(data) {
  
  if(!data.properties) return false;
  
  var itemClass = ItemData.getClass(data);
  if(itemClass.indexOf("Gem") == -1) return false;
  
  for(i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Level") {
      return (data.properties[i].values[0][0]);
    }
  }
  return false;
}

ItemData.getInfluence = function(data) {
  if(data.elder) return Influence.Elder;
  else if(data.shaper) return Influence.Shaper;
  else return Influence.None;
}

ItemData.isShapedMap = function(data) {
  if(!data.properties) return false;
  for(i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Map Tier") {
      return (data.properties[i].values[0][1] == 1 && data.properties[i].values[0][0] < 16);
    }
  }
  return false;
}

ItemData.isElderMap = function(data) {
  if(!data.properties) return false;
  for(i = 0; i < data.properties.length; i++) {
    if(data.properties[i].name === "Map Tier") {
      return (data.properties[i].values[0][1] == 1 && data.properties[i].values[0][0] == 16);
    }
  }
  return false;
}

ItemData.getClass = function(data) {
  
  if(data.frameType === 8) {
    return "Prophecy";
  }
  if(data.typeLine.includes("Reliquary Key")) {
    return "Misc Map Items";
  }
  
  var cat;
  cat = data.category;
  if(typeof cat !== "string") {
    cat = (Object.keys(data.category))[0];
    if(data.category[cat] && data.category[cat].length > 0) {
      cat = data.category[cat][0];
    }
  }
  switch(cat) {
    case "claw":
    case "shield":
    case "sceptre":
    case "ring":
    case "helmet":
    case "wand":
    case "belt":
    case "dagger":
    case "quiver":
    case "bow":
    case "amulet":
      return cat.charAt(0).toUpperCase() + cat.substr(1) + "s";
    case "boots":
    case "gems":
    case "gloves":
      return cat.charAt(0).toUpperCase() + cat.substr(1);
    case "supportgem":
      return "Support Skill Gems";
    case "activegem":
      return "Active Skill Gems";
    case "currency":
    case "fossil":
      return "Currency";
    case "resonator":
      return "Delve Socketable Currency";      
    case "onesword":
      return "One Hand Swords";
    case "onemace":
      return "One Hand Maces";
    case "oneaxe":
      return "One Hand Axes";
    case "twosword":
      return "Two Hand Swords";
    case "twomace":
      return "Two Hand Maces";
    case "twoaxe":
      return "Two Hand Axes";
    case "flasks":
      if(data.typeLine.indexOf("Life") != -1) return "Life Flasks";
      if(data.typeLine.indexOf("Mana") != -1) return "Mana Flasks";
      if(data.typeLine.indexOf("Hybrid") != -1) return "Hybrid Flasks";
      if(data.typeLine.indexOf("Diamond") != -1) return "Critical Utility Flasks";
      return "Utility Flasks";
    case "jewels":
      return "Jewel";
    case "abyss":
      return "Abyss Jewel";
    case "chest":
      return "Body Armours";
    case "staff":
      return "Staves";
    case "cards":
      return "Divination Card";
    case "soul":
      return "Pantheon Soul";
    case "misc":
      if(data.frameType == 7) return "Quest Items";
      if(data.frameType == 5) return "Labyrinth Items";
    case "maps":
      if(data.typeLine.indexOf("Map") !== -1) return "Maps";
      return "Map Fragments";
    case "fragment":
      return "Map Fragments";
    case "piece":
      return "Harbinger Item Piece";
    default:
      console.log("No item class found! category: " + cat);
      console.log(data);
      throw new Error("DEAD");
  }
}

function Item (itemdata)
{
  
	this.rawData = itemdata;
	this.name = itemdata.name.replace("<<set:MS>><<set:M>><<set:S>>", "").replace(/<>/g, "");
  this.id = itemdata.id;

	this.itemLevel = Math.max(1, itemdata.ilvl);
	this.dropLevel = Math.max(1, ItemData.getLevelRequirement(itemdata));

	this.quality = ItemData.getQuality(itemdata);
	this.rarity = ItemData.getRarity(itemdata);

	this.itemClass = ItemData.getClass(itemdata);
	this.baseType = itemdata.typeLine.replace("<<set:MS>><<set:M>><<set:S>>", "").replace(/<>/g, "");
	this.identified = itemdata.identified || false;
	this.corrupted = itemdata.corrupted || false;
	this.influence = ItemData.getInfluence(itemdata);
	this.shapedMap = ItemData.isShapedMap(itemdata);
	this.elderMap = ItemData.isElderMap(itemdata);
	this.stackSize = itemdata.stackSize;

  this.veiled = itemdata.veiled;
  
  if(this.itemClass === "Prophecy") {
    this.name = this.baseType;
    this.baseType = this.itemClass;
    this.itemClass = "Currency";
  }

	this.width = itemdata.w;
	this.height = itemdata.h;

	this.sockets = ItemData.getSockets(itemdata);
	this.gemLevel = ItemData.getGemLevel(itemdata);

	this.outerElement = null;
	this.domElement = null;
	this.matchingRule = null;

	this.getDisplayName = function() {
		if (!this.identified && this.quality > 0) {
			return this.baseType;
		}
		if (!this.identified || !this.name) {
			return (this.stackSize > 1 ? this.stackSize + " x " : "") + this.baseType;
		}
		else {
			return this.name + (this.baseType === "Prophecy" ? "" : "<BR>" + this.baseType);
		}
	}

	this.getNumSockets = function() {
		return ItemData.countSockets( this.sockets );
	}
  
	this.hasExplicitMod = function(mod) {
      if(mod === "Veil" && this.veiled) {
        return true;
      } else {
        return this.explicitMods && this.explicitMods.includes( mod );
      }
	}  

	this.draw = function() {
		var outerDiv = document.createElement( 'div' );
		outerDiv.className = 'item-container';

		var itemDiv = document.createElement( 'div' );
		itemDiv.className = 'item';

    var influenceDiv = document.createElement( 'span' );
    if(this.veiled) {
      influenceDiv.innerHTML = "<img src='res/veiled.png' style='width:24px;height:24px;margin:4px 4px 0px 0px'/>";
    } else {
      switch(this.influence) {
        case Influence.Shaper:
          influenceDiv.innerHTML = "<img src='res/shaper.png' style='width:24px;height:24px;margin:4px 4px 0px 0px'/>";
          break;
        case Influence.Elder:
          influenceDiv.innerHTML = "<img src='res/elder.png' style='width:24px;height:24px;margin:4px 4px 0px 0px'/>";
          break;
        default:
            break;
      }
    }
    itemDiv.append(influenceDiv);

		var itemName = document.createElement( 'span' );
    itemName.id = this.id;
    itemName.classList.add('item-name');
		if(this.influence == Influence.Shaper || this.influence == Influence.Elder) {
		  itemName.classList.add('influenced');
		}
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

	this.setVisibility = function (visibility) {
		if (this.itemClass === 'Quest Items' || this.itemClass === 'Labyrinth Item' || this.itemClass === 'Labyrinth Trinket') {
			visibility = true;
		}
		visibility = true;
		this.outerElement.className = (visibility ? 'item-container' : 'hidden-item-container');
		this.domElement.style.visibility = (visibility ? 'visible' : 'hidden');
	}

	this.setTextColor = function (color) {
		getLabel( this ).style.color = buildCssColor( color );
	}

	this.removeBorder = function() {
		this.domElement.style.border = '';
	}

	this.setBorderColor = function (color) {
		this.domElement.style.border = '1px solid ' + buildCssColor( color );
	}

	this.setBackgroundColor = function (color) {
		this.domElement.style.backgroundColor = buildCssColor( color );
	}

	this.setFontSize = function (size) {
		var actualSize = MathUtils.remap( size, 18, 45, 8, 24 );
		getLabel( this ).style.fontSize = (actualSize).toString() + 'px';
	}

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

				newXY = incrementSocketPos( x, y );
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

