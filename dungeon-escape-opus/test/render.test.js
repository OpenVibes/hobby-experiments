'use strict';
// Node check for js/render.js: FOV correctness plus a smoke run of Renderer.draw
// against a stub canvas (no real canvas is needed).
//
// Run: node test/render.test.js

const assert = require('assert');
const path = require('path');

global.window = global;
global.DE = global.DE || {};
const DE = global.DE;

// ---- stubs copied from DESIGN.md sections 1 and 2 --------------------------
DE.CONFIG = {
  TILE: 32, VIEW_W: 25, VIEW_H: 17, MAP_W: 56, MAP_H: 40,
  FLOORS: 5, FOV_RADIUS: 5, MAX_FOV: 8, LOG_LINES: 6,
};
DE.T = { WALL: 0, FLOOR: 1, DOOR_LOCKED: 2, DOOR_OPEN: 3, STAIRS: 4, EXIT: 5, SPIKES: 6 };
DE.isWalkable = (t) => t === DE.T.FLOOR || t === DE.T.DOOR_OPEN || t === DE.T.STAIRS || t === DE.T.EXIT || t === DE.T.SPIKES;
DE.isOpaque = (t) => t === DE.T.WALL || t === DE.T.DOOR_LOCKED;
DE.idx = (floor, x, y) => y * floor.width + x;
DE.inBounds = (floor, x, y) => x >= 0 && y >= 0 && x < floor.width && y < floor.height;
DE.tileAt = (floor, x, y) => (DE.inBounds(floor, x, y) ? floor.tiles[DE.idx(floor, x, y)] : DE.T.WALL);

require(path.join(__dirname, '..', 'js', 'render.js'));

// ---- hand-made floor: 20x12, room interior x 2..14, y 2..8, pillar at (6,5) --
function makeFloor() {
  const width = 20, height = 12;
  const tiles = new Uint8Array(width * height); // all WALL (0)
  for (let y = 2; y <= 8; y++) {
    for (let x = 2; x <= 14; x++) tiles[y * width + x] = DE.T.FLOOR;
  }
  tiles[5 * width + 6] = DE.T.WALL; // pillar
  return { level: 1, width, height, tiles, rooms: [{ x: 2, y: 2, w: 13, h: 7 }],
    start: { x: 4, y: 5 }, stairs: { x: 14, y: 8 }, door: null, key: null,
    enemies: [], items: [] };
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok   - ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL - ' + name + '\n       ' + err.message);
  }
}

const floor = makeFloor();
const W = floor.width;
const vis = (fov, x, y) => fov[y * W + x] === 1;

check('computeFOV returns width*height Uint8Array', () => {
  const fov = DE.computeFOV(floor, 4, 5, 5);
  assert.ok(fov instanceof Uint8Array);
  assert.strictEqual(fov.length, floor.width * floor.height);
});

check('player tile is always visible', () => {
  const fov = DE.computeFOV(floor, 4, 5, 5);
  assert.ok(vis(fov, 4, 5));
  const fov0 = DE.computeFOV(floor, 4, 5, 0);
  assert.ok(vis(fov0, 4, 5));
});

check('tiles directly behind the pillar are not visible', () => {
  const fov = DE.computeFOV(floor, 4, 5, 5);
  assert.ok(!vis(fov, 7, 5), '(7,5) should be hidden behind pillar (6,5)');
  assert.ok(!vis(fov, 8, 5), '(8,5) should be hidden behind pillar (6,5)');
  assert.ok(vis(fov, 6, 5), 'the pillar itself is visible (opaque end tile)');
});

check('room floor in front of the pillar is visible', () => {
  const fov = DE.computeFOV(floor, 4, 5, 5);
  assert.ok(vis(fov, 5, 5));
  assert.ok(vis(fov, 6, 4), 'tile beside pillar should be seen');
});

check('walls bordering the room within radius are visible', () => {
  const fov = DE.computeFOV(floor, 4, 5, 5);
  assert.ok(vis(fov, 1, 5), 'left border wall at distance 3');
  assert.ok(vis(fov, 4, 1), 'top border wall at distance 4');
  assert.ok(vis(fov, 3, 1) || vis(fov, 2, 1), 'top-left border wall near player');
});

check('nothing beyond radius + 0.5 is visible', () => {
  const r = 5;
  const fov = DE.computeFOV(floor, 4, 5, r);
  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const d = Math.hypot(x - 4, y - 5);
      if (d > r + 0.5) assert.ok(!vis(fov, x, y), `(${x},${y}) at distance ${d.toFixed(2)} should be hidden`);
    }
  }
});

check('a larger radius reveals the far right wall, a smaller one does not', () => {
  const near = DE.computeFOV(floor, 4, 5, 5);
  const far = DE.computeFOV(floor, 4, 5, 12);
  assert.ok(!vis(near, 15, 5), 'right wall at distance 11 is hidden with radius 5');
  assert.ok(vis(far, 15, 2), 'right wall (15,2) on an open line is visible with radius 12');
  assert.ok(!vis(far, 15, 5), 'right wall behind the pillar stays hidden even with radius 12');
  assert.ok(vis(far, 14, 2) || vis(far, 14, 8), 'room corners visible with radius 12');
});

check('computeFOV tolerates an out-of-bounds viewer', () => {
  const fov = DE.computeFOV(floor, -3, -3, 5);
  assert.strictEqual(fov.reduce((a, b) => a + b, 0), 0);
});

