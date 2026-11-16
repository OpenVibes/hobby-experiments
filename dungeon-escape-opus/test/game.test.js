'use strict';
// Headless tests for js/game.js. Run with: node test/game.test.js

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const JS = path.join(__dirname, '..', 'js');

// ---- browser-ish globals -------------------------------------------------
let clock = 1000;
global.window = global;
Object.defineProperty(global, 'performance', {
  value: { now: () => clock }, configurable: true, writable: true
});
global.requestAnimationFrame = () => 0;   // no real loop during tests
global.window.localStorage = undefined;   // exercise the try/catch path
global.window.innerWidth = 1024;          // desktop width unless a test says otherwise

const keyListeners = {};
global.window.addEventListener = (type, fn) => { keyListeners[type] = fn; };

function makeEl(id) {
  const classes = new Set();
  const el = {
    id,
    style: {},
    textContent: '',
    dataset: {},
    tagName: 'DIV',
    className: '',
    children: [],
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    addEventListener() {},
    _classes: classes
  };
  return el;
}

const elements = {};
const fakeDocument = {
  getElementById(id) {
    if (!elements[id]) elements[id] = makeEl(id);
    return elements[id];
  },
  querySelectorAll() { return []; },
  createElement(tag) {
    const el = makeEl(null);
    el.tagName = String(tag).toUpperCase();
    return el;
  }
};
global.document = fakeDocument;

// ---- load DE: real config/dungeon if present, else stubs -------------------
global.window.DE = global.window.DE || {};
const DE = global.window.DE;

const haveReal = fs.existsSync(path.join(JS, 'config.js')) && fs.existsSync(path.join(JS, 'dungeon.js'));
if (haveReal) {
  require(path.join(JS, 'config.js'));
  require(path.join(JS, 'dungeon.js'));
} else {
  installStubs();
}

// Rendering and FOV are stubbed (render.js may not exist yet).
let drawCalls = [];
let resetCalls = 0;
DE.Renderer = class {
  constructor() {}
  draw(state) { drawCalls.push(state); }
  reset() { resetCalls++; }
};
DE.computeFOV = (floor) => new Uint8Array(floor.width * floor.height).fill(1);

// Audio stub: no WebAudio in Node.
const sounds = [];
DE.audio = {
  play(name) { sounds.push(name); },
  toggleMute() { return false; },
  isMuted() { return false; },
  unlock() {}
};

require(path.join(JS, 'game.js'));

// ---- helpers ---------------------------------------------------------------
function freshGame() {
  const g = new DE.Game();
  g.init();
  g.newRun();
  return g;
}

// Put the player on a clear spot: no enemies or items, all four neighbours floor.
function arrange(g) {
  g.enemies = [];
  g.items = [];
  const p = g.player;
  for (const d of Object.values(DE.DIRS)) {
    DE.setTile(g.floor, p.x + d.x, p.y + d.y, DE.T.FLOOR);
  }
  return p;
}

function addEnemy(g, type, x, y) {
  const def = DE.ENEMIES[type];
  const e = { id: 1000 + g.enemies.length, type, x, y, hp: def.hp, maxHp: def.hp, flashUntil: 0 };
  g.enemies.push(e);
  return e;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   - ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL - ' + name + '\n       ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err));
  }
}

// ---- tests -----------------------------------------------------------------

test('init then newRun puts the game in playing mode on floor 1', () => {
  const g = freshGame();
  assert.strictEqual(g.mode, 'playing');
  assert.strictEqual(g.level, 1);
  assert.ok(g.floor && g.floor.width > 0, 'floor generated');
  assert.strictEqual(g.player.x, g.floor.start.x);
  assert.strictEqual(g.player.y, g.floor.start.y);
  assert.strictEqual(g.player.hp, DE.PLAYER_BASE.hp);
});

test('walking into a wall does not pass a turn or move the player', () => {
  const g = freshGame();
  const p = arrange(g);
  DE.setTile(g.floor, p.x + 1, p.y, DE.T.WALL);
  const before = { x: p.x, y: p.y, turns: g.turns };
  assert.strictEqual(g.act('right'), false);
  assert.deepStrictEqual({ x: p.x, y: p.y, turns: g.turns }, before);
});

test('bumping a locked door without a key does not pass a turn', () => {
  const g = freshGame();
  const p = arrange(g);
  DE.setTile(g.floor, p.x + 1, p.y, DE.T.DOOR_LOCKED);
  p.keys = 0;
  assert.strictEqual(g.act('right'), false);
  assert.strictEqual(g.turns, 0);
  assert.strictEqual(DE.tileAt(g.floor, p.x + 1, p.y), DE.T.DOOR_LOCKED);
  assert.strictEqual(p.x, g.floor.start.x);
});

