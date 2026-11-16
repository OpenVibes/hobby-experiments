'use strict';
// Node test for js/config.js and js/dungeon.js. Run: node test/dungeon.test.js
global.window = global;
const path = require('path');
require(path.join(__dirname, '..', 'js', 'config.js'));
require(path.join(__dirname, '..', 'js', 'dungeon.js'));

const DE = window.DE;
const C = DE.CONFIG;
const T = DE.T;
const W = C.MAP_W, H = C.MAP_H;
const SEEDS = 200;

let checks = 0, failures = 0;
const failMsgs = [];
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    if (failMsgs.length < 40) failMsgs.push(msg);
  }
}

// Independent BFS. doorOpen=false treats DOOR_LOCKED as a wall.
function bfs(floor, sx, sy, doorOpen) {
  const seen = new Uint8Array(W * H);
  const q = [[sx, sy]];
  seen[sy * W + sx] = 1;
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = ny * W + nx;
      if (seen[i]) continue;
      const t = floor.tiles[i];
      const ok = DE.isWalkable(t) || (doorOpen && t === T.DOOR_LOCKED);
      if (!ok) continue;
      seen[i] = 1;
      q.push([nx, ny]);
    }
  }
  return seen;
}

const key = (p) => p.x + ',' + p.y;
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const stats = { floors: 0, doorNull: 0, withDoor: 0, multiEntranceCarved: 0 };
const levelStats = {};
let sampleFloor = null;

for (let level = 1; level <= C.FLOORS; level++) {
  levelStats[level] = { floors: 0, doorNull: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const tag = `L${level} seed${seed}`;
    const f = DE.generateFloor(level, seed);
    stats.floors++;
    levelStats[level].floors++;
    if (level === 3 && seed === 42) sampleFloor = f;

    // Shape
    check(f.level === level && f.width === W && f.height === H, tag + ': level/size');
    check(f.tiles instanceof Uint8Array && f.tiles.length === W * H, tag + ': tile array length');
    check(f.enemies.length === 4 + level * 2, tag + ': enemy count ' + f.enemies.length);

    // Tile types: exactly one exit/stairs, EXIT only on final floor
    let nExit = 0, nStairs = 0;
    for (const t of f.tiles) {
      if (t === T.EXIT) nExit++;
      if (t === T.STAIRS) nStairs++;
      check(t >= 0 && t <= 6, tag + ': bad tile value');
    }
    if (level === C.FLOORS) check(nExit === 1 && nStairs === 0, tag + ': level 5 must have one EXIT, no STAIRS');
    else check(nStairs === 1 && nExit === 0, tag + ': levels 1-4 must have one STAIRS, no EXIT');
    const stairTile = f.tiles[f.stairs.y * W + f.stairs.x];
    check(stairTile === (level === C.FLOORS ? T.EXIT : T.STAIRS), tag + ': stairs tile type');

    // Start
    check(f.tiles[f.start.y * W + f.start.x] === T.FLOOR, tag + ': start not FLOOR');
    const r0 = f.rooms[0];
    check(r0 && f.start.x >= r0.x && f.start.x < r0.x + r0.w && f.start.y >= r0.y && f.start.y < r0.y + r0.h,
      tag + ': start not in rooms[0]');

    // Solvability
    const reachNoDoor = bfs(f, f.start.x, f.start.y, false);
    if (f.door) {
      stats.withDoor++;
      check(f.tiles[f.door.y * W + f.door.x] === T.DOOR_LOCKED, tag + ': door tile not DOOR_LOCKED');
      check(f.key !== null, tag + ': door without key');
      check(f.key && reachNoDoor[f.key.y * W + f.key.x] === 1, tag + ': key not reachable without door');
      check(!reachNoDoor[f.stairs.y * W + f.stairs.x], tag + ': stairs reachable while door locked');
      const reachDoorOpen = bfs(f, f.start.x, f.start.y, true);
      check(reachDoorOpen[f.stairs.y * W + f.stairs.x] === 1, tag + ': stairs unreachable after door opens');
      // stairs room must have exactly one walkable entrance (its ring neighbours that are walkable)
      const sr = f.rooms.find(r => f.stairs.x >= r.x && f.stairs.x < r.x + r.w && f.stairs.y >= r.y && f.stairs.y < r.y + r.h);
      check(!!sr, tag + ': stairs not inside a room');
      if (sr) {
        const ring = [];
        for (let x = sr.x; x < sr.x + sr.w; x++) { ring.push([x, sr.y - 1], [x, sr.y + sr.h]); }
        for (let y = sr.y; y < sr.y + sr.h; y++) { ring.push([sr.x - 1, y], [sr.x + sr.w, y]); }
        const openRing = ring.filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H && DE.isWalkable(f.tiles[y * W + x]));
        check(openRing.length === 0, tag + ': stairs room has an unlocked entrance besides the door');
      }
    } else {
      stats.doorNull++;
      levelStats[level].doorNull++;
      check(f.key === null, tag + ': key set without door');
      check(!f.items.some(i => i.type === 'key'), tag + ': key item without door');
      check(reachNoDoor[f.stairs.y * W + f.stairs.x] === 1, tag + ': stairs unreachable (door-less floor)');
    }

    // Entities
    const occupied = new Map();
    const claim = (p, what) => {
      const k = key(p);
      check(!occupied.has(k), tag + ': two entities on ' + k + ' (' + occupied.get(k) + ' & ' + what + ')');
      occupied.set(k, what);
    };
    claim(f.start, 'start');
    claim(f.stairs, 'stairs');
    if (f.door) claim(f.door, 'door');
    if (f.key) check(f.items.some(i => i.type === 'key' && i.x === f.key.x && i.y === f.key.y), tag + ': key item missing');

    for (const e of f.enemies) {
      check(DE.ENEMIES[e.type] && DE.ENEMIES[e.type].minFloor <= level, tag + ': bad enemy type ' + e.type);
      check(f.tiles[e.y * W + e.x] === T.FLOOR, tag + ': enemy not on FLOOR');
      check(manhattan(e, f.start) >= 7, tag + ': enemy too close to start');
      check(reachNoDoor[e.y * W + e.x] === 1 || !f.door, tag + ': enemy behind locked door');
      claim(e, 'enemy');
    }

    const potions = f.items.filter(i => i.type === 'potion').length;
    check(potions === 2 + (level >= 3 ? 1 : 0), tag + ': potion count ' + potions);
    const gold = f.items.filter(i => i.type === 'gold');
    check(gold.length === 5 + level, tag + ': gold piles ' + gold.length);
    for (const g of gold) check(typeof g.amount === 'number' && g.amount >= 3 + level * 2 && g.amount <= 10 + level * 2, tag + ': gold amount');
    for (const it of f.items) {
      check(DE.ITEMS[it.type] !== undefined, tag + ': bad item type ' + it.type);
      check(f.tiles[it.y * W + it.x] === T.FLOOR, tag + ': item not on FLOOR');
      claim(it, 'item ' + it.type);
    }

    const spikes = [];
    for (let i = 0; i < W * H; i++) if (f.tiles[i] === T.SPIKES) spikes.push({ x: i % W, y: (i - (i % W)) / W });
    check(spikes.length === 3 + level, tag + ': spike count ' + spikes.length);
    for (const s of spikes) {
      check(cheb(s, f.start) >= 2, tag + ': spike next to start');
      check(!occupied.has(key(s)), tag + ': spike shares tile with entity at ' + key(s));
    }

    // Determinism
    const g = DE.generateFloor(level, seed);
    check(Buffer.from(g.tiles).equals(Buffer.from(f.tiles)), tag + ': tiles not deterministic');
    check(JSON.stringify([g.start, g.stairs, g.door, g.key, g.enemies, g.items, g.rooms]) ===
      JSON.stringify([f.start, f.stairs, f.door, f.key, f.enemies, f.items, f.rooms]), tag + ': entities not deterministic');
  }
}

// Determinism across calls on fresh generation (different order of calls)
{
  const a = DE.generateFloor(2, 77);
  DE.generateFloor(5, 3);
  const b = DE.generateFloor(2, 77);
  check(DE.floorToAscii(a) === DE.floorToAscii(b), 'floor depends on call order');
}

console.log('Sample: level 3, seed 42 (@ start, k key, + locked door, > stairs, ^ spikes)');
console.log(DE.floorToAscii(sampleFloor));
console.log('');
console.log('Door:null overall: ' + stats.doorNull + '/' + stats.floors + ' (' +
  (100 * stats.doorNull / stats.floors).toFixed(2) + '%)');
for (let l = 1; l <= C.FLOORS; l++) {
  const s = levelStats[l];
  console.log('  level ' + l + ': door:null ' + s.doorNull + '/' + s.floors);
}
console.log('');
if (failures === 0) {
  console.log('PASS: ' + checks + ' checks, 0 failures (' + stats.floors + ' floors)');
} else {
  console.log('FAIL: ' + failures + ' of ' + checks + ' checks failed');
  failMsgs.forEach(m => console.log('  - ' + m));
  process.exitCode = 1;
}
