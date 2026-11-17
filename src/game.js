/* Alvins Hajjakt – spellogik */
(function () {
  'use strict';

  /* ================= grund ================= */
  var Art = window.Art, Sfx = window.Sfx, LB = window.Leaderboard;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (a) { return a[(Math.random() * a.length) | 0]; };
  var ease = function (t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('haj_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('haj_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  function sfx(n) { try { Sfx.play(n); } catch (e) {} }
  function safe(fn) { try { return fn(); } catch (e) { if (DEBUG) console.warn(e); } }

  var qs = new URLSearchParams(location.search);
  var DEBUG = qs.get('debug') === '1';
  var START_LEVEL = DEBUG ? clamp(parseInt(qs.get('level'), 10) || 1, 1, 8) : 1;

  var fmt = function (n) { return Math.floor(n).toLocaleString('sv-SE'); };
  var fmt1 = function (n) { return n.toFixed(1).replace('.', ','); };

  var LEVEL_NAMES = ['Lagunen', 'Korallrevet', 'Vraket', 'Kelpskogen', 'Isgrottan', 'Vulkanrevet', 'Djuphavet'];
  function levelName(i) { var l = Art.LEVELS && Art.LEVELS[i]; return (l && l.name) || LEVEL_NAMES[i] || ''; }

  /* Per level: spec-värden + egna täthetsparametrar.
     gapF = garanterad lucka i fiskhöjder, nar = smal passage (fiskhöjder),
     i0/i1 = sekunder mellan hinder i början/slutet av levlen, gate = andel par topp+botten,
     fill = hur långt hindren sträcker sig mot den fria vägen. */
  var LV = [
    { len: 35, spd: 1.00, rec: 0.50, pen: 1.2, sc: 0.40, gapF: 5.2, nar: 0,   i0: 1.00, i1: 0.78, gate: 0.05, fill: 0.00, mov: 0 },
    { len: 40, spd: 1.12, rec: 0.42, pen: 1.6, sc: 0.30, gapF: 4.5, nar: 0,   i0: 0.86, i1: 0.66, gate: 0.20, fill: 0.35, mov: 0.15 },
    { len: 44, spd: 1.24, rec: 0.35, pen: 2.0, sc: 0.22, gapF: 3.9, nar: 0,   i0: 0.74, i1: 0.56, gate: 0.35, fill: 0.55, mov: 1 },
    { len: 48, spd: 1.36, rec: 0.30, pen: 2.5, sc: 0.15, gapF: 3.4, nar: 0,   i0: 0.64, i1: 0.48, gate: 0.45, fill: 0.70, mov: 1 },
    { len: 52, spd: 1.48, rec: 0.25, pen: 3.0, sc: 0.10, gapF: 3.0, nar: 2.15, i0: 0.56, i1: 0.42, gate: 0.50, fill: 0.80, mov: 1 },
    { len: 56, spd: 1.60, rec: 0.20, pen: 3.5, sc: 0.06, gapF: 2.7, nar: 2.0,  i0: 0.49, i1: 0.37, gate: 0.56, fill: 0.88, mov: 1 },
    { len: 60, spd: 1.72, rec: 0.15, pen: 4.0, sc: 0.03, gapF: 2.45, nar: 1.9, i0: 0.44, i1: 0.33, gate: 0.62, fill: 0.93, mov: 1 }
  ];
  var LV_INF = { len: Infinity, spd: 1.72, rec: 0.12, pen: 4.5, sc: 0.02, gapF: 2.35, nar: 1.85, i0: 0.40, i1: 0.31, gate: 0.62, fill: 0.95, mov: 1 };

  var GAP_START = 6.0, GAP_MAX = 7.0;
  var PU_TYPES = ['turbo', 'shield', 'magnet', 'ink'];
  var PU_DUR = { turbo: 3, shield: 8, magnet: 6, ink: 4 };
  var PU_COL = { turbo: '#3CE0B4', shield: '#6FB3FF', magnet: '#FFC83D', ink: '#B48CFF' };
  var PU_NAME = { turbo: 'Turbo!', shield: 'Sköld!', magnet: 'Magnet!', ink: 'Bläckmoln!' };

  /* ================= fult-ord-filter ================= */
  var BAD_SUB = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'nigger', 'nigga', 'nazi', 'hitler', 'whore', 'slut', 'penis', 'porn', 'faggot',
    'bastard', 'asshole', 'wank', 'twat', 'retard', 'motherf', 'heil', 'kkk', 'rapist',
    'fitta', 'fitt', 'kuk', 'knull', 'jävla', 'javla', 'jävel', 'helvete', 'hora', 'horunge', 'skit', 'neger', 'blatte', 'mongo',
    'runka', 'snopp', 'bajs', 'rövhål', 'idiot', 'pedo', 'luder', 'dildo', 'sex', 'cp'];
  var BAD_EXACT = ['ass', 'fag', 'röv', 'bög', 'hor', 'tits', 'cum', 'jävlar', 'kåt', 'rape', 'anal', 'kiss', 'pitt'];
  var BAD_ALLOW = ['sexton', 'sextio', 'sexa', 'essex'];
  function norm(s) {
    s = String(s).toLowerCase();
    var map = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' };
    s = s.replace(/[0-9@$!|]/g, function (c) { return map[c] || c; });
    s = s.replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[éè]/g, 'e').replace(/ü/g, 'u');
    s = s.replace(/[^a-z]/g, '');
    return s.replace(/(.)\1+/g, '$1');
  }
  var BAD_N = BAD_SUB.map(norm).filter(function (w) { return w.length >= 3; });
  var BAD_X = BAD_EXACT.map(norm);
  function isBad(nick) {
    var n = norm(nick);
    if (!n) return false;
    if (BAD_X.indexOf(n) >= 0) return true;
    for (var i = 0; i < BAD_N.length; i++) {
      var w = BAD_N[i];
      var at = n.indexOf(w);
      if (at < 0) continue;
      if (w === 'sex' || w === 'cp') {
        var ok = BAD_ALLOW.some(function (a) { return n.indexOf(norm(a)) >= 0; });
        if (ok) continue;
        if (w === 'cp' && n !== 'cp') continue;
      }
      return true;
    }
    return false;
  }
  var NICK_RE = /^[\p{L}0-9_]{3,12}$/u;

  /* ================= persistent ================= */
  var prof = {
    nick: store.get('nick', ''),
    fish: store.get('fish', 'blixt'),
    best: store.get('best', 0),
    maxLevel: store.get('maxlevel', 1),
    muted: !!store.get('muted', false),
    lastEaten: store.get('lasteaten', -1)
  };
  safe(function () { Sfx.setMuted(prof.muted); });

  function fishList() { return (Art.FISH && Art.FISH.length) ? Art.FISH : [{ id: 'blixt', name: 'Blixt', unlock: null }]; }
  function fishById(id) { var l = fishList(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return l[0]; }
  function isUnlocked(f, best, maxL) {
    if (!f.unlock) return true;
    if (f.unlock.type === 'score') return best >= f.unlock.value;
    if (f.unlock.type === 'level') return maxL >= f.unlock.value;
    return true;
  }
  function unlockLabel(f) {
    if (!f.unlock) return '';
    var l = f.unlock.label || String(f.unlock.value);
    if (f.unlock.type === 'level' && !/level/i.test(l)) return 'Nå level ' + f.unlock.value;
    if (f.unlock.type === 'score' && !/p$/.test(l)) l += ' p';
    return f.unlock.type === 'score' ? 'Nå ' + l : l;
  }
  if (!isUnlocked(fishById(prof.fish), prof.best, prof.maxLevel) || fishById(prof.fish).id !== prof.fish) prof.fish = fishList()[0].id;

  var iconCache = {};
  function fishIcon(id) {
    if (!iconCache[id]) iconCache[id] = safe(function () { return Art.fishIconDataURL(id, 96, 64); }) || '';
    return iconCache[id];
  }

  /* ================= canvas / mått ================= */
  var canvas = $('#game'), ctx = canvas.getContext('2d');
  var W = 0, H = 0, dpr = 1, hudH = 54, playTop = 54, playH = 300, playBot = 354;
  var fishX = 0, fishLen = 50, fishH = 21, sharkLen = 135, ppm = 38, pearlR = 7, puR = 16;
  var probe = $('#safe-probe');

  function measure() {
    var oldW = W, oldTop = playTop, oldPH = playH;
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var sat = probe ? probe.getBoundingClientRect().height : 0;
    hudH = 54 + (sat || 0);
    playTop = hudH; playH = Math.max(120, H - hudH); playBot = playTop + playH;
    fishX = W * 0.35;
    fishLen = clamp(playH * 0.15, 30, 88);
    fishH = fishLen * 0.42;
    sharkLen = fishLen * 2.7;
    ppm = W / 22;
    pearlR = Math.max(5, fishLen * 0.13);
    puR = Math.max(13, fishLen * 0.32);
    if (G && oldW && (oldW !== W || oldPH !== playH)) rescaleWorld(W / oldW, oldTop, oldPH);
  }

  /* ================= skärmar ================= */
  var screens = ['s-start', 's-fish', 's-game', 's-over', 's-board'];
  var current = 's-start', boardReturn = 's-start';
  function show(id) {
    current = id;
    screens.forEach(function (s) { $('#' + s).classList.toggle('active', s === id); });
    if (id === 's-fish') renderFishScreen();
    if (id === 's-start') renderTop3();
    if (id !== 's-over') stopConfetti();
  }

  /* ================= ljud-knappar ================= */
  var ICON_SOUND_ON = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#EAF4FF"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="#EAF4FF" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  var ICON_SOUND_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#9DB8D6"/><path d="M16 9l6 6M22 9l-6 6" stroke="#FF5A5F" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function setMuted(m) {
    prof.muted = m; store.set('muted', m);
    safe(function () { Sfx.setMuted(m); });
    renderSoundButtons();
  }
  function renderSoundButtons() {
    $('#btn-sound').innerHTML = prof.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
    $('#btn-pause-sound').textContent = prof.muted ? 'Ljud: av' : 'Ljud: på';
  }

  /* ================= start ================= */
  var nickInput = $('#nick');
  nickInput.value = prof.nick || '';
  function validateNick(show) {
    var v = nickInput.value.trim();
    var err = '';
    if (v.length < 3 || v.length > 12) err = 'Smeknamnet ska vara 3–12 tecken.';
    else if (!NICK_RE.test(v)) err = 'Använd bara bokstäver, siffror och _.';
    else if (isBad(v)) err = 'Välj ett annat smeknamn';
    if (show) { $('#nick-err').textContent = err; nickInput.classList.toggle('bad', !!err); }
    return err ? null : v;
  }
  nickInput.addEventListener('input', function () {
    var cleaned = nickInput.value.replace(/[^\p{L}0-9_]/gu, '').slice(0, 12);
    if (cleaned !== nickInput.value) nickInput.value = cleaned;
    if ($('#nick-err').textContent) validateNick(true);
  });
  nickInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { nickInput.blur(); $('#btn-choose').click(); } });
  $('#btn-choose').addEventListener('click', function () {
    sfx('click');
    var n = validateNick(true);
    if (!n) return;
    prof.nick = n; store.set('nick', n);
    show('s-fish');
  });
  $('#btn-board-start').addEventListener('click', function () { sfx('click'); openBoard('s-start'); });
  $('#btn-sound').addEventListener('click', function () { setMuted(!prof.muted); sfx('click'); });

  function rowHTML(r, i) {
    var pos = i < 3 ? '<span class="badge b' + (i + 1) + '">' + (i + 1) + '</span>' : (i + 1);
    var lvl = r.level >= 8 ? 'Oändligt' : 'Level ' + r.level;
    var ic = fishIcon(r.fish);
    return '<li class="row' + (r.me ? ' me' : '') + '"><span class="pos">' + pos + '</span>' +
      (ic ? '<img alt="" src="' + ic + '">' : '') +
      '<span class="nick">' + esc(r.nick) + '</span><span class="lvl">' + lvl + '</span><span class="pts">' + fmt(r.score) + '</span></li>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function updateLbNotes() {
    $$('.lb-local').forEach(function (el) {
      el.hidden = !(LB.isLocal || LB.offline);
      el.textContent = LB.offline ? 'Topplistan kunde inte laddas just nu. Visar resultat från den här enheten.'
        : 'Topplistan är lokal på den här enheten tills den kopplas upp';
    });
  }
  function renderTop3() {
    updateLbNotes();
    var el = $('#top3');
    LB.list('today').then(function (rows) {
      rows = rows.slice(0, 3);
      el.innerHTML = rows.length ? rows.map(rowHTML).join('') : '<li class="empty">Ingen har spelat idag än. Bli först!</li>';
    }).catch(function () { el.innerHTML = '<li class="empty">Topplistan kunde inte laddas</li>'; });
  }
  LB.onChange(function () {
    updateLbNotes();
    if (current === 's-start') renderTop3();
    if (current === 's-board') loadBoard();
  });

  /* ================= välj fisk ================= */
  var LOCK_SVG = '<svg class="lock" viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="8" rx="2" fill="#9DB8D6"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#9DB8D6" stroke-width="1.8" fill="none"/></svg>';
  function renderFishScreen() {
    var grid = $('#fishgrid');
    grid.innerHTML = fishList().map(function (f) {
      var un = isUnlocked(f, prof.best, prof.maxLevel);
      return '<button class="fcell' + (un ? '' : ' locked') + (f.id === prof.fish ? ' sel' : '') + '" data-id="' + esc(f.id) + '">' +
        (un ? '' : LOCK_SVG) + '<img alt="" src="' + fishIcon(f.id) + '"><span class="fn">' + esc(f.name) + '</span>' +
        (un ? '' : '<span class="cond">' + esc(unlockLabel(f)) + '</span>') + '</button>';
    }).join('');
    updatePreviewName();
  }
  function updatePreviewName() {
    var f = fishById(prof.fish);
    $('#pname').textContent = f.name;
    $('#ptag').textContent = f.tagline ? String(f.tagline) : '';
  }
  $('#fishgrid').addEventListener('click', function (e) {
    var b = e.target.closest('.fcell'); if (!b) return;
    var f = fishById(b.dataset.id);
    if (!isUnlocked(f, prof.best, prof.maxLevel)) { sfx('click'); b.animate && b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 220 }); return; }
    prof.fish = f.id; store.set('fish', f.id); sfx('click');
    $$('.fcell').forEach(function (c) { c.classList.toggle('sel', c.dataset.id === f.id); });
    updatePreviewName();
  });
  $('#btn-fish-back').addEventListener('click', function () { sfx('click'); show('s-start'); });
  $('#btn-swim').addEventListener('click', function () {
    sfx('click');
    goLandscape();
    newGame(START_LEVEL);
  });
  var pcv = $('#preview'), pctx = pcv.getContext('2d');
  function drawPreview(t) {
    var r = pcv.getBoundingClientRect();
    if (!r.width) return;
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (pcv.width !== w || pcv.height !== h) { pcv.width = w; pcv.height = h; }
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.clearRect(0, 0, r.width, r.height);
    var size = Math.min(r.width * 0.5, r.height * 1.05);
    safe(function () { Art.drawFish(pctx, r.width / 2, r.height * 0.45 + Math.sin(t * 2) * 5, size, prof.fish, t, { angle: Math.sin(t * 1.3) * 0.06 }); });
    if (Math.random() < 0.05) previewBubbles.push({ x: r.width / 2 + size * 0.42, y: r.height * 0.45, r: rand(2, 5), a: 1 });
    previewBubbles = previewBubbles.filter(function (b) { b.y -= 0.6; b.x += 0.3; b.a -= 0.008; if (b.a > 0) safe(function () { Art.drawBubble(pctx, b.x, b.y, b.r, b.a); }); return b.a > 0; });
  }
  var previewBubbles = [];

  function goLandscape() {
    safe(function () {
      var de = document.documentElement;
      if (!document.fullscreenElement && de.requestFullscreen) {
        var p = de.requestFullscreen({ navigationUI: 'hide' });
        if (p && p.then) p.then(lockOri, function () {}); else lockOri();
      } else lockOri();
    });
    function lockOri() { safe(function () { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); }); }
  }

  /* ================= styrning ================= */
  var input = { up: 0, down: 0, kUp: false, kDown: false };
  var pressed = { up: new Set(), down: new Set() };
  function bindCtl(el, dir) {
    function on(e) {
      e.preventDefault();
      safe(function () { el.setPointerCapture(e.pointerId); });
      pressed[dir].add(e.pointerId); el.classList.add('on');
    }
    function off(e) {
      pressed[dir].delete(e.pointerId);
      if (!pressed[dir].size && !(dir === 'up' ? input.kUp : input.kDown)) el.classList.remove('on');
    }
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  bindCtl($('#btn-up'), 'up');
  bindCtl($('#btn-down'), 'down');
  window.addEventListener('keydown', function (e) {
    if (document.activeElement === nickInput) return;
    var k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { input.kUp = true; $('#btn-up').classList.add('on'); e.preventDefault(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { input.kDown = true; $('#btn-down').classList.add('on'); e.preventDefault(); }
    else if ((k === 'Escape' || k === 'p' || k === 'P') && G && (G.mode === 'play' || G.mode === 'countdown')) pauseGame();
  });
  window.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { input.kUp = false; if (!pressed.up.size) $('#btn-up').classList.remove('on'); }
    if (k === 'ArrowDown' || k === 's' || k === 'S') { input.kDown = false; if (!pressed.down.size) $('#btn-down').classList.remove('on'); }
  });
  // Debug-autopilot: auto=1 följer den garanterade vägen exakt, auto=2 = slarvig "människa" (fattar beslut var 0,22 s, ser kortare)
  var autopilot = DEBUG ? (qs.get('auto') | 0) : 0, apDir = 0, apT = 0;
  function inputDir() {
    if (autopilot && G && G.mode === 'play') {
      if (autopilot === 1) {
        var ty = pathAt(G.scroll + fishX + fishLen * 1.2) - G.fishY;
        return Math.abs(ty) < fishH * 0.25 ? 0 : ty < 0 ? -1 : 1;
      }
      if (G.t >= apT) {
        apT = G.t + 0.22;
        var ty2 = pathAt(G.scroll + fishX + fishLen * 0.6) + rand(-1, 1) * fishH * 0.8 - G.fishY;
        apDir = Math.abs(ty2) < fishH * 0.5 ? 0 : ty2 < 0 ? -1 : 1;
      }
      return apDir;
    }
    var u = pressed.up.size > 0 || input.kUp, d = pressed.down.size > 0 || input.kDown;
    return (u ? -1 : 0) + (d ? 1 : 0);
  }
  function clearInput() {
    pressed.up.clear(); pressed.down.clear(); input.kUp = input.kDown = false;
    $('#btn-up').classList.remove('on'); $('#btn-down').classList.remove('on');
  }

  // förhindra zoom/scroll/kontextmeny i spelet
  document.addEventListener('contextmenu', function (e) { if (current === 's-game' || e.target === canvas) e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { if (current === 's-game') e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  var audioUnlocked = false;
  function unlockAudio() { if (audioUnlocked) return; audioUnlocked = true; safe(function () { Sfx.unlock(); }); }
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);

  /* ================= spelstatus ================= */
  var G = null;

  function cfgFor(g) {
    if (!g.inf) return LV[g.level - 1];
    return LV_INF;
  }
  function speedMul(g) {
    var c = cfgFor(g);
    if (!g.inf) return c.spd;
    return c.spd + 0.04 * Math.floor(g.t / 10);
  }
  function envIndex(g) { return g.inf ? Math.floor(g.t / 30) % 7 : g.level - 1; }
  function levelMult(g) { return 1 + 0.25 * (Math.min(g.level, 8) - 1); }

  function newGame(level) {
    $('#s-game').classList.remove('eaten');
    G = {
      mode: 'countdown', level: level, inf: level >= 8, score: 0, crashesTotal: 0, pearlsTotal: 0, streak: 0,
      t: 0, scroll: 0, fishY: 0, fishVY: 0, startedAt: Date.now(), maxLevel: level
    };
    clearInput();
    show('s-game');
    hideOverlays();
    startLevel();
  }

  function startLevel() {
    var g = G;
    g.inf = g.level >= 8;
    g.maxLevel = Math.max(g.maxLevel, g.level);
    g.t = 0; g.scroll = 0; g.crashes = 0; g.pearls = 0; g.levelScore0 = g.score;
    g.gap = GAP_START; g.penPending = 0; g.slowT = 0; g.invulT = 0; g.flashT = 0; g.redT = 0;
    g.shakeT = 0; g.shakeAmp = 0; g.fishY = playTop + playH / 2; g.fishVY = 0; g.tilt = 0;
    g.obs = []; g.pearlsArr = []; g.pus = []; g.parts = []; g.texts = []; g.lines = [];
    g.fx = { turbo: 0, shield: 0, magnet: 0, ink: 0 };
    g.shark = { y: g.fishY, dizzy: 0, spin: 0, lunge: 0 };
    g.path = [{ x: 0, y: g.fishY }, { x: W * 0.9, y: g.fishY }]; g.pathTarget = null;
    g.nextObX = W * 1.25; g.nextPassT = 7 + rand(0, 4); g.nextPuT = rand(5, 8); g.lastEnv = envIndex(g);
    g.tensionT = 0; g.lastTension = -1; g.heartT = 0; g.near = false;
    generate();
    updateHUD(true);
    startCountdown(true);
  }

  /* ---------- väg och hinder ---------- */
  function kindsFor(li) {
    var k = Art.OBSTACLE_KINDS && Art.OBSTACLE_KINDS[li];
    if (!k || !k.length) k = [{ kind: 'rock', from: 'bottom', minH: 0.2, maxH: 0.5, minW: 0.15, maxW: 0.3, moving: false },
      { kind: 'rock', from: 'top', minH: 0.2, maxH: 0.5, minW: 0.12, maxW: 0.22, moving: false }];
    return k;
  }
  function dimH(v) { v = +v || 0; return v <= 2 ? v * playH : v * playH / 330; }
  function vMax() { return 0.9 * playH; }
  function corrGap(g, narrow) { var c = cfgFor(g); return Math.max(1.8, narrow ? c.nar : c.gapF) * fishH; }

  function pathAt(wx) {
    var p = G.path;
    for (var i = p.length - 1; i > 0; i--) {
      if (p[i - 1].x <= wx) {
        var a = p[i - 1], b = p[i];
        if (wx >= b.x) return b.y;
        return lerp(a.y, b.y, (wx - a.x) / (b.x - a.x));
      }
    }
    return p[0].y;
  }
  function extendPath(upto) {
    var g = G, p = g.path;
    var gapPx = corrGap(g, false);
    var sp = 0.55 * W * speedMul(g); // turbo: +35 % fart men även +15 % vertikal fart, marginalen räcker
    var slope = (vMax() * 0.6) / sp;
    while (p[p.length - 1].x < upto) {
      var last = p[p.length - 1];
      var seg = W * rand(0.28, 0.55);
      var lo = playTop + gapPx / 2 + 6, hi = playBot - gapPx / 2 - 6;
      var range = hi - lo, mid = (lo + hi) / 2;
      // vägen har ett mål som den håller tills den nått fram; målen söker sig mot kanterna
      // så att man måste styra (mer ju högre level)
      var target = g.pathTarget;
      if (target == null || Math.abs(target - last.y) < 4 || target < lo || target > hi) {
        var edgeP = g.inf ? 0.8 : 0.3 + 0.07 * g.level;
        target = Math.random() < edgeP ? (last.y > mid ? rand(lo, lo + range * 0.25) : rand(hi - range * 0.25, hi)) : rand(lo, hi);
        if (Math.abs(target - last.y) < range * 0.25) target = last.y < mid ? rand(mid + range * 0.1, hi) : rand(lo, mid - range * 0.1);
        g.pathTarget = target;
      }
      var dy = clamp(target - last.y, -slope * seg, slope * seg);
      p.push({ x: last.x + seg, y: clamp(last.y + dy, lo, hi) });
    }
    while (p.length > 3 && p[1].x < g.scroll - W) p.shift();
  }
  function corridor(wx0, wx1, narrow) {
    var a = wx0 - fishLen * 0.7, b = wx1 + fishLen * 0.7, mn = Infinity, mx = -Infinity;
    for (var i = 0; i <= 6; i++) { var y = pathAt(lerp(a, b, i / 6)); if (y < mn) mn = y; if (y > mx) mx = y; }
    var gp = corrGap(G, narrow);
    return { lo: mn - gp / 2, hi: mx + gp / 2 };
  }

  function generate() {
    var g = G;
    extendPath(g.scroll + W * 2.2);
    var sp = 0.55 * W * speedMul(g);
    var c = cfgFor(g);
    var guard = 0;
    while (g.nextObX < g.scroll + W * 1.4 && guard++ < 20) {
      var estT = g.t + (g.nextObX - g.scroll - fishX) / sp;
      if (!g.inf && estT > c.len - 1.2) { g.nextObX = Infinity; break; }
      var f = g.inf ? clamp(estT / 120, 0, 1) : clamp(estT / c.len, 0, 1);
      var interval = lerp(c.i0, c.i1, f);
      var calm = estT < 5;
      if (calm) interval *= 1.6;
      var li = envIndex(g);
      var end;
      if (!calm && c.nar && estT >= g.nextPassT) {
        end = spawnPassage(g.nextObX, li);
        g.nextPassT = estT + rand(8, 13);
      } else if (!calm && Math.random() < c.gate) {
        end = spawnGate(g.nextObX, li);
      } else {
        end = spawnSingle(g.nextObX, li, calm);
      }
      maybePearls(end, end + interval * sp * 0.8, li);
      g.nextObX = Math.max(end, g.nextObX) + interval * sp * rand(0.85, 1.15);
    }
  }

  function sizeW(k) { return clamp(lerp(dimH(k.minW || 0.15), dimH(k.maxW || 0.3), Math.random()), fishLen * 0.45, W * 0.35); }
  function sizeH(k, allowed, fill) {
    var h = lerp(dimH(k.minH || 0.2), dimH(k.maxH || 0.5), Math.random());
    if (fill > 0) h = Math.max(h, allowed * rand(fill, 1));
    return Math.min(h, allowed);
  }
  function addOb(ob) {
    ob.seed = (Math.random() * 1e6) | 0;
    G.obs.push(ob);
    // ta bort plock som hamnar i hindret
    var ix = ob.wx - pearlR * 2, ax = ob.wx + ob.w + pearlR * 2;
    var iy = ob.by - (ob.amp || 0) - pearlR * 2, ay = ob.by + ob.h + (ob.amp || 0) + pearlR * 2;
    G.pearlsArr = G.pearlsArr.filter(function (p) { return !(p.wx > ix && p.wx < ax && p.y > iy && p.y < ay); });
    G.pus = G.pus.filter(function (p) { return !(p.wx > ix - puR && p.wx < ax + puR && p.y > iy - puR && p.y < ay + puR); });
  }
  function kindsFrom(li, from) { return kindsFor(li).filter(function (k) { return (k.from || 'bottom') === from; }); }

  function spawnSingle(wx, li, calm) {
    var g = G, c = cfgFor(g);
    var ks = kindsFor(li);
    // välj helst ett hinder från den sida där det finns mest plats (där den fria vägen inte går)
    var c0 = corridor(wx, wx + fishLen, false);
    var bigSide = (playBot - c0.hi) > (c0.lo - playTop) ? 'bottom' : 'top';
    var pref = ks.filter(function (k) { return (k.from || 'bottom') === bigSide; });
    for (var tries = 0; tries < 4; tries++) {
      var k = (pref.length && Math.random() < 0.55 + c.fill * 0.4) ? pick(pref) : pick(ks);
      var w = sizeW(k);
      var cor = corridor(wx, wx + w, false);
      var fill = calm ? 0 : c.fill;
      var from = k.from || 'bottom';
      var moving = !!k.moving && c.mov > 0;
      if (from === 'bottom' || from === 'top') {
        var allowed = from === 'bottom' ? playBot - cor.hi : cor.lo - playTop;
        var minH = Math.max(fishH * 0.9, dimH(k.minH || 0.2) * 0.6);
        if (allowed < minH) continue;
        var h = sizeH(k, allowed, fill);
        addOb({ kind: k.kind, li: li, wx: wx, w: w, h: h, by: from === 'bottom' ? playBot - h : playTop, from: from, amp: 0 });
        return wx + w;
      } else {
        var above = cor.lo - playTop, below = playBot - cor.hi;
        var room = Math.max(above, below);
        var hh = clamp(lerp(dimH(k.minH || 0.15), dimH(k.maxH || 0.25), Math.random()), fishH, room);
        if (room < Math.max(fishH, dimH(k.minH || 0.15) * 0.7)) continue;
        var amp = 0;
        if (moving) amp = Math.min((room - hh) / 2, playH * (c.mov < 1 ? 0.02 : 0.1));
        amp = Math.max(0, amp);
        var top, bot;
        if (above >= below) { top = playTop; bot = cor.lo; } else { top = cor.hi; bot = playBot; }
        var y = rand(top + amp, Math.max(top + amp, bot - amp - hh));
        if (Math.random() < fill) y = above >= below ? Math.max(top + amp, bot - amp - hh) : top + amp;
        addOb({ kind: k.kind, li: li, wx: wx, w: Math.min(w, hh * 2.2), h: hh, by: y, from: 'free', amp: amp, ph: rand(0, 6.28), sp: rand(1.6, 2.6) });
        return wx + w;
      }
    }
    return wx + fishLen;
  }

  function spawnGate(wx, li) {
    var g = G, c = cfgFor(g);
    var bk = kindsFrom(li, 'bottom'), tk = kindsFrom(li, 'top');
    if (!bk.length) bk = kindsFor(li);
    if (!tk.length) tk = kindsFor(li);
    var kb = pick(bk), kt = pick(tk);
    var w = sizeW(kb);
    var cor = corridor(wx, wx + w, false);
    var aT = cor.lo - playTop, aB = playBot - cor.hi;
    var gf = Math.max(0.6, c.fill);
    if (aT > fishH) { var ht = aT * rand(gf, 1); addOb({ kind: kt.kind, li: li, wx: wx + rand(-0.1, 0.1) * w, w: w * rand(0.8, 1), h: ht, by: playTop, from: 'top', amp: 0 }); }
    if (aB > fishH) { var hb = aB * rand(gf, 1); addOb({ kind: kb.kind, li: li, wx: wx, w: w, h: hb, by: playBot - hb, from: 'bottom', amp: 0 }); }
    return wx + w;
  }

  function spawnPassage(wx, li) {
    var bk = kindsFrom(li, 'bottom'), tk = kindsFrom(li, 'top');
    if (!bk.length) bk = kindsFor(li);
    if (!tk.length) tk = kindsFor(li);
    var n = 3 + ((Math.random() * 3) | 0);
    var x = wx;
    for (var i = 0; i < n; i++) {
      var w = fishLen * rand(0.9, 1.2);
      var cor = corridor(x, x + w, true);
      var aT = cor.lo - playTop, aB = playBot - cor.hi;
      if (aT > 4) addOb({ kind: pick(tk).kind, li: li, wx: x, w: w, h: aT, by: playTop, from: 'top', amp: 0 });
      if (aB > 4) addOb({ kind: pick(bk).kind, li: li, wx: x, w: w, h: aB, by: playBot - aB, from: 'bottom', amp: 0 });
      x += w * 0.92;
    }
    // pärlor genom passagen som belöning
    for (var px = wx + fishLen * 0.4; px < x; px += pearlR * 4) G.pearlsArr.push({ wx: px, y: pathAt(px), r: pearlR });
    return x;
  }

  function maybePearls(x0, x1, li) {
    var g = G;
    if (Math.random() < 0.35 || x1 - x0 < pearlR * 10) return;
    var n = 5 + ((Math.random() * 4) | 0);
    var span = Math.min(x1 - x0, n * pearlR * 4.2);
    var start = x0 + (x1 - x0 - span) / 2;
    var gp = corrGap(g, false);
    var risky = Math.random() < 0.4;
    var amp = risky ? gp * 0.5 + fishH * rand(0.6, 1.4) : gp * rand(0.1, 0.35);
    var sign = Math.random() < 0.5 ? -1 : 1;
    var shape = Math.random() < 0.6 ? 'arc' : 'line';
    for (var i = 0; i < n; i++) {
      var u = n > 1 ? i / (n - 1) : 0.5;
      var wx = start + span * u;
      var off = shape === 'arc' ? Math.sin(u * Math.PI) * amp * sign : (u - 0.5) * amp * sign;
      var y = clamp(pathAt(wx) + off, playTop + pearlR * 2, playBot - pearlR * 2);
      if (hitsObstacle(wx, y, pearlR * 1.6)) continue;
      g.pearlsArr.push({ wx: wx, y: y, r: pearlR });
    }
  }
  function hitsObstacle(wx, y, r) {
    var o = G.obs;
    for (var i = 0; i < o.length; i++) {
      var b = o[i];
      if (wx + r > b.wx && wx - r < b.wx + b.w && y + r > b.by - b.amp && y - r < b.by + b.h + b.amp) return true;
    }
    return false;
  }

  function rescaleWorld(sx, oldTop, oldPH) {
    var g = G; if (!g) return;
    var sy = playH / oldPH;
    var Y = function (y) { return playTop + (y - oldTop) * sy; };
    g.scroll *= sx;
    if (isFinite(g.nextObX)) g.nextObX *= sx;
    g.path.forEach(function (p) { p.x *= sx; p.y = Y(p.y); });
    g.obs.forEach(function (o) {
      o.wx *= sx; o.w *= sy; o.h *= sy; o.amp *= sy;
      o.by = o.from === 'bottom' ? playBot - o.h : o.from === 'top' ? playTop : Y(o.by);
    });
    g.pearlsArr.forEach(function (p) { p.wx *= sx; p.y = Y(p.y); p.r = pearlR; });
    g.pus.forEach(function (p) { p.wx *= sx; p.y = Y(p.y); });
    g.fishY = clamp(Y(g.fishY), playTop + fishH / 2, playBot - fishH / 2);
    g.shark.y = Y(g.shark.y);
  }

  /* ---------- texter och partiklar ---------- */
  function floatText(x, y, text, color, size, life) {
    G.texts.push({ x: x, y: y, text: text, color: color || '#EAF4FF', size: size || 20, life: life || 1.1, max: life || 1.1 });
  }
  function bubbles(x, y, n, spread) {
    for (var i = 0; i < n; i++) G.parts.push({ k: 'b', x: x + rand(-spread, spread), y: y + rand(-spread, spread), r: rand(2, 6), vx: rand(-30, 30), vy: rand(-90, -30), life: rand(0.6, 1.3), max: 1.3 });
  }
  function sparks(x, y, color, n) {
    for (var i = 0; i < n; i++) { var a = rand(0, 6.28), s = rand(60, 180); G.parts.push({ k: 's', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(1.5, 3), life: rand(0.3, 0.6), max: 0.6, c: color }); }
  }
  function shake(amp, t) { G.shakeAmp = Math.max(G.shakeAmp, amp); G.shakeT = Math.max(G.shakeT, t); }

  /* ---------- nedräkning ---------- */
  var cd = { t: 0, n: 0, first: true };
  function startCountdown(first) {
    G.mode = 'countdown';
    cd.t = 0; cd.n = 3; cd.first = first;
    showOv('ov-count', true);
    setCount('3');
    sfx('countdown');
    if (isPortrait()) handleOrientation();
  }
  function setCount(s) {
    var el = $('#count-num');
    el.textContent = s; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
  function updateCountdown(dt) {
    cd.t += dt;
    var step = 0.75;
    if (cd.n > 0 && cd.t >= step) {
      cd.t -= step; cd.n--;
      if (cd.n > 0) { setCount(String(cd.n)); sfx('countdown'); }
      else {
        setCount('KÖR!'); sfx('go');
        G.mode = 'play';
        safe(function () { Sfx.music(G.inf ? 7 : G.level - 1); });
        setTimeout(function () { if (G && G.mode !== 'countdown') showOv('ov-count', false); }, 450);
      }
    }
  }

  /* ---------- overlays ---------- */
  function showOv(id, on) { $('#' + id).classList.toggle('show', !!on); }
  function hideOverlays() { ['ov-count', 'ov-pause', 'ov-level', 'ov-rotate'].forEach(function (i) { showOv(i, false); }); }

  function pauseGame() {
    if (!G || (G.mode !== 'play' && G.mode !== 'countdown')) return;
    G.mode = 'paused';
    clearInput();
    showOv('ov-count', false);
    showOv('ov-pause', true);
    safe(function () { Sfx.stopMusic(); });
  }
  $('#btn-pause').addEventListener('click', function () { sfx('click'); pauseGame(); });
  $('#btn-resume').addEventListener('click', function () { sfx('click'); showOv('ov-pause', false); startCountdown(false); });
  $('#btn-pause-sound').addEventListener('click', function () { setMuted(!prof.muted); sfx('click'); });
  $('#btn-quit').addEventListener('click', function () { sfx('click'); showOv('ov-pause', false); gameOver(false); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseGame(); });

  function isPortrait() { return window.innerHeight > window.innerWidth; }
  function handleOrientation() {
    if (current !== 's-game' || !G) { showOv('ov-rotate', false); return; }
    var p = isPortrait();
    var active = G.mode === 'play' || G.mode === 'countdown' || G.mode === 'rotate';
    if (p && active) {
      if (G.mode !== 'rotate') { G.mode = 'rotate'; clearInput(); showOv('ov-count', false); safe(function () { Sfx.stopMusic(); }); }
      showOv('ov-rotate', true);
    } else {
      showOv('ov-rotate', false);
      if (!p && G.mode === 'rotate') startCountdown(false);
    }
  }

  /* ---------- level klar ---------- */
  var STAR = function (on) {
    return '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="' + (on ? '#FFC83D' : 'rgba(255,255,255,.15)') + '" stroke="' + (on ? '#FFE08A' : 'rgba(255,255,255,.2)') + '" stroke-width="1"/></svg>';
  };
  function levelClear() {
    var g = G, L = g.level;
    g.mode = 'levelclear';
    clearInput();
    var bonus = 250 * L + (g.crashes === 0 ? 300 : 0);
    g.score += bonus;
    floatText(W / 2, playTop + playH * 0.4, 'LEVEL-BONUS +' + fmt(bonus), '#FFC83D', 28, 1.6);
    sfx('levelup');
    safe(function () { Sfx.stopMusic(); });
    var stars = g.crashes === 0 ? 3 : g.crashes <= 2 ? 2 : 1;
    $('#lc-title').textContent = 'LEVEL ' + L + ' KLARAD';
    $('#lc-stars').innerHTML = STAR(true) + STAR(stars >= 2) + STAR(stars >= 3);
    $('#lc-time').textContent = cfgFor(g).len + ' s';
    $('#lc-pearls').textContent = g.pearls;
    $('#lc-crashes').textContent = g.crashes;
    $('#lc-total').textContent = fmt(g.score);
    if (L < 7) {
      $('#lc-next').innerHTML = '<strong>Nästa: Level ' + (L + 1) + ' · ' + esc(levelName(L)) + '.</strong> Hajen är snabbare och krockar kostar mer.';
      $('#btn-next').textContent = 'Fortsätt till level ' + (L + 1);
    } else {
      $('#lc-next').innerHTML = '<strong>Nästa: Oändligt läge.</strong> Miljöerna byts var 30:e sekund och farten ökar hela tiden. Hur långt kommer du?';
      $('#btn-next').textContent = 'Fortsätt till oändligt läge';
    }
    g.maxLevel = Math.max(g.maxLevel, L + 1);
    setTimeout(function () { if (G === g && g.mode === 'levelclear') { showOv('ov-level', true); updateHUD(true); } }, 700);
  }
  $('#btn-next').addEventListener('click', function () {
    sfx('click');
    showOv('ov-level', false);
    G.level++;
    startLevel();
  });

  /* ---------- krockar, plock ---------- */
  function crash(ob) {
    var g = G, c = cfgFor(g);
    var obMid = ob.y + ob.h / 2;
    if (g.fx.shield > 0) {
      g.fx.shield = 0; g.invulT = 0.6;
      sfx('shield');
      floatText(fishX, g.fishY - fishLen * 0.6, 'Skölden höll!', '#6FB3FF', 20);
      bubbles(fishX, g.fishY, 10, fishLen * 0.4);
      g.fishVY = (g.fishY < obMid ? -1 : 1) * vMax() * 0.5;
      shake(4, 0.15);
      return;
    }
    g.crashes++; g.crashesTotal++;
    if (g.streak >= 10) floatText(fishX, g.fishY + fishLen * 0.8, 'Serien bröts', '#9DB8D6', 15);
    g.streak = 0;
    g.penPending += c.pen;
    g.slowT = 1.0; g.invulT = 0.8; g.flashT = 0.8; g.redT = 0.25;
    g.fishVY = (g.fishY < obMid ? -1 : 1) * vMax() * 0.7;
    shake(10, 0.32);
    sfx('crash');
    safe(function () { if (navigator.vibrate) navigator.vibrate(70); });
    floatText(fishX, g.fishY - fishLen * 0.6, '−' + fmt1(c.pen) + ' m', '#FF5A5F', 24);
    bubbles(fishX + fishLen * 0.3, g.fishY, 12, fishLen * 0.3);
  }
  function collectPearl(p) {
    var g = G;
    g.streak++; g.pearls++; g.pearlsTotal++;
    var sm = g.streak >= 25 ? 3 : g.streak >= 10 ? 2 : 1;
    var pts = Math.round(10 * levelMult(g) * sm);
    g.score += pts;
    sfx('pearl');
    sparks(p.sx, p.y, '#FFFFFF', 6);
    floatText(p.sx, p.y - 10, '+' + pts, sm > 1 ? '#FFC83D' : '#EAF4FF', 16, 0.8);
    if (g.streak === 10 || g.streak === 25) {
      floatText(fishX, playTop + playH * 0.25, 'SERIE ×' + sm, '#FFC83D', 30, 1.3);
      sfx('levelup');
    }
  }
  function collectPu(p) {
    var g = G;
    g.fx[p.type] = PU_DUR[p.type];
    sfx(p.type);
    sparks(p.sx, p.y, PU_COL[p.type], 14);
    floatText(fishX, g.fishY - fishLen * 0.7, PU_NAME[p.type], PU_COL[p.type], 24, 1.1);
  }
  function sharkCrash() {
    var g = G;
    g.shark.dizzy = 1.2;
    g.gap = Math.min(GAP_MAX, g.gap + 1.5);
    g.score += 50;
    sfx('sharkCrash');
    shake(5, 0.2);
    floatText(Math.max(W * 0.22, fishX - W * 0.08), playTop + playH * 0.18, 'Hajen krockade! +50', '#FFC83D', 22, 1.4);
  }

  /* ---------- uppdatering i spel ---------- */
  function updatePlay(dt) {
    var g = G, c = cfgFor(g);
    g.t += dt;
    // power-ups
    for (var k in g.fx) if (g.fx[k] > 0) g.fx[k] = Math.max(0, g.fx[k] - dt);
    g.slowT = Math.max(0, g.slowT - dt); g.invulT = Math.max(0, g.invulT - dt); g.flashT = Math.max(0, g.flashT - dt);
    g.redT = Math.max(0, g.redT - dt);

    var mul = speedMul(g);
    if (g.fx.turbo > 0) mul *= 1.35;
    if (g.slowT > 0) mul *= 1 - 0.45 * (g.slowT / 1.0);
    var sp = 0.55 * W * mul;
    g.scroll += sp * dt;
    g.curSpeed = sp;

    // fisk
    var vm = vMax() * (g.fx.turbo > 0 ? 1.15 : 1);
    var target = inputDir() * vm;
    g.fishVY += (target - g.fishVY) * Math.min(1, dt / 0.08);
    g.fishY += g.fishVY * dt;
    var minY = playTop + fishH * 0.6, maxY = playBot - fishH * 0.6;
    if (g.fishY < minY) { g.fishY = minY; if (g.fishVY < 0) g.fishVY = 0; }
    if (g.fishY > maxY) { g.fishY = maxY; if (g.fishVY > 0) g.fishVY = 0; }
    g.tilt = lerp(g.tilt, clamp(g.fishVY / vMax(), -1, 1) * 0.32, Math.min(1, dt * 12));

    // poäng för överlevnad
    g.score += 10 * levelMult(g) * dt;

    // hajavstånd
    if (g.penPending > 0) { var d = Math.min(g.penPending, dt * 9); g.gap -= d; g.penPending -= d; }
    if (g.slowT <= 0) g.gap += c.rec * dt;
    if (g.fx.turbo > 0) g.gap += 0.8 * dt;
    if (g.fx.ink > 0) g.gap += 0.6 * dt;
    if (g.gap > GAP_MAX) g.gap = GAP_MAX;

    // miljöbyte i oändligt läge
    if (g.inf) {
      var e = envIndex(g);
      if (e !== g.lastEnv) { g.lastEnv = e; floatText(W / 2, playTop + playH * 0.3, levelName(e).toUpperCase(), '#EAF4FF', 30, 1.6); safe(function () { Sfx.music(7); }); }
    }

    generate();
    if (g.t >= g.nextPuT && g.pus.length === 0) {
      var pwx = g.scroll + W + puR * 2;
      g.pus.push({ wx: pwx, y: pathAt(pwx), type: pick(PU_TYPES), ph: rand(0, 6) });
      g.nextPuT = g.t + rand(8, 12);
    }

    // hinder
    var fx0 = fishX - fishLen * 0.33, fx1 = fishX + fishLen * 0.33;
    var fy0 = g.fishY - fishLen * 0.16, fy1 = g.fishY + fishLen * 0.16;
    for (var i = g.obs.length - 1; i >= 0; i--) {
      var o = g.obs[i];
      o.x = o.wx - g.scroll;
      o.y = o.amp ? o.by + Math.sin(g.t * o.sp + o.ph) * o.amp : o.by;
      if (o.x + o.w < -W * 0.4) { g.obs.splice(i, 1); continue; }
      if (g.invulT <= 0 && g.mode === 'play') {
        var ix = o.w * 0.1, iy = o.h * 0.07;
        if (fx1 > o.x + ix && fx0 < o.x + o.w - ix && fy1 > o.y + iy && fy0 < o.y + o.h - iy) crash(o);
      }
    }
    // pärlor
    var magR = W * 0.3;
    for (i = g.pearlsArr.length - 1; i >= 0; i--) {
      var p = g.pearlsArr[i];
      p.sx = p.wx - g.scroll;
      if (p.sx < -40) { g.pearlsArr.splice(i, 1); continue; }
      var dx = fishX - p.sx, dy = g.fishY - p.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (g.fx.magnet > 0 && dist < magR) {
        var pull = Math.min(1, dt * (5 + 600 / Math.max(dist, 30)));
        p.wx += dx * pull; p.y += dy * pull; p.sx = p.wx - g.scroll;
        dist = Math.sqrt(Math.pow(fishX - p.sx, 2) + Math.pow(g.fishY - p.y, 2));
      }
      if (dist < p.r + fishLen * 0.38) { collectPearl(p); g.pearlsArr.splice(i, 1); }
    }
    for (i = g.pus.length - 1; i >= 0; i--) {
      var u = g.pus[i];
      u.sx = u.wx - g.scroll;
      if (u.sx < -60) { g.pus.splice(i, 1); continue; }
      if (Math.hypot(fishX - u.sx, g.fishY - u.y) < puR + fishLen * 0.38) { collectPu(u); g.pus.splice(i, 1); }
    }

    updateShark(dt);
    updateFx(dt);

    // turbo-streck och bubblor bakom fisken
    if (g.fx.turbo > 0 && Math.random() < dt * 40) g.lines.push({ x: W + 10, y: rand(playTop, playBot), l: rand(40, 120), life: 0.5 });
    if (Math.random() < dt * 3) G.parts.push({ k: 'b', x: fishX - fishLen * 0.5, y: g.fishY + rand(-4, 4), r: rand(1.5, 3.5), vx: -40, vy: -30, life: 1, max: 1 });

    // spänning
    var tension = clamp(1 - (g.gap - 0.5) / 4.5, 0, 1);
    g.tensionT -= dt;
    if (g.tensionT <= 0) { g.tensionT = 0.2; if (Math.abs(tension - g.lastTension) > 0.02) { g.lastTension = tension; safe(function () { Sfx.tension(tension); }); } }

    if (g.gap <= 0) { startEaten(); return; }
    if (!g.inf && g.t >= c.len) levelClear();
  }

  function updateShark(dt) {
    var g = G, s = g.shark, c = cfgFor(g);
    s.dizzy = Math.max(0, s.dizzy - dt);
    var mouthX = fishX - g.gap * ppm;
    s.mouthX = mouthX;
    var sh = sharkLen * 0.17;
    var want = g.fishY, avoiding = false;
    for (var i = 0; i < g.obs.length; i++) {
      var o = g.obs[i];
      if (!o.rolled && o.x < mouthX + sharkLen * 0.5) {
        o.rolled = true;
        var near = s.y + sh * 2.5 > o.y && s.y - sh * 2.5 < o.y + o.h;
        if (near && Math.random() < c.sc) o.sharkHit = true;
      }
      if (o.sharkHit && !o.hitDone && o.x <= mouthX - sharkLen * 0.05) { o.hitDone = true; sharkCrash(); }
      if (o.x < mouthX + sharkLen * 0.35 && o.x + o.w > mouthX - sharkLen * 0.95) {
        if (o.sharkHit && !o.hitDone) { want = clamp(o.y + o.h / 2, playTop + sh, playBot - sh); avoiding = true; continue; }
        if (want + sh > o.y && want - sh < o.y + o.h) {
          var up = o.y - sh - 4, dn = o.y + o.h + sh + 4;
          var upOk = up > playTop + sh * 0.5, dnOk = dn < playBot - sh * 0.5;
          if (upOk && (!dnOk || Math.abs(up - s.y) < Math.abs(dn - s.y))) want = up; else if (dnOk) want = dn;
          avoiding = true;
        }
      }
    }
    s.y += (want - s.y) * Math.min(1, dt * (avoiding ? 6 : 2.5));
    s.spin = s.dizzy > 0 ? s.spin + dt * 14 : s.spin * Math.max(0, 1 - dt * 8);
  }

  function updateFx(dt) {
    var g = G;
    g.shakeT = Math.max(0, g.shakeT - dt); if (g.shakeT <= 0) g.shakeAmp = 0;
    for (var i = g.parts.length - 1; i >= 0; i--) {
      var p = g.parts[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 's') { p.vx *= 0.92; p.vy *= 0.92; }
      if (p.life <= 0) g.parts.splice(i, 1);
    }
    for (i = g.texts.length - 1; i >= 0; i--) { var t = g.texts[i]; t.life -= dt; t.y -= 34 * dt; if (t.life <= 0) g.texts.splice(i, 1); }
    for (i = g.lines.length - 1; i >= 0; i--) { var l = g.lines[i]; l.life -= dt; l.x -= W * 2.2 * dt; if (l.life <= 0 || l.x + l.l < 0) g.lines.splice(i, 1); }
    if (g.parts.length > 220) g.parts.splice(0, g.parts.length - 220);
  }

  /* ================= uppäten ================= */
  var EATEN = ['half', 'whole', 'skeleton', 'air', 'tail'];
  function startEaten() {
    var g = G;
    g.mode = 'eaten';
    clearInput();
    $('#s-game').classList.add('eaten');
    safe(function () { Sfx.stopMusic(); });
    var idx;
    do { idx = (Math.random() * EATEN.length) | 0; } while (idx === prof.lastEaten && EATEN.length > 1);
    if (DEBUG && qs.get('eaten')) idx = clamp(parseInt(qs.get('eaten'), 10) || 0, 0, 4);
    prof.lastEaten = idx; store.set('lasteaten', idx);
    g.eat = { type: EATEN[idx], real: 0, t: 0, fx0: fishX, fy0: g.fishY, sx0: g.shark.mouthX - sharkLen * 0.42, sy0: g.shark.y, chomped: false, gulped: false, bubbles: [] };
    g.gap = 0;
  }
  function updateEaten(dt) {
    var g = G, e = g.eat;
    e.real += dt;
    var scale = e.real < 1.1 ? 0.3 : e.real < 1.5 ? lerp(0.3, 1, (e.real - 1.1) / 0.4) : 1;
    var adt = dt * scale;
    e.t += adt;
    g.t += adt * 0.2;
    g.scroll += 0.55 * W * 0.25 * adt;
    for (var i = 0; i < g.obs.length; i++) { var o = g.obs[i]; o.x = o.wx - g.scroll; }
    for (i = 0; i < g.pearlsArr.length; i++) g.pearlsArr[i].sx = g.pearlsArr[i].wx - g.scroll;
    for (i = 0; i < g.pus.length; i++) g.pus[i].sx = g.pus[i].wx - g.scroll;
    if (!e.chomped && e.t >= 0.32) {
      e.chomped = true; sfx('chomp'); shake(8, 0.3);
      if (e.type !== 'whole' && e.type !== 'air') bubbles(e.fx0, e.fy0, 14, fishLen * 0.3);
    }
    if (e.type === 'whole' && !e.gulped && e.t >= 0.75) { e.gulped = true; sfx('gulp'); }
    if (e.type === 'air' && !e.gulped && e.t >= 1.15) { e.gulped = true; sfx('chomp'); }
    g.parts.forEach(function (p) { p.life += dt - adt; });
    updateFx(adt);
    if (e.real >= 2.9) gameOver(true);
  }

  /* ================= game over ================= */
  var lastResult = null;
  function gameOver(eaten) {
    var g = G;
    if (!g || g.mode === 'over') return;
    g.mode = 'over';
    safe(function () { Sfx.stopMusic(); Sfx.tension(0); });
    hideOverlays();
    var score = Math.floor(g.score);
    var level = g.level;
    var prevBest = prof.best, prevMax = prof.maxLevel;
    var newBest = score > prevBest && score > 0;
    prof.best = Math.max(prevBest, score); prof.maxLevel = Math.max(prevMax, g.maxLevel, level);
    store.set('best', prof.best); store.set('maxlevel', prof.maxLevel);
    var unlocked = fishList().filter(function (f) { return !isUnlocked(f, prevBest, prevMax) && isUnlocked(f, prof.best, prof.maxLevel); });

    $('#over-title').textContent = eaten ? 'Uppäten!' : 'Rundan avslutad';
    $('#over-score').textContent = fmt(score);
    $('#over-level').textContent = (level >= 8 ? 'Oändligt läge' : 'Level ' + level + ' · ' + levelName(level - 1));
    $('#over-pb').hidden = !newBest;
    $('#over-best').textContent = newBest ? '' : 'Ditt personbästa: ' + fmt(prof.best) + ' p';
    $('#over-rank').innerHTML = score > 0 ? '<span class="sub">Räknar placering …</span>' : '';
    $('#over-chase').textContent = '';
    $('#over-unlock').innerHTML = unlocked.map(function (f) {
      return '<div class="unlock"><img alt="" src="' + fishIcon(f.id) + '"><span>Ny fisk upplåst! ' + esc(f.name) + '</span></div>';
    }).join('');
    show('s-over');
    if (newBest) { sfx('record'); startConfetti(); }
    lastResult = { score: score, level: level };
    if (score <= 0) return;
    var res = lastResult;
    LB.submit({ nick: prof.nick, score: score, level: level, fish: prof.fish }).then(function (r) {
      if (r && !r.ok && lastResult === res) {
        $('#over-chase').innerHTML = '<span class="sub">Poängen kunde inte sparas på den gemensamma topplistan just nu</span>';
      }
    }).catch(function () {
      if (lastResult === res) $('#over-chase').innerHTML = '<span class="sub">Poängen kunde inte sparas på topplistan</span>';
    }).then(function () {
      return Promise.all([LB.rank(score, 'today'), LB.list('today')]);
    }).then(function (a) {
      if (lastResult !== res) return;
      var rank = a[0], rows = a[1] || [];
      $('#over-rank').innerHTML = rank === 1 ? 'Du leder dagens topplista!' : 'Du är <em>#' + rank + '</em> idag';
      if (rank > 1) {
        var above = rows.filter(function (r) { return !r.me && r.score > score; });
        var nxt = above.length ? above[above.length - 1] : null;
        if (nxt) $('#over-chase').innerHTML = 'Bara <em>' + fmt(nxt.score - score + 1) + ' p</em> till plats ' + (rank - 1);
      }
    }).catch(function () { if (lastResult === res) $('#over-rank').innerHTML = '<span class="sub">Topplistan kunde inte laddas</span>'; });
  }
  $('#btn-again').addEventListener('click', function () { sfx('click'); goLandscape(); newGame(1); });
  $('#btn-change').addEventListener('click', function () { sfx('click'); show('s-fish'); });
  $('#btn-board-over').addEventListener('click', function () { sfx('click'); openBoard('s-over'); });

  /* konfetti */
  var conf = { on: false, parts: [], t: 0 };
  var ccv = $('#confetti'), cctx = ccv.getContext('2d');
  function startConfetti() {
    conf.on = true; conf.t = 0; conf.parts = [];
    var cols = ['#FFC83D', '#3CE0B4', '#FF5A5F', '#6FB3FF', '#B48CFF', '#EAF4FF'];
    for (var i = 0; i < 140; i++) conf.parts.push({ x: rand(0, W), y: rand(-H, 0), vx: rand(-40, 40), vy: rand(80, 220), r: rand(0, 6.28), vr: rand(-6, 6), s: rand(5, 10), c: pick(cols) });
  }
  function stopConfetti() { conf.on = false; cctx.clearRect(0, 0, ccv.width, ccv.height); }
  function drawConfetti(dt) {
    if (!conf.on) return;
    conf.t += dt;
    if (ccv.width !== canvas.width) { ccv.width = canvas.width; ccv.height = canvas.height; }
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, W, H);
    conf.parts.forEach(function (p) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.vx += Math.sin(conf.t * 3 + p.s) * 20 * dt;
      cctx.save(); cctx.translate(p.x, p.y); cctx.rotate(p.r); cctx.fillStyle = p.c;
      cctx.globalAlpha = clamp(4 - conf.t, 0, 1);
      cctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cctx.restore();
    });
    if (conf.t > 4) stopConfetti();
  }

  /* ================= topplista ================= */
  var boardPeriod = 'today';
  function openBoard(from) { boardReturn = from; show('s-board'); loadBoard(); }
  function loadBoard() {
    updateLbNotes();
    $$('#tabs .tab').forEach(function (t) { t.classList.toggle('on', t.dataset.p === boardPeriod); });
    var el = $('#board-rows'), p = boardPeriod;
    el.innerHTML = '<li class="empty">Laddar …</li>';
    LB.list(p).then(function (rows) {
      if (p !== boardPeriod) return;
      el.innerHTML = rows.length ? rows.slice(0, 50).map(rowHTML).join('') : '<li class="empty">Inga resultat än.</li>';
      var me = el.querySelector('.me'); if (me && me.scrollIntoView) me.scrollIntoView({ block: 'nearest' });
    }).catch(function () { if (p === boardPeriod) el.innerHTML = '<li class="empty">Topplistan kunde inte laddas</li>'; });
  }
  $('#tabs').addEventListener('click', function (e) { var t = e.target.closest('.tab'); if (!t) return; sfx('click'); boardPeriod = t.dataset.p; loadBoard(); });
  $('#btn-board-back').addEventListener('click', function () { sfx('click'); show(boardReturn); });

  /* ================= HUD ================= */
  var hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; var el = document.getElementById(id); if (el) el.textContent = v; } }
  var PU_SVG = {
    turbo: '<svg viewBox="0 0 16 16"><path d="M9 1L3 9h4l-1 6 6-8H8z" fill="#3CE0B4"/></svg>',
    shield: '<svg viewBox="0 0 16 16"><path d="M8 1l6 2v4c0 4-3 6.5-6 8-3-1.5-6-4-6-8V3z" fill="#6FB3FF"/></svg>',
    magnet: '<svg viewBox="0 0 16 16"><path d="M3 2h3v6a2 2 0 0 0 4 0V2h3v6a5 5 0 0 1-10 0z" fill="#FFC83D"/><rect x="3" y="2" width="3" height="2" fill="#EAF4FF"/><rect x="10" y="2" width="3" height="2" fill="#EAF4FF"/></svg>',
    ink: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5" fill="#B48CFF"/><circle cx="3.5" cy="5" r="2" fill="#B48CFF"/><circle cx="12.5" cy="4" r="1.6" fill="#B48CFF"/></svg>'
  };
  function updateHUD(force) {
    var g = G; if (!g) return;
    if (force) hudCache = {};
    var e = envIndex(g);
    setText('hud-level', g.inf ? 'OÄNDLIGT · ' + levelName(e).toUpperCase() : 'LEVEL ' + g.level + ' · ' + levelName(e).toUpperCase());
    var len = cfgFor(g).len;
    if (g.inf) {
      setText('hud-time', Math.floor(g.t) + ' s');
      var w = ((g.t % 30) / 30 * 100).toFixed(1) + '%';
      if (hudCache.bar !== w) { hudCache.bar = w; $('#hud-bar').style.width = w; }
    } else {
      setText('hud-time', Math.min(len, Math.floor(g.t)) + ' / ' + len + ' s');
      var w2 = (clamp(g.t / len, 0, 1) * 100).toFixed(1) + '%';
      if (hudCache.bar !== w2) { hudCache.bar = w2; $('#hud-bar').style.width = w2; }
    }
    setText('hud-score', fmt(g.score));
    setText('hud-pearls', String(g.pearlsTotal));
    setText('shark-txt', 'Hajen: ' + fmt1(Math.max(0, g.gap)) + ' m bakom');
    var near = g.gap < 2.5;
    if (hudCache.near !== near) { hudCache.near = near; $('#shark-ind').classList.toggle('near', near); }
    var sm = g.streak >= 25 ? 3 : g.streak >= 10 ? 2 : 1;
    setText('hud-streak', sm > 1 ? 'SERIE ×' + sm + ' · ' + g.streak : '');
    var pu = PU_TYPES.filter(function (k) { return g.fx[k] > 0; }).map(function (k) { return k + ':' + Math.ceil(g.fx[k]); }).join(',');
    if (hudCache.pu !== pu) {
      hudCache.pu = pu;
      $('#hud-pus').innerHTML = PU_TYPES.filter(function (k) { return g.fx[k] > 0; }).map(function (k) {
        return '<div class="chip pu" style="box-shadow:inset 0 0 0 1.5px ' + PU_COL[k] + '">' + PU_SVG[k] + '<b>' + Math.ceil(g.fx[k]) + '</b></div>';
      }).join('');
    }
  }

  /* ================= rendering ================= */
  function drawWorld(time) {
    var g = G;
    var li = envIndex(g);
    safe(function () { Art.drawBackground(ctx, W, H, li, g.scroll, time); });

    // pärlor och power-ups (i djuphavet ritas de efter mörkret)
    var deep = li === 6;
    if (!deep) drawPickups(time);
    g.obs.forEach(function (o) { if (o.x < W + 10 && o.x + o.w > -10) drawOb(o, time); });

    var e = g.mode === 'eaten' ? g.eat : null;
    if (!e) {
      if (deep) drawDeep(time);
      drawShark(time, 1);
      drawFishNow(time);
    } else {
      if (deep) drawDeep(time);
      drawEatenScene(time);
    }
    if (deep) drawPickups(time);
    drawParts();
    drawLines();
  }
  function drawDeep(time) {
    var g = G;
    var fy = g.mode === 'eaten' ? g.eat.fy0 : g.fishY;
    safe(function () { Art.drawDarkness(ctx, W, H, fishX, fy, Math.max(170, W * 0.3, playH * 0.65)); });
    // självlysande hinder syns svagt i mörkret
    ctx.save(); ctx.globalAlpha = 0.42;
    g.obs.forEach(function (o) { if (o.x < W + 10 && o.x + o.w > -10) drawOb(o, time); });
    ctx.restore();
  }
  function drawOb(o, time) {
    var tmp = { kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, seed: o.seed, from: o.from };
    safe(function () { Art.drawObstacle(ctx, tmp, o.li, time); });
  }
  function drawPickups(time) {
    var g = G;
    g.pearlsArr.forEach(function (p) { if (p.sx > -20 && p.sx < W + 20) safe(function () { Art.drawPearl(ctx, p.sx, p.y + Math.sin(time * 3 + p.wx * 0.02) * 2, p.r, time); }); });
    g.pus.forEach(function (u) { safe(function () { Art.drawPowerup(ctx, u.type, u.sx, u.y + Math.sin(time * 2.5 + u.ph) * 4, puR, time); }); });
  }
  function drawShark(time, alpha) {
    var g = G, s = g.shark;
    var mx = (s.mouthX != null ? s.mouthX : fishX - g.gap * ppm);
    var cx = mx - sharkLen * 0.42;
    if (cx + sharkLen * 0.6 < 0) return;
    var mouth = clamp(1 - g.gap / 3, 0, 1);
    var ang = Math.sin(s.spin) * (s.dizzy > 0 ? 0.6 : 0) + clamp((g.fishY - s.y) / playH, -0.3, 0.3) * 0.6;
    ctx.save(); ctx.globalAlpha = alpha;
    safe(function () { Art.drawShark(ctx, cx, s.y, sharkLen, time, { mouth: mouth, angle: ang, inked: g.fx.ink > 0, dizzy: s.dizzy > 0 }); });
    ctx.restore();
    if (g.fx.ink > 0) safe(function () { Art.drawInkCloud(ctx, cx + sharkLen * 0.28, s.y - sharkLen * 0.04, sharkLen * 0.22, time); });
  }
  function drawFishNow(time) {
    var g = G;
    var flash = g.flashT > 0 && Math.floor(g.flashT * 12) % 2 === 0;
    var alpha = g.invulT > 0 ? (Math.floor(g.invulT * 14) % 2 ? 0.45 : 1) : 1;
    safe(function () { Art.drawFish(ctx, fishX, g.fishY, fishLen, prof.fish, time * (g.fx.turbo > 0 ? 1.6 : 1), { angle: g.tilt, alpha: alpha, flash: flash, part: 'whole' }); });
    if (g.fx.shield > 0) {
      var a = g.fx.shield < 1.5 ? (Math.floor(g.fx.shield * 8) % 2 ? 0.4 : 1) : 1;
      ctx.save(); ctx.globalAlpha = a;
      safe(function () { Art.drawShield(ctx, fishX, g.fishY, fishLen * 0.62, time); });
      ctx.restore();
    }
    if (g.fx.magnet > 0) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,200,61,' + (0.18 + 0.1 * Math.sin(time * 8)) + ')'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.arc(fishX, g.fishY, W * 0.3 * (0.6 + 0.4 * ((time * 0.8) % 1)), 0, 6.283); ctx.stroke(); ctx.restore();
    }
  }
  function drawParts() {
    var g = G;
    g.parts.forEach(function (p) {
      var a = clamp(p.life / p.max, 0, 1);
      if (p.k === 'b') safe(function () { Art.drawBubble(ctx, p.x, p.y, p.r, a * 0.8); });
      else { ctx.globalAlpha = a; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; }
    });
  }
  function drawLines() {
    var g = G; if (!g.lines.length) return;
    ctx.save(); ctx.strokeStyle = 'rgba(234,244,255,0.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    g.lines.forEach(function (l) { ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(l.x + l.l, l.y); ctx.stroke(); });
    ctx.restore();
  }
  function drawTexts() {
    var g = G;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    g.texts.forEach(function (t) {
      var a = clamp(t.life / t.max * 1.6, 0, 1);
      var grow = 1 + Math.max(0, (t.life - t.max + 0.15)) * 3;
      ctx.globalAlpha = a;
      ctx.font = '700 ' + Math.round(t.size * grow) + 'px "Space Grotesk", system-ui, sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(3,26,51,0.75)'; ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
    });
    ctx.restore();
  }
  function drawVignette(time) {
    var g = G;
    var prox = clamp(1 - (g.gap - 0.3) / 5, 0, 1);
    if (g.mode === 'eaten') prox = 1;
    if (prox > 0.02) {
      var pulse = g.gap < 2.5 ? 0.15 * (0.5 + 0.5 * Math.sin(time * (6 + (2.5 - g.gap) * 4))) : 0;
      var a = prox * 0.55 + pulse;
      var wv = W * (0.18 + prox * 0.25);
      var gr = ctx.createLinearGradient(0, 0, wv, 0);
      gr.addColorStop(0, 'rgba(255,40,50,' + a.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,40,50,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, wv, H);
    }
    if (g.redT > 0) { ctx.fillStyle = 'rgba(255,60,70,' + (g.redT * 0.9).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
  }

  /* uppäten-scenerna */
  function drawEatenScene(time) {
    var g = G, e = g.eat, t = e.t;
    var fx = e.fx0, fy = e.fy0;
    var mouthOff = sharkLen * 0.42;
    var bite = 0.32;
    var sx, sy, sa = 0, mouth = 0, inked = g.fx.ink > 0;
    var fishDraw = null; // {x,y,part,angle,alpha}
    var extra = [];
    var approach = function (u) { return lerp(e.sx0, fx - mouthOff, ease(u)); };
    switch (e.type) {
      case 'half':
        if (t < bite) { sx = approach(t / bite); sy = lerp(e.sy0, fy, ease(t / bite)); mouth = clamp(t / bite * 1.4, 0, 1); fishDraw = { x: fx, y: fy, part: 'whole', angle: 0 }; }
        else {
          var u = t - bite;
          sx = fx - mouthOff + u * W * 0.45; sy = fy - u * 10; mouth = u < 0.08 ? 1 - u / 0.08 : 0;
          fishDraw = { x: fx + fishLen * 0.05 + u * 12, y: fy + u * u * 70 + u * 40, part: 'front', angle: u * 2.2 };
          if (u < 0.25) extra.push({ x: sx + mouthOff - fishLen * 0.1, y: sy, part: 'back', angle: 0, alpha: 1 - u / 0.25 });
          if (Math.random() < 0.3) e.bubbles.push({ x: fishDraw.x, y: fishDraw.y, r: rand(2, 5), a: 1 });
        }
        break;
      case 'whole':
        if (t < bite) { sx = approach(t / bite); sy = lerp(e.sy0, fy, ease(t / bite)); mouth = clamp(t / bite * 1.5, 0, 1); fishDraw = { x: fx, y: fy, part: 'whole', angle: 0 }; }
        else {
          var u2 = t - bite;
          sx = fx - mouthOff + u2 * 25; sy = fy; mouth = u2 < 0.06 ? 1 - u2 / 0.06 : 0;
          if (u2 < 0.06) fishDraw = { x: fx - u2 * 200, y: fy, part: 'whole', angle: 0, alpha: 1 - u2 / 0.06 };
          var gs = u2 > 0.35 && u2 < 0.75 ? Math.sin((u2 - 0.35) / 0.4 * Math.PI) : 0;
          sa = -gs * 0.08;
          if (u2 > 0.6 && !e.burp) { e.burp = { x: sx + mouthOff * 0.95, y: fy - sharkLen * 0.05, r: 4 }; }
        }
        if (e.burp) { e.burp.y -= 0.9 + (t - 0.9) * 0.6; e.burp.r = Math.min(fishLen * 0.5, e.burp.r + 0.35); e.burp.x += 0.2; }
        break;
      case 'skeleton':
        sx = lerp(e.sx0, fx + W * 0.7, ease(t / 1.0)); sy = lerp(e.sy0, fy, ease(t / 0.3)); mouth = t < bite ? 1 : clamp(1 - (t - bite) * 4, 0, 1);
        if (t < bite) fishDraw = { x: fx, y: fy, part: 'whole', angle: 0 };
        else { var u3 = t - bite; fishDraw = { x: fx + Math.sin(u3 * 4) * 12, y: fy + u3 * 55, part: 'skeleton', angle: Math.sin(u3 * 3) * 0.3 }; }
        break;
      case 'air':
        var top = playTop - fishLen * 0.2;
        if (t < 0.28) { var a0 = t / 0.28; sx = lerp(e.sx0, fx - mouthOff * 0.8, ease(a0)); sy = lerp(e.sy0, fy + fishLen * 0.9, ease(a0)); sa = -0.4 * a0; fishDraw = { x: fx, y: fy, part: 'whole', angle: 0 }; }
        else {
          var u4 = t - 0.28, flyT = clamp(u4 / 0.85, 0, 1);
          var fyNow = lerp(fy, top - playH * 0.05, ease(flyT)) - Math.sin(flyT * Math.PI) * playH * 0.08;
          var fxNow = fx + u4 * 60;
          if (t < 1.15) fishDraw = { x: fxNow, y: fyNow, part: 'whole', angle: u4 * 9 };
          var jump = clamp((u4 - 0.35) / 0.52, 0, 1);
          sx = lerp(fx - mouthOff * 0.8, fxNow - mouthOff * 0.6, ease(jump)) + (t > 1.15 ? (t - 1.15) * W * 0.6 : 0);
          sy = lerp(fy + fishLen * 0.9, top + sharkLen * 0.18, ease(jump)) + (t > 1.15 ? (t - 1.15) * 260 : 0);
          sa = lerp(-0.4, -1.0, jump) + (t > 1.15 ? (t - 1.15) * 3 : 0);
          mouth = jump > 0.6 && t < 1.15 ? 1 : t >= 1.15 ? 0 : 0.3;
          if (t >= 1.15 && t < 1.2) bubbles(fxNow, top + 10, 2, 20);
        }
        break;
      case 'tail':
        var tailX = fx - fishLen * 0.45;
        if (t < bite) { sx = lerp(e.sx0, tailX - mouthOff, ease(t / bite)); sy = lerp(e.sy0, fy, ease(t / bite)); mouth = clamp(t / bite * 1.5, 0, 1); fishDraw = { x: fx, y: fy, part: 'whole', angle: 0 }; }
        else {
          var u5 = t - bite;
          var shakeA = u5 < 0.9 ? Math.sin(u5 * 28) * (1 - u5 / 0.9) : 0;
          var drag = u5 > 0.75 ? (u5 - 0.75) : 0;
          sx = tailX - mouthOff + drag * W * 0.9; sy = fy + shakeA * fishLen * 0.6;
          sa = shakeA * 0.25; mouth = 0.25;
          fishDraw = { x: sx + mouthOff + fishLen * 0.42, y: sy + shakeA * fishLen * 0.3, part: 'whole', angle: shakeA * 0.9 };
        }
        break;
    }
    // bubblor i scenen
    e.bubbles = e.bubbles.filter(function (b) { b.y -= 0.8; b.a -= 0.012; if (b.a > 0) safe(function () { Art.drawBubble(ctx, b.x, b.y, b.r, b.a); }); return b.a > 0; });
    if (e.burp) safe(function () { Art.drawBubble(ctx, e.burp.x, e.burp.y, e.burp.r, 0.9); });
    var ft = time * 0.6;
    extra.forEach(function (f) { safe(function () { Art.drawFish(ctx, f.x, f.y, fishLen, prof.fish, ft, { part: f.part, angle: f.angle, alpha: f.alpha }); }); });
    safe(function () { Art.drawShark(ctx, sx, sy, sharkLen, time, { mouth: mouth, angle: sa, inked: inked, dizzy: false }); });
    if (fishDraw) safe(function () { Art.drawFish(ctx, fishDraw.x, fishDraw.y, fishLen, prof.fish, ft, { part: fishDraw.part, angle: fishDraw.angle, alpha: fishDraw.alpha == null ? 1 : fishDraw.alpha }); });
  }
  function drawEatenText() {
    var e = G.eat; if (!e) return;
    var u = clamp((e.real - 0.5) / 0.5, 0, 1);
    if (u <= 0) return;
    var x = lerp(-W * 0.3, W / 2, 1 - Math.pow(1 - u, 3));
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(Math.min(W * 0.1, playH * 0.22)) + 'px "Space Grotesk", system-ui, sans-serif';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(3,26,51,0.85)';
    var y = playTop + playH * 0.2;
    ctx.strokeText('UPPÄTEN!', x, y);
    ctx.fillStyle = '#FF5A5F'; ctx.fillText('UPPÄTEN!', x, y);
    ctx.restore();
  }

  function render(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!G || current !== 's-game') {
      // menybakgrund
      safe(function () { Art.drawBackground(ctx, W, H, 0, time * 40, time); });
      return;
    }
    var g = G;
    ctx.save();
    if (g.shakeT > 0) ctx.translate(rand(-1, 1) * g.shakeAmp * (g.shakeT / 0.3), rand(-1, 1) * g.shakeAmp * (g.shakeT / 0.3));
    else if (g.mode === 'play' && g.gap < 1.5) ctx.translate(rand(-1, 1) * (1.5 - g.gap) * 1.6, rand(-1, 1) * (1.5 - g.gap) * 1.2);
    if (g.mode === 'eaten') {
      var e = g.eat;
      var z = 1 + 0.28 * (1 - ease((e.real - 0.2) / 1.4));
      ctx.translate(e.fx0, e.fy0); ctx.scale(z, z); ctx.translate(-e.fx0, -e.fy0);
    }
    drawWorld(time);
    drawTexts();
    ctx.restore();
    drawVignette(time);
    if (g.mode === 'eaten') drawEatenText();
  }

  /* ================= huvudloop ================= */
  var lastTs = 0, clock = 0;
  function frame(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    clock += dt;
    var steps = DEBUG ? clamp(parseInt(qs.get('speed'), 10) || 1, 1, 10) : 1;
    for (var si = 0; si < steps; si++) if (G && current === 's-game' && G.mode === 'play') updatePlay(dt);
    if (G && current === 's-game') {
      if (G.mode === 'play') { /* uppdaterad ovan */ }
      else if (G.mode === 'countdown') { updateCountdown(dt); updateFx(dt); G.shark.mouthX = fishX - G.gap * ppm; }
      else if (G.mode === 'eaten') updateEaten(dt);
      else if (G.mode === 'levelclear') updateFx(dt);
      if (G && current === 's-game') updateHUD(false);
    }
    if (current === 's-fish') drawPreview(clock);
    if (current === 's-over') drawConfetti(dt);
    render(clock);
    requestAnimationFrame(frame);
  }

  /* ================= start ================= */
  function onResize() { measure(); handleOrientation(); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function () { setTimeout(onResize, 150); });
  measure();
  renderSoundButtons();
  show('s-start');
  requestAnimationFrame(frame);

  if (DEBUG) {
    window.__haj = {
      get G() { return G; }, prof: prof, isBad: isBad, norm: norm, newGame: newGame, show: show,
      setGap: function (v) { if (G) G.gap = v; }, pathAt: function (x) { return pathAt(x); }, levelClear: function () { if (G) G.t = cfgFor(G).len; }
    };
  }
})();
