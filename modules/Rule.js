
function Rule (visibility) {
	this.show = visibility;
	this.filters = [];
	this.modifiers = [];
	this.codeLines = [];

	this.match = function (item) {
		return this.filters.every( function (filter) { return filter.match( item ); } );
	}

	this.applyTo = function (item) {
		item.setVisibility( this.show );
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
		return itemClasses.some( function (cls) { return StrUtils.contains( cls, item.itemClass ); } );
	};
}

function BaseTypeFilter (baseTypes) {
	this.match = function (item) {
		return baseTypes.some( function (bt) { return StrUtils.contains( bt, item.baseType ); } );
	};
}

function SocketsFilter (comparer, numSockets) {
	this.match = function (item) {
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

function SocketGroupFilter (groups) {
	this.minSocketCounts = groups.map( StrUtils.countChars );

	function isSubsetOf (subsetCounts, containerCounts) {
		for (var s in containerCounts) {
			if (!(s in subsetCounts)) {
				return false;
			}
			if (subsetCounts[s] < containerCounts[s]) {
				return false;
			}
		}
		return true;
	}

	function matchSocketGroups (grp, refGroups) {
		var socketCounts = StrUtils.countChars( grp );
		return refGroups.some( function (refGrp) {
			return isSubsetOf( socketCounts, refGrp );
		} );
	}

	this.match = function (item) {
		return item.sockets.some( function (grp) {
			return matchSocketGroups( grp, this.minSocketCounts );
		}, this );
	}
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
        return (item.influence === Influence.Elder) === value;
    }
}

function ShaperItemFilter (value) {
    this.match = function (item) {
        return (item.influence === Influence.Shaper) === value;
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
    this.match = function (item) {
        return mods.some( function(mod) { item.hasExplicitMod( mod ); } );
    }
}

function MapTierFilter (comparer, tier) {
    this.match = function (item) {
        return item.mapTier !== 0 && comparer( item.mapTier, tier );
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

// ------------------------ Modifiers --------------------------------------

function SetBackgroundColorModifier (color) {
	this.applyTo = function (item) {
		item.setBackgroundColor( color );
	}
}

function SetBorderColorModifier (color) {
	this.applyTo = function (item) {
		item.setBorderColor( color );
	}
}

function SetTextColorModifier (color) {
	this.applyTo = function (item) {
		item.setTextColor( color );
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

function SetFontSizeModifier (fontSize) {
	this.applyTo = function (item) {
		item.setFontSize( MathUtils.remap(fontSize, 18, 45, 25, 50) );
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
/*  
    var colors = {
        'Red': {r:250, g:120, b: 100},
        'Green': {r:140, g:250, b:120},
        'Blue': {r:130, g:170, b:250},
        'Brown': {r:200, g:130, b:80},
        'White': {r:250, g:250, b:250},
        'Yellow': {r:220, g:220, b:100}
    };

    this.applyTo = function (item) {
       item.setMapIcon( shape, colors[color], size );
    }
*/    
}

function PlayEffectModifier (color) {
/*  
    var colors = {
        'Red': {r:250, g:120, b: 100},
        'Green': {r:140, g:250, b:120},
        'Blue': {r:130, g:170, b:250},
        'Brown': {r:200, g:130, b:80},
        'White': {r:250, g:250, b:250},
        'Yellow': {r:220, g:220, b:100}
    };

    this.applyTo = function (item, temp) {
        item.setBeam( colors[color], temp );
    }
*/    
}