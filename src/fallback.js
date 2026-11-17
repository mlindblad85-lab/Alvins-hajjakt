/* Enkla ersättare för window.Art och window.Sfx. Definierar bara det som saknas,
 * så att spelet går att köra även om art.js/audio.js inte har laddats. */
(function () {
  'use strict';
  var A = window.Art || (window.Art = {});
  function def(k, v) { if (A[k] === undefined) A[k] = v; }

  var FISH = [
    ['blixt', 'Blixt', '#FF8A3D', '#FFFFFF', null],
    ['neon', 'Neon', '#35E0F0', '#B8FBFF', null],
    ['ninja', 'Ninja', '#3A4250', '#FF4D5A', null],
    ['guldis', 'Guldis', '#FFC83D', '#FFE9A8', null],
    ['lavendel', 'Lavendel', '#B48CFF', '#E3D4FF', null],
    ['mint', 'Mint', '#3CE0B4', '#C9FFF0', null],
    ['tiger', 'Tiger', '#FF9F1C', '#2B2B2B', { type: 'score', value: 1000, label: '1 000 p' }],
    ['zebra', 'Zebra', '#F4F4F4', '#1E1E1E', { type: 'score', value: 2500, label: '2 500 p' }],
    ['korall', 'Korall', '#FF7BAC', '#FFD1E2', { type: 'level', value: 4, label: 'Nå level 4' }],
    ['natt', 'Natt', '#1B2D6B', '#BFD4FF', { type: 'score', value: 5000, label: '5 000 p' }],
    ['regnbage', 'Regnbåge', '#FF5A5F', '#3CE0B4', { type: 'level', value: 7, label: 'Nå level 7' }],
    ['kristall', 'Kristall', '#CFF4FF', '#FFFFFF', { type: 'score', value: 10000, label: '10 000 p' }]
  ];
  var COL = {};
  FISH.forEach(function (f) { COL[f[0]] = [f[2], f[3]]; });
  def('FISH', FISH.map(function (f) { return { id: f[0], name: f[1], unlock: f[4] }; }));

  var LV = [
    ['Lagunen', '#0E6E9A', '#063A5E', '#C9A66B'],
    ['Korallrevet', '#0A5C8C', '#05304F', '#FF7BAC'],
    ['Vraket', '#0B4466', '#04223A', '#B0703C'],
    ['Kelpskogen', '#0A4F4F', '#03262A', '#3FAE5A'],
    ['Isgrottan', '#2A79A8', '#0B3557', '#BFEFFF'],
    ['Vulkanrevet', '#3A2433', '#140A14', '#FF6A2B'],
    ['Djuphavet', '#06121F', '#010509', '#7CF5FF']
  ];
  def('LEVELS', LV.map(function (l) { return { name: l[0] }; }));
  // Måtten är andelar av spelplanens höjd.
  var K = function (kind, from, minH, maxH, minW, maxW, moving) { return { kind: kind, from: from, minH: minH, maxH: maxH, minW: minW, maxW: maxW, moving: !!moving }; };
  def('OBSTACLE_KINDS', LV.map(function (l, i) {
    return [
      K('rock', 'bottom', 0.18, 0.5, 0.14, 0.28),
      K('hang', 'top', 0.18, 0.5, 0.1, 0.2),
      K('blob', 'free', 0.14, 0.24, 0.14, 0.24, i >= 1)
    ];
  }));

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  def('drawFish', function (ctx, x, y, size, id, t, o) {
    o = o || {};
    var c = COL[id] || ['#FF8A3D', '#fff'];
    ctx.save();
    ctx.translate(x, y); ctx.rotate(o.angle || 0);
    ctx.globalAlpha *= (o.alpha == null ? 1 : o.alpha);
    var L = size, Hh = size * 0.22;
    var part = o.part || 'whole';
    if (part === 'skeleton') {
      ctx.strokeStyle = '#EAF4FF'; ctx.lineWidth = Math.max(1.5, L * 0.04);
      ctx.beginPath(); ctx.moveTo(-L * 0.45, 0); ctx.lineTo(L * 0.3, 0); ctx.stroke();
      for (var i = -3; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * L * 0.1, -Hh * 0.8); ctx.lineTo(i * L * 0.1, Hh * 0.8); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(L * 0.36, 0, Hh * 0.7, 0, 7); ctx.stroke();
      ctx.restore(); return;
    }
    if (part === 'front') { ctx.beginPath(); ctx.rect(0, -L, L, L * 2); ctx.clip(); }
    if (part === 'back') { ctx.beginPath(); ctx.rect(-L, -L, L, L * 2); ctx.clip(); }
    var wag = Math.sin(t * 12) * Hh * 0.6;
    ctx.fillStyle = o.flash ? '#FFFFFF' : c[0];
    ctx.beginPath(); ctx.moveTo(-L * 0.35, 0); ctx.lineTo(-L * 0.55, -Hh + wag); ctx.lineTo(-L * 0.55, Hh + wag); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, L * 0.4, Hh, 0, 0, 7); ctx.fill();
    ctx.fillStyle = o.flash ? '#FFFFFF' : c[1];
    ctx.fillRect(-L * 0.1, -Hh * 0.9, L * 0.06, Hh * 1.8);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(L * 0.24, -Hh * 0.25, Hh * 0.32, 0, 7); ctx.fill();
    ctx.fillStyle = '#031A33'; ctx.beginPath(); ctx.arc(L * 0.27, -Hh * 0.25, Hh * 0.16, 0, 7); ctx.fill();
    ctx.restore();
  });

  def('drawShark', function (ctx, x, y, size, t, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.rotate(o.angle || 0);
    var L = size, H = size * 0.16, m = o.mouth || 0;
    var wag = Math.sin(t * 6) * H * 0.5;
    ctx.fillStyle = '#7F93A8';
    ctx.beginPath(); ctx.moveTo(-L * 0.4, 0); ctx.lineTo(-L * 0.55, -H * 1.3 + wag); ctx.lineTo(-L * 0.5, H * 1.1 + wag); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-L * 0.05, -H * 0.8); ctx.lineTo(L * 0.05, -H * 1.9); ctx.lineTo(L * 0.15, -H * 0.8); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, L * 0.45, H, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#DCE6EF'; ctx.beginPath(); ctx.ellipse(L * 0.05, H * 0.45, L * 0.35, H * 0.5, 0, 0, 7); ctx.fill();
    if (m > 0.02) {
      ctx.fillStyle = '#3A0F1A';
      ctx.beginPath(); ctx.moveTo(L * 0.46, 0); ctx.lineTo(L * 0.2, H * 0.1); ctx.lineTo(L * 0.44, H * (0.1 + 0.9 * m)); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = o.dizzy ? '#FFC83D' : '#031A33';
    ctx.beginPath(); ctx.arc(L * 0.3, -H * 0.3, H * 0.16, 0, 7); ctx.fill();
    ctx.restore();
  });

  def('drawBackground', function (ctx, w, h, li, sx, t) {
    var l = LV[li] || LV[0];
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, l[1]); g.addColorStop(1, l[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (var i = 0; i < 8; i++) {
      var px = ((i * 260 - sx * 0.3) % (w + 300) + w + 300) % (w + 300) - 150;
      ctx.beginPath(); ctx.ellipse(px, h - 10, 140, 50, 0, Math.PI, 0); ctx.fill();
    }
  });

  def('drawDarkness', function (ctx, w, h, cx, cy, r) {
    var g = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,2,6,0.94)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });

  def('drawObstacle', function (ctx, ob, li) {
    var l = LV[li] || LV[0];
    ctx.save();
    ctx.fillStyle = l[3];
    rr(ctx, ob.x, ob.y, ob.w, ob.h, Math.min(ob.w, ob.h) * 0.3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    rr(ctx, ob.x + ob.w * 0.55, ob.y, ob.w * 0.45, ob.h, Math.min(ob.w, ob.h) * 0.3); ctx.fill();
    ctx.restore();
  });

  def('drawPearl', function (ctx, x, y, r) {
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#BFD6EE');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  });

  var PC = { turbo: '#3CE0B4', shield: '#6FB3FF', magnet: '#FFC83D', ink: '#B48CFF' };
  def('drawPowerup', function (ctx, type, x, y, r, t) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 5);
    ctx.fillStyle = PC[type] || '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#022A22'; ctx.font = '700 ' + Math.round(r) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText({ turbo: 'T', shield: 'S', magnet: 'M', ink: 'B' }[type] || '?', x, y + 1);
    ctx.restore();
  });
  def('drawShield', function (ctx, x, y, r) {
    ctx.save(); ctx.strokeStyle = 'rgba(111,179,255,0.9)'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(111,179,255,0.15)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  });
  def('drawInkCloud', function (ctx, x, y, r) {
    ctx.save(); ctx.fillStyle = 'rgba(20,10,40,0.8)';
    for (var i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + Math.cos(i * 1.3) * r * 0.5, y + Math.sin(i * 1.3) * r * 0.4, r * 0.55, 0, 7); ctx.fill(); }
    ctx.restore();
  });
  def('drawBubble', function (ctx, x, y, r, a) {
    ctx.save(); ctx.globalAlpha *= (a == null ? 1 : a); ctx.strokeStyle = 'rgba(234,244,255,0.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.restore();
  });
  def('fishIconDataURL', function (id, w, h) {
    try {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      A.drawFish(c.getContext('2d'), w / 2, h / 2, w * 0.8, id, 0.2, {});
      return c.toDataURL('image/png');
    } catch (e) { return ''; }
  });

  if (!window.Sfx) {
    window.Sfx = {
      muted: false,
      unlock: function () {}, play: function () {}, music: function () {}, tension: function () {}, stopMusic: function () {},
      setMuted: function (b) { this.muted = !!b; }
    };
  } else {
    var S = window.Sfx, noop = function () {};
    ['unlock', 'play', 'music', 'tension', 'stopMusic'].forEach(function (k) { if (typeof S[k] !== 'function') S[k] = noop; });
    if (typeof S.setMuted !== 'function') S.setMuted = function (b) { S.muted = !!b; };
  }
})();
