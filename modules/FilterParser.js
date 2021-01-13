const logger = require("./Log").getLogger(__filename);
const ItemData = require("./ItemData");
const fs = require('fs');

const Rarity = ItemData.Rarity;

// note: order important - longer tokens first
const COMPARERS = {
  '<=': function(a,b) { return a <= b; },
  '>=': function(a,b) { return a >= b; },
  '==': function(a,b) { return a == b; },
  '>': function(a,b) { return a > b; },
  '<': function(a,b) { return a < b; },
  '=': function(a,b) { return a == b; },
};
const OPERATOR_TOKENS = ["<=", ">=", "==", ">", "<", "="];

var cachedParser = {};
var currentAreaLevel = null;


function test(filterText) {
  return parseFilter(filterText);
}

async function get(forID, char) {
  
  var filterID = await getFilterID(forID, char);
  if(cachedParser[filterID]) {
    return cachedParser[filterID];
  }
  
  var parser = parseFilter(await getFilterText(forID, char));  
  cachedParser[filterID] = parser;  
  
  return parser;
  
}

function parseFilter(filterText) {
  var lines = filterText.split("\n");
  for (var i = 0; i < lines.length; i++) {
    // Replace all special Unicode whitespace with regular spaces
    lines[i] = lines[i].replace(/\s/g, ' ');
  }
  var parser = new Parser();
  parser.parse(lines);
  return parser;
}

function getFilterID(forID, char) {
  const DB = require('./DB').getDB(char);
  return new Promise( (resolve, reject) => {
    DB.get("select timestamp from filters where timestamp < ? order by timestamp desc limit 1", [forID], (err, row) => {
      if (err) {
        logger.warn(`Failed to get filter ID: ${err}`);
        reject();
      } else if(!row) {
        logger.warn(`No filter found for ${forID}`);
        resolve("");
      } else {
        resolve(row.timestamp);
      }
    });
  });
}

function getFilterText(forID, char) {
  const DB = require('./DB').getDB(char);
  return new Promise( (resolve, reject) => {
    DB.get("select text from filters where timestamp < ? order by timestamp desc limit 1", [forID], (err, row) => {
      if (err) {
        logger.warn(`Failed to get filter: ${err}`);
        reject();
      } else if(!row) {
        logger.warn(`No filter found for ${forID}`);
        resolve("");
      } else {
        resolve(row.text.toString());
      }
    });
  });
}

module.exports.get = get;
module.exports.test = test;



/* parser.js from poedit begins here */

