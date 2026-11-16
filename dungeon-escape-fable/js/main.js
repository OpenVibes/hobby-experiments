/* Dungeon Escape: state machine, input, game loop and HUD/overlay DOM. Owned by Agent D. */
window.DE = window.DE || {};

(function () {
  'use strict';

  var DE = window.DE;
  var BEST_KEY = 'dungeonEscape.bestScore';

  // Key names (lower-cased for letters) mapped to held-direction names.
  var KEYMAP = {
    ArrowUp: 'up', w: 'up',
    ArrowDown: 'down', s: 'down',
    ArrowLeft: 'left', a: 'left',
    ArrowRight: 'right', d: 'right'
  };
  var VEC = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 }
  };

  var state = DE.state = makeState();

  var ctx = null;
  var els = {};           // cached DOM elements
  var hudCache = {};      // last rendered HUD values
  var keyLit = null;      // last rendered key state
  var overlayCache = null;
  var logMsgs = [];       // message objects currently shown in the log
  var logEls = [];
  var logOpacity = [];

  var held = [];          // held directions, most recently pressed last
  var moveTimer = 0;      // seconds until the next held-key step
  var lastT = null;       // performance.now() of the previous frame, ms
  var best = 0;
  var endRecorded = false;

  function cfg() {
    return DE.CONFIG;
  }

  function makeState() {
    return {
      screen: 'title',
      floor: 1,
      level: null,
      player: null,
      enemies: [],
      time: 0,
      score: 0,
      messages: [],
      particles: [],
      shake: 0
    };
  }

  function sfx(name) {
    if (typeof DE.sfx === 'function') DE.sfx(name);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function fmtTime(seconds) {
    var total = Math.floor(seconds);
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
  }

  // ---- best score (localStorage, guarded) ----

  function loadBest() {
    try {
      var n = parseInt(window.localStorage.getItem(BEST_KEY), 10);
      return isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(n) {
    try {
      window.localStorage.setItem(BEST_KEY, String(n));
    } catch (e) {
      // storage unavailable: keep the best score for this session only
    }
  }

  // Records the best score once per finished game.
  function checkEnd() {
    if (endRecorded) return;
    if (state.screen !== 'gameover' && state.screen !== 'win') return;
    endRecorded = true;
    if (state.score > best) {
      best = state.score;
      saveBest(best);
    }
  }

  // ---- state machine ----

  function resetRun() {
    state.screen = 'title';
    state.floor = 1;
    state.level = null;
    state.player = null;
    state.enemies = [];
    state.time = 0;
    state.score = 0;
    state.messages = [];
    state.particles = [];
    state.shake = 0;
  }

  function startFloor(n) {
    var level = DE.generateLevel(n);
    // generateLevel may return null in theory; retry rather than crash on a missing level.
    for (var tries = 0; !level && tries < 50; tries++) level = DE.generateLevel(n);
    state.floor = n;
    state.level = level;

    if (n === 1 || !state.player) {
      state.player = DE.createPlayer(level);
    } else {
      // Later floors keep hp, maxHp and coins; the player is moved to the new start.
      var p = state.player;
      p.x = level.start.x;
      p.y = level.start.y;
      p.px = p.x;
      p.py = p.y;
      p.hasKey = false;
      p.hurtTimer = 0;
      p.attackTimer = 0;
    }

    state.enemies = DE.createEnemies(level);
    state.particles = [];
    DE.revealFog(state);
    DE.addMessage(state, 'Floor ' + n);
  }

  function newGame() {
    checkEnd();
    resetRun();
    endRecorded = false;
    held = [];
    moveTimer = 0;
    startFloor(1);
    state.screen = 'playing';
  }

  function onExit() {
    var n = state.floor;
    var c = cfg();
    state.score += c.SCORE_FLOOR;
    if (n >= c.FLOORS) {
      state.screen = 'win';
      sfx('win');
      return;
    }
    DE.addMessage(state, 'Floor ' + n + ' cleared');
    startFloor(n + 1);
  }

  function stepPlayer(dx, dy) {
    if (state.screen !== 'playing' || !state.player) return;
    var result = DE.tryMovePlayer(state, dx, dy);
    if (result === 'exit') onExit();
  }

  function togglePause() {
    if (state.screen === 'playing') {
      state.screen = 'paused';
    } else if (state.screen === 'paused') {
      state.screen = 'playing';
    } else {
      return;
    }
    held = [];
    moveTimer = 0;
  }

  // ---- input ----

  function keyName(e) {
    var k = e.key || '';
    return k.length === 1 ? k.toLowerCase() : k;
  }

  function onKeyDown(e) {
    var name = keyName(e);
    var dir = KEYMAP[name];
    var isSpace = e.key === ' ' || e.code === 'Space';

    // Stop arrows and space from scrolling the page.
    if (name.indexOf('Arrow') === 0 || isSpace) e.preventDefault();

    if (e.repeat) return;

    if (dir) {
      if (state.screen !== 'playing') return;
      var i = held.indexOf(dir);
      if (i !== -1) held.splice(i, 1);
      held.push(dir);
      stepPlayer(VEC[dir].dx, VEC[dir].dy);
      moveTimer = cfg().PLAYER_MOVE_DELAY;
      return;
    }

    if (name === 'Enter' || isSpace) {
      if (state.screen === 'title' || state.screen === 'gameover' || state.screen === 'win') {
        newGame();
      }
      return;
    }

    if (name === 'p' || name === 'Escape') {
      togglePause();
    }
  }

  function onKeyUp(e) {
    var dir = KEYMAP[keyName(e)];
    if (!dir) return;
    var i = held.indexOf(dir);
    if (i !== -1) held.splice(i, 1);
  }

  function clearHeld() {
    held = [];
    moveTimer = 0;
  }

  // ---- game loop ----

  function frame() {
    requestAnimationFrame(frame);

    var now = performance.now();
    var dt = 0;
    if (lastT !== null) {
      dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    }
    lastT = now;

    if (state.screen === 'playing') {
      state.time += dt;

      if (held.length) {
        moveTimer -= dt;
        if (moveTimer <= 0) {
          moveTimer += cfg().PLAYER_MOVE_DELAY;
          var d = VEC[held[held.length - 1]];
          stepPlayer(d.dx, d.dy);
        }
      }

      if (state.screen === 'playing') {
        DE.updateEntities(state, dt);
      }
    }

    checkEnd();
    DE.render(ctx, state);
    updateHud();
    updateMessages();
    updateOverlay();
  }

  // ---- DOM: HUD, message log, overlay (only writes when a value changed) ----

  function setHud(key, value) {
    var text = String(value);
    if (hudCache[key] === text) return;
    hudCache[key] = text;
    els[key].textContent = text;
  }

  function updateHud() {
    var c = cfg();
    var p = state.player;
    var hp = p ? p.hp : c.PLAYER_MAX_HP;
    var maxHp = p ? p.maxHp : c.PLAYER_MAX_HP;

    var hpKey = hp + '/' + maxHp;
    if (hudCache.hearts !== hpKey) {
      hudCache.hearts = hpKey;
      var html = '';
      for (var i = 0; i < maxHp; i++) {
        html += i < hp
          ? '<span class="heart full">♥</span>'
          : '<span class="heart empty">♡</span>';
      }
      els.hp.innerHTML = html;
    }

    setHud('floor', state.floor + ' / ' + c.FLOORS);

    var lit = !!(p && p.hasKey);
    if (keyLit !== lit) {
      keyLit = lit;
      if (lit) els.key.classList.add('lit');
      else els.key.classList.remove('lit');
    }

    setHud('coins', p ? p.coins : 0);
    setHud('time', fmtTime(state.time));
    setHud('score', state.score);
  }

  // Rebuilds the log only when the message list changes; fades each line by its ttl.
  function updateMessages() {
    var msgs = state.messages || [];
    var same = msgs.length === logMsgs.length;
    for (var i = 0; same && i < msgs.length; i++) {
      if (msgs[i] !== logMsgs[i]) same = false;
    }

    if (!same) {
      logMsgs = msgs.slice();
      logEls = [];
      logOpacity = [];
      els.messages.innerHTML = '';
      for (var j = 0; j < msgs.length; j++) {
        var div = document.createElement('div');
        div.className = 'msg';
        div.textContent = msgs[j].text;
        els.messages.appendChild(div);
        logEls.push(div);
        logOpacity.push(-1);
      }
    }

    for (var k = 0; k < logMsgs.length; k++) {
      var a = Math.max(0, Math.min(1, logMsgs[k].ttl / 0.6));
      a = Math.round(a * 20) / 20;
      if (logOpacity[k] !== a) {
        logOpacity[k] = a;
        logEls[k].style.opacity = String(a);
      }
    }
  }

  function overlayContent() {
    var c = cfg();
    var s = state;
    var bestLine = 'Best score: ' + best;

    if (s.screen === 'title') {
      return {
        title: 'DUNGEON ESCAPE',
        body: 'Find the key on each floor, reach the locked exit door, and survive all ' +
          c.FLOORS + ' floors to escape.\n\n' +
          'Arrows or WASD: move (walk into an enemy to attack)\n' +
          'P or Esc: pause\n\n' + bestLine,
        hint: 'Press Enter to begin'
      };
    }
    if (s.screen === 'paused') {
      return {
        title: 'PAUSED',
        body: 'The dungeon waits for you.',
        hint: 'Press P or Esc to resume'
      };
    }
    if (s.screen === 'gameover') {
      return {
        title: 'YOU DIED',
        body: 'Score: ' + s.score + '\n' +
          'Floor reached: ' + s.floor + ' / ' + c.FLOORS + '\n' +
          'Time: ' + fmtTime(s.time) + '\n' + bestLine,
        hint: 'Press Enter to try again'
      };
    }
    if (s.screen === 'win') {
      return {
        title: 'YOU ESCAPED',
        body: 'You cleared all ' + c.FLOORS + ' floors.\n' +
          'Score: ' + s.score + '\n' +
          'Time: ' + fmtTime(s.time) + '\n' + bestLine,
        hint: 'Press Enter to play again'
      };
    }
    return null;
  }

  function updateOverlay() {
    var content = overlayContent();
    var key = content ? content.title + '|' + content.body + '|' + content.hint : '';
    if (key === overlayCache) return;
    overlayCache = key;

    if (!content) {
      els.overlay.classList.add('hidden');
      return;
    }
    els.overlayTitle.textContent = content.title;
    els.overlayBody.textContent = content.body;
    els.overlayHint.textContent = content.hint;
    els.overlay.classList.remove('hidden');
  }

  // ---- startup ----

  function init() {
    els.canvas = document.getElementById('game');
    els.hp = document.getElementById('hp');
    els.floor = document.getElementById('floor');
    els.key = document.getElementById('key');
    els.coins = document.getElementById('coins');
    els.time = document.getElementById('time');
    els.score = document.getElementById('score');
    els.messages = document.getElementById('messages');
    els.overlay = document.getElementById('overlay');
    els.overlayTitle = document.getElementById('overlay-title');
    els.overlayBody = document.getElementById('overlay-body');
    els.overlayHint = document.getElementById('overlay-hint');

    ctx = els.canvas.getContext('2d');
    best = loadBest();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.screen === 'playing') {
        state.screen = 'paused';
        clearHeld();
      }
    });

    requestAnimationFrame(frame);
  }

  DE.newGame = newGame;
  DE.startFloor = startFloor;

  document.addEventListener('DOMContentLoaded', init);
})();
