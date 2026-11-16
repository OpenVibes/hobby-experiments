window.DE = window.DE || {};
(function (DE) {
  'use strict';

  // ===========================================================================
  // Field of view
  // ===========================================================================

  // Bresenham walk from (x0,y0) to (x1,y1). Intermediate tiles must not be
  // opaque; the start tile is the viewer and the end tile may be opaque (walls
  // render).
  function lineClear(floor, x0, y0, x1, y1) {
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    var x = x0, y = y0;
    for (;;) {
      if (x === x1 && y === y1) return true;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return true;
      if (DE.isOpaque(DE.tileAt(floor, x, y))) return false;
    }
  }

  DE.computeFOV = function (floor, px, py, radius) {
    var w = floor.width, h = floor.height;
    var out = new Uint8Array(w * h);
    if (!w || !h) return out;
    px = Math.round(px); py = Math.round(py);
    if (px < 0 || py < 0 || px >= w || py >= h) return out;
    out[py * w + px] = 1;
    var r = Math.max(0, +radius || 0);
    var lim = r + 0.5, lim2 = lim * lim;
    var R = Math.ceil(lim);
    var y0 = Math.max(0, py - R), y1 = Math.min(h - 1, py + R);
    var x0 = Math.max(0, px - R), x1 = Math.min(w - 1, px + R);
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        if (x === px && y === py) continue;
        var dx = x - px, dy = y - py;
        if (dx * dx + dy * dy > lim2) continue;
        if (lineClear(floor, px, py, x, y)) out[y * w + x] = 1;
      }
    }
    return out;
  };

  // ===========================================================================
  // Small helpers
  // ===========================================================================

  var TAU = Math.PI * 2;
  var GRID = 2;              // device px per sprite-grid cell (16x16 sprites)
  var FLASH = '#ffffff';
  var SKIN = '#f2c79b', HAIR = '#5a3a1e';
  var SLIME = '#4fbf5b', SLIME_LIGHT = '#a6ecaa', SLIME_DARK = '#2b7d3a';
  var DIM = 'rgba(10,18,40,0.72)';   // cool wash: explored-but-not-visible reads as "remembered"

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Deterministic per-tile hash (0..2^32-1).
  function hash2(x, y) {
    var h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // Pre-built torch shade strings: index k => alpha k/40 of a warm near-black.
  var shadeStrs = null;
  function shadeStr(k) {
    if (!shadeStrs) {
      shadeStrs = [];
      for (var i = 0; i <= 40; i++) shadeStrs.push('rgba(14,7,2,' + (i / 40).toFixed(3) + ')');
    }
    return shadeStrs[k];
  }

  // Drawing state shared by the sprite painters. `g` is the current 2D context.
  // `ox`,`oy` is the device-px origin of the entity sprite being drawn.
  var g = null;
  var ox = 0, oy = 0;
  var flashing = false;

  // Raw device-px rectangle (tiles, effects, cached sprites).
  function P(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

  // Grid cell rectangle relative to the entity origin; white while flashing.
  function R(gx, gy, gw, gh, col) {
    g.fillStyle = flashing ? FLASH : col;
    g.fillRect(ox + gx * GRID, oy + gy * GRID, gw * GRID, gh * GRID);
  }

  // Grid cell rectangle that ignores the flash (shadows, glows).
  function S(gx, gy, gw, gh, col) {
    g.fillStyle = col;
    g.fillRect(ox + gx * GRID, oy + gy * GRID, gw * GRID, gh * GRID);
  }

  function tri(x, y, w, h, col) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y + h);
    g.lineTo(x + w / 2, y);
    g.lineTo(x + w, y + h);
    g.closePath();
    g.fill();
  }

  // Paints a tile-sized sprite onto an offscreen canvas.
  function makeCanvas(T, paint) {
    var c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    var prev = g;
    g = c.getContext('2d');
    ox = 0; oy = 0; flashing = false;
    paint();
    g = prev;
    return c;
  }

  // ===========================================================================
  // Tile sprite painters (static, cached once per renderer)
  // ===========================================================================

  function paintFloor(T, v) {
    var base = ['#252831', '#22252e', '#282b35', '#20232b'][v & 3];
    var fleck = ['#30343f', '#2b2f39', '#33373f', '#2a2e38'][v & 3];
    P(0, 0, T, T, base);
    if (v & 1) { P(0, 0, T, 1, '#1a1c22'); P(0, 0, 1, T, '#1a1c22'); }   // flagstone seams
    if (v & 2) { P(T - 1, 1, 1, T - 2, '#1d2028'); P(1, T - 1, T - 2, 1, '#1d2028'); }
    for (var i = 0; i < 5; i++) {
      var h = hash2(i * 7 + v * 3, v * 13 + i);
      var fx = 2 + (h % (T - 4));
      var fy = 2 + ((h >>> 8) % (T - 4));
      P(fx, fy, 1 + ((h >>> 16) & 1), 1, fleck);
    }
  }

  function paintWall(T, v, lit) {
    var tones = ['#4a4f5c', '#434856', '#51566a', '#3f4450'];
    P(0, 0, T, T, '#14161c');                              // mortar
    for (var row = 0; row < 4; row++) {
      var y0 = row * 8;
      var off = ((row + v) & 1) ? 8 : 0;
      for (var bx = off - 16; bx < T; bx += 16) {
        var x0 = Math.max(0, bx), x1 = Math.min(T, bx + 15);
        if (x1 <= x0) continue;
        var tone = tones[hash2(bx + 40 + v * 5, row) & 3];
        P(x0, y0, x1 - x0, 7, tone);
        P(x0, y0, x1 - x0, 1, '#5f6578');                  // block top highlight
        P(x0, y0 + 6, x1 - x0, 1, '#2f333e');              // block bottom shade
      }
    }
    if (lit) {
      P(0, 0, T, 3, '#7b8294');
      P(0, 0, T, 1, '#9aa2b5');
      P(0, 3, T, 1, '#2a2e38');
    } else {
      P(0, 0, T, 1, '#2a2e38');
    }
  }

  function paintLocked(T) {
    P(0, 0, T, T, '#3a3e49');                              // stone surround
    P(0, 8, T, 1, '#1c1f26'); P(0, 16, T, 1, '#1c1f26'); P(0, 24, T, 1, '#1c1f26');
    P(15, 0, 1, 8, '#1c1f26'); P(7, 8, 1, 8, '#1c1f26'); P(23, 16, 1, 8, '#1c1f26');
    P(4, 3, 24, 28, '#2b1a0c');                            // door outline
    P(5, 4, 22, 26, '#7b4e2b');                            // door leaf
    P(5, 4, 22, 1, '#8f5e34');
    for (var x = 9; x < 26; x += 5) P(x, 5, 1, 24, '#57361c'); // plank seams
    P(5, 9, 22, 2, '#2c2f36'); P(5, 20, 22, 2, '#2c2f36');     // iron bands
    P(7, 10, 1, 1, '#9aa0ab'); P(24, 10, 1, 1, '#9aa0ab');
    P(7, 21, 1, 1, '#9aa0ab'); P(24, 21, 1, 1, '#9aa0ab');
    P(13, 13, 6, 9, '#8a6d24');                            // lock plate
    P(14, 14, 4, 7, '#c49a2c');
    P(15, 14, 3, 3, '#f0c040');                            // gold keyhole
    P(16, 17, 1, 4, '#f0c040');
    P(16, 15, 1, 1, '#140c02');
    P(16, 18, 1, 2, '#140c02');
  }

  function paintOpen(T) {
    paintFloor(T, 2);
    P(0, 0, 5, T, '#3a3e49');                              // jambs
    P(T - 5, 0, 5, T, '#3a3e49');
    P(0, 0, T, 3, '#3a3e49');                              // lintel
    P(4, 3, 1, T - 3, '#55596a');
    P(T - 5, 3, 1, T - 3, '#2a2d35');
    P(5, 3, T - 10, T - 3, '#0a0b0e');                     // dark opening
    P(5, 3, 3, T - 3, '#6b4a2b');                          // door leaves swung back
    P(5, 3, 1, T - 3, '#4a321c');
    P(T - 8, 3, 3, T - 3, '#6b4a2b');
    P(T - 8 + 2, 3, 1, T - 3, '#4a321c');
    P(5, T - 3, T - 10, 3, '#16181d');                     // worn threshold
  }

  function paintStairs(T) {
    paintFloor(T, 2);
    P(3, 3, T - 6, T - 6, '#0b0c10');                      // pit
    var cols = ['#948d76', '#7b7562', '#625d4d', '#4b473b'];
    for (var k = 0; k < 4; k++) {
      var y = 6 + k * 6;
      var inset = 4 + k * 2;
      P(inset, y, T - inset * 2, 4, cols[k]);
      P(inset, y, T - inset * 2, 1, '#bdb59a');
      P(inset, y + 3, T - inset * 2, 1, '#2a2822');
    }
  }

  function paintExit(T) {
    paintFloor(T, 0);
    g.strokeStyle = '#2b5550';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(T / 2, T / 2, T / 2 - 4, 0, TAU);
    g.stroke();
    P(T / 2 - 1, 3, 2, 2, '#2b5550');
    P(T - 5, T / 2 - 1, 2, 2, '#2b5550');
    P(T / 2 - 1, T - 5, 2, 2, '#2b5550');
    P(3, T / 2 - 1, 2, 2, '#2b5550');
  }

  function paintSpikes(T, v) {
    paintFloor(T, v);
    var pts = [[5, 12], [13, 12], [21, 12], [9, 20], [17, 20]];
    for (var k = 0; k < pts.length; k++) {
      var x = pts[k][0], y = pts[k][1];
      P(x - 1, y + 8, 9, 1, '#3c424c');
      tri(x, y, 6, 8, '#a2abb8');
      g.fillStyle = '#7d8592';
      g.beginPath();
      g.moveTo(x + 3, y);
      g.lineTo(x + 6, y + 8);
      g.lineTo(x + 3, y + 8);
      g.closePath();
      g.fill();
    }
  }

  function buildSprites(T) {
    var s = {};
    s.floors = [0, 1, 2, 3].map(function (v) { return makeCanvas(T, function () { paintFloor(T, v); }); });
    s.walls = [];
    for (var v = 0; v < 2; v++) {
      for (var lit = 0; lit < 2; lit++) {
        s.walls.push(makeCanvas(T, function () { paintWall(T, v, lit); }));
      }
    }
    s.spikes = [0, 1, 2, 3].map(function (v) { return makeCanvas(T, function () { paintSpikes(T, v); }); });
    s.locked = makeCanvas(T, function () { paintLocked(T); });
    s.open = makeCanvas(T, function () { paintOpen(T); });
    s.stairs = makeCanvas(T, function () { paintStairs(T); });
    s.exit = makeCanvas(T, function () { paintExit(T); });
    return s;
  }

  // ===========================================================================
  // Entity sprites (procedural, animated, 16x16 grid at 2 px per cell)
  // ===========================================================================

  function drawHero(now, facing) {
    oy += Math.round(Math.sin(now * 0.006));              // idle bob
    R(3, 6, 10, 8, '#7a1c24');                            // cape
    R(3, 13, 10, 1, '#5a1219');
    R(5, 12, 2, 3, '#2b2b33'); R(9, 12, 2, 3, '#2b2b33'); // legs
    R(4, 15, 3, 1, '#16161b'); R(9, 15, 3, 1, '#16161b'); // feet
    R(4, 7, 8, 6, '#3b6fb6');                             // tunic
    R(4, 11, 8, 1, '#2e5a96');
    R(4, 10, 8, 1, '#5a4632');                            // belt
    R(7, 10, 2, 1, '#e0b040');
    R(3, 8, 1, 4, '#2e5a96'); R(12, 8, 1, 4, '#2e5a96'); // arms
    R(3, 12, 1, 1, SKIN); R(12, 12, 1, 1, SKIN);
    R(5, 2, 6, 5, SKIN);                                  // head
    R(5, 1, 6, 2, HAIR); R(4, 2, 1, 2, HAIR); R(11, 2, 1, 2, HAIR);
    if (facing === 'up') {
      R(5, 2, 6, 4, HAIR);
      R(4, 6, 8, 1, '#7a1c24');
    } else {
      R(7, 5, 2, 1, '#d9a57a');                           // nose
      if (facing === 'down') { R(6, 4, 1, 1, '#1a1a1a'); R(9, 4, 1, 1, '#1a1a1a'); }
      else if (facing === 'left') { R(6, 4, 1, 1, '#1a1a1a'); }
      else { R(9, 4, 1, 1, '#1a1a1a'); }
    }
  }

  function drawSlime(now, seed) {
    var hop = Math.sin(now * 0.007 + seed) > 0.3 ? 1 : 0;
    S(3, 14, 10, 1, 'rgba(0,0,0,0.35)');                  // shadow stays on the floor
    oy -= hop * GRID;
    R(5, 7, 6, 1, SLIME);
    R(4, 8, 8, 1, SLIME);
    R(3, 9, 10, 2, SLIME);
    R(2, 11, 12, 2, SLIME);
    R(3, 13, 10, 1, SLIME_DARK);
    R(4, 8, 2, 1, SLIME_LIGHT);
    R(3, 9, 2, 1, SLIME_LIGHT);
    R(5, 9, 2, 2, '#ffffff'); R(9, 9, 2, 2, '#ffffff');   // eyes
    R(6, 10, 1, 1, '#101810'); R(10, 10, 1, 1, '#101810');
  }

  function drawBat(now, seed) {
    var flapUp = Math.sin(now * 0.022 + seed) > 0;
    S(4, 14, 8, 1, 'rgba(0,0,0,0.3)');
    oy += Math.round(Math.sin(now * 0.008 + seed) * 2);   // hover
    var WING = '#5b3a82', EDGE = '#8e67c2';
    var wings = flapUp
      ? [[0, 2, 5, 3], [2, 5, 4, 2], [4, 7, 2, 1]]
      : [[0, 7, 5, 2], [1, 9, 4, 2], [3, 11, 2, 1]];
    for (var i = 0; i < wings.length; i++) {
      var w = wings[i];
      R(w[0], w[1], w[2], w[3], WING);
      R(16 - w[0] - w[2], w[1], w[2], w[3], WING);
    }
    R(wings[0][0], wings[0][1], wings[0][2], 1, EDGE);
    R(16 - wings[0][0] - wings[0][2], wings[0][1], wings[0][2], 1, EDGE);
    R(5, 4, 1, 2, '#4a2d70'); R(10, 4, 1, 2, '#4a2d70');  // ears
    R(6, 5, 4, 5, '#7e4fb5');                              // body
    R(7, 9, 2, 1, '#c9b6e8');
    R(6, 6, 1, 1, '#ff4d4d'); R(9, 6, 1, 1, '#ff4d4d');   // eyes
    R(7, 10, 1, 1, '#ffffff'); R(9, 10, 1, 1, '#ffffff'); // fangs
  }

  function drawSkeleton() {
    var BONE = '#e8e4d0', SHADOW = '#c9c3ab', DARK = '#2a2a2a', RIB = '#d6d0b8';
    S(4, 15, 8, 1, 'rgba(0,0,0,0.3)');
    R(6, 0, 4, 1, BONE);                                   // skull
    R(5, 1, 6, 5, BONE);
    R(6, 3, 2, 2, DARK); R(9, 3, 2, 2, DARK);              // eye sockets
    R(7, 5, 2, 1, DARK);                                   // nose
    R(6, 6, 4, 1, BONE);                                   // jaw
    R(7, 6, 1, 1, DARK); R(9, 6, 1, 1, DARK);
    R(7, 7, 2, 7, SHADOW);                                 // spine
    R(4, 8, 3, 1, RIB); R(9, 8, 3, 1, RIB);                // ribs
    R(4, 10, 3, 1, RIB); R(9, 10, 3, 1, RIB);
    R(4, 12, 3, 1, RIB); R(9, 12, 3, 1, RIB);
    R(2, 7, 2, 6, BONE); R(12, 7, 2, 6, BONE);             // arms
    R(5, 13, 6, 1, SHADOW);                                // pelvis
    R(5, 14, 2, 2, BONE); R(9, 14, 2, 2, BONE);            // legs
  }

  function drawOrc() {
    var OL = '#6b7f2a', OLD = '#4f5f1e', OLDK = '#3d4a17', BELLY = '#7f9535';
    R(2, 3, 2, 2, OLDK); R(12, 3, 2, 2, OLDK);             // ears
    R(4, 1, 8, 6, OL);                                     // head
    R(4, 3, 8, 1, OLD);
    R(5, 4, 2, 1, '#ffcc33'); R(9, 4, 2, 1, '#ffcc33');    // eyes
    R(6, 4, 1, 1, '#2a1a00'); R(9, 4, 1, 1, '#2a1a00');
    R(6, 6, 4, 1, '#2a1a0a');                              // mouth
    R(5, 6, 1, 2, '#f5f1e0'); R(10, 6, 1, 2, '#f5f1e0');  // tusks
    R(3, 7, 10, 6, OL);                                    // body
    R(5, 9, 6, 3, BELLY);
    R(3, 11, 10, 1, '#4a2e1a');                            // belt
    R(7, 11, 2, 1, '#ccaa33');
    R(1, 7, 2, 6, OLDK); R(13, 7, 2, 6, OLDK);             // arms
    R(1, 12, 2, 1, OLD); R(13, 12, 2, 1, OLD);
    R(4, 13, 3, 2, OLDK); R(9, 13, 3, 2, OLDK);            // legs
    R(3, 15, 4, 1, '#2a1a0a'); R(9, 15, 4, 1, '#2a1a0a');  // feet
  }

  function drawWraith(now, seed) {
    var prevA = g.globalAlpha;
    g.globalAlpha = flashing ? 1 : 0.78;
    S(4, 15, 8, 1, 'rgba(0,0,0,0.3)');
    oy += Math.round(Math.sin(now * 0.004 + seed) * 2);    // float
    var BODY = '#a8cdf0', SHADE = '#6e96c4', HOOD = '#8fb8e8';
    R(6, 0, 4, 1, HOOD);                                   // hood
    R(5, 1, 6, 2, HOOD);
    R(6, 3, 4, 3, '#0d1830');                              // face
    R(6, 4, 1, 1, '#7ff6ff'); R(9, 4, 1, 1, '#7ff6ff');    // glowing eyes
    R(4, 6, 8, 6, BODY);                                   // robe
    R(11, 6, 1, 6, SHADE);
    R(2, 7, 2, 2, BODY); R(12, 7, 2, 2, BODY);             // wisps
    R(4, 12, 2, 2, BODY); R(7, 12, 2, 3, BODY); R(10, 12, 2, 2, BODY);
    R(5, 14, 1, 1, SHADE); R(10, 14, 1, 1, SHADE);
    R(1, 4, 1, 1, '#c8e6ff'); R(14, 5, 1, 1, '#c8e6ff');   // motes
    g.globalAlpha = prevA;
  }

  function drawPotion() {
    S(4, 14, 8, 1, 'rgba(0,0,0,0.3)');
    R(7, 2, 2, 1, '#7a5a33');                              // cork
    R(6, 3, 4, 2, '#9aa6b8');                              // neck
    R(4, 6, 8, 6, '#d7263d');                              // flask
    R(4, 11, 8, 2, '#a8172c');
    R(5, 13, 6, 1, '#a8172c');
    R(5, 6, 1, 5, '#ff8a95');                              // glint
    R(6, 5, 1, 1, '#ffd0d6');
  }

  function drawGold(now, seed) {
    R(5, 8, 8, 2, '#b8860b');
    R(4, 10, 9, 2, '#e0a800');
    R(3, 12, 10, 2, '#ffd24a');
    R(4, 10, 6, 1, '#ffe88a');
    R(3, 12, 10, 1, '#ffe88a');
    R(3, 14, 10, 1, '#8a5f00');
    if ((Math.floor(now / 350) + (seed | 0)) % 6 === 0) R(12, 6, 1, 1, '#fffbe0'); // sparkle
  }

  function drawKey(now, seed) {
    var GOLD = '#ffd24a', GOLD_D = '#b8860b';
    oy += Math.round(Math.sin(now * 0.005 + seed) * 2);    // gentle bob
    R(2, 6, 4, 1, GOLD); R(2, 9, 4, 1, GOLD);              // bow
    R(1, 7, 1, 2, GOLD); R(6, 7, 1, 2, GOLD);
    R(2, 7, 4, 2, '#1a1204');                              // hole
    R(2, 6, 1, 1, '#fff3b0');                              // shine
    R(7, 7, 7, 2, GOLD);                                   // shaft
    R(7, 9, 7, 1, GOLD_D);
    R(11, 9, 1, 2, GOLD); R(13, 9, 1, 2, GOLD);            // teeth
  }

  function drawSword() {
    var BLADE = '#dfe6ee', EDGE = '#8fa0b5', GUARD = '#c9a13b', GRIP = '#6b4423';
    for (var i = 0; i < 10; i++) {
      R(5 + i, 10 - i, 2, 1, BLADE);
      R(5 + i, 9 - i, 1, 1, EDGE);
    }
    R(4, 9, 1, 1, GUARD); R(5, 10, 1, 1, GUARD); R(6, 11, 1, 1, GUARD);
    R(4, 11, 1, 1, GRIP); R(3, 12, 1, 1, GRIP); R(2, 13, 1, 1, GRIP);
    R(2, 14, 1, 1, GUARD);
  }

  function drawShield() {
    var M = '#8a95a8', MD = '#4a5263', MH = '#c3cbd9', CROSS = '#e0b040';
    R(4, 3, 8, 1, MD); R(3, 4, 1, 5, MD); R(12, 4, 1, 5, MD);
    R(4, 4, 8, 5, M);
    R(4, 4, 2, 1, MH);
    R(5, 9, 6, 1, M); R(6, 10, 4, 1, M); R(7, 11, 2, 1, M);
    R(4, 9, 1, 1, MD); R(11, 9, 1, 1, MD);
    R(5, 10, 1, 1, MD); R(10, 10, 1, 1, MD);
    R(6, 11, 1, 1, MD); R(9, 11, 1, 1, MD);
    R(7, 12, 2, 1, MD);
    R(7, 5, 2, 6, CROSS); R(5, 7, 6, 2, CROSS);            // emblem
  }

  function drawTorch(now, seed) {
    var flick = Math.round(Math.sin(now * 0.02 + seed));
    R(7, 8, 2, 7, '#7a4f2a');                              // handle
    R(6, 7, 4, 2, '#4a2e18');                              // binding
    R(6, 3 + flick, 4, 4 - flick, '#ff8a1e');              // flame
    R(7, 4 + flick, 2, 2, '#ffe066');
    R(7, 2 + flick, 2, 1, '#fff3b0');
  }

  var ENEMY_DRAW = { slime: drawSlime, bat: drawBat, skeleton: drawSkeleton, orc: drawOrc, wraith: drawWraith };
  var ITEM_DRAW = { potion: drawPotion, gold: drawGold, key: drawKey, sword: drawSword, shield: drawShield, torch: drawTorch };

  function drawEnemyAt(type, x, y, now, seed, flashed) {
    ox = x; oy = y; flashing = !!flashed;
    (ENEMY_DRAW[type] || drawSlime)(now, seed);
    flashing = false;
  }

  function drawItemAt(type, x, y, now, seed) {
    var fn = ITEM_DRAW[type];
    if (!fn) return;
    ox = x; oy = y; flashing = false;
    fn(now, seed);
  }

  function drawHeroAt(x, y, facing, now, flashed) {
    ox = x; oy = y; flashing = !!flashed;
    drawHero(now, facing || 'down');
    flashing = false;
  }

  // Animated exit portal, drawn on top of the cached exit tile.
  function drawExitGlow(T, x, y, now) {
    var cx = x + T / 2, cy = y + T / 2;
    var p = (Math.sin(now * 0.004) + 1) / 2;
    g.fillStyle = 'rgba(70,255,190,' + (0.10 + 0.14 * p).toFixed(3) + ')';
    g.beginPath();
    g.arc(cx, cy, 9 + 4 * p, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(120,255,215,' + (0.45 + 0.4 * p).toFixed(3) + ')';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 7 + 2 * p, 0, TAU);
    g.stroke();
    g.fillStyle = '#d8fff2';
    g.fillRect(cx - 1, cy - 1, 2, 2);
  }

  // Minimap colour for an explored tile, or null to leave it blank.
  function mmColor(t, TT) {
    switch (t) {
      case TT.FLOOR:
      case TT.DOOR_OPEN:
      case TT.SPIKES:
        return [134, 139, 152];
      case TT.DOOR_LOCKED:
        return [176, 122, 58];
      case TT.STAIRS:
        return [242, 209, 107];
      case TT.EXIT:
        return [90, 255, 192];
      default:
        return null;
    }
  }

  // ===========================================================================
  // Renderer
  // ===========================================================================

  DE.Renderer = class {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      this._pos = new Map();      // tween state: key -> {x, y}
      this._sprites = null;
      this._spriteT = 0;
      this._mmCanvas = null;
      this._mmCtx = null;
      this._mmImg = null;
      this._mmW = 0;
      this._mmH = 0;
    }

    reset() {
      this._pos = new Map();
    }

    _ensureSprites(T) {
      if (!this._sprites || this._spriteT !== T) {
        this._sprites = buildSprites(T);
        this._spriteT = T;
      }
      return this._sprites;
    }

    _ensureMinimap(fw, fh) {
      if (this._mmCanvas && this._mmW === fw && this._mmH === fh) return;
      this._mmCanvas = document.createElement('canvas');
      this._mmCanvas.width = fw;
      this._mmCanvas.height = fh;
      this._mmCtx = this._mmCanvas.getContext('2d');
      this._mmImg = this._mmCtx.createImageData(fw, fh);
      this._mmW = fw;
      this._mmH = fh;
    }

    _tileSprite(S, t, tx, ty, floor) {
      var TT = DE.T;
      switch (t) {
        case TT.WALL: {
          var below = DE.tileAt(floor, tx, ty + 1);
          var v = hash2(tx, ty) & 1;
          return S.walls[v * 2 + (DE.isWalkable(below) ? 1 : 0)];
        }
        case TT.DOOR_LOCKED: return S.locked;
        case TT.DOOR_OPEN: return S.open;
        case TT.STAIRS: return S.stairs;
        case TT.EXIT: return S.exit;
        case TT.SPIKES: return S.spikes[hash2(tx, ty) & 3];
        default: return S.floors[hash2(tx, ty) & 3];
      }
    }

    draw(state) {
      var ctx = this.ctx, canvas = this.canvas;
      var cfg = DE.CONFIG, T = cfg.TILE;
      var W = canvas.width, H = canvas.height;
      // The viewport follows the canvas size (the game may shrink it, e.g. 15x15 tiles on phones).
      var VW = Math.max(1, Math.floor(W / T)), VH = Math.max(1, Math.floor(H / T));
      g = ctx;
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      if (!state || !state.floor) return;
      var floor = state.floor;
      var fw = floor.width, fh = floor.height, tiles = floor.tiles;
      if (!fw || !fh || !tiles) return;
      var TT = DE.T;
      var now = (typeof state.now === 'number') ? state.now : performance.now();
      var S = this._ensureSprites(T);
      var visible = state.visible || null;
      var explored = state.explored || null;
      var player = state.player || null;
      var enemies = state.enemies || [];
      var items = state.items || [];
      var fov = (typeof state.fov === 'number') ? state.fov : cfg.FOV_RADIUS;

      function visAt(x, y) {
        return !!(visible && x >= 0 && y >= 0 && x < fw && y < fh && visible[y * fw + x]);
      }

      // ---- tweening: every tracked entity keeps a display position -----------
      var next = new Map();
      var self = this;
      function track(key, tx, ty) {
        var c = self._pos.get(key);
        if (!c) {
          c = { x: tx, y: ty };
        } else {
          c.x += (tx - c.x) * 0.35;
          c.y += (ty - c.y) * 0.35;
          if (Math.abs(tx - c.x) < 0.01) c.x = tx;
          if (Math.abs(ty - c.y) < 0.01) c.y = ty;
        }
        next.set(key, c);
        return c;
      }
      var pd = player ? track('p:player', player.x, player.y) : null;
      var focusX = pd ? pd.x : fw / 2;
      var focusY = pd ? pd.y : fh / 2;

      // ---- camera ----------------------------------------------------------
      var camX = focusX + 0.5 - VW / 2;
      var camY = focusY + 0.5 - VH / 2;
      var maxX = fw - VW, maxY = fh - VH;
      camX = maxX >= 0 ? clamp(camX, 0, maxX) : maxX / 2;
      camY = maxY >= 0 ? clamp(camY, 0, maxY) : maxY / 2;

      var shaking = typeof state.shakeUntil === 'number' && now < state.shakeUntil;
      var shX = shaking ? Math.round((Math.random() * 2 - 1) * 4) : 0;
      var shY = shaking ? Math.round((Math.random() * 2 - 1) * 4) : 0;
      var offX = Math.round(-camX * T) + shX;
      var offY = Math.round(-camY * T) + shY;

      var tx0 = Math.max(0, Math.floor(camX));
      var tx1 = Math.min(fw - 1, Math.floor(camX) + VW + 1);
      var ty0 = Math.max(0, Math.floor(camY));
      var ty1 = Math.min(fh - 1, Math.floor(camY) + VH + 1);

      // ---- pass 1: terrain (explored tiles), dimmed when not visible -------
      for (var ty = ty0; ty <= ty1; ty++) {
        for (var tx = tx0; tx <= tx1; tx++) {
          var i = ty * fw + tx;
          var isVis = !!(visible && visible[i]);
          var isExp = isVis || !!(explored && explored[i]);
          if (!isExp) continue;
          var t = tiles[i];
          var px = tx * T + offX, py = ty * T + offY;
          ctx.drawImage(this._tileSprite(S, t, tx, ty, floor), px, py);
          if (t === TT.EXIT) drawExitGlow(T, px, py, now);
          if (!isVis) {
            ctx.fillStyle = DIM;
            ctx.fillRect(px, py, T, T);
          }
        }
      }

      // ---- pass 2: items and enemies on visible tiles, then the player ------
      var hpBars = [];
      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        if (!it || !visAt(it.x, it.y)) continue;
        drawItemAt(it.type, it.x * T + offX, it.y * T + offY, now, (it.id | 0) * 1.3);
      }

      for (var j = 0; j < enemies.length; j++) {
        var e = enemies[j];
        if (!e) continue;
        var ec = track(e.id != null ? 'e:' + e.id : 'e#' + j, e.x, e.y);
        if (!visAt(e.x, e.y)) continue;
        var ex = Math.round(ec.x * T + offX), ey = Math.round(ec.y * T + offY);
        if (ex < -2 * T || ey < -2 * T || ex > W + T || ey > H + T) continue;
        var flashed = typeof e.flashUntil === 'number' && now < e.flashUntil;
        var seedE = (typeof e.id === 'number' ? e.id : j) * 1.7 + 0.5;
        drawEnemyAt(e.type, ex, ey, now, seedE, flashed);
        if (typeof e.hp === 'number' && typeof e.maxHp === 'number' && e.maxHp > 0 && e.hp < e.maxHp) {
          hpBars.push({ x: ex, y: ey, r: clamp(e.hp / e.maxHp, 0, 1) });
        }
      }

      if (player && pd) {
        var pxp = Math.round(pd.x * T + offX), pyp = Math.round(pd.y * T + offY);
        var pFlash = typeof player.flashUntil === 'number' && now < player.flashUntil;
        drawHeroAt(pxp, pyp, player.facing, now, pFlash);
      }

      // ---- pass 3: torch light on visible tiles ------------------------------
      // (a) one warm radial gradient centred on the player, added onto the
      //     visible tiles only ('lighter'), so the area near the player glows;
      // (b) a per-tile darkening that is zero within ~2 tiles and rises smoothly
      //     to ~80% at the edge of the fov.
      var reach = fov + 0.6;
      var pcx = focusX + 0.5, pcy = focusY + 0.5;
      var flick = 0.03 * Math.sin(now * 0.011) + 0.015 * Math.sin(now * 0.037);
      var glowX = pcx * T + offX, glowY = pcy * T + offY;
      var grad = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, reach * T);
      var ga = clamp(0.30 + flick, 0, 1);
      grad.addColorStop(0, 'rgba(255,150,60,' + ga.toFixed(3) + ')');
      grad.addColorStop(0.35, 'rgba(255,135,50,' + (ga * 0.75).toFixed(3) + ')');
      grad.addColorStop(0.7, 'rgba(255,110,40,' + (ga * 0.25).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,110,40,0)');
      ctx.fillStyle = grad;
      ctx.globalCompositeOperation = 'lighter';
      for (var ty2 = ty0; ty2 <= ty1; ty2++) {
        for (var tx2 = tx0; tx2 <= tx1; tx2++) {
          if (!(visible && visible[ty2 * fw + tx2])) continue;
          ctx.fillRect(tx2 * T + offX, ty2 * T + offY, T, T);
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      var inner = Math.min(2, fov * 0.4);            // full brightness radius (tiles)
      var span = Math.max(0.5, reach - inner);
      for (var ty3 = ty0; ty3 <= ty1; ty3++) {
        for (var tx3 = tx0; tx3 <= tx1; tx3++) {
          var i3 = ty3 * fw + tx3;
          if (!(visible && visible[i3])) continue;
          var dx = tx3 + 0.5 - pcx, dy = ty3 + 0.5 - pcy;
          var u = clamp((Math.sqrt(dx * dx + dy * dy) - inner) / span, 0, 1);
          if (u <= 0) continue;
          var dark = u * u * (3 - 2 * u) * 0.8;
          var ph = (hash2(tx3, ty3) & 1023) / 1024 * TAU;
          dark += u * (0.02 * Math.sin(now * 0.011 + ph));   // subtle flicker at the edge
          dark = clamp(dark, 0, 0.85);
          var sk = Math.round(dark * 40);
          if (sk > 0) {
            ctx.fillStyle = shadeStr(sk);
            ctx.fillRect(tx3 * T + offX, ty3 * T + offY, T, T);
          }
        }
      }

      // ---- pass 4: HP bars over damaged visible enemies ----------------------
      for (var hb = 0; hb < hpBars.length; hb++) {
        var bar = hpBars[hb];
        var bx = bar.x + 4, by = bar.y + 1, bw = T - 8, bh = 3;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = bar.r > 0.5 ? '#6bd66b' : (bar.r > 0.25 ? '#e6c24a' : '#e0463a');
        ctx.fillRect(bx, by, Math.round(bw * bar.r), bh);
      }

      // ---- pass 5: floating text ---------------------------------------------
      var effects = state.effects || [];
      if (effects.length) {
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#0b0a0d';
        for (var fi = 0; fi < effects.length; fi++) {
          var f = effects[fi];
          if (!f || typeof f.born !== 'number') continue;
          var ttl = f.ttl > 0 ? f.ttl : 900;
          var age = now - f.born;
          if (age < 0 || age >= ttl) continue;
          var p = age / ttl;
          var fx = f.x * T + T / 2 + offX;
          var fy = f.y * T + T / 2 + offY - p * 20;
          ctx.globalAlpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
          var txt = String(f.text == null ? '' : f.text);
          ctx.strokeText(txt, fx, fy);
          ctx.fillStyle = f.color || '#ffffff';
          ctx.fillText(txt, fx, fy);
        }
        ctx.globalAlpha = 1;
      }

      // ---- pass 6: minimap top-right -----------------------------------------
      var MM = W < 600 ? 2 : 3;   // smaller minimap on a small (phone) canvas
      var mw = fw * MM, mh = fh * MM;
      var mx = W - mw - 12, my = 12;
      ctx.fillStyle = 'rgba(8,8,12,0.72)';
      ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
      ctx.strokeStyle = 'rgba(255,170,90,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - 4.5, my - 4.5, mw + 9, mh + 9);

      this._ensureMinimap(fw, fh);
      var md = this._mmImg.data;
      md.fill(0);
      if (explored) {
        for (var mi = 0; mi < fw * fh; mi++) {
          if (!explored[mi]) continue;
          var col = mmColor(tiles[mi], TT);
          if (!col) continue;
          var o = mi * 4;
          md[o] = col[0]; md[o + 1] = col[1]; md[o + 2] = col[2]; md[o + 3] = 255;
        }
      }
      this._mmCtx.putImageData(this._mmImg, 0, 0);
      ctx.drawImage(this._mmCanvas, mx, my, mw, mh);
      if (player) {
        var dotX = mx + player.x * MM, dotY = my + player.y * MM;
        ctx.fillStyle = 'rgba(255,210,110,0.35)';
        ctx.fillRect(dotX - 1, dotY - 1, MM + 2, MM + 2);
        ctx.fillStyle = '#fff6d6';
        ctx.fillRect(dotX, dotY, MM, MM);
      }

      // keep only tween entries for entities that still exist
      this._pos = next;
    }
  };
})(window.DE);