function Parser() {

	var VISIBILITY_TOKENS = [ 'Show', 'Hide' ];
  var CONTINUE_TOKEN = 'Continue';
	var FILTER_TOKENS = [
    'ItemLevel', 'DropLevel', 'Quality', 'Rarity', 'Class', 'BaseType', 'Sockets', 'LinkedSockets', 'SocketGroup',
    'Width', 'Height', 'Identified', 'Corrupted', 'ElderItem', 'ShaperItem', 'ShapedMap', 'HasExplicitMod', 'MapTier',
    'GemLevel', 'StackSize', 'ElderMap', 'Prophecy', 'FracturedItem', 'SynthesisedItem', 'AnyEnchantment', 'HasEnchantment',
    'BlightedMap', 'HasInfluence',
    'Mirrored', 'CorruptedMods', 'AreaLevel',
    'EnchantmentPassiveNode',
    'AlternateQuality', 'Replica', 'GemQualityType',
    'EnchantmentPassiveNum',
  ];
	var MODIFIER_TOKENS = [
	    'SetBackgroundColor', 'SetBorderColor', 'SetTextColor', 'PlayAlertSound', 'PlayAlertSoundPositional',
	    'SetFontSize', 'DisableDropSound', 'CustomAlertSound', 'MinimapIcon', 'PlayEffect' ];
	var RARITY_TOKENS = [ 'Normal', 'Magic', 'Rare', 'Unique' ];
  var INFLUENCE_TOKENS = [ 'shaper', 'elder', 'crusader', 'redeemer', 'hunter', 'warlord' ];
	var SOUND_TOKENS = [ 'ShAlchemy', 'ShBlessed', 'ShChaos', 'ShDivine', 'ShExalted', 'ShFusing', 'ShGeneral', 'ShMirror', 'ShRegal', 'ShVaal' ];
  var COLOR_TOKENS = [ 'Red', 'Green', 'Blue', 'Brown', 'White', 'Yellow', 'Grey', 'Pink', 'Cyan', 'Purple', 'Orange' ]
  var ICON_SHAPE_TOKENS = [ 'Circle', 'Diamond', 'Hexagon', 'Square', 'Star', 'Triangle', 'Kite', 'Cross', 'Pentagon', 'Moon', 'UpsideDownHouse' ]

	this.currentLineNr = 0;
	this.currentRule = null;

	this.ruleSet = [];
	this.errors = [];
	this.warnings = [];
	this.lineTypes = [];
  
  // clear last stored area level when getting new parser
  currentAreaLevel = null;
  this.setAreaLevel = function(level) {
    currentAreaLevel = level;
  }  

	this.parse = function (lines) {
		this.currentRule = null;
		this.ruleSet = [];
		this.errors = [];
		this.warnings = [];
		this.lineTypes = [];

		for (var i = 0; i < lines.length; i++) {
      
      if(this.errors.length > 100) {
        // too many errors, this probably isn't a valid filter - stop now
        break;
      }
      
			this.currentLineNr = i;
			var line = lines[i];

			if (line.trim() === '') {
				this.lineTypes[i] = 'Empty';
				continue;
			}
			if (line.trim()[0] === '#') {
				this.lineTypes[i] = 'Comment';
				continue;
			}
			line = removeComment( line );

			if (VISIBILITY_TOKENS.indexOf( line.trim() ) >= 0) {
				if (this.currentRule !== null) {
					parseEndOfRule( this );
				}
				parseVisibility( this, line );
			}
			else if (CONTINUE_TOKEN === line.trim()) {
				if (this.currentRule !== null) {
          this.currentRule.continue = true;
					parseEndOfRule( this );
				} else {
          reportParseError( this, line.trim(), 'Continue without current rule' );
        }
			}
			else {
				if (this.currentRule === null) {
					reportTokenError( this, line.trim(), 'Show or Hide' );
				}
				else {
					parseFilterOrModifier( this, line );
				}
			}

			if (this.currentRule !== null) {
				this.currentRule.codeLines.push( i );
			}
		}
		parseEndOfRule( this );
	};

	function removeComment (line) {
		var commentStart = line.indexOf("#");
		if (commentStart < 0) {
			return line;
		}
		return line.substring( 0, commentStart );
	}

	function parseVisibility (self, line) {
		var token = line.trim();
		if (VISIBILITY_TOKENS.indexOf( token ) < 0) {
			reportTokenError( self, token, 'Show or Hide' );
			return;
		}

		self.lineTypes[self.currentLineNr] = 'Visibility';
		self.currentRule = new Rule();
	}

	function parseEndOfRule (self) {
		if (self.currentRule !== null) {
			validateRule( self, self.currentRule );
			self.ruleSet.push( self.currentRule );
			self.currentRule = null;
		}
	}

	function validateRule (self, rule) {
		var ruleLine = "(unknown)";
		if (rule.codeLines.length > 0) {
			ruleLine = rule.codeLines[0].toString();
		}

		var soundModifiers = rule.modifiers.filter( function(m) { return m instanceof PlayAlertSoundModifier; } );
		if (soundModifiers.length > 1) {
			reportWarning( self,
				"Multiple PlayAlertSound modifiers found in rule at line " + ruleLine + ". " +
				"Only the last sound will be played."
			);
		}
	}

	function parseFilterOrModifier (self, line) {
		var tokens = line.trim().split(' ', 1);

		if (tokens.length == 0) {
			reportTokenError( self, '', 'filter or modifier' );
			return;
		}

		var token = tokens[0].trim();
		var arguments = line.trim().substring( token.length, line.length );

		if (FILTER_TOKENS.indexOf( token ) >= 0) {
			parseFilter( self, token, arguments );
		}
		else if (MODIFIER_TOKENS.indexOf( token ) >= 0) {
			parseModifier( self, token, arguments );
		}
		else {
			reportTokenError( self, token, 'filter or modifier' );
		}
	}

	// ----------- FILTERS ---------------------------------------------------

	function parseFilter (self, token, arguments) {
		self.lineTypes[self.currentLineNr] = 'Filter';

		var filters = {
			'ItemLevel': ItemLevelFilter,
			'DropLevel': DropLevelFilter,
			'Quality': QualityFilter,
			'Rarity': RarityFilter,
			'Class': ClassFilter,
			'BaseType': BaseTypeFilter,
			'LinkedSockets': LinkedSocketsFilter,
      
      // this is intentional - with 3.9 filter type update,
      // much of the logic for between two filters is shared
			'Sockets': SocketGroupFilter,
			'SocketGroup': SocketGroupFilter,
      
			'Width': WidthFilter,
			'Height': HeightFilter,
			'Identified': IdentifiedFilter,
			'Corrupted': CorruptedFilter,
			'ElderItem': ElderItemFilter,
			'ShaperItem': ShaperItemFilter,
			'ShapedMap': ShapedMapFilter,
			'ElderMap': ElderMapFilter,
			'HasExplicitMod': HasExplicitModFilter,
			'MapTier': MapTierFilter,
			'GemLevel': GemLevelFilter,
			'StackSize': StackSizeFilter,
      'Prophecy': ProphecyFilter,
      'FracturedItem': FracturedItemFilter,
      'SynthesisedItem': SynthesisedItemFilter,
      'AnyEnchantment': AnyEnchantmentFilter,
      'HasEnchantment': HasEnchantmentFilter,
      'BlightedMap': BlightedMapFilter,
      'HasInfluence' : HasInfluenceFilter,
      'Mirrored' : MirroredFilter,
      'CorruptedMods' : CorruptedModsFilter,
      'AreaLevel' : AreaLevelFilter,
      'EnchantmentPassiveNode' : HasEnchantmentFilter,
      'AlternateQuality' : AlternateQualityFilter,
      'Replica' : ReplicaFilter,
      'GemQualityType' : GemQualityTypeFilter,
      'EnchantmentPassiveNum' : EnchantmentPassiveNumFilter
		};

		switch (token) {
			case 'ItemLevel':
			case 'DropLevel':
			case 'Quality':
			case 'LinkedSockets':
			case 'Width':
			case 'Height':
			case 'MapTier':
			case 'GemLevel':
			case 'StackSize':
      case 'CorruptedMods':
      case 'AreaLevel':
			case 'EnchantmentPassiveNum':
				parseNumericFilter( self, filters[token], arguments );
				return;

			case 'Rarity':
				parseRarityFilter( self, filters[token], arguments );
				return;

			case 'Class':
			case 'BaseType':
			case 'HasExplicitMod':
      case 'Prophecy':
			case 'HasEnchantment':
      case 'EnchantmentPassiveNode':
      case 'GemQualityType':
				parseMultiStringFilter( self, filters[token], arguments );
				return;

			case 'Sockets':
				parseSocketGroupFilter( self, filters[token], arguments, "unlinked" );
				return;
			case 'SocketGroup':
				parseSocketGroupFilter( self, filters[token], arguments, "linked" );
				return;

			case 'Identified':
			case 'Corrupted':
			case 'ElderItem':
			case 'ShaperItem':
			case 'ShapedMap':
      case 'ElderMap':
			case 'FracturedItem':
			case 'SynthesisedItem':
      case 'AnyEnchantment':
      case 'BlightedMap':
      case 'Mirrored':
      case 'AlternateQuality':
      case 'Replica':
				parseBoolFilter( self, filters[token], arguments );
				return;
        
			case 'HasInfluence':
				parseInfluenceFilter( self, filters[token], arguments );
				return;

			default:
				// We can only get to this function if token is valid
				reportTokenError( self, token, 'this should never happen' );
		}
	}

	function parseNumericFilter (self, filter, arguments) {
		var args = parseOperatorAndValue( self, arguments );
		if (args !== null) {
			if (isNaN( args.value )) {
				reportTokenError( self, args.value, 'number' );
				return;
			}

			self.currentRule.filters.push( new filter( args.comparer, parseInt( args.value ) ) );
		}
	}

	function parseMultiStringFilter (self, filter, arguments) {
		var args = parseStringArguments( self, arguments );
		if (args === null) return;
		if (args.length === 0) {
			reportUnexpectedEndOfLine( self, 'one or more strings' );
			return;
		}

		self.currentRule.filters.push( new filter( args ) );
	}

	function parseRarityFilter (self, filter, arguments) {
	    var tokens = getArgumentTokens(arguments);
	    if (tokens.length == 0) {
	        reportTokenError( self, arguments, 'rarity')
	        return;
	    }

	    // If the first argument is an operator, we can use the parseOperatorAndValue function
	    if (OPERATOR_TOKENS.includes( tokens[0] )) {
	        args = parseOperatorAndValue( self, arguments );
            if (args != null) {
                if (RARITY_TOKENS.indexOf( args.value ) < 0) {
                    reportTokenError( self, args.value, 'operator or rarity' );
                    return;
                }
                self.currentRule.filters.push( new filter( args.comparer, Rarity[args.value] ) );
                return;
            }
        }

        // Otherwise, the arguments must be a list of rarities.
        var rarities = [];
        for (var i=0; i < tokens.length; i++) {
            if (!RARITY_TOKENS.includes(tokens[i])) {
                reportTokenError( self, tokens[i], 'rarity')
                return;
            }
            rarities.push( Rarity[tokens[i]] );
        }

        // In that case, we create a custom comparer that checks if a rarity is in that list
        var comparer = function(a,b) { return b.includes(a); }
        self.currentRule.filters.push( new filter( comparer, rarities ) );
	}
  
	function parseInfluenceFilter (self, filter, arguments) {
	    var tokens = getArgumentTokens(arguments);
	    if (tokens.length == 0) {
	        reportTokenError( self, arguments, 'influence')
	        return;
	    }
      
      var comparer;      
      
      if(tokens[0] === "==") {
        tokens.shift(); // remove operator
        comparer = function(a,b) {
          // strict equality - must contain all influences specified to match
          for(var i = 0; i < b.length; i++) {
            if(!a.includes(b[i]))  return false;
          }
          return true;
        }
      } else {
        comparer = function(a,b) { 
          // match if any of the specified influences are found
          for(var i = 0; i < a.length; i++) {
            if(b.includes(a[i])) return true;
          }
          return false;
        }
      }

        // the arguments must be a list of influences
        var influences = [];
        for (var i = 0; i < tokens.length; i++) {
            var inf = tokens[i].toLowerCase().replace(/"/g, '');
            if(inf === "none") {
              influences = "none";
              break;
            }
            if (!INFLUENCE_TOKENS.includes(inf)) {
                reportTokenError( self, tokens[i], 'influence')
                return;
            }
            influences.push(inf);
        }

        self.currentRule.filters.push( new filter( comparer, influences ) );
	}
  
	function parseSocketGroupFilter (self, filter, arguments, mode) {
    
	    var tokens = getArgumentTokens(arguments);
	    if (tokens.length == 0) {
	        reportTokenError( self, arguments, 'influence')
	        return;
	    }
      
      var operator = null;
      
			if (OPERATOR_TOKENS.includes(tokens[0])) {
        operator = tokens.shift();
        // single equals: no operator needed, match any of the arguments
        if(operator === "=") {
          operator = null;
        }
      }
      
      var groups = tokens.map( tok => { return tok.toUpperCase(); } );
      
      var isInvalid = groups.some( function(socketGroup) {
        if (!StrUtils.consistsOf( socketGroup, '0123456RGBWDA' )) {
          reportInvalidSocketGroup( self, socketGroup );
          return true;
        }
        return false;
      } );
      
      if (!isInvalid) {        
        groups = groups.map( group => {
          var sorted = StrUtils.sortChars(group);
          return {
            count: sorted.replace(/[RGBWDA]/g, ""),
            sockets: sorted.replace(/[0123456]/g, "")
          };
        });
        self.currentRule.filters.push( new filter( operator, groups, mode ) );
      }
      
	}  

	function parseBoolFilter (self, filter, arguments) {
		var args = parseStringArguments( self, arguments );
		if (args === null) return;
		if (args.length === 0) {
			reportUnexpectedEndOfLine( self, 'expected True or False' );
			return;
		}

		args = args.map( function(a) { return a.toUpperCase(); } );

		if (args[0] !== 'TRUE' && args[0] !== 'FALSE') {
			reportTokenError( self, arguments, 'True or False' );
			return;
		}

		self.currentRule.filters.push( new filter( args[0] === 'TRUE' ) );
	}

	// ----------- MODIFIERS ---------------------------------------------------

	function parseModifier (self, token, arguments) {
		self.lineTypes[self.currentLineNr] = 'Modifier';

		var modifiers = {
			'SetBackgroundColor': SetBackgroundColorModifier,
			'SetBorderColor': SetBorderColorModifier,
			'SetTextColor': SetTextColorModifier,
			'PlayAlertSound': PlayAlertSoundModifier,
			'PlayAlertSoundPositional': PlayAlertSoundPositionalModifier,
			'SetFontSize': SetFontSizeModifier,
			'DisableDropSound': DisableDropSoundModifier,
			'CustomAlertSound': CustomAlertSoundModifier,
			'MinimapIcon': MinimapIconModifier,
			'PlayEffect': PlayEffectModifier,
		};

		switch (token) {
			case 'SetBackgroundColor':
			case 'SetBorderColor':
			case 'SetTextColor':
				parseColorModifier( self, modifiers[token], arguments );
				break;

			case 'SetFontSize':
				parseNumericModifier( self, modifiers[token], arguments );
				break;

      case 'MinimapIcon':
      case 'PlayEffect':
			case 'PlayAlertSound':
			case 'PlayAlertSoundPositional':
			case 'DisableDropSound':
      case 'CustomAlertSound':
				break;

			default:
				// We can only get to this function if token is valid
				reportTokenError( self, token, 'this should never happen' );
		}
	}

	function parseColorModifier (self, modifier, arguments) {
		var numbers = parseNumbers( self, arguments );
		if (numbers === null) return;
		if (numbers.length < 3 || numbers.length > 4) {
			reportTokenError( self, arguments, 'three or four numbers' );
			return;
		}

		if (numbers.some( function(c) { return c < 0 || c > 255; } )) {
			reportParseError( self, arguments, 'color values must be between 0 and 255' );
			return;
		}

		var color = { r:numbers[0], g:numbers[1], b:numbers[2], a:255 };
		if (numbers.length === 4) {
			color['a'] = numbers[3];
		}

		self.currentRule.modifiers.push( new modifier( color ) );
	}

    function parsePlayEffectModifier (self, modifier, arguments) {
        var tokens = arguments.trim().split(' ');
        if (tokens.length > 2) {
            reportTokenError( self, arguments, 'COLOR Temp' );
            return;
        }

        var color = tokens[0].trim();
        if (!COLOR_TOKENS.includes(color)) {
            reportTokenError( self, color, 'Color name');
            return;
        }

        var temp = false;
        if (tokens.length > 1) {
            if (tokens[1] !== 'Temp') {
                reportTokenError( self, tokens[1], 'Temp');
                return;
            }
            temp = true;
        }

        self.currentRule.modifiers.push( new modifier( color, temp ));
    }

	function parseMinimapIconModifier (self, modifier, arguments) {
	    var tokens = arguments.trim().split(' ');
	    if (tokens.length !== 3) {
	        reportTokenError( self, arguments, 'SIZE COLOR SHAPE' );
	        return;
	    }

	    var size = tokens[0];
	    if (size !== '0' && size !== '1' && size !== '2') {
	        reportParseError( self, size, 'SIZE must be 0, 1 or 2' );
	        return;
	    }

	    var color = tokens[1];
	    if (!COLOR_TOKENS.includes(color)) {
	        reportParseError( self, color, 'COLOR must be one of: ' + COLOR_TOKENS.join(', '));
	        return;
	    }

	    var shape = tokens[2];
	    if (!ICON_SHAPE_TOKENS.includes(shape)) {
	        reportParseError( self, shape, 'SHAPE must be one of: ' + ICON_SHAPE_TOKENS.join(', '));
	        return;
	    }

	    self.currentRule.modifiers.push( new modifier( parseInt(size), color, shape ) );
	}

	function parseAlertSoundModifier (self, modifier, arguments) {
	    var tokens = getArgumentTokens( arguments );
	    if (tokens.length < 1 || tokens.length > 2) {
	        reportTokenError( self, arguments, 'sound id + optional volume' );
	        return;
	    }

	    var soundId = parseSoundId( self, tokens[0] );
	    if (soundId === null) return;

	    var volume = 100;
	    if (tokens.length === 2) {
	        if (isNaN(tokens[1])) {
	            reportParseError( self, arguments, 'volume must be a number' );
	            return;
	        }

	        volume = parseInt(tokens[1]);
	        if (volume < 0 || volume > 300) {
	            reportParseError( self, arguments, 'volume must be between 0 and 300' );
	            return;
	        }
	    }

		self.currentRule.modifiers.push( new modifier( soundId, volume ) );
	}

    function parseSoundId (self, token) {
        if (SOUND_TOKENS.indexOf( token ) >= 0) {
            return token;
        }

        if (isNaN(token)) {
            reportParseError( self, token, 'Sound ID must be a number between 1 and 16, or a valid Sound ID name' );
            return;
        }
        return parseInt( token );
    }

	function parseNumericModifier (self, modifier, arguments) {
		var numbers = parseNumbers( self, arguments );
		if (numbers === null) return;
		if (numbers.length != 1) {
			reportTokenError( self, arguments, 'one number' );
			return;
		}

		self.currentRule.modifiers.push( new modifier( numbers[0] ) );
	}

	function parseKeywordModifier (self, modifier, arguments) {
		if (arguments.trim().length > 0) {
			reportTokenError( self, arguments, 'Unexpected argument' );
			return;
		}

		self.currentRule.modifiers.push( new modifier() );
	}

	function parseFilenameModifier (self, modifier, arguments) {
	    var argumentTokens = parseStringArguments( self, arguments );
	    if (argumentTokens.length == 0) {
	        reportUnexpectedEndOfLine( self, arguments, 'Path or Filename' );
	        return;
	    }
	    if (argumentTokens.length > 1) {
	        reportParseError( self, arguments, 'Unexpected argument: "' + argumentTokens[1] + '"' );
	        return;
	    }

	    self.currentRule.modifiers.push( new modifier(argumentTokens[0]) );
	}

	// ------------------------ GENERIC PARSING ---------------------------------

    function getArgumentTokens (arguments) {
        return arguments
			.trim()
			.split(' ')
			.filter( function (element, index, array) { return element.trim().length > 0; } );
    }

	function parseOperatorAndValue (self, arguments) {
		var tokens = getArgumentTokens( arguments );
		var operator, value;

		if (tokens.length == 1) {
			// Special case: For equality checks, you specify only the value
			operator = '=';
			value = tokens[0];
		}
		else if (tokens.length == 2) {
			operator = tokens[0];
			value = tokens[1];
		}
		else {
			reportTokenError( self, arguments, 'operator and value' );
			return null;
		}

		if (OPERATOR_TOKENS.indexOf( operator ) < 0) {
			reportTokenError( self, operator, 'operator' );
			return null;
		}

		return { comparer : COMPARERS[operator], value : value };
    
	}

	function parseNumbers (self, arguments) {
		var tokens = getArgumentTokens( arguments );

		if (tokens.some( isNaN )) {
			reportTokenError( self, arguments, 'numbers' );
			return null;
		}

		return tokens.map( function(n) { return parseInt( n ); } );
	}

	function parseStringArguments (self, arguments) {
		var tokens = arguments
			.trim()
			.split(' ');
			// Don't remove empty tokens because they might represent multiple spaces inside quoted strings

		var actualTokens = [];
		var numQuotes = 0;
		var currentToken = '';
		for (var i=0; i < tokens.length; i++) {
			numQuotes += StrUtils.countChar( '"', tokens[i] );
			var withoutQuotes = StrUtils.replaceAll( tokens[i], '"', '' );

			if (currentToken.length > 0) {
				currentToken += ' ' + withoutQuotes;
			}
			else {
				currentToken = withoutQuotes;
			}

			if (numQuotes % 2 == 0) {
				actualTokens.push( currentToken );
				currentToken = '';
			}
		}

		if (numQuotes % 2 != 0) {
			reportParseError( self, arguments, 'no matching quote' );
			actualTokens.push( currentToken );
		}

		// Remove any empty or pure whitespace tokens.
		// These may happen with certain unicode characters.
		actualTokens = actualTokens.filter( function(token) { return token.trim().length > 0; } );

		return actualTokens;
	}

	// ------------------- ERROR MESSAGES --------------------------------------

	function reportTokenError (self, token, expected) {
		self.errors.push( 'Invalid token "' + token + '" at line ' + self.currentLineNr.toString() + ' (expected ' + expected + ')' );
		self.lineTypes[self.currentLineNr] = 'Error';
	}

	function reportUnexpectedEndOfLine (self, expected) {
		self.errors.push( 'Unexpected end of line (expected ' + expected + ' in line ' + self.currentLineNr.toString() + ')');
		self.lineTypes[self.currentLineNr] = 'Error';
	}

	function reportInvalidSocketGroup (self, socketGroup) {
		self.errors.push( 'Invalid socket group "' + socketGroup + '" + at line ' + self.currentLineNr.toString() + ' (allowed characters are R,G,B)' );
		self.lineTypes[self.currentLineNr] = 'Error';
	}

	function reportParseError (self, text, reason) {
		self.errors.push( 'Cannot parse "' + text + '" (' + reason + ')' );
		self.lineTypes[self.currentLineNr] = 'Error';
	}

	function reportWarning (self, text) {
		self.warnings.push( text );
	}
};

/* parser.js from poedit ends here */

/* rule.js from poedit begins here */


function Rule () {
  this.continue = false;
	this.filters = [];
	this.modifiers = [];
	this.codeLines = [];

	this.match = function (item) {
		return this.filters.every( function (filter) { return filter.match( item ); } );
	}

	this.applyTo = function (item) {
		this.modifiers.forEach( function (modifier) { modifier.applyTo( item ); } );
	}
}


// -------------------- Filters ---------------------

function ItemLevelFilter (comparer, itemLevel) {
	this.match = function (item) {
		return comparer( item.itemLevel, itemLevel );
	};
}

function DropLevelFilter (comparer, dropLevel) {
	this.match = function (item) {
		return comparer( item.dropLevel, dropLevel );
	};
}

function QualityFilter (comparer, quality) {
	this.match = function (item) {
		return comparer( item.quality, quality );
	};
}

// Rarity uses integer representation
function RarityFilter (comparer, rarity) {
	this.match = function (item) {
		return comparer( item.rarity, rarity );
	};
}

function ClassFilter (itemClasses) {
	this.match = function (item) {
		return itemClasses.some( function (cls) { return item.itemClass.includes( cls ); } );
	};
}

function BaseTypeFilter (baseTypes) {
	this.match = function (item) {
		return baseTypes.some( function (bt) { return item.baseType.includes( bt ); } );
	};
}

function SocketsFilter (comparer, numSockets) {
	this.match = function (item) {
    return true;
		return comparer( item.getNumSockets(), numSockets );
	};
}

function LinkedSocketsFilter (comparer, numLinkedSockets) {
	this.match = function (item) {
		var largestSocketGroup = item.sockets
			.map( function (grp) { return grp.length; } )
			.reduce( function (prev, cur) { return Math.max(prev, cur); }, 0 );

		return comparer( largestSocketGroup, numLinkedSockets );
	};
}

function SocketGroupFilter (operator, groups, mode ) {
  
  if(!operator) operator = "=";
  var countComparer = COMPARERS[operator];
  
  function buildSocketGroups(str) {
    var groups = {};
    for(var i = 0; i < str.length; i++) {
      var s = str.charAt(i);
      groups[s] = groups[s] ? groups[s] + 1 : 1;
    }
    return groups;
  }
  
	this.match = function (item) {
    
    var socketsToCheck;
    switch(mode) {
      case "linked":
        socketsToCheck = item.sockets;
        break;
      case "unlinked":
        var socketString = "";
        item.sockets.forEach( s => {
          if(s !== 'DV') {
            socketString += s;
          }
        })
        socketsToCheck = [ socketString ];
        break;
      default:
        throw new Error("Invalid socket group mode");
        break;
    }
      
    
    for(var i = 0; i < groups.length; i++) {

      var seekGroup = groups[i];
      
      if(seekGroup.count) {
        var countMatched = socketsToCheck.some(itemGroup => {
          return countComparer( itemGroup.length, seekGroup.count );
        });
        if(!countMatched) {
          return false;
        }
        if(!seekGroup.sockets) {
          return true;
        }
      }
      
      return socketsToCheck.some(itemGroup => {
        var seekSockets = buildSocketGroups(seekGroup.sockets);
        var itemSockets = buildSocketGroups(itemGroup);
        switch(operator) {
          case "==":
            var result = true;
            for(var s in seekSockets) {
              if(!itemSockets[s] || itemSockets[s] !== seekSockets[s]) result = false;
            }
            if(!seekGroup.count) {
              // if no count specified, extra sockets should cause match to fail
              for(var s in itemSockets) {
                if(!seekSockets[s]) result = false;
              }
            }
            return result;
          case "=":
          case ">=":
            for(var s in seekSockets) {
              if(!itemSockets[s] || itemSockets[s] < seekSockets[s]) return false;
            }
            return true;
          case ">":
            for(var s in seekSockets) {
              if(!itemSockets[s] || itemSockets[s] <= seekSockets[s]) return false;
            }
            return true;
          case "<=":
            for(var s in seekSockets) {
              if(itemSockets[s] && itemSockets[s] > seekSockets[s]) return false;
            }
            return true;
          case "<":
            for(var s in seekSockets) {
              if(itemSockets[s] && itemSockets[s] >= seekSockets[s]) return false;
            }
            return true;
        }
      });
      
    }
    
	};

}

function WidthFilter (comparer, width) {
	this.match = function (item) {
		return comparer( item.width, width );
	}
}

function HeightFilter (comparer, height) {
	this.match = function (item) {
		return comparer( item.height, height );
	}
}

function IdentifiedFilter (value) {
	this.match = function(item) {
		return item.identified === value;
	}
}

function CorruptedFilter (value) {
	this.match = function(item) {
		return item.corrupted === value;
	}
}

function ElderItemFilter (value) {
    this.match = function (item) {
        return (item.influence.includes("elder")) === value;
    }
}

function ShaperItemFilter (value) {
    this.match = function (item) {
      return (item.influence.includes("shaper")) === value;
    }
}

function ShapedMapFilter (value) {
    this.match = function (item) {
        return item.shapedMap === value;
    }
}

function ElderMapFilter (value) {
    this.match = function (item) {
        return item.elderMap === value;
    }
}

function HasExplicitModFilter (mods) {
  
    let operator = ">";
    let value = 0;
    for(let i = 0; i < OPERATOR_TOKENS.length; i++) {
      if(mods[0].startsWith(OPERATOR_TOKENS[i])) {
        operator = OPERATOR_TOKENS[i];
        value = mods[0].replace(operator, "");
        mods.shift();
        break;
      }
    }
    let comparer = COMPARERS[operator];
    
    this.match = function (item) {
      return comparer(mods.filter(mod => item.hasExplicitMod(mod)).length, value);
    }
    
}

function MapTierFilter (comparer, tier) {
    this.match = function (item) {
        return comparer( item.mapTier, tier );
    }
}

function GemLevelFilter (comparer, level) {
    this.match = function (item) {
        return item.gemLevel !== 0 && comparer( item.gemLevel, level );
    }
}

function StackSizeFilter (comparer, size) {
    this.match = function (item) {
        return comparer( item.stackSize, size );
    }
}

function ProphecyFilter (prophecyTypes) {
	this.match = function (item) {
		return item.baseType === "Prophecy" && prophecyTypes.some( function (p) { return item.name.includes( p ); } );
	};
}

function FracturedItemFilter (value) {
    this.match = function (item) {
        return item.fractured === value;
    };
}

function SynthesisedItemFilter (value) {
    this.match = function (item) {
        return item.synthesised === value;
    };
}

function AnyEnchantmentFilter (value) {
  // not accurate - should only count labyrinth enchantments
  // but should be ok if we're only applying this to items picked up
    this.match = function (item) {
        return (item.enchantMods && item.enchantMods.length > 0) === value;
    };
}

function HasEnchantmentFilter (mods) {
    this.match = function (item) {
        return mods.some( function(mod) { return item.hasEnchantment( mod ); } );
    }
}

function BlightedMapFilter (value) {
    this.match = function (item) {
        return item.blightedMap === value;
    }
}

function HasInfluenceFilter (comparer, influences) {
	this.match = function (item) {
    if(influences === "none") {
      return (item.influence.length === 0);
    }
		return comparer( item.influence, influences );
	};
}

function MirroredFilter (value) {
    this.match = function (item) {
        return item.mirrored === value;
    }
}

function CorruptedModsFilter (comparer, modCount) {
    // not accurate - corruption implicits indistiguishable from normal ones, just count implicit mods instead
    this.match = function (item) {
        return item.corrupted && item.implicitMods && comparer( item.implicitMods.length, modCount );
    }
}

function AreaLevelFilter (comparer, level) {
    // not accurate - corruption implicits indistiguishable from normal ones, just count implicit mods instead
    this.match = function (item) {
        return comparer( currentAreaLevel, level );
    }
}

function ReplicaFilter (value) {
    this.match = function (item) {
        return item.replica === value;
    }
}

function AlternateQualityFilter (value) {
    this.match = function (item) {
        return ( ["Anomalous", "Divergent", "Phantasmal"].some(prefix => item.baseType.startsWith(prefix)) === value );
    }
}

function GemQualityTypeFilter (value) {
	this.match = function (item) {
		return item.baseType.startsWith(value);
	};
}

function EnchantmentPassiveNumFilter (comparer, value) {
    // check only "Adds __ Passive Skills" cluster jewel enchant mods
    this.match = function (item) {
      return (
        item.enchantMods && 
        item.enchantMods.some(mod => { 
          return mod.startsWith("Adds ") && mod.endsWith(" Passive Skills") && comparer(Number(mod.substr(5, 2)), value)
        })
      );
    };
}


// ------------------------ Modifiers --------------------------------------

function SetBackgroundColorModifier (color) {
	this.applyTo = function (item) {
    item.styleModifiers.backgroundColor = color;
	}
}

function SetBorderColorModifier (color) {
	this.applyTo = function (item) {
    item.styleModifiers.borderColor = color;
	}
}

function SetTextColorModifier (color) {
	this.applyTo = function (item) {
    item.styleModifiers.textColor = color;
	}
}

function SetFontSizeModifier (fontSize) {
	this.applyTo = function (item) {
    item.styleModifiers.fontSize = MathUtils.remap(fontSize, 18, 45, 25, 50);
	}
}

function PlayAlertSoundModifier (soundId, volume) {
	this.applyTo = function (item) {
		// not implemented
	}
}

function PlayAlertSoundPositionalModifier (soundId, volume) {
	this.applyTo = function (item) {
		// not implemented
	}
}

function DisableDropSoundModifier () {
	this.applyTo = function (item) {
		// not implemented
	}
}

function CustomAlertSoundModifier (path) {
    this.applyTo = function (item) {
        // not implemented
    }
}

function MinimapIconModifier (size, color, shape) {
    this.applyTo = function (item) {
        // not implemented
    }
}

function PlayEffectModifier (color) {
    this.applyTo = function (item) {
        // not implemented
    }
}

/* rule.js from poedit ends here */

