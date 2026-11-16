window.DE = window.DE || {};
(function (DE) {
  'use strict';

  var BEST_KEY = 'dungeonEscape.best';
  var REPEAT_MS = 110;
  var FLASH_MS = 120;
  var SHAKE_MS = 150;
  var EFFECT_TTL = 900;
  var BANNER_MS = 1200;
  var WANDER_CHANCE = 0.3;
  var STAIR_HEAL = 5;
  var SPIKE_DAMAGE = 2;
  var MUTE_ON = '\u{1F50A}';
  var MUTE_OFF = '\u{1F507}';
  var DIR_NAMES = ['up', 'down', 'left', 'right'];
  var DOM_IDS = [
    'game-canvas', 'hud-hp-fill', 'hud-hp-text', 'hud-floor', 'hud-gold', 'hud-keys',
    'hud-atk', 'hud-def', 'hud-turns', 'hud-kills', 'log',
    'overlay-title', 'overlay-dead', 'overlay-win', 'overlay-floor', 'floor-banner-text',
    'dead-stats', 'win-stats', 'best-score', 'dpad', 'btn-mute',
    'btn-start', 'btn-retry', 'btn-again'
  ];
  var COLOR_HURT = '#ff5555';
  var COLOR_HEAL = '#6fe06f';
  var COLOR_GOLD = '#ffd34d';
  var COLOR_INFO = '#ffffff';

  function now() {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function cfg(key, fallback) {
    return (DE.CONFIG && DE.CONFIG[key] !== undefined) ? DE.CONFIG[key] : fallback;
  }

  function byId(id) {
    try {
      return (typeof document !== 'undefined' && document.getElementById(id)) || null;
    } catch (e) {
      return null;
    }
  }

  function readBest() {
    try {
      var n = parseInt(window.localStorage.getItem(BEST_KEY), 10);
      return (isFinite(n) && n > 0) ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function writeBest(value) {
    try {
      window.localStorage.setItem(BEST_KEY, String(value));
    } catch (e) {
      /* storage unavailable: best score just lasts this page load */
    }
  }

  function raf(fn) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(fn);
    } else {
      setTimeout(fn, 16);
    }
  }

  function article(name) {
    return /^[aeiou]/i.test(name) ? 'an ' : 'a ';
  }

  DE.Game = class {
    constructor() {
      this.mode = 'title';          // 'title' | 'playing' | 'dead' | 'won'
      this.player = null;
      this.enemies = [];
      this.items = [];
      this.floor = null;
      this.level = 1;
      this.visible = null;
      this.explored = null;
      this.effects = [];
      this.shakeUntil = 0;
      this.kills = 0;
      this.turns = 0;
      this.won = false;
      this.killer = null;           // { kind: 'spikes' } or { kind: 'enemy', name }
      this.seed = 1;
      this.rng = DE.makeRng(1);
      this.best = 0;
      this.messages = [];
      this.renderer = null;
      this.dom = {};
      this.nextId = 1;
      this.lastInputAt = -Infinity;
      this.bannerTimer = null;
      this.audioUnlocked = false;
      this.initialized = false;
    }

    // ----- setup -----------------------------------------------------------

    init() {
      if (this.initialized) return;
      this.initialized = true;
      var self = this;

      DOM_IDS.forEach(function (id) { self.dom[id] = byId(id); });

      var canvas = this.dom['game-canvas'];
      this.fitCanvas();
      if (canvas && DE.Renderer) this.renderer = new DE.Renderer(canvas);

      this.best = readBest();
      this.setText('best-score', String(this.best));
      this.setMuteText();

      this.mode = 'title';
      this.seed = Date.now();
      this.rng = DE.makeRng(this.seed);
      this.player = this.makePlayer();
      this.level = 1;
      this.loadFloor(1);            // backdrop behind the title overlay (no banner/log)
      // Title backdrop: show the whole floor dimly, with FOV around the start.
      // Enemies and the turn counter do not change here (act() ignores non-playing modes).
      if (this.explored) this.explored.fill(1);
      this.updateFov();

      this.showOverlay('title', true);
      this.showOverlay('dead', false);
      this.showOverlay('win', false);
      this.showOverlay('floor', false);
      this.updateHud();

      this.bindInput();
      this.bindResize();
      this.loop();
    }

    // Phones get a bigger share of the screen: 15x15 tiles. Otherwise 25x17 tiles.
    // Assigning width/height clears the canvas, so only assign when the size changes.
    fitCanvas() {
      var canvas = this.dom['game-canvas'];
      if (!canvas) return;
      var tile = cfg('TILE', 32);
      var narrow = typeof window !== 'undefined' && window.innerWidth < 600;
      var w, h;
      if (narrow) {
        w = 15 * tile;
        h = 15 * tile;
      } else {
        w = cfg('VIEW_W', 25) * tile;
        h = cfg('VIEW_H', 17) * tile;
      }
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    }

    bindResize() {
      var self = this;
      var pending = null;
      var refit = function () {
        if (pending) clearTimeout(pending);
        pending = setTimeout(function () {
          pending = null;
          self.fitCanvas();
        }, 150);
      };
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('resize', refit);
        window.addEventListener('orientationchange', refit);
      }
    }

    makePlayer() {
      var b = DE.PLAYER_BASE || {};
      return {
        id: 'player',
        x: 0, y: 0,
        hp: b.hp || 20,
        maxHp: b.maxHp || 20,
        atk: b.atk || 3,
        def: b.def || 0,
        fov: b.fov || cfg('FOV_RADIUS', 5),
        facing: 'down',
        flashUntil: 0,
        gold: 0,
        keys: 0
      };
    }

    bindInput() {
      var self = this;

      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('keydown', function (e) { self.onKeyDown(e); });
      }

      var click = function (id, fn) {
        var el = self.dom[id];
        if (el && el.addEventListener) el.addEventListener('click', fn);
      };
      click('btn-start', function () { self.newRun(); });
      click('btn-retry', function () { self.newRun(); });
      click('btn-again', function () { self.newRun(); });
      click('btn-mute', function () { self.toggleMute(); });

      if (typeof document !== 'undefined' && document.querySelectorAll) {
        var buttons = document.querySelectorAll('#dpad button[data-dir]') || [];
        Array.prototype.forEach.call(buttons, function (btn) {
          var dir = btn.dataset ? btn.dataset.dir : null;
          if (!dir || !btn.addEventListener) return;
          btn.addEventListener('pointerdown', function (e) {
            if (e && e.preventDefault) e.preventDefault();
            self.unlockAudio();
            self.handleInput(dir);
          });
        });
      }
    }

    loop() {
      var self = this;
      var step = function () {
        try {
          self.frame();
        } finally {
          raf(step);
        }
      };
      raf(step);
    }

    // ----- runs and floors -------------------------------------------------

    newRun() {
      this.seed = Date.now();
      this.rng = DE.makeRng(this.seed);
      this.mode = 'playing';
      this.player = this.makePlayer();
      this.kills = 0;
      this.turns = 0;
      this.won = false;
      this.killer = null;
      this.effects = [];
      this.shakeUntil = 0;
      this.level = 1;
      this.clearLog();
      this.showOverlay('title', false);
      this.showOverlay('dead', false);
      this.showOverlay('win', false);
      this.log('Welcome, adventurer. Reach the exit on floor ' + cfg('FLOORS', 5) + '.', 'info');
      this.loadFloor(1);
    }

    loadFloor(level) {
      var f = DE.generateFloor(level, this.seed + level * 7919);
      this.floor = f;
      this.level = level;
      this.enemies = [];
      this.items = [];

      var self = this;
      (f.enemies || []).forEach(function (s) {
        var def = DE.ENEMIES[s.type];
        if (!def) return;
        self.enemies.push({
          id: self.nextId++, type: s.type, x: s.x, y: s.y,
          hp: def.hp, maxHp: def.hp, flashUntil: 0
        });
      });
      (f.items || []).forEach(function (s) {
        if (!DE.ITEMS[s.type]) return;
        var item = { id: self.nextId++, type: s.type, x: s.x, y: s.y };
        if (s.amount !== undefined) item.amount = s.amount;
        self.items.push(item);
      });

      this.player.x = f.start.x;
      this.player.y = f.start.y;
      this.explored = new Uint8Array(f.width * f.height);
      this.visible = null;
      if (this.renderer && this.renderer.reset) this.renderer.reset();
      this.updateFov();
      this.updateHud();

      if (this.mode === 'playing') {
        var last = level >= cfg('FLOORS', 5);
        var goal = last ? 'the exit.' : 'the way down.';
        var hint = f.door ? 'Find the key and ' + goal : 'Find ' + goal;
        this.log('Floor ' + level + '. ' + hint, 'info');
        this.showFloorBanner(level);
      }
    }

    showFloorBanner(level) {
      var last = level >= cfg('FLOORS', 5);
      this.setText('floor-banner-text', last ? 'Final Floor' : 'Floor ' + level);
      this.showOverlay('floor', true);
      var self = this;
      if (this.bannerTimer) clearTimeout(this.bannerTimer);
      this.bannerTimer = setTimeout(function () {
        self.bannerTimer = null;
        self.showOverlay('floor', false);
      }, BANNER_MS);
      if (this.bannerTimer && this.bannerTimer.unref) this.bannerTimer.unref();
    }

    // ----- input -----------------------------------------------------------

    onKeyDown(e) {
      if (!e) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.unlockAudio();

      var key = e.key;
      var action = null;
      switch (key) {
        case 'ArrowUp': case 'w': case 'W': action = 'up'; break;
        case 'ArrowDown': case 's': case 'S': action = 'down'; break;
        case 'ArrowLeft': case 'a': case 'A': action = 'left'; break;
        case 'ArrowRight': case 'd': case 'D': action = 'right'; break;
        case ' ': case 'Spacebar': case '.': action = 'wait'; break;
        case 'm': case 'M':
          this.toggleMute();
          return;
        case 'Enter':
          // A focused button fires its own click for Enter; avoid a double start.
          if (e.target && e.target.tagName === 'BUTTON') return;
          if (this.mode !== 'playing') this.newRun();
          return;
        default:
          return;
      }

      if (e.preventDefault) e.preventDefault();
      this.handleInput(action);
    }

    // Shared by keyboard and D-pad: throttled, playing only.
    handleInput(dir) {
      if (this.mode !== 'playing') return false;
      var t = now();
      if (t - this.lastInputAt < REPEAT_MS) return false;
      this.lastInputAt = t;
      return this.act(dir);
    }

    // Public: one player action. dir is 'up'|'down'|'left'|'right'|'wait'.
    act(dir) {
      if (this.mode !== 'playing' || !this.player || !this.floor) return false;
      if (dir !== 'wait' && !DE.DIRS[dir]) return false;
      return this.playerAction(dir);
    }

    unlockAudio() {
      if (this.audioUnlocked) return;
      this.audioUnlocked = true;
      if (DE.audio && DE.audio.unlock) DE.audio.unlock();
    }

    toggleMute() {
      if (!DE.audio || !DE.audio.toggleMute) return;
      var muted = DE.audio.toggleMute();
      this.setMuteText(muted);
    }

    setMuteText(muted) {
      if (muted === undefined) {
        muted = !!(DE.audio && DE.audio.isMuted && DE.audio.isMuted());
      }
      var el = this.dom['btn-mute'];
      if (el) el.textContent = muted ? MUTE_OFF : MUTE_ON;
    }

    // ----- turn rules ------------------------------------------------------

    playerAction(dir) {
      var p = this.player;
      var f = this.floor;
      var passed = false;
      var descended = false;
      var reachedExit = false;

      if (dir === 'wait') {
        passed = true;
      } else {
        var d = DE.DIRS[dir];
        p.facing = dir;
        var nx = p.x + d.x;
        var ny = p.y + d.y;
        var foe = this.enemyAt(nx, ny);

        if (foe) {
          this.attackEnemy(foe);
          passed = true;
        } else {
          var t = DE.tileAt(f, nx, ny);
          if (t === DE.T.DOOR_LOCKED) {
            if (p.keys <= 0) {
              this.log('The door is locked. Find the key.', 'bad');
              this.playSound('locked');
              return false;
            }
            p.keys--;
            DE.setTile(f, nx, ny, DE.T.DOOR_OPEN);
            this.log('You unlock the door with a key.', 'good');
            this.playSound('door');
            passed = true;
          } else if (!DE.isWalkable(t)) {
            return false;   // walls and other solid tiles: nothing happens
          } else {
            p.x = nx;
            p.y = ny;
            this.playSound('step');
            passed = true;
            var result = this.enterTile();
            if (result === 'descend') descended = true;
            if (result === 'exit') reachedExit = true;
          }
        }
      }

      if (!passed) return false;

      this.turns++;

      if (reachedExit) {
        this.updateFov();
        this.endRun(true);
        return true;
      }

      // A stair descent replaced the enemy list, so the old floor's enemies do not act.
      if (!descended && p.hp > 0 && this.mode === 'playing') this.enemyPhase();

      this.updateFov();
      this.updateHud();

      if (p.hp <= 0 && this.mode === 'playing') this.endRun(false);
      return true;
    }

    // Effects of stepping onto the player's current tile. Returns 'descend', 'exit' or null.
    enterTile() {
      var p = this.player;
      var f = this.floor;

      var item = this.itemAt(p.x, p.y);
      if (item) {
        this.removeItem(item);
        this.pickup(item);
      }

      var t = DE.tileAt(f, p.x, p.y);
      if (t === DE.T.SPIKES) {
        this.hurtPlayer(SPIKE_DAMAGE, 'spikes');
        this.log('You step on spikes. -' + SPIKE_DAMAGE + ' HP.', 'bad');
        this.playSound('trap');
        return null;
      }
      if (t === DE.T.STAIRS) {
        var healed = Math.min(STAIR_HEAL, p.maxHp - p.hp);
        p.hp += healed;
        this.playSound('stairs');
        this.log('You descend the stairs. +' + healed + ' HP.', 'good');
        this.loadFloor(this.level + 1);
        return 'descend';
      }
      if (t === DE.T.EXIT) return 'exit';
      return null;
    }

    pickup(item) {
      var p = this.player;
      var def = DE.ITEMS[item.type] || { name: item.type };
      switch (item.type) {
        case 'potion': {
          var before = p.hp;
          p.hp = Math.min(p.maxHp, p.hp + (def.heal || 0));
          var healed = p.hp - before;
          this.log('You drink a Health Potion. +' + healed + ' HP.', 'loot');
          this.addEffect(p.x, p.y, '+' + healed, COLOR_HEAL);
          this.playSound('potion');
          break;
        }
        case 'gold': {
          var amount = item.amount || 0;
          p.gold += amount;
          this.log('You pick up ' + amount + ' gold.', 'loot');
          this.addEffect(p.x, p.y, '+' + amount, COLOR_GOLD);
          this.playSound('pickup');
          break;
        }
        case 'key':
          p.keys++;
          this.log('You find a key.', 'loot');
          this.addEffect(p.x, p.y, 'KEY', COLOR_GOLD);
          this.playSound('key');
          break;
        case 'sword':
          p.atk += def.atk || 1;
          this.log('You take up a Sword. ATK +' + (def.atk || 1) + '.', 'loot');
          this.addEffect(p.x, p.y, 'ATK+', COLOR_INFO);
          this.playSound('pickup');
          break;
        case 'shield':
          p.def += def.def || 1;
          this.log('You strap on a Shield. DEF +' + (def.def || 1) + '.', 'loot');
          this.addEffect(p.x, p.y, 'DEF+', COLOR_INFO);
          this.playSound('pickup');
          break;
        case 'torch':
          p.fov = Math.min(cfg('MAX_FOV', 8), p.fov + (def.fov || 1));
          this.log('You light a Torch. Light radius ' + p.fov + '.', 'loot');
          this.addEffect(p.x, p.y, 'LIGHT+', COLOR_INFO);
          this.playSound('pickup');
          break;
        default:
          this.log('You pick up a ' + def.name + '.', 'loot');
          this.playSound('pickup');
      }
    }

    attackEnemy(e) {
      var p = this.player;
      var def = DE.ENEMIES[e.type] || { name: e.type, def: 0, gold: [0, 0] };
      var dmg = Math.max(1, p.atk + this.rng.int(-1, 1) - (def.def || 0));
      e.hp -= dmg;
      e.flashUntil = now() + FLASH_MS;
      this.addEffect(e.x, e.y, '-' + dmg, COLOR_HURT);

      if (e.hp > 0) {
        this.playSound('hit');
        this.log('You hit the ' + def.name + ' for ' + dmg + '.', 'info');
        return;
      }

      this.removeEnemy(e);
      this.kills++;
      this.playSound('kill');
      this.log('You slay the ' + def.name + '.', 'good');

      var gold = def.gold ? this.rng.int(def.gold[0], def.gold[1]) : 0;
      if (gold > 0) {
        p.gold += gold;
        this.addEffect(e.x, e.y, '+' + gold, COLOR_GOLD);
      }
    }

    enemyPhase() {
      var self = this;
      this.enemies.slice().forEach(function (e) {
        if (self.mode !== 'playing' || self.player.hp <= 0) return;
        if (self.enemies.indexOf(e) < 0) return;   // removed earlier this phase
        self.enemyAct(e);
      });
    }

    enemyAct(e) {
      var def = DE.ENEMIES[e.type];
      if (!def) return;
      var p = this.player;
      var dx = p.x - e.x;
      var dy = p.y - e.y;
      var dist = Math.abs(dx) + Math.abs(dy);

      if (dist === 1) {
        this.enemyAttack(e, def);
        return;
      }
      if (def.erratic > 0 && this.rng.chance(def.erratic)) {
        this.wander(e);
        return;
      }
      if (dist <= def.sight) {
        this.chase(e, dx, dy);
        return;
      }
      if (this.rng.chance(WANDER_CHANCE)) this.wander(e);
    }

    enemyAttack(e, def) {
      var p = this.player;
      var dmg = Math.max(1, def.atk + this.rng.int(-1, 1) - (p.def || 0));
      e.flashUntil = now() + FLASH_MS;
      this.log('The ' + def.name + ' hits you for ' + dmg + '.', 'bad');
      this.hurtPlayer(dmg, 'enemy', def.name);
      this.playSound('hurt');
    }

    hurtPlayer(dmg, kind, name) {
      var p = this.player;
      p.hp -= dmg;
      p.flashUntil = now() + FLASH_MS;
      this.shakeUntil = now() + SHAKE_MS;
      this.addEffect(p.x, p.y, '-' + dmg, COLOR_HURT);
      this.killer = kind === 'spikes' ? { kind: 'spikes' } : { kind: 'enemy', name: name };
    }

    wander(e) {
      var d = DE.DIRS[this.rng.pick(DIR_NAMES)];
      var x = e.x + d.x;
      var y = e.y + d.y;
      if (this.canEnemyEnter(x, y, e)) {
        e.x = x;
        e.y = y;
        return true;
      }
      return false;
    }

    chase(e, dx, dy) {
      var sx = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
      var sy = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
      var moves = Math.abs(dx) >= Math.abs(dy)
        ? [[sx, 0], [0, sy]]
        : [[0, sy], [sx, 0]];
      for (var i = 0; i < moves.length; i++) {
        var mx = moves[i][0], my = moves[i][1];
        if (mx === 0 && my === 0) continue;
        if (this.canEnemyEnter(e.x + mx, e.y + my, e)) {
          e.x += mx;
          e.y += my;
          return true;
        }
      }
      return false;
    }

    canEnemyEnter(x, y, self) {
      var f = this.floor;
      if (!DE.inBounds(f, x, y)) return false;
      var t = DE.tileAt(f, x, y);
      if (t === DE.T.DOOR_LOCKED || !DE.isWalkable(t)) return false;
      if (this.player.x === x && this.player.y === y) return false;
      for (var i = 0; i < this.enemies.length; i++) {
        var o = this.enemies[i];
        if (o !== self && o.x === x && o.y === y) return false;
      }
      return true;
    }

    endRun(won) {
      var p = this.player;
      this.won = !!won;
      this.mode = won ? 'won' : 'dead';
      if (this.bannerTimer) {
        clearTimeout(this.bannerTimer);
        this.bannerTimer = null;
      }
      this.showOverlay('floor', false);

      var score = this.score();
      var newBest = score > this.best;
      if (newBest) {
        this.best = score;
        writeBest(score);
      }
      this.setText('best-score', String(this.best));

      var stats = 'Gold ' + p.gold + ' · Kills ' + this.kills +
        ' · Turns ' + this.turns + ' · Score ' + score +
        ' · Best ' + this.best + (newBest ? ' (new!)' : '');

      if (won) {
        this.log('You escape the dungeon!', 'good');
        this.playSound('win');
        this.setText('win-stats', stats);
        this.showOverlay('win', true);
      } else {
        var cause;
        if (this.killer && this.killer.kind === 'spikes') {
          cause = 'Killed by spikes on floor ' + this.level;
        } else if (this.killer && this.killer.name) {
          cause = 'Slain by ' + article(this.killer.name) + this.killer.name + ' on floor ' + this.level;
        } else {
          cause = 'Died on floor ' + this.level;
        }
        this.log('You have died. ' + cause + '.', 'bad');
        this.playSound('death');
        this.setText('dead-stats', cause + ' — ' + stats);
        this.showOverlay('dead', true);
      }
    }

    score() {
      var p = this.player || { gold: 0 };
      return (p.gold || 0) + this.kills * 10 + (this.level - 1) * 100 + (this.won ? 1000 : 0);
    }

    // ----- world queries and state helpers ---------------------------------

    enemyAt(x, y) {
      for (var i = 0; i < this.enemies.length; i++) {
        if (this.enemies[i].x === x && this.enemies[i].y === y) return this.enemies[i];
      }
      return null;
    }

    itemAt(x, y) {
      for (var i = 0; i < this.items.length; i++) {
        if (this.items[i].x === x && this.items[i].y === y) return this.items[i];
      }
      return null;
    }

    removeItem(item) {
      var i = this.items.indexOf(item);
      if (i >= 0) this.items.splice(i, 1);
    }

    removeEnemy(e) {
      var i = this.enemies.indexOf(e);
      if (i >= 0) this.enemies.splice(i, 1);
    }

    updateFov() {
      var p = this.player;
      var f = this.floor;
      if (!p || !f || !DE.computeFOV) return;
      var size = f.width * f.height;
      this.visible = DE.computeFOV(f, p.x, p.y, p.fov);
      if (!this.explored || this.explored.length !== size) this.explored = new Uint8Array(size);
      for (var i = 0; i < this.visible.length && i < size; i++) {
        if (this.visible[i]) this.explored[i] = 1;
      }
    }

    addEffect(x, y, text, color) {
      this.effects.push({ x: x, y: y, text: String(text), color: color, born: now(), ttl: EFFECT_TTL });
    }

    playSound(name) {
      if (DE.audio && DE.audio.play) DE.audio.play(name);
    }

    // ----- DOM output ------------------------------------------------------

    setText(id, text) {
      var el = this.dom[id];
      if (el) el.textContent = String(text);
    }

    showOverlay(name, on) {
      var el = this.dom['overlay-' + name];
      if (!el || !el.classList) return;
      if (on) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }

    updateHud() {
      var p = this.player;
      if (!p) return;
      var pct = p.maxHp > 0 ? Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100)) : 0;
      var fill = this.dom['hud-hp-fill'];
      if (fill && fill.style) fill.style.width = pct + '%';
      this.setText('hud-hp-text', Math.max(0, p.hp) + ' / ' + p.maxHp);
      this.setText('hud-floor', this.level + ' / ' + cfg('FLOORS', 5));
      this.setText('hud-gold', p.gold);
      this.setText('hud-keys', p.keys);
      this.setText('hud-atk', p.atk);
      this.setText('hud-def', p.def);
      this.setText('hud-turns', this.turns);
      this.setText('hud-kills', this.kills);
    }

    log(text, type) {
      this.messages.push(text);
      if (this.messages.length > 50) this.messages.shift();

      var ul = this.dom.log;
      if (!ul || typeof document === 'undefined' || !document.createElement) return;
      var li = document.createElement('li');
      li.className = 'msg-' + (type || 'info');
      li.textContent = text;
      ul.appendChild(li);
      var max = cfg('LOG_LINES', 6);
      while (ul.children && ul.children.length > max) ul.removeChild(ul.children[0]);
    }

    clearLog() {
      this.messages = [];
      var ul = this.dom.log;
      if (!ul) return;
      while (ul.children && ul.children.length) ul.removeChild(ul.children[0]);
    }

    // ----- frame loop ------------------------------------------------------

    frame() {
      var t = now();
      this.effects = this.effects.filter(function (e) { return t - e.born < e.ttl; });
      if (!this.renderer || !this.floor || !this.player) return;
      this.renderer.draw({
        floor: this.floor,
        player: this.player,
        enemies: this.enemies,
        items: this.items,
        visible: this.visible,
        explored: this.explored,
        fov: this.player.fov,
        effects: this.effects,
        shakeUntil: this.shakeUntil,
        now: t
      });
    }
  };
})(window.DE);
