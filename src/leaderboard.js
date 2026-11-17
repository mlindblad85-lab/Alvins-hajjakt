/* Alvins Hajjakt – topplista.
 * Supabase REST om HAJ_CONFIG är ifylld, annars lokalt läge (localStorage).
 * En rad per avslutad runda. Inga bibliotek, bara fetch.
 *
 * API (window.Leaderboard):
 *   mode                     'supabase' | 'local'
 *   isLocal                  true i lokalt läge
 *   offline                  true om Supabase inte svarade (lokala data visas då)
 *   onChange(fn)             anropas när offline-status ändras
 *   submit({nick,score,level,fish}) -> Promise<{ok:boolean, offline?:boolean, id?}> (sparas alltid lokalt också)
 *   list(period)             period 'today'|'week'|'all' -> Promise<[{nick,score,level,fish,me}]> (topp 50)
 *   rank(score, period)      -> Promise<number> (1 = bäst)
 */
(function () {
  'use strict';
  var cfg = window.HAJ_CONFIG || {};
  var SB_URL = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  var SB_KEY = String(cfg.supabaseAnonKey || '');
  var hasSupabase = !!(SB_URL && SB_KEY);

  var mode = hasSupabase ? 'supabase' : 'local';
  var listeners = [];
  var lastLocalId = null, lastSubmitted = null;
  var offlineUntil = 0, offline = false; // efter nätfel: använd lokala data en stund

  function remoteOk() { return mode === 'supabase' && Date.now() >= offlineUntil; }
  function wentOffline() { offline = true; offlineUntil = Date.now() + 60000; emit(); }
  function wentOnline() { if (offline) { offline = false; emit(); } }
  function emit() { listeners.slice().forEach(function (f) { try { f(mode); } catch (e) {} }); }
  function viaRemote(remoteFn, localFn) {
    if (!remoteOk()) return localFn();
    return remoteFn().then(function (v) { wentOnline(); return v; }, function () { wentOffline(); return localFn(); });
  }


  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var to = setTimeout(function () { rej({ code: 'timeout', message: 'timeout' }); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(to); res(v); }, function (e) { clearTimeout(to); rej(e); });
    });
  }
  function sinceISO(period) {
    if (period === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
    if (period === 'week') return new Date(Date.now() - 7 * 864e5).toISOString();
    return null;
  }

  /* ---------------- lokalt ---------------- */
  function lget() { try { var v = JSON.parse(localStorage.getItem('haj_scores') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function lset(a) { try { localStorage.setItem('haj_scores', JSON.stringify(a)); } catch (e) {} }
  function localAdd(e) {
    var a = lget();
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    a.push({ id: id, nick: e.nick, score: e.score, level: e.level, fish: e.fish, created_at: new Date().toISOString() });
    a.sort(function (x, y) { return y.score - x.score; });
    if (a.length > 400) a.length = 400;
    lset(a);
    lastLocalId = id;
    return id;
  }
  function localFiltered(period) {
    var s = sinceISO(period);
    return lget().filter(function (r) { return !s || r.created_at >= s; }).sort(function (x, y) { return y.score - x.score; });
  }
  function localList(period) {
    return Promise.resolve(localFiltered(period).slice(0, 50).map(function (r) {
      return { nick: r.nick, score: r.score, level: r.level, fish: r.fish, me: r.id === lastLocalId };
    }));
  }
  function localRank(score, period) {
    return Promise.resolve(localFiltered(period).filter(function (r) { return r.score > score; }).length + 1);
  }

  /* ---------------- Supabase REST ---------------- */
  function sbFetch(path, opts) {
    opts = opts || {};
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
    // Ny "publishable"-nyckel: skickas bara som apikey (ingen Authorization: Bearer).
    var headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
    if (opts.prefer) headers.Prefer = opts.prefer;
    return withTimeout(fetch(SB_URL + '/rest/v1/' + path, {
      method: opts.method || 'GET', headers: headers, body: opts.body, signal: ctrl ? ctrl.signal : undefined
    }), 6500).then(function (r) {
      clearTimeout(to);
      if (!r.ok) throw { code: 'http_' + r.status, message: 'HTTP ' + r.status };
      return r;
    }, function (e) { clearTimeout(to); throw e; });
  }
  function sbSubmit(e) {
    return sbFetch('scores', { method: 'POST', prefer: 'return=minimal',
      body: JSON.stringify({ nick: e.nick, score: e.score, level: e.level, fish: e.fish }) }).then(function () { return { ok: true }; });
  }
  function sbList(period) {
    var q = 'scores?select=nick,score,level,fish,created_at&order=score.desc&limit=50';
    var s = sinceISO(period);
    if (s) q += '&created_at=gte.' + encodeURIComponent(s);
    return sbFetch(q).then(function (r) { return r.json(); }).then(function (rows) {
      var marked = false;
      return (rows || []).map(function (r) {
        var me = false;
        if (!marked && lastSubmitted && r.nick === lastSubmitted.nick && r.score === lastSubmitted.score) { me = true; marked = true; }
        return { nick: r.nick, score: r.score, level: r.level, fish: r.fish, me: me };
      });
    });
  }
  function sbRank(score, period) {
    // limit=1 håller svaret litet; totalen läses ändå ur Content-Range.
    var q = 'scores?select=id&score=gt.' + Math.floor(score) + '&limit=1';
    var s = sinceISO(period);
    if (s) q += '&created_at=gte.' + encodeURIComponent(s);
    return sbFetch(q, { prefer: 'count=exact' }).then(function (r) {
      var cr = r.headers.get('Content-Range') || '';
      var n = parseInt(cr.split('/')[1], 10);
      return (isFinite(n) ? n : 0) + 1;
    });
  }

  /* ---------------- publikt API ---------------- */
  var LB = {
    get mode() { return mode; },
    get isLocal() { return mode === 'local'; },
    get offline() { return mode === 'supabase' && offline; },
    onChange: function (fn) { listeners.push(fn); },
    submit: function (e) {
      e = { nick: String(e.nick), score: Math.max(0, Math.min(2000000, Math.floor(e.score))), level: Math.max(1, Math.min(99, e.level | 0)), fish: String(e.fish || '') };
      lastSubmitted = e;
      localAdd(e); // spara alltid lokalt också, som reserv
      var id = lastLocalId;
      if (!remoteOk()) return Promise.resolve({ ok: mode === 'local', id: id, offline: mode === 'supabase' });
      return sbSubmit(e).then(function (r) { wentOnline(); return r; }, function (err) {
        if (!err || !/^http_4/.test(err.code || '')) wentOffline();
        return { ok: false, id: id, offline: true };
      });
    },
    list: function (period) {
      return viaRemote(function () { return sbList(period); }, function () { return localList(period); });
    },
    rank: function (score, period) {
      return viaRemote(function () { return sbRank(score, period); }, function () { return localRank(score, period); });
    },
    _sinceISO: sinceISO
  };
  window.Leaderboard = LB;
})();
