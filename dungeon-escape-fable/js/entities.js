window.DE = window.DE || {};

// Player, enemies, movement, combat, pickups, fog and particles.
// DE.CONFIG, DE.TILE, DE.isWalkable and DE.sfx live in other files and are
// only read inside functions, so load order does not matter.

(function () {
  'use strict';

  var ENEMY_COLORS = {
    slime: '#5ccc4a',
    bat: '#9b59d0',
    skeleton: '#e8e0c8'
  };
  var SPIKE_HURT_COLOR = '#ff5a4a';
  var HURT_COLOR = '#e03030';
  var HIT_COLOR = '#ffffff';
  var GOLD_COLOR = '#ffd34d';
  var DIRS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ];

  function playSfx(name) {
    try {
      if (typeof DE.sfx === 'function') DE.sfx(name);
    } catch (e) {
      // audio is optional; never let it break the game
    }
  }

  function randRange(a, b) {
    return a + Math.random() * (b - a);
  }

  function sign(v) {
    return v > 0 ? 1 : (v < 0 ? -1 : 0);
  }

  // Move cur toward target by at most maxStep, snapping when close.
  function tweenValue(cur, target, maxStep) {
    var d = target - cur;
    if (Math.abs(d) <= maxStep) return target;
    return cur + (d > 0 ? maxStep : -maxStep);
  }

  function inBounds(level, x, y) {
    return y >= 0 && y < level.tiles.length && x >= 0 && x < level.tiles[y].length;
  }

  function enemyAt(state, x, y, except) {
    var list = state.enemies || [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.alive && e !== except && e.x === x && e.y === y) return e;
    }
    return null;
  }

  function damagePlayer(state, amount, color) {
    var p = state.player, C = DE.CONFIG;
    if (p.hurtTimer > 0) return;
    p.hp = Math.max(0, p.hp - amount);
    p.hurtTimer = C.INVULN_TIME;
    state.shake = 0.25;
    DE.spawnParticles(state, p.x, p.y, color || HURT_COLOR, 8);
    playSfx('hurt');
    if (p.hp <= 0) {
      p.hp = 0;
      state.screen = 'gameover';
      playSfx('death');
    }
  }

  function attackEnemy(state, foe) {
    var p = state.player, C = DE.CONFIG;
    p.attackTimer = 0.15;
    foe.hp -= C.PLAYER_DAMAGE;
    foe.hurtTimer = 0.2;
    DE.spawnParticles(state, foe.x, foe.y, HIT_COLOR, 6);
    playSfx('hit');
    if (foe.hp <= 0) {
      foe.hp = 0;
      foe.alive = false;
      state.score += C.SCORE_KILL;
      DE.spawnParticles(state, foe.x, foe.y, ENEMY_COLORS[foe.type] || GOLD_COLOR, 14);
    }
    return 'attack';
  }

  function pickUp(state, x, y) {
    var level = state.level, p = state.player, C = DE.CONFIG;
    var items = level.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.taken || it.x !== x || it.y !== y) continue;
      it.taken = true;
      if (it.type === 'key') {
        p.hasKey = true;
        DE.addMessage(state, 'You found the key!');
        playSfx('key');
      } else if (it.type === 'potion') {
        p.hp = Math.min(p.maxHp, p.hp + C.POTION_HEAL);
        playSfx('pickup');
      } else if (it.type === 'coin') {
        p.coins += 1;
        state.score += C.SCORE_COIN;
        DE.spawnParticles(state, x, y, GOLD_COLOR, 4);
        playSfx('pickup');
      }
    }
  }

  // One enemy step (or attack) toward a target tile. Returns true if it acted.
  function tryEnemyStep(state, e, tx, ty) {
    var level = state.level, p = state.player;
    if (!inBounds(level, tx, ty)) return false;
    if (tx === p.x && ty === p.y) {
      damagePlayer(state, e.dmg, HURT_COLOR);
      return true;
    }
    if (!DE.isWalkable(level, tx, ty)) return false;
    if (enemyAt(state, tx, ty, e)) return false;
    e.x = tx;
    e.y = ty;
    return true;
  }

  function actEnemy(state, e) {
    var p = state.player;
    var ddx = p.x - e.x, ddy = p.y - e.y;
    var dist = Math.abs(ddx) + Math.abs(ddy);
    var cands = [];

    if (e.chaseRadius > 0 && dist <= e.chaseRadius) {
      // Prefer the axis with the larger distance, then the other axis.
      var xFirst = Math.abs(ddx) >= Math.abs(ddy);
      var primary = xFirst ? { dx: sign(ddx), dy: 0 } : { dx: 0, dy: sign(ddy) };
      var secondary = xFirst ? { dx: 0, dy: sign(ddy) } : { dx: sign(ddx), dy: 0 };
      if (primary.dx || primary.dy) cands.push(primary);
      if (secondary.dx || secondary.dy) cands.push(secondary);
    } else {
      cands.push(DIRS[Math.floor(Math.random() * DIRS.length)]);
    }

    for (var i = 0; i < cands.length; i++) {
      if (tryEnemyStep(state, e, e.x + cands[i].dx, e.y + cands[i].dy)) return;
    }
  }

  DE.createPlayer = function (level) {
    var C = DE.CONFIG;
    return {
      x: level.start.x,
      y: level.start.y,
      px: level.start.x,
      py: level.start.y,
      hp: C.PLAYER_MAX_HP,
      maxHp: C.PLAYER_MAX_HP,
      hasKey: false,
      coins: 0,
      facing: { dx: 0, dy: 1 },
      hurtTimer: 0,
      attackTimer: 0
    };
  };

  DE.createEnemies = function (level) {
    var types = DE.CONFIG.ENEMY_TYPES;
    var out = [];
    var spawns = level.enemySpawns || [];
    for (var i = 0; i < spawns.length; i++) {
      var s = spawns[i];
      var t = types[s.type];
      if (!t) continue;
      out.push({
        type: s.type,
        x: s.x,
        y: s.y,
        px: s.x,
        py: s.y,
        hp: t.hp,
        maxHp: t.hp,
        dmg: t.dmg,
        moveInterval: t.moveInterval,
        chaseRadius: t.chaseRadius,
        moveTimer: Math.random() * t.moveInterval,
        hurtTimer: 0,
        alive: true
      });
    }
    return out;
  };

  DE.addMessage = function (state, text) {
    if (!state.messages) state.messages = [];
    state.messages.push({ text: text, ttl: 2.5 });
    while (state.messages.length > 4) state.messages.shift();
  };

  DE.spikesActive = function (state) {
    return Math.floor(state.time) % 2 === 0;
  };

  DE.revealFog = function (state) {
    var level = state.level, p = state.player;
    if (!level || !p) return;
    var R = DE.CONFIG.SIGHT_RADIUS;
    var r2 = R * R;
    var y0 = Math.max(0, p.y - R), y1 = Math.min(level.tiles.length - 1, p.y + R);
    for (var y = y0; y <= y1; y++) {
      var x0 = Math.max(0, p.x - R), x1 = Math.min(level.tiles[y].length - 1, p.x + R);
      for (var x = x0; x <= x1; x++) {
        var dx = x - p.x, dy = y - p.y;
        if (dx * dx + dy * dy <= r2) level.seen[y][x] = true;
      }
    }
  };

  // x, y are tile coordinates (top-left corner of the tile); particles spawn at the tile centre.
  DE.spawnParticles = function (state, x, y, color, count) {
    if (!state.particles) state.particles = [];
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2;
      var spd = randRange(1, 2.5);
      var life = randRange(0.3, 0.6);
      state.particles.push({
        x: x + 0.5 + randRange(-0.1, 0.1),
        y: y + 0.5 + randRange(-0.1, 0.1),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: life,
        maxLife: life,
        color: color,
        size: randRange(2, 4)
      });
    }
  };

  DE.tryMovePlayer = function (state, dx, dy) {
    var p = state.player, level = state.level, T = DE.TILE;
    p.facing = { dx: dx, dy: dy };
    var nx = p.x + dx, ny = p.y + dy;
    if (!inBounds(level, nx, ny)) return 'blocked';

    var foe = enemyAt(state, nx, ny, null);
    if (foe) return attackEnemy(state, foe);

    if (level.tiles[ny][nx] === T.DOOR) {
      if (p.hasKey) {
        playSfx('door');
        return 'exit';
      }
      DE.addMessage(state, 'The door is locked');
      playSfx('locked');
      return 'locked';
    }

    if (!DE.isWalkable(level, nx, ny)) return 'blocked';

    p.x = nx;
    p.y = ny;
    pickUp(state, nx, ny);
    DE.revealFog(state);
    return 'moved';
  };

  DE.updateEntities = function (state, dt) {
    if (state.screen !== 'playing') return;
    var C = DE.CONFIG, T = DE.TILE;
    var p = state.player, level = state.level;
    var step = C.TWEEN_SPEED * dt;
    var i, e;

    // Tween rendered positions toward logical tiles.
    p.px = tweenValue(p.px, p.x, step);
    p.py = tweenValue(p.py, p.y, step);
    p.hurtTimer = Math.max(0, p.hurtTimer - dt);
    p.attackTimer = Math.max(0, p.attackTimer - dt);

    for (i = 0; i < state.enemies.length; i++) {
      e = state.enemies[i];
      e.px = tweenValue(e.px, e.x, step);
      e.py = tweenValue(e.py, e.y, step);
      e.hurtTimer = Math.max(0, e.hurtTimer - dt);
    }

    state.shake = Math.max(0, (state.shake || 0) - dt);

    if (state.messages) {
      for (i = 0; i < state.messages.length; i++) state.messages[i].ttl -= dt;
      state.messages = state.messages.filter(function (m) { return m.ttl > 0; });
    }

    if (state.particles) {
      var drag = Math.max(0, 1 - 3 * dt);
      for (i = 0; i < state.particles.length; i++) {
        var q = state.particles[i];
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vx *= drag;
        q.vy *= drag;
        q.life -= dt;
      }
      state.particles = state.particles.filter(function (q) { return q.life > 0; });
    }

    // Enemy AI on their own timers.
    var acting = state.enemies.slice();
    for (i = 0; i < acting.length; i++) {
      e = acting[i];
      if (!e.alive) continue;
      e.moveTimer -= dt;
      if (e.moveTimer > 0) continue;
      e.moveTimer = e.moveInterval;
      actEnemy(state, e);
      if (state.screen !== 'playing') return;
    }

    // Remove dead enemies.
    for (i = state.enemies.length - 1; i >= 0; i--) {
      if (!state.enemies[i].alive) state.enemies.splice(i, 1);
    }

    // Spikes.
    if (level.tiles[p.y][p.x] === T.SPIKES && DE.spikesActive(state)) {
      damagePlayer(state, C.PLAYER_DAMAGE, SPIKE_HURT_COLOR);
    }
  };
})();
