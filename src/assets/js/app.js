/* Cold Open: page behaviour. Vanilla JS, no dependencies, click handlers only (no touch events).
 * Data comes straight from the TVmaze API in the visitor's browser (CC BY-SA 4.0, attribution in the footer). */
(function () {
  'use strict';
  var CO = window.CO, U = CO.util, T = CO.time, M = CO.model, V = CO.view;
  var CFG = window.CO_CONFIG || {};
  var esc = U.esc;
  var PAGE = document.body.getAttribute('data-page') || '';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function localTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (e) { return undefined; } }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'episode'; }

  /* ---------------------------------------------------------------- storage */
  var Store = {
    get: function (k, d) { try { var v = localStorage.getItem('co.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('co.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    sget: function (k, ttl) {
      try { var o = JSON.parse(sessionStorage.getItem('co.' + k)); return o && Date.now() - o.t < ttl ? o.v : null; } catch (e) { return null; }
    },
    sset: function (k, v) { try { sessionStorage.setItem('co.' + k, JSON.stringify({ t: Date.now(), v: v })); } catch (e) { /* quota or blocked: just skip caching */ } }
  };
  function follows() {
    var l = Store.get('follows', []);
    return (Array.isArray(l) ? l : []).filter(function (f) { return f && Number.isInteger(f.id) && f.id > 0; })
      .map(function (f) { return { id: f.id, name: String(f.name || ''), img: U.safeUrl(f.img) }; });
  }
  function isFollowing(id) { return follows().some(function (f) { return f.id === id; }); }
  function setFollow(info, on) {
    var list = follows().filter(function (f) { return f.id !== info.id; });
    if (on) list.unshift(info);
    return Store.set('follows', list.slice(0, 200));
  }

  /* ---------------------------------------------------------------- small UI helpers */
  var toastTimer;
  function toast(msg) {
    var el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 3400);
  }
  function tickClock() {
    var el = $('#clock'); if (!el) return;
    var now = Date.now();
    el.textContent = T.fmtTime(now) + ' ' + T.tzName(undefined, now);
  }
  /** Pre-rendered pages print times in the broadcaster's zone; switch every one of them to the visitor's own. */
  function localize(root) {
    var tz = localTz();
    $$('time[data-fmt="clock"]', root).forEach(function (t) {
      var ms = Date.parse(t.getAttribute('datetime')); if (!isNaN(ms)) t.textContent = T.fmtTime(ms);
    });
    $$('[data-tz]', root).forEach(function (el) {
      var tm = el.previousElementSibling;
      if (!tm || tm.tagName !== 'TIME') return;
      var ms = Date.parse(tm.getAttribute('datetime')); if (isNaN(ms)) return;
      var label = T.tzName(undefined, ms), day = tm.getAttribute('data-day');
      // a time that lands on another calendar day than the page's day gets the weekday ("4:00 AM GMT+2 (Wed)")
      if (day) { var local = T.ymdIn(tz, new Date(ms)); if (local !== day) label += ' (' + T.weekdayShort(local) + ')'; }
      el.textContent = label;
    });
    $$('.slot[data-t]', root).forEach(function (sl) {
      var sh = $('.shift', sl), ms = +sl.getAttribute('data-t'); if (!sh || ms < 0) return;
      var local = T.ymdIn(tz, new Date(ms)), day = sl.getAttribute('data-day');
      sh.textContent = day && local !== day ? T.weekdayShort(local) : '';
    });
  }
  function fmtWhen(e) {
    var timed = !!e.airtime, ms = Date.parse(e.airstamp);
    var o = { weekday: 'short', month: 'short', day: 'numeric' };
    var d;
    if (timed) { o.hour = 'numeric'; o.minute = '2-digit'; d = new Date(ms); }
    else { o.timeZone = 'UTC'; d = T.isYmd(e.airdate) ? new Date(e.airdate + 'T00:00:00Z') : new Date(ms); }
    return new Intl.DateTimeFormat(undefined, o).format(d).replace(/[  ]/g, ' ');
  }
  function fmtYmd(ymd) {
    if (!T.isYmd(ymd)) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ymd + 'T00:00:00Z'));
  }
  function setMeta(title, desc) {
    document.title = title;
    var m = $('meta[name="description"]'); if (m && desc) m.setAttribute('content', desc);
  }
  function skeleton(n) {
    var one = '<div class="sk-row"><div class="sk sk--p"></div><div><div class="sk sk--t"></div><div class="sk sk--l sk--s"></div><div class="sk sk--l"></div><div class="sk sk--l"></div></div></div>', out = '';
    for (var i = 0; i < (n || 3); i++) out += one;
    return '<div role="status"><span class="sr">Loading</span>' + out + '</div>';
  }
  function errorState(err, retryId) {
    var k = err && err.kind;
    var msg = k === 'rate' ? 'The TV data service is busy right now' : k === 'notfound' ? 'We could not find that' : k === 'network' ? 'We could not reach the TV data service' : 'Something went wrong while loading';
    var tip = k === 'notfound' ? 'Check the link, or search for the show by name.' : 'Check your connection and try again in a moment.';
    return '<div class="state"><h2>' + esc(msg) + '</h2><p>' + tip + '</p>' +
      (k === 'notfound' ? '<a class="btn btn--solid" href="/search/">Search shows</a>' : '<button type="button" class="btn btn--solid" id="' + (retryId || 'retry') + '">Try again</button>') + '</div>';
  }

  /* ---------------------------------------------------------------- TVmaze client: token bucket + backoff */
  var Api = (function () {
    var BASE = 'https://api.tvmaze.com';
    var MAX = 5, REFILL = 500, tokens = MAX, last = Date.now(); // 5 requests at once, then 2 per second (limit is >= 20 per 10 s)
    var mem = {}, order = [];
    function fail(kind) { var e = new Error(kind); e.kind = kind; return e; }
    function take() {
      return new Promise(function (resolve) {
        (function attempt() {
          var now = Date.now(), add = Math.floor((now - last) / REFILL);
          if (add > 0) { tokens = Math.min(MAX, tokens + add); last += add * REFILL; }
          if (tokens > 0) { tokens--; resolve(); } else setTimeout(attempt, Math.max(30, REFILL - (now - last)));
        })();
      });
    }
    function request(path, tries) {
      return take().then(function () { return fetch(BASE + path, { headers: { Accept: 'application/json' } }); })
        .then(function (res) {
          if (res.status === 429 || res.status >= 500) {
            if (tries <= 0) throw fail(res.status === 429 ? 'rate' : 'server');
            var ra = parseFloat(res.headers.get('Retry-After'));
            return sleep(isFinite(ra) ? ra * 1000 : (4 - tries) * 1500 + 1000 + Math.random() * 500).then(function () { return request(path, tries - 1); });
          }
          if (res.status === 404) throw fail('notfound');
          if (!res.ok) throw fail('server');
          return res.json();
        }, function () {
          // network error (or a 429 without CORS headers): retry a couple of times before giving up
          if (tries <= 0) throw fail('network');
          return sleep(1200 + Math.random() * 400).then(function () { return request(path, tries - 1); });
        });
    }
    function get(path) {
      if (!mem[path]) {
        mem[path] = request(path, 3);
        mem[path].catch(function () { delete mem[path]; });
        order.push(path);
        if (order.length > 12) delete mem[order.shift()];
      }
      return mem[path];
    }
    return { get: get };
  })();

  /** One day of listings for a region: TV networks + local streaming + global streaming. Streaming failures degrade gracefully. */
  function loadDay(region, date) {
    var key = 'day.' + region + '.' + date, hit = Store.sget(key, 20 * 60000);
    if (hit) return Promise.resolve(hit);
    var plan = [
      { p: '/schedule?country=' + region + '&date=' + date, source: 'tv' },
      { p: '/schedule/web?date=' + date + '&country=' + region, source: 'web' },
      { p: '/schedule/web?date=' + date + '&country=', source: 'web' }
    ];
    return Promise.all(plan.map(function (d) {
      return Api.get(d.p).then(function (items) { return { items: items, source: d.source, ok: Array.isArray(items) }; },
        function (err) { return { items: [], source: d.source, ok: false, err: err }; });
    })).then(function (res) {
      if (!res[0].ok && !res[1].ok && !res[2].ok) throw res[0].err || res[1].err || { kind: 'server' };
      // partial: '' when everything loaded, otherwise which side is missing ('tv' = TV networks, 'streaming' = at least one streaming list)
      var out = { rows: M.buildRows(res), partial: !res[0].ok ? 'tv' : res.some(function (r) { return !r.ok; }) ? 'streaming' : '' };
      if (!out.partial) Store.sset(key, out);
      return out;
    });
  }
  function loadShow(id) { return Api.get('/shows/' + id + '?embed[]=episodes&embed[]=cast'); }
  function loadNext(id) {
    var key = 'next.' + id, hit = Store.sget(key, 30 * 60000);
    if (hit) return Promise.resolve(hit);
    return Api.get('/shows/' + id + '?embed=nextepisode').then(function (s) {
      var n = s && s._embedded && s._embedded.nextepisode;
      var out = {
        id: id, name: String((s && s.name) || ''), status: (s && s.status) || '',
        next: n && n.airstamp ? { id: n.id, season: n.season, number: n.number == null ? null : n.number, name: n.name || '', airstamp: n.airstamp,
          airtime: n.airtime || '', airdate: n.airdate || '', runtime: U.num(n.runtime) || U.num(s.runtime) || null } : null
      };
      Store.sset(key, out);
      return out;
    });
  }

  /* ---------------------------------------------------------------- follow + calendar (event delegation) */
  function syncFollowButtons(root) {
    var set = {};
    follows().forEach(function (f) { set[f.id] = 1; });
    $$('[data-follow]', root).forEach(function (b) {
      var on = !!set[b.getAttribute('data-follow')];
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = b.getAttribute(on ? 'data-on' : 'data-off');
      var l = $('.lbl', b); if (l) l.textContent = label;
      if (b.hasAttribute('title')) b.setAttribute('title', label); // icon-only buttons: the tooltip names the action
    });
  }
  function download(text, name) {
    var url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function icsFromRow(li) {
    var start = +li.getAttribute('data-start'), end = +li.getAttribute('data-end');
    if (!start) return null;
    var net = li.getAttribute('data-net'), t = li.getAttribute('data-title');
    return { id: li.getAttribute('data-id'), start: start, end: end || start + 30 * 60000,
      title: li.getAttribute('data-show') + ' ' + li.getAttribute('data-code') + (net ? ' (' + net + ')' : ''),
      desc: t ? 'Episode: ' + t : '', url: location.origin + '/show/?id=' + li.getAttribute('data-show-id') };
  }
  document.addEventListener('click', function (e) {
    var fb = e.target.closest('[data-follow]');
    if (fb) {
      var id = Number(fb.getAttribute('data-follow')), on = !isFollowing(id), name = fb.getAttribute('data-name') || 'this show';
      if (!setFollow({ id: id, name: name, img: fb.getAttribute('data-img') || '' }, on)) { toast('Your browser is blocking storage, so we cannot save your list.'); return; }
      syncFollowButtons(document);
      if (PAGE === 'home' || PAGE === 'day') renderSideFollow();
      if (PAGE === 'watchlist' && !on) { var row = fb.closest('li'); if (row) row.remove(); if (!follows().length) renderWatchlist(); }
      toast(on ? 'Following ' + name + '. Its next episode shows up under My shows.' : 'Unfollowed ' + name + '.');
      return;
    }
    var cb = e.target.closest('[data-ics]');
    if (cb) {
      var li = cb.closest('.ep'), ev = li && icsFromRow(li);
      if (!ev) return;
      download(M.buildIcs([ev], Date.now(), CFG.siteName), slug(li.getAttribute('data-show') + '-' + li.getAttribute('data-code')) + '.ics');
      return;
    }
    var rb = e.target.closest('#retry');
    if (rb) {
      if (PAGE === 'home') loadHome(); else if (PAGE === 'show') initShow(); else if (PAGE === 'premieres') loadPremieres(true);
      else if (PAGE === 'search') $('#search-form').dispatchEvent(new Event('submit', { cancelable: true }));
    }
    var ab = e.target.closest('#consent-link');
    if (ab) {
      e.preventDefault();
      window.googlefc = window.googlefc || {}; window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
      window.googlefc.callbackQueue.push(function () { if (window.googlefc.showRevocationMessage) window.googlefc.showRevocationMessage(); });
    }
  });

  /** "Your next episodes" box in the sidebar (only when the visitor follows something). */
  function renderSideFollow() {
    var box = $('#side-follow'); if (!box) return;
    var list = follows().slice(0, 4);
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<h2>Your next episodes</h2><ul class="side-list">' + list.map(function (f) {
      return '<li data-id="' + f.id + '"><a href="/show/?id=' + f.id + '">' + esc(f.name) + '</a><small>Loading</small></li>';
    }).join('') + '</ul><a class="btn btn--ghost" href="/watchlist/">All my shows</a>';
    list.forEach(function (f) {
      loadNext(f.id).then(function (r) {
        var sm = $('#side-follow li[data-id="' + f.id + '"] small');
        if (sm) sm.textContent = r.next ? M.code(r.next) + ', ' + fmtWhen(r.next) : r.status === 'Ended' ? 'This show has ended' : 'No date announced yet';
      }, function () { var sm = $('#side-follow li[data-id="' + f.id + '"] small'); if (sm) sm.textContent = 'Could not load'; });
    });
  }
  /** "Picks of the day" box: server-rendered on pre-built pages, rebuilt here when the visitor switches day, region or filters. */
  function renderSidePicks(rows, ctx) {
    var box = $('#side-picks'); if (!box) return;
    box.innerHTML = V.picksBox(rows, ctx); // an empty box is hidden by CSS (:empty)
  }
  function ensureSideAd(on) {
    var side = $('#side'); if (!side) return;
    var el = $('.ad-side', side);
    if (on && !el && (CO.ads.slotEnabled('side') || CO.ads.preview)) {
      el = document.createElement('aside'); el.className = 'ad-slot ad-side';
      el.setAttribute('data-ad', 'side'); el.setAttribute('aria-label', 'Advertisement');
      side.appendChild(el); // last in the column: it is sticky and must not slide over other boxes
    } else if (!on && el) el.remove();
  }

  /* ---------------------------------------------------------------- live status: on air, the NOW line, the next-up bar */
  function regionTz(rail) { var r = T.REGIONS[rail && rail.getAttribute('data-region')]; return (r || T.REGIONS.US).tz; }
  function tick() {
    var rail = $('#rail'), now = Date.now();
    if (!rail) { updateNextbar(null, now); return; }
    var date = rail.getAttribute('data-date'), today = T.ymdIn(regionTz(rail), new Date(now));
    var when = date < today ? 'past' : date > today ? 'future' : 'today';
    $$('.ep[data-start]', rail).forEach(function (li) {
      var s = +li.getAttribute('data-start'), e = +li.getAttribute('data-end');
      var st = when === 'past' ? 'done' : when === 'future' ? 'soon' : now >= e ? 'done' : now >= s ? 'live' : 'soon';
      if (li.getAttribute('data-status') !== st) li.setAttribute('data-status', st);
    });
    $$('.slot[data-t]', rail).forEach(function (sl) {
      if (+sl.getAttribute('data-t') < 0) return;
      var eps = $$('.ep', sl);
      var st = eps.every(function (r) { return r.getAttribute('data-status') === 'done'; }) ? 'done' : eps.some(function (r) { return r.getAttribute('data-status') === 'live'; }) ? 'live' : 'soon';
      sl.setAttribute('data-status', st);
    });
    placeNow(rail, when === 'today', now);
    updateNextbar(when === 'today' ? rail : null, now);
  }
  function placeNow(rail, show, now) {
    var el = $('#now');
    var slots = $$('.slot[data-t]', rail).filter(function (s) { return +s.getAttribute('data-t') >= 0; });
    if (!show || !slots.length) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'now'; el.className = 'now is-new'; el.setAttribute('role', 'separator');
      el.appendChild(document.createElement('span'));
      setTimeout(function () { el.classList.remove('is-new'); }, 1300);
    }
    $('span', el).textContent = 'Now ' + T.fmtTime(now);
    var next = slots.filter(function (s) { return +s.getAttribute('data-t') > now; })[0] || null;
    if (next) { if (el.nextElementSibling !== next) rail.insertBefore(el, next); }
    else if (rail.lastElementChild !== el) rail.appendChild(el);
  }
  var lastBar = '';
  function updateNextbar(rail, now) {
    var bar = $('#nextbar-in'); if (!bar) return;
    var pick = null, live = false;
    if (rail) {
      var rows = $$('.ep[data-start]', rail);
      var liveRows = rows.filter(function (r) { return r.getAttribute('data-status') === 'live'; });
      var soon = rows.filter(function (r) { return r.getAttribute('data-status') === 'soon' && +r.getAttribute('data-start') - now < 12 * 3600000; });
      var best = function (l) { return l.filter(function (r) { return r.classList.contains('ep--pick'); })[0] || l[0]; };
      if (liveRows.length && best(liveRows).classList.contains('ep--pick')) { pick = best(liveRows); live = true; }
      else if (soon.length) pick = best(soon);
      else if (liveRows.length) { pick = best(liveRows); live = true; }
    }
    if (!pick) {
      var region = rail ? T.REGIONS[rail.getAttribute('data-region')] || T.REGIONS.US : (S ? T.REGIONS[S.region] : T.REGIONS.US);
      var sig = 'note:' + region.name;
      if (lastBar !== sig) {
        bar.innerHTML = '<p class="nextbar-note">Times are shown in your time zone (' + esc(T.tzName(undefined, now)) + '). Days follow the ' + esc(region.name) + ' broadcast calendar.</p>';
        lastBar = sig;
      }
      return;
    }
    var start = +pick.getAttribute('data-start'), sig2 = pick.id + (live ? ':live' : ':next');
    var eta = live ? 'since ' + T.fmtTime(start) : T.etaText(start - now);
    if (lastBar === sig2) { var e = $('.lt-eta', bar); if (e) e.textContent = eta; return; }
    var net = pick.getAttribute('data-net');
    bar.innerHTML = '<a class="lt lt--enter" href="#' + esc(pick.id) + '"><span class="lt-tab' + (live ? ' lt-tab--live' : '') + '">' + (live ? 'On air now' : 'Next on air') +
      '</span><span class="lt-main"><strong class="lt-title">' + esc(pick.getAttribute('data-show')) + '</strong><span class="lt-meta">' +
      esc(pick.getAttribute('data-code') + (net ? ', ' + net : '')) + '</span></span><span class="lt-eta">' + esc(eta) + '</span></a>';
    lastBar = sig2;
  }

  /* ---------------------------------------------------------------- home (live schedule) */
  var S = null, loadToken = 0;
  function guessRegion() {
    var l = String(navigator.language || 'en-US').toUpperCase();
    return /-(GB|IE)$/.test(l) ? 'GB' : /-CA$/.test(l) ? 'CA' : /-(AU|NZ)$/.test(l) ? 'AU' : 'US';
  }
  function pickRegion(params) {
    var r = params.get('r');
    if (!T.REGIONS[r]) r = Store.get('region', null);
    if (!T.REGIONS[r]) r = T.REGIONS[CFG.defaultRegion] ? (guessRegion() !== 'US' ? guessRegion() : CFG.defaultRegion) : guessRegion();
    return r;
  }
  function readSnapshot() {
    var el = $('#snapshot'); if (!el) return null;
    try { var o = JSON.parse(el.textContent); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
  }
  function syncUrl() {
    var p = new URLSearchParams();
    if (S.date !== S.today) p.set('d', S.date);
    if (S.region !== 'US') p.set('r', S.region);
    var q = p.toString();
    try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '')); } catch (e) { /* file:// or sandbox */ }
  }
  function buildDates() {
    var days = [], i;
    for (i = -2; i <= 6; i++) days.push(T.ymdAdd(S.today, i));
    if (days.indexOf(S.date) < 0) { days.push(S.date); days.sort(); }
    var box = $('#dates');
    box.innerHTML = days.map(function (d) {
      return '<button type="button" class="date' + (d === S.today ? ' is-today' : '') + '" data-date="' + d + '" aria-pressed="' + (d === S.date) + '" aria-label="' +
        esc(T.fmtDateLong(d) + (d === S.today ? ', today' : '')) + '">' + T.weekdayShort(d) + '<b>' + T.dayNum(d) + '</b></button>';
    }).join('');
    var sel = $('.date[aria-pressed="true"]', box);
    if (sel) box.scrollLeft = Math.max(0, sel.offsetLeft - (box.clientWidth - sel.offsetWidth) / 2);
  }
  function buildRegion() {
    $('#region').innerHTML = Object.keys(T.REGIONS).map(function (k) {
      return '<button type="button" data-region="' + k + '" aria-pressed="' + (k === S.region) + '">' + esc(T.REGIONS[k].short) + '</button>';
    }).join('');
  }
  function buildNote() {
    var n = $('#ctl-note');
    if (n) n.textContent = 'Days follow the ' + T.REGIONS[S.region].name + ' broadcast calendar. Times are shown in your time zone (' + T.tzName(undefined, Date.now()) + ').';
  }
  var GENRE_LABEL = { 'Science-Fiction': 'Sci-Fi' };
  function buildChips(base) {
    var kinds = [['all', 'All', base.length], ['premieres', 'Premieres', 0], ['web', 'Streaming', 0], ['tv', 'TV networks', 0]];
    kinds.forEach(function (k) { if (k[0] !== 'all') k[2] = M.filterRows(base, { kind: k[0] }).length; });
    var h = kinds.filter(function (k) { return k[0] === 'all' || (k[2] > 0 && (k[2] < base.length || k[0] === 'premieres')) || (S.kind === k[0] && !S.genre); })
      .map(function (k) { return chip('data-kind="' + k[0] + '"', k[1] + ' (' + k[2] + ')', S.kind === k[0] && !S.genre); }).join('');
    h += M.topGenres(base, 5).map(function (g) {
      return chip('data-genre="' + esc(g) + '"', (GENRE_LABEL[g] || g) + ' (' + M.filterRows(base, { genre: g }).length + ')', S.genre === g);
    }).join('');
    $('#chips').innerHTML = h;
  }
  function chip(attr, label, on) { return '<button type="button" class="chip" ' + attr + ' aria-pressed="' + (!!on) + '">' + esc(label) + '</button>'; }

  function render(reason) { // 'snapshot' (pre-rendered HTML already in the page) | 'load' | 'filter'
    var base = M.filterRows(S.rows, { chatter: S.chatter });
    var list = M.filterRows(S.rows, { chatter: S.chatter, kind: S.kind, genre: S.genre });
    var defaults = S.kind === 'all' && !S.genre && !S.chatter;
    var ctx = { tz: undefined, date: S.date, region: S.region, picks: M.markPicks(base),
      feedAd: defaults && reason !== 'filter' && (CO.ads.slotEnabled('feed') || CO.ads.preview) };
    var feed = $('#feed');
    feed.removeAttribute('aria-busy');
    if (reason !== 'snapshot') {
      feed.innerHTML = list.length ? V.railHtml(M.groupRows(list), ctx)
        : V.emptyHtml(base.length ? 'Nothing matches this filter' : 'No new episodes listed for this day');
      $('#dek').innerHTML = V.digest(base, ctx).html;
      if (reason === 'load') { var note = $('#note'); if (note) note.remove(); } // the editor's note belongs to the saved day, not to another day or region
      renderSidePicks(base, ctx);
      $('#h1').textContent = 'New TV episodes on ' + T.fmtDateLong(S.date);
      setMeta('New TV episodes on ' + T.fmtDateLong(S.date) + ' | ' + (CFG.siteName || 'Cold Open'));
    }
    buildChips(base);
    $('#ctl').hidden = false;
    localize(document); syncFollowButtons(document);
    ensureSideAd(list.length >= 8);
    CO.ads.init(document);
    lastBar = ''; tick();
    renderSideFollow();
  }
  function loadHome() {
    var token = ++loadToken;
    var feed = $('#feed');
    feed.setAttribute('aria-busy', 'true');
    feed.innerHTML = skeleton(3);
    $('#dek').innerHTML = '';
    loadDay(S.region, S.date).then(function (res) {
      if (token !== loadToken) return;
      S.rows = res.rows;
      render('load');
      if (res.partial) toast(res.partial === 'tv' ? 'TV network listings are unavailable right now. Showing streaming only.' : 'Streaming listings are unavailable right now. Showing TV networks only.');
    }, function (err) {
      if (token !== loadToken) return;
      feed.removeAttribute('aria-busy');
      feed.innerHTML = errorState(err);
      ensureSideAd(false);
    });
  }
  function go(o) {
    var oldToday = S.today;
    if (o.region) { S.region = o.region; Store.set('region', o.region); S.today = T.ymdIn(T.REGIONS[o.region].tz, new Date()); if (S.date === oldToday) S.date = S.today; }
    if (o.date) S.date = o.date;
    S.kind = 'all'; S.genre = '';
    syncUrl(); buildDates(); buildRegion(); buildNote(); loadHome();
  }
  function initHome() {
    var params = new URLSearchParams(location.search);
    var region = pickRegion(params), today = T.ymdIn(T.REGIONS[region].tz, new Date());
    var date = T.isYmd(params.get('d')) ? params.get('d') : today;
    S = { region: region, today: today, date: date, kind: 'all', genre: '', chatter: false, rows: [] };
    buildDates(); buildRegion(); buildNote();
    $('#dates').addEventListener('click', function (e) { var b = e.target.closest('[data-date]'); if (b && b.getAttribute('data-date') !== S.date) go({ date: b.getAttribute('data-date') }); });
    $('#region').addEventListener('click', function (e) { var b = e.target.closest('[data-region]'); if (b && b.getAttribute('data-region') !== S.region) go({ region: b.getAttribute('data-region') }); });
    $('#chips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      if (b.hasAttribute('data-genre')) { S.genre = S.genre === b.getAttribute('data-genre') ? '' : b.getAttribute('data-genre'); S.kind = 'all'; }
      else { S.kind = b.getAttribute('data-kind'); S.genre = ''; }
      render('filter');
    });
    $('#chatter').addEventListener('change', function (e) { S.chatter = e.target.checked; S.kind = 'all'; S.genre = ''; render('filter'); });
    var snap = readSnapshot();
    // ?adpreview=1 re-renders the list in the browser so that the in-feed slots show up too (the saved copy has none until ads are configured)
    if (snap && Array.isArray(snap.rows) && snap.region === region && snap.date === date && $('#rail') && !CO.ads.preview) { S.rows = snap.rows; render('snapshot'); }
    else loadHome();
  }

  /* ---------------------------------------------------------------- pre-rendered day page */
  function initDay() {
    localize(document); syncFollowButtons(document); renderSideFollow();
    ensureSideAd($$('#rail .ep').length >= 8);
    CO.ads.init(document);
    tick();
  }

  /* ---------------------------------------------------------------- show page */
  function initShow() {
    var root = $('#show-root');
    var id = parseInt(new URLSearchParams(location.search).get('id'), 10);
    if (!(id > 0)) { root.innerHTML = errorState({ kind: 'notfound' }); return; }
    root.innerHTML = skeleton(2);
    loadShow(id).then(function (show) { renderShow(root, show); }, function (err) { root.innerHTML = errorState(err); });
  }
  function renderShow(root, show) {
    var now = Date.now(), name = String(show.name || 'Untitled'), sid = U.num(show.id) || 0;
    var net = (show.network && show.network.name) || (show.webChannel && show.webChannel.name) || '';
    var isWeb = !(show.network && show.network.name) && !!(show.webChannel && show.webChannel.name);
    var img = U.safeUrl(show.image && (show.image.medium || show.image.original));
    var eps = ((show._embedded && show._embedded.episodes) || []).filter(function (e) { return e && e.airstamp && !isNaN(Date.parse(e.airstamp)); })
      .sort(function (a, b) { return Date.parse(a.airstamp) - Date.parse(b.airstamp); });
    var next = eps.filter(function (e) { return Date.parse(e.airstamp) > now; })[0] || null;
    var genres = (Array.isArray(show.genres) ? show.genres : []).join(', ');
    var rating = U.num(show.rating && show.rating.average), runtime = U.num(show.runtime) || U.num(show.averageRuntime);
    var h = '<article class="show"><div class="show-head"><div class="show-poster">' +
      (img ? '<img src="' + esc(img) + '" width="210" height="295" alt="Poster for ' + esc(name) + '" fetchpriority="high">' : '<span class="noimg" aria-hidden="true">' + esc(name.charAt(0).toUpperCase()) + '</span>') +
      '</div><div class="show-main"><h1 class="show-title">' + esc(name) + '</h1>' + (genres ? '<p class="show-genres">' + esc(genres) + '</p>' : '') +
      '<p class="ep__facts">' + V.netTab({ net: net, web: isWeb }) +
      (show.premiered ? '<span class="fact">Premiered ' + esc(String(show.premiered).slice(0, 4)) + '</span>' : '') +
      (show.status ? '<span class="fact">' + esc(show.status) + '</span>' : '') +
      (runtime ? '<span class="fact">' + runtime + ' min episodes</span>' : '') +
      (rating ? '<span class="fact fact--rate" title="Average rating on TVmaze">' + V.ICON_STAR + rating.toFixed(1) + '</span>' : '') + '</p>';
    if (next) {
      var ms = Date.parse(next.airstamp), timed = !!next.airtime;
      var nn = { season: U.num(next.season) || 0, number: next.number == null ? null : U.num(next.number) };
      var end = ms + (U.num(next.runtime) || runtime || 30) * 60000;
      h += '<div class="nextep ep" id="ep-' + (U.num(next.id) || 0) + '" data-id="' + (U.num(next.id) || 0) + '" data-show-id="' + sid + '" data-show="' + esc(name) + '" data-code="' + esc(M.code(nn)) +
        '" data-title="' + esc(next.name || '') + '" data-net="' + esc(net) + '"' + (timed ? ' data-start="' + ms + '" data-end="' + end + '"' : '') + '>' +
        '<p class="nextep-h">Next episode</p><p class="nextep-t">' + esc(M.code(nn)) + (next.name ? ' ' + esc(next.name) : '') + '</p>' +
        '<p class="nextep-when"><time datetime="' + esc(next.airstamp) + '">' + esc(fmtWhen(next)) + '</time>' +
        (timed ? ' <span class="eta" data-eta="' + ms + '">' + esc(T.etaText(ms - now)) + '</span>' : '') + '</p>' +
        (timed ? '<button type="button" class="btn btn--ghost" data-ics>Add to calendar</button>' : '') + '</div>';
    } else {
      h += '<div class="nextep"><p class="nextep-h">Next episode</p><p class="nextep-t">' +
        (show.status === 'Ended' ? 'This show has ended' : 'No upcoming episode announced yet') + '</p></div>';
    }
    var imdb = show.externals && /^tt\d+$/.test(show.externals.imdb || '') ? 'https://www.imdb.com/title/' + show.externals.imdb + '/' : '';
    var site = U.safeUrl(show.officialSite);
    h += '<div class="ep__actions">' + V.followBtn({ showId: sid, show: name, img: img }, false) +
      (site ? '<a class="btn btn--ghost" href="' + esc(site) + '" rel="noopener">Official site</a>' : '') +
      (imdb ? '<a class="btn btn--ghost" href="' + esc(imdb) + '" rel="noopener">IMDb page</a>' : '') + '</div></div></div><div class="show-body">';

    var about = U.stripHtml(show.summary);
    if (about) h += '<section><h2>About</h2><p class="read">' + esc(about) + '</p></section>';

    var regular = eps.filter(function (e) { return e.type === 'regular' && e.number != null; });
    var cur = next ? next.season : eps.length ? eps[eps.length - 1].season : 0;
    var inSeason = regular.filter(function (e) { return e.season === cur; });
    var aired = inSeason.filter(function (e) { return Date.parse(e.airstamp) <= now; }).length;
    if (inSeason.length) {
      h += '<section><h2>Season ' + cur + ' progress</h2><p class="read">' +
        (aired < inSeason.length ? aired + ' of ' + inSeason.length + ' episodes have aired.' : 'All ' + inSeason.length + ' episodes have aired.') +
        '</p><div class="meter" role="img" aria-label="' + aired + ' of ' + inSeason.length + ' episodes aired"><i style="width:' + Math.round(aired / inSeason.length * 100) + '%"></i></div></section>';
    }
    var cast = ((show._embedded && show._embedded.cast) || []).filter(function (c) { return c && c.person && c.person.name; }), seen = {};
    cast = cast.filter(function (c) { if (seen[c.person.id]) return false; seen[c.person.id] = 1; return true; }).slice(0, 12);
    if (cast.length) {
      h += '<section><h2>Cast</h2><ul class="cast">' + cast.map(function (c) {
        return '<li><b>' + esc(c.person.name) + '</b>' + (c.character && c.character.name ? '<span>as ' + esc(c.character.name) + '</span>' : '') + '</li>';
      }).join('') + '</ul></section>';
    }
    if (eps.length) h += '<section><h2>Episode guide</h2>' + seasonsHtml(eps, next, now) + '</section>';
    h += '</div><aside class="ad-slot" data-ad="end" aria-label="Advertisement"></aside></article>';
    root.innerHTML = h;
    setMeta(name + ': next episode, air times and episode guide | ' + (CFG.siteName || 'Cold Open'),
      'When does ' + name + ' air next? Next episode date and time in your time zone, season progress, cast and the full episode list.');
    localize(root); syncFollowButtons(root); CO.ads.init(root);
  }
  function seasonsHtml(eps, next, now) {
    var by = {}, keys = [], count = 0, out = '';
    eps.forEach(function (e) { var s = U.num(e.season) || 0; if (!by[s]) { by[s] = []; keys.push(s); } by[s].push(e); });
    keys.sort(function (a, b) { return b - a; });
    keys.forEach(function (s, i) {
      var list = by[s];
      if (count > 300) { out += '<p class="res-meta">Season ' + s + ': ' + U.plural(list.length, 'episode') + '</p>'; return; }
      count += list.length;
      out += '<details class="season"' + (i === 0 ? ' open' : '') + '><summary>Season ' + s + ' <small>' + U.plural(list.length, 'episode') + '</small></summary><ol class="eplist">' +
        list.map(function (e) {
          var fut = Date.parse(e.airstamp) > now;
          return '<li class="' + (next && e.id === next.id ? 'is-next ' : '') + (fut ? 'is-future' : '') + '"><span class="c">' + esc(M.code({ season: s, number: e.number == null ? null : e.number })) +
            '</span><span class="n">' + esc(e.name || 'Untitled') + '</span><time datetime="' + esc(e.airdate || '') + '">' + esc(fmtYmd(e.airdate)) + '</time></li>';
        }).join('') + '</ol></details>';
    });
    return out;
  }

  /* ---------------------------------------------------------------- search */
  function initSearch() {
    var input = $('#q'), out = $('#results'), tok = 0, timer;
    function run(q) {
      var my = ++tok;
      if (q.length < 2) { out.innerHTML = '<p class="res-meta">Type at least two letters to search.</p>'; return; }
      try { history.replaceState(null, '', '?q=' + encodeURIComponent(q)); } catch (e) { /* ignore */ }
      out.innerHTML = '<p class="res-meta" role="status">Searching</p>';
      Api.get('/search/shows?q=' + encodeURIComponent(q)).then(function (list) {
        if (my !== tok) return;
        list = (Array.isArray(list) ? list : []).filter(function (r) { return r && r.show && r.show.id; }).slice(0, 20);
        if (!list.length) { out.innerHTML = '<div class="state"><h2>No shows found for "' + esc(q) + '"</h2><p>Check the spelling or try a shorter title.</p></div>'; return; }
        out.innerHTML = '<ul class="res">' + list.map(function (r) { return resultRow(r.show); }).join('') + '</ul>';
        syncFollowButtons(out);
      }, function (err) { if (my === tok) out.innerHTML = errorState(err); });
    }
    $('#search-form').addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(timer); run(input.value.trim()); });
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { run(input.value.trim()); }, 400); });
    var q0 = (new URLSearchParams(location.search).get('q') || '').trim();
    if (q0) { input.value = q0; run(q0); }
  }
  function resultRow(s) {
    var sid = U.num(s.id) || 0;
    var img = U.safeUrl(s.image && (s.image.medium || s.image.original)), name = String(s.name || 'Untitled');
    var net = (s.network && s.network.name) || (s.webChannel && s.webChannel.name) || '';
    var meta = [s.premiered ? String(s.premiered).slice(0, 4) : '', net, (s.genres || []).slice(0, 2).join(', '), s.status || ''].filter(Boolean).join(', ');
    return '<li><a class="thumb" href="/show/?id=' + sid + '" tabindex="-1" aria-hidden="true">' +
      (img ? '<img src="' + esc(img) + '" width="56" height="79" alt="" loading="lazy">' : '<span class="noimg">' + esc(name.charAt(0).toUpperCase()) + '</span>') + '</a>' +
      '<div><a class="res-name" href="/show/?id=' + sid + '">' + esc(name) + '</a><p class="res-meta">' + esc(meta) + '</p></div>' +
      V.followBtn({ showId: sid, show: name, img: img }, true) + '</li>';
  }

  /* ---------------------------------------------------------------- my shows */
  function renderWatchlist() {
    var root = $('#wl-root'), list = follows();
    if (!list.length) {
      root.innerHTML = '<div class="state"><h2>You are not following any shows yet</h2><p>Press Follow on any episode or show page. Your list stays in this browser, and this page shows when each show airs next.</p>' +
        '<a class="btn btn--solid" href="/">See what is on today</a> <a class="btn btn--ghost" href="/search/">Search shows</a></div>';
      return;
    }
    root.innerHTML = '<ul class="res" id="wl-list">' + list.map(function (f) {
      return '<li data-id="' + f.id + '"><a class="thumb" href="/show/?id=' + f.id + '" tabindex="-1" aria-hidden="true">' +
        (U.safeUrl(f.img) ? '<img src="' + esc(U.safeUrl(f.img)) + '" width="56" height="79" alt="" loading="lazy">' : '<span class="noimg">' + esc(String(f.name || '?').charAt(0).toUpperCase()) + '</span>') + '</a>' +
        '<div><a class="res-name" href="/show/?id=' + f.id + '">' + esc(f.name) + '</a><p class="res-next" data-next>Loading next episode</p></div>' +
        V.followBtn({ showId: f.id, show: f.name, img: U.safeUrl(f.img) }, true) + '</li>';
    }).join('') + '</ul><div class="tools" id="wl-tools" hidden><button type="button" class="btn btn--solid" id="wl-ics">Add upcoming episodes to your calendar (.ics)</button></div>';
    syncFollowButtons(root);
    var results = [];
    Promise.all(list.map(function (f) {
      return loadNext(f.id).then(function (r) { results.push(r); fillRow(r); }, function () {
        var p = $('#wl-list li[data-id="' + f.id + '"] [data-next]'); if (p) p.textContent = 'Could not load. Try again later.';
      });
    })).then(function () {
      var ul = $('#wl-list'); if (!ul) return;
      var rows = $$('li', ul);
      rows.sort(function (a, b) {
        var ra = results.filter(function (r) { return r.id === +a.getAttribute('data-id'); })[0], rb = results.filter(function (r) { return r.id === +b.getAttribute('data-id'); })[0];
        var ta = ra && ra.next ? Date.parse(ra.next.airstamp) : Infinity, tb = rb && rb.next ? Date.parse(rb.next.airstamp) : Infinity;
        return ta - tb;
      }).forEach(function (r) { ul.appendChild(r); });
      var timed = results.filter(function (r) { return r.next && r.next.airtime; });
      if (timed.length) {
        $('#wl-tools').hidden = false;
        $('#wl-ics').onclick = function () {
          var ev = timed.map(function (r) {
            var ms = Date.parse(r.next.airstamp);
            return { id: r.next.id, start: ms, end: ms + (r.next.runtime || 30) * 60000, title: r.name + ' ' + M.code(r.next), desc: r.next.name ? 'Episode: ' + r.next.name : '',
              url: location.origin + '/show/?id=' + r.id };
          });
          download(M.buildIcs(ev, Date.now(), CFG.siteName), 'my-shows.ics');
        };
      }
    });
  }
  function fillRow(r) {
    var p = $('#wl-list li[data-id="' + r.id + '"] [data-next]'); if (!p) return;
    if (!r.next) { p.textContent = r.status === 'Ended' ? 'This show has ended.' : 'No upcoming episode announced yet.'; return; }
    var ms = Date.parse(r.next.airstamp);
    p.innerHTML = '<strong>' + esc(M.code(r.next)) + '</strong> ' + (r.next.name ? esc(r.next.name) + ', ' : '') + esc(fmtWhen(r.next)) +
      (r.next.airtime ? ' <span class="eta">' + esc(T.etaText(ms - Date.now())) + '</span>' : '');
  }

  /* ---------------------------------------------------------------- premieres (next 7 days, loaded one day at a time) */
  var P = null;
  function initPremieres() {
    var params = new URLSearchParams(location.search), region = pickRegion(params);
    P = { region: region, days: 7, kind: 'all', data: {}, loading: false };
    var snap = readSnapshot(); // the saved copy built once a day: skip the network when it is for today and this region
    if (snap && snap.region === region && snap.start === T.ymdIn(T.REGIONS[region].tz, new Date()) && snap.days && typeof snap.days === 'object') {
      Object.keys(snap.days).forEach(function (d) { if (T.isYmd(d) && Array.isArray(snap.days[d])) P.data[d] = snap.days[d]; });
      P.days = Math.max(7, Object.keys(P.data).length);
    }
    $('#region').innerHTML = Object.keys(T.REGIONS).map(function (k) {
      return '<button type="button" data-region="' + k + '" aria-pressed="' + (k === P.region) + '">' + esc(T.REGIONS[k].short) + '</button>';
    }).join('');
    $('#region').addEventListener('click', function (e) {
      var b = e.target.closest('[data-region]'); if (!b || b.getAttribute('data-region') === P.region) return;
      P.region = b.getAttribute('data-region'); Store.set('region', P.region); P.data = {}; P.days = 7;
      $$('#region button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      loadPremieres(true);
    });
    $('#chips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      P.kind = b.getAttribute('data-kind');
      $$('#chips .chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      drawPremieres(!P.loading);
    });
    $('#prem-more').addEventListener('click', function () { P.days += 7; loadPremieres(false); });
    $('#chips').innerHTML = [['all', 'All premieres'], ['series', 'New series'], ['season', 'Returning seasons']].map(function (k) { return chip('data-kind="' + k[0] + '"', k[1], k[0] === 'all'); }).join('');
    loadPremieres(true);
  }
  function loadPremieres(reset) {
    if (P.loading) return;
    P.loading = true;
    var today = T.ymdIn(T.REGIONS[P.region].tz, new Date()), dates = [], i;
    for (i = 0; i < P.days; i++) dates.push(T.ymdAdd(today, i));
    var todo = dates.filter(function (d) { return !P.data[d]; });
    if (!todo.length) { P.loading = false; $('#prem-status').textContent = ''; drawPremieres(true); $('#prem-more').hidden = P.days >= 28; return; }
    $('#prem-more').hidden = true;
    if (reset) $('#prem-list').innerHTML = skeleton(2);
    var failed = 0, n = 0;
    todo.reduce(function (chain, d) {
      return chain.then(function () {
        $('#prem-status').textContent = 'Loading day ' + (++n) + ' of ' + todo.length;
        return loadDay(P.region, d).then(function (res) { P.data[d] = res.rows; drawPremieres(false); }, function () { failed++; P.data[d] = []; });
      });
    }, Promise.resolve()).then(function () {
      P.loading = false;
      $('#prem-status').textContent = failed ? 'Some days could not be loaded (' + failed + '). Try again later.' : '';
      drawPremieres(true);
      $('#prem-more').hidden = P.days >= 28;
    });
  }
  function drawPremieres(final) {
    var today = T.ymdIn(T.REGIONS[P.region].tz, new Date()), days = [], i;
    for (i = 0; i < P.days; i++) {
      var d = T.ymdAdd(today, i);
      if (!P.data[d]) continue;
      var rows = M.filterRows(P.data[d], { kind: 'premieres' }).filter(function (a) {
        return P.kind === 'all' || (P.kind === 'series' ? a.flag === 'Series premiere' : /^Season \d+ premiere$/.test(a.flag));
      });
      days.push({ date: d, rows: rows });
    }
    var any = days.some(function (d) { return d.rows.length; });
    var html = any ? V.premieresHtml(days, { tz: undefined, region: P.region, picks: new Set(), feedAd: final && (CO.ads.slotEnabled('feed') || CO.ads.preview) })
      : (final ? '<div class="state"><h2>No premieres found in this window</h2><p>Try the next 7 days, another region, or a different filter.</p></div>' : skeleton(1));
    $('#prem-list').innerHTML = html;
    localize($('#prem-list')); syncFollowButtons($('#prem-list'));
    if (final) CO.ads.init($('#prem-list'));
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    tickClock();
    setInterval(function () { if (!document.hidden) { tickClock(); } }, 15000);
    setInterval(function () {
      if (document.hidden) return;
      tick();
      $$('.eta[data-eta]').forEach(function (el) { var d = +el.getAttribute('data-eta') - Date.now(); el.textContent = d > 0 ? T.etaText(d) : 'now'; });
    }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { tickClock(); tick(); } });
    syncFollowButtons(document);
    if (PAGE === 'home') initHome();
    else if (PAGE === 'day') initDay();
    else if (PAGE === 'show') initShow();
    else if (PAGE === 'search') initSearch();
    else if (PAGE === 'watchlist') renderWatchlist();
    else if (PAGE === 'premieres') initPremieres();
  }
  boot();
})();
