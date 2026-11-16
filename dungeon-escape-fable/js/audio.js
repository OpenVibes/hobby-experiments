window.DE = window.DE || {};

(function () {
  var audioCtx = null;

  // Creates the AudioContext lazily. Returns null when audio is unavailable (e.g. Node).
  function getContext() {
    if (audioCtx) return audioCtx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  }

  // One oscillator note with an attack/decay envelope.
  function note(ctx, when, freq, dur, opts) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var vol = opts.vol || 0.1;
    var attack = opts.attack || 0.005;
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, when);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, when + dur);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(vol, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  // Short decaying white-noise burst.
  function noise(ctx, when, dur, vol) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    var gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(vol, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  // Notes played one after another, step seconds apart.
  function arpeggio(ctx, when, freqs, step, dur, type, vol) {
    for (var i = 0; i < freqs.length; i++) {
      note(ctx, when + i * step, freqs[i], dur, { type: type, vol: vol });
    }
  }

  var SOUNDS = {
    // very quiet tick
    step: function (c, t) {
      note(c, t, 170, 0.04, { type: 'triangle', freqEnd: 120, vol: 0.012 });
    },
    // short square blip plus a little noise
    hit: function (c, t) {
      note(c, t, 320, 0.09, { type: 'square', freqEnd: 140, vol: 0.05 });
      noise(c, t, 0.04, 0.06);
    },
    // low thud
    hurt: function (c, t) {
      note(c, t, 130, 0.28, { type: 'sine', freqEnd: 40, vol: 0.45 });
      note(c, t, 65, 0.25, { type: 'triangle', freqEnd: 35, vol: 0.2 });
    },
    // two-note bright blip
    pickup: function (c, t) {
      note(c, t, 660, 0.07, { type: 'triangle', vol: 0.12 });
      note(c, t + 0.07, 990, 0.1, { type: 'triangle', vol: 0.12 });
    },
    // rising arpeggio
    key: function (c, t) {
      arpeggio(c, t, [523.25, 659.25, 783.99, 1046.5], 0.06, 0.1, 'triangle', 0.12);
    },
    // upward sweep
    door: function (c, t) {
      note(c, t, 220, 0.3, { type: 'sine', freqEnd: 660, vol: 0.18 });
    },
    // two low buzzes
    locked: function (c, t) {
      note(c, t, 140, 0.12, { type: 'square', vol: 0.06 });
      note(c, t + 0.16, 110, 0.14, { type: 'square', vol: 0.06 });
    },
    // descending arpeggio
    death: function (c, t) {
      arpeggio(c, t, [392, 330, 262, 196], 0.08, 0.12, 'sawtooth', 0.07);
    },
    // longer rising major arpeggio
    win: function (c, t) {
      arpeggio(c, t, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.065, 0.12, 'triangle', 0.14);
    }
  };

  window.DE.sfx = function (name) {
    try {
      if (!Object.prototype.hasOwnProperty.call(SOUNDS, name)) return;
      var c = getContext();
      if (!c) return;
      if (c.state === 'suspended' && typeof c.resume === 'function') c.resume();
      SOUNDS[name](c, c.currentTime + 0.001);
    } catch (e) {
      // audio is optional; never let it break the game
    }
  };
})();
