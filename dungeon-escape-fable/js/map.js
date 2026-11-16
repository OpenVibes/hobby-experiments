window.DE = window.DE || {};

(function () {
  var MAX_BUILD_TRIES = 200;
  var SPAWN_MIN_DIST_SQ = 36;   // spawns at least 6 tiles (Euclidean) from start
  var DIR_X = [1, 0, -1, 0];
  var DIR_Y = [0, 1, 0, -1];

  function rnd(n) { return Math.floor(Math.random() * n); }
  function between(a, b) { return a + rnd(b - a + 1); }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = rnd(i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function makeGrid(w, h, value) {
    var g = [];
    for (var y = 0; y < h; y++) {
      var row = new Array(w);
      for (var x = 0; x < w; x++) row[x] = value;
      g.push(row);
    }
    return g;
  }

  function carveHLine(tiles, x1, x2, y) {
    var a = Math.min(x1, x2), b = Math.max(x1, x2);
    for (var x = a; x <= b; x++) tiles[y][x] = DE.TILE.FLOOR;
  }

  function carveVLine(tiles, x, y1, y2) {
    var a = Math.min(y1, y2), b = Math.max(y1, y2);
    for (var y = a; y <= b; y++) tiles[y][x] = DE.TILE.FLOOR;
  }

  // Walking distance from (sx, sy) over FLOOR and SPIKES tiles.
  // DOOR and WALL block. Returns Int32Array indexed y*w+x, -1 = unreachable.
  function walkDistances(tiles, w, h, sx, sy) {
    var T = DE.TILE;
    var dist = new Int32Array(w * h);
    for (var i = 0; i < dist.length; i++) dist[i] = -1;
    var queue = new Int32Array(w * h);
    var head = 0, tail = 0;
    var s = sy * w + sx;
    dist[s] = 0;
    queue[tail++] = s;
    while (head < tail) {
      var cur = queue[head++];
      var cx = cur % w;
      var cy = (cur - cx) / w;
      for (var k = 0; k < 4; k++) {
        var nx = cx + DIR_X[k];
        var ny = cy + DIR_Y[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var n = ny * w + nx;
        if (dist[n] !== -1) continue;
        var v = tiles[ny][nx];
        if (v !== T.FLOOR && v !== T.SPIKES) continue;
        dist[n] = dist[cur] + 1;
        queue[tail++] = n;
      }
    }
    return dist;
  }

  // Every FLOOR and SPIKES tile must be reachable from (sx, sy).
  function allWalkableReached(tiles, w, h, sx, sy) {
    var T = DE.TILE;
    var dist = walkDistances(tiles, w, h, sx, sy);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = tiles[y][x];
        if ((v === T.FLOOR || v === T.SPIKES) && dist[y * w + x] < 0) return false;
      }
    }
    return true;
  }

  function hasWallNeighbour(tiles, w, h, x, y) {
    for (var k = 0; k < 4; k++) {
      var nx = x + DIR_X[k], ny = y + DIR_Y[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (tiles[ny][nx] === DE.TILE.WALL) return true;
    }
    return false;
  }

  // Place non-overlapping rooms (1 wall tile between them) and chain them with L corridors.
  function carveRooms(floor, W, H) {
    var T = DE.TILE;
    var tiles = makeGrid(W, H, T.WALL);
    var rooms = [];
    var target = 7 + 2 * floor;
    for (var a = 0; a < 500 && rooms.length < target; a++) {
      var w = between(4, 9);
      var h = between(3, 7);
      var x = between(1, W - 1 - w);
      var y = between(1, H - 1 - h);
      var clear = true;
      for (var r = 0; r < rooms.length && clear; r++) {
        var o = rooms[r];
        clear = (x + w + 1 <= o.x) || (o.x + o.w + 1 <= x) ||
                (y + h + 1 <= o.y) || (o.y + o.h + 1 <= y);
      }
      if (!clear) continue;
      rooms.push({
        x: x, y: y, w: w, h: h,
        cx: x + ((w - 1) >> 1), cy: y + ((h - 1) >> 1)
      });
      for (var yy = y; yy < y + h; yy++) {
        for (var xx = x; xx < x + w; xx++) tiles[yy][xx] = T.FLOOR;
      }
    }
    if (rooms.length < 3) return null;

    for (var i = 1; i < rooms.length; i++) {
      var A = rooms[i - 1], B = rooms[i];
      if (Math.random() < 0.5) {
        carveHLine(tiles, A.cx, B.cx, A.cy);
        carveVLine(tiles, B.cx, A.cy, B.cy);
      } else {
        carveVLine(tiles, A.cx, A.cy, B.cy);
        carveHLine(tiles, A.cx, B.cx, B.cy);
      }
    }
    return { tiles: tiles, rooms: rooms };
  }

  // Fixed single-room layout, used only if random generation keeps failing.
  function fallbackLayout(W, H) {
    var T = DE.TILE;
    var tiles = makeGrid(W, H, T.WALL);
    var room = { x: 2, y: 2, w: W - 4, h: H - 4 };
    room.cx = room.x + ((room.w - 1) >> 1);
    room.cy = room.y + ((room.h - 1) >> 1);
    for (var y = room.y; y < room.y + room.h; y++) {
      for (var x = room.x; x < room.x + room.w; x++) tiles[y][x] = T.FLOOR;
    }
    return { tiles: tiles, rooms: [room] };
  }

  function enemyType(floor) {
    var pSkeleton = floor >= 2 ? Math.min(0.2 + 0.15 * (floor - 1), 0.8) : 0;
    if (Math.random() < pSkeleton) return 'skeleton';
    return Math.random() < 0.5 ? 'slime' : 'bat';
  }

  // Choose door, key, items, spawns and spikes on top of a carved layout.
  // Returns a Level, or null if the layout cannot hold the required content.
  function buildLevel(floor, W, H, tiles, rooms) {
    var T = DE.TILE;
    var start = { x: rooms[0].cx, y: rooms[0].cy };

    // Farthest room by walking distance from start (never the start room when there are several).
    var dist0 = walkDistances(tiles, W, H, start.x, start.y);
    var farIndex = 0, farDist = -1;
    for (var r = rooms.length > 1 ? 1 : 0; r < rooms.length; r++) {
      var room = rooms[r];
      var md = -1;
      for (var y = room.y; y < room.y + room.h; y++) {
        for (var x = room.x; x < room.x + room.w; x++) {
          var d = dist0[y * W + x];
          if (d > md) md = d;
        }
      }
      if (md > farDist) { farDist = md; farIndex = r; }
    }
    var doorRoom = rooms[farIndex];
    var inDoorRoom = function (x, y) {
      return x >= doorRoom.x && x < doorRoom.x + doorRoom.w &&
             y >= doorRoom.y && y < doorRoom.y + doorRoom.h;
    };

    // Door: a floor tile of the far room, edge tiles first. Keep it only if nothing is cut off.
    var edge = [], inner = [];
    for (var ry = doorRoom.y; ry < doorRoom.y + doorRoom.h; ry++) {
      for (var rx = doorRoom.x; rx < doorRoom.x + doorRoom.w; rx++) {
        if (tiles[ry][rx] !== T.FLOOR) continue;
        if (rx === start.x && ry === start.y) continue;
        if (dist0[ry * W + rx] <= 0) continue;
        var p = { x: rx, y: ry };
        if (hasWallNeighbour(tiles, W, H, rx, ry)) edge.push(p); else inner.push(p);
      }
    }
    shuffle(edge);
    shuffle(inner);
    var cands = edge.concat(inner);
    var door = null;
    for (var c = 0; c < cands.length && !door; c++) {
      var cp = cands[c];
      tiles[cp.y][cp.x] = T.DOOR;
      if (allWalkableReached(tiles, W, H, start.x, start.y)) door = cp;
      else tiles[cp.y][cp.x] = T.FLOOR;
    }
    if (!door) return null;

    // Distances with the door in place (the door blocks).
    var dist = walkDistances(tiles, W, H, start.x, start.y);
    var maxD = 0;
    var eligible = [];
    for (var ey = 0; ey < H; ey++) {
      for (var ex = 0; ex < W; ex++) {
        if (tiles[ey][ex] !== T.FLOOR) continue;
        var ed = dist[ey * W + ex];
        if (ed <= 0) continue;
        eligible.push({ x: ex, y: ey, d: ed });
        if (ed > maxD) maxD = ed;
      }
    }
    if (eligible.length === 0) return null;

    // Key: far from start, preferably outside the door's room.
    var farEnough = eligible.filter(function (p) { return p.d >= 0.6 * maxD; });
    var keyPool = farEnough.filter(function (p) { return !inDoorRoom(p.x, p.y); });
    if (keyPool.length === 0) keyPool = farEnough;
    if (keyPool.length === 0) keyPool = eligible;
    var keyTile = keyPool[rnd(keyPool.length)];

    var occ = new Uint8Array(W * H);
    occ[start.y * W + start.x] = 1;
    occ[keyTile.y * W + keyTile.x] = 1;

    // Shuffled pool of remaining floor tiles for everything else.
    var pool = eligible.slice();
    shuffle(pool);
    var take = function (pred) {
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        var k = p.y * W + p.x;
        if (occ[k]) continue;
        if (pred && !pred(p.x, p.y)) continue;
        occ[k] = 1;
        return p;
      }
      return null;
    };

    var floorCfg = floor;
    var items = [{ type: 'key', x: keyTile.x, y: keyTile.y, taken: false }];
    var i, p;
    for (i = 0; i < 2; i++) {
      p = take(null);
      if (!p) return null;
      items.push({ type: 'potion', x: p.x, y: p.y, taken: false });
    }
    for (i = 0; i < 6 + 2 * floorCfg; i++) {
      p = take(null);
      if (!p) return null;
      items.push({ type: 'coin', x: p.x, y: p.y, taken: false });
    }

    var spawns = [];
    var farFromStart = function (x, y) {
      var dx = x - start.x, dy = y - start.y;
      return dx * dx + dy * dy >= SPAWN_MIN_DIST_SQ;
    };
    for (i = 0; i < 3 + 2 * floorCfg; i++) {
      p = take(farFromStart);
      if (!p) return null;
      spawns.push({ type: enemyType(floorCfg), x: p.x, y: p.y });
    }

    // Spikes: on floor tiles, never adjacent (including diagonally) to the door.
    var spikeCount = 2 + 2 * floorCfg;
    var notNearDoor = function (x, y) {
      return Math.max(Math.abs(x - door.x), Math.abs(y - door.y)) >= 2;
    };
    for (i = 0; i < spikeCount; i++) {
      p = take(notNearDoor);
      if (!p) return null;
      tiles[p.y][p.x] = T.SPIKES;
    }

    return {
      floor: floorCfg,
      width: W,
      height: H,
      tiles: tiles,
      seen: makeGrid(W, H, false),
      start: start,
      exit: { x: door.x, y: door.y },
      items: items,
      enemySpawns: spawns
    };
  }

  // Full check of every guarantee in the plan. Used to gate generation.
  function validateLevel(level) {
    var T = DE.TILE;
    var W = level.width, H = level.height, tiles = level.tiles, f = level.floor;
    if (tiles.length !== H) return false;
    var y, x;
    for (y = 0; y < H; y++) if (tiles[y].length !== W) return false;

    for (x = 0; x < W; x++) {
      if (tiles[0][x] !== T.WALL || tiles[H - 1][x] !== T.WALL) return false;
    }
    for (y = 0; y < H; y++) {
      if (tiles[y][0] !== T.WALL || tiles[y][W - 1] !== T.WALL) return false;
    }

    var doors = 0;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) if (tiles[y][x] === T.DOOR) doors++;
    }
    if (doors !== 1) return false;

    var ex = level.exit, st = level.start;
    if (!ex || tiles[ex.y][ex.x] !== T.DOOR) return false;
    if (!st || tiles[st.y][st.x] !== T.FLOOR) return false;

    var dist = walkDistances(tiles, W, H, st.x, st.y);
    if (!allWalkableReached(tiles, W, H, st.x, st.y)) return false;
    var doorReached = false;
    for (var k = 0; k < 4; k++) {
      var nx = ex.x + DIR_X[k], ny = ex.y + DIR_Y[k];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && dist[ny * W + nx] >= 0) doorReached = true;
    }
    if (!doorReached) return false;

    var occ = new Uint8Array(W * H);
    occ[st.y * W + st.x] = 1;

    var keys = 0, potions = 0, coins = 0;
    var items = level.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.taken) return false;
      if (it.x < 0 || it.y < 0 || it.x >= W || it.y >= H) return false;
      if (tiles[it.y][it.x] !== T.FLOOR) return false;
      var idx = it.y * W + it.x;
      if (occ[idx] || dist[idx] < 0) return false;
      occ[idx] = 1;
      if (it.type === 'key') keys++;
      else if (it.type === 'potion') potions++;
      else if (it.type === 'coin') coins++;
      else return false;
    }
    if (keys !== 1 || potions !== 2 || coins !== 6 + 2 * f) return false;

    var spawns = level.enemySpawns || [];
    if (spawns.length !== 3 + 2 * f) return false;
    for (i = 0; i < spawns.length; i++) {
      var s = spawns[i];
      if (!DE.CONFIG.ENEMY_TYPES[s.type]) return false;
      if (s.type === 'skeleton' && f < 2) return false;
      if (s.x < 0 || s.y < 0 || s.x >= W || s.y >= H) return false;
      if (tiles[s.y][s.x] !== T.FLOOR) return false;
      var sidx = s.y * W + s.x;
      if (occ[sidx] || dist[sidx] < 0) return false;
      occ[sidx] = 1;
      var dx = s.x - st.x, dy = s.y - st.y;
      if (dx * dx + dy * dy < SPAWN_MIN_DIST_SQ) return false;
    }

    var spikes = 0;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (tiles[y][x] !== T.SPIKES) continue;
        spikes++;
        if (Math.max(Math.abs(x - ex.x), Math.abs(y - ex.y)) < 2) return false;
      }
    }
    if (spikes !== 2 + 2 * f) return false;
    return true;
  }

  DE.generateLevel = function (floor) {
    floor = Math.max(1, Math.min(DE.CONFIG.FLOORS, Math.floor(floor) || 1));
    var W = 31 + 4 * floor;
    var H = 23 + 2 * floor;

    for (var t = 0; t < MAX_BUILD_TRIES; t++) {
      var layout = carveRooms(floor, W, H);
      if (!layout) continue;
      var level = buildLevel(floor, W, H, layout.tiles, layout.rooms);
      if (level && validateLevel(level)) return level;
    }

    // Cap reached: fall back to a single open room, retried in case of an unlucky roll.
    for (var attempt = 0; attempt < 20; attempt++) {
      var fb = fallbackLayout(W, H);
      var fbLevel = buildLevel(floor, W, H, fb.tiles, fb.rooms);
      if (fbLevel) return fbLevel;
    }
    return null;
  };

  DE.isWalkable = function (level, x, y) {
    if (!level || !level.tiles) return false;
    if (x < 0 || y < 0 || x >= level.width || y >= level.height) return false;
    var row = level.tiles[y];
    if (!row) return false;
    var v = row[x];
    return v === DE.TILE.FLOOR || v === DE.TILE.SPIKES;
  };
})();
