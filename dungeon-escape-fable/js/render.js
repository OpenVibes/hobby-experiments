window.DE = window.DE || {};

(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // One small palette, reused everywhere.
  var C = {
    black: '#05060a',
    fogWarm: '#120a04',
    wall: '#2b3244',
    wallLight: '#353e55',
    wallDark: '#1d2232',
    wallMortar: '#141827',
    wallTop: '#56637f',
    wallTopHi: '#7a88a6',
    wallBottom: '#0d1017',
    floorA: '#23272f',
    floorB: '#282d36',
    floorEdge: '#171a21',
    floorSpeck: '#3a404d',
    crack: '#15181f',
    woodA: '#7a4a2a',
    woodB: '#663d22',
    woodDark: '#3f2514',
    iron: '#8f98a6',
    ironDark: '#4d5563',
    gold: '#f2c14e',
    goldHi: '#fff3c4',
    goldDark: '#b07d24',
    steel: '#d4dbe6',
    steelDark: '#6e7989',
    spikeTip: '#e0474c',
    holeDark: '#0c0e13',
    potion: '#e03c4f',
    potionDark: '#8c1e2d',
    potionHi: '#ff9aa6',
    glass: '#c9d3e0',
    cork: '#8a5a35',
    slime: '#5cc466',
    slimeHi: '#a4ea86',
    slimeDark: '#2a7a3c',
    bat: '#8c5fd8',
    batDark: '#4a2c88',
    batEye: '#ff5a6a',
    bone: '#f2eddb',
    boneMid: '#d6cdb0',
    boneDark: '#8d8566',
    hero: '#3f82d6',
    heroDark: '#24508f',
    cloak: '#a8402c',
    cloakDark: '#6a2418',
    skin: '#f0c7a0',
    hair: '#3b2418',
    outline: '#0b0d12',
    hurt: '#ff3b3b',
    hurtEmpty: '#3a1d22',
    torch: '#ffb35c',
    white: '#ffffff'
  };

  // ---------------------------------------------------------------------
  // Config and helpers (config is read inside functions only)
  // ---------------------------------------------------------------------

  function readConfig() {
    var c = DE.CONFIG || {};
    return {
      T: num(c.TILE_SIZE, 32),
      COLS: num(c.VIEW_COLS, 25),
      ROWS: num(c.VIEW_ROWS, 18),
      R: num(c.SIGHT_RADIUS, 6)
    };
  }

  function readTiles() {
    var t = DE.TILE || {};
    return {
      WALL: num(t.WALL, 0),
      FLOOR: num(t.FLOOR, 1),
      DOOR: num(t.DOOR, 2),
      SPIKES: num(t.SPIKES, 3)
    };
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function clampCam(v, max) {
    return clamp(v, 0, Math.max(0, max));
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  // Stable pseudo-random value in [0, 1) from tile coordinates and a salt.
  function hash(x, y, salt) {
    var h = Math.imul((x | 0) + 0x9e37, 374761393) ^
            Math.imul((y | 0) + 0x7f4a, 668265263) ^
            Math.imul((salt | 0) + 1, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Per-enemy animation phase, assigned once in order of first sight
  // (deterministic, no Math.random).
  var phaseSeq = 0;
  var phaseMap = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function phaseOf(obj) {
    if (!phaseMap || !obj || typeof obj !== 'object') return 0;
    var p = phaseMap.get(obj);
    if (p === undefined) {
      phaseSeq++;
      p = ((phaseSeq * 0.6180339887) % 1) * TAU;
      phaseMap.set(obj, p);
    }
    return p;
  }

  function pick(flash, color) {
    return flash ? C.white : color;
  }

  function rect(ctx, color, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function circle(ctx, color, x, y, r) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
    ctx.fill();
  }

  function ellipse(ctx, color, x, y, rx, ry) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
    ctx.fill();
  }

  function tri(ctx, color, x1, y1, x2, y2, x3, y3) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  function line(ctx, color, width, x1, y1, x2, y2) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function outlineEllipse(ctx, color, width, x, y, rx, ry) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
    ctx.stroke();
  }

  // Soft ground shadow. Resets globalAlpha to 1 afterwards.
  function shadow(ctx, x, y, rx, ry, alpha) {
    ctx.globalAlpha = alpha;
    ellipse(ctx, C.black, x, y, rx, ry);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  // Environment: camera, tile access, visibility
  // ---------------------------------------------------------------------

  // Whole-pixel tile box. Rounding both edges means neighbours share edges.
  function tileBox(env, x, y) {
    var x0 = Math.round((x - env.camX) * env.T);
    var y0 = Math.round((y - env.camY) * env.T);
    var x1 = Math.round((x + 1 - env.camX) * env.T);
    var y1 = Math.round((y + 1 - env.camY) * env.T);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Centre of a tile (or a tween position in tile units), in whole pixels.
  function tileCenter(env, x, y) {
    return {
      x: Math.round((x - env.camX + 0.5) * env.T),
      y: Math.round((y - env.camY + 0.5) * env.T)
    };
  }

  // Out-of-bounds counts as WALL so edges of the map look enclosed.
  function tileAt(env, x, y) {
    var row = env.tiles[y];
    if (!row) return env.ids.WALL;
    var v = row[x];
    return v === undefined ? env.ids.WALL : v;
  }

  function isSeen(env, x, y) {
    var row = env.seen && env.seen[y];
    return !!(row && row[x]);
  }

  function inSight(env, x, y) {
    var dx = x - env.px, dy = y - env.py;
    return Math.sqrt(dx * dx + dy * dy) <= env.R;
  }

  function visibleThing(env, x, y) {
    return isSeen(env, x, y) && inSight(env, x, y);
  }

  // ---------------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------------

  function drawWall(env, x, y, b) {
    var ctx = env.ctx;
    var ids = env.ids;
    var tones = [C.wallDark, C.wall, C.wall, C.wallLight];

    // Mortar shows through the gaps between bricks.
    rect(ctx, C.wallMortar, b.x, b.y, b.w, b.h);

    // Two courses of bricks, staggered.
    for (var r = 0; r < 2; r++) {
      var top = Math.round(b.y + r * b.h / 2);
      var bot = Math.round(b.y + (r + 1) * b.h / 2);
      var cuts = r === 0 ? [0, 0.5, 1] : [0, 0.25, 0.75, 1];
      for (var i = 0; i + 1 < cuts.length; i++) {
        var l = Math.round(b.x + cuts[i] * b.w);
        var rr = Math.round(b.x + cuts[i + 1] * b.w);
        var tone = tones[Math.floor(hash(x, y, 40 + r * 8 + i) * tones.length)];
        rect(ctx, tone, l + 1, top + 1, rr - l - 2, bot - top - 1);
      }
    }

    // Lighter top edge where the wall meets open floor above it.
    if (tileAt(env, x, y - 1) !== ids.WALL) {
      rect(ctx, C.wallTopHi, b.x, b.y, b.w, 2);
      rect(ctx, C.wallTop, b.x, b.y + 2, b.w, 2);
    }
    // Dark base where the wall meets floor below it.
    if (tileAt(env, x, y + 1) !== ids.WALL) {
      rect(ctx, C.wallBottom, b.x, b.y + b.h - 2, b.w, 2);
    }

    // Occasional crack.
    if (hash(x, y, 50) < 0.12) {
      var cx0 = b.x + Math.round(b.w * (0.25 + 0.3 * hash(x, y, 51)));
      var cy0 = b.y + Math.round(b.h * 0.3);
      rect(ctx, C.wallMortar, cx0, cy0, 2, 2);
      rect(ctx, C.wallMortar, cx0 + 2, cy0 + 2, 2, 2);
      rect(ctx, C.wallMortar, cx0 + 3, cy0 + 4, 2, 2);
    }
  }

  function drawFloor(env, x, y, b) {
    var ctx = env.ctx;
    rect(ctx, hash(x, y, 2) < 0.5 ? C.floorA : C.floorB, b.x, b.y, b.w, b.h);

    // Flagstone seams on the right and bottom edges.
    rect(ctx, C.floorEdge, b.x + b.w - 1, b.y, 1, b.h);
    rect(ctx, C.floorEdge, b.x, b.y + b.h - 1, b.w, 1);

    // Specks of grit.
    var sx = b.x + 2 + Math.floor(hash(x, y, 3) * Math.max(1, b.w - 6));
    var sy = b.y + 2 + Math.floor(hash(x, y, 4) * Math.max(1, b.h - 6));
    rect(ctx, C.floorSpeck, sx, sy, 2, 2);

    // Hairline crack.
    if (hash(x, y, 5) < 0.12) {
      var kx = b.x + 4 + Math.floor(hash(x, y, 6) * Math.max(1, b.w - 12));
      var ky = b.y + 3;
      rect(ctx, C.crack, kx, ky, 2, 2);
      rect(ctx, C.crack, kx + 2, ky + 2, 2, 2);
      rect(ctx, C.crack, kx + 1, ky + 4, 2, 2);
    }

    // Shadow cast by the wall above.
    if (tileAt(env, x, y - 1) === env.ids.WALL) {
      ctx.globalAlpha = 0.35;
      rect(ctx, C.black, b.x, b.y, b.w, 5);
      ctx.globalAlpha = 0.14;
      rect(ctx, C.black, b.x, b.y + 5, b.w, 4);
      ctx.globalAlpha = 1;
    }
  }

  function drawDoor(env, x, y, b) {
    var ctx = env.ctx;
    var fw = b.w - 6, fh = b.h - 3;
    var fx = b.x + 3, fy = b.y + 3;

    // Stone surround.
    rect(ctx, C.wallLight, b.x, b.y, b.w, b.h);
    rect(ctx, C.wallDark, b.x, b.y + b.h - 2, b.w, 2);

    // Wooden planks.
    var n = 4;
    var pw = fw / n;
    for (var i = 0; i < n; i++) {
      var px0 = Math.round(fx + i * pw);
      var px1 = Math.round(fx + (i + 1) * pw);
      rect(ctx, i % 2 ? C.woodB : C.woodA, px0, fy, px1 - px0, fh);
      rect(ctx, C.woodDark, px0, fy, 1, fh);
    }

    // Iron bands.
    rect(ctx, C.iron, fx, Math.round(fy + fh * 0.2), fw, 2);
    rect(ctx, C.iron, fx, Math.round(fy + fh * 0.75), fw, 2);

    // Lock plate in the centre.
    var cx = Math.round(b.x + b.w / 2);
    var cy = Math.round(b.y + b.h * 0.5);
    if (env.hasKey) {
      circle(ctx, C.goldDark, cx, cy, 4.5);
      circle(ctx, C.gold, cx, cy, 3.5);
    } else {
      circle(ctx, C.ironDark, cx, cy, 4.5);
      circle(ctx, C.iron, cx, cy, 3.5);
    }
    circle(ctx, C.holeDark, cx, cy - 0.5, 1.2);
    rect(ctx, C.holeDark, cx - 0.6, cy - 0.5, 1.2, 3);

    // With the key in hand the door pulses gold.
    if (env.hasKey) {
      ctx.globalAlpha = 0.45 + 0.3 * Math.sin(env.t * 4);
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2;
      ctx.strokeRect(fx + 1, fy + 1, fw - 2, fh - 2);
      ctx.globalAlpha = 1;
    }
  }

  function spikeField(ctx, b, alpha) {
    ctx.globalAlpha = alpha;
    for (var j = 0; j < 3; j++) {
      for (var i = 0; i < 3; i++) {
        var cx = b.x + (i + 0.5) * b.w / 3;
        var base = b.y + (j + 0.85) * b.h / 3;
        var hw = b.w / 3 * 0.36;
        var hh = b.h / 3 * 0.85;
        ellipse(ctx, C.holeDark, cx, base, hw + 1, 1.5);
        tri(ctx, C.steelDark, cx, base - hh, cx + hw, base, cx, base);
        tri(ctx, C.steel, cx, base - hh, cx - hw, base, cx, base);
        circle(ctx, C.spikeTip, cx, base - hh, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function spikeHoles(ctx, b) {
    for (var j = 0; j < 3; j++) {
      for (var i = 0; i < 3; i++) {
        var cx = b.x + (i + 0.5) * b.w / 3;
        var cy = b.y + (j + 0.5) * b.h / 3;
        circle(ctx, C.steelDark, cx, cy, 3);
        circle(ctx, C.holeDark, cx, cy, 2);
      }
    }
  }

  function drawSpikes(env, x, y, b, active, frac) {
    var ctx = env.ctx;
    drawFloor(env, x, y, b);
    spikeHoles(ctx, b);

    var alpha = 0;
    if (active) {
      // Start retracting near the end of the active second.
      alpha = frac > 0.85 ? 1 - ((frac - 0.85) / 0.15) * 0.7 : 1;
    } else {
      // Telegraph the rise during the last part of the inactive second.
      alpha = frac > 0.7 ? ((frac - 0.7) / 0.3) * 0.6 : 0;
    }
    if (alpha > 0.01) spikeField(ctx, b, alpha);
  }

  function drawTile(env, x, y, spikesOn, frac) {
    var b = tileBox(env, x, y);
    var type = tileAt(env, x, y);
    var ids = env.ids;
    if (type === ids.WALL) drawWall(env, x, y, b);
    else if (type === ids.DOOR) drawDoor(env, x, y, b);
    else if (type === ids.SPIKES) drawSpikes(env, x, y, b, spikesOn, frac);
    else drawFloor(env, x, y, b);
  }

  // ---------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------

  function drawKey(ctx, cx, cy, t, ph) {
    var y = Math.round(cy + Math.sin(t * 3 + ph) * 2);
    ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 3 + ph);
    circle(ctx, C.gold, cx, y, 12);
    ctx.globalAlpha = 1;
    // Bow (ring head)
    circle(ctx, C.goldDark, cx - 4, y, 5);
    circle(ctx, C.gold, cx - 4, y, 4);
    circle(ctx, C.floorA, cx - 4, y, 1.6);
    // Shaft and teeth
    rect(ctx, C.gold, cx - 1, y - 1, 10, 3);
    rect(ctx, C.goldDark, cx - 1, y + 2, 10, 1);
    rect(ctx, C.gold, cx + 5, y + 2, 2, 3);
    rect(ctx, C.gold, cx + 8, y + 2, 2, 2);
    // Shine
    rect(ctx, C.goldHi, cx - 6, y - 3, 2, 2);
  }

  function drawPotion(ctx, cx, cy, t, ph) {
    var y = Math.round(cy + Math.sin(t * 3 + ph) * 1.5);
    shadow(ctx, cx, cy + 10, 5, 2, 0.35);
    rect(ctx, C.cork, cx - 2, y - 9, 4, 3);
    rect(ctx, C.glass, cx - 3, y - 6, 6, 2);
    circle(ctx, C.potionDark, cx, y + 1, 6);
    circle(ctx, C.potion, cx, y + 1, 5);
    circle(ctx, C.potionHi, cx - 2, y - 1, 1.5);
  }

  function drawCoin(ctx, cx, cy, t, ph) {
    var y = Math.round(cy + Math.sin(t * 2.5 + ph) * 1.5);
    var spin = Math.abs(Math.cos(t * 4 + ph));
    var rx = Math.max(1.5, 6 * spin);
    shadow(ctx, cx, cy + 9, 5, 2, 0.3);
    ellipse(ctx, C.goldDark, cx, y, rx + 1, 6.5);
    ellipse(ctx, C.gold, cx, y, rx, 5.5);
    if (spin > 0.4) {
      ellipse(ctx, C.goldHi, cx - rx * 0.35, y - 2, Math.max(0.8, rx * 0.25), 1.6);
    }
  }

  function drawItems(env, items) {
    var arr = Array.isArray(items) ? items : [];
    var ctx = env.ctx;
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (!it || it.taken) continue;
      if (!visibleThing(env, it.x, it.y)) continue;
      var c = tileCenter(env, it.x, it.y);
      var ph = hash(it.x, it.y, 60) * TAU;
      if (it.type === 'key') drawKey(ctx, c.x, c.y, env.t, ph);
      else if (it.type === 'potion') drawPotion(ctx, c.x, c.y, env.t, ph);
      else if (it.type === 'coin') drawCoin(ctx, c.x, c.y, env.t, ph);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------
  // Enemies
  // ---------------------------------------------------------------------

  function drawSlime(ctx, cx, cy, t, ph, flash) {
    var s = Math.sin(t * 5 + ph);
    var rx = 11 - s * 1.3;
    var ry = 8.5 + s * 1.6;
    var by = cy + 10 - ry;
    shadow(ctx, cx, cy + 11, 10, 3, 0.35);
    ellipse(ctx, pick(flash, C.slimeDark), cx, by, rx + 1, ry + 1);
    ellipse(ctx, pick(flash, C.slime), cx, by, rx, ry);
    ellipse(ctx, pick(flash, C.slimeHi), cx - rx * 0.35, by - ry * 0.45, rx * 0.3, ry * 0.22);
    var ey = Math.round(by - 1);
    circle(ctx, pick(flash, C.white), cx - 4, ey, 2.4);
    circle(ctx, pick(flash, C.white), cx + 4, ey, 2.4);
    circle(ctx, C.outline, cx - 4, ey + 0.5, 1.1);
    circle(ctx, C.outline, cx + 4, ey + 0.5, 1.1);
  }

  function drawBat(ctx, cx, cy, t, ph, flash) {
    var hover = Math.sin(t * 5 + ph) * 2;
    var y = cy - 1 + hover;
    shadow(ctx, cx, cy + 11, 6 - hover * 0.3, 2, 0.3);
    var flap = Math.sin(t * 18 + ph);
    var wing = pick(flash, C.bat);
    var wingDark = pick(flash, C.batDark);
    // Left wing, then mirrored right wing
    tri(ctx, wingDark, cx - 3, y - 1, cx - 13, y - 6 + flap * 5, cx - 8, y + 4);
    tri(ctx, wing, cx - 3, y + 1, cx - 10, y + 3 + flap * 2.5, cx - 4, y + 5);
    tri(ctx, wingDark, cx + 3, y - 1, cx + 13, y - 6 + flap * 5, cx + 8, y + 4);
    tri(ctx, wing, cx + 3, y + 1, cx + 10, y + 3 + flap * 2.5, cx + 4, y + 5);
    // Ears and body
    tri(ctx, wing, cx - 3.5, y - 4, cx - 4.5, y - 8, cx - 0.5, y - 4.5);
    tri(ctx, wing, cx + 3.5, y - 4, cx + 4.5, y - 8, cx + 0.5, y - 4.5);
    ellipse(ctx, pick(flash, C.bat), cx, y, 4, 5.5);
    if (!flash) {
      circle(ctx, C.batEye, cx - 1.6, y - 1, 1.1);
      circle(ctx, C.batEye, cx + 1.6, y - 1, 1.1);
    }
  }

  function drawSkeleton(ctx, cx, cy, t, ph, flash) {
    var walk = Math.sin(t * 6 + ph);
    var by = Math.round(cy - Math.abs(walk) * 1.2);
    var bone = pick(flash, C.bone);
    var mid = pick(flash, C.boneMid);
    var dark = pick(flash, C.boneDark);
    shadow(ctx, cx, cy + 12, 7, 2.5, 0.35);
    // Legs and arms
    line(ctx, mid, 2.5, cx - 2, by + 8, cx - 2 - walk * 2, by + 15);
    line(ctx, mid, 2.5, cx + 2, by + 8, cx + 2 + walk * 2, by + 15);
    line(ctx, mid, 2, cx - 4, by + 2, cx - 7 + walk * 2, by + 9);
    line(ctx, mid, 2, cx + 4, by + 2, cx + 7 - walk * 2, by + 9);
    // Ribcage and spine
    rect(ctx, mid, cx - 4, by + 2, 8, 7);
    rect(ctx, dark, cx - 4, by + 4, 8, 1);
    rect(ctx, dark, cx - 4, by + 6, 8, 1);
    rect(ctx, dark, cx - 4, by + 8, 8, 1);
    rect(ctx, dark, cx - 0.5, by + 2, 1, 7);
    // Skull and jaw
    circle(ctx, bone, cx, by - 4, 5.5);
    rect(ctx, bone, cx - 3, by - 1, 6, 2);
    rect(ctx, pick(flash, C.outline), cx - 3.5, by - 6, 2.5, 2.5);
    rect(ctx, pick(flash, C.outline), cx + 1, by - 6, 2.5, 2.5);
    rect(ctx, dark, cx - 1.5, by - 0.5, 1, 1.5);
    rect(ctx, dark, cx + 0.5, by - 0.5, 1, 1.5);
  }

  function drawPips(ctx, cx, y, hp, maxHp) {
    var n = Math.min(maxHp, 6);
    var x0 = Math.round(cx - (n * 5) / 2);
    for (var i = 0; i < n; i++) {
      rect(ctx, C.outline, x0 + i * 5 - 1, y - 1, 5, 5);
      rect(ctx, i < hp ? C.hurt : C.hurtEmpty, x0 + i * 5, y, 3, 3);
    }
  }

  function drawEnemies(env, list) {
    var arr = Array.isArray(list) ? list : [];
    var ctx = env.ctx;
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (!e || e.alive === false) continue;
      if (!visibleThing(env, num(e.x, -1), num(e.y, -1))) continue;
      var c = tileCenter(env, num(e.px, num(e.x, 0)), num(e.py, num(e.y, 0)));
      var ph = phaseOf(e);
      var flash = num(e.hurtTimer, 0) > 0;
      if (e.type === 'slime') drawSlime(ctx, c.x, c.y, env.t, ph, flash);
      else if (e.type === 'bat') drawBat(ctx, c.x, c.y, env.t, ph, flash);
      else if (e.type === 'skeleton') drawSkeleton(ctx, c.x, c.y, env.t, ph, flash);
      else continue;
      ctx.globalAlpha = 1;
      var maxHp = num(e.maxHp, 0);
      var hp = num(e.hp, maxHp);
      if (maxHp > 0 && hp < maxHp) {
        drawPips(ctx, c.x, c.y - 19, Math.max(0, hp), maxHp);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------

  function drawPlayer(env, p) {
    var ctx = env.ctx;
    var c = tileCenter(env, env.px, env.py);
    var fx = num(p.facing && p.facing.dx, 0);
    var fy = num(p.facing && p.facing.dy, 1);
    if (fx === 0 && fy === 0) fy = 1;

    // Lunge forward while attacking.
    var att = num(p.attackTimer, 0);
    var lunge = att > 0 ? Math.sin(clamp(att / 0.15, 0, 1) * Math.PI) * 4 : 0;
    var bob = Math.round(Math.sin(env.t * 5) * 0.8);
    var bx = Math.round(c.x + fx * lunge);
    var by = Math.round(c.y + fy * lunge) + bob;

    // Flash while invulnerable.
    var hurt = num(p.hurtTimer, 0);
    var blink = hurt > 0 && Math.floor(env.t * 14) % 2 === 0;

    shadow(ctx, c.x, c.y + 11, 9, 3.5, 0.35);
    ctx.globalAlpha = blink ? 0.3 : 1;

    // Cloak behind the body
    ctx.fillStyle = C.cloak;
    ctx.beginPath();
    ctx.moveTo(bx - 7, by - 3);
    ctx.lineTo(bx + 7, by - 3);
    ctx.lineTo(bx + 9, by + 9);
    ctx.lineTo(bx - 9, by + 9);
    ctx.closePath();
    ctx.fill();
    rect(ctx, C.cloakDark, bx - 9, by + 8, 18, 1);

    // Legs, tunic, belt, arms
    rect(ctx, C.heroDark, bx - 4, by + 7, 3, 4);
    rect(ctx, C.heroDark, bx + 1, by + 7, 3, 4);
    rect(ctx, C.hero, bx - 5, by - 2, 10, 9);
    rect(ctx, C.heroDark, bx - 5, by + 4, 10, 2);
    rect(ctx, C.skin, bx - 7, by - 1, 2, 5);
    rect(ctx, C.skin, bx + 5, by - 1, 2, 5);

    // Head and hair
    circle(ctx, C.skin, bx, by - 7, 5);
    if (fy < 0) {
      // Facing away: the back of the head is all hair.
      circle(ctx, C.hair, bx, by - 7, 5.2);
    } else {
      ellipse(ctx, C.hair, bx, by - 9.5, 5.5, 3.2);
      var ex = bx + fx * 1.5;
      rect(ctx, C.outline, Math.round(ex - 2.5), by - 6, 2, 2);
      rect(ctx, C.outline, Math.round(ex + 1), by - 6, 2, 2);
    }

    // Sword on the facing side, with a gold guard
    var hx = bx + fx * 5;
    var hy = by + fy * 3 + 1;
    var reach = 10 + lunge * 1.5;
    line(ctx, att > 0 ? C.goldHi : C.steel, 2.5, hx, hy, hx + fx * reach, hy + fy * reach);
    line(ctx, C.gold, 2, hx - fy * 3, hy + fx * 3, hx + fy * 3, hy - fx * 3);

    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  // Particles and fog
  // ---------------------------------------------------------------------

  function drawParticles(env, list) {
    var arr = Array.isArray(list) ? list : [];
    var ctx = env.ctx;
    var maxX = env.cols * env.T + 8, maxY = env.rows * env.T + 8;
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      var life = num(p.life, 0);
      if (life <= 0) continue;
      var maxLife = num(p.maxLife, 0);
      var a = clamp(life / (maxLife > 0 ? maxLife : 1), 0, 1);
      var sx = Math.round((p.x - env.camX) * env.T);
      var sy = Math.round((p.y - env.camY) * env.T);
      if (sx < -8 || sy < -8 || sx > maxX || sy > maxY) continue;
      var size = Math.max(1, Math.round(num(p.size, 3) * (0.5 + 0.5 * a)));
      ctx.globalAlpha = a;
      rect(ctx, typeof p.color === 'string' ? p.color : C.torch,
        Math.round(sx - size / 2), Math.round(sy - size / 2), size, size);
    }
    ctx.globalAlpha = 1;
  }

  // Fog is drawn per tile, after everything else.
  function drawFog(env, x0, x1, y0, y1) {
    var ctx = env.ctx;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var b = tileBox(env, x, y);
        if (!isSeen(env, x, y)) {
          ctx.globalAlpha = 1;
          rect(ctx, C.black, b.x, b.y, b.w, b.h);
          continue;
        }
        var dx = x - env.px, dy = y - env.py;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > env.R) {
          ctx.globalAlpha = 0.55;
          rect(ctx, C.black, b.x, b.y, b.w, b.h);
        } else {
          // Torch pool: clear near the player, darkening towards the edge of sight.
          var k = smooth(clamp((d - 0.75) / Math.max(0.01, env.R - 0.75), 0, 1));
          var a = 0.55 * k;
          if (a > 0.01) {
            ctx.globalAlpha = a;
            rect(ctx, C.fogWarm, b.x, b.y, b.w, b.h);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------

  DE.render = function (ctx, state) {
    if (!ctx) return;
    var cfg = readConfig();
    var W = cfg.COLS * cfg.T;
    var H = cfg.ROWS * cfg.T;

    // Clear first, so a missing level still gives a black frame.
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, W, H);

    if (!state || !state.level || !state.player) return;

    var level = state.level;
    var p = state.player;
    var tiles = level.tiles;
    if (!Array.isArray(tiles) || !tiles.length || !tiles[0]) return;

    var levelW = num(level.width, tiles[0].length);
    var levelH = num(level.height, tiles.length);
    var px = num(p.px, num(p.x, 0));
    var py = num(p.py, num(p.y, 0));

    var env = {
      ctx: ctx,
      T: cfg.T,
      R: cfg.R,
      cols: cfg.COLS,
      rows: cfg.ROWS,
      ids: readTiles(),
      tiles: tiles,
      seen: level.seen || null,
      camX: clampCam(px + 0.5 - cfg.COLS / 2, levelW - cfg.COLS),
      camY: clampCam(py + 0.5 - cfg.ROWS / 2, levelH - cfg.ROWS),
      px: px,
      py: py,
      hasKey: !!p.hasKey,
      t: (window.performance && typeof performance.now === 'function')
        ? performance.now() / 1000
        : Date.now() / 1000
    };

    var time = num(state.time, 0);
    var frac = ((time % 1) + 1) % 1;
    var spikesOn = false;
    if (typeof DE.spikesActive === 'function') {
      spikesOn = !!DE.spikesActive(state);
    }

    var shake = num(state.shake, 0);

    ctx.save();
    try {
      if (shake > 0) {
        var amp = 1 + 3 * clamp(shake / 0.25, 0, 1);
        ctx.translate(
          Math.round((Math.random() * 2 - 1) * amp),
          Math.round((Math.random() * 2 - 1) * amp)
        );
      }

      // Only the tiles on screen (plus a one-tile margin for shake).
      var x0 = Math.max(0, Math.floor(env.camX) - 1);
      var x1 = Math.min(levelW - 1, Math.ceil(env.camX + cfg.COLS) + 1);
      var y0 = Math.max(0, Math.floor(env.camY) - 1);
      var y1 = Math.min(levelH - 1, Math.ceil(env.camY + cfg.ROWS) + 1);

      for (var ty = y0; ty <= y1; ty++) {
        for (var tx = x0; tx <= x1; tx++) {
          drawTile(env, tx, ty, spikesOn, frac);
        }
      }

      drawItems(env, level.items);
      drawEnemies(env, state.enemies);
      drawPlayer(env, p);
      drawParticles(env, state.particles);
      drawFog(env, x0, x1, y0, y1);
    } finally {
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };
})();
