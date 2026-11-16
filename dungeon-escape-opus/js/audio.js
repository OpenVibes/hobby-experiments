window.DE = window.DE || {};
(function (DE) {
  'use strict';

  var STORAGE_KEY = 'dungeonEscape.muted';
  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var muted = readMuted();

  function readMuted() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function writeMuted(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch (e) {
      // storage unavailable (private mode, blocked): mute still works for this session
    }
  }

  function getContext() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  function getNoise(c) {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(c.sampleRate); // one second of white noise
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    var data = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Oscillator blip with an exponential envelope. Frequencies must be > 0.
  function tone(c, t0, f0, f1, dur, type, vol) {
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) {
      osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  // Filtered noise burst with a decaying envelope.
  function noise(c, t0, dur, vol, filterType, filterFreq) {
    var src = c.createBufferSource();
    src.buffer = getNoise(c);
    var filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    var g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0, Math.random() * 0.5, dur + 0.03);
    src.stop(t0 + dur + 0.03);
  }

  var SOUNDS = {
    step: function (c, t) {
      tone(c, t, 180, 120, 0.06, 'triangle', 0.06);
    },
    hit: function (c, t) {
      noise(c, t, 0.12, 0.22, 'lowpass', 1500);
      tone(c, t, 220, 90, 0.12, 'square', 0.07);
    },
    hurt: function (c, t) {
      tone(c, t, 300, 110, 0.2, 'sawtooth', 0.09);
    },
    kill: function (c, t) {
      tone(c, t, 440, 440, 0.09, 'square', 0.06);
      tone(c, t + 0.09, 660, 660, 0.09, 'square', 0.06);
      tone(c, t + 0.18, 880, 880, 0.18, 'square', 0.06);
    },
    pickup: function (c, t) {
      tone(c, t, 660, 990, 0.12, 'sine', 0.12);
    },
    key: function (c, t) {
      tone(c, t, 880, 880, 0.12, 'triangle', 0.12);
      tone(c, t + 0.12, 1320, 1320, 0.2, 'triangle', 0.12);
    },
    door: function (c, t) {
      noise(c, t, 0.12, 0.2, 'lowpass', 400);
      tone(c, t, 110, 70, 0.3, 'sine', 0.14);
    },
    locked: function (c, t) {
      tone(c, t, 150, 150, 0.12, 'square', 0.06);
      tone(c, t + 0.16, 130, 130, 0.14, 'square', 0.06);
    },
    stairs: function (c, t) {
      var notes = [330, 440, 550, 660];
      for (var i = 0; i < notes.length; i++) {
        tone(c, t + i * 0.09, notes[i], notes[i], 0.12, 'triangle', 0.12);
      }
    },
    potion: function (c, t) {
      tone(c, t, 520, 780, 0.25, 'sine', 0.12);
      tone(c, t + 0.12, 780, 1040, 0.15, 'sine', 0.06);
    },
    trap: function (c, t) {
      noise(c, t, 0.25, 0.28, 'highpass', 1200);
      tone(c, t, 200, 60, 0.25, 'sawtooth', 0.08);
    },
    death: function (c, t) {
      tone(c, t, 330, 55, 1.2, 'sawtooth', 0.1);
      tone(c, t, 334, 58, 1.2, 'triangle', 0.06);
    },
    win: function (c, t) {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++) {
        tone(c, t + i * 0.14, notes[i], notes[i], 0.16, 'triangle', 0.12);
      }
      tone(c, t + 0.56, 1047, 1047, 0.7, 'triangle', 0.1);
      tone(c, t + 0.56, 784, 784, 0.7, 'square', 0.04);
    }
  };

  function play(name) {
    try {
      if (muted) return;
      var fn = SOUNDS[name];
      if (!fn) return;
      var c = getContext();
      if (!c) return;
      if (c.state === 'suspended' && c.resume) {
        var p = c.resume();
        if (p && p.catch) p.catch(function () {});
      }
      fn(c, c.currentTime + 0.01);
    } catch (e) {
      // audio must never break the game
    }
  }

  function toggleMute() {
    muted = !muted;
    writeMuted(muted);
    return muted;
  }

  function isMuted() {
    return muted;
  }

  function unlock() {
    try {
      var c = getContext();
      if (c && c.state === 'suspended' && c.resume) {
        var p = c.resume();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {
      // ignore
    }
  }

  DE.audio = {
    play: play,
    toggleMute: toggleMute,
    isMuted: isMuted,
    unlock: unlock
  };
})(window.DE);
