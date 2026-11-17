/* Alvins Hajjakt – ljud (WebAudio-syntes, inga ljudfiler).
 * Definierar window.Sfx enligt kontraktet i SPEC.md.
 */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, sfxBus = null, musicBus = null, musicFilter = null, noiseBuf = null;
  var muted = false;
  try { muted = localStorage.getItem('haj_muted') === '1'; } catch (e) { }

  var tensionVal = 0, tensionTarget = 0;
  var musicLevel = -1, wantLevel = -1;
  var timer = null, nextTime = 0, step = 0;

  function init() {
    if (ctx || !AC) return !!ctx;
    try {
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(comp); comp.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
      musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 2400; musicFilter.Q.value = 0.7;
      musicBus = ctx.createGain(); musicBus.gain.value = 0.32;
      musicFilter.connect(musicBus); musicBus.connect(master);
      var len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return !!ctx;
  }

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // ------------------------------------------------------------ primitives
  function tone(o) {
    // o: {f, f2, type, t, dur, vol, a, out, glide, filter, q, detune}
    if (!ctx) return;
    var t = o.t == null ? ctx.currentTime : o.t;
    var dur = o.dur || 0.15, a = o.a == null ? 0.005 : o.a;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.glide || dur));
    if (o.detune) osc.detune.value = o.detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol == null ? 0.3 : o.vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var node = osc;
    if (o.filter) {
      var bq = ctx.createBiquadFilter();
      bq.type = o.ftype || 'lowpass';
      bq.frequency.setValueAtTime(o.filter, t);
      if (o.filter2) bq.frequency.exponentialRampToValueAtTime(o.filter2, t + dur);
      bq.Q.value = o.q || 1;
      osc.connect(bq); node = bq;
    }
    node.connect(g); g.connect(o.out || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(o) {
    if (!ctx) return;
    var t = o.t == null ? ctx.currentTime : o.t;
    var dur = o.dur || 0.1;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = o.rate || 1;
    var bq = ctx.createBiquadFilter();
    bq.type = o.ftype || 'bandpass';
    bq.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) bq.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    bq.Q.value = o.q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol == null ? 0.3 : o.vol, t + (o.a || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq); bq.connect(g); g.connect(o.out || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ effects
  var FX = {
    pearl: function (t) {
      tone({ f: 1318, type: 'sine', t: t, dur: 0.09, vol: 0.22 });
      tone({ f: 1976, type: 'sine', t: t + 0.05, dur: 0.16, vol: 0.2 });
      tone({ f: 3951, type: 'sine', t: t + 0.05, dur: 0.1, vol: 0.05 });
    },
    turbo: function (t) {
      tone({ f: 180, f2: 1400, type: 'sawtooth', t: t, dur: 0.45, vol: 0.16, filter: 600, filter2: 5000, q: 6 });
      noise({ f: 800, f2: 5000, t: t, dur: 0.5, vol: 0.18, q: 0.8 });
    },
    shield: function (t) {
      [659, 831, 988, 1319].forEach(function (f, i) {
        tone({ f: f, type: 'triangle', t: t + i * 0.05, dur: 0.5 - i * 0.05, vol: 0.13 });
        tone({ f: f * 1.005, type: 'sine', t: t + i * 0.05, dur: 0.5, vol: 0.06 });
      });
    },
    magnet: function (t) {
      for (var i = 0; i < 6; i++) tone({ f: 300 + i * 90, f2: 340 + i * 90, type: 'square', t: t + i * 0.045, dur: 0.06, vol: 0.07, filter: 1800 });
      tone({ f: 220, f2: 880, type: 'sine', t: t, dur: 0.35, vol: 0.12 });
    },
    ink: function (t) {
      noise({ f: 600, f2: 120, ftype: 'lowpass', t: t, dur: 0.35, vol: 0.4, q: 3 });
      tone({ f: 340, f2: 70, type: 'sine', t: t, dur: 0.3, vol: 0.3 });
      tone({ f: 900, f2: 300, type: 'sine', t: t + 0.12, dur: 0.12, vol: 0.08 });
    },
    crash: function (t) {
      noise({ f: 1400, f2: 200, ftype: 'lowpass', t: t, dur: 0.3, vol: 0.5, q: 1 });
      tone({ f: 140, f2: 40, type: 'sine', t: t, dur: 0.3, vol: 0.55 });
      tone({ f: 260, f2: 90, type: 'square', t: t, dur: 0.12, vol: 0.1, filter: 900 });
    },
    sharkCrash: function (t) {
      tone({ f: 520, f2: 160, type: 'triangle', t: t, dur: 0.18, vol: 0.3 });
      noise({ f: 300, ftype: 'lowpass', t: t, dur: 0.15, vol: 0.35 });
      // cartoon "boing"
      var osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(260, t + 0.1); osc.frequency.linearRampToValueAtTime(420, t + 0.6);
      lfo.frequency.value = 14; lg.gain.value = 40;
      lfo.connect(lg); lg.connect(osc.frequency);
      g.gain.setValueAtTime(0.0001, t + 0.1); g.gain.linearRampToValueAtTime(0.2, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      osc.connect(g); g.connect(sfxBus);
      osc.start(t + 0.1); lfo.start(t + 0.1); osc.stop(t + 0.7); lfo.stop(t + 0.7);
    },
    chomp: function (t) {
      for (var i = 0; i < 2; i++) {
        var tt = t + i * 0.16;
        noise({ f: 2200, f2: 400, ftype: 'lowpass', t: tt, dur: 0.09, vol: 0.5, q: 2 });
        tone({ f: 110, f2: 50, type: 'square', t: tt, dur: 0.1, vol: 0.25, filter: 600 });
      }
    },
    gulp: function (t) {
      tone({ f: 420, f2: 110, type: 'sine', t: t, dur: 0.28, vol: 0.4, filter: 1200, filter2: 300 });
      tone({ f: 180, f2: 90, type: 'triangle', t: t + 0.2, dur: 0.25, vol: 0.3 });
      // burp bubble
      tone({ f: 300, f2: 900, type: 'sine', t: t + 0.55, dur: 0.12, vol: 0.18 });
      tone({ f: 450, f2: 1300, type: 'sine', t: t + 0.65, dur: 0.1, vol: 0.12 });
    },
    levelup: function (t) {
      [60, 64, 67, 72, 76].forEach(function (m, i) {
        tone({ f: mtof(m + 12), type: 'square', t: t + i * 0.08, dur: 0.22, vol: 0.09, filter: 3000 });
        tone({ f: mtof(m), type: 'triangle', t: t + i * 0.08, dur: 0.3, vol: 0.14 });
      });
      [72, 76, 79].forEach(function (m) { tone({ f: mtof(m), type: 'triangle', t: t + 0.42, dur: 0.6, vol: 0.12 }); });
    },
    click: function (t) {
      tone({ f: 1800, f2: 900, type: 'square', t: t, dur: 0.035, vol: 0.08, filter: 4000 });
    },
    record: function (t) {
      var seq = [67, 72, 76, 79, 84];
      seq.forEach(function (m, i) {
        tone({ f: mtof(m), type: 'sawtooth', t: t + i * 0.1, dur: 0.25, vol: 0.08, filter: 2500 });
        tone({ f: mtof(m), type: 'triangle', t: t + i * 0.1, dur: 0.3, vol: 0.14 });
      });
      [72, 76, 79, 84].forEach(function (m) { tone({ f: mtof(m), type: 'triangle', t: t + 0.55, dur: 1.1, vol: 0.1, a: 0.02 }); });
      for (var i = 0; i < 8; i++) tone({ f: mtof(96 + (i % 4) * 2), type: 'sine', t: t + 0.55 + i * 0.07, dur: 0.12, vol: 0.05 });
    },
    countdown: function (t) {
      tone({ f: 660, type: 'square', t: t, dur: 0.14, vol: 0.12, filter: 2500 });
      tone({ f: 660, type: 'sine', t: t, dur: 0.18, vol: 0.15 });
    },
    go: function (t) {
      tone({ f: 990, type: 'square', t: t, dur: 0.4, vol: 0.12, filter: 3500 });
      tone({ f: 1320, type: 'sine', t: t, dur: 0.45, vol: 0.12 });
      tone({ f: 495, type: 'triangle', t: t, dur: 0.45, vol: 0.15 });
    }
  };

  // ------------------------------------------------------------ music
  // Per level: tempo, root (midi), scale, chord progression (scale degrees), sound.
  var MINOR = [0, 2, 3, 5, 7, 8, 10], MAJOR = [0, 2, 4, 5, 7, 9, 11], DORIAN = [0, 2, 3, 5, 7, 9, 10], PHRYG = [0, 1, 3, 5, 7, 8, 10];
  var SONGS = [
    { bpm: 96, root: 62, scale: MAJOR, prog: [0, 4, 5, 3], arp: 'triangle', bass: 'sine', pat: [0, 1, 2, 1, 3, 2, 1, 2], kick: false },
    { bpm: 104, root: 65, scale: MAJOR, prog: [5, 3, 0, 4], arp: 'square', bass: 'triangle', pat: [0, 2, 1, 3, 2, 1, 0, 2], kick: true },
    { bpm: 110, root: 64, scale: MINOR, prog: [0, 5, 2, 6], arp: 'square', bass: 'sawtooth', pat: [0, 1, 2, 0, 3, 2, 1, 2], kick: true },
    { bpm: 116, root: 67, scale: DORIAN, prog: [0, 3, 0, 6], arp: 'triangle', bass: 'sawtooth', pat: [0, 2, 3, 2, 1, 2, 3, 1], kick: true },
    { bpm: 122, root: 59, scale: MINOR, prog: [0, 5, 3, 4], arp: 'sine', bass: 'triangle', pat: [3, 2, 1, 0, 1, 2, 3, 2], kick: true, bell: true },
    { bpm: 130, root: 60, scale: PHRYG, prog: [0, 1, 0, 6], arp: 'sawtooth', bass: 'sawtooth', pat: [0, 0, 2, 1, 0, 3, 2, 1], kick: true },
    { bpm: 136, root: 54, scale: MINOR, prog: [0, 5, 0, 4], arp: 'sine', bass: 'sine', pat: [0, -1, 2, -1, 1, -1, 3, -1], kick: false, eerie: true },
    { bpm: 144, root: 57, scale: MINOR, prog: [0, 5, 3, 6], arp: 'square', bass: 'sawtooth', pat: [0, 2, 1, 3, 0, 2, 3, 1], kick: true }
  ];

  function degNote(song, deg, oct) {
    var sc = song.scale, n = sc.length;
    var o = Math.floor(deg / n);
    return song.root + sc[((deg % n) + n) % n] + 12 * (o + (oct || 0));
  }

  function scheduleStep(song, s, t, sd) {
    var bar = Math.floor(s / 16) % song.prog.length;
    var deg = song.prog[bar];
    var i16 = s % 16;
    var ten = tensionVal;
    var out = musicFilter;
    // arpeggio (16ths): chord tones 1-3-5-8
    var pi = song.pat[i16 % song.pat.length];
    if (pi >= 0 && (i16 % 2 === 0 || ten > 0.35 || !song.eerie)) {
      var chordDegs = [0, 2, 4, 7];
      var m = degNote(song, deg + chordDegs[pi], 1);
      tone({ f: mtof(m), type: song.arp, t: t, dur: sd * (song.bell ? 3 : 1.6), vol: song.arp === 'square' || song.arp === 'sawtooth' ? 0.07 : 0.12, out: out, filter: song.arp === 'sine' ? 0 : 1800 + ten * 2500 });
      if (song.bell && i16 % 4 === 0) tone({ f: mtof(m + 12), type: 'sine', t: t, dur: sd * 4, vol: 0.05, out: out });
    }
    // bass: 8ths, root/octave
    if (i16 % 2 === 0) {
      var bm = degNote(song, deg, -1) + (i16 % 8 === 4 ? 12 : 0);
      var bvol = song.bass === 'sawtooth' ? 0.14 : 0.24;
      if (!song.eerie || i16 % 8 === 0) tone({ f: mtof(bm), type: song.bass, t: t, dur: sd * (song.eerie ? 6 : 1.8), vol: bvol, out: out, filter: song.bass === 'sine' ? 0 : 500 + ten * 900, q: 4 });
    }
    // kick on beats
    if (song.kick && i16 % 4 === 0) tone({ f: 120, f2: 42, type: 'sine', t: t, dur: 0.18, vol: 0.45, out: out, glide: 0.12 });
    // eerie pad for the deep
    if (song.eerie && i16 === 0) {
      [0, 2, 4].forEach(function (k) { tone({ f: mtof(degNote(song, deg + k, 0)), type: 'triangle', t: t, dur: sd * 16, vol: 0.05, a: sd * 4, out: out }); });
    }
    // tension: hats, then off-beat stabs + heartbeat
    if (ten > 0.25 && i16 % 2 === 1) noise({ f: 8000, ftype: 'highpass', t: t, dur: 0.04, vol: 0.05 + ten * 0.08, out: out });
    if (ten > 0.5 && i16 % 4 === 2) tone({ f: mtof(degNote(song, deg + 4, 0)), type: 'sawtooth', t: t, dur: sd * 0.9, vol: 0.05 * ten, out: out, filter: 2200 });
    if (ten > 0.6 && (i16 === 0 || i16 === 3 || i16 === 8 || i16 === 11)) tone({ f: 70, f2: 40, type: 'sine', t: t, dur: 0.15, vol: 0.3 * ten, out: out });
  }

  function tick() {
    if (!ctx || musicLevel < 0) return;
    // smooth tension
    tensionVal += (tensionTarget - tensionVal) * 0.08;
    var song = SONGS[musicLevel];
    var bpm = song.bpm * (1 + tensionVal * 0.12);
    var sd = 60 / bpm / 4;
    var now = ctx.currentTime;
    if (nextTime < now - 0.2) nextTime = now + 0.05;
    while (nextTime < now + 0.14) {
      scheduleStep(song, step, nextTime, sd);
      nextTime += sd;
      step++;
    }
    try {
      musicFilter.frequency.setTargetAtTime(1800 + tensionVal * 5000, now, 0.2);
    } catch (e) { }
  }

  function startMusic(level) {
    if (!init()) { wantLevel = level; return; }
    if (musicLevel === level && timer) return;
    musicLevel = level;
    step = 0;
    nextTime = ctx.currentTime + 0.08;
    try {
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
      musicBus.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.5);
    } catch (e) { }
    if (!timer) timer = setInterval(tick, 25);
    tick();
  }

  var Sfx = {
    unlock: function () {
      if (!init()) return;
      try {
        if (ctx.state === 'suspended') ctx.resume();
        // silent buffer – unlocks iOS
        var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      } catch (e) { }
      if (wantLevel >= 0 && musicLevel < 0) { var w = wantLevel; wantLevel = -1; startMusic(w); }
    },
    play: function (name) {
      if (muted || !ctx || !FX[name]) return;
      try {
        if (ctx.state === 'suspended') ctx.resume();
        FX[name](ctx.currentTime + 0.005);
      } catch (e) { }
    },
    music: function (levelIndex) {
      var L = Math.max(0, Math.min(7, levelIndex | 0));
      if (!ctx) { wantLevel = L; return; }
      startMusic(L);
    },
    tension: function (v) {
      v = +v || 0;
      tensionTarget = Math.max(0, Math.min(1, v));
    },
    stopMusic: function () {
      wantLevel = -1;
      if (timer) { clearInterval(timer); timer = null; }
      musicLevel = -1;
      tensionVal = tensionTarget = 0;
      if (ctx) {
        try {
          var t = ctx.currentTime;
          musicBus.gain.cancelScheduledValues(t);
          musicBus.gain.setValueAtTime(musicBus.gain.value, t);
          musicBus.gain.linearRampToValueAtTime(0.0001, t + 0.15);
        } catch (e) { }
      }
    },
    setMuted: function (b) {
      muted = !!b;
      try { localStorage.setItem('haj_muted', muted ? '1' : '0'); } catch (e) { }
      if (ctx && master) {
        try {
          var t = ctx.currentTime;
          master.gain.cancelScheduledValues(t);
          master.gain.setValueAtTime(muted ? 0 : 1, t);
          master.gain.value = muted ? 0 : 1;
        } catch (e) { }
      }
    }
  };
  Object.defineProperty(Sfx, 'muted', {
    get: function () { return muted; },
    set: function (v) { Sfx.setMuted(v); },
    enumerable: true
  });

  window.Sfx = Sfx;
})();
