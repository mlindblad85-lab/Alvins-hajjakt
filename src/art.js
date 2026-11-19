/* Hajjakten – grafik (ren Canvas 2D, inga bilder).
 * Definierar window.Art enligt kontraktet i SPEC.md.
 * Statiska delar (bakgrundslager, hinder, pärlor, glöd) cachas på offscreen-canvas.
 * Inga shadowBlur-anrop per bildruta; mjuk glöd görs med förrenderade sprites.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- helpers
  function mulberry(seed) {
    var a = (seed | 0) ^ 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function seedNum(s) {
    if (typeof s === 'number') return Math.floor(s * 1000003) | 0;
    var h = 2166136261;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function ctxScale(ctx) {
    try {
      var m = ctx.getTransform();
      var s = Math.sqrt(m.a * m.a + m.b * m.b);
      return Math.max(1, Math.min(3, Math.round(s * 4) / 4));
    } catch (e) { return 1; }
  }
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function mix(h1, h2, k) {
    var a = hexToRgb(h1), b = hexToRgb(h2);
    var r = Math.round(a[0] + (b[0] - a[0]) * k), g = Math.round(a[1] + (b[1] - a[1]) * k), bl = Math.round(a[2] + (b[2] - a[2]) * k);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function smoothPath(g, pts) {
    var n = pts.length;
    var p0 = pts[n - 1], p1 = pts[0];
    g.moveTo((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    g.closePath();
  }
  // superellipse-ish blob that fills a w*h box well
  function blobPoints(w, h, rng, n, sq, jit, flatBottom, flatTop) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + (rng() - 0.5) * 0.25;
      var c = Math.cos(a), s = Math.sin(a);
      var r = 1 - rng() * jit;
      var px = w / 2 + (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), 2 / sq) * (w / 2) * r;
      var py = h / 2 + (s < 0 ? -1 : 1) * Math.pow(Math.abs(s), 2 / sq) * (h / 2) * r;
      if (flatBottom && py > h * 0.8) py = h + 2;
      if (flatTop && py < h * 0.2) py = -2;
      pts.push([px, py]);
    }
    return pts;
  }
  function star4(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y);
    g.quadraticCurveTo(x, y, x, y - r);
    g.fill();
  }
  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function bez(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }

  // simple LRU-ish cache
  function Cache(max) { this.m = new Map(); this.max = max; }
  Cache.prototype.get = function (k) {
    var v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  };
  Cache.prototype.set = function (k, v) {
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
    return v;
  };

  // glow sprite (soft radial) cached per colour
  var glowCache = new Cache(64);
  function glowSprite(color, inner) {
    var k = color + '|' + (inner || 0);
    var c = glowCache.get(k);
    if (c) return c;
    c = mkCanvas(128, 128);
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(color, 1));
    gr.addColorStop(inner || 0.15, rgba(color, 0.55));
    gr.addColorStop(0.5, rgba(color, 0.18));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return glowCache.set(k, c);
  }
  function drawGlow(ctx, x, y, r, color, alpha) {
    var a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * (alpha == null ? 1 : alpha);
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = a0;
  }

  // ---------------------------------------------------------- level glows
  // Self-luminous points registered during the frame; drawDarkness re-adds them
  // on top of the darkness so glowing details stay visible in level 7.
  var curLevel = 0;
  var glowPts = [];
  var darkObs = [];
  function regDarkSprite(ctx, img, x, y, w, h) {
    if (curLevel !== 6 || darkObs.length > 60) return;
    var m;
    try { m = ctx.getTransform(); } catch (e) { return; }
    darkObs.push({ img: img, x: x, y: y, w: w, h: h, m: m });
  }
  function regGlow(ctx, x, y, r, color, a) {
    if (curLevel !== 6 || glowPts.length > 220) return;
    var m;
    try { m = ctx.getTransform(); } catch (e) { m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
    glowPts.push({
      x: m.a * x + m.c * y + m.e,
      y: m.b * x + m.d * y + m.f,
      r: r * Math.sqrt(m.a * m.a + m.b * m.b),
      color: color,
      a: (a == null ? 1 : a) * ctx.globalAlpha
    });
  }

  // =================================================================== FISH
  var FISH = [
    { id: 'blixt', name: 'Blixt', tagline: 'Snabbast i viken', unlock: null },
    { id: 'neon', name: 'Neon', tagline: 'Lyser upp hela stan', unlock: null },
    { id: 'ninja', name: 'Ninja', tagline: 'Syns aldrig, hörs aldrig', unlock: null },
    { id: 'guldis', name: 'Guldis', tagline: 'Bara guld, inga ursäkter', unlock: null },
    { id: 'lavendel', name: 'Lavendel', tagline: 'Kall blick, varmt hjärta', unlock: null },
    { id: 'mint', name: 'Mint', tagline: 'Fräsch i varje läge', unlock: null },
    { id: 'tiger', name: 'Tiger', tagline: 'Ränderna är förtjänade', unlock: { type: 'score', value: 1000, label: '1 000 p' } },
    { id: 'zebra', name: 'Zebra', tagline: 'Svart eller vitt, aldrig grått', unlock: { type: 'score', value: 2500, label: '2 500 p' } },
    { id: 'korall', name: 'Korall', tagline: 'Revets drottning', unlock: { type: 'level', value: 4, label: 'Nå level 4' } },
    { id: 'natt', name: 'Natt', tagline: 'Äger natten', unlock: { type: 'score', value: 5000, label: '5 000 p' } },
    { id: 'regnbage', name: 'Regnbåge', tagline: 'Alla färger, noll regler', unlock: { type: 'level', value: 7, label: 'Nå level 7' } },
    { id: 'kristall', name: 'Kristall', tagline: 'Kungen av djupet', unlock: { type: 'score', value: 10000, label: '10 000 p' } }
  ];

  // look per fish: body gradient, fins, outline, eye, shape factors, pattern
  var FDEF = {
    blixt:    { top: '#E2500A', mid: '#FF8A1F', belly: '#FFE6C9', fin: '#FF9634', finEdge: '#FFFFFF', line: '#7A2600', iris: '#3A1A08', h: 0.5, tail: 'fork', pat: 'bolt', gear: ['aviator'], tat: 'bolt' },
    neon:     { top: '#0A2F57', mid: '#145C8C', belly: '#C9FBFF', fin: '#5FF3FF', finEdge: '#D8FFFF', line: '#03203A', iris: '#0B3550', h: 0.4, tail: 'lunate', pat: 'neon', finA: 0.55, gear: ['headphones'] },
    ninja:    { top: '#1F242C', mid: '#3A414D', belly: '#6E7786', fin: '#2B3038', finEdge: '#555E6C', line: '#0B0D11', iris: '#120000', h: 0.42, tail: 'lunate', pat: 'ninja', eye: 'slit', gear: ['scar'] },
    guldis:   { top: '#F09A00', mid: '#FFC928', belly: '#FFF4B8', fin: '#FFB01F', finEdge: '#FFF0A0', line: '#7A4A00', iris: '#3A2400', h: 0.6, tail: 'round', pat: 'scales', gear: ['chain', 'grillz'] },
    lavendel: { top: '#5D35C4', mid: '#9466FF', belly: '#E6DAFF', fin: '#B898FF', finEdge: '#F0E8FF', line: '#2A1468', iris: '#22104A', h: 0.48, tail: 'flow', pat: 'softspots', finA: 0.75, gear: ['visor'], tat: 'star' },
    mint:     { top: '#0E8F82', mid: '#2ED3B7', belly: '#DDFFF6', fin: '#5EE8CF', finEdge: '#E6FFFA', line: '#05463F', iris: '#083A34', h: 0.47, tail: 'fork', pat: 'chevron', gear: ['cap'] },
    tiger:    { top: '#E8700A', mid: '#FFA22A', belly: '#FFF0D2', fin: '#FF9A2A', finEdge: '#1A120C', line: '#3A1C00', iris: '#2A1400', h: 0.5, tail: 'fork', pat: 'tiger', gear: ['mohawk', 'scar', 'grillz'], tat: 'flame' },
    zebra:    { top: '#DCE2E8', mid: '#F6F8FA', belly: '#FFFFFF', fin: '#F2F4F6', finEdge: '#15171A', line: '#15171A', iris: '#000000', h: 0.5, tail: 'fork', pat: 'zebra', gear: ['collar', 'aviatorDark'] },
    korall:   { top: '#D93A78', mid: '#FF73A8', belly: '#FFE3EE', fin: '#FF8DB9', finEdge: '#FFFFFF', line: '#6A0F35', iris: '#3A0A20', h: 0.54, tail: 'round', pat: 'korall', gear: ['aviatorPink', 'hoop'] },
    natt:     { top: '#070F2E', mid: '#13245E', belly: '#2E4C94', fin: '#1A2E70', finEdge: '#9CC2FF', line: '#02061A', iris: '#FFD86B', h: 0.46, tail: 'fork', pat: 'stars', eyeGlow: '#FFE07A', gear: ['neonlines', 'hoop'] },
    regnbage: { top: '#FF4D6D', mid: '#FFD23F', belly: '#7CE8FF', fin: '#FFFFFF', finEdge: '#FFFFFF', line: '#3A1450', iris: '#1A0A30', h: 0.48, tail: 'flow', pat: 'rainbow', finA: 0.85, gear: ['mirror', 'chain'] },
    kristall: { top: '#A8E6FF', mid: '#DDF6FF', belly: '#FFFFFF', fin: '#CFF3FF', finEdge: '#FFFFFF', line: '#6FBFE6', iris: '#2A7FB0', h: 0.48, tail: 'fork', pat: 'crystal', crystal: true, finA: 0.55, gear: ['crown'] }
  };

  function fishBodyPath(g, L, hh) {
    g.beginPath();
    g.moveTo(0.5 * L, 0.06 * hh);
    g.bezierCurveTo(0.49 * L, -0.62 * hh, 0.22 * L, -hh, -0.01 * L, -hh);
    g.bezierCurveTo(-0.19 * L, -hh, -0.27 * L, -0.42 * hh, -0.32 * L, -0.17 * hh);
    g.lineTo(-0.32 * L, 0.17 * hh);
    g.bezierCurveTo(-0.27 * L, 0.42 * hh, -0.18 * L, 0.93 * hh, 0.0, 0.93 * hh);
    g.bezierCurveTo(0.22 * L, 0.93 * hh, 0.47 * L, 0.6 * hh, 0.5 * L, 0.06 * hh);
    g.closePath();
  }
  function fishTailPath(g, L, hh, type) {
    var sp = Math.max(hh * 0.95, L * 0.2);
    g.beginPath();
    if (type === 'round') {
      g.moveTo(-0.29 * L, -0.16 * hh);
      g.bezierCurveTo(-0.42 * L, -sp * 1.0, -0.56 * L, -sp * 0.7, -0.54 * L, 0);
      g.bezierCurveTo(-0.56 * L, sp * 0.7, -0.42 * L, sp * 1.0, -0.29 * L, 0.16 * hh);
    } else if (type === 'flow') {
      g.moveTo(-0.29 * L, -0.15 * hh);
      g.bezierCurveTo(-0.4 * L, -sp * 0.9, -0.55 * L, -sp * 1.25, -0.62 * L, -sp * 1.05);
      g.quadraticCurveTo(-0.5 * L, -sp * 0.3, -0.56 * L, 0);
      g.quadraticCurveTo(-0.5 * L, sp * 0.3, -0.62 * L, sp * 1.05);
      g.bezierCurveTo(-0.55 * L, sp * 1.25, -0.4 * L, sp * 0.9, -0.29 * L, 0.15 * hh);
    } else if (type === 'lunate') {
      g.moveTo(-0.29 * L, -0.13 * hh);
      g.quadraticCurveTo(-0.4 * L, -sp * 0.6, -0.53 * L, -sp * 1.05);
      g.quadraticCurveTo(-0.44 * L, -sp * 0.2, -0.43 * L, 0);
      g.quadraticCurveTo(-0.44 * L, sp * 0.2, -0.53 * L, sp * 1.05);
      g.quadraticCurveTo(-0.4 * L, sp * 0.6, -0.29 * L, 0.13 * hh);
    } else {
      g.moveTo(-0.29 * L, -0.15 * hh);
      g.quadraticCurveTo(-0.42 * L, -sp * 0.7, -0.52 * L, -sp * 0.95);
      g.quadraticCurveTo(-0.45 * L, -sp * 0.2, -0.45 * L, 0);
      g.quadraticCurveTo(-0.45 * L, sp * 0.2, -0.52 * L, sp * 0.95);
      g.quadraticCurveTo(-0.42 * L, sp * 0.7, -0.29 * L, 0.15 * hh);
    }
    g.closePath();
  }
  function finFill(g, d, L, hh, alpha) {
    var gr = g.createLinearGradient(0, -hh * 1.4, 0, hh * 1.4);
    gr.addColorStop(0, rgba(d.fin, alpha));
    gr.addColorStop(1, rgba(mix(d.fin, d.line, 0.25), alpha));
    return gr;
  }

  function rainbowFill(g, L, hh) {
    var gr = g.createLinearGradient(0, -hh, 0, hh);
    var cols = ['#FF4D6D', '#FF9A3C', '#FFE14D', '#4DE38A', '#3FB8FF', '#9A6BFF'];
    for (var i = 0; i < cols.length; i++) gr.addColorStop(i / (cols.length - 1), cols[i]);
    return gr;
  }

  function drawPattern(g, d, L, hh, t, id) {
    var i, x;
    switch (d.pat) {
      case 'bolt': {
        g.fillStyle = '#FFFFFF';
        g.strokeStyle = rgba('#7A2600', 0.55);
        g.lineWidth = Math.max(0.8, L * 0.012);
        g.beginPath();
        g.moveTo(0.34 * L, -0.55 * hh);
        g.lineTo(0.18 * L, 0.05 * hh);
        g.lineTo(0.27 * L, 0.0 * hh);
        g.lineTo(0.08 * L, 0.75 * hh);
        g.lineTo(0.16 * L, 0.7 * hh);
        g.lineTo(0.3 * L, 0.18 * hh);
        g.lineTo(0.22 * L, 0.24 * hh);
        g.lineTo(0.42 * L, -0.48 * hh);
        g.closePath();
        g.fill(); g.stroke();
        g.beginPath();
        g.moveTo(-0.06 * L, -1.1 * hh);
        g.lineTo(-0.16 * L, 0.0);
        g.lineTo(-0.1 * L, 0.0);
        g.lineTo(-0.2 * L, 1.1 * hh);
        g.lineTo(-0.12 * L, 1.1 * hh);
        g.lineTo(-0.02 * L, 0.14 * hh);
        g.lineTo(-0.08 * L, 0.14 * hh);
        g.lineTo(0.02 * L, -1.1 * hh);
        g.closePath();
        g.fill(); g.stroke();
        break;
      }
      case 'neon': {
        var gl = g.createLinearGradient(0.5 * L, 0, -0.35 * L, 0);
        gl.addColorStop(0, rgba('#5FF7FF', 0.0));
        gl.addColorStop(0.15, rgba('#5FF7FF', 0.95));
        gl.addColorStop(1, rgba('#2AA8FF', 0.9));
        g.fillStyle = rgba('#5FF7FF', 0.22);
        g.fillRect(-0.4 * L, -0.42 * hh, 0.9 * L, 0.5 * hh);
        g.fillStyle = gl;
        g.beginPath();
        g.moveTo(0.42 * L, -0.2 * hh);
        g.quadraticCurveTo(0.05 * L, -0.34 * hh, -0.36 * L, -0.12 * hh);
        g.lineTo(-0.36 * L, 0.04 * hh);
        g.quadraticCurveTo(0.05 * L, -0.08 * hh, 0.42 * L, -0.02 * hh);
        g.closePath();
        g.fill();
        g.fillStyle = rgba('#FF3D7F', 0.85);
        g.beginPath();
        g.moveTo(0.05 * L, 0.18 * hh);
        g.quadraticCurveTo(-0.15 * L, 0.12 * hh, -0.34 * L, 0.2 * hh);
        g.lineTo(-0.34 * L, 0.6 * hh);
        g.quadraticCurveTo(-0.1 * L, 0.7 * hh, 0.05 * L, 0.5 * hh);
        g.closePath();
        g.fill();
        break;
      }
      case 'ninja': {
        g.fillStyle = '#FF2E46';
        g.beginPath();
        g.moveTo(0.52 * L, -0.48 * hh);
        g.quadraticCurveTo(0.25 * L, -0.56 * hh, 0.1 * L, -0.5 * hh);
        g.lineTo(0.08 * L, 0.02 * hh);
        g.quadraticCurveTo(0.25 * L, -0.02 * hh, 0.52 * L, 0.02 * hh);
        g.closePath();
        g.fill();
        g.fillStyle = rgba('#FFFFFF', 0.18);
        g.fillRect(0.08 * L, -0.5 * hh, 0.44 * L, 0.1 * hh);
        // thin red lateral line
        g.strokeStyle = rgba('#FF2E46', 0.7);
        g.lineWidth = Math.max(1, L * 0.018);
        g.beginPath();
        g.moveTo(0.08 * L, -0.15 * hh);
        g.quadraticCurveTo(-0.12 * L, -0.05 * hh, -0.34 * L, 0.0);
        g.stroke();
        break;
      }
      case 'scales': {
        g.strokeStyle = rgba('#FFF6C8', 0.6);
        g.lineWidth = Math.max(0.7, L * 0.01);
        var sr = L * 0.06;
        for (var row = -3; row <= 3; row++) {
          for (i = 0; i < 9; i++) {
            x = 0.18 * L - i * sr * 1.2 + (row & 1 ? sr * 0.6 : 0);
            var y = row * sr * 0.85;
            g.beginPath();
            g.arc(x, y, sr * 0.7, Math.PI * 0.6, Math.PI * 1.4);
            g.stroke();
          }
        }
        var sh = 0.5 + 0.5 * Math.sin(t * 2.2);
        var gx = (-0.3 + sh * 0.7) * L;
        var gg = g.createLinearGradient(gx - L * 0.12, 0, gx + L * 0.12, 0);
        gg.addColorStop(0, 'rgba(255,255,255,0)');
        gg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
        gg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gg;
        g.fillRect(gx - L * 0.12, -hh, L * 0.24, hh * 2);
        break;
      }
      case 'softspots': {
        g.fillStyle = rgba('#F3ECFF', 0.45);
        var sp = [[0.1, -0.45, 0.07], [-0.05, -0.2, 0.06], [0.0, 0.3, 0.05], [-0.16, -0.5, 0.05], [-0.17, 0.15, 0.045], [0.14, 0.1, 0.04], [-0.26, -0.15, 0.035]];
        for (i = 0; i < sp.length; i++) { g.beginPath(); g.arc(sp[i][0] * L, sp[i][1] * hh * 1.6, sp[i][2] * L, 0, TAU); g.fill(); }
        break;
      }
      case 'chevron': {
        g.strokeStyle = rgba('#0A6E63', 0.75);
        g.lineWidth = Math.max(1, L * 0.035);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        for (i = 0; i < 4; i++) {
          x = 0.16 * L - i * 0.12 * L;
          g.beginPath();
          g.moveTo(x - 0.06 * L, -0.85 * hh);
          g.lineTo(x + 0.02 * L, -0.15 * hh);
          g.lineTo(x - 0.06 * L, 0.55 * hh);
          g.stroke();
        }
        break;
      }
      case 'tiger': {
        g.fillStyle = '#1A120C';
        for (i = 0; i < 5; i++) {
          x = 0.22 * L - i * 0.115 * L;
          var w = L * (0.045 - i * 0.004);
          g.beginPath();
          g.moveTo(x - w, -1.1 * hh);
          g.quadraticCurveTo(x + w * 0.6, -0.3 * hh, x - w * 0.2, 0.5 * hh);
          g.lineTo(x + w * 0.3, 0.55 * hh);
          g.quadraticCurveTo(x + w * 2.0, -0.3 * hh, x + w, -1.1 * hh);
          g.closePath();
          g.fill();
        }
        break;
      }
      case 'zebra': {
        g.fillStyle = '#15171A';
        for (i = 0; i < 8; i++) {
          x = 0.38 * L - i * 0.095 * L;
          var zw = L * 0.028;
          g.beginPath();
          g.moveTo(x - zw, -1.1 * hh);
          g.bezierCurveTo(x + zw * 2, -0.5 * hh, x - zw * 2, 0.3 * hh, x - zw * 0.5, 1.1 * hh);
          g.lineTo(x + zw * 1.2, 1.1 * hh);
          g.bezierCurveTo(x, 0.3 * hh, x + zw * 3.5, -0.5 * hh, x + zw, -1.1 * hh);
          g.closePath();
          g.fill();
        }
        break;
      }
      case 'korall': {
        g.lineCap = 'round';
        for (i = 0; i < 2; i++) {
          x = (0.24 - i * 0.24) * L;
          g.strokeStyle = rgba('#8A1846', 0.55);
          g.lineWidth = L * 0.085;
          g.beginPath();
          g.moveTo(x + 0.03 * L, -1.1 * hh);
          g.quadraticCurveTo(x - 0.06 * L, 0, x + 0.03 * L, 1.1 * hh);
          g.stroke();
          g.strokeStyle = '#FFFFFF';
          g.lineWidth = L * 0.055;
          g.stroke();
        }
        g.fillStyle = rgba('#FFE3EE', 0.8);
        var kd = [[0.08, -0.4], [0.12, 0.3], [-0.12, -0.5], [-0.1, 0.2], [-0.25, -0.1]];
        for (i = 0; i < kd.length; i++) { g.beginPath(); g.arc(kd[i][0] * L, kd[i][1] * hh, L * 0.022, 0, TAU); g.fill(); }
        break;
      }
      case 'stars': {
        for (i = 0; i < 16; i++) {
          var sx = (0.42 - hash(i + 3) * 0.75) * L;
          var sy = (hash(i + 40) * 1.7 - 0.85) * hh;
          var tw = 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7);
          var rr = L * (0.012 + hash(i + 77) * 0.018);
          g.fillStyle = rgba('#D8E8FF', 0.5 + tw * 0.5);
          g.beginPath(); g.arc(sx, sy, rr, 0, TAU); g.fill();
          if (i % 4 === 0) { g.fillStyle = rgba('#FFFFFF', tw * 0.9); star4(g, sx, sy, rr * 3); }
        }
        break;
      }
      case 'rainbow': {
        var shx = ((t * 0.6) % 1.4 - 0.4) * L;
        var gs = g.createLinearGradient(shx - 0.15 * L, 0, shx + 0.15 * L, 0);
        gs.addColorStop(0, 'rgba(255,255,255,0)');
        gs.addColorStop(0.5, 'rgba(255,255,255,0.4)');
        gs.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gs;
        g.fillRect(-0.5 * L, -hh, L, hh * 2);
        break;
      }
      case 'crystal': {
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = Math.max(0.7, L * 0.01);
        g.beginPath();
        g.moveTo(0.36 * L, -0.7 * hh); g.lineTo(0.12 * L, 0.1 * hh); g.lineTo(0.3 * L, 0.8 * hh);
        g.moveTo(0.12 * L, 0.1 * hh); g.lineTo(-0.1 * L, -0.95 * hh);
        g.moveTo(0.12 * L, 0.1 * hh); g.lineTo(-0.12 * L, 0.9 * hh);
        g.moveTo(-0.1 * L, -0.95 * hh); g.lineTo(-0.2 * L, 0.0); g.lineTo(-0.12 * L, 0.9 * hh);
        g.moveTo(-0.2 * L, 0.0); g.lineTo(-0.32 * L, 0);
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.beginPath(); g.moveTo(0.36 * L, -0.7 * hh); g.lineTo(0.12 * L, 0.1 * hh); g.lineTo(-0.1 * L, -0.95 * hh); g.closePath(); g.fill();
        g.fillStyle = 'rgba(120,200,255,0.18)';
        g.beginPath(); g.moveTo(0.12 * L, 0.1 * hh); g.lineTo(-0.12 * L, 0.9 * hh); g.lineTo(0.3 * L, 0.8 * hh); g.closePath(); g.fill();
        break;
      }
    }
  }

  var EYE = { x: 0.3, y: -0.2 };
  function eyeR(L) { return Math.max(1.6, L * 0.06); }
  function drawEye(g, d, L, hh, t) {
    var ex = EYE.x * L, ey = EYE.y * hh, er = eyeR(L);
    if (d.eyeGlow) drawGlow(g, ex, ey, er * 3.4, d.eyeGlow, 0.4);
    g.save();
    g.beginPath(); g.ellipse(ex, ey, er * 1.1, er, 0, 0, TAU);
    g.fillStyle = d.eyeGlow ? '#FFF6D0' : '#F4F6F2';
    g.fill();
    g.clip();
    // iris: straight, focused stare forward
    var ir = er * 0.62;
    var ig = g.createRadialGradient(ex + er * 0.3, ey, ir * 0.1, ex + er * 0.3, ey, ir);
    ig.addColorStop(0, mix(d.iris, '#FFFFFF', 0.3));
    ig.addColorStop(1, d.iris);
    g.fillStyle = ig;
    g.beginPath(); g.arc(ex + er * 0.35, ey + er * 0.1, ir, 0, TAU); g.fill();
    g.fillStyle = '#000';
    g.beginPath(); g.arc(ex + er * 0.42, ey + er * 0.1, ir * 0.5, 0, TAU); g.fill();
    var lit = 0.7 + 0.3 * Math.max(0, Math.sin(t * 1.3));
    g.fillStyle = 'rgba(255,255,255,' + lit + ')';
    g.beginPath(); g.arc(ex + er * 0.55, ey - er * 0.08, er * 0.17, 0, TAU); g.fill();
    // heavy half-closed lid, angled down toward the snout (attitude)
    var lidLow = d.eye === 'slit' ? 0.15 : -0.05;
    g.fillStyle = d.top;
    g.beginPath();
    g.moveTo(ex - er * 1.5, ey - er * 1.6);
    g.lineTo(ex + er * 1.5, ey - er * 1.6);
    g.lineTo(ex + er * 1.5, ey + er * (lidLow + 0.05));
    g.lineTo(ex - er * 1.5, ey + er * (lidLow - 0.45));
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.moveTo(ex - er * 1.5, ey + er * (lidLow - 0.45));
    g.lineTo(ex + er * 1.5, ey + er * (lidLow + 0.05));
    g.lineTo(ex + er * 1.5, ey + er * (lidLow + 0.3));
    g.lineTo(ex - er * 1.5, ey + er * (lidLow - 0.2));
    g.closePath(); g.fill();
    g.restore();
    // lid line + outline
    g.strokeStyle = d.line;
    g.lineWidth = Math.max(1, L * 0.022);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex - er * 1.15, ey + er * (lidLow - 0.42));
    g.lineTo(ex + er * 1.2, ey + er * (lidLow + 0.04));
    g.stroke();
    g.strokeStyle = rgba(d.line, 0.5);
    g.lineWidth = Math.max(0.6, L * 0.01);
    g.beginPath(); g.ellipse(ex, ey, er * 1.1, er, 0, 0, TAU); g.stroke();
  }

  // ------------------------------------------------------------ fish gear
  function lensPath(g, cx, cy, rx, ry) {
    // aviator teardrop: flat top, drooping toward the back
    g.beginPath();
    g.moveTo(cx - rx, cy - ry * 0.75);
    g.quadraticCurveTo(cx, cy - ry * 1.0, cx + rx, cy - ry * 0.8);
    g.quadraticCurveTo(cx + rx * 1.05, cy + ry * 0.2, cx + rx * 0.5, cy + ry * 0.75);
    g.quadraticCurveTo(cx - rx * 0.1, cy + ry * 1.25, cx - rx * 0.75, cy + ry * 0.55);
    g.quadraticCurveTo(cx - rx * 1.1, cy + ry * 0.1, cx - rx, cy - ry * 0.75);
    g.closePath();
  }
  function drawAviator(g, L, hh, frame, c0, c1, t) {
    var ex = EYE.x * L, ey = EYE.y * hh, er = eyeR(L);
    var rx = er * 1.95, ry = er * 1.3;
    var cx = ex + er * 0.15, cy = ey + er * 0.2;
    var fw = Math.max(1, L * 0.018);
    g.strokeStyle = frame; g.lineWidth = fw; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - rx, cy - ry * 0.6); g.lineTo(0.08 * L, ey - er * 0.1); g.stroke();
    g.beginPath(); g.moveTo(cx + rx * 0.95, cy - ry * 0.75); g.lineTo(0.485 * L, cy - ry * 0.55); g.stroke();
    lensPath(g, cx, cy, rx, ry);
    var lg = g.createLinearGradient(0, cy - ry, 0, cy + ry);
    lg.addColorStop(0, c0); lg.addColorStop(1, c1);
    g.fillStyle = lg; g.fill();
    g.save(); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.beginPath(); g.moveTo(cx + rx * 0.1, cy - ry); g.lineTo(cx + rx * 0.45, cy - ry); g.lineTo(cx - rx * 0.15, cy + ry); g.lineTo(cx - rx * 0.5, cy + ry); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath(); g.moveTo(cx + rx * 0.6, cy - ry); g.lineTo(cx + rx * 0.72, cy - ry); g.lineTo(cx + rx * 0.2, cy + ry); g.lineTo(cx + rx * 0.08, cy + ry); g.closePath(); g.fill();
    var sx = cx - rx * 2 + ((t * 0.3) % 1) * rx * 5;
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.moveTo(sx, cy - ry); g.lineTo(sx + rx * 0.2, cy - ry); g.lineTo(sx - rx * 0.3, cy + ry); g.lineTo(sx - rx * 0.5, cy + ry); g.closePath(); g.fill();
    g.restore();
    lensPath(g, cx, cy, rx, ry);
    g.strokeStyle = frame; g.lineWidth = fw; g.stroke();
    g.beginPath(); g.moveTo(cx - rx, cy - ry * 0.78); g.quadraticCurveTo(cx, cy - ry * 1.08, cx + rx, cy - ry * 0.83);
    g.lineWidth = fw * 1.8; g.stroke();
  }
  function drawMirror(g, L, hh, t) {
    var ex = EYE.x * L, ey = EYE.y * hh, er = eyeR(L);
    var x0 = ex - er * 1.9, x1 = 0.5 * L, y0 = ey - er * 1.2, y1 = ey + er * 1.15;
    g.strokeStyle = '#111'; g.lineWidth = Math.max(1, L * 0.02); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, ey - er * 0.6); g.lineTo(0.1 * L, ey - er * 0.3); g.stroke();
    g.beginPath();
    g.moveTo(x0, y0 + er * 0.2);
    g.quadraticCurveTo((x0 + x1) / 2, y0 - er * 0.3, x1 - er * 0.3, y0 + er * 0.3);
    g.lineTo(x1 - er * 0.6, y1 - er * 0.5);
    g.quadraticCurveTo((x0 + x1) / 2, y1 + er * 0.3, x0 + er * 0.2, y1);
    g.closePath();
    var mg = g.createLinearGradient(0, y0, 0, y1);
    mg.addColorStop(0, '#FF5AD8'); mg.addColorStop(0.45, '#7A6BFF'); mg.addColorStop(0.55, '#1A1A40'); mg.addColorStop(1, '#3CE0FF');
    g.fillStyle = mg; g.fill();
    g.strokeStyle = '#0A0A14'; g.lineWidth = Math.max(1, L * 0.016); g.stroke();
    g.save(); g.clip();
    var sx = x0 + ((t * 0.4) % 1.5) * (x1 - x0) * 1.3 - (x1 - x0) * 0.3;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.moveTo(sx, y0 - 2); g.lineTo(sx + er * 0.5, y0 - 2); g.lineTo(sx - er * 0.3, y1 + 2); g.lineTo(sx - er * 0.8, y1 + 2); g.closePath(); g.fill();
    g.restore();
  }
  function drawVisor(g, L, hh, t) {
    var ex = EYE.x * L, ey = EYE.y * hh, er = eyeR(L);
    var y0 = ey - er * 1.25, y1 = ey + er * 0.95;
    g.beginPath();
    g.moveTo(0.13 * L, y0 + er * 0.35);
    g.quadraticCurveTo(0.32 * L, y0 - er * 0.35, 0.5 * L, y0 + er * 0.6);
    g.lineTo(0.47 * L, y1 - er * 0.2);
    g.quadraticCurveTo(0.3 * L, y1 + er * 0.25, 0.13 * L, y1);
    g.closePath();
    var vg = g.createLinearGradient(0, y0, 0, y1);
    vg.addColorStop(0, 'rgba(20,10,40,0.92)'); vg.addColorStop(1, 'rgba(70,40,120,0.82)');
    g.fillStyle = vg; g.fill();
    g.strokeStyle = '#C9B6FF'; g.lineWidth = Math.max(1, L * 0.014); g.stroke();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(200,170,255,0.9)'; g.lineWidth = Math.max(1, L * 0.012);
    g.beginPath(); g.moveTo(0.13 * L, ey - er * 0.1); g.lineTo(0.5 * L, ey - er * 0.1); g.stroke();
    // glowing eye slit visible through the visor
    var pulse = 0.6 + 0.4 * Math.sin(t * 3);
    g.fillStyle = 'rgba(220,180,255,' + pulse + ')';
    g.fillRect(ex - er * 0.2, ey - er * 0.18, er * 1.1, er * 0.16);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(0.13 * L, y0 - er, 0.4 * L, er * 0.8);
    g.restore();
  }
  function drawHeadphones(g, L, hh, t) {
    var cx = 0.15 * L, cy = -0.18 * hh, r = L * 0.075;
    g.strokeStyle = '#151A24'; g.lineWidth = Math.max(1.5, L * 0.035); g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy - r * 0.6); g.bezierCurveTo(cx + 0.02 * L, -hh * 1.35, 0.3 * L, -hh * 1.35, 0.33 * L, -hh * 0.82); g.stroke();
    g.strokeStyle = '#3FF5FF'; g.lineWidth = Math.max(0.7, L * 0.01);
    g.stroke();
    g.fillStyle = '#151A24';
    g.beginPath(); g.ellipse(cx, cy, r * 0.8, r, 0, 0, TAU); g.fill();
    var p = 0.6 + 0.4 * Math.sin(t * 6);
    drawGlow(g, cx, cy, r * 2.2, '#3FF5FF', 0.35 * p);
    g.strokeStyle = 'rgba(63,245,255,' + (0.6 + 0.4 * p) + ')'; g.lineWidth = Math.max(1, L * 0.016);
    g.beginPath(); g.ellipse(cx, cy, r * 0.55, r * 0.72, 0, 0, TAU); g.stroke();
    g.fillStyle = '#FF3D7F';
    g.beginPath(); g.arc(cx, cy, r * 0.18, 0, TAU); g.fill();
  }
  function drawCap(g, L, hh) {
    // backwards cap: dome on the head, brim pointing back
    var top = -hh * 0.98;
    g.fillStyle = '#12161F';
    g.beginPath();
    g.moveTo(0.04 * L, top + hh * 0.22);
    g.quadraticCurveTo(-0.13 * L, top + hh * 0.05, -0.17 * L, top + hh * 0.2);
    g.quadraticCurveTo(-0.08 * L, top + hh * 0.34, 0.06 * L, top + hh * 0.36);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(0.02 * L, top + hh * 0.38);
    g.bezierCurveTo(0.04 * L, top - hh * 0.42, 0.38 * L, top - hh * 0.36, 0.42 * L, top + hh * 0.32);
    g.quadraticCurveTo(0.22 * L, top + hh * 0.18, 0.02 * L, top + hh * 0.38);
    g.closePath();
    var cg = g.createLinearGradient(0, top - hh * 0.4, 0, top + hh * 0.4);
    cg.addColorStop(0, '#2A3140'); cg.addColorStop(1, '#12161F');
    g.fillStyle = cg; g.fill();
    g.strokeStyle = '#3CE0B4'; g.lineWidth = Math.max(1, L * 0.018);
    g.beginPath(); g.moveTo(0.04 * L, top + hh * 0.3); g.quadraticCurveTo(0.22 * L, top + hh * 0.1, 0.41 * L, top + hh * 0.24); g.stroke();
    g.fillStyle = '#3CE0B4';
    g.beginPath(); g.arc(0.22 * L, top - hh * 0.2, L * 0.012, 0, TAU); g.fill();
    // snapback strap gap
    g.fillStyle = '#05463F';
    g.beginPath(); g.ellipse(0.06 * L, top + hh * 0.18, L * 0.025, hh * 0.08, 0, 0, TAU); g.fill();
  }
  function drawChain(g, L, hh, t) {
    var lw = Math.max(1.4, L * 0.032);
    var pts = [];
    for (var i = 0; i <= 10; i++) {
      var k = i / 10;
      pts.push([bez(0.24, 0.12, 0.08, 0.2, k) * L, bez(-0.78, -0.3, 0.5, 0.82, k) * hh]);
    }
    for (i = 0; i < pts.length; i++) {
      g.fillStyle = i & 1 ? '#B88600' : '#FFD54A';
      g.strokeStyle = '#7A5200'; g.lineWidth = Math.max(0.5, L * 0.006);
      g.beginPath(); g.ellipse(pts[i][0], pts[i][1], lw * 1.0, lw * 0.7, 1.3, 0, TAU); g.ellipse(pts[i][0], pts[i][1], lw * 0.45, lw * 0.25, 1.3, 0, TAU, true); g.fill('evenodd'); g.stroke();
    }
    // shark-tooth pendant
    var px = pts[5][0], py = pts[5][1] + lw;
    var sw = Math.sin(t * 3) * 0.15;
    g.save(); g.translate(px, py); g.rotate(sw);
    g.fillStyle = '#FFD54A'; g.beginPath(); g.arc(0, 0, lw * 0.9, 0, TAU); g.fill();
    g.fillStyle = '#FFFFFF'; g.strokeStyle = '#7A5200'; g.lineWidth = Math.max(0.5, L * 0.008);
    g.beginPath(); g.moveTo(-lw * 1.3, lw * 0.6); g.lineTo(lw * 1.3, lw * 0.6); g.lineTo(0, lw * 4.2); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  function drawGrillz(g, d, L, hh) {
    var x0 = 0.39 * L, x1 = 0.5 * L, y = 0.14 * hh;
    g.fillStyle = '#2A0A10';
    g.beginPath(); g.moveTo(x1, y - hh * 0.05); g.quadraticCurveTo(0.44 * L, y + hh * 0.2, x0, y + hh * 0.06); g.quadraticCurveTo(0.45 * L, y + hh * 0.04, x1, y - hh * 0.05); g.fill();
    var n = 4;
    for (var i = 0; i < n; i++) {
      var tx = x0 + (x1 - x0) * (i + 0.5) / n;
      var tw = (x1 - x0) / n * 0.9;
      g.fillStyle = i === 1 ? '#FFFFFF' : '#FFC83D';
      roundRect(g, tx - tw / 2, y - hh * 0.02, tw, hh * 0.1, tw * 0.25);
      g.beginPath(); roundRect(g, tx - tw / 2, y - hh * 0.02, tw, hh * 0.1, tw * 0.25); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(x0 + (x1 - x0) * 0.15, y - hh * 0.01, Math.max(0.6, L * 0.006), hh * 0.04);
  }
  function drawScar(g, L, hh) {
    var ex = EYE.x * L, ey = EYE.y * hh, er = eyeR(L);
    g.strokeStyle = 'rgba(255,230,215,0.85)'; g.lineWidth = Math.max(1, L * 0.016); g.lineCap = 'round';
    g.beginPath(); g.moveTo(ex - er * 0.9, ey - er * 2.1); g.lineTo(ex + er * 0.8, ey + er * 1.9); g.stroke();
    g.lineWidth = Math.max(0.7, L * 0.01);
    g.beginPath();
    for (var i = 0; i < 4; i++) {
      var k = 0.12 + i * 0.25;
      var x = ex - er * 0.9 + er * 1.7 * k, y = ey - er * 2.1 + er * 4 * k;
      if (Math.abs(y - ey) < er * 1.05) continue;
      g.moveTo(x - er * 0.4, y + er * 0.12); g.lineTo(x + er * 0.4, y - er * 0.12);
    }
    g.stroke();
  }
  function drawMohawk(g, d, L, hh, t) {
    var n = 6, col = d.pat === 'tiger' ? '#1A120C' : d.fin;
    for (var i = 0; i < n; i++) {
      var x = 0.38 * L - i * 0.06 * L;
      var bx = (EYE.x - 0.08) * L;
      var topY = -hh * (bez(0.6, 0.95, 1.0, 0.9, Math.min(1, Math.abs(x - 0.5 * L) / (0.5 * L))));
      var len = hh * (0.55 - Math.abs(i - 2) * 0.06) + Math.sin(t * 7 + i) * hh * 0.03;
      g.fillStyle = i & 1 ? col : '#FF3B4E';
      g.beginPath();
      g.moveTo(x + 0.04 * L, topY + hh * 0.12);
      g.lineTo(x - 0.04 * L, topY - len);
      g.lineTo(x - 0.035 * L, topY + hh * 0.15);
      g.closePath(); g.fill();
    }
  }
  function drawCollar(g, L, hh) {
    // leather jacket collar with studs around the gills
    g.fillStyle = '#1A1A1E';
    g.beginPath();
    g.moveTo(0.26 * L, -1.05 * hh);
    g.quadraticCurveTo(0.12 * L, -0.4 * hh, 0.16 * L, 0.2 * hh);
    g.lineTo(0.24 * L, 0.0);
    g.lineTo(0.2 * L, 0.95 * hh);
    g.lineTo(0.06 * L, 0.95 * hh);
    g.quadraticCurveTo(0.02 * L, 0, 0.12 * L, -1.05 * hh);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = Math.max(0.7, L * 0.01); g.stroke();
    g.fillStyle = '#D8DDE4';
    for (var i = 0; i < 5; i++) {
      var y = -0.75 * hh + i * 0.38 * hh;
      g.beginPath(); g.arc(0.12 * L + (i === 2 ? 0.05 * L : 0), y, Math.max(0.8, L * 0.014), 0, TAU); g.fill();
    }
    // popped lapel tip
    g.fillStyle = '#2A2A30';
    g.beginPath(); g.moveTo(0.16 * L, 0.2 * hh); g.lineTo(0.27 * L, 0.05 * hh); g.lineTo(0.22 * L, 0.45 * hh); g.closePath(); g.fill();
  }
  function drawHoop(g, L, hh, t) {
    var x = 0.19 * L, y = 0.05 * hh;
    g.strokeStyle = '#FFC83D'; g.lineWidth = Math.max(1, L * 0.014);
    g.beginPath(); g.arc(x, y + L * 0.04, L * 0.04, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = Math.max(0.5, L * 0.006);
    g.beginPath(); g.arc(x, y + L * 0.04, L * 0.04, 3.6, 4.6); g.stroke();
  }
  function drawNeonLines(g, L, hh, t) {
    var p = 0.7 + 0.3 * Math.sin(t * 4);
    g.lineCap = 'round';
    var lines = function () {
      g.beginPath();
      g.moveTo(0.44 * L, 0.3 * hh); g.quadraticCurveTo(0.1 * L, 0.5 * hh, -0.32 * L, 0.12 * hh);
      g.moveTo(0.2 * L, -0.7 * hh); g.quadraticCurveTo(-0.05 * L, -0.55 * hh, -0.3 * L, -0.12 * hh);
    };
    lines(); g.strokeStyle = 'rgba(198,107,255,' + 0.3 * p + ')'; g.lineWidth = L * 0.05; g.stroke();
    lines(); g.strokeStyle = 'rgba(230,180,255,' + p + ')'; g.lineWidth = Math.max(0.8, L * 0.014); g.stroke();
  }
  function drawCrown(g, L, hh, t) {
    var bx = 0.2 * L, by = -0.92 * hh, w = 0.22 * L, h = 0.13 * L;
    g.save(); g.translate(bx, by); g.rotate(0.18);
    g.beginPath();
    g.moveTo(-w / 2, 0); g.lineTo(-w / 2, -h * 0.85); g.lineTo(-w / 4, -h * 0.45); g.lineTo(0, -h * 1.1); g.lineTo(w / 4, -h * 0.45); g.lineTo(w / 2, -h * 0.85); g.lineTo(w / 2, 0);
    g.closePath();
    var cg = g.createLinearGradient(0, -h, 0, 0);
    cg.addColorStop(0, '#FFF2A8'); cg.addColorStop(0.5, '#FFC83D'); cg.addColorStop(1, '#C58A00');
    g.fillStyle = cg; g.fill();
    g.strokeStyle = '#7A5200'; g.lineWidth = Math.max(0.8, L * 0.01); g.stroke();
    g.fillStyle = '#FF3D7F'; g.beginPath(); g.arc(0, -h * 0.25, h * 0.13, 0, TAU); g.fill();
    g.fillStyle = '#3FB8FF'; g.beginPath(); g.arc(-w * 0.3, -h * 0.22, h * 0.09, 0, TAU); g.arc(w * 0.3, -h * 0.22, h * 0.09, 0, TAU); g.fill();
    g.fillStyle = '#FFFFFF';
    [[-w / 2, -h * 0.85], [0, -h * 1.1], [w / 2, -h * 0.85]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], h * 0.08, 0, TAU); g.fill(); });
    var tw = Math.max(0, Math.sin(t * 2.5));
    g.fillStyle = 'rgba(255,255,255,' + tw + ')';
    star4(g, w * 0.32, -h * 0.9, h * 0.35 * tw);
    g.restore();
  }
  function drawTattoo(g, d, cx, cy, s) {
    g.save();
    g.globalAlpha *= 0.85;
    g.fillStyle = d.line === '#7A2600' ? '#1A0A04' : d.line;
    if (d.tat === 'bolt') {
      g.beginPath(); g.moveTo(cx + s * 0.2, cy - s); g.lineTo(cx - s * 0.5, cy + s * 0.1); g.lineTo(cx, cy + s * 0.1); g.lineTo(cx - s * 0.2, cy + s); g.lineTo(cx + s * 0.5, cy - s * 0.15); g.lineTo(cx, cy - s * 0.15); g.closePath(); g.fill();
    } else if (d.tat === 'star') {
      g.fillStyle = '#2A1468';
      g.beginPath();
      for (var k = 0; k < 10; k++) { var a = k * Math.PI / 5 - Math.PI / 2, r = k & 1 ? s * 0.42 : s; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.closePath(); g.fill();
    } else if (d.tat === 'flame') {
      g.fillStyle = '#C0140F';
      g.beginPath(); g.moveTo(cx - s * 0.6, cy + s * 0.7);
      g.quadraticCurveTo(cx - s * 0.8, cy - s * 0.2, cx - s * 0.1, cy - s);
      g.quadraticCurveTo(cx - s * 0.1, cy - s * 0.3, cx + s * 0.3, cy - s * 0.5);
      g.quadraticCurveTo(cx + s * 0.8, cy + s * 0.1, cx + s * 0.5, cy + s * 0.7);
      g.closePath(); g.fill();
      g.fillStyle = '#FFC83D';
      g.beginPath(); g.ellipse(cx, cy + s * 0.3, s * 0.25, s * 0.35, 0, 0, TAU); g.fill();
    }
    g.restore();
  }
  function hasGear(d, n) { return d.gear && d.gear.indexOf(n) >= 0; }
  function drawHeadGear(g, d, L, hh, t) {
    if (hasGear(d, 'scar')) drawScar(g, L, hh);
    if (hasGear(d, 'aviator')) drawAviator(g, L, hh, '#FFC83D', '#140804', '#B8501A', t);
    if (hasGear(d, 'aviatorDark')) drawAviator(g, L, hh, '#D8DDE4', '#050507', '#3A4458', t);
    if (hasGear(d, 'aviatorPink')) drawAviator(g, L, hh, '#FFC83D', '#3A0420', '#FF5AA0', t);
    if (hasGear(d, 'mirror')) drawMirror(g, L, hh, t);
    if (hasGear(d, 'visor')) drawVisor(g, L, hh, t);
    if (hasGear(d, 'headphones')) drawHeadphones(g, L, hh, t);
    if (hasGear(d, 'cap')) drawCap(g, L, hh);
    if (hasGear(d, 'crown')) drawCrown(g, L, hh, t);
    if (hasGear(d, 'hoop')) drawHoop(g, L, hh, t);
  }

  function drawFishWhole(g, d, L, hh, t, opts) {
    var wag = Math.sin(t * 9) * 0.32;
    var flut = Math.sin(t * 6.5);
    var lw = Math.max(0.8, L * 0.016);
    var finA = d.finA || 0.92;
    g.lineJoin = 'round';

    // anal/pelvic fin (behind body)
    g.fillStyle = finFill(g, d, L, hh, finA);
    g.beginPath();
    g.moveTo(-0.06 * L, 0.82 * hh);
    g.quadraticCurveTo(-0.14 * L, (1.25 + flut * 0.06) * hh, -0.22 * L, (1.15 + flut * 0.08) * hh);
    g.quadraticCurveTo(-0.2 * L, 0.8 * hh, -0.24 * L, 0.5 * hh);
    g.closePath();
    g.fill();
    // dorsal fin
    var dh = d.tail === 'flow' ? 0.75 : 0.5;
    g.beginPath();
    g.moveTo(0.14 * L, -0.9 * hh);
    g.quadraticCurveTo(0.02 * L, -(1.25 + dh * 0.4) * hh - flut * L * 0.01, -0.1 * L + flut * L * 0.012, -(1 + dh) * hh);
    g.quadraticCurveTo(-0.18 * L, -1.0 * hh, -0.26 * L, -0.55 * hh);
    g.closePath();
    g.fillStyle = finFill(g, d, L, hh, finA);
    g.fill();
    g.strokeStyle = rgba(d.finEdge, 0.65);
    g.lineWidth = lw;
    g.stroke();
    if (d.pat === 'rainbow') { g.save(); g.clip(); g.globalAlpha = 0.5; g.fillStyle = rainbowFill(g, L, hh * 1.8); g.fillRect(-0.3 * L, -2 * hh, 0.5 * L, 1.5 * hh); g.restore(); }
    // fin rays
    g.strokeStyle = rgba(d.line, 0.18);
    g.lineWidth = Math.max(0.5, L * 0.007);
    g.beginPath();
    for (var r = 0; r < 4; r++) {
      var fx = 0.08 * L - r * 0.07 * L;
      g.moveTo(fx, -0.9 * hh); g.lineTo(fx - 0.06 * L, -(1.15 + dh * 0.6) * hh + r * 0.1 * hh);
    }
    g.stroke();
    if (d.tat) drawTattoo(g, d, -0.07 * L, -(1.12 + dh * 0.25) * hh, Math.max(1.5, L * 0.045));
    if (hasGear(d, 'mohawk')) drawMohawk(g, d, L, hh, t);

    // tail (rotates around peduncle)
    g.save();
    g.translate(-0.3 * L, 0);
    g.rotate(wag);
    g.translate(0.3 * L, 0);
    fishTailPath(g, L, hh, d.tail);
    g.fillStyle = finFill(g, d, L, hh, finA);
    g.fill();
    if (d.pat === 'rainbow') { g.save(); g.clip(); g.globalAlpha = 0.85; g.fillStyle = rainbowFill(g, L, hh * 1.2); g.fillRect(-0.7 * L, -2 * hh, 0.5 * L, 4 * hh); g.restore(); }
    if (d.pat === 'zebra' || d.pat === 'tiger') {
      g.save(); g.clip();
      g.fillStyle = '#15171A';
      g.fillRect(-0.47 * L, -2 * hh, 0.04 * L, 4 * hh);
      g.fillRect(-0.6 * L, -2 * hh, 0.07 * L, 4 * hh);
      g.restore();
    }
    g.strokeStyle = rgba(d.finEdge, 0.7);
    g.lineWidth = lw;
    g.stroke();
    g.strokeStyle = rgba(d.line, 0.2);
    g.lineWidth = Math.max(0.5, L * 0.007);
    g.beginPath();
    for (var k = -2; k <= 2; k++) { g.moveTo(-0.31 * L, k * 0.05 * hh); g.lineTo(-0.48 * L, k * 0.38 * hh); }
    g.stroke();
    g.restore();

    // body
    fishBodyPath(g, L, hh);
    var bg;
    if (d.pat === 'rainbow') {
      bg = rainbowFill(g, L, hh);
    } else {
      bg = g.createLinearGradient(0, -hh, 0, hh);
      bg.addColorStop(0, d.top);
      bg.addColorStop(0.45, d.mid);
      bg.addColorStop(1, d.belly);
    }
    if (d.crystal) {
      g.save();
      g.globalAlpha *= 0.55;
      g.fillStyle = bg;
      g.fill();
      g.restore();
    } else {
      g.fillStyle = bg;
      g.fill();
    }
    g.save();
    g.clip();
    drawPattern(g, d, L, hh, t, null);
    // volume shading: light from above-front, body rounds off into shadow toward belly and tail
    var sg = g.createRadialGradient(0.14 * L, -0.45 * hh, hh * 0.15, 0.02 * L, 0.05 * hh, L * 0.62);
    sg.addColorStop(0, 'rgba(255,255,255,0.10)');
    sg.addColorStop(0.45, 'rgba(0,0,0,0)');
    sg.addColorStop(0.8, 'rgba(0,6,30,0.20)');
    sg.addColorStop(1, 'rgba(0,6,30,0.38)');
    g.fillStyle = sg;
    g.fillRect(-0.5 * L, -hh, L, hh * 2);
    // specular streak along the back
    var hg = g.createLinearGradient(0, -0.85 * hh, 0, -0.25 * hh);
    hg.addColorStop(0, 'rgba(255,255,255,0.42)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg;
    g.beginPath();
    g.ellipse(0.1 * L, -0.55 * hh, 0.3 * L, 0.24 * hh, -0.06, 0, TAU);
    g.fill();
    // bounce light from below (water colour) for a rounder belly
    g.strokeStyle = 'rgba(200,240,255,0.28)';
    g.lineWidth = Math.max(1, L * 0.03);
    g.beginPath();
    g.moveTo(0.36 * L, 0.62 * hh);
    g.quadraticCurveTo(0.1 * L, 1.0 * hh, -0.2 * L, 0.6 * hh);
    g.stroke();
    // thin rim light just inside the upper outline
    g.save();
    g.beginPath(); g.rect(-0.6 * L, -1.3 * hh, 1.2 * L, 1.0 * hh); g.clip();
    g.translate(-lw * 0.4, lw * 1.5);
    fishBodyPath(g, L, hh);
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = lw * 1.4;
    g.stroke();
    g.restore();
    // gill arc
    g.strokeStyle = rgba(d.line, 0.35);
    g.lineWidth = Math.max(0.7, L * 0.014);
    g.beginPath();
    g.moveTo(0.2 * L, -0.62 * hh);
    g.quadraticCurveTo(0.12 * L, 0.05 * hh, 0.2 * L, 0.65 * hh);
    g.stroke();
    g.restore();
    // outline
    fishBodyPath(g, L, hh);
    g.strokeStyle = rgba(d.line, d.crystal ? 0.9 : 0.55);
    g.lineWidth = lw;
    g.stroke();

    if (hasGear(d, 'neonlines')) { g.save(); fishBodyPath(g, L, hh); g.clip(); drawNeonLines(g, L, hh, t); g.restore(); }
    if (hasGear(d, 'collar')) drawCollar(g, L, hh);
    if (hasGear(d, 'chain')) drawChain(g, L, hh, t);

    // mouth: flat smirk (or gold grillz)
    if (hasGear(d, 'grillz')) {
      drawGrillz(g, d, L, hh);
    } else {
      g.strokeStyle = rgba(d.line, 0.8);
      g.lineWidth = Math.max(0.8, L * 0.016);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0.495 * L, 0.1 * hh);
      g.quadraticCurveTo(0.45 * L, 0.18 * hh, 0.4 * L, 0.11 * hh);
      g.stroke();
    }

    drawEye(g, d, L, hh, t);
    drawHeadGear(g, d, L, hh, t);

    // pectoral fin (in front of body)
    g.save();
    g.translate(0.12 * L, 0.22 * hh);
    g.rotate(0.35 + Math.sin(t * 8) * 0.28);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(-0.08 * L, -0.1 * L, -0.17 * L, -0.02 * L);
    g.quadraticCurveTo(-0.09 * L, 0.06 * L, 0, 0);
    g.closePath();
    g.fillStyle = rgba(mix(d.fin, '#FFFFFF', 0.2), Math.min(1, finA * 0.95));
    g.fill();
    g.strokeStyle = rgba(d.finEdge, 0.7);
    g.lineWidth = Math.max(0.6, L * 0.01);
    g.stroke();
    g.restore();

    // ninja headband tails
    if (d.pat === 'ninja') {
      g.fillStyle = '#FF2E46';
      for (var q = 0; q < 2; q++) {
        var ph = t * 7 + q * 1.3;
        g.beginPath();
        g.moveTo(0.1 * L, -0.42 * hh + q * 0.12 * hh);
        g.quadraticCurveTo(0.0, (-0.95 - q * 0.2) * hh + Math.sin(ph) * hh * 0.25, -0.16 * L, (-1.1 - q * 0.15) * hh + Math.sin(ph + 1) * hh * 0.35);
        g.quadraticCurveTo(-0.02 * L, (-0.8 - q * 0.2) * hh + Math.sin(ph) * hh * 0.2, 0.12 * L, -0.28 * hh + q * 0.12 * hh);
        g.closePath();
        g.fill();
      }
    }
    // crystal sparkles
    if (d.crystal) {
      for (var s = 0; s < 6; s++) {
        var ph2 = (t * 1.2 + hash(s + 5)) % 1;
        var a = Math.sin(ph2 * Math.PI);
        var sx = (0.4 - hash(s + 11) * 0.8) * L;
        var sy = (hash(s + 21) * 1.6 - 0.8) * hh;
        g.fillStyle = 'rgba(255,255,255,' + a + ')';
        star4(g, sx, sy, L * 0.06 * a + 0.5);
      }
    }
  }

  function drawSkeleton(g, L, hh, t) {
    var bone = '#F2EBDC', edge = '#7D7262';
    var wag = Math.sin(t * 4) * 0.2;
    var lw = Math.max(1, L * 0.028);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // tail bones
    g.save();
    g.translate(-0.3 * L, 0); g.rotate(wag); g.translate(0.3 * L, 0);
    g.strokeStyle = edge; g.lineWidth = lw * 1.6;
    g.beginPath();
    for (var k = -2; k <= 2; k++) { g.moveTo(-0.3 * L, 0); g.lineTo(-0.48 * L, k * 0.42 * hh); }
    g.stroke();
    g.strokeStyle = bone; g.lineWidth = lw;
    g.stroke();
    g.restore();
    // spine + ribs
    g.strokeStyle = edge; g.lineWidth = lw * 1.9;
    var path = function () {
      g.beginPath();
      g.moveTo(0.2 * L, 0); g.lineTo(-0.3 * L, 0);
      for (var i = 0; i < 6; i++) {
        var x = 0.14 * L - i * 0.075 * L;
        var len = (1 - i / 7) * 0.9 * hh;
        g.moveTo(x, 0); g.quadraticCurveTo(x - 0.05 * L, -len * 0.6, x - 0.02 * L, -len);
        g.moveTo(x, 0); g.quadraticCurveTo(x - 0.05 * L, len * 0.6, x - 0.02 * L, len);
      }
    };
    path(); g.stroke();
    g.strokeStyle = bone; g.lineWidth = lw * 1.1; path(); g.stroke();
    // skull
    g.beginPath();
    g.moveTo(0.18 * L, -0.7 * hh);
    g.quadraticCurveTo(0.42 * L, -0.65 * hh, 0.5 * L, 0.04 * hh);
    g.quadraticCurveTo(0.42 * L, 0.6 * hh, 0.18 * L, 0.62 * hh);
    g.quadraticCurveTo(0.12 * L, 0, 0.18 * L, -0.7 * hh);
    g.closePath();
    g.fillStyle = bone; g.fill();
    g.strokeStyle = edge; g.lineWidth = Math.max(0.8, L * 0.016); g.stroke();
    g.fillStyle = '#2A2620';
    g.beginPath(); g.arc(0.31 * L, -0.2 * hh, L * 0.055, 0, TAU); g.fill();
    g.strokeStyle = edge;
    g.beginPath(); g.moveTo(0.49 * L, 0.12 * hh); g.lineTo(0.38 * L, 0.2 * hh); g.stroke();
  }

  function drawFish(ctx, x, y, size, fishId, t, opts) {
    opts = opts || {};
    t = t || 0;
    var d = FDEF[fishId] || FDEF.blixt;
    var L = Math.max(4, size);
    var hh = L * d.h * 0.5;
    var part = opts.part || 'whole';
    ctx.save();
    ctx.translate(x, y);
    if (opts.angle) ctx.rotate(opts.angle);
    if (opts.alpha != null) ctx.globalAlpha *= Math.max(0, Math.min(1, opts.alpha));
    if (part === 'skeleton') {
      drawSkeleton(ctx, L, hh, t);
      ctx.restore();
      return;
    }
    // swim wobble
    ctx.rotate(Math.sin(t * 9 + 1.2) * 0.025);
    var cutX = -0.04 * L, zz = 0.035 * L;
    if (part === 'front' || part === 'back') {
      ctx.beginPath();
      var n = 0;
      for (var yy = -1.2 * L; yy <= 1.2 * L; yy += 0.06 * L, n++) ctx.lineTo(cutX + (n & 1 ? zz : -zz), yy);
      var far = part === 'front' ? 2 * L : -2 * L;
      ctx.lineTo(far, 1.2 * L);
      ctx.lineTo(far, -1.2 * L);
      ctx.closePath();
      ctx.clip();
    }
    drawFishWhole(ctx, d, L, hh, part === 'whole' ? t : t * 0.4, opts);
    if (part === 'front' || part === 'back') {
      // clean cartoon bite edge (no blood)
      ctx.save();
      fishBodyPath(ctx, L, hh);
      ctx.clip();
      ctx.beginPath();
      n = 0;
      for (yy = -1.2 * L; yy <= 1.2 * L; yy += 0.06 * L, n++) ctx.lineTo(cutX + (n & 1 ? zz : -zz), yy);
      ctx.strokeStyle = '#FFF1E2';
      ctx.lineWidth = L * 0.05;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.strokeStyle = rgba(d.line, 0.5);
      ctx.lineWidth = L * 0.012;
      ctx.stroke();
      ctx.restore();
    }
    if (opts.flash) {
      ctx.globalAlpha *= 0.65;
      ctx.fillStyle = '#FFFFFF';
      fishBodyPath(ctx, L, hh);
      ctx.fill();
    }
    ctx.restore();
  }

  // ================================================================== SHARK
  var SH = { top: '#405A75', mid: '#6A86A3', belly: '#E4EDF4', line: '#16212E', fin: '#3A5370' };

  function sharkBody(g, s) {
    g.beginPath();
    g.moveTo(0.5 * s, -0.005 * s);
    g.bezierCurveTo(0.46 * s, -0.075 * s, 0.32 * s, -0.138 * s, 0.12 * s, -0.152 * s);
    g.bezierCurveTo(-0.08 * s, -0.162 * s, -0.24 * s, -0.1 * s, -0.36 * s, -0.034 * s);
    g.lineTo(-0.36 * s, 0.022 * s);
    g.bezierCurveTo(-0.24 * s, 0.075 * s, -0.08 * s, 0.128 * s, 0.08 * s, 0.122 * s);
    g.bezierCurveTo(0.2 * s, 0.118 * s, 0.27 * s, 0.09 * s, 0.3 * s, 0.062 * s);
    g.bezierCurveTo(0.38 * s, 0.048 * s, 0.46 * s, 0.038 * s, 0.5 * s, -0.005 * s);
    g.closePath();
  }
  // upper jaw underside points (for teeth): cubic from (0.30,0.062) to (0.5,-0.005)
  function upperJaw(tt, s) {
    return [bez(0.3, 0.38, 0.46, 0.5, tt) * s, bez(0.062, 0.048, 0.038, -0.005, tt) * s];
  }

  function drawShark(ctx, x, y, size, t, opts) {
    opts = opts || {};
    t = t || 0;
    var s = Math.max(10, size);
    var mouth = Math.max(0, Math.min(1, opts.mouth || 0));
    var g = ctx;
    var lw = Math.max(1, s * 0.006);
    g.save();
    g.translate(x, y);
    if (opts.angle) g.rotate(opts.angle);
    var dizzy = !!opts.dizzy;
    g.rotate(Math.sin(t * 5 + 0.5) * 0.02);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // ---- tail
    g.save();
    g.translate(-0.35 * s, 0);
    g.rotate(Math.sin(t * 5) * 0.22);
    g.translate(0.35 * s, 0);
    g.beginPath();
    g.moveTo(-0.33 * s, -0.036 * s);
    g.quadraticCurveTo(-0.45 * s, -0.12 * s, -0.6 * s, -0.27 * s);
    g.lineTo(-0.57 * s, -0.2 * s);
    g.lineTo(-0.545 * s, -0.205 * s);
    g.lineTo(-0.55 * s, -0.165 * s);
    g.quadraticCurveTo(-0.51 * s, -0.08 * s, -0.48 * s, -0.005 * s);
    g.quadraticCurveTo(-0.52 * s, 0.06 * s, -0.56 * s, 0.16 * s);
    g.quadraticCurveTo(-0.44 * s, 0.09 * s, -0.33 * s, 0.026 * s);
    g.closePath();
    var tg = g.createLinearGradient(0, -0.27 * s, 0, 0.16 * s);
    tg.addColorStop(0, SH.fin); tg.addColorStop(1, SH.mid);
    g.fillStyle = tg; g.fill();
    g.strokeStyle = SH.line; g.lineWidth = lw; g.stroke();
    g.restore();

    // ---- far-side pectoral (darker, behind)
    g.save();
    g.translate(0.1 * s, 0.08 * s);
    g.rotate(-0.2 + Math.sin(t * 3 + 1) * 0.1);
    g.beginPath();
    g.moveTo(0, 0); g.quadraticCurveTo(-0.04 * s, 0.08 * s, -0.12 * s, 0.15 * s); g.quadraticCurveTo(-0.06 * s, 0.05 * s, 0.03 * s, 0.01 * s);
    g.closePath();
    g.fillStyle = mix(SH.fin, '#000000', 0.35); g.fill();
    g.restore();

    // ---- dorsal + small fins
    g.beginPath();
    g.moveTo(0.1 * s, -0.148 * s);
    g.quadraticCurveTo(0.0, -0.2 * s, -0.075 * s, -0.315 * s);
    g.lineTo(-0.088 * s, -0.322 * s);
    g.lineTo(-0.086 * s, -0.3 * s);
    // torn trailing edge (old battle bites)
    g.lineTo(-0.084 * s, -0.285 * s);
    g.lineTo(-0.1 * s, -0.27 * s);
    g.lineTo(-0.086 * s, -0.25 * s);
    g.quadraticCurveTo(-0.08 * s, -0.22 * s, -0.095 * s, -0.2 * s);
    g.lineTo(-0.113 * s, -0.19 * s);
    g.lineTo(-0.1 * s, -0.172 * s);
    g.quadraticCurveTo(-0.11 * s, -0.15 * s, -0.13 * s, -0.135 * s);
    g.closePath();
    var dg = g.createLinearGradient(0, -0.33 * s, 0, -0.13 * s);
    dg.addColorStop(0, '#2E4560'); dg.addColorStop(1, SH.top);
    g.fillStyle = dg; g.fill();
    g.strokeStyle = SH.line; g.lineWidth = lw; g.stroke();
    g.beginPath();
    g.moveTo(-0.22 * s, -0.098 * s); g.quadraticCurveTo(-0.26 * s, -0.13 * s, -0.29 * s, -0.15 * s); g.lineTo(-0.27 * s, -0.075 * s); g.closePath();
    g.fillStyle = SH.fin; g.fill(); g.stroke();
    g.beginPath();
    g.moveTo(-0.17 * s, 0.1 * s); g.quadraticCurveTo(-0.22 * s, 0.14 * s, -0.25 * s, 0.15 * s); g.lineTo(-0.24 * s, 0.075 * s); g.closePath();
    g.fillStyle = SH.mid; g.fill(); g.stroke();

    // ---- mouth interior + lower jaw
    var hx = 0.29 * s, hy = 0.058 * s;
    var ja = mouth * 0.62;
    var ca = Math.cos(ja), sa = Math.sin(ja);
    function jawPt(px, py) { return [hx + px * ca - py * sa, hy + px * sa + py * ca]; }
    if (mouth > 0.02) {
      var tip = jawPt(0.17 * s, -0.004 * s);
      g.beginPath();
      g.moveTo(hx - 0.01 * s, hy);
      for (var i = 0; i <= 8; i++) { var p = upperJaw(i / 8, s); g.lineTo(p[0], p[1]); }
      g.lineTo(tip[0], tip[1]);
      g.closePath();
      var mg = g.createLinearGradient(hx, hy, hx + 0.12 * s, hy + 0.08 * s);
      mg.addColorStop(0, '#22060F'); mg.addColorStop(1, '#5A1A2C');
      g.fillStyle = mg; g.fill();
      // tongue
      g.fillStyle = '#B04A62';
      g.beginPath();
      var tq = jawPt(0.07 * s, -0.012 * s);
      g.ellipse(tq[0], tq[1], 0.06 * s, 0.016 * s, ja, 0, TAU);
      g.fill();
    }
    g.save();
    g.translate(hx, hy);
    g.rotate(ja);
    // lower teeth (pointing up)
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = 'rgba(40,40,60,0.5)';
    g.lineWidth = Math.max(0.5, s * 0.002);
    for (i = 0; i < 6; i++) {
      var tx = 0.035 * s + i * 0.024 * s;
      var th = 0.018 * s * (1 - i * 0.06);
      g.beginPath();
      g.moveTo(tx - 0.009 * s, 0.002 * s);
      g.lineTo(tx, -th);
      g.lineTo(tx + 0.009 * s, 0.002 * s);
      g.closePath(); g.fill(); g.stroke();
    }
    g.beginPath();
    g.moveTo(-0.03 * s, -0.004 * s);
    g.lineTo(0.17 * s, -0.004 * s);
    g.quadraticCurveTo(0.16 * s, 0.025 * s, 0.1 * s, 0.045 * s);
    g.quadraticCurveTo(0.03 * s, 0.06 * s, -0.04 * s, 0.05 * s);
    g.closePath();
    var lg = g.createLinearGradient(0, -0.004 * s, 0, 0.06 * s);
    lg.addColorStop(0, '#C9D6E2'); lg.addColorStop(1, SH.belly);
    g.fillStyle = lg; g.fill();
    g.strokeStyle = SH.line; g.lineWidth = lw; g.stroke();
    g.restore();

    // ---- body
    sharkBody(g, s);
    var bgr = g.createLinearGradient(0, -0.16 * s, 0, 0.12 * s);
    bgr.addColorStop(0, '#2E4560'); bgr.addColorStop(0.35, SH.mid); bgr.addColorStop(1, '#8EA5BC');
    g.fillStyle = bgr; g.fill();
    g.save();
    g.clip();
    // belly countershading with wavy edge
    g.beginPath();
    g.moveTo(0.56 * s, 0.0);
    g.bezierCurveTo(0.4 * s, 0.035 * s, 0.32 * s, 0.01 * s, 0.2 * s, 0.035 * s);
    g.bezierCurveTo(0.08 * s, 0.06 * s, -0.05 * s, 0.03 * s, -0.16 * s, 0.05 * s);
    g.bezierCurveTo(-0.26 * s, 0.065 * s, -0.33 * s, 0.03 * s, -0.4 * s, 0.03 * s);
    g.lineTo(-0.4 * s, 0.3 * s); g.lineTo(0.56 * s, 0.3 * s); g.closePath();
    g.fillStyle = SH.belly; g.fill();
    // volume: darker toward the tail and underside edge, lit snout/back
    var vs = g.createRadialGradient(0.2 * s, -0.07 * s, 0.02 * s, 0.05 * s, 0, 0.5 * s);
    vs.addColorStop(0, 'rgba(255,255,255,0.08)');
    vs.addColorStop(0.5, 'rgba(0,0,0,0)');
    vs.addColorStop(1, 'rgba(5,12,28,0.42)');
    g.fillStyle = vs; g.fillRect(-0.4 * s, -0.2 * s, 0.96 * s, 0.4 * s);
    // top sheen
    var shg = g.createLinearGradient(0, -0.15 * s, 0, -0.07 * s);
    shg.addColorStop(0, 'rgba(255,255,255,0.28)'); shg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = shg;
    g.beginPath(); g.ellipse(0.12 * s, -0.11 * s, 0.3 * s, 0.04 * s, -0.05, 0, TAU); g.fill();
    // rim light inside the back outline
    g.save();
    g.beginPath(); g.rect(-0.4 * s, -0.2 * s, 0.96 * s, 0.17 * s); g.clip();
    g.translate(0, lw * 2.2);
    sharkBody(g, s);
    g.strokeStyle = 'rgba(200,230,255,0.35)'; g.lineWidth = lw * 2; g.stroke();
    g.restore();
    // gills
    g.strokeStyle = 'rgba(15,25,40,0.45)';
    g.lineWidth = Math.max(0.8, s * 0.006);
    for (i = 0; i < 4; i++) {
      var gx = 0.21 * s - i * 0.022 * s;
      g.beginPath(); g.moveTo(gx + 0.008 * s, -0.06 * s); g.quadraticCurveTo(gx - 0.012 * s, 0.0, gx + 0.004 * s, 0.07 * s); g.stroke();
    }
    // battle scars: claw scratches on the back and a nick near the gills
    var scar = function (x0, y0, x1, y1, w) {
      g.strokeStyle = 'rgba(20,30,45,0.35)'; g.lineWidth = w * 1.8;
      g.beginPath(); g.moveTo(x0 * s, y0 * s); g.lineTo(x1 * s, y1 * s); g.stroke();
      g.strokeStyle = 'rgba(230,236,242,0.85)'; g.lineWidth = w;
      g.beginPath(); g.moveTo(x0 * s, y0 * s); g.lineTo(x1 * s, y1 * s); g.stroke();
    };
    var sw2 = Math.max(1, s * 0.005);
    scar(-0.02, -0.14, 0.03, -0.075, sw2);
    scar(0.01, -0.145, 0.06, -0.08, sw2);
    scar(0.04, -0.148, 0.085, -0.09, sw2);
    scar(-0.2, -0.06, -0.14, -0.035, sw2 * 0.8);
    g.restore();
    sharkBody(g, s);
    g.strokeStyle = SH.line; g.lineWidth = lw * 1.2; g.stroke();

    // upper teeth (pointing down)
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = 'rgba(40,40,60,0.55)';
    g.lineWidth = Math.max(0.5, s * 0.002);
    for (i = 0; i < 7; i++) {
      var tt0 = 0.08 + i * 0.12;
      var p0 = upperJaw(tt0 - 0.045, s), p1 = upperJaw(tt0 + 0.045, s), pm = upperJaw(tt0, s);
      var tl = 0.022 * s * (1 - Math.abs(i - 3) * 0.08);
      g.beginPath();
      g.moveTo(p0[0], p0[1] - 0.002 * s);
      g.lineTo(pm[0] - 0.002 * s, pm[1] + tl);
      g.lineTo(p1[0], p1[1] - 0.002 * s);
      g.closePath(); g.fill(); g.stroke();
    }
    // nostril
    g.fillStyle = 'rgba(15,25,40,0.6)';
    g.beginPath(); g.ellipse(0.445 * s, 0.006 * s, 0.009 * s, 0.004 * s, -0.3, 0, TAU); g.fill();

    // ---- eye
    var ex = 0.33 * s, ey = -0.06 * s, er = 0.025 * s;
    if (dizzy) {
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.arc(ex, ey, er * 1.25, 0, TAU); g.fill();
      g.strokeStyle = SH.line; g.lineWidth = Math.max(1, s * 0.005);
      g.beginPath();
      for (i = 0; i < 40; i++) {
        var aa = i * 0.45 + t * 9, rr = er * 1.1 * (i / 40);
        g.lineTo(ex + Math.cos(aa) * rr, ey + Math.sin(aa) * rr);
      }
      g.stroke();
    } else {
      g.fillStyle = '#F4F1D8';
      g.beginPath(); g.arc(ex, ey, er, 0, TAU); g.fill();
      var eg = g.createRadialGradient(ex + er * 0.2, ey, 0, ex + er * 0.2, ey, er * 0.85);
      eg.addColorStop(0, '#FFE066'); eg.addColorStop(1, '#E08A00');
      g.fillStyle = eg;
      g.beginPath(); g.arc(ex + er * 0.15, ey + er * 0.05, er * 0.8, 0, TAU); g.fill();
      g.fillStyle = '#0A0A0A';
      g.beginPath(); g.ellipse(ex + er * 0.25, ey + er * 0.05, er * 0.2, er * 0.7, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath(); g.arc(ex + er * 0.45, ey - er * 0.35, er * 0.22, 0, TAU); g.fill();
      regGlow(g, ex, ey, er * 5, '#FF7A3A', 0.6);
    }
    // angry brow
    g.strokeStyle = '#142030';
    g.lineWidth = Math.max(1.8, s * 0.016);
    g.beginPath();
    g.moveTo(ex - er * 1.7, ey - er * 1.55);
    g.quadraticCurveTo(ex, ey - er * 1.5, ex + er * 1.5, ey - er * 0.6);
    g.stroke();

    // boss scar straight over the eye, with stitches
    if (!opts.inked) {
      g.strokeStyle = 'rgba(235,240,245,0.9)'; g.lineWidth = Math.max(1.2, s * 0.006);
      g.beginPath(); g.moveTo(ex - er * 1.2, ey - er * 2.6); g.lineTo(ex + er * 1.4, ey + er * 2.2); g.stroke();
      g.lineWidth = Math.max(0.8, s * 0.004);
      g.beginPath();
      [[-0.75, -1.75], [0.85, 1.2], [1.2, 1.85]].forEach(function (q) {
        var qx = ex + er * q[0], qy = ey + er * q[1];
        g.moveTo(qx - er * 0.45, qy + er * 0.2); g.lineTo(qx + er * 0.45, qy - er * 0.2);
      });
      g.stroke();
    }

    // ---- near pectoral fin
    g.save();
    g.translate(0.15 * s, 0.085 * s);
    g.rotate(Math.sin(t * 3) * 0.12);
    g.beginPath();
    g.moveTo(0.01 * s, 0);
    g.quadraticCurveTo(-0.03 * s, 0.11 * s, -0.17 * s, 0.19 * s);
    g.quadraticCurveTo(-0.08 * s, 0.06 * s, -0.08 * s, 0.01 * s);
    g.closePath();
    var pg = g.createLinearGradient(0, 0, 0, 0.19 * s);
    pg.addColorStop(0, SH.mid); pg.addColorStop(1, '#2E4560');
    g.fillStyle = pg; g.fill();
    g.strokeStyle = SH.line; g.lineWidth = lw; g.stroke();
    g.restore();

    // ---- ink cloud over the eyes
    if (opts.inked) {
      drawInkCloud(g, ex - 0.01 * s, ey, s * 0.09, t, true);
    }
    // ---- dizzy stars
    if (dizzy) {
      g.fillStyle = '#FFD84A';
      for (i = 0; i < 3; i++) {
        var a2 = t * 5 + i * TAU / 3;
        var sx = 0.3 * s + Math.cos(a2) * 0.1 * s, sy = -0.2 * s + Math.sin(a2) * 0.03 * s;
        var r5 = 0.022 * s * (0.8 + 0.2 * Math.sin(a2));
        g.beginPath();
        for (var k = 0; k < 10; k++) {
          var ak = k * Math.PI / 5 - Math.PI / 2 + t * 3;
          var rk = k & 1 ? r5 * 0.45 : r5;
          g.lineTo(sx + Math.cos(ak) * rk, sy + Math.sin(ak) * rk);
        }
        g.closePath(); g.fill();
      }
    }
    g.restore();
  }

  // ================================================================ LEVELS
  var LEVELS = [
    { name: 'Lagunen', top: '#5ED6E6', mid: '#2A9CC4', deep: '#105E8E', floor: '#EBD7A6', floorDark: '#C4A874', far: '#5FB8CF', midc: '#2E8AA8', rays: 0.22, part: 'motes', partColor: '#FFFFFF', accent: '#3CE0B4' },
    { name: 'Korallrevet', top: '#3FB0DA', mid: '#1C6FA6', deep: '#0C3E6E', floor: '#F0CDB6', floorDark: '#C99A8A', far: '#3E7FB0', midc: '#7A5BA8', rays: 0.16, part: 'motes', partColor: '#FFE8F4', accent: '#FF7AA8' },
    { name: 'Vraket', top: '#3C7F8A', mid: '#1C4C5A', deep: '#0B2832', floor: '#8E8462', floorDark: '#5E573E', far: '#2A5E68', midc: '#1E414A', rays: 0.1, part: 'silt', partColor: '#C8B88A', accent: '#E07A3A' },
    { name: 'Kelpskogen', top: '#4DB596', mid: '#1C6E5C', deep: '#0A3530', floor: '#6E7A4A', floorDark: '#454E2E', far: '#2C7A60', midc: '#1A5A40', rays: 0.2, part: 'motes', partColor: '#E8FFC8', accent: '#9BD84A' },
    { name: 'Isgrottan', top: '#B5ECFF', mid: '#5AB3E0', deep: '#1D5C90', floor: '#E6F6FF', floorDark: '#A6D4EE', far: '#8CCCEB', midc: '#6AAFD8', rays: 0.25, part: 'snow', partColor: '#FFFFFF', accent: '#9FE8FF' },
    { name: 'Vulkanrevet', top: '#2A2C4A', mid: '#2C1C34', deep: '#40140E', floor: '#2A1E22', floorDark: '#140E12', far: '#3A2238', midc: '#22141C', rays: 0, part: 'embers', partColor: '#FF8A3A', accent: '#FF6A2A' },
    { name: 'Djuphavet', top: '#0A1428', mid: '#040A18', deep: '#01030A', floor: '#0C1220', floorDark: '#05080F', far: '#0D1A30', midc: '#081222', rays: 0, part: 'marine', partColor: '#BFD8FF', accent: '#4BF2FF' }
  ];

  var bgCache = new Cache(40);

  function bgBase(L, w, h, S) {
    var k = 'base|' + L + '|' + w + '|' + h + '|' + S;
    var c = bgCache.get(k);
    if (c) return c;
    var P = LEVELS[L];
    c = mkCanvas(w * S, h * S);
    var g = c.getContext('2d');
    g.scale(S, S);
    var gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, P.top);
    gr.addColorStop(0.45, P.mid);
    gr.addColorStop(1, P.deep);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    if (L === 5) {
      var lg = g.createRadialGradient(w * 0.5, h * 1.1, 0, w * 0.5, h * 1.1, h * 0.9);
      lg.addColorStop(0, 'rgba(255,90,30,0.45)');
      lg.addColorStop(1, 'rgba(255,90,30,0)');
      g.fillStyle = lg; g.fillRect(0, 0, w, h);
    }
    if (L === 4) {
      var ig = g.createRadialGradient(w * 0.7, -h * 0.1, 0, w * 0.7, -h * 0.1, h * 1.1);
      ig.addColorStop(0, 'rgba(255,255,255,0.35)');
      ig.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = ig; g.fillRect(0, 0, w, h);
    }
    if (L <= 4) {
      // surface shimmer band
      var sg = g.createLinearGradient(0, 0, 0, h * 0.12);
      sg.addColorStop(0, 'rgba(255,255,255,0.28)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sg; g.fillRect(0, 0, w, h * 0.12);
      // sun glow seen through the surface (top, slightly right of centre)
      var sunX = w * 0.62, sunR = Math.max(w, h) * 0.55;
      var sun = g.createRadialGradient(sunX, -h * 0.08, 0, sunX, -h * 0.08, sunR);
      sun.addColorStop(0, 'rgba(255,255,240,' + (L === 2 ? 0.16 : 0.3) + ')');
      sun.addColorStop(0.35, 'rgba(220,250,255,' + (L === 2 ? 0.06 : 0.12) + ')');
      sun.addColorStop(1, 'rgba(220,250,255,0)');
      g.fillStyle = sun; g.fillRect(0, 0, w, h);
    }
    // depth haze: lighter, desaturated band near the sea floor (atmospheric perspective)
    var hz = g.createLinearGradient(0, h * 0.55, 0, h);
    var hzc = L === 5 ? '#FF7A3A' : L === 6 ? '#1A3A6A' : P.far;
    hz.addColorStop(0, rgba(hzc, 0));
    hz.addColorStop(0.75, rgba(hzc, L === 6 ? 0.12 : 0.22));
    hz.addColorStop(1, rgba(hzc, L === 6 ? 0.06 : 0.12));
    g.fillStyle = hz; g.fillRect(0, h * 0.55, w, h * 0.45);
    // vignette
    var vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, L === 6 ? 'rgba(0,0,0,0.6)' : 'rgba(0,10,30,0.35)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    return bgCache.set(k, c);
  }

  // periodic tile painter: fn(g, tw, h, rng, drawAt) – drawAt(x, cb) wraps around
  function makeTile(k, tw, h, S, paint) {
    var c = bgCache.get(k);
    if (c) return c;
    c = mkCanvas(tw * S, h * S);
    var g = c.getContext('2d');
    g.scale(S, S);
    var wrap = function (cb) { cb(0); cb(-tw); cb(tw); };
    paint(g, tw, h, wrap);
    c._bands = tileBands(tw, h, paint);
    return bgCache.set(k, c);
  }
  // Find the row bands that actually contain pixels (once per cached tile), so each frame only
  // blends the non-empty part of a full-height parallax layer. The paint is repeated on a small
  // throwaway canvas and read back there, so the real tile is never read (stays GPU-friendly).
  function tileBands(tw, h, paint) {
    var full = [[0, 1]];
    try {
      var q = 0.25, sw = Math.max(8, Math.ceil(tw * q)), sh = Math.max(8, Math.ceil(h * q));
      var sc = mkCanvas(sw, sh), g = sc.getContext('2d');
      g.scale(q, q);
      paint(g, tw, h, function (cb) { cb(0); cb(-tw); cb(tw); });
      var d = g.getImageData(0, 0, sw, sh).data, occ = [], y, x, any = false;
      for (y = 0; y < sh; y++) {
        occ[y] = false;
        for (x = 0; x < sw; x += 2) if (d[(y * sw + x) * 4 + 3] > 1) { occ[y] = any = true; break; }
      }
      if (!any) return [];
      var y0 = 0, y1 = sh - 1;
      while (!occ[y0]) y0++;
      while (!occ[y1]) y1--;
      // largest empty gap inside -> split into two bands when it is worth it
      var gs = -1, gl = 0, run = 0;
      for (y = y0; y <= y1; y++) {
        if (!occ[y]) { run++; if (run > gl) { gl = run; gs = y - run + 1; } } else run = 0;
      }
      var pad = 2, bands;
      if (gl > sh * 0.15) bands = [[y0 - pad, gs + pad], [gs + gl - pad, y1 + 1 + pad]];
      else bands = [[y0 - pad, y1 + 1 + pad]];
      return bands.map(function (b) { return [Math.max(0, b[0] / sh), Math.min(1, b[1] / sh)]; });
    } catch (e) { return full; }
  }
  // draw a horizontally repeating tile (only its non-empty row bands)
  function drawTileRow(ctx, c, scroll, factor, y, tw, th, w) {
    var bands = c._bands || [[0, 1]];
    var off = -(((scroll * factor) % tw) + tw) % tw;
    for (var i = 0; i < bands.length; i++) {
      var sy = Math.floor(bands[i][0] * c.height), ey = Math.ceil(bands[i][1] * c.height);
      if (ey <= sy) continue;
      var k = th / c.height, dy = y + sy * k, dh = (ey - sy) * k;
      for (var x = off; x < w; x += tw) ctx.drawImage(c, 0, sy, c.width, ey - sy, x, dy, tw, dh);
    }
  }

  function hillsPath(g, tw, h, base, amp, n, rng, phase) {
    g.beginPath();
    g.moveTo(0, h);
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push(base - amp * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + phase))) * (0.6 + 0.4 * hash(i + phase * 10)));
    pts[n] = pts[0];
    g.lineTo(0, pts[0]);
    for (i = 0; i < n; i++) {
      var x0 = (i / n) * tw, x1 = ((i + 1) / n) * tw;
      g.quadraticCurveTo(x0 + (x1 - x0) * 0.5, pts[i] - amp * 0.25, x1, pts[i + 1]);
    }
    g.lineTo(tw, h);
    g.closePath();
  }

  function paintFar(L, g, tw, h, wrap) {
    var P = LEVELS[L];
    var rng = mulberry(1000 + L);
    var i;
    var col = P.far;
    g.fillStyle = rgba(col, 0.55);
    switch (L) {
      case 0:
        hillsPath(g, tw, h, h * 0.86, h * 0.12, 6, rng, 0.3); g.fill();
        g.fillStyle = rgba(col, 0.4);
        for (i = 0; i < 7; i++) {
          var x = rng() * tw, ww = h * (0.08 + rng() * 0.1);
          wrap(function (o) { g.beginPath(); g.ellipse(x + o, h * 0.8, ww, ww * 0.6, 0, Math.PI, TAU); g.fill(); });
        }
        break;
      case 1:
        hillsPath(g, tw, h, h * 0.88, h * 0.08, 5, rng, 1.1); g.fill();
        for (i = 0; i < 9; i++) {
          (function (x, sz, kind) {
            wrap(function (o) {
              g.save(); g.translate(x + o, h * 0.86);
              if (kind < 0.5) { // branch coral silhouette
                g.strokeStyle = rgba(col, 0.6); g.lineCap = 'round'; g.lineWidth = sz * 0.12;
                var br = function (len, ang, dep) {
                  if (dep > 3) return;
                  g.save(); g.rotate(ang); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len); g.stroke(); g.translate(0, -len);
                  br(len * 0.7, -0.45, dep + 1); br(len * 0.7, 0.45, dep + 1); g.restore();
                };
                br(sz * 0.4, 0, 0);
              } else {
                g.fillStyle = rgba(col, 0.6);
                g.beginPath(); g.ellipse(0, 0, sz * 0.7, sz * 0.5, 0, Math.PI, TAU); g.fill();
              }
              g.restore();
            });
          })(rng() * tw, h * (0.12 + rng() * 0.12), rng());
        }
        break;
      case 2: {
        hillsPath(g, tw, h, h * 0.9, h * 0.06, 5, rng, 2.2); g.fill();
        var sx = tw * 0.55;
        wrap(function (o) {
          g.save(); g.translate(sx + o, h * 0.84); g.rotate(-0.12);
          g.fillStyle = rgba(col, 0.75);
          g.beginPath();
          g.moveTo(-h * 0.55, -h * 0.1); g.lineTo(h * 0.5, -h * 0.16);
          g.quadraticCurveTo(h * 0.62, -h * 0.05, h * 0.42, h * 0.08);
          g.lineTo(-h * 0.45, h * 0.08); g.closePath(); g.fill();
          g.fillRect(-h * 0.05, -h * 0.55, h * 0.025, h * 0.42);
          g.fillRect(h * 0.25, -h * 0.4, h * 0.02, h * 0.26);
          g.fillRect(-h * 0.16, -h * 0.42, h * 0.24, h * 0.012);
          g.fillStyle = rgba(P.deep, 0.5);
          for (var p = 0; p < 5; p++) { g.beginPath(); g.arc(-h * 0.3 + p * h * 0.15, -h * 0.05, h * 0.018, 0, TAU); g.fill(); }
          g.restore();
        });
        break;
      }
      case 3:
        for (i = 0; i < 14; i++) {
          (function (x, hh2, ph, wdt) {
            wrap(function (o) {
              g.strokeStyle = rgba(col, 0.55); g.lineWidth = wdt; g.lineCap = 'round';
              g.beginPath(); g.moveTo(x + o, h);
              g.bezierCurveTo(x + o + 20 * Math.sin(ph), h - hh2 * 0.35, x + o - 25 * Math.cos(ph), h - hh2 * 0.7, x + o + 10, h - hh2);
              g.stroke();
              g.fillStyle = rgba(col, 0.45);
              for (var j = 1; j < 6; j++) {
                var yy = h - hh2 * j / 6;
                g.beginPath(); g.ellipse(x + o + (j & 1 ? 8 : -8), yy, wdt * 1.6, wdt * 0.5, (j & 1 ? -0.6 : 0.6), 0, TAU); g.fill();
              }
            });
          })(rng() * tw, h * (0.55 + rng() * 0.4), rng() * 6, 3 + rng() * 3);
        }
        break;
      case 4:
        g.fillStyle = rgba(col, 0.6);
        // ceiling with icicles
        g.beginPath(); g.moveTo(0, 0);
        var n = 26;
        for (i = 0; i <= n; i++) {
          var xx = i / n * tw;
          var dep = h * (0.05 + 0.1 * hash(i + 3) + (i % 3 === 0 ? 0.08 : 0));
          g.lineTo(xx - tw / n * 0.3, h * 0.05); g.lineTo(xx, dep); g.lineTo(xx + tw / n * 0.3, h * 0.05);
        }
        g.lineTo(tw, 0); g.closePath(); g.fill();
        hillsPath(g, tw, h, h * 0.86, h * 0.12, 7, rng, 0.7); g.fill();
        break;
      case 5:
        g.fillStyle = rgba(col, 0.85);
        hillsPath(g, tw, h, h * 0.9, h * 0.05, 5, rng, 1.9); g.fill();
        for (i = 0; i < 2; i++) {
          (function (x, vh) {
            wrap(function (o) {
              g.fillStyle = rgba(col, 0.9);
              g.beginPath();
              g.moveTo(x + o - vh * 0.9, h * 0.9);
              g.quadraticCurveTo(x + o - vh * 0.25, h * 0.9 - vh * 0.6, x + o - vh * 0.12, h * 0.9 - vh);
              g.lineTo(x + o + vh * 0.12, h * 0.9 - vh);
              g.quadraticCurveTo(x + o + vh * 0.25, h * 0.9 - vh * 0.6, x + o + vh * 0.9, h * 0.9);
              g.closePath(); g.fill();
              var gl = g.createRadialGradient(x + o, h * 0.9 - vh, 0, x + o, h * 0.9 - vh, vh * 0.5);
              gl.addColorStop(0, 'rgba(255,120,40,0.55)'); gl.addColorStop(1, 'rgba(255,120,40,0)');
              g.fillStyle = gl; g.fillRect(x + o - vh, h * 0.9 - vh * 1.5, vh * 2, vh);
              g.strokeStyle = 'rgba(255,110,40,0.5)'; g.lineWidth = 2;
              g.beginPath(); g.moveTo(x + o, h * 0.9 - vh); g.lineTo(x + o - vh * 0.1, h * 0.9 - vh * 0.6); g.lineTo(x + o + vh * 0.05, h * 0.9 - vh * 0.3); g.stroke();
            });
          })(tw * (0.25 + i * 0.5) + rng() * 40, h * (0.35 + rng() * 0.15));
        }
        break;
      case 6:
        g.fillStyle = rgba(col, 0.8);
        hillsPath(g, tw, h, h * 0.88, h * 0.1, 6, rng, 0.4); g.fill();
        break;
    }
  }

  function paintMid(L, g, tw, h, wrap) {
    var P = LEVELS[L];
    var rng = mulberry(2000 + L);
    var col = P.midc, i;
    switch (L) {
      case 0:
        for (i = 0; i < 10; i++) {
          (function (x, sz) {
            wrap(function (o) {
              g.fillStyle = rgba(col, 0.55);
              for (var b = 0; b < 6; b++) {
                var bx = x + o + (b - 3) * sz * 0.12;
                g.beginPath(); g.moveTo(bx - sz * 0.04, h);
                g.quadraticCurveTo(bx + sz * 0.1 * Math.sin(b), h - sz * 0.6, bx + sz * 0.05 * (b - 2.5), h - sz * (0.6 + 0.4 * hash(b + x)));
                g.quadraticCurveTo(bx + sz * 0.08, h - sz * 0.4, bx + sz * 0.04, h);
                g.fill();
              }
            });
          })(rng() * tw, h * (0.15 + rng() * 0.15));
        }
        break;
      case 1:
        for (i = 0; i < 12; i++) {
          (function (x, sz, c) {
            wrap(function (o) {
              g.fillStyle = rgba(c, 0.45);
              g.beginPath(); g.ellipse(x + o, h * 0.97, sz * 0.5, sz * 0.4, 0, Math.PI, TAU); g.fill();
              g.beginPath(); g.ellipse(x + o + sz * 0.3, h * 0.97, sz * 0.3, sz * 0.55, 0.2, Math.PI, TAU); g.fill();
            });
          })(rng() * tw, h * (0.1 + rng() * 0.12), ['#C07AD8', '#E2809F', '#E6A070', '#6F9FD8'][i % 4]);
        }
        break;
      case 2:
        for (i = 0; i < 6; i++) {
          (function (x, sz, ang) {
            wrap(function (o) {
              g.save(); g.translate(x + o, h * 0.95); g.rotate(ang);
              g.fillStyle = rgba(col, 0.75);
              g.fillRect(-sz * 0.5, -sz * 0.06, sz, sz * 0.12);
              g.restore();
              g.fillStyle = rgba(col, 0.7);
              g.beginPath(); g.ellipse(x + o + sz * 0.6, h * 0.97, sz * 0.25, sz * 0.15, 0, Math.PI, TAU); g.fill();
            });
          })(rng() * tw, h * (0.18 + rng() * 0.15), (rng() - 0.5) * 1.2);
        }
        break;
      case 3:
        for (i = 0; i < 8; i++) {
          (function (x, hh2, wdt) {
            wrap(function (o) {
              g.strokeStyle = rgba(col, 0.7); g.lineWidth = wdt; g.lineCap = 'round';
              g.beginPath(); g.moveTo(x + o, h);
              g.bezierCurveTo(x + o + 30, h - hh2 * 0.4, x + o - 30, h - hh2 * 0.7, x + o + 5, h - hh2); g.stroke();
              g.fillStyle = rgba(col, 0.6);
              for (var j = 1; j < 8; j++) {
                g.beginPath(); g.ellipse(x + o + (j & 1 ? 12 : -12), h - hh2 * j / 8, wdt * 2.2, wdt * 0.6, (j & 1 ? -0.5 : 0.5), 0, TAU); g.fill();
              }
            });
          })(rng() * tw, h * (0.5 + rng() * 0.5), 5 + rng() * 4);
        }
        break;
      case 4:
        for (i = 0; i < 9; i++) {
          (function (x, sz) {
            wrap(function (o) {
              var gr = g.createLinearGradient(x + o - sz * 0.2, 0, x + o + sz * 0.2, 0);
              gr.addColorStop(0, rgba('#FFFFFF', 0.45)); gr.addColorStop(1, rgba(col, 0.45));
              g.fillStyle = gr;
              g.beginPath(); g.moveTo(x + o - sz * 0.18, h); g.lineTo(x + o - sz * 0.05, h - sz); g.lineTo(x + o + sz * 0.08, h - sz * 0.85); g.lineTo(x + o + sz * 0.2, h); g.closePath(); g.fill();
              g.beginPath(); g.moveTo(x + o + sz * 0.15, h); g.lineTo(x + o + sz * 0.28, h - sz * 0.55); g.lineTo(x + o + sz * 0.38, h); g.closePath(); g.fill();
            });
          })(rng() * tw, h * (0.15 + rng() * 0.2));
        }
        break;
      case 5:
        for (i = 0; i < 8; i++) {
          (function (x, sz) {
            wrap(function (o) {
              g.fillStyle = rgba(col, 0.95);
              g.beginPath();
              g.moveTo(x + o - sz * 0.6, h);
              g.lineTo(x + o - sz * 0.35, h - sz * 0.55); g.lineTo(x + o - sz * 0.1, h - sz * 0.7);
              g.lineTo(x + o + sz * 0.25, h - sz * 0.5); g.lineTo(x + o + sz * 0.6, h); g.closePath(); g.fill();
              g.strokeStyle = 'rgba(255,110,40,0.55)'; g.lineWidth = 1.5;
              g.beginPath(); g.moveTo(x + o - sz * 0.1, h - sz * 0.65); g.lineTo(x + o, h - sz * 0.35); g.lineTo(x + o - sz * 0.12, h - sz * 0.1); g.stroke();
            });
          })(rng() * tw, h * (0.12 + rng() * 0.12));
        }
        break;
      case 6:
        for (i = 0; i < 7; i++) {
          (function (x, sz) {
            wrap(function (o) {
              g.fillStyle = rgba(col, 0.95);
              g.beginPath(); g.ellipse(x + o, h, sz * 0.6, sz * 0.5, 0, Math.PI, TAU); g.fill();
            });
          })(rng() * tw, h * (0.08 + rng() * 0.1));
        }
        break;
    }
  }

  function paintFloor(L, g, tw, fh, wrap) {
    var P = LEVELS[L];
    var rng = mulberry(3000 + L);
    var i;
    var gr = g.createLinearGradient(0, 0, 0, fh);
    gr.addColorStop(0, P.floor); gr.addColorStop(1, P.floorDark);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, fh * 0.3);
    var n = 12;
    for (i = 0; i < n; i++) {
      var x0 = i / n * tw, x1 = (i + 1) / n * tw;
      g.quadraticCurveTo((x0 + x1) / 2, fh * (0.05 + 0.3 * hash(i + L * 13)), x1, fh * 0.3);
    }
    g.lineTo(tw, fh); g.lineTo(0, fh); g.closePath(); g.fill();
    // highlight lip
    g.strokeStyle = L >= 5 ? (L === 5 ? 'rgba(255,110,40,0.5)' : 'rgba(75,242,255,0.25)') : 'rgba(255,255,255,0.35)';
    g.lineWidth = 1.5;
    g.stroke();
    for (i = 0; i < 40; i++) {
      var px = rng() * tw, py = fh * (0.4 + rng() * 0.55), pr = 0.8 + rng() * 2.4;
      g.fillStyle = rng() < 0.5 ? rgba(P.floorDark, 0.8) : rgba('#FFFFFF', L === 6 ? 0.08 : 0.3);
      g.beginPath(); g.ellipse(px, py, pr * 1.4, pr, 0, 0, TAU); g.fill();
    }
    if (L === 1) {
      var cc = ['#FF7AA8', '#FFB03A', '#B48CFF', '#3CE0B4'];
      for (i = 0; i < 14; i++) { g.fillStyle = cc[i % 4]; g.beginPath(); g.arc(rng() * tw, fh * (0.5 + rng() * 0.4), 1.5 + rng() * 2, 0, TAU); g.fill(); }
    }
    if (L === 5) {
      g.strokeStyle = 'rgba(255,120,40,0.7)'; g.lineWidth = 1.2;
      for (i = 0; i < 8; i++) { var lx = rng() * tw; g.beginPath(); g.moveTo(lx, fh * 0.5); g.lineTo(lx + 8, fh * 0.7); g.lineTo(lx + 3, fh * 0.95); g.stroke(); }
    }
    if (L === 6) {
      for (i = 0; i < 10; i++) { g.fillStyle = i & 1 ? 'rgba(75,242,255,0.5)' : 'rgba(198,107,255,0.5)'; g.beginPath(); g.arc(rng() * tw, fh * (0.4 + rng() * 0.5), 1 + rng() * 1.2, 0, TAU); g.fill(); }
    }
  }

  // very distant silhouettes (slowest parallax layer), hazy and blended toward the water colour
  function paintDeep(L, g, tw, h, wrap) {
    var P = LEVELS[L];
    var rng = mulberry(4000 + L);
    var col = mix(P.far, P.mid, 0.45);
    var i;
    g.fillStyle = rgba(col, L === 6 ? 0.5 : 0.42);
    hillsPath(g, tw, h, h * 0.8, h * 0.2, 4, rng, 2.7 + L); g.fill();
    switch (L) {
      case 0: case 1:
        for (i = 0; i < 5; i++) {
          (function (x, r) {
            wrap(function (o) { g.beginPath(); g.ellipse(x + o, h * 0.74, r, r * 0.8, 0, Math.PI, TAU); g.fill(); });
          })(rng() * tw, h * (0.08 + rng() * 0.08));
        }
        break;
      case 2:
        for (i = 0; i < 3; i++) {
          (function (x, ph) {
            wrap(function (o) {
              g.fillRect(x + o, h * (0.45 + ph * 0.1), h * 0.012, h * 0.35);
              g.fillRect(x + o - h * 0.05, h * (0.52 + ph * 0.1), h * 0.11, h * 0.008);
            });
          })(rng() * tw, rng());
        }
        break;
      case 3:
        g.strokeStyle = rgba(col, 0.38); g.lineCap = 'round';
        for (i = 0; i < 16; i++) {
          (function (x, hh2, ph, wd) {
            wrap(function (o) {
              g.lineWidth = wd;
              g.beginPath(); g.moveTo(x + o, h);
              g.bezierCurveTo(x + o + 14 * Math.sin(ph), h - hh2 * 0.4, x + o - 14 * Math.cos(ph), h - hh2 * 0.7, x + o + 6, h - hh2);
              g.stroke();
            });
          })(rng() * tw, h * (0.6 + rng() * 0.4), rng() * 6, 2 + rng() * 2);
        }
        break;
      case 4:
        for (i = 0; i < 7; i++) {
          (function (x, sz) {
            wrap(function (o) { g.beginPath(); g.moveTo(x + o - sz * 0.22, h); g.lineTo(x + o, h - sz); g.lineTo(x + o + sz * 0.22, h); g.closePath(); g.fill(); });
          })(rng() * tw, h * (0.3 + rng() * 0.3));
        }
        break;
      case 5:
        for (i = 0; i < 2; i++) {
          (function (x, vh) {
            wrap(function (o) {
              g.fillStyle = rgba(col, 0.55);
              g.beginPath(); g.moveTo(x + o - vh, h); g.lineTo(x + o - vh * 0.12, h - vh); g.lineTo(x + o + vh * 0.12, h - vh); g.lineTo(x + o + vh, h); g.closePath(); g.fill();
              var gl = g.createRadialGradient(x + o, h - vh, 0, x + o, h - vh, vh * 0.45);
              gl.addColorStop(0, 'rgba(255,110,40,0.35)'); gl.addColorStop(1, 'rgba(255,110,40,0)');
              g.fillStyle = gl; g.fillRect(x + o - vh, h - vh * 1.5, vh * 2, vh);
            });
          })(tw * (0.15 + i * 0.5) + rng() * 60, h * (0.28 + rng() * 0.12));
        }
        break;
    }
  }

  // caustic light net (tileable), drawn additively over the lower part of the scene
  var causticTile = null;
  function getCausticTile() {
    if (causticTile) return causticTile;
    var tw = 256, th = 96;
    causticTile = mkCanvas(tw, th);
    var g = causticTile.getContext('2d');
    var rng = mulberry(777);
    g.strokeStyle = '#FFFFFF';
    g.lineCap = 'round'; g.lineJoin = 'round';
    // interfering wavy lines (periodic in x) read as a soft caustic net
    for (var i = 0; i < 11; i++) {
      var base = (i + 0.5) / 11 * th, a1 = 4 + rng() * 7, a2 = 2 + rng() * 4;
      var f1 = (1 + Math.floor(rng() * 3)) * TAU / tw, f2 = (3 + Math.floor(rng() * 4)) * TAU / tw;
      var p1 = rng() * TAU, p2 = rng() * TAU;
      g.lineWidth = 0.8 + rng() * 1.2;
      g.globalAlpha = 0.5 + rng() * 0.5;
      g.beginPath();
      for (var x = 0; x <= tw; x += 4) {
        var y = base + Math.sin(x * f1 + p1) * a1 + Math.sin(x * f2 + p2) * a2;
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    // fade in from the top of the band so there is no hard edge
    g.globalCompositeOperation = 'destination-in';
    var fg = g.createLinearGradient(0, 0, 0, th);
    fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(0.55, 'rgba(0,0,0,0.7)'); fg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fg; g.fillRect(0, 0, tw, th);
    g.globalCompositeOperation = 'source-over';
    return causticTile;
  }
  function drawCaustics(ctx, w, h, scrollX, t, y0, alpha) {
    var c = getCausticTile();
    var bandH = h - y0;
    var tw = 256 * 1.6, th = bandH;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var p = 0; p < 2; p++) {
      ctx.globalAlpha = alpha * (p ? 0.8 : 1) * (0.75 + 0.25 * Math.sin(t * (1.1 + p * 0.6) + p * 2));
      var sp = p ? 0.55 : 0.8;
      var off = -((((scrollX * sp) + t * (p ? -14 : 9)) % tw) + tw) % tw;
      var dy = y0 + Math.sin(t * 0.9 + p * 1.7) * 3;
      for (var x = off; x < w; x += tw) ctx.drawImage(c, x, dy, tw, th);
    }
    ctx.restore();
  }

  // soft out-of-focus disc for near-camera particles
  var bokehCache = new Cache(8);
  function bokehSprite(color) {
    var c = bokehCache.get(color);
    if (c) return c;
    c = mkCanvas(64, 64);
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(color, 0.55));
    gr.addColorStop(0.6, rgba(color, 0.42));
    gr.addColorStop(0.85, rgba(color, 0.5));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return bokehCache.set(color, c);
  }

  // blurred dark silhouettes in front of the playfield, along the bottom edge
  function paintFore(L, g, tw, fh, wrap) {
    var P = LEVELS[L];
    var rng = mulberry(5000 + L);
    var dark = L === 6 ? '#010309' : mix(P.deep, '#000814', 0.55);
    var rim = L === 5 ? '#FF7A3A' : L === 6 ? '#4BF2FF' : mix(P.top, '#FFFFFF', 0.3);
    var i, n = 5;
    for (i = 0; i < n; i++) {
      var cx = (i + 0.2 + rng() * 0.6) / n * tw;
      var sz = fh * (0.55 + rng() * 0.45);
      (function (cx, sz, r1, r2) {
        wrap(function (o) {
          var x = cx + o;
          g.fillStyle = dark;
          g.strokeStyle = dark;
          g.lineCap = 'round';
          if (L === 0 || L === 3) {
            // grass / kelp blades
            for (var b = 0; b < 7; b++) {
              var bx = x + (b - 3) * sz * 0.13, bh = sz * (0.55 + 0.45 * hash(b + r1 * 9)) * (L === 3 ? 1 : 0.85);
              g.beginPath(); g.moveTo(bx - sz * 0.05, fh);
              g.quadraticCurveTo(bx + sz * 0.12 * Math.sin(b + r2 * 6), fh - bh * 0.6, bx + sz * 0.08 * (b - 3) * 0.4, fh - bh);
              g.quadraticCurveTo(bx + sz * 0.06, fh - bh * 0.5, bx + sz * 0.05, fh);
              g.fill();
            }
          } else if (L === 1) {
            // coral fan + branches
            g.lineWidth = Math.max(2, sz * 0.07);
            var br = function (px, py, len, ang, dep) {
              if (dep > 3) return;
              var nx = px + Math.sin(ang) * len, ny = py - Math.cos(ang) * len;
              g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
              br(nx, ny, len * 0.68, ang - 0.5, dep + 1); br(nx, ny, len * 0.68, ang + 0.45, dep + 1);
            };
            br(x, fh, sz * 0.38, (r1 - 0.5) * 0.4, 0);
            g.beginPath(); g.ellipse(x + sz * 0.5, fh, sz * 0.35, sz * 0.3, 0, Math.PI, TAU); g.fill();
          } else if (L === 4) {
            for (var s = 0; s < 3; s++) {
              var sx = x + (s - 1) * sz * 0.3, sh = sz * (0.6 + 0.4 * hash(s + r1 * 7));
              g.beginPath(); g.moveTo(sx - sz * 0.13, fh); g.lineTo(sx + sz * 0.02, fh - sh); g.lineTo(sx + sz * 0.14, fh); g.closePath(); g.fill();
            }
          } else {
            // rocks (wreck, volcano, deep)
            var rr = mulberry(Math.floor(r1 * 1e6));
            var pts = blobPoints(sz * 1.3, sz * 0.9, rr, 9, 2.6, 0.25, true, false);
            g.save(); g.translate(x - sz * 0.65, fh - sz * 0.9);
            g.beginPath(); smoothPath(g, pts); g.fill();
            if (L === 2) { g.fillRect(sz * 0.2, -sz * 0.3, sz * 0.08, sz * 0.6); }
            g.restore();
            if (L === 5 || L === 6) {
              g.fillStyle = rgba(rim, 0.55);
              for (var q = 0; q < 3; q++) { g.beginPath(); g.arc(x + (hash(q + r2 * 5) - 0.5) * sz, fh - sz * (0.15 + hash(q + r1 * 3) * 0.45), 1.2 + hash(q) * 1.5, 0, TAU); g.fill(); }
              g.fillStyle = dark;
            }
          }
        });
      })(cx, sz, rng(), rng());
    }
    // faint top rim so the silhouettes read as lit from above
    g.globalCompositeOperation = 'source-atop';
    var rg = g.createLinearGradient(0, 0, 0, fh);
    rg.addColorStop(0, rgba(rim, 0.22)); rg.addColorStop(0.5, rgba(rim, 0.04)); rg.addColorStop(1, rgba(rim, 0));
    g.fillStyle = rg; g.fillRect(0, 0, tw, fh);
    g.globalCompositeOperation = 'source-over';
  }

  function drawForeground(ctx, w, h, levelIndex, scrollX, t) {
    var L = ((levelIndex | 0) % 7 + 7) % 7;
    var P = LEVELS[L];
    scrollX = scrollX || 0; t = t || 0;
    w = Math.ceil(w); h = Math.ceil(h);
    var S = ctxScale(ctx);
    ctx.save();
    // near-camera bokeh motes (few, large, soft)
    var bc = L === 5 ? '#FF9A4A' : L === 6 ? '#4BF2FF' : L === 2 ? '#C8D8B0' : '#FFFFFF';
    var bs = bokehSprite(bc);
    for (var i = 0; i < 6; i++) {
      var r = h * (0.03 + hash(i * 5 + 3) * 0.05);
      var span = w + r * 4;
      var x = ((hash(i * 9 + 1) * span - scrollX * (1.25 + hash(i) * 0.4) + Math.sin(t * 0.5 + i) * 12) % span + span) % span - r * 2;
      var y = hash(i * 17 + 4) * h * 0.9 + h * 0.05 + Math.sin(t * 0.35 + i * 2) * h * 0.04;
      ctx.globalAlpha = (L === 6 ? 0.1 : 0.075) * (0.6 + 0.4 * Math.sin(t * 0.8 + i * 1.3));
      ctx.drawImage(bs, x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = L === 6 ? 0.9 : 0.72;
    var fh = Math.max(24, Math.round(h * 0.11));
    var tw = Math.max(w, 600) * 1.3;
    var fg = makeTile('fore|' + L + '|' + tw + '|' + fh + '|' + S, tw, fh, S, function (g, tw2, h2, wrap) { paintFore(L, g, tw2, h2, wrap); });
    drawTileRow(ctx, fg, scrollX, 1.45, h - fh + 2, tw, fh, w);
    ctx.restore();
  }

  // soft dark ellipse used as a fake contact/drop shadow
  var blobSpr = null;
  function drawBlobShadow(ctx, x, y, rw, rh, alpha) {
    if (!blobSpr) {
      blobSpr = mkCanvas(64, 32);
      var g = blobSpr.getContext('2d');
      g.translate(32, 16); g.scale(1, 0.5);
      var gr = g.createRadialGradient(0, 0, 0, 0, 0, 32);
      gr.addColorStop(0, 'rgba(0,8,20,0.75)'); gr.addColorStop(0.5, 'rgba(0,8,20,0.4)'); gr.addColorStop(1, 'rgba(0,8,20,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 32, 0, TAU); g.fill();
    }
    if (alpha <= 0.01) return;
    var a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * alpha;
    ctx.drawImage(blobSpr, x - rw, y - rh, rw * 2, rh * 2);
    ctx.globalAlpha = a0;
  }

  var raySprite = null;
  function getRaySprite() {
    if (raySprite) return raySprite;
    raySprite = mkCanvas(64, 256);
    var g = raySprite.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(20, 0); g.lineTo(44, 0); g.lineTo(64, 256); g.lineTo(0, 256); g.closePath(); g.fill();
    var hg = g.createLinearGradient(0, 0, 64, 0);
    hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.5, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = hg; g.fillRect(0, 0, 64, 256);
    return raySprite;
  }

  function drawParticles(ctx, w, h, L, scrollX, t) {
    var P = LEVELS[L];
    var type = P.part;
    var i, n = type === 'marine' ? 46 : 36;
    for (i = 0; i < n; i++) {
      var depth = 0.2 + hash(i * 3 + 1) * 0.6;
      var bx = hash(i * 7 + 2) * (w + 40);
      var by = hash(i * 11 + 5) * h;
      var r = 0.6 + hash(i * 13 + 7) * 1.8;
      var x, y, a;
      if (type === 'snow') {
        x = bx - scrollX * depth * 0.5 + Math.sin(t * 0.8 + i) * 10;
        y = by + t * (12 + depth * 18);
        a = 0.5 + depth * 0.5;
      } else if (type === 'embers') {
        x = bx - scrollX * depth * 0.5 + Math.sin(t * 1.5 + i) * 6;
        y = by - t * (20 + depth * 30);
        a = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i));
      } else if (type === 'marine') {
        x = bx - scrollX * depth * 0.4;
        y = by + t * (4 + depth * 6);
        a = 0.15 + depth * 0.35;
      } else {
        x = bx - scrollX * depth * 0.5 + Math.sin(t * 0.6 + i) * 8;
        y = by + Math.sin(t * 0.5 + i * 2) * 10 - t * 3;
        a = 0.25 + depth * 0.45;
      }
      x = ((x % (w + 40)) + (w + 40)) % (w + 40) - 20;
      y = ((y % h) + h) % h;
      ctx.globalAlpha = a;
      ctx.fillStyle = type === 'silt' ? (i & 1 ? '#C8B88A' : '#8FA89A') : P.partColor;
      if (type === 'embers' && i % 3 === 0) {
        drawGlow(ctx, x, y, r * 6, '#FF7A2A', a * 0.8);
      }
      ctx.fillRect(x - r * 0.5, y - r * 0.5, r * (type === 'snow' ? 1.6 : 1), r * (type === 'snow' ? 1.6 : 1));
    }
    if (type === 'marine') {
      // bioluminescent twinkles
      for (i = 0; i < 14; i++) {
        var tx = ((hash(i + 91) * (w + 60) - scrollX * 0.25) % (w + 60) + (w + 60)) % (w + 60) - 30;
        var ty = hash(i + 51) * h * 0.85;
        var tw = Math.max(0, Math.sin(t * (0.7 + hash(i) * 1.2) + i * 2.3));
        if (tw < 0.05) continue;
        var col = i % 3 === 0 ? '#C66BFF' : '#4BF2FF';
        drawGlow(ctx, tx, ty, 10 * tw + 3, col, tw * 0.7);
        ctx.globalAlpha = tw;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(tx - 0.8, ty - 0.8, 1.6, 1.6);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBackground(ctx, w, h, levelIndex, scrollX, t) {
    var L = ((levelIndex | 0) % 7 + 7) % 7;
    curLevel = L;
    glowPts.length = 0;
    darkObs.length = 0;
    scrollX = scrollX || 0;
    t = t || 0;
    w = Math.ceil(w); h = Math.ceil(h);
    var S = ctxScale(ctx);
    var P = LEVELS[L];
    ctx.save();
    ctx.drawImage(bgBase(L, w, h, S), 0, 0, w, h);

    // light rays
    if (P.rays > 0) {
      var rs = getRaySprite();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 5; i++) {
        var rx = ((hash(i + 3) * w * 1.3 - scrollX * 0.05) % (w * 1.3) + w * 1.3) % (w * 1.3) - w * 0.15;
        var a = P.rays * (0.5 + 0.5 * Math.sin(t * 0.4 + i * 1.9));
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(rx, -h * 0.02);
        ctx.transform(1, 0, 0.35 + Math.sin(t * 0.2 + i) * 0.05, 1, 0, 0);
        ctx.drawImage(rs, -w * 0.06, 0, w * (0.1 + hash(i + 9) * 0.1), h * 0.95);
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    var tw = Math.max(w, 600);
    // parallax: far (hazy distant silhouettes baked behind it, 0.12), mid (0.35), floor (1.0); only non-empty rows are blended
    var far = makeTile('far|' + L + '|' + tw + '|' + h + '|' + S, tw, h, S, function (g, tw2, h2, wrap) { paintDeep(L, g, tw2, h2, wrap); paintFar(L, g, tw2, h2, wrap); });
    drawTileRow(ctx, far, scrollX, 0.12, 0, tw, h, w);
    var mid = makeTile('mid|' + L + '|' + tw + '|' + h + '|' + S, tw, h, S, function (g, tw2, h2, wrap) { paintMid(L, g, tw2, h2, wrap); });
    drawTileRow(ctx, mid, scrollX, 0.35, 0, tw, h, w);

    drawParticles(ctx, w, h, L, scrollX, t);

    // floor strip (moves with the world)
    var fh = Math.max(14, Math.round(h * 0.055));
    var fl = makeTile('floor|' + L + '|' + tw + '|' + fh + '|' + S, tw, fh, S, function (g, tw2, h2, wrap) { paintFloor(L, g, tw2, h2, wrap); });
    drawTileRow(ctx, fl, scrollX, 1, h - fh, tw, fh, w);

    // moving caustic light net over the lower scene and floor (sunlit levels)
    if (L === 0 || L === 1 || L === 4) drawCaustics(ctx, w, h, scrollX, t, h * 0.83, L === 4 ? 0.2 : 0.17);
    ctx.restore();
  }

  function drawDarkness(ctx, w, h, cx, cy, radius) {
    radius = Math.max(10, radius || 100);
    ctx.save();
    var gr = ctx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
    gr.addColorStop(0, 'rgba(1,3,10,0)');
    gr.addColorStop(0.55, 'rgba(1,3,10,0.45)');
    gr.addColorStop(1, 'rgba(1,3,10,0.94)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
    // faint silhouettes of obstacles so they stay readable (fair collisions)
    if (darkObs.length) {
      ctx.globalAlpha = 0.3;
      for (var j = 0; j < darkObs.length; j++) {
        var o = darkObs[j];
        ctx.setTransform(o.m);
        ctx.drawImage(o.img, o.x, o.y, o.w, o.h);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      darkObs.length = 0;
    }
    // re-light self-luminous details
    if (glowPts.length) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < glowPts.length; i++) {
        var p = glowPts[i];
        ctx.globalAlpha = Math.min(1, p.a);
        ctx.drawImage(glowSprite(p.color, 0.08), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
      glowPts.length = 0;
    }
    ctx.restore();
  }

  // ============================================================== OBSTACLES
  // Sizes are fractions of the playfield height (both width and height).
  var OBSTACLE_KINDS = [
    [
      { kind: 'rock', from: 'bottom', minH: 0.18, maxH: 0.38, minW: 0.18, maxW: 0.34, moving: false },
      { kind: 'seagrass', from: 'bottom', minH: 0.25, maxH: 0.5, minW: 0.1, maxW: 0.17, moving: false },
      { kind: 'ledge', from: 'top', minH: 0.14, maxH: 0.3, minW: 0.2, maxW: 0.36, moving: false }
    ],
    [
      { kind: 'coral', from: 'bottom', minH: 0.25, maxH: 0.5, minW: 0.16, maxW: 0.26, moving: false },
      { kind: 'fan', from: 'bottom', minH: 0.22, maxH: 0.42, minW: 0.18, maxW: 0.28, moving: false },
      { kind: 'jelly', from: 'free', minH: 0.16, maxH: 0.24, minW: 0.1, maxW: 0.15, moving: true },
      { kind: 'reefTop', from: 'top', minH: 0.15, maxH: 0.3, minW: 0.18, maxW: 0.32, moving: false }
    ],
    [
      { kind: 'hull', from: 'bottom', minH: 0.22, maxH: 0.42, minW: 0.3, maxW: 0.48, moving: false },
      { kind: 'chain', from: 'top', minH: 0.3, maxH: 0.6, minW: 0.06, maxW: 0.08, moving: false },
      { kind: 'anchor', from: 'top', minH: 0.3, maxH: 0.45, minW: 0.16, maxW: 0.22, moving: false },
      { kind: 'barrel', from: 'free', minH: 0.12, maxH: 0.17, minW: 0.1, maxW: 0.13, moving: true }
    ],
    [
      { kind: 'kelp', from: 'bottom', minH: 0.35, maxH: 0.65, minW: 0.1, maxW: 0.16, moving: false },
      { kind: 'kelpTop', from: 'top', minH: 0.3, maxH: 0.55, minW: 0.1, maxW: 0.16, moving: false },
      { kind: 'kelpball', from: 'free', minH: 0.12, maxH: 0.18, minW: 0.12, maxW: 0.18, moving: true }
    ],
    [
      { kind: 'icicle', from: 'top', minH: 0.25, maxH: 0.5, minW: 0.12, maxW: 0.2, moving: false },
      { kind: 'iceblock', from: 'bottom', minH: 0.2, maxH: 0.4, minW: 0.2, maxW: 0.34, moving: false },
      { kind: 'floe', from: 'free', minH: 0.1, maxH: 0.15, minW: 0.2, maxW: 0.3, moving: true }
    ],
    [
      { kind: 'lava', from: 'bottom', minH: 0.22, maxH: 0.45, minW: 0.2, maxW: 0.34, moving: false },
      { kind: 'lavaTop', from: 'top', minH: 0.18, maxH: 0.38, minW: 0.2, maxW: 0.32, moving: false },
      { kind: 'bubbles', from: 'bottom', minH: 0.4, maxH: 0.7, minW: 0.08, maxW: 0.12, moving: false }
    ],
    [
      { kind: 'spike', from: 'bottom', minH: 0.22, maxH: 0.45, minW: 0.16, maxW: 0.3, moving: false },
      { kind: 'spikeTop', from: 'top', minH: 0.2, maxH: 0.42, minW: 0.16, maxW: 0.28, moving: false },
      { kind: 'angler', from: 'free', minH: 0.14, maxH: 0.2, minW: 0.2, maxW: 0.28, moving: true }
    ]
  ];

  // generic rock painter
  function paintRock(g, w, h, rng, pal, flatBottom, flatTop) {
    var pts = blobPoints(w, h, rng, 11, 3.2, 0.12, flatBottom, flatTop);
    var path = function () { g.beginPath(); smoothPath(g, pts); };
    path();
    var gr = g.createLinearGradient(w * 0.2, 0, w * 0.6, h);
    gr.addColorStop(0, pal[0]); gr.addColorStop(1, pal[1]);
    g.fillStyle = gr; g.fill();
    g.save();
    path(); g.clip();
    // facets
    for (var i = 0; i < 5; i++) {
      g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)';
      var fx = rng() * w, fy = rng() * h;
      g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + w * (0.2 + rng() * 0.3), fy + h * (rng() * 0.3 - 0.1)); g.lineTo(fx + w * rng() * 0.2, fy + h * (0.2 + rng() * 0.3)); g.closePath(); g.fill();
    }
    // rim light & inner shadow
    g.translate(0, Math.max(2, h * 0.04));
    path(); g.strokeStyle = rgba('#FFFFFF', 0.35); g.lineWidth = 3; g.stroke();
    g.translate(0, -2 * Math.max(2, h * 0.04));
    path(); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 5; g.stroke();
    g.restore();
    path();
    g.strokeStyle = pal[2]; g.lineWidth = 1.6; g.stroke();
    return pts;
  }

  function paintSpecks(g, w, h, rng, col, n, pts) {
    g.save();
    g.beginPath(); smoothPath(g, pts); g.clip();
    g.fillStyle = col;
    for (var i = 0; i < n; i++) { g.beginPath(); g.arc(rng() * w, rng() * h, 1 + rng() * 2.5, 0, TAU); g.fill(); }
    g.restore();
  }

  var OBST = {};

  OBST.rock = function (g, w, h, rng) {
    var pts = paintRock(g, w, h, rng, ['#E3B98A', '#9A6B4A', '#5A3A26'], true, false);
    paintSpecks(g, w, h, rng, 'rgba(90,60,40,0.35)', 10, pts);
    // moss cap
    g.save(); g.beginPath(); smoothPath(g, pts); g.clip();
    g.fillStyle = '#7ED36A';
    g.beginPath(); g.ellipse(w * 0.45, 0, w * 0.4, h * 0.14, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath(); g.ellipse(w * 0.4, h * 0.02, w * 0.25, h * 0.05, 0, 0, TAU); g.fill();
    g.restore();
  };
  OBST.ledge = function (g, w, h, rng) {
    var pts = paintRock(g, w, h, rng, ['#C9A58A', '#7C5A48', '#4A3326'], false, true);
    paintSpecks(g, w, h, rng, 'rgba(255,240,220,0.25)', 8, pts);
    // hanging weeds
    g.strokeStyle = '#5FC46A'; g.lineWidth = 2.5; g.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      var x = w * (0.2 + i * 0.2);
      g.beginPath(); g.moveTo(x, h * 0.6); g.quadraticCurveTo(x + 4, h * 0.8, x - 2, h * 0.92); g.stroke();
    }
  };
  OBST.seagrass = function (g, w, h, rng) {
    var n = Math.max(6, Math.round(w / 5));
    var cols = ['#3DBE5A', '#58D46E', '#2E9E4A', '#7BE07A'];
    for (var i = 0; i < n; i++) {
      var bx = w * (0.12 + 0.76 * i / (n - 1));
      var top = h * (rng() * 0.14);
      var bend = (rng() - 0.5) * w * 0.35;
      var bw = Math.max(4, w * 0.24);
      var gr = g.createLinearGradient(0, h, 0, top);
      var c = cols[i % 4];
      gr.addColorStop(0, mix(c, '#0A3A20', 0.45)); gr.addColorStop(1, c);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(bx - bw / 2, h);
      g.quadraticCurveTo(bx - bw / 2 + bend, h * 0.5, bx + bend * 0.6, top);
      g.quadraticCurveTo(bx + bw / 2 + bend, h * 0.5, bx + bw / 2, h);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(bx, h); g.quadraticCurveTo(bx + bend, h * 0.5, bx + bend * 0.6, top + 4); g.stroke();
    }
  };
  OBST.coral = function (g, w, h, rng) {
    var base = ['#FF5E9A', '#FF7A59', '#FF4F8B'][Math.floor(rng() * 3)];
    var lw = Math.max(6, w * 0.27);
    g.lineCap = 'round'; g.lineJoin = 'round';
    var segs = [];
    function br(x, y, len, ang, dep) {
      var x2 = x + Math.sin(ang) * len, y2 = y - Math.cos(ang) * len;
      segs.push([x, y, x2, y2, dep]);
      if (dep >= 3) return;
      var k = 2 + (rng() < 0.4 ? 1 : 0);
      for (var i = 0; i < k; i++) br(x2, y2, len * (0.6 + rng() * 0.2), ang + (i - (k - 1) / 2) * 0.7 + (rng() - 0.5) * 0.3, dep + 1);
    }
    br(w * 0.5, h, h * 0.36, 0, 0);
    br(w * 0.3, h, h * 0.25, -0.35, 1);
    br(w * 0.7, h, h * 0.25, 0.35, 1);
    // clamp to box
    var minx = 1e9, maxx = -1e9, miny = 1e9;
    segs.forEach(function (s) { minx = Math.min(minx, s[0], s[2]); maxx = Math.max(maxx, s[0], s[2]); miny = Math.min(miny, s[1], s[3]); });
    var sx = (w - lw) / Math.max(1, maxx - minx), sy = (h - lw / 2) / Math.max(1, h - miny);
    g.save();
    g.translate(lw / 2 - minx * sx, h - h * sy);
    g.scale(sx, sy);
    var pass = function (col, wid) {
      g.strokeStyle = col;
      segs.forEach(function (s) { g.lineWidth = wid * (1 - s[4] * 0.15) / Math.sqrt(sx * sy); g.beginPath(); g.moveTo(s[0], s[1]); g.lineTo(s[2], s[3]); g.stroke(); });
    };
    pass(mix(base, '#3A0A20', 0.55), lw + 3);
    pass(base, lw);
    pass(rgba('#FFFFFF', 0.28), lw * 0.35);
    g.fillStyle = mix(base, '#FFFFFF', 0.55);
    segs.forEach(function (s) { if (s[4] >= 2) { g.beginPath(); g.arc(s[2], s[3], lw * 0.32 / Math.sqrt(sx * sy), 0, TAU); g.fill(); } });
    g.restore();
    // coral base mound
    g.beginPath();
    g.moveTo(0, h + 1); g.quadraticCurveTo(w * 0.05, h * 0.8, w * 0.5, h * 0.78); g.quadraticCurveTo(w * 0.95, h * 0.8, w, h + 1); g.closePath();
    var mg = g.createLinearGradient(0, h * 0.78, 0, h);
    mg.addColorStop(0, mix(base, '#FFFFFF', 0.15)); mg.addColorStop(1, mix(base, '#3A0A20', 0.5));
    g.fillStyle = mg; g.fill();
    g.strokeStyle = mix(base, '#3A0A20', 0.55); g.lineWidth = 1.5; g.stroke();
    g.fillStyle = rgba('#FFFFFF', 0.35);
    for (var q = 0; q < 6; q++) { g.beginPath(); g.arc(w * (0.15 + q * 0.14), h * (0.86 + (q & 1) * 0.06), Math.max(1, w * 0.025), 0, TAU); g.fill(); }
  };
  OBST.fan = function (g, w, h, rng) {
    var col = ['#FFA23A', '#FF8A2A', '#FFB84D'][Math.floor(rng() * 3)];
    var cx = w / 2, fy = h * 0.88;
    g.beginPath();
    g.moveTo(cx - w * 0.08, h);
    g.lineTo(cx - w * 0.06, fy);
    g.bezierCurveTo(-w * 0.05, fy - h * 0.3, w * 0.0, -h * 0.02, cx, 0);
    g.bezierCurveTo(w, -h * 0.02, w * 1.05, fy - h * 0.3, cx + w * 0.06, fy);
    g.lineTo(cx + w * 0.08, h);
    g.closePath();
    var gr = g.createRadialGradient(cx, h, 0, cx, h, h);
    gr.addColorStop(0, mix(col, '#7A2A00', 0.4)); gr.addColorStop(1, col);
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    g.strokeStyle = rgba('#7A2A00', 0.5); g.lineWidth = 1.4;
    for (var i = 0; i < 9; i++) {
      var a = -1.25 + i * 2.5 / 8;
      g.beginPath(); g.moveTo(cx, fy); g.quadraticCurveTo(cx + Math.sin(a) * w * 0.3, fy - h * 0.4, cx + Math.sin(a) * w * 0.6, fy - Math.cos(a) * h);
      g.stroke();
    }
    g.strokeStyle = rgba('#FFE7C0', 0.45); g.lineWidth = 1;
    for (i = 1; i < 6; i++) { g.beginPath(); g.ellipse(cx, fy, w * 0.1 * i, h * 0.17 * i, 0, Math.PI, TAU); g.stroke(); }
    g.restore();
    g.beginPath();
    g.moveTo(cx - w * 0.08, h);
    g.lineTo(cx - w * 0.06, fy);
    g.bezierCurveTo(-w * 0.05, fy - h * 0.3, w * 0.0, -h * 0.02, cx, 0);
    g.bezierCurveTo(w, -h * 0.02, w * 1.05, fy - h * 0.3, cx + w * 0.06, fy);
    g.lineTo(cx + w * 0.08, h);
    g.strokeStyle = mix(col, '#5A1A00', 0.5); g.lineWidth = 1.6;
    g.stroke();
  };
  OBST.reefTop = function (g, w, h, rng) {
    var pts = paintRock(g, w, h * 0.8, rng, ['#9C86C8', '#56427A', '#2E2248'], false, true);
    paintSpecks(g, w, h * 0.8, rng, 'rgba(255,200,240,0.3)', 8, pts);
    // little corals hanging
    var cols = ['#FF7AA8', '#FFB03A', '#3CE0B4'];
    for (var i = 0; i < 4; i++) {
      var x = w * (0.15 + i * 0.23), y = h * (0.6 + rng() * 0.1);
      g.fillStyle = cols[i % 3];
      g.beginPath(); g.ellipse(x, y + h * 0.08, w * 0.06, h * 0.12, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.arc(x - w * 0.015, y + h * 0.05, w * 0.02, 0, TAU); g.fill();
    }
  };
  OBST.hull = function (g, w, h, rng) {
    // broken hull piece lying on seabed
    var top = [];
    var n = 7;
    for (var i = 0; i <= n; i++) top.push([w * i / n, h * (0.05 + rng() * 0.25) + (i === 0 || i === n ? h * 0.2 : 0)]);
    g.beginPath();
    g.moveTo(0, h);
    for (i = 0; i <= n; i++) g.lineTo(top[i][0], top[i][1]);
    g.lineTo(w, h);
    g.closePath();
    var gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#9A6440'); gr.addColorStop(1, '#4E2E1C');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    // planks
    g.strokeStyle = 'rgba(30,15,5,0.55)'; g.lineWidth = 2;
    for (var y = h * 0.2; y < h; y += h * 0.14) { g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(w / 2, y + h * 0.05, w, y); g.stroke(); }
    g.strokeStyle = 'rgba(255,220,180,0.18)'; g.lineWidth = 1;
    for (y = h * 0.22; y < h; y += h * 0.14) { g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(w / 2, y + h * 0.05, w, y); g.stroke(); }
    // rust streaks / metal band
    g.fillStyle = '#C0652E';
    g.fillRect(0, h * 0.55, w, h * 0.06);
    g.fillStyle = 'rgba(255,200,120,0.4)'; g.fillRect(0, h * 0.55, w, h * 0.015);
    // portholes
    for (i = 0; i < 2; i++) {
      var px = w * (0.3 + i * 0.4), py = h * 0.42, pr = Math.min(w, h) * 0.08;
      g.fillStyle = '#C79A4A'; g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
      g.fillStyle = '#0B2028'; g.beginPath(); g.arc(px, py, pr * 0.65, 0, TAU); g.fill();
      g.fillStyle = 'rgba(120,220,255,0.35)'; g.beginPath(); g.arc(px - pr * 0.2, py - pr * 0.2, pr * 0.2, 0, TAU); g.fill();
    }
    // barnacles
    g.fillStyle = '#E8E0CC';
    for (i = 0; i < 10; i++) { g.beginPath(); g.arc(rng() * w, h * (0.7 + rng() * 0.3), 1.5 + rng() * 2.5, 0, TAU); g.fill(); }
    g.restore();
    g.beginPath(); g.moveTo(0, h); for (i = 0; i <= n; i++) g.lineTo(top[i][0], top[i][1]); g.lineTo(w, h);
    g.strokeStyle = '#2A160A'; g.lineWidth = 1.8; g.stroke();
  };
  function chainLinks(g, cx, y0, y1, lw) {
    var lh = lw * 1.5, i = 0;
    for (var y = y0; y < y1 - lh * 0.3; y += lh * 0.78, i++) {
      if (i & 1) {
        g.fillStyle = '#6E3A1C';
        roundRect(g, cx - lw * 0.14, y, lw * 0.28, lh, lw * 0.14); g.fill();
        g.fillStyle = 'rgba(255,170,90,0.4)'; g.fillRect(cx - lw * 0.05, y + lh * 0.15, lw * 0.06, lh * 0.7);
      } else {
        g.beginPath(); g.ellipse(cx, y + lh / 2, lw * 0.5, lh / 2, 0, 0, TAU);
        g.ellipse(cx, y + lh / 2, lw * 0.22, lh * 0.28, 0, 0, TAU, true);
        var gr = g.createLinearGradient(cx - lw / 2, 0, cx + lw / 2, 0);
        gr.addColorStop(0, '#E07A3A'); gr.addColorStop(0.5, '#B0562A'); gr.addColorStop(1, '#5E2C14');
        g.fillStyle = gr; g.fill('evenodd');
        g.strokeStyle = '#3A1A0A'; g.lineWidth = 1; g.stroke();
      }
    }
  }
  OBST.chain = function (g, w, h, rng) {
    g.beginPath(); g.rect(0, 0, w, h); g.save(); g.clip();
    chainLinks(g, w / 2, -w * 0.4, h, w);
    g.restore();
  };
  OBST.anchor = function (g, w, h, rng) {
    var ah = h * 0.6, ay = h - ah;
    chainLinks(g, w / 2, -w * 0.2, ay + w * 0.12, w * 0.42);
    var cx = w / 2;
    var gr = g.createLinearGradient(0, ay, w, h);
    gr.addColorStop(0, '#8A98A6'); gr.addColorStop(1, '#3A4552');
    g.fillStyle = gr; g.strokeStyle = '#1A222C'; g.lineWidth = 1.6;
    // ring
    g.beginPath(); g.arc(cx, ay + w * 0.12, w * 0.12, 0, TAU); g.arc(cx, ay + w * 0.12, w * 0.06, 0, TAU, true); g.fill('evenodd'); g.stroke();
    // stock
    g.beginPath(); roundRect(g, w * 0.08, ay + ah * 0.22, w * 0.84, ah * 0.09, ah * 0.04); g.fill(); g.stroke();
    // shank
    g.beginPath(); roundRect(g, cx - w * 0.09, ay + w * 0.2, w * 0.18, ah * 0.78, w * 0.06); g.fill(); g.stroke();
    // arms + flukes
    g.beginPath();
    g.moveTo(cx, h - ah * 0.03);
    g.quadraticCurveTo(w * 0.12, h - ah * 0.04, w * 0.04, h - ah * 0.35);
    g.lineTo(0, h - ah * 0.3); g.lineTo(w * 0.07, h - ah * 0.5); g.lineTo(w * 0.2, h - ah * 0.34); g.lineTo(w * 0.13, h - ah * 0.33);
    g.quadraticCurveTo(w * 0.2, h - ah * 0.18, cx, h - ah * 0.17);
    g.quadraticCurveTo(w * 0.8, h - ah * 0.18, w * 0.87, h - ah * 0.33);
    g.lineTo(w * 0.8, h - ah * 0.34); g.lineTo(w * 0.93, h - ah * 0.5); g.lineTo(w, h - ah * 0.3); g.lineTo(w * 0.96, h - ah * 0.35);
    g.quadraticCurveTo(w * 0.88, h - ah * 0.04, cx, h - ah * 0.03);
    g.closePath(); g.fill(); g.stroke();
    // rust spots + highlight
    g.fillStyle = 'rgba(200,100,40,0.55)';
    for (var i = 0; i < 6; i++) { g.beginPath(); g.arc(cx + (rng() - 0.5) * w * 0.6, ay + ah * (0.3 + rng() * 0.6), 1.5 + rng() * 2, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(cx - w * 0.06, ay + w * 0.25, w * 0.03, ah * 0.6);
  };
  OBST.barrel = function (g, w, h, rng) {
    g.beginPath();
    g.moveTo(w * 0.12, 0);
    g.lineTo(w * 0.88, 0);
    g.quadraticCurveTo(w * 1.04, h / 2, w * 0.88, h);
    g.lineTo(w * 0.12, h);
    g.quadraticCurveTo(-w * 0.04, h / 2, w * 0.12, 0);
    g.closePath();
    var gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#5A3418'); gr.addColorStop(0.35, '#B87A42'); gr.addColorStop(1, '#4A2810');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(40,20,5,0.5)'; g.lineWidth = 1.2;
    for (var i = 1; i < 5; i++) { var x = w * i / 5; g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + (x - w / 2) * 0.25, h / 2, x, h); g.stroke(); }
    g.fillStyle = '#5E6A74';
    [0.14, 0.5, 0.86].forEach(function (k) { g.fillRect(0, h * k - h * 0.05, w, h * 0.1); });
    g.fillStyle = 'rgba(255,255,255,0.25)';
    [0.14, 0.5, 0.86].forEach(function (k) { g.fillRect(0, h * k - h * 0.05, w, h * 0.025); });
    g.fillStyle = '#FFC83D';
    g.beginPath(); g.arc(w * 0.45, h * 0.32, Math.min(w, h) * 0.07, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = '#2A1606'; g.lineWidth = 1.6; g.stroke();
  };
  function paintKelp(g, w, h, rng, flip) {
    if (flip) { g.translate(0, h); g.scale(1, -1); }
    var cx = w / 2;
    var bend = (rng() - 0.5) * w * 0.25;
    var stw = Math.max(4, w * 0.2);
    var sg = g.createLinearGradient(0, h, 0, 0);
    sg.addColorStop(0, '#5A6A1E'); sg.addColorStop(1, '#A8C43E');
    var n = Math.max(5, Math.round(h / (w * 0.42)));
    var leaves = [];
    for (var i = 0; i < n; i++) {
      var tt = (i + 0.5) / n;
      leaves.push({ tt: tt, side: i & 1 ? 1 : -1, y: h - tt * h * 0.96, x: bez(cx, cx + bend, cx - bend, cx, tt) });
    }
    var leaf = function (L, lw, lh, c0, c1) {
      var x = L.x, y = L.y, side = L.side;
      var gr = g.createLinearGradient(x, y, x + side * lw, y);
      gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x, y + lh * 0.2);
      g.bezierCurveTo(x + side * lw * 0.3, y - lh * 1.2, x + side * lw * 0.8, y - lh * 1.1, x + side * lw, y - lh * 1.4);
      g.bezierCurveTo(x + side * lw * 0.9, y - lh * 0.2, x + side * lw * 0.4, y + lh * 0.5, x, y + lh * 0.2);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,60,10,0.5)'; g.lineWidth = 1; g.stroke();
      g.strokeStyle = 'rgba(255,255,200,0.35)';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + side * lw * 0.5, y - lh * 0.8, x + side * lw * 0.92, y - lh * 1.3); g.stroke();
    };
    // back leaves (opposite side, darker) for fullness
    leaves.forEach(function (L) { leaf({ x: L.x, y: L.y - w * 0.12, side: -L.side }, w * 0.42, Math.max(4, w * 0.2), '#4A6A1A', '#7E9E2E'); });
    g.strokeStyle = sg; g.lineWidth = stw; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, h); g.bezierCurveTo(cx + bend, h * 0.66, cx - bend, h * 0.33, cx, h * 0.03); g.stroke();
    g.strokeStyle = 'rgba(255,255,210,0.3)'; g.lineWidth = stw * 0.25;
    g.beginPath(); g.moveTo(cx - stw * 0.2, h); g.bezierCurveTo(cx + bend - stw * 0.2, h * 0.66, cx - bend - stw * 0.2, h * 0.33, cx - stw * 0.2, h * 0.05); g.stroke();
    leaves.forEach(function (L) {
      leaf(L, w * 0.5, Math.max(5, w * 0.24), '#6E9A24', '#C2E050');
      g.fillStyle = '#D8B23A';
      g.beginPath(); g.arc(L.x + L.side * stw * 0.35, L.y + 2, stw * 0.38, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.arc(L.x + L.side * stw * 0.35 - stw * 0.1, L.y + 1, stw * 0.12, 0, TAU); g.fill();
    });
  }
  OBST.kelp = function (g, w, h, rng) { paintKelp(g, w, h, rng, false); };
  OBST.kelpTop = function (g, w, h, rng) { paintKelp(g, w, h, rng, true); };
  OBST.kelpball = function (g, w, h, rng) {
    var cx = w / 2, cy = h / 2;
    g.fillStyle = '#4E6A1A';
    g.beginPath(); g.ellipse(cx, cy, w * 0.42, h * 0.42, 0, 0, TAU); g.fill();
    for (var i = 0; i < 14; i++) {
      var a = rng() * TAU, r = 0.3 + rng() * 0.15;
      var x = cx + Math.cos(a) * w * r * 0.5, y = cy + Math.sin(a) * h * r * 0.5;
      g.save(); g.translate(x, y); g.rotate(a + 1.2);
      var gr = g.createLinearGradient(-w * 0.25, 0, w * 0.25, 0);
      gr.addColorStop(0, '#6E9A24'); gr.addColorStop(1, '#B6D84A');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, 0, w * 0.26, h * 0.08, 0, 0, TAU); g.fill();
      g.restore();
    }
    g.fillStyle = '#C8A83A';
    for (i = 0; i < 5; i++) { g.beginPath(); g.arc(cx + (rng() - 0.5) * w * 0.5, cy + (rng() - 0.5) * h * 0.5, Math.min(w, h) * 0.05, 0, TAU); g.fill(); }
  };
  function iceFill(g, x0, y0, x1, y1) {
    var gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(250,254,255,0.97)');
    gr.addColorStop(0.45, 'rgba(150,215,250,0.95)');
    gr.addColorStop(1, 'rgba(40,130,210,0.96)');
    return gr;
  }
  OBST.icicle = function (g, w, h, rng) {
    var slab = h * 0.26;
    g.fillStyle = iceFill(g, 0, 0, w, h);
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, slab);
    var n = Math.max(2, Math.round(w / 22));
    var main = Math.floor(n / 2);
    for (var i = n - 1; i >= 0; i--) {
      var x0 = w * i / n, x1 = w * (i + 1) / n;
      var len = i === main ? h : slab + (h - slab) * (0.45 + rng() * 0.45);
      g.lineTo(x1, slab);
      g.lineTo((x0 + x1) / 2, len);
      g.lineTo(x0, slab);
    }
    g.lineTo(0, slab);
    g.closePath(); g.fill();
    g.strokeStyle = '#1A5F98'; g.lineWidth = 2; g.stroke();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5;
    for (i = 0; i < n; i++) { var xx = w * (i + 0.35) / n; g.beginPath(); g.moveTo(xx, slab * 0.6); g.lineTo(xx + w / n * 0.1, slab + (h - slab) * 0.4); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(0, 0, w, slab * 0.25);
    g.restore();
  };
  OBST.iceblock = function (g, w, h, rng) {
    var b = Math.min(w, h) * 0.18;
    g.beginPath(); roundRect(g, 0, 0, w, h + 3, Math.min(w, h) * 0.12);
    g.fillStyle = iceFill(g, 0, 0, w * 0.6, h); g.fill();
    g.save(); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w - b, b); g.lineTo(b, b); g.closePath(); g.fill();
    g.fillStyle = 'rgba(40,120,190,0.25)';
    g.beginPath(); g.moveTo(w, 0); g.lineTo(w, h); g.lineTo(w - b, h); g.lineTo(w - b, b); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.2;
    var cx = w * (0.3 + rng() * 0.4), cy = h * (0.3 + rng() * 0.3);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + w * 0.2, cy + h * 0.15); g.moveTo(cx, cy); g.lineTo(cx - w * 0.15, cy + h * 0.3); g.moveTo(cx, cy); g.lineTo(cx + w * 0.05, cy - h * 0.2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    star4(g, w * 0.25, h * 0.3, Math.min(w, h) * 0.08);
    g.restore();
    g.beginPath(); roundRect(g, 0, 0, w, h + 3, Math.min(w, h) * 0.12);
    g.strokeStyle = '#1A5F98'; g.lineWidth = 2; g.stroke();
  };
  OBST.floe = function (g, w, h, rng) {
    var pts = blobPoints(w, h, rng, 9, 6, 0.1, false, false);
    g.beginPath(); smoothPath(g, pts);
    g.fillStyle = iceFill(g, 0, 0, w * 0.4, h); g.fill();
    g.save(); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(0, 0, w, h * 0.3);
    g.fillStyle = 'rgba(40,120,190,0.25)'; g.fillRect(0, h * 0.7, w, h * 0.3);
    g.restore();
    g.strokeStyle = '#1A5F98'; g.lineWidth = 2; g.stroke();
  };
  function lavaCracks(g, w, h, rng, flatBottom) {
    var cracks = [];
    for (var i = 0; i < 3; i++) {
      var x = w * (0.25 + i * 0.25 + (rng() - 0.5) * 0.1), y = flatBottom ? h : 0;
      var c = [[x, y]];
      for (var j = 0; j < 4; j++) { x += (rng() - 0.5) * w * 0.2; y += (flatBottom ? -1 : 1) * h * (0.12 + rng() * 0.1); c.push([x, y]); }
      cracks.push(c);
    }
    return cracks;
  }
  function strokeCracks(g, cracks, col, wid) {
    g.strokeStyle = col; g.lineWidth = wid; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    cracks.forEach(function (c) { g.moveTo(c[0][0], c[0][1]); for (var i = 1; i < c.length; i++) g.lineTo(c[i][0], c[i][1]); });
    g.stroke();
  }
  function paintLava(g, w, h, rng, top) {
    var pts = paintRock(g, w, h, rng, ['#4E4048', '#1A1218', '#0A0608'], !top, top);
    var cr = lavaCracks(g, w, h, rng, !top);
    g.save(); g.beginPath(); smoothPath(g, pts); g.clip();
    strokeCracks(g, cr, 'rgba(255,90,20,0.35)', 7);
    strokeCracks(g, cr, '#FF7A2A', 2.6);
    strokeCracks(g, cr, '#FFE08A', 1);
    g.restore();
    return { pts: pts, cracks: cr };
  }
  OBST.lava = function (g, w, h, rng) { return paintLava(g, w, h, rng, false); };
  OBST.lavaTop = function (g, w, h, rng) { return paintLava(g, w, h, rng, true); };
  OBST.bubbles = function (g, w, h, rng) {
    // vent mound at the bottom; bubbles are drawn live
    var vh = Math.min(h * 0.2, w * 1.0);
    g.beginPath();
    g.moveTo(-1, h + 2); g.quadraticCurveTo(w * 0.1, h - vh, w * 0.35, h - vh);
    g.lineTo(w * 0.65, h - vh); g.quadraticCurveTo(w * 0.9, h - vh, w + 1, h + 2); g.closePath();
    var gr = g.createLinearGradient(0, h - vh, 0, h);
    gr.addColorStop(0, '#4A3A40'); gr.addColorStop(1, '#140C10');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = '#0A0608'; g.lineWidth = 1.4; g.stroke();
    g.fillStyle = '#FF8A3A';
    g.beginPath(); g.ellipse(w / 2, h - vh + 1, w * 0.18, vh * 0.12, 0, 0, TAU); g.fill();
    g.fillStyle = '#FFE08A';
    g.beginPath(); g.ellipse(w / 2, h - vh + 1, w * 0.08, vh * 0.06, 0, 0, TAU); g.fill();
    // faint column
    var cg = g.createLinearGradient(0, 0, w, 0);
    cg.addColorStop(0, 'rgba(255,255,255,0)'); cg.addColorStop(0.5, 'rgba(200,230,255,0.16)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg; g.fillRect(0, 0, w, h - vh);
  };
  function paintSpike(g, w, h, rng, top) {
    // dark rock body with spikes; returns glowing tip positions
    var bodyH = h * 0.62;
    var by = top ? 0 : h - bodyH;
    var pts = blobPoints(w, bodyH, rng, 10, 3, 0.1, !top, top).map(function (p) { return [p[0], p[1] + by]; });
    var tips = [];
    var n = Math.max(3, Math.round(w / (h * 0.14)));
    var gr = g.createLinearGradient(0, top ? 0 : h, 0, top ? h : 0);
    gr.addColorStop(0, '#0E1424'); gr.addColorStop(1, '#2E3A5C');
    g.fillStyle = gr;
    for (var i = 0; i < n; i++) {
      var x = w * (i + 0.5) / n + (rng() - 0.5) * w / n * 0.4;
      var len = (i === Math.floor(n / 2) ? 1 : 0.6 + rng() * 0.4) * (h - bodyH * 0.5);
      var bw = w / n * 0.85;
      var ang = (x / w - 0.5) * 0.5;
      var tx = x + Math.sin(ang) * len * 0.4, ty = top ? bodyH * 0.5 + len : h - bodyH * 0.5 - len;
      ty = Math.max(1, Math.min(h - 1, ty));
      g.beginPath();
      g.moveTo(x - bw, top ? bodyH * 0.5 : h - bodyH * 0.5);
      g.lineTo(tx, ty);
      g.lineTo(x + bw, top ? bodyH * 0.5 : h - bodyH * 0.5);
      g.closePath(); g.fill();
      g.strokeStyle = '#05070E'; g.lineWidth = 1.2; g.stroke();
      tips.push([tx, ty, i % 3 === 1 ? '#C66BFF' : '#4BF2FF']);
    }
    g.beginPath(); smoothPath(g, pts);
    g.fillStyle = gr; g.fill();
    g.strokeStyle = '#05070E'; g.lineWidth = 1.5; g.stroke();
    // glowing spots on body
    var spots = [];
    for (i = 0; i < 6; i++) {
      var sx = w * (0.15 + rng() * 0.7), sy = by + bodyH * (0.25 + rng() * 0.5);
      spots.push([sx, sy, i & 1 ? '#C66BFF' : '#4BF2FF']);
    }
    // baked soft glow (cached once, shadowBlur allowed here)
    g.save();
    tips.concat(spots).forEach(function (p, k) {
      g.shadowColor = p[2]; g.shadowBlur = 8;
      g.fillStyle = p[2];
      g.beginPath(); g.arc(p[0], p[1], k < tips.length ? 2.4 : 1.8, 0, TAU); g.fill();
    });
    g.restore();
    g.fillStyle = '#FFFFFF';
    tips.concat(spots).forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 0.9, 0, TAU); g.fill(); });
    return { lights: tips.concat(spots) };
  }
  OBST.spike = function (g, w, h, rng) { return paintSpike(g, w, h, rng, false); };
  OBST.spikeTop = function (g, w, h, rng) { return paintSpike(g, w, h, rng, true); };
  OBST.angler = function (g, w, h, rng) {
    // faces left (toward the player). Body fills the box; lure drawn live.
    var cx = w * 0.55, cy = h * 0.6;
    // tail
    g.fillStyle = '#1C2236';
    g.beginPath(); g.moveTo(w * 0.86, cy); g.lineTo(w, cy - h * 0.25); g.lineTo(w * 0.97, cy); g.lineTo(w, cy + h * 0.25); g.closePath(); g.fill();
    // body
    g.beginPath();
    g.moveTo(w * 0.04, cy - h * 0.05);
    g.quadraticCurveTo(w * 0.1, h * 0.2, w * 0.45, h * 0.2);
    g.quadraticCurveTo(w * 0.8, h * 0.22, w * 0.9, cy);
    g.quadraticCurveTo(w * 0.8, h * 0.98, w * 0.42, h);
    g.quadraticCurveTo(w * 0.12, h * 0.98, w * 0.02, cy + h * 0.15);
    g.closePath();
    var gr = g.createRadialGradient(cx, cy - h * 0.2, 0, cx, cy, w * 0.6);
    gr.addColorStop(0, '#3A4466'); gr.addColorStop(1, '#10142A');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = '#05060E'; g.lineWidth = 1.5; g.stroke();
    // mouth
    g.fillStyle = '#05050A';
    g.beginPath();
    g.moveTo(w * 0.02, cy - h * 0.02);
    g.quadraticCurveTo(w * 0.22, cy + h * 0.06, w * 0.32, cy + h * 0.02);
    g.quadraticCurveTo(w * 0.2, cy + h * 0.24, w * 0.03, cy + h * 0.14);
    g.closePath(); g.fill();
    g.fillStyle = '#E8F0FF';
    for (var i = 0; i < 5; i++) {
      var tx = w * (0.05 + i * 0.05);
      g.beginPath(); g.moveTo(tx, cy + h * 0.01 + i * h * 0.01); g.lineTo(tx + w * 0.012, cy + h * 0.1); g.lineTo(tx + w * 0.025, cy + h * 0.02 + i * h * 0.01); g.fill();
      g.beginPath(); g.moveTo(tx, cy + h * 0.16 - i * h * 0.004); g.lineTo(tx + w * 0.012, cy + h * 0.08); g.lineTo(tx + w * 0.025, cy + h * 0.16 - i * h * 0.004); g.fill();
    }
    // eye
    g.fillStyle = '#DDE6FF';
    g.beginPath(); g.arc(w * 0.3, cy - h * 0.14, h * 0.065, 0, TAU); g.fill();
    g.fillStyle = '#000';
    g.beginPath(); g.arc(w * 0.29, cy - h * 0.14, h * 0.035, 0, TAU); g.fill();
    // fin + glowing side spots
    g.fillStyle = '#262E4A';
    g.beginPath(); g.moveTo(w * 0.55, cy); g.quadraticCurveTo(w * 0.62, cy + h * 0.2, w * 0.72, cy + h * 0.22); g.quadraticCurveTo(w * 0.66, cy + h * 0.05, w * 0.6, cy - h * 0.02); g.fill();
    g.fillStyle = '#4BF2FF';
    for (i = 0; i < 4; i++) { g.beginPath(); g.arc(w * (0.45 + i * 0.1), cy + h * 0.25 - i * h * 0.03, 1.4, 0, TAU); g.fill(); }
    // stalk (static part)
    g.strokeStyle = '#2A3352'; g.lineWidth = Math.max(1.5, h * 0.03); g.lineCap = 'round';
    g.beginPath(); g.moveTo(w * 0.42, h * 0.22); g.quadraticCurveTo(w * 0.3, -h * 0.02, w * 0.14, h * 0.1); g.stroke();
  };

  var obCache = new Cache(160);
  var OB_PAD = 4;
  function obEntry(kind, w, h, seed, S) {
    var key = kind + '|' + w + '|' + h + '|' + seed + '|' + S;
    var e = obCache.get(key);
    if (e) return e;
    var c = mkCanvas((w + OB_PAD * 2) * S, (h + OB_PAD * 2) * S);
    var g = c.getContext('2d');
    g.scale(S, S);
    g.translate(OB_PAD, OB_PAD);
    var fn = OBST[kind] || OBST.rock;
    var extra = null;
    if (kind !== 'jelly') extra = fn(g, w, h, mulberry(seedNum(seed) + w * 7 + h * 13)) || null;
    if (kind !== 'jelly' && kind !== 'bubbles') {
      // baked top-down light: brighter crown, ambient occlusion toward the base (cached, free per frame)
      g.save();
      g.globalCompositeOperation = 'source-atop';
      var lg = g.createLinearGradient(0, -OB_PAD, 0, h + OB_PAD);
      lg.addColorStop(0, 'rgba(255,250,235,0.16)');
      lg.addColorStop(0.3, 'rgba(255,255,255,0)');
      lg.addColorStop(0.7, 'rgba(0,0,0,0)');
      lg.addColorStop(1, 'rgba(0,6,24,0.3)');
      g.fillStyle = lg;
      g.fillRect(-OB_PAD, -OB_PAD, w + OB_PAD * 2, h + OB_PAD * 2);
      g.restore();
    }
    e = { c: c, extra: extra };
    return obCache.set(key, e);
  }

  function drawJelly(ctx, x, y, w, h, t, seed) {
    var ph = t * 2.4 + seed * 10;
    var pulse = Math.sin(ph);
    var bw = w * (0.92 + pulse * 0.06), bh = h * (0.44 - pulse * 0.03);
    var cx = x + w / 2, top = y + h * 0.02;
    // tentacles
    ctx.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      var tx = cx + (i - 2.5) * w * 0.14;
      ctx.strokeStyle = i & 1 ? 'rgba(220,160,255,0.75)' : 'rgba(180,120,255,0.65)';
      ctx.lineWidth = Math.max(1.2, w * 0.035);
      ctx.beginPath(); ctx.moveTo(tx, top + bh * 0.9);
      ctx.bezierCurveTo(tx + Math.sin(ph + i) * w * 0.1, top + bh + (h - bh) * 0.35, tx - Math.sin(ph + i + 1) * w * 0.1, top + bh + (h - bh) * 0.7, tx + Math.sin(ph * 1.3 + i) * w * 0.06, y + h);
      ctx.stroke();
    }
    // oral arms
    ctx.fillStyle = 'rgba(255,140,220,0.6)';
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.15, top + bh * 0.9);
    ctx.quadraticCurveTo(cx - w * 0.2 + Math.sin(ph) * 4, top + bh + (h - bh) * 0.5, cx - w * 0.02, y + h * 0.85);
    ctx.quadraticCurveTo(cx + w * 0.2 + Math.sin(ph + 1) * 4, top + bh + (h - bh) * 0.5, cx + w * 0.15, top + bh * 0.9);
    ctx.fill();
    // bell
    ctx.beginPath();
    ctx.moveTo(cx - bw / 2, top + bh);
    ctx.bezierCurveTo(cx - bw / 2, top - bh * 0.25, cx + bw / 2, top - bh * 0.25, cx + bw / 2, top + bh);
    ctx.quadraticCurveTo(cx + bw * 0.25, top + bh * 0.85, cx, top + bh);
    ctx.quadraticCurveTo(cx - bw * 0.25, top + bh * 0.85, cx - bw / 2, top + bh);
    ctx.closePath();
    var gr = ctx.createRadialGradient(cx - bw * 0.15, top + bh * 0.3, 0, cx, top + bh * 0.5, bw * 0.7);
    gr.addColorStop(0, 'rgba(250,220,255,0.98)');
    gr.addColorStop(0.5, 'rgba(190,120,255,0.92)');
    gr.addColorStop(1, 'rgba(120,60,210,0.9)');
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = 'rgba(80,30,150,0.8)'; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(cx - bw * 0.18, top + bh * 0.35, bw * 0.12, bh * 0.2, -0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,170,240,0.75)';
    for (i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(cx + (i - 1.5) * bw * 0.18, top + bh * 0.72, bw * 0.045, 0, TAU); ctx.fill(); }
  }

  function drawObstacle(ctx, ob, levelIndex, t) {
    if (!ob) return;
    t = t || 0;
    var x = ob.x, y = ob.y;
    var w = Math.max(4, Math.round(ob.w)), h = Math.max(4, Math.round(ob.h));
    var kind = ob.kind || 'rock';
    var seed = ob.seed == null ? 0 : ob.seed;
    var sd = (typeof seed === 'number' ? seed : seedNum(seed) / 1e9) % 1;
    if (kind === 'jelly') { ctx.save(); drawJelly(ctx, x, y, ob.w, ob.h, t, sd); ctx.restore(); return; }
    var S = ctxScale(ctx);
    var e = obEntry(kind, w, h, seed, S);
    var sx = ob.w / w, sy = ob.h / h;
    if (ob.from === 'bottom' && curLevel !== 6) drawBlobShadow(ctx, x + ob.w / 2, y + ob.h - 1, ob.w * 0.62, Math.max(4, ob.h * 0.06), 0.55);
    ctx.save();
    var sway = 0;
    if (kind === 'seagrass' || kind === 'kelp' || kind === 'kelpTop') sway = Math.sin(t * 1.6 + sd * 20) * 0.05;
    if (sway) {
      // shear anchored at base (bottom for floor plants, top for hanging kelp)
      var ay = kind === 'kelpTop' ? y : y + ob.h;
      ctx.translate(0, ay);
      ctx.transform(1, 0, kind === 'kelpTop' ? -sway : sway, 1, 0, 0);
      ctx.translate(0, -ay);
    }
    if (kind === 'chain' || kind === 'anchor') {
      var sw = Math.sin(t * 1.2 + sd * 10) * 0.025;
      ctx.translate(x + ob.w / 2, y);
      ctx.rotate(sw);
      ctx.translate(-(x + ob.w / 2), -y);
    }
    if (kind === 'kelpball' || kind === 'floe' || kind === 'barrel') {
      var rot = Math.sin(t * 1.1 + sd * 10) * 0.06;
      ctx.translate(x + ob.w / 2, y + ob.h / 2); ctx.rotate(rot); ctx.translate(-(x + ob.w / 2), -(y + ob.h / 2));
    }
    ctx.drawImage(e.c, x - OB_PAD * sx, y - OB_PAD * sy, (w + OB_PAD * 2) * sx, (h + OB_PAD * 2) * sy);
    regDarkSprite(ctx, e.c, x - OB_PAD * sx, y - OB_PAD * sy, (w + OB_PAD * 2) * sx, (h + OB_PAD * 2) * sy);
    ctx.restore();

    // live overlays
    var i;
    if (kind === 'lava' || kind === 'lavaTop') {
      var pulse = 0.35 + 0.35 * Math.sin(t * 2.5 + sd * 12);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = pulse;
      var cr = e.extra && e.extra.cracks;
      if (cr) {
        for (i = 0; i < cr.length; i++) {
          var mp = cr[i][2];
          drawGlow(ctx, x + mp[0] * sx, y + mp[1] * sy, Math.min(ob.w, ob.h) * 0.35, '#FF6A1A', 0.8);
        }
      }
      ctx.restore();
    } else if (kind === 'bubbles') {
      var vh = Math.min(ob.h * 0.2, ob.w);
      var colH = ob.h - vh;
      var n = Math.max(6, Math.round(colH / (ob.w * 0.45)));
      for (i = 0; i < n; i++) {
        var k = ((t * 0.55 + i / n + hash(i + sd * 50) * 0.1) % 1);
        var by = y + colH - k * colH;
        var bx = x + ob.w / 2 + Math.sin(t * 4 + i * 1.7) * ob.w * 0.2;
        var br = ob.w * (0.16 + hash(i * 3 + 1) * 0.16) * (0.7 + k * 0.5);
        drawBubble(ctx, bx, by, Math.min(br, ob.w * 0.42), 0.9);
      }
      drawGlow(ctx, x + ob.w / 2, y + ob.h - vh, ob.w * 0.8, '#FF7A2A', 0.5 + 0.2 * Math.sin(t * 3));
    } else if (kind === 'spike' || kind === 'spikeTop') {
      var L = e.extra && e.extra.lights;
      if (L) {
        for (i = 0; i < L.length; i++) {
          var tw = 0.6 + 0.4 * Math.sin(t * 2 + i * 1.3 + sd * 9);
          var lx = x + L[i][0] * sx, ly = y + L[i][1] * sy;
          drawGlow(ctx, lx, ly, 9 * tw + 4, L[i][2], 0.55 * tw);
          regGlow(ctx, lx, ly, 14 * tw + 6, L[i][2], 0.85 * tw);
        }
      }
    } else if (kind === 'angler') {
      var lp = 0.65 + 0.35 * Math.sin(t * 3 + sd * 7);
      var lx2 = x + ob.w * 0.14 + Math.sin(t * 1.7) * ob.w * 0.015, ly2 = y + ob.h * 0.12 + Math.cos(t * 1.7) * ob.h * 0.02;
      drawGlow(ctx, lx2, ly2, ob.h * 0.45 * lp, '#BFFFF2', 0.75);
      ctx.fillStyle = '#F2FFFC';
      ctx.beginPath(); ctx.arc(lx2, ly2, Math.max(2, ob.h * 0.06), 0, TAU); ctx.fill();
      regGlow(ctx, lx2, ly2, ob.h * 0.7 * lp, '#7FFFE6', 1);
      for (i = 0; i < 4; i++) regGlow(ctx, x + ob.w * (0.45 + i * 0.1), y + ob.h * 0.85 - i * ob.h * 0.03, 6, '#4BF2FF', 0.6);
    }
  }

  // ============================================================ PICKUPS
  var pearlCache = new Cache(24);
  function pearlSprite(r, S) {
    var k = r + '|' + S;
    var c = pearlCache.get(k);
    if (c) return c;
    var R = r * 2.2;
    c = mkCanvas(R * 2 * S, R * 2 * S);
    var g = c.getContext('2d');
    g.scale(S, S);
    var cx = R, cy = R;
    var gl = g.createRadialGradient(cx, cy, r * 0.8, cx, cy, R);
    gl.addColorStop(0, 'rgba(255,240,250,0.45)'); gl.addColorStop(1, 'rgba(255,240,250,0)');
    g.fillStyle = gl; g.fillRect(0, 0, R * 2, R * 2);
    var gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
    gr.addColorStop(0, '#FFFFFF');
    gr.addColorStop(0.45, '#F6ECF8');
    gr.addColorStop(0.85, '#D8C2E6');
    gr.addColorStop(1, '#B49CCC');
    g.fillStyle = gr;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    // iridescent rim
    var ir = g.createLinearGradient(cx - r, cy + r, cx + r, cy - r);
    ir.addColorStop(0, 'rgba(120,220,255,0.45)'); ir.addColorStop(0.5, 'rgba(255,170,230,0.3)'); ir.addColorStop(1, 'rgba(255,230,160,0.4)');
    g.strokeStyle = ir; g.lineWidth = Math.max(1, r * 0.18);
    g.beginPath(); g.arc(cx, cy, r * 0.88, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.ellipse(cx - r * 0.35, cy - r * 0.4, r * 0.28, r * 0.18, -0.6, 0, TAU); g.fill();
    return pearlCache.set(k, c);
  }
  function drawPearl(ctx, x, y, r, t) {
    r = Math.max(2, r);
    t = t || 0;
    var S = ctxScale(ctx);
    var rr = Math.round(r * 2) / 2;
    var R = rr * 2.2;
    var bob = Math.sin(t * 3 + x * 0.05) * r * 0.08;
    ctx.drawImage(pearlSprite(rr, S), x - R, y - R + bob, R * 2, R * 2);
    var tw = Math.sin(t * 4 + x * 0.13);
    if (tw > 0.6) {
      var a = (tw - 0.6) / 0.4;
      ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
      star4(ctx, x + r * 0.45, y - r * 0.5 + bob, r * 0.7 * a);
    }
    regGlow(ctx, x, y, r * 3, '#FFF0FA', 0.5);
  }

  var PU = {
    turbo: '#3CE0B4', shield: '#6FB3FF', magnet: '#FFC83D', ink: '#B48CFF'
  };
  var puCache = new Cache(24);
  function puIcon(g, type, r) {
    g.lineJoin = 'round'; g.lineCap = 'round';
    var col = PU[type];
    if (type === 'turbo') {
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.moveTo(r * 0.12, -r * 0.62); g.lineTo(-r * 0.36, r * 0.08); g.lineTo(-r * 0.02, r * 0.08);
      g.lineTo(-r * 0.14, r * 0.62); g.lineTo(r * 0.38, -r * 0.1); g.lineTo(r * 0.04, -r * 0.1); g.closePath();
      g.fill();
      g.strokeStyle = mix(col, '#000000', 0.5); g.lineWidth = r * 0.06; g.stroke();
    } else if (type === 'shield') {
      g.beginPath();
      g.moveTo(0, -r * 0.6);
      g.quadraticCurveTo(r * 0.3, -r * 0.45, r * 0.48, -r * 0.45);
      g.quadraticCurveTo(r * 0.5, r * 0.25, 0, r * 0.62);
      g.quadraticCurveTo(-r * 0.5, r * 0.25, -r * 0.48, -r * 0.45);
      g.quadraticCurveTo(-r * 0.3, -r * 0.45, 0, -r * 0.6);
      g.closePath();
      g.fillStyle = '#FFFFFF'; g.fill();
      g.save(); g.clip();
      g.fillStyle = rgba(col, 0.55); g.fillRect(0, -r, r, r * 2);
      g.restore();
      g.strokeStyle = mix(col, '#000000', 0.5); g.lineWidth = r * 0.06; g.stroke();
    } else if (type === 'magnet') {
      g.lineWidth = r * 0.26;
      g.strokeStyle = '#FFFFFF';
      g.lineCap = 'butt';
      g.beginPath(); g.arc(0, -r * 0.02, r * 0.3, Math.PI, 0, true); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.3, -r * 0.02); g.lineTo(-r * 0.3, -r * 0.38); g.moveTo(r * 0.3, -r * 0.02); g.lineTo(r * 0.3, -r * 0.38); g.stroke();
      g.strokeStyle = '#FF5A5F';
      g.beginPath(); g.moveTo(-r * 0.3, -r * 0.38); g.lineTo(-r * 0.3, -r * 0.6); g.moveTo(r * 0.3, -r * 0.38); g.lineTo(r * 0.3, -r * 0.6); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = r * 0.05;
      g.beginPath(); g.moveTo(-r * 0.62, -r * 0.6); g.lineTo(-r * 0.5, -r * 0.5); g.moveTo(r * 0.62, -r * 0.6); g.lineTo(r * 0.5, -r * 0.5); g.stroke();
    } else if (type === 'ink') {
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      var n = 9;
      for (var i = 0; i <= n * 2; i++) {
        var a = i / (n * 2) * TAU;
        var rr = (i & 1 ? 0.3 : 0.5) * r * (0.85 + 0.15 * Math.sin(i * 2.3));
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      g.beginPath(); g.arc(r * 0.45, r * 0.42, r * 0.09, 0, TAU); g.fill();
      g.beginPath(); g.arc(-r * 0.5, -r * 0.38, r * 0.07, 0, TAU); g.fill();
      g.fillStyle = mix(col, '#2A1050', 0.4);
      g.beginPath(); g.arc(-r * 0.08, -r * 0.05, r * 0.11, 0, TAU); g.arc(r * 0.13, -r * 0.05, r * 0.11, 0, TAU); g.fill();
    }
  }
  function puSprite(type, r, S) {
    var k = type + '|' + r + '|' + S;
    var c = puCache.get(k);
    if (c) return c;
    var col = PU[type] || '#FFFFFF';
    var R = r * 1.15;
    c = mkCanvas(R * 2 * S, R * 2 * S);
    var g = c.getContext('2d');
    g.scale(S, S);
    g.translate(R, R);
    var gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    gr.addColorStop(0, mix(col, '#FFFFFF', 0.25));
    gr.addColorStop(0.7, mix(col, '#062040', 0.35));
    gr.addColorStop(1, mix(col, '#031A33', 0.55));
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.strokeStyle = mix(col, '#FFFFFF', 0.5); g.lineWidth = Math.max(1.5, r * 0.09);
    g.beginPath(); g.arc(0, 0, r * 0.94, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.ellipse(-r * 0.25, -r * 0.5, r * 0.45, r * 0.2, -0.3, 0, TAU); g.fill();
    puIcon(g, type, r);
    return puCache.set(k, c);
  }
  function drawPowerup(ctx, type, x, y, r, t) {
    t = t || 0;
    r = Math.max(4, r);
    var col = PU[type] || '#FFFFFF';
    var S = ctxScale(ctx);
    var pulse = 1 + Math.sin(t * 4) * 0.05;
    drawGlow(ctx, x, y, r * 2.4 * pulse, col, 0.55 + 0.15 * Math.sin(t * 4));
    regGlow(ctx, x, y, r * 2.6, col, 0.9);
    var rr = Math.round(r);
    var R = rr * 1.15 * pulse;
    ctx.drawImage(puSprite(type, rr, S), x - R, y - R, R * 2, R * 2);
    // orbiting sparkle arc
    ctx.save();
    ctx.strokeStyle = rgba(mix(col, '#FFFFFF', 0.6), 0.85);
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r * 1.22, t * 2.5, t * 2.5 + 1.1); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 1.22, t * 2.5 + Math.PI, t * 2.5 + Math.PI + 0.6); ctx.stroke();
    // expanding "ping" ring that draws the eye to the pickup
    var pk = (t * 0.8) % 1;
    ctx.globalAlpha *= (1 - pk) * 0.7;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, r * 0.07 * (1 - pk) + 0.5);
    ctx.beginPath(); ctx.arc(x, y, r * (1.1 + pk * 0.9), 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function drawShield(ctx, x, y, r, t) {
    t = t || 0;
    ctx.save();
    drawGlow(ctx, x, y, r * 1.5, '#6FB3FF', 0.22 + 0.06 * Math.sin(t * 3));
    var gr = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
    gr.addColorStop(0, 'rgba(111,179,255,0)');
    gr.addColorStop(0.8, 'rgba(111,179,255,0.18)');
    gr.addColorStop(1, 'rgba(160,210,255,0.45)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    var n = 28;
    for (var i = 0; i <= n; i++) {
      var a = i / n * TAU;
      var rr = r * (1 + 0.03 * Math.sin(a * 3 + t * 4) + 0.02 * Math.sin(a * 5 - t * 3));
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,225,255,0.85)';
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r * 0.8, Math.PI * 1.15, Math.PI * 1.45); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(x + r * 0.5, y + r * 0.45, r * 0.06, 0, TAU); ctx.fill();
    // travelling shimmer
    var sa = t * 1.8;
    ctx.strokeStyle = 'rgba(140,200,255,0.6)';
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.beginPath(); ctx.arc(x, y, r * 0.96, sa, sa + 0.8); ctx.stroke();
    ctx.restore();
  }

  var inkBlob = null;
  function getInkBlob() {
    if (inkBlob) return inkBlob;
    inkBlob = mkCanvas(96, 96);
    var g = inkBlob.getContext('2d');
    var gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, 'rgba(24,10,44,0.97)');
    gr.addColorStop(0.55, 'rgba(34,16,62,0.85)');
    gr.addColorStop(1, 'rgba(40,20,70,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
    return inkBlob;
  }
  function drawInkCloud(ctx, x, y, r, t, onShark) {
    t = t || 0;
    var b = getInkBlob();
    ctx.save();
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * TAU + t * 0.6 * (i & 1 ? 1 : -1);
      var d = r * (0.35 + 0.25 * Math.sin(t * 1.3 + i));
      var br = r * (0.75 + 0.2 * Math.sin(t * 2 + i * 1.7));
      ctx.drawImage(b, x + Math.cos(a) * d - br, y + Math.sin(a) * d * 0.7 - br, br * 2, br * 2);
    }
    ctx.drawImage(b, x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
    // purple swirls
    ctx.strokeStyle = 'rgba(180,140,255,0.55)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.lineCap = 'round';
    for (i = 0; i < 3; i++) {
      var sa = t * 2 + i * 2.1;
      ctx.beginPath(); ctx.arc(x + Math.cos(i * 2.1) * r * 0.4, y + Math.sin(i * 2.1) * r * 0.3, r * 0.22, sa, sa + 3.6); ctx.stroke();
    }
    // drips
    ctx.fillStyle = 'rgba(30,14,54,0.9)';
    for (i = 0; i < 3; i++) {
      var dx = x + (i - 1) * r * 0.45, k = (t * 0.7 + i * 0.33) % 1;
      ctx.beginPath(); ctx.arc(dx, y + r * 0.6 + k * r * 0.9, r * 0.09 * (1 - k * 0.5), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  var bubbleSpr = null;
  function getBubble() {
    if (bubbleSpr) return bubbleSpr;
    bubbleSpr = mkCanvas(64, 64);
    var g = bubbleSpr.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 18, 32, 32, 31);
    gr.addColorStop(0, 'rgba(200,235,255,0.06)');
    gr.addColorStop(0.85, 'rgba(200,235,255,0.25)');
    gr.addColorStop(1, 'rgba(230,248,255,0.8)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(32, 32, 31, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(240,250,255,0.85)'; g.lineWidth = 2;
    g.beginPath(); g.arc(32, 32, 30, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.ellipse(22, 20, 7, 4.5, -0.7, 0, TAU); g.fill();
    g.beginPath(); g.arc(42, 44, 2.5, 0, TAU); g.fill();
    return bubbleSpr;
  }
  function drawBubble(ctx, x, y, r, alpha) {
    if (r <= 0) return;
    var a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * (alpha == null ? 1 : Math.max(0, Math.min(1, alpha)));
    ctx.drawImage(getBubble(), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = a0;
  }

  var iconCache = {};
  function fishIconDataURL(fishId, w, h) {
    w = Math.max(8, Math.round(w || 64));
    h = Math.max(8, Math.round(h || 40));
    var k = fishId + '|' + w + '|' + h;
    if (iconCache[k]) return iconCache[k];
    try {
      var c = mkCanvas(w, h);
      var g = c.getContext('2d');
      var d = FDEF[fishId] || FDEF.blixt;
      var tailExtra = d.tail === 'flow' ? 1.2 : 1.05;
      var size = Math.min(w / tailExtra * 0.88, h * 0.94 / (d.h * 1.45 + 0.2));
      drawFish(g, w / 2 + size * 0.05, h / 2 + size * (d.h * 0.12 + 0.05), size, fishId, 0.35, {});
      iconCache[k] = c.toDataURL('image/png');
    } catch (e) {
      iconCache[k] = '';
    }
    return iconCache[k];
  }

  window.Art = {
    FISH: FISH,
    LEVELS: LEVELS,
    OBSTACLE_KINDS: OBSTACLE_KINDS,
    OBSTACLE_SIZE_UNIT: 'playfieldHeight',
    drawFish: drawFish,
    drawShark: drawShark,
    drawBackground: drawBackground,
    drawDarkness: drawDarkness,
    drawObstacle: drawObstacle,
    drawPearl: drawPearl,
    drawPowerup: drawPowerup,
    drawShield: drawShield,
    drawInkCloud: function (ctx, x, y, r, t) { drawInkCloud(ctx, x, y, r, t, false); },
    drawBubble: drawBubble,
    fishIconDataURL: fishIconDataURL,
    // extras (optional for game.js; guarded there)
    drawForeground: drawForeground,
    drawBlobShadow: drawBlobShadow,
    drawGlow: drawGlow
  };
})();
