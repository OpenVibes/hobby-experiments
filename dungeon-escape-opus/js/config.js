window.DE = window.DE || {};
(function (DE) {
  'use strict';

  DE.CONFIG = {
    TILE: 32,          // px per tile on the canvas
    VIEW_W: 25,        // tiles visible horizontally  -> canvas 800 px
    VIEW_H: 17,        // tiles visible vertically    -> canvas 544 px
    MAP_W: 56,
    MAP_H: 40,
    FLOORS: 5,
    FOV_RADIUS: 5,     // starting light radius
    MAX_FOV: 8,
    LOG_LINES: 6,
  };

  DE.T = { WALL: 0, FLOOR: 1, DOOR_LOCKED: 2, DOOR_OPEN: 3, STAIRS: 4, EXIT: 5, SPIKES: 6 };

  DE.isWalkable = function (t) {
    return t === DE.T.FLOOR || t === DE.T.DOOR_OPEN || t === DE.T.STAIRS ||
      t === DE.T.EXIT || t === DE.T.SPIKES;
  };

  DE.isOpaque = function (t) {
    return t === DE.T.WALL || t === DE.T.DOOR_LOCKED;
  };

  DE.idx = function (floor, x, y) {
    return y * floor.width + x;
  };

  DE.inBounds = function (floor, x, y) {
    return x >= 0 && y >= 0 && x < floor.width && y < floor.height;
  };

  DE.tileAt = function (floor, x, y) {
    if (!DE.inBounds(floor, x, y)) return DE.T.WALL;
    return floor.tiles[y * floor.width + x];
  };

  DE.setTile = function (floor, x, y, t) {
    if (!DE.inBounds(floor, x, y)) return;
    floor.tiles[y * floor.width + x] = t;
  };

  // mulberry32 PRNG. Same seed -> same sequence.
  DE.makeRng = function (seed) {
    var a = seed | 0;
    function next() {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      int: function (min, max) {
        return min + Math.floor(next() * (max - min + 1));
      },
      pick: function (array) {
        return array[Math.floor(next() * array.length)];
      },
      chance: function (p) {
        return next() < p;
      },
      shuffle: function (array) {
        for (var i = array.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var tmp = array[i];
          array[i] = array[j];
          array[j] = tmp;
        }
        return array;
      },
    };
  };

  DE.DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  DE.PLAYER_BASE = { hp: 20, maxHp: 20, atk: 3, def: 0, fov: 5 };

  // sight = chase radius (Manhattan). erratic = chance per turn to move randomly instead.
  DE.ENEMIES = {
    slime:    { name: 'Slime',    hp: 5,  atk: 2, def: 0, sight: 5, erratic: 0.25, gold: [0, 3],  minFloor: 1, weight: 4 },
    bat:      { name: 'Bat',      hp: 3,  atk: 1, def: 0, sight: 7, erratic: 0.5,  gold: [0, 2],  minFloor: 1, weight: 3 },
    skeleton: { name: 'Skeleton', hp: 9,  atk: 3, def: 1, sight: 6, erratic: 0,    gold: [2, 6],  minFloor: 2, weight: 3 },
    orc:      { name: 'Orc',      hp: 14, atk: 4, def: 2, sight: 6, erratic: 0,    gold: [5, 12], minFloor: 3, weight: 2 },
    wraith:   { name: 'Wraith',   hp: 11, atk: 5, def: 1, sight: 8, erratic: 0.1,  gold: [8, 16], minFloor: 4, weight: 2 },
  };

  DE.ITEMS = {
    potion: { name: 'Health Potion', heal: 8 },
    gold:   { name: 'Gold' },               // amount stored on the item instance
    key:    { name: 'Key' },
    sword:  { name: 'Sword',  atk: 1 },
    shield: { name: 'Shield', def: 1 },
    torch:  { name: 'Torch',  fov: 1 },
  };
})(window.DE);
