var StrUtils = {

	// Checks if string haystack contains needle
	contains: function (needle, haystack) {
		return haystack.indexOf( needle ) > -1;
	},

	// Checks if str starts with prefix.
	startsWith: function (str, prefix) {
		return str.indexOf( prefix ) === 0;
	},

	// Checks if str ends with the suffix.
	endsWith: function (str, suffix) {
		return str.indexOf( suffix ) === str.length - suffix.length;
	},

	// Alphabetically sorts all characters in the string.
	// Characters must either be all uppercase or all lowercase.
	// Does not take locale into account.
	sortChars: function (str) {
		return str.split('').sort().join('');
	},

	// Checks if string A consists only of the characters in string B
	consistsOf: function (a, b) {
		var validChars = b.split('');
		return a.split('').every( function(c) { return validChars.indexOf(c) >= 0; } );
	},

	// Counts how often a character occurs in the string.
	countChar: function (c, str) {
		var count = 0;
		for (var i=0; i < str.length; i++) {
			if (str[i] === c) {
				count++;
			}
		}
		return count;
	},

	// Counts all chars in the string. Returns an object with char -> amount.
	countChars: function (str) {
		var result = { };
		for (var i=0; i < str.length; i++) {
			var c = str[i];
			if (c in result) {
				result[c]++;
			}
			else {
				result[c] = 1;
			}
		}
		return result;
	},

	ltrim: function (stringToTrim) {
		return stringToTrim.replace(/^\s+/,"");
	},

	rtrim: function (stringToTrim) {
		return stringToTrim.replace(/\s+$/,"");
	},

	replaceAll: function (str, old, replacement) {
		return str.split( old ).join( replacement );
	},

	parseIntOrDefault: function (str, defaultValue) {
		var result = parseInt(str);
		return isNaN(result) ? defaultValue : result;
	}
};