test('bumping a locked door with a key opens it (uses the key and a turn)', () => {
  const g = freshGame();
  const p = arrange(g);
  const doorX = p.x + 1;
  DE.setTile(g.floor, doorX, p.y, DE.T.DOOR_LOCKED);
  p.keys = 1;
  const startX = p.x;
  assert.strictEqual(g.act('right'), true);
  assert.strictEqual(DE.tileAt(g.floor, doorX, p.y), DE.T.DOOR_OPEN);
  assert.strictEqual(p.keys, 0);
  assert.strictEqual(g.turns, 1);
  assert.strictEqual(p.x, startX, 'opening the door does not move the player');
  assert.strictEqual(g.act('right'), true);
  assert.strictEqual(p.x, doorX, 'player walks through the open door');
});

test('attacking an enemy reduces its hp; killing it removes it and counts a kill', () => {
  const g = freshGame();
  const p = arrange(g);
  const e = addEnemy(g, 'slime', p.x + 1, p.y);
  e.hp = 5;
  g.act('right');
  assert.ok(e.hp < 5, 'enemy took damage (hp now ' + e.hp + ')');
  assert.ok(g.enemies.includes(e) || e.hp <= 0);

  e.hp = 1;
  g.act('right');
  assert.ok(!g.enemies.includes(e), 'killed enemy removed');
  assert.strictEqual(g.kills, 1);
});

test('stepping on the stairs increments the floor level', () => {
  const g = freshGame();
  const p = arrange(g);
  DE.setTile(g.floor, p.x + 1, p.y, DE.T.STAIRS);
  assert.strictEqual(g.act('right'), true);
  assert.strictEqual(g.level, 2);
  assert.strictEqual(g.floor.level, 2);
});

test('an adjacent enemy damages the player on a wait turn', () => {
  const g = freshGame();
  const p = arrange(g);
  addEnemy(g, 'orc', p.x - 1, p.y);
  const hp = p.hp;
  g.act('wait');
  assert.ok(p.hp < hp, 'player took damage (hp ' + hp + ' -> ' + p.hp + ')');
});

test('hp at or below zero sets mode to dead', () => {
  const g = freshGame();
  const p = arrange(g);
  addEnemy(g, 'orc', p.x - 1, p.y);
  p.hp = 1;
  g.act('wait');
  assert.strictEqual(p.hp <= 0, true);
  assert.strictEqual(g.mode, 'dead');
  assert.ok(/Slain by an Orc/.test(elements['dead-stats'].textContent), 'cause text: ' + elements['dead-stats'].textContent);
});

test('spikes deal 2 damage once, not twice', () => {
  const g = freshGame();
  const p = arrange(g);
  DE.setTile(g.floor, p.x + 1, p.y, DE.T.SPIKES);
  const hp = p.hp;
  g.act('right');
  assert.strictEqual(hp - p.hp, 2);
});

test('input throttle: a second key within 110 ms is ignored', () => {
  const g = freshGame();
  const p = arrange(g);
  DE.setTile(g.floor, p.x + 2, p.y, DE.T.FLOOR);
  DE.setTile(g.floor, p.x + 3, p.y, DE.T.FLOOR);
  const x0 = p.x;
  clock = 5000;
  g.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  assert.strictEqual(p.x, x0 + 1, 'first key steps');
  clock = 5050;
  g.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  assert.strictEqual(p.x, x0 + 1, 'repeat within 110 ms ignored');
  clock = 5200;
  g.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  assert.strictEqual(p.x, x0 + 2, 'step taken after the repeat window');
});

test('frame() calls renderer.draw with the state shape', () => {
  const g = freshGame();
  drawCalls = [];
  g.frame();
  assert.strictEqual(drawCalls.length, 1);
  const s = drawCalls[0];
  for (const k of ['floor', 'player', 'enemies', 'items', 'visible', 'explored', 'fov', 'effects', 'shakeUntil', 'now']) {
    assert.ok(k in s, 'state has ' + k);
  }
});

test('mute button text follows DE.audio.toggleMute', () => {
  const g = freshGame();
  DE.audio.toggleMute = () => true;
  g.toggleMute();
  assert.strictEqual(elements['btn-mute'].textContent, '\u{1F507}');
  DE.audio.toggleMute = () => false;
  g.toggleMute();
  assert.strictEqual(elements['btn-mute'].textContent, '\u{1F50A}');
});

test('init tolerates missing DOM elements', () => {
  const saved = fakeDocument.getElementById;
  fakeDocument.getElementById = () => null;
  try {
    const g = new DE.Game();
    g.init();
    g.newRun();
    const p = arrange(g);
    g.act('wait');
    assert.strictEqual(g.mode, 'playing');
    assert.ok(p);
  } finally {
    fakeDocument.getElementById = saved;
  }
});

test('title backdrop: whole floor explored, nothing acts, turns stay 0', () => {
  const saved = fakeDocument.getElementById;
  const g = new DE.Game();
  g.init();
  assert.strictEqual(g.mode, 'title');
  assert.ok(g.explored.every((v) => v === 1), 'every tile explored on the title screen');
  assert.ok(g.visible && g.visible.some((v) => v === 1), 'some tiles visible around the start');
  const before = { turns: g.turns, enemies: g.enemies.map((e) => [e.x, e.y]) };
  assert.strictEqual(g.act('right'), false);
  assert.strictEqual(g.act('wait'), false);
  assert.deepStrictEqual({ turns: g.turns, enemies: g.enemies.map((e) => [e.x, e.y]) }, before);
  const backdropExplored = g.explored;
  g.newRun();
  assert.notStrictEqual(g.explored, backdropExplored, 'explored is a fresh array for a real run');
  fakeDocument.getElementById = saved;
});

test('fitCanvas: 15x15 tiles on narrow screens, 25x17 otherwise, sets size only on change', () => {
  const g = new DE.Game();
  g.init();
  const canvas = elements['game-canvas'];
  global.window.innerWidth = 390;
  g.fitCanvas();
  assert.strictEqual(canvas.width, 480);
  assert.strictEqual(canvas.height, 480);
  global.window.innerWidth = 1024;
  g.fitCanvas();
  assert.strictEqual(canvas.width, 800);
  assert.strictEqual(canvas.height, 544);
});

// ---- report ----------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

// ---- stubs for when config.js / dungeon.js are not present -----------------
function installStubs() {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  DE.CONFIG = { TILE: 32, VIEW_W: 25, VIEW_H: 17, MAP_W: 56, MAP_H: 40, FLOORS: 5, FOV_RADIUS: 5, MAX_FOV: 8, LOG_LINES: 6 };
  DE.T = { WALL: 0, FLOOR: 1, DOOR_LOCKED: 2, DOOR_OPEN: 3, STAIRS: 4, EXIT: 5, SPIKES: 6 };
  DE.isWalkable = (t) => t === DE.T.FLOOR || t === DE.T.DOOR_OPEN || t === DE.T.STAIRS || t === DE.T.EXIT || t === DE.T.SPIKES;
  DE.isOpaque = (t) => t === DE.T.WALL || t === DE.T.DOOR_LOCKED;
  DE.idx = (f, x, y) => y * f.width + x;
  DE.inBounds = (f, x, y) => x >= 0 && y >= 0 && x < f.width && y < f.height;
  DE.tileAt = (f, x, y) => (DE.inBounds(f, x, y) ? f.tiles[DE.idx(f, x, y)] : DE.T.WALL);
  DE.setTile = (f, x, y, t) => { if (DE.inBounds(f, x, y)) f.tiles[DE.idx(f, x, y)] = t; };
  DE.makeRng = (seed) => {
    const r = mulberry32(seed >>> 0 || 1);
    const rng = {
      next: () => r(),
      int: (min, max) => min + Math.floor(r() * (max - min + 1)),
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      chance: (p) => r() < p,
      shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
    };
    return rng;
  };
  DE.DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  DE.PLAYER_BASE = { hp: 20, maxHp: 20, atk: 3, def: 0, fov: 5 };
  DE.ENEMIES = {
    slime: { name: 'Slime', hp: 5, atk: 2, def: 0, sight: 5, erratic: 0.25, gold: [0, 3], minFloor: 1, weight: 4 },
    orc: { name: 'Orc', hp: 14, atk: 4, def: 2, sight: 6, erratic: 0, gold: [5, 12], minFloor: 3, weight: 2 }
  };
  DE.ITEMS = {
    potion: { name: 'Health Potion', heal: 8 }, gold: { name: 'Gold' }, key: { name: 'Key' },
    sword: { name: 'Sword', atk: 1 }, shield: { name: 'Shield', def: 1 }, torch: { name: 'Torch', fov: 1 }
  };
  DE.generateFloor = (level, seed) => {
    const W = 30, H = 20;
    const tiles = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) tiles[y * W + x] = DE.T.FLOOR;
    return {
      level, width: W, height: H, tiles,
      rooms: [{ x: 1, y: 1, w: W - 2, h: H - 2 }],
      start: { x: 5, y: 5 },
      stairs: { x: W - 3, y: H - 3 },
      door: null, key: null, enemies: [], items: []
    };
  };
}