// ---- Renderer smoke test with a stub canvas --------------------------------
function makeStubCtx() {
  const noop = () => {};
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    lineJoin: 'miter', globalAlpha: 1, imageSmoothingEnabled: true,
    fillRect: noop, strokeRect: noop, clearRect: noop, drawImage: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    fill: noop, stroke: noop, fillText: noop, strokeText: noop,
    putImageData: noop,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => ({ addColorStop: noop }),
    drawImage_calls: 0,
  };
  const realDrawImage = ctx.drawImage;
  ctx.drawImage = (...args) => { ctx.drawImage_calls++; return realDrawImage(...args); };
  return ctx;
}
const stubCtx = makeStubCtx();
global.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
};
const stubCanvas = { width: 800, height: 544, getContext: () => stubCtx };
const smallCanvas = { width: 480, height: 480, getContext: () => stubCtx };

check('Renderer draws without throwing (minimal state, no arrays)', () => {
  const r = new DE.Renderer(stubCanvas);
  r.draw({ floor, player: { id: 'player', x: 4, y: 5, hp: 20, maxHp: 20, facing: 'up' },
    visible: DE.computeFOV(floor, 4, 5, 5), explored: null, fov: 5, now: 1000 });
  r.draw({ floor: null });
  r.draw({});
  r.reset();
});

check('Renderer draws full state with entities, effects and shake', () => {
  // A floor with every tile type so every sprite path is exercised.
  const f = makeFloor();
  f.tiles[3 * W + 3] = DE.T.STAIRS;
  f.tiles[4 * W + 3] = DE.T.EXIT;
  f.tiles[2 * W + 5] = DE.T.SPIKES;
  f.tiles[6 * W + 10] = DE.T.DOOR_LOCKED;
  f.tiles[6 * W + 11] = DE.T.DOOR_OPEN;
  const visible = DE.computeFOV(f, 4, 5, 8);
  const explored = new Uint8Array(visible);
  explored.fill(1, 0, 40);
  const types = ['slime', 'bat', 'skeleton', 'orc', 'wraith'];
  const enemies = types.map((type, i) => ({ id: i + 1, type, x: 5 + (i % 3), y: 3 + (i % 4), hp: 1, maxHp: 5,
    flashUntil: 2000 }));
  const items = ['potion', 'gold', 'key', 'sword', 'shield', 'torch'].map((type, i) => ({ id: 100 + i, type,
    x: 3 + i, y: 7, amount: 4 }));
  const r = new DE.Renderer(stubCanvas);
  for (let frame = 0; frame < 5; frame++) {
    r.draw({
      floor: f,
      player: { id: 'player', x: 4 + frame * 0.2, y: 5, hp: 10, maxHp: 20, facing: ['up', 'down', 'left', 'right'][frame % 4], flashUntil: 1500 },
      enemies, items, visible, explored, fov: 8,
      effects: [{ x: 4, y: 5, text: '-3', color: '#f55', born: 1000, ttl: 900 }],
      shakeUntil: 2000,
      now: 1000 + frame * 16,
    });
  }
});

check('Renderer tolerates explored/visible/effects being undefined', () => {
  const r = new DE.Renderer(stubCanvas);
  r.draw({ floor, player: { id: 'player', x: 4, y: 5, facing: 'down' }, enemies: undefined,
    items: undefined, effects: undefined, now: 5 });
});

check('Renderer tolerates empty arrays and a floor with zero explored tiles', () => {
  const r = new DE.Renderer(stubCanvas);
  r.draw({ floor, player: { id: 'player', x: 4, y: 5, facing: 'down' }, enemies: [], items: [],
    visible: new Uint8Array(W * floor.height), explored: new Uint8Array(W * floor.height),
    effects: [], fov: 5, now: 10 });
});

check('viewport is derived from the canvas size (480x480 shows fewer tiles than 800x544)', () => {
  const state = { floor, player: { id: 'player', x: 4, y: 5, facing: 'down' },
    visible: DE.computeFOV(floor, 4, 5, 5), explored: new Uint8Array(W * floor.height).fill(1), fov: 5, now: 10 };
  const count = (canvas) => {
    stubCtx.drawImage_calls = 0;
    new DE.Renderer(canvas).draw(state);
    return stubCtx.drawImage_calls;
  };
  const big = count(stubCanvas);
  const small = count(smallCanvas);
  assert.ok(small > 0, 'small canvas still draws terrain');
  assert.ok(small < big, `expected fewer tile draws on 480x480 (${small}) than 800x544 (${big})`);
});

check('Renderer draws on a 480x480 canvas with entities and effects', () => {
  const r = new DE.Renderer(smallCanvas);
  r.draw({ floor, player: { id: 'player', x: 4, y: 5, hp: 10, maxHp: 20, facing: 'left', flashUntil: 1500 },
    enemies: [{ id: 1, type: 'orc', x: 5, y: 5, hp: 2, maxHp: 5 }],
    items: [{ id: 2, type: 'gold', x: 3, y: 6 }],
    visible: DE.computeFOV(floor, 4, 5, 5), explored: null, fov: 5,
    effects: [{ x: 4, y: 5, text: '-3', color: '#f55', born: 1000, ttl: 900 }],
    shakeUntil: 2000, now: 1100 });
});

console.log(failures === 0 ? '\nALL RENDER TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
