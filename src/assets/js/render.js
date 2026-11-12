/*! Cold Open shared renderer.
 *  Runs in the browser (window.CO) and in Node (require) so the live page and the
 *  daily pre-rendered pages are produced by exactly the same code. No dependencies. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CO = Object.assign(root.CO || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ utilities */
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', agrave: 'à', ouml: 'ö', uuml: 'ü',
    auml: 'ä', ntilde: 'ñ', ccedil: 'ç', iacute: 'í', oacute: 'ó', aacute: 'á', uacute: 'ú', middot: '·', copy: '©' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    });
  }
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e.charAt(0) === '#') {
        var cp = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
      var v = ENT[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }
  /** TVmaze summaries are HTML. We keep plain text only and escape it again on output. */
  function stripHtml(html) {
    if (!html) return '';
    var t = String(html).replace(/<\s*br\s*\/?>/gi, ' ').replace(/<\/p>\s*<p[^>]*>/gi, ' ').replace(/<[^>]*>/g, ' ');
    return decodeEntities(t).replace(/\s+/g, ' ').trim();
  }
  /** Shorten to whole sentences when possible, otherwise to a word boundary. */
  function clip(text, max) {
    text = text || '';
    if (text.length <= max) return text;
    var cut = text.slice(0, max);
    var m = cut.match(/^(.*[.!?])(\s|$)/);
    if (m && m[1].length >= max * 0.45) return m[1];
    return cut.replace(/\s+\S*$/, '').replace(/[,;:\s-]+$/, '') + '…';
  }
  function safeUrl(u) {
    if (typeof u !== 'string') return '';
    u = u.trim();
    if (/^http:\/\/static\.tvmaze\.com\//i.test(u)) u = 'https://' + u.slice(7);
    return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : '';
  }
  function num(v) { v = typeof v === 'string' ? parseFloat(v) : v; return typeof v === 'number' && isFinite(v) ? v : null; }
  function pos(v) { v = num(v); return v !== null && v > 0 ? v : null; }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function uniq(a) { return Array.from(new Set(a)); }

  /* ------------------------------------------------------------------ time */
  var REGIONS = {
    US: { name: 'United States', short: 'US', tz: 'America/New_York' },
    GB: { name: 'United Kingdom', short: 'UK', tz: 'Europe/London' },
    CA: { name: 'Canada', short: 'Canada', tz: 'America/Toronto' },
    AU: { name: 'Australia', short: 'Australia', tz: 'Australia/Sydney' }
  };
  function ymdIn(tz, d) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d || new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }
  function isYmd(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s; // rejects 2026-02-30
  }
  function ymdAdd(ymd, n) {
    var p = ymd.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function utcDate(ymd) { return new Date(ymd + 'T00:00:00Z'); }
  function fmtDateLong(ymd) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(utcDate(ymd));
  }
  function fmtDayMonth(ymd) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(utcDate(ymd));
  }
  function weekdayLong(ymd) { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(utcDate(ymd)); }
  function weekdayShort(ymd) { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(utcDate(ymd)); }
  function dayNum(ymd) { return String(parseInt(ymd.slice(8, 10), 10)); }
  /** Clock time. With a time zone: English 12-hour (used for pre-rendered pages). Without: the visitor's own format. */
  function fmtTime(when, tz) {
    var o = { hour: 'numeric', minute: '2-digit' };
    if (tz) o.timeZone = tz;
    return new Intl.DateTimeFormat(tz ? 'en-US' : undefined, o).format(new Date(when)).replace(/[\u202f\u00a0]/g, ' ');
  }
  function tzName(tz, when) {
    var o = { timeZoneName: 'short' };
    if (tz) o.timeZone = tz;
    var p = new Intl.DateTimeFormat('en-US', o).formatToParts(new Date(when || Date.now()));
    for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') return p[i].value;
    return '';
  }
  /** "in 18 min", "in 2 h 5 min", "in 3 days" */
  function etaText(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'in under a minute';
    if (m < 60) return 'in ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'in ' + h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    var d = Math.round(h / 24);
    return 'in ' + plural(d, 'day');
  }

  /* ------------------------------------------------------------------ model */
  var CHATTER = { 'News': 1, 'Sports': 1, 'Talk Show': 1, 'Variety': 1, 'Game Show': 1, 'Panel Show': 1, 'Award Show': 1 };

  /** One TVmaze schedule item -> one flat "airing". Returns null for anything unusable. */
  function normalizeAiring(item, source) {
    if (!item || typeof item !== 'object') return null;
    var show = item.show || (item._embedded && item._embedded.show);
    if (!show || typeof show !== 'object') return null;
    var id = num(item.id), showId = num(show.id);
    if (id === null || showId === null) return null;
    var air = typeof item.airstamp === 'string' && !isNaN(Date.parse(item.airstamp)) ? item.airstamp : '';
    if (!air && !item.airdate) return null;
    var timed = !!(air && item.airtime);
    var netName = (show.network && show.network.name) || '';
    var webName = (show.webChannel && show.webChannel.name) || '';
    var season = num(item.season) || 0;
    var number = item.number === null || item.number === undefined ? null : num(item.number);
    var type = typeof item.type === 'string' ? item.type : 'regular';
    var flag = '';
    if (type !== 'regular') flag = 'Special';
    else if (number === 1 && season > 0 && season <= 60) flag = season === 1 ? 'Series premiere' : 'Season ' + season + ' premiere';
    var start = timed ? Date.parse(air) : null;
    var runtime = pos(item.runtime) || pos(show.runtime) || pos(show.averageRuntime) || null;
    return {
      id: id, showId: showId,
      show: String(show.name || 'Untitled'),
      showType: typeof show.type === 'string' ? show.type : '',
      lang: typeof show.language === 'string' ? show.language : '',
      genres: Array.isArray(show.genres) ? show.genres.filter(function (g) { return typeof g === 'string'; }).slice(0, 3) : [],
      net: netName || webName,
      web: source === 'web' || (!netName && !!webName),
      season: season, number: number, type: type, flag: flag,
      title: String(item.name || ''),
      airstamp: air, airdate: String(item.airdate || ''), timed: timed, start: start,
      end: timed && runtime ? start + runtime * 60000 : timed ? start + 30 * 60000 : null,
      runtime: runtime,
      rating: num(item.rating && item.rating.average) || num(show.rating && show.rating.average) || null,
      weight: num(show.weight) || 0,
      summary: stripHtml(item.summary),
      about: stripHtml(show.summary),
      img: safeUrl(show.image && (show.image.medium || show.image.original))
    };
  }
  function isEnglish(a) { return !a.lang || /^english$/i.test(a.lang); }

  /** Merge several raw schedule arrays, keep English-language items, drop duplicates. */
  function buildRows(lists) {
    var seen = {}, rows = [];
    lists.forEach(function (l) {
      (Array.isArray(l.items) ? l.items : []).forEach(function (it) {
        var a = normalizeAiring(it, l.source);
        if (!a || !isEnglish(a) || seen[a.id]) return;
        seen[a.id] = 1;
        rows.push(a);
      });
    });
    return rows;
  }

  function filterRows(rows, f) {
    f = f || {};
    return rows.filter(function (a) {
      if (!f.chatter && CHATTER[a.showType]) return false;
      if (f.kind === 'premieres' && !/premiere$/.test(a.flag)) return false;
      if (f.kind === 'web' && !a.web) return false;
      if (f.kind === 'tv' && a.web) return false;
      if (f.genre && a.genres.indexOf(f.genre) < 0) return false;
      return true;
    });
  }
  function topGenres(rows, k) {
    var c = {};
    rows.forEach(function (a) { a.genres.forEach(function (g) { c[g] = (c[g] || 0) + 1; }); });
    return Object.keys(c).sort(function (x, y) { return c[y] - c[x] || (x < y ? -1 : 1); }).slice(0, k);
  }
  /** Transparent ranking: popularity + premiere bonus + rating. Documented on the "How it works" page. */
  function score(a) {
    return a.weight + (a.flag === 'Series premiere' ? 25 : /premiere$/.test(a.flag) ? 12 : 0) +
      (a.rating ? (a.rating - 6) * 4 : 0) + (a.summary ? 3 : 0);
  }
  function markPicks(rows, max) {
    var withText = rows.filter(function (a) { return a.summary || a.about; });
    var k = max || Math.min(12, Math.max(3, Math.round(rows.length * 0.2)));
    var top = withText.slice().sort(function (a, b) { return score(b) - score(a) || a.id - b.id; }).slice(0, k);
    return new Set(top.map(function (a) { return a.id; }));
  }
  function groupRows(rows) {
    var map = {}, groups = [];
    rows.forEach(function (a) {
      var key = a.timed ? String(a.start) : 'any';
      if (!map[key]) { map[key] = { key: key, t: a.timed ? a.start : -1, iso: a.timed ? a.airstamp : '', rows: [] }; groups.push(map[key]); }
      map[key].rows.push(a);
    });
    groups.sort(function (x, y) { return x.t - y.t; });
    groups.forEach(function (g) {
      g.rows.sort(function (a, b) { return b.weight - a.weight || (a.show < b.show ? -1 : a.show > b.show ? 1 : 0); });
    });
    return groups;
  }
  function code(a) {
    if (a.number === null) return a.season ? 'S' + pad2(a.season) + ' special' : 'Special';
    return 'S' + pad2(a.season) + 'E' + pad2(a.number);
  }

  /* ------------------------------------------------------------------ calendar export */
  function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsFold(line) {
    var out = '', bytes = 0, limit = 75;
    for (var ch of line) {
      var cp = ch.codePointAt(0), b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (bytes + b > limit) { out += '\r\n '; bytes = 1; limit = 75; }
      out += ch; bytes += b;
    }
    return out;
  }
  function icsStamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  /** items: [{id,start,end,title,desc,url}] (times in ms). Returns an RFC 5545 string. */
  function buildIcs(items, nowMs, name) {
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//' + icsEsc(name || 'Cold Open') + '//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    items.forEach(function (e) {
      L.push('BEGIN:VEVENT', 'UID:ep-' + e.id + '@coldopen.invalid', 'DTSTAMP:' + icsStamp(nowMs),
        'DTSTART:' + icsStamp(e.start), 'DTEND:' + icsStamp(e.end || e.start + 30 * 60000), 'SUMMARY:' + icsEsc(e.title));
      if (e.desc) L.push('DESCRIPTION:' + icsEsc(e.desc));
      if (e.url) L.push('URL:' + e.url);
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------ views (HTML strings) */
  var ICON_PLUS = '<svg class="ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2.4" fill="none"/></svg>';
  var ICON_STAR = '<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 1.2l2.1 4.5 4.9.6-3.6 3.4.9 4.9L8 12.2 3.7 14.6l.9-4.9L1 6.3l4.9-.6z" fill="currentColor"/></svg>';

  function timeEl(a, ctx) {
    return '<time datetime="' + esc(a.airstamp) + '" data-fmt="clock"' + (ctx.date ? ' data-day="' + esc(ctx.date) + '"' : '') + '>' + esc(fmtTime(a.start, ctx.tz)) + '</time>';
  }
  function poster(a, w, h) {
    if (a.img) return '<img src="' + esc(a.img) + '" width="' + w + '" height="' + h + '" alt="" loading="lazy" decoding="async">';
    return '<span class="noimg" aria-hidden="true">' + esc(a.show.charAt(0).toUpperCase()) + '</span>';
  }
  function netTab(a) {
    return a.net ? '<span class="net ' + (a.web ? 'net--web' : 'net--tv') + '">' + esc(a.net) + '</span>' : '';
  }
  function flagTab(a) { return a.flag ? '<span class="flag' + (a.flag === 'Special' ? ' flag--plain' : '') + '">' + esc(a.flag) + '</span>' : ''; }
  function followBtn(a, icon) {
    var off = icon ? 'Follow ' + a.show : 'Follow', on = icon ? 'Unfollow ' + a.show : 'Following';
    return '<button type="button" class="btn btn--follow' + (icon ? ' btn--icon' : '') + '" data-follow="' + (num(a.showId) || 0) +
      '" data-name="' + esc(a.show) + '" data-img="' + esc(a.img) + '" data-off="' + esc(off) + '" data-on="' + esc(on) +
      '"' + (icon ? ' title="' + esc(off) + '"' : '') + ' aria-pressed="false">' + ICON_PLUS + '<span class="lbl' + (icon ? ' sr' : '') + '">' + esc(off) + '</span></button>';
  }
  function dataAttrs(a, extra) {
    return ' id="ep-' + a.id + '" data-id="' + a.id + '" data-show-id="' + a.showId + '" data-show="' + esc(a.show) + '" data-code="' + esc(code(a)) +
      '" data-title="' + esc(a.title) + '" data-net="' + esc(a.net) + '" data-runtime="' + (a.runtime || '') + '"' +
      (a.timed ? ' data-start="' + a.start + '" data-end="' + a.end + '" data-status="soon"' : '') + (extra || '');
  }
  function factsRow(a) {
    var h = netTab(a);
    if (a.runtime) h += '<span class="fact">' + a.runtime + ' min</span>';
    if (a.genres.length) h += '<span class="fact">' + esc(a.genres.slice(0, 2).join(', ')) + '</span>';
    if (a.rating) h += '<span class="fact fact--rate" title="Average rating on TVmaze">' + ICON_STAR + a.rating.toFixed(1) + '</span>';
    return '<p class="ep__facts">' + h + '</p>';
  }
  function pickRow(a, ctx) {
    var text = a.summary ? clip(a.summary, 280) : clip(a.about, 220);
    var when = ctx.inlineTime && a.timed
      ? '<p class="ep__when">' + timeEl(a, ctx) + ' <span class="tz" data-tz>' + esc(tzName(ctx.tz, a.start)) + '</span></p>' : '';
    return '<li class="ep ep--pick"' + dataAttrs(a) + '>' +
      '<a class="ep__poster" href="/show/?id=' + a.showId + '" tabindex="-1" aria-hidden="true">' + poster(a, 84, 118) + '</a>' +
      '<div class="ep__body">' + when +
      '<h3 class="ep__title"><a href="/show/?id=' + a.showId + '">' + esc(a.show) + '</a></h3>' +
      '<p class="ep__label"><span class="ep__code">' + esc(code(a)) + '</span>' + (a.title ? ' <span class="ep__name">' + esc(a.title) + '</span>' : '') +
      flagTab(a) + '<span class="onair">On air</span></p>' +
      (text ? '<p class="ep__sum">' + (a.summary ? '' : '<span class="ep__src">About the show: </span>') + esc(text) + '</p>' : '') +
      factsRow(a) +
      '<div class="ep__actions">' + followBtn(a, false) +
      (a.timed ? '<button type="button" class="btn btn--ghost" data-ics>Add to calendar</button>' : '') +
      '<a class="btn btn--ghost" href="/show/?id=' + a.showId + '">Show details</a></div>' +
      '</div></li>';
  }
  function lineRow(a, ctx) {
    var when = ctx.inlineTime && a.timed ? '<span class="fact">' + timeEl(a, ctx) + '</span>' : '';
    return '<li class="ep ep--line"' + dataAttrs(a) + '>' +
      '<a class="ep__title" href="/show/?id=' + a.showId + '">' + esc(a.show) + '</a>' +
      '<span class="ep__meta"><span class="ep__code">' + esc(code(a)) + '</span>' + flagTab(a) + '<span class="onair">On air</span>' + netTab(a) +
      (a.runtime ? '<span class="fact">' + a.runtime + ' min</span>' : '') + when + '</span>' +
      followBtn(a, true) + '</li>';
  }
  function slotHtml(g, ctx) {
    var head = g.t < 0
      ? '<h2 class="slot-time slot-time--any"><span>All day</span></h2>'
      : '<h2 class="slot-time"><time datetime="' + esc(g.iso) + '" data-fmt="clock">' + esc(fmtTime(g.t, ctx.tz)) + '</time>' +
        '<span class="tz" data-tz>' + esc(tzName(ctx.tz, g.t)) + '</span><span class="shift" data-shift></span></h2>';
    var items = g.rows.map(function (a) { return ctx.picks.has(a.id) ? pickRow(a, ctx) : lineRow(a, ctx); }).join('');
    return '<section class="slot" data-t="' + g.t + '" data-day="' + esc(ctx.date || '') + '">' + head + '<ol class="slot-list">' + items + '</ol></section>';
  }
  /** The timetable. In-feed ad placeholders are only emitted when there is enough content to justify them. */
  function railHtml(groups, ctx) {
    var total = groups.reduce(function (n, g) { return n + g.rows.length; }, 0), ads = 0, out = '';
    groups.forEach(function (g, i) {
      out += slotHtml(g, ctx);
      if (ctx.feedAd && total >= 8 && i >= 2 && (i - 2) % 5 === 0 && ads < 3 && i < groups.length - 1) {
        out += '<aside class="ad-slot ad-feed" data-ad="feed" aria-label="Advertisement"></aside>'; ads++;
      }
    });
    return '<div class="rail" id="rail" data-date="' + esc(ctx.date || '') + '" data-region="' + esc(ctx.region || 'US') + '">' + out + '</div>';
  }

  function nameList(rows, max) {
    var seen = {}, list = [];
    rows.slice().sort(function (a, b) { return score(b) - score(a); }).forEach(function (a) {
      if (!seen[a.showId]) { seen[a.showId] = 1; list.push(a); }
    });
    var shown = list.slice(0, max).map(function (a) {
      return { html: '<a href="#ep-' + a.id + '">' + esc(a.show) + '</a>' + (a.net ? ' (' + esc(a.net) + ')' : ''),
        text: a.show + (a.net ? ' (' + a.net + ')' : '') };
    });
    var rest = list.length - shown.length;
    return {
      html: shown.map(function (s) { return s.html; }).join(', ') + (rest > 0 ? ' and ' + rest + ' more' : ''),
      text: shown.map(function (s) { return s.text; }).join(', ') + (rest > 0 ? ' and ' + rest + ' more' : '')
    };
  }
  /** The daily summary paragraph: facts computed from the day's data (counts, premieres, busiest slot). */
  function digest(rows, ctx) {
    var n = rows.length;
    if (!n) return { html: '', text: '' };
    var shows = uniq(rows.map(function (a) { return a.showId; })).length;
    var web = rows.filter(function (a) { return a.web; }).length;
    var day = ctx.date ? weekdayLong(ctx.date) : 'Today';
    var h = [], t = [];
    var s1 = day + ' has ' + plural(n, 'new episode') + ' from ' + plural(shows, 'show') +
      (web === n ? ', all on streaming services' : web ? ', ' + web + ' of them on streaming services' : '') + '.';
    h.push(esc(s1)); t.push(s1);
    var sp = rows.filter(function (a) { return a.flag === 'Series premiere'; });
    var sn = rows.filter(function (a) { return /^Season \d+ premiere$/.test(a.flag); });
    if (sp.length) { var l = nameList(sp, 3); h.push('New series: ' + l.html + '.'); t.push('New series: ' + l.text + '.'); }
    if (sn.length) { var l2 = nameList(sn, 3); h.push('Returning: ' + l2.html + '.'); t.push('Returning: ' + l2.text + '.'); }
    var big = groupRows(rows).filter(function (g) { return g.t >= 0; }).sort(function (x, y) { return y.rows.length - x.rows.length || x.t - y.t; })[0];
    if (big && big.rows.length >= 3) {
      h.push('The busiest slot is <time datetime="' + esc(big.iso) + '" data-fmt="clock"' + (ctx.date ? ' data-day="' + esc(ctx.date) + '"' : '') + '>' + esc(fmtTime(big.t, ctx.tz)) + '</time> <span data-tz>' +
        esc(tzName(ctx.tz, big.t)) + '</span>, with ' + big.rows.length + ' episodes starting at once.');
      t.push('The busiest slot is ' + fmtTime(big.t, ctx.tz) + ' ' + tzName(ctx.tz, big.t) + ', with ' + big.rows.length + ' episodes starting at once.');
    }
    var top = rows.slice().sort(function (a, b) { return b.weight - a.weight; })[0];
    if (top && top.weight > 0) {
      h.push('Most popular show on the list: <a href="#ep-' + top.id + '">' + esc(top.show) + '</a>' + (top.net ? ' on ' + esc(top.net) : '') + '.');
      t.push('Most popular show on the list: ' + top.show + (top.net ? ' on ' + top.net : '') + '.');
    }
    return { html: h.join(' '), text: t.join(' ') };
  }
  /** Sidebar box (wide screens only): the day's best bets in air-time order. Empty string when there are too few timed picks. */
  function picksBox(rows, ctx) {
    var list = rows.filter(function (a) { return a.timed && ctx.picks.has(a.id); })
      .sort(function (a, b) { return score(b) - score(a) || a.id - b.id; }).slice(0, 5)
      .sort(function (a, b) { return a.start - b.start || a.id - b.id; });
    if (list.length < 3) return '';
    return '<h2>Picks of the day</h2><ul class="side-list side-picks">' + list.map(function (a) {
      return '<li><a href="#ep-' + a.id + '">' + esc(a.show) + '</a><small>' + esc(code(a)) + (a.net ? ' on ' + esc(a.net) : '') + ', ' +
        timeEl(a, ctx) + ' <span class="tz" data-tz>' + esc(tzName(ctx.tz, a.start)) + '</span></small>' +
        (/premiere$/.test(a.flag) ? flagTab(a) : '') + '</li>';
    }).join('') + '</ul><p>Chosen by popularity, premieres and ratings. <a href="/how-it-works/">How picks work</a></p>';
  }
  function emptyHtml(msg) {
    return '<div class="state"><h2>' + esc(msg || 'Nothing to show for these filters') + '</h2>' +
      '<p>Try another day, switch the region, or clear the filters.</p></div>';
  }

  /** Premieres list: days with their premiere episodes (already filtered). */
  function premieresHtml(days, ctx) {
    var ads = 0, n = 0;
    return days.filter(function (d) { return d.rows.length; }).map(function (d) {
      var rows = d.rows.slice().sort(function (a, b) {
        var pa = a.flag === 'Series premiere' ? 1 : 0, pb = b.flag === 'Series premiere' ? 1 : 0;
        return pb - pa || score(b) - score(a);
      });
      n += rows.length;
      var c = Object.assign({}, ctx, { date: d.date, inlineTime: true });
      var out = '<section class="pday" data-day="' + esc(d.date) + '"><h2 class="pday-h">' + esc(fmtDateLong(d.date)) + '</h2><ol class="slot-list">' +
        rows.map(function (a) { return pickRow(a, c); }).join('') + '</ol></section>';
      if (ctx.feedAd && n >= 6 && ads < 2) { out += '<aside class="ad-slot ad-feed" data-ad="feed" aria-label="Advertisement"></aside>'; ads++; n = 0; }
      return out;
    }).join('');
  }

  return {
    util: { esc: esc, stripHtml: stripHtml, clip: clip, safeUrl: safeUrl, num: num, pad2: pad2, plural: plural, uniq: uniq },
    time: { REGIONS: REGIONS, ymdIn: ymdIn, ymdAdd: ymdAdd, isYmd: isYmd, fmtDateLong: fmtDateLong, fmtDayMonth: fmtDayMonth,
      weekdayLong: weekdayLong, weekdayShort: weekdayShort, dayNum: dayNum, fmtTime: fmtTime, tzName: tzName, etaText: etaText },
    model: { normalizeAiring: normalizeAiring, buildRows: buildRows, filterRows: filterRows, topGenres: topGenres, score: score,
      markPicks: markPicks, groupRows: groupRows, code: code, buildIcs: buildIcs, CHATTER: CHATTER },
    view: { railHtml: railHtml, digest: digest, picksBox: picksBox, emptyHtml: emptyHtml, premieresHtml: premieresHtml, pickRow: pickRow,
      lineRow: lineRow, followBtn: followBtn, netTab: netTab, flagTab: flagTab, ICON_STAR: ICON_STAR, ICON_PLUS: ICON_PLUS }
  };
});