var ArrayUtils = {
	//+ Jonas Raoni Soares Silva
	//@ http://jsfromhell.com/array/shuffle [v1.0]
	shuffle: function(o) {
		for(var j, x, i = o.length; i; j = Math.floor(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
		return o;
	},

	areEqual: function (a, b) {
		if (a.length !== b.length) return false;
		for (var i=0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	},

	contains: function (a,x) {
		var idx = a.indexOf(x);
		return idx >= 0;
	}
};

var DomUtils = {

	endsWithBR: function (elem) {
		if (elem.childNodes.length == 0) {
			return false;
		}

		// look at child nodes, start at the end
		for (var i = elem.childNodes.length - 1; i >= 0; i++) {
			var child = elem.childNodes[i];

			// skip comments
			if (child.nodeType === 8) {
				continue;
			}

			if (child.nodeType === 1) {
				if (child.nodeName === 'BR') {
					return true;
				}
			}

			return false;
		}
	},

	// Returns all text inside the given node(s).
	// <br> elements and blocks like <div> appear as newlines in the text.
	// This behaves similarly to the innerText property available in Chrome and IE.
	getText: function (elem) {
		return DomUtils._getText( elem.childNodes, '' );
	},

	_getText: function (elems, text) {
		for (var i = 0; elems[i]; i++) {
			var elem = elems[i];

			// Get the text from Text and CDATA nodes
			if (elem.nodeType === 3 || elem.nodeType === 4) {
				text += elem.nodeValue;
			}
			// Special handling for certain elements:
			else if (elem.nodeType === 1) {
				// Insert newlines for <br> elements
				if (elem.nodeName === 'BR') {
					text += '\n';
					continue;
				}

				// Ignore invisible elements
				var style = window.getComputedStyle( elem );
				if (style.display === 'none' || style.visibility === 'hidden') {
					continue;
				}

				// Add newline before each block, unless we are already on a new line
				// or this is the very first block in the list
				if (style.display === 'block') {
					if (text.length > 0 && text[text.length - 1] !== '\n') {
						text += '\n';
					}
				}

				// Traverse child nodes
				text = DomUtils._getText( elem.childNodes, text );

				// Add newline after each block unless there already is a new line.
				if (style.display === 'block') {
					if (text.length > 0 && text[text.length - 1] !== '\n') {
						text += '\n';
					}
				}
			}
			// Traverse all other nodes, except for comments
			else if ( elem.nodeType !== 8 ) {
				text = DomUtils._getText( elem.childNodes, text );
			}
		}

		return text;
	},

	setText: function (elem, text) {
//		text = StrUtils.replaceAll( text, '\n', '<br>' );
		var lines = StrUtils.replaceAll( text, '  ', '&nbsp; ' ).split( '\n' );

		DomUtils.removeAllChildren( elem );
		for (var i=0; i < lines.length; i++) {
			elem.appendChild( document.createTextNode( lines[i] ) );
			if (i < lines.length - 1) {
				elem.appendChild( document.createElement( 'br' ) );
			}
		}
	},

	// Returns the current selection in the given element.
	// Selection is stored as character offsets.
    saveSelection: function (element) {
    	return rangy.getSelection().saveCharacterRanges( element );
    },

	// Restores a saved selection on the given element.
	// Selection is applied based on character counts.
	// If text is inserted, you need to manually adjust the selection by providing an offset.
    restoreSelection: function (element, selection, offset) {
    	if (selection !== null && selection.length > 0) {
	    	selection[0].characterRange.start += offset;
    		selection[0].characterRange.end += offset;
    	}
    	rangy.getSelection().restoreCharacterRanges( element, selection );
    },

	// Returns the number of characters before the cursor in the given selection.
	getSelectionCharOffset: function (selection) {
		return selection[0].characterRange.start;
	},

	isValidSelection: function (selection) {
		return selection && selection.length;
	},

	removeAllChildren: function (elem) {
		while (elem.lastChild) {
			elem.removeChild( elem.lastChild );
		}
	}
};

var MathUtils = {
	clamp: function (value, min, max) {
		return Math.min( max, Math.max( min, value ) );
	},

	remap: function (value, oldmin, oldmax, newmin, newmax) {
		var t = (value - oldmin) / (oldmax - oldmin);
		return newmin + t * (newmax - newmin);
	}
};

var StorageUtils = {
	save: function (key, value) {
		if (typeof(Storage) !== 'undefined') {
			localStorage.setItem( key, value );
		}
	},

	load: function (key, defaultValue) {
		if (typeof(Storage) !== 'undefined') {
			if (key in localStorage) {
				return localStorage[key];
			}
		}
		return defaultValue;
	},
};

var UrlUtils = {
	isSSL: function() {
		return window.location.protocol === 'https:';
	},

	redirectToProtocol: function (protocol) {
		window.location.href = protocol + ':' + window.location.href.substring( window.location.protocol.length );
	}
};

var EventUtils = {
	// There are different ways how the key code may be stored in the event on different browsers
	getKeyCode: function (event) {
		if (event.keyCode) {
			return event.keyCode;
		}
		else if (event.which) {
			return event.which;
		}
	}
}

var MiscUtils = {
  
	preload : function(src) {
    img = new Image();
    img.src = src;
  },
  

  getDateString : function(date) {
    return( 
      date.getFullYear()
      + zeropad(date.getMonth()+1)
      + zeropad(date.getDate())
      + "_"
      + zeropad(date.getHours())
      + zeropad(date.getMinutes())
      + zeropad(date.getSeconds())
    );
    
    function zeropad(n) {
      return (n < 10 ? "0" : "") +  n;
    }
  },
  
  getRunningTime : function(time1, time2) {
    t1 = getDate(time1);
    t2 = getDate(time2);
    console.log("Start date is " + t1);
    console.log("End date is " + t2);
    secdiff = (t2.getTime() - t1.getTime()) / 1000;
    seconds = secdiff % 60;
    minutes = Math.floor(secdiff / 60) % 60;
    hours = Math.floor(Math.floor(secdiff / 60) / 60);
    if(seconds < 10) {
      seconds = "0" + seconds;
    }
    if(minutes < 10 && hours > 0) {
      minutes = "0" + minutes;
    }
    return (hours > 0 ? hours + ":" : "") + minutes + ":" + seconds;

    function getDate(time1) {
			return new Date(
        time1.substring(0,4),
        (time1.substring(4,6)) - 1,
        time1.substring(6,8),
        time1.substring(9,11),
        time1.substring(11,13),
        time1.substring(13, 15)
      );
		}
  },
  
  applyDefaultStyle : function(item) {
    
    var Rarity = {
      Normal: 0,
      Magic: 1,
      Rare: 2,
      Unique: 3
    };
    
    var BLACK_75 = {r:0, g:0, b:0, a:190};
    var WHITE = {r:200, g:200, b:200};
    var BLUE = {r:136, g:136, b:255};
    var YELLOW = {r:255, g:255, b:119};
    var ORANGE = {r:175, g:96, b:37};
    var GOLD = {r:170, g:158, b:130};
    var CYAN = {r:27, g:162, b:155};
    var GREEN = {r:74, g:230, b:58};
    var LIGHT_CYAN = {r:170, g:230, b:230};

    var color = WHITE;

    if (item.rarity === Rarity.Magic) {
      color = BLUE;
    }
    else if (item.rarity === Rarity.Rare) {
      color = YELLOW;
    }
    else if (item.rarity === Rarity.Unique) {
      color = ORANGE;
    }
    else if (item.itemClass === 'Currency') {
      color = GOLD;
    }
    else if (StrUtils.contains( 'Gem', item.itemClass )) {
      color = CYAN;
    }
    else if (item.itemClass === 'Quest Items') {
      color = GREEN;
    }
    else if (item.itemClass === 'Divination Card') {
      color = LIGHT_CYAN;
    }
    else if (item.itemClass === 'Labyrinth Item' || item.itemClass === 'Labyrinth Trinket') {
      color = GOLD;
    }

    item.setVisibility( true );
    item.removeBorder();
    item.setBackgroundColor( BLACK_75 );
    item.setTextColor( color );
    item.setFontSize( 32 );

    if (item.itemClass === 'Maps' || item.itemClass === 'Map Fragments') {
      item.setBorderColor( color );
    }
  },
  
  formatDate : function(e) {
    return"[" + e.substring(0,4) + "-" + e.substring(4,6) + "-" + e.substring(6,8) + " " + e.substring(8,10) + ":" + e.substring(10,12) + ":" + e.substring(12,14) + "]";
  }
  
}