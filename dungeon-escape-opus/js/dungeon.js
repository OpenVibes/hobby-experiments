window.DE = window.DE || {};
(function (DE) {
  'use strict';

  var C = DE.CONFIG;
  var T = DE.T;
  var MAX_ATTEMPTS = 60;
  var LOOSE_ATTEMPTS = 200;   // extra attempts for the door-less fallback (should never be needed)

  function mixSeed(seed, level, attempt) {
    var h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 15), 0x85EBCA77) ^ Math.imul(level + 1, 0xC2B2AE3D);
    h = Math.imul(h ^ (h >>> 13), 0x27D4EB2F) ^ Math.imul(attempt + 1, 0x165667B1);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function center(r) {
    return { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
  }

  function hline(tiles, W, y, x1, x2) {
    var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    for (var x = lo; x <= hi; x++) tiles[y * W + x] = T.FLOOR;
  }

  function vline(tiles, W, x, y1, y2) {
    var lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    for (var y = lo; y <= hi; y++) tiles[y * W + x] = T.FLOOR;
  }

  function carveCorridor(tiles, W, a, b, rng) {
    if (rng.chance(0.5)) {
      hline(tiles, W, a.y, a.x, b.x);
      vline(tiles, W, b.x, a.y, b.y);
    } else {
      vline(tiles, W, a.x, a.y, b.y);
      hline(tiles, W, b.y, a.x, b.x);
    }
  }

  function placeRooms(rng, tiles, W, H) {
    var rooms = [];
    var target = rng.int(8, 12);
    for (var t = 0; t < 3000 && rooms.length < target; t++) {
      var w = rng.int(4, 10), h = rng.int(4, 8);
      var x = rng.int(1, W - 1 - w), y = rng.int(1, H - 1 - h);
      var ok = true;
      for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i];
        // at least one wall tile between any two rooms (including diagonal neighbours)
        var sepX = x >= r.x + r.w + 1 || r.x >= x + w + 1;
        var sepY = y >= r.y + r.h + 1 || r.y >= y + h + 1;
        if (!(sepX || sepY)) { ok = false; break; }
      }
      if (!ok) continue;
      rooms.push({ x: x, y: y, w: w, h: h });
      for (var yy = y; yy < y + h; yy++) {
        for (var xx = x; xx < x + w; xx++) tiles[yy * W + xx] = T.FLOOR;
      }
    }
    return rooms;
  }

  // Breadth-first walk from (sx, sy) over walkable tiles. openDoor also lets the player through
  // DOOR_LOCKED tiles (used to check the stairs are reachable once the door is opened).
  function flood(tiles, W, H, sx, sy, openDoor) {
    var vis = new Uint8Array(W * H);
    var q = new Int32Array(W * H);
    var head = 0, tail = 0;
    var s = sy * W + sx;
    vis[s] = 1;
    q[tail++] = s;
    while (head < tail) {
      var i = q[head++];
      var x = i % W, y = (i - x) / W;
      for (var d = 0; d < 4; d++) {
        var nx = x + (d === 2 ? -1 : d === 3 ? 1 : 0);
        var ny = y + (d === 0 ? -1 : d === 1 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var j = ny * W + nx;
        if (vis[j]) continue;
        var t = tiles[j];
        if (DE.isWalkable(t) || (openDoor && t === T.DOOR_LOCKED)) {
          vis[j] = 1;
          q[tail++] = j;
        }
      }
    }
    return vis;
  }

  // Shortest walking distance from (sx, sy) over walkable tiles, -1 when unreachable.
  function distances(tiles, W, H, sx, sy) {
    var dist = new Int32Array(W * H).fill(-1);
    var q = new Int32Array(W * H);
    var head = 0, tail = 0;
    var s = sy * W + sx;
    dist[s] = 0;
    q[tail++] = s;
    while (head < tail) {
      var i = q[head++];
      var x = i % W, y = (i - x) / W;
      for (var d = 0; d < 4; d++) {
        var nx = x + (d === 2 ? -1 : d === 3 ? 1 : 0);
        var ny = y + (d === 0 ? -1 : d === 1 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var j = ny * W + nx;
        if (dist[j] >= 0 || !DE.isWalkable(tiles[j])) continue;
        dist[j] = dist[i] + 1;
        q[tail++] = j;
      }
    }
    return dist;
  }

  // Floor tiles directly outside the room's interior rectangle (no corners).
  function ringEntrances(tiles, W, H, r) {
    var out = [];
    function check(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      if (tiles[y * W + x] === T.FLOOR) out.push({ x: x, y: y });
    }
    var x0 = r.x - 1, x1 = r.x + r.w, y0 = r.y - 1, y1 = r.y + r.h;
    for (var x = r.x; x < r.x + r.w; x++) { check(x, y0); check(x, y1); }
    for (var y = r.y; y < r.y + r.h; y++) { check(x0, y); check(x1, y); }
    return out;
  }

  function pickEnemyType(rng, level) {
    var keys = Object.keys(DE.ENEMIES).filter(function (k) {
      return DE.ENEMIES[k].minFloor <= level;
    });
    var total = 0;
    keys.forEach(function (k) { total += DE.ENEMIES[k].weight; });
    var roll = rng.next() * total;
    for (var i = 0; i < keys.length; i++) {
      roll -= DE.ENEMIES[keys[i]].weight;
      if (roll < 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  // One generation attempt. Returns a floor, or null if this layout does not satisfy the rules.
  // lock=false builds the door-less fallback (no door, no key).
  function tryGenerate(level, rng, lock) {
    var W = C.MAP_W, H = C.MAP_H;
    var tiles = new Uint8Array(W * H);   // all WALL

    var rooms = placeRooms(rng, tiles, W, H);
    if (rooms.length < 6) return null;
    rooms.sort(function (a, b) {
      var ca = center(a), cb = center(b);
      return ca.x - cb.x || ca.y - cb.y;
    });

    for (var i = 0; i + 1 < rooms.length; i++) {
      carveCorridor(tiles, W, center(rooms[i]), center(rooms[i + 1]), rng);
    }
    var extra = rng.int(1, 2);
    for (var k = 0; k < extra; k++) {
      var a = rng.int(0, rooms.length - 1);
      var b = rng.int(0, rooms.length - 1);
      if (a !== b) carveCorridor(tiles, W, center(rooms[a]), center(rooms[b]), rng);
    }

    var start = center(rooms[0]);
    var dist = distances(tiles, W, H, start.x, start.y);

    // Stairs room: the room whose centre is farthest from start.
    var stairsIdx = -1, best = -1;
    for (var r = 1; r < rooms.length; r++) {
      var c = center(rooms[r]);
      var d = dist[c.y * W + c.x];
      if (d > best) { best = d; stairsIdx = r; }
    }
    if (stairsIdx < 0) return null;
    var sRoom = rooms[stairsIdx];
    var stairs = center(sRoom);
    var stairsI = stairs.y * W + stairs.x;
    tiles[stairsI] = level === C.FLOORS ? T.EXIT : T.STAIRS;

    var door = null;
    if (lock) {
      var entrances = ringEntrances(tiles, W, H, sRoom);
      if (entrances.length === 0) return null;
      if (entrances.length > 1) return null;   // not exactly one entrance: retry with a new seed
      door = entrances[0];
      tiles[door.y * W + door.x] = T.DOOR_LOCKED;
    }

    // Stairs must be unreachable while locked (or reachable, when there is no door).
    var reach = flood(tiles, W, H, start.x, start.y, false);
    if (lock) {
      if (reach[stairsI]) return null;
      if (!flood(tiles, W, H, start.x, start.y, true)[stairsI]) return null;
    } else if (!reach[stairsI]) {
      return null;
    }

    var key = null;
    if (lock) {
      var cands = [];
      for (var ri = 0; ri < rooms.length; ri++) {
        if (ri === 0 || ri === stairsIdx) continue;
        var rm = rooms[ri];
        for (var yy = rm.y; yy < rm.y + rm.h; yy++) {
          for (var xx = rm.x; xx < rm.x + rm.w; xx++) {
            var ti = yy * W + xx;
            if (tiles[ti] === T.FLOOR && reach[ti]) cands.push(ti);
          }
        }
      }
      if (cands.length === 0) return null;
      var ki = rng.pick(cands);
      key = { x: ki % W, y: (ki - (ki % W)) / W };
    }

    // Entities go on reachable floor tiles (door locked) that are not reserved.
    var occ = new Uint8Array(W * H);
    occ[start.y * W + start.x] = 1;
    occ[stairsI] = 1;
    if (door) occ[door.y * W + door.x] = 1;
    if (key) occ[key.y * W + key.x] = 1;

    var free = [];
    for (var fi = 0; fi < W * H; fi++) {
      if (tiles[fi] === T.FLOOR && reach[fi] && !occ[fi]) free.push(fi);
    }
    rng.shuffle(free);

    function takeTile(ok) {
      for (var n = 0; n < free.length; n++) {
        var ti = free[n];
        if (occ[ti]) continue;
        if (ok && !ok(ti)) continue;
        occ[ti] = 1;
        return { x: ti % W, y: (ti - (ti % W)) / W };
      }
      return null;
    }

    var enemies = [];
    var enemyCount = 4 + level * 2;
    for (var en = 0; en < enemyCount; en++) {
      var p = takeTile(function (ti) {
        var x = ti % W, y = (ti - x) / W;
        return Math.abs(x - start.x) + Math.abs(y - start.y) >= 7;
      });
      if (!p) break;
      enemies.push({ type: pickEnemyType(rng, level), x: p.x, y: p.y });
    }

    var items = [];
    function addItem(type, extra) {
      var p2 = takeTile(null);
      if (!p2) return;
      var item = { type: type, x: p2.x, y: p2.y };
      if (extra) for (var kk in extra) item[kk] = extra[kk];
      items.push(item);
    }
    var potions = 2 + (level >= 3 ? 1 : 0);
    for (var pi = 0; pi < potions; pi++) addItem('potion');
    for (var gi = 0; gi < 5 + level; gi++) addItem('gold', { amount: rng.int(3, 10) + level * 2 });
    if (rng.chance(0.5)) addItem('sword');
    if (rng.chance(0.5)) addItem('shield');
    if (rng.chance(0.4)) addItem('torch');
    if (key) items.push({ type: 'key', x: key.x, y: key.y });

    var spikeCount = 3 + level;
    for (var si = 0; si < spikeCount; si++) {
      var sp = takeTile(function (ti) {
        var x = ti % W, y = (ti - x) / W;
        return Math.max(Math.abs(x - start.x), Math.abs(y - start.y)) >= 2;
      });
      if (!sp) break;
      tiles[sp.y * W + sp.x] = T.SPIKES;
    }

    return {
      level: level,
      width: W,
      height: H,
      tiles: tiles,
      rooms: rooms.map(function (rr) { return { x: rr.x, y: rr.y, w: rr.w, h: rr.h }; }),
      start: start,
      stairs: stairs,
      door: door,
      key: key,
      enemies: enemies,
      items: items,
    };
  }

  DE.generateFloor = function (level, seed) {
    level = Math.max(1, Math.min(C.FLOORS, level | 0));
    seed = seed | 0;
    var attempt;
    for (attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      var floor = tryGenerate(level, DE.makeRng(mixSeed(seed, level, attempt)), true);
      if (floor) return floor;
    }
    // Fallback: a floor with no lock. Stairs are still reachable, door and key are null.
    for (attempt = MAX_ATTEMPTS; attempt < MAX_ATTEMPTS + LOOSE_ATTEMPTS; attempt++) {
      var loose = tryGenerate(level, DE.makeRng(mixSeed(seed, level, attempt)), false);
      if (loose) return loose;
    }
    throw new Error('dungeon: could not generate floor ' + level + ' for seed ' + seed);
  };

  DE.floorToAscii = function (floor) {
    var rows = [];
    for (var y = 0; y < floor.height; y++) {
      var row = '';
      for (var x = 0; x < floor.width; x++) {
        var t = floor.tiles[y * floor.width + x];
        var ch;
        if (floor.start.x === x && floor.start.y === y) ch = '@';
        else if (floor.key && floor.key.x === x && floor.key.y === y) ch = 'k';
        else if (t === T.WALL) ch = '#';
        else if (t === T.FLOOR) ch = '.';
        else if (t === T.DOOR_LOCKED) ch = '+';
        else if (t === T.DOOR_OPEN) ch = "'";
        else if (t === T.STAIRS) ch = '>';
        else if (t === T.EXIT) ch = 'E';
        else if (t === T.SPIKES) ch = '^';
        else ch = '?';
        row += ch;
      }
      rows.push(row);
    }
    return rows.join('\n');
  };
})(window.DE);
