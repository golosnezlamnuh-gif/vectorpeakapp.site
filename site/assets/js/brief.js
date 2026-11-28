/* Cold Open: helpers for the editor's desk (/editor/).
 * Pure functions with no DOM access, so the same file runs in the browser (window.CO.brief) and in Node (tests/unit.mjs).
 * It turns TVmaze data into a plain-text "facts block" for an AI prompt, fills the prompt templates from prompts/*.txt,
 * and checks a draft against the same publishing rules the site build applies (tools/content.mjs). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.CO = root.CO || {}; root.CO.brief = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function core() {
    if (typeof window !== 'undefined' && window.CO && window.CO.model) return window.CO;
    return require('./render.js');
  }
  var ET = 'America/New_York';

  /* ------------------------------------------------------------------ facts for the daily note */
  function when(a, T) { return a.timed ? T.fmtTime(a.start, ET) + ' ET' : 'no fixed time'; }
  function count(list, key) {
    var c = {};
    list.forEach(function (a) { var k = key(a); if (k) c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).sort(function (x, y) { return c[y] - c[x] || (x < y ? -1 : 1); }).map(function (k) { return [k, c[k]]; });
  }
  function names(rows, max) {
    var seen = [];
    rows.forEach(function (a) { if (seen.indexOf(a.show) < 0) seen.push(a.show); });
    return seen.slice(0, max).join(', ') + (seen.length > max ? ' and ' + (seen.length - max) + ' more' : '');
  }
  function line(a, T, M) {
    var bits = [a.show + ' - ' + (a.title ? '"' + a.title + '" ' : '') + '(' + M.code(a) + ')'];
    bits.push((a.net || 'network not listed') + ', ' + when(a, T) + (a.runtime ? ', ' + a.runtime + ' min' : ''));
    var tail = [];
    if (a.flag) tail.push(a.flag);
    if (a.genres.length) tail.push('Genres: ' + a.genres.join(', '));
    if (a.rating) tail.push('TVmaze rating ' + a.rating.toFixed(1));
    return bits.join(', ') + (tail.length ? '. ' + tail.join('. ') : '') + '.';
  }

  /** rows: airings for one US-Eastern date (CO.model.buildRows output). Returns { text, stats }. */
  function buildFacts(rows, opts) {
    var CO = core(), M = CO.model, T = CO.time, U = CO.util;
    var date = opts.date, base = M.filterRows(rows, { chatter: false }), picks = M.markPicks(base);
    var top = base.filter(function (a) { return picks.has(a.id); }).sort(function (a, b) { return M.score(b) - M.score(a) || a.id - b.id; }).slice(0, 8);
    var shows = U.uniq(base.map(function (a) { return a.showId; })).length;
    var series = base.filter(function (a) { return a.flag === 'Series premiere'; });
    var seasons = base.filter(function (a) { return /^Season \d+ premiere$/.test(a.flag); });
    var groups = M.groupRows(base).filter(function (g) { return g.t >= 0; });
    var busiest = groups.slice().sort(function (a, b) { return b.rows.length - a.rows.length || a.t - b.t; })[0];
    var untimed = base.filter(function (a) { return !a.timed; });
    var out = [];
    out.push('DATE: ' + T.fmtDateLong(date) + ' (US Eastern Time, written "ET" below)');
    out.push('SOURCE: TVmaze schedule data for US networks and streaming services. English-language shows only; talk, news, sports and game shows are left out.');
    out.push('');
    out.push('OVERVIEW');
    if (!base.length) {
      out.push('- No new episodes were found for this date. Do not write a note from this data.');
    } else {
      out.push('- ' + U.plural(base.length, 'new episode') + ' from ' + U.plural(shows, 'show') + '.');
      out.push('- Premieres: ' + U.plural(series.length, 'new series', 'new series') + ', ' + U.plural(seasons.length, 'returning season') + '.');
      if (busiest && busiest.rows.length > 1) out.push('- Busiest start time: ' + T.fmtTime(busiest.t, ET) + ' ET (' + U.plural(busiest.rows.length, 'episode') + ').');
      var nets = count(base, function (a) { return a.net; }).slice(0, 5);
      if (nets.length) out.push('- Most episodes by channel or service: ' + nets.map(function (n) { return n[0] + ' (' + n[1] + ')'; }).join(', ') + '.');
      var gen = count(base.reduce(function (l, a) { return l.concat(a.genres.map(function (g) { return { g: g }; })); }, []), function (x) { return x.g; }).slice(0, 4);
      if (gen.length) out.push('- Most common genres: ' + gen.map(function (n) { return n[0] + ' (' + n[1] + ')'; }).join(', ') + '.');
      if (untimed.length) out.push('- Episodes with no fixed time (usually streaming): ' + untimed.length + '.');
    }
    if (top.length) {
      out.push('');
      out.push("TOP PICKS (ranked by the site's published formula: popularity, premiere bonus, rating)");
      top.forEach(function (a, i) {
        out.push((i + 1) + '. ' + line(a, T, M));
        if (a.summary) out.push('   Episode summary: ' + U.clip(a.summary, 320));
        else if (a.about) out.push('   About the show: ' + U.clip(a.about, 260));
      });
    }
    var topIds = {};
    top.forEach(function (a) { topIds[a.id] = 1; });
    var rest = base.filter(function (a) { return !topIds[a.id] && a.timed; }).sort(function (a, b) { return a.start - b.start || (a.show < b.show ? -1 : 1); });
    if (rest.length) {
      out.push('');
      out.push('OTHER NEW EPISODES (time order)');
      rest.slice(0, 25).forEach(function (a) { out.push('- ' + T.fmtTime(a.start, ET) + ' ET - ' + a.show + ' (' + (a.net || 'n/a') + ') ' + M.code(a) + (a.flag ? ' - ' + a.flag : '')); });
      if (rest.length > 25) out.push('- ...and ' + (rest.length - 25) + ' more');
    }
    if (untimed.length) {
      out.push('');
      out.push('NO FIXED TIME (all-day or streaming releases)');
      untimed.filter(function (a) { return !topIds[a.id]; }).slice(0, 15).forEach(function (a) { out.push('- ' + a.show + ' (' + (a.net || 'n/a') + ') ' + M.code(a) + (a.flag ? ' - ' + a.flag : '')); });
    }

    // things worth a sentence, worked out from the data so that nobody has to guess
    var quirks = [];
    var slots = {};
    top.forEach(function (a) { if (a.timed && !a.web) (slots[a.start] = slots[a.start] || []).push(a); }); // only linear TV can clash: streaming can be watched any time
    Object.keys(slots).sort(function (x, y) { return slots[y].length - slots[x].length || x - y; }).slice(0, 1).forEach(function (k) {
      if (slots[k].length > 1) quirks.push('Clash: ' + slots[k].length + ' of the top picks start at ' + T.fmtTime(+k, ET) + ' ET on TV (' + slots[k].map(function (a) { return a.show; }).join(', ') + ').');
    });
    var dropSeen = {};
    var drops = base.filter(function (a) { var k = a.showId + '|' + a.start; return a.web && a.timed && !dropSeen[k] && (dropSeen[k] = 1); });
    if (drops.length) quirks.push('Streaming releases with a listed time: ' + drops.slice(0, 5).map(function (a) { return a.show + ' (' + a.net + ', ' + T.fmtTime(a.start, ET) + ' ET)'; }).join('; ') + (drops.length > 5 ? '; and ' + (drops.length - 5) + ' more' : '') + '.');
    var late = base.filter(function (a) { if (!a.timed || a.web) return false; var h = +new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hourCycle: 'h23' }).format(new Date(a.start)); return h >= 23 || h < 5; });
    if (late.length) quirks.push('Late-night TV starts (11 PM to 5 AM ET): ' + names(late, 5) + '.');
    var multi = count(base, function (a) { return String(a.showId); }).filter(function (n) { return n[1] > 1; });
    multi.slice(0, 3).forEach(function (n) {
      var eps = base.filter(function (a) { return String(a.showId) === n[0]; });
      quirks.push(eps[0].show + ' has ' + n[1] + ' episodes listed today (' + eps.map(function (a) { return M.code(a); }).join(', ') + '), which looks like a multi-episode release or a marathon.');
    });
    var specials = base.filter(function (a) { return a.flag === 'Special'; });
    if (specials.length) quirks.push('Specials: ' + names(specials, 4) + '.');
    var long = top.filter(function (a) { return a.runtime >= 90; });
    if (long.length) quirks.push('Longer than usual (90 minutes or more): ' + names(long, 3) + '.');
    if (series.length) quirks.push('New series today: ' + names(series, 5) + '.');
    if (seasons.length) quirks.push('Returning seasons today: ' + names(seasons, 5) + '.');
    if (quirks.length) { out.push(''); out.push('SCHEDULE QUIRKS (worked out from the data above)'); quirks.forEach(function (q) { out.push('- ' + q); }); }
    out.push('');
    out.push('NOT IN THIS DATA (never invent it): reviews, critic scores, plot details beyond the summaries above, cast news, behind-the-scenes stories, what viewers think.');
    return { text: out.join('\n'), stats: { episodes: base.length, shows: shows, picks: top.length, quirks: quirks.length } };
  }

  /** days: [{ date, rows }] for consecutive US-Eastern dates. Returns { text, stats }. */
  function buildWeekFacts(days, opts) {
    var CO = core(), M = CO.model, T = CO.time, U = CO.util;
    var first = days[0].date, last = days[days.length - 1].date;
    var per = days.map(function (d) {
      var base = M.filterRows(d.rows, { chatter: false });
      return { date: d.date, base: base, picks: M.markPicks(base) };
    });
    var all = per.reduce(function (l, d) { return l.concat(d.base.map(function (a) { return { a: a, date: d.date }; })); }, []);
    var out = [];
    out.push('WEEK: ' + T.fmtDateLong(first) + ' to ' + T.fmtDateLong(last) + ' (US Eastern Time, written "ET" below)');
    out.push('SOURCE: TVmaze schedule data for US networks and streaming services. English-language shows only; talk, news, sports and game shows are left out.');
    out.push('');
    var total = all.length;
    /* One line per premiere: if a feed lists the same episode twice (two networks, a repeat), only the first listing counts. */
    function uniq(list) {
      var seen = {};
      return list.filter(function (x) {
        var key = (x.a.showId || x.a.show) + '|' + x.a.season + '|' + x.a.number;
        if (seen[key]) return false;
        seen[key] = true; return true;
      });
    }
    var np = uniq(all.filter(function (x) { return x.a.flag === 'Series premiere'; })), sp = uniq(all.filter(function (x) { return /^Season \d+ premiere$/.test(x.a.flag); }));
    out.push('OVERVIEW');
    if (!total) out.push('- No new episodes were found for these dates. Do not write from this data.');
    else {
      out.push('- ' + U.plural(total, 'new episode') + ' across ' + U.plural(days.length, 'day') + '.');
      out.push('- Premieres: ' + U.plural(np.length, 'new series', 'new series') + ', ' + U.plural(sp.length, 'returning season') + '.');
      var busy = per.slice().sort(function (x, y) { return y.base.length - x.base.length || (x.date < y.date ? -1 : 1); });
      out.push('- Busiest day: ' + T.weekdayLong(busy[0].date) + ' ' + T.fmtDayMonth(busy[0].date) + ' (' + busy[0].base.length + ' episodes). Quietest: ' + T.weekdayLong(busy[busy.length - 1].date) + ' ' + T.fmtDayMonth(busy[busy.length - 1].date) + ' (' + busy[busy.length - 1].base.length + ').');
    }
    function premLine(x) {
      var a = x.a;
      return '- ' + T.weekdayShort(x.date) + ' ' + T.fmtDayMonth(x.date) + ', ' + when(a, T) + ': ' + a.show + ' (' + (a.net || 'n/a') + ') ' + M.code(a) +
        (a.genres.length ? ', ' + a.genres.join('/') : '') + (a.rating ? ', TVmaze rating ' + a.rating.toFixed(1) : '') +
        (a.summary || a.about ? '. ' + U.clip(a.summary || a.about, 240) : '');
    }
    var byScore = function (x, y) { return M.score(y.a) - M.score(x.a) || x.a.id - y.a.id; };
    if (np.length) { out.push(''); out.push('NEW SERIES THIS WEEK (best known first)'); np.slice().sort(byScore).slice(0, 10).forEach(function (x) { out.push(premLine(x)); }); if (np.length > 10) out.push('- ...and ' + (np.length - 10) + ' more new series'); }
    if (sp.length) { out.push(''); out.push('RETURNING SEASONS THIS WEEK (best known first)'); sp.slice().sort(byScore).slice(0, 12).forEach(function (x) { out.push(premLine(x)); }); if (sp.length > 12) out.push('- ...and ' + (sp.length - 12) + ' more returning seasons'); }
    out.push('');
    out.push('TOP PICK OF EACH DAY');
    per.forEach(function (d) {
      var best = d.base.filter(function (a) { return d.picks.has(a.id); }).sort(function (a, b) { return M.score(b) - M.score(a) || a.id - b.id; })[0];
      out.push('- ' + T.weekdayLong(d.date) + ' ' + T.fmtDayMonth(d.date) + ' (' + d.base.length + ' episodes): ' + (best ? best.show + ' (' + (best.net || 'n/a') + ') ' + M.code(best) + ', ' + when(best, T) : 'no pick'));
    });
    out.push('');
    out.push('NOT IN THIS DATA (never invent it): reviews, critic scores, plot details beyond the summaries above, cast news, behind-the-scenes stories, what viewers think.');
    return { text: out.join('\n'), stats: { episodes: total, newSeries: np.length, returning: sp.length } };
  }

  /* ------------------------------------------------------------------ prompt templates */
  function fieldsOf(tpl) {
    var keys = [], re = /\{\{([A-Z][A-Z_]*)\}\}/g, m;
    while ((m = re.exec(String(tpl)))) if (keys.indexOf(m[1]) < 0) keys.push(m[1]);
    return keys;
  }
  /** Replaces {{NAME}} with the values given. Names without a value stay as they are and are listed in "missing". */
  function fillPrompt(tpl, vars) {
    var missing = [];
    var text = String(tpl).replace(/\{\{([A-Z][A-Z_]*)\}\}/g, function (m, k) {
      var v = vars && vars[k];
      if (v === undefined || v === null || String(v).trim() === '') { if (missing.indexOf(k) < 0) missing.push(k); return m; }
      return String(v).trim();
    });
    return { text: text, missing: missing };
  }

  /* ------------------------------------------------------------------ checks (the same rules as tools/content.mjs) */
  function compile(list) {
    return (list || []).map(function (r) { try { return { re: new RegExp(r[0], r[1]), label: r[2] }; } catch (e) { return null; } }).filter(Boolean);
  }
  function textProblems(text, rules) {
    var all = compile(rules && rules.placeholders).concat(compile(rules && rules.chatbot)), found = [];
    all.forEach(function (r) { if (r.re.test(text)) found.push(r.label); });
    return found;
  }
  function countWords(text) {
    var m = String(text).match(/[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9À-ɏ]+)*/g);
    return m ? m.length : 0;
  }
  function parseFront(raw) {
    raw = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    var m = raw.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (!m) return { data: {}, body: raw, hasFront: false };
    var data = {};
    m[1].split('\n').forEach(function (l) {
      var kv = l.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!kv) return;
      var v = kv[2].trim(), q = v.match(/^(["'“‘])([\s\S]*)(["'”’])$/);
      data[kv[1].toLowerCase()] = q ? q[2].trim() : v;
    });
    return { data: data, body: raw.slice(m[0].length), hasFront: true };
  }
  function isYmd(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }
  function slugify(s) { return String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, ''); }

  /** A daily note: plain text, at most 4 paragraphs and 1,500 characters. */
  function checkNote(text, rules) {
    var raw = String(text || '').replace(/^﻿/, '').replace(/\r/g, '');
    var paras = raw.split(/\n\s*\n/).map(function (p) { return p.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var shown = paras.slice(0, 4), chars = shown.join('').length;
    var r = { errors: [], warnings: [], info: [], paragraphs: paras.length, chars: chars };
    if (!paras.length) { r.errors.push('The note is empty.'); return r; }
    var p = textProblems(raw, rules);
    if (p.length) r.errors.push('The site will NOT publish this note until you remove: ' + p.join('; ') + '.');
    if (paras.length > 4) r.warnings.push('There are ' + paras.length + ' paragraphs. Only the first 4 are shown.');
    if (chars > 1500) r.warnings.push('The note is ' + chars + ' characters. Only the first 1,500 are shown, so the ending (and your sign-off) would be cut.');
    if (/\*\*|^\s*#{1,6}\s|^\s*[-*•]\s/m.test(raw)) r.warnings.push('Notes are plain text. Asterisks, # headings and bullet points would show up as typed. Rewrite them as normal sentences.');
    if (paras.length < 2) r.warnings.push('One paragraph is short for a note. Aim for three or four.');
    if (chars < 500 && chars > 0) r.warnings.push('Only ' + chars + ' characters. A useful note is usually 700 to 1,400.');
    r.info.push(paras.length + ' paragraph' + (paras.length === 1 ? '' : 's') + ', ' + chars + ' characters.');
    return r;
  }

  /** A guide: Markdown with a header between two --- lines. */
  function checkGuide(text, rules, today) {
    var raw = String(text || ''), f = parseFront(raw);
    var r = { errors: [], warnings: [], info: [], words: 0, headings: 0, slug: '', scheduled: false };
    if (!f.hasFront) { r.errors.push('The file must start with a header: a line with three dashes, then title:, description:, date:, then three dashes again.'); }
    var d = f.data, title = (d.title || '').trim();
    if (f.hasFront) {
      if (!title) r.errors.push('The header has no title.');
      if (!isYmd(d.date)) r.errors.push('The header date "' + (d.date || '') + '" must look like 2026-12-01.');
      else if (today && d.date > today) { r.scheduled = true; r.info.push('Dated ' + d.date + ': it stays hidden until that day and then appears on the next site update.'); }
      if (/^(true|yes|1)$/i.test(d.draft || '')) r.info.push('draft: true is set, so the guide stays hidden.');
      if (title.length > 100) r.warnings.push('The title is ' + title.length + ' characters. Search results cut it after about 60.');
      var dl = (d.description || '').length;
      if (!dl) r.warnings.push('No description. Add one of 110 to 160 characters: it is the text people see in search results.');
      else if (dl < 70 || dl > 170) r.warnings.push('The description is ' + dl + ' characters. 110 to 160 works best.');
      if (d.updated && (!isYmd(d.updated) || d.updated < d.date)) r.warnings.push('The updated date "' + d.updated + '" is not a real date after the publish date, so it will be ignored.');
    }
    var body = f.hasFront ? f.body : raw;
    var p = textProblems((title ? title + '\n' : '') + (d.description || '') + '\n' + body, rules);
    if (p.length) r.errors.push('The site will NOT publish this guide until you remove: ' + p.join('; ') + '.');
    var plain = body.replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').split('\n')
      .filter(function (l) { return !/^\s*\|?\s*:?-{2,}/.test(l); })
      .map(function (l) { return l.replace(/^\s*(?:#{1,6}|>|[-*+]|\d{1,3}[.)])\s+/, ''); }).join('\n');
    r.words = countWords(plain);
    r.headings = (body.match(/^##\s+\S/gm) || []).length;
    if (r.words < 300) r.errors.push('Only about ' + r.words + ' words. The site will not publish a guide under 300 words, and 600 to 1,000 is a good target.');
    else if (r.words < 500) r.warnings.push('About ' + r.words + ' words is on the short side. 600 to 1,000 tends to be more useful.');
    if (r.headings < 3) r.warnings.push('Only ' + r.headings + ' section heading(s). Use at least 3 headings that start with ## .');
    if (/^#\s+\S/m.test(body)) r.warnings.push('A line starts with a single #. The page title is already the only H1, so it will be turned into a ## heading.');
    if (/!\[[^\]]*\]\(/.test(body)) r.warnings.push('Images are not supported inside guides and will be removed.');
    if (/<\/?[a-z][^>]*>/i.test(body.replace(/```[\s\S]*?```/g, ''))) r.warnings.push('HTML tags are not supported. They will be shown as plain text.');
    var bad = [], re = /\[[^\]\n]+\]\(([^)\s]*)\)/g, m;
    while ((m = re.exec(body))) if (!/^https?:\/\//i.test(m[1]) && !/^\/(?!\/)/.test(m[1])) bad.push(m[1]);
    if (bad.length) r.warnings.push('Links that are not http(s) or site links will become plain text: ' + bad.slice(0, 3).join(', '));
    var ext = (body.match(/\]\(https?:\/\/[^)\s]+\)/g) || []).length;
    if (ext) r.info.push(ext + ' external link' + (ext === 1 ? '' : 's') + '. Open each one and make sure it works and says what you claim.');
    r.slug = slugify(title);
    r.info.push('About ' + r.words + ' words, ' + r.headings + ' section heading' + (r.headings === 1 ? '' : 's') + (r.words ? ', about ' + Math.max(1, Math.round(r.words / 200)) + ' min read.' : '.'));
    return r;
  }

  function githubNewFileUrl(repo, folder, filename) {
    repo = String(repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return '';
    return 'https://github.com/' + repo + '/new/main/' + folder.replace(/^\/+|\/+$/g, '') + '?filename=' + encodeURIComponent(filename);
  }

  return {
    ET: ET, buildFacts: buildFacts, buildWeekFacts: buildWeekFacts, fieldsOf: fieldsOf, fillPrompt: fillPrompt,
    textProblems: textProblems, countWords: countWords, parseFront: parseFront, slugify: slugify,
    checkNote: checkNote, checkGuide: checkGuide, githubNewFileUrl: githubNewFileUrl
  };
});
