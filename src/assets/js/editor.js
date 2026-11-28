/* Cold Open: the editor's desk (/editor/). A private workbench: it loads the real schedule, fills the prompt templates
 * from prompts/*.txt, and checks a draft with the same rules the site build uses. No data leaves the browser
 * except the schedule request to TVmaze. The helpers live in brief.js so that they can be tested without a browser. */
(function () {
  'use strict';
  var CO = window.CO, B = CO.brief, T = CO.time, M = CO.model;
  var PROMPTS = window.CO_PROMPTS || {}, RULES = window.CO_RULES || {};
  var SITE = (window.CO_CONFIG && window.CO_CONFIG.siteName) || 'Cold Open';
  var DELAY = typeof window.CO_DESK_DELAY === 'number' ? window.CO_DESK_DELAY : 550; // pause between TVmaze requests

  var TEMPLATES = [
    ['note', "Daily editor's note", 'day'],
    ['week', 'Weekly article: TV this week', 'week'],
    ['ideas', 'Ideas for new guides', ''],
    ['guide-outline', 'New guide, step 1: outline and fact list', ''],
    ['guide', 'New guide, step 2: write the article', ''],
    ['factcheck', 'Fact-check a draft (use a different assistant)', ''],
    ['polish', 'Polish the voice of a draft', '']
  ];
  var FIELDS = {
    MY_TAKE: ['My own take (optional: real opinions or experience only)', 3],
    TOPIC: ['Topic', 2],
    READER_QUESTION: ["The reader's question", 2],
    EXISTING_GUIDES: ['Guides that already exist (one per line, filled in from the site)', 5],
    OUTLINE: ['Outline from step 1 (paste it here)', 7],
    VERIFIED_FACTS: ['Facts you have verified (one per line, with where you checked)', 5],
    DRAFT: ['The draft', 9]
  };
  // the same field means something a little different in some prompts
  var LABELS = {
    ideas: { MY_TAKE: ['Your interests and limits (optional)', 3] },
    'guide-outline': { MY_TAKE: ['Your own experience or angle (optional, real only)', 3] },
    polish: { MY_TAKE: ['Your voice (optional): describe it, or paste a few sentences you wrote yourself', 4] }
  };
  var AUTO = { SITE: 1, DATE: 1, DATE_LONG: 1, FACTS: 1 };

  function $(s) { return document.querySelector(s); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var toastTimer;
  function say(msg) {
    var el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 3000);
  }
  function remember(k, v) { try { if (v === undefined) return localStorage.getItem('co.desk.' + k); localStorage.setItem('co.desk.' + k, v); } catch (e) { /* storage blocked: skip */ } return null; }
  function copy(text, what) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); say(ok ? what + ' copied' : 'Copy failed: select the text and copy it by hand');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { say(what + ' copied'); }, fallback);
    else fallback();
  }

  /* ---------------------------------------------------------------- TVmaze */
  function getJson(path, tries) {
    return fetch('https://api.tvmaze.com' + path, { headers: { Accept: 'application/json' } }).then(function (res) {
      if (res.status === 429 || res.status >= 500) {
        if (tries <= 0) throw new Error('TVmaze is busy right now (HTTP ' + res.status + '). Try again in a minute.');
        var ra = parseFloat(res.headers.get('Retry-After'));
        return sleep(isFinite(ra) ? ra * 1000 : 1500).then(function () { return getJson(path, tries - 1); });
      }
      if (!res.ok) throw new Error('TVmaze answered HTTP ' + res.status + '.');
      return res.json();
    }, function () {
      if (tries <= 0) throw new Error('Could not reach TVmaze. Check your connection and try again.');
      return sleep(1200).then(function () { return getJson(path, tries - 1); });
    });
  }
  function loadDay(date) {
    var plan = [['tv', '/schedule?country=US&date=' + date], ['web', '/schedule/web?date=' + date + '&country=US'], ['web', '/schedule/web?date=' + date + '&country=']];
    var lists = [];
    return plan.reduce(function (p, d) {
      return p.then(function () {
        return getJson(d[1], 3).then(function (items) {
          if (!Array.isArray(items)) throw new Error('TVmaze sent an unexpected answer.');
          lists.push({ items: items, source: d[0] });
          return sleep(DELAY);
        });
      });
    }, Promise.resolve()).then(function () { return M.buildRows(lists); });
  }

  /* ---------------------------------------------------------------- step 1: facts */
  var busy = false;
  function status(msg, bad) { var el = $('#d-status'); el.textContent = msg; el.classList.toggle('is-bad', !!bad); }
  function setBusy(on) { busy = on; $('#load-day').disabled = on; $('#load-week').disabled = on; }
  function dateValue() { var v = $('#d-date').value; return T.isYmd(v) ? v : ''; }

  function onLoadDay() {
    var date = dateValue(); if (!date || busy) { if (!date) status('Pick a date first.', true); return; }
    setBusy(true); status('Loading ' + date + ' from TVmaze...');
    loadDay(date).then(function (rows) {
      var r = B.buildFacts(rows, { date: date });
      $('#facts-day').value = r.text;
      status(r.stats.episodes ? 'Loaded ' + date + ': ' + r.stats.episodes + ' episodes from ' + r.stats.shows + ' shows, ' + r.stats.picks + ' top picks.' : 'TVmaze returned no new episodes for ' + date + '.', !r.stats.episodes);
      if (date !== $('#n-date').value && $('#kind').value === 'note' && !$('#draft').value.trim()) $('#n-date').value = date;
      renderPrompt(); renderReport();
    }, function (e) { status(e.message, true); }).then(function () { setBusy(false); });
  }
  function onLoadWeek() {
    var date = dateValue(); if (!date || busy) { if (!date) status('Pick a date first.', true); return; }
    setBusy(true);
    var days = [], i = 0;
    (function next() {
      if (i >= 7) {
        var r = B.buildWeekFacts(days, {});
        $('#facts-week').value = r.text;
        status('Loaded 7 days from ' + date + ': ' + r.stats.episodes + ' episodes, ' + r.stats.newSeries + ' new series, ' + r.stats.returning + ' returning seasons.', !r.stats.episodes);
        renderPrompt(); setBusy(false); return;
      }
      var d = T.ymdAdd(date, i);
      status('Loading day ' + (i + 1) + ' of 7 (' + d + ')...');
      loadDay(d).then(function (rows) { days.push({ date: d, rows: rows }); i++; next(); }, function (e) { status(e.message, true); setBusy(false); });
    })();
  }

  /* ---------------------------------------------------------------- step 2: prompt */
  var fieldValues = {};
  function templateList() {
    var known = TEMPLATES.filter(function (t) { return PROMPTS[t[0]]; });
    Object.keys(PROMPTS).forEach(function (k) { if (!known.some(function (t) { return t[0] === k; })) known.push([k, k, '']); });
    return known;
  }
  function currentTemplate() { var k = $('#tpl').value; return templateList().filter(function (t) { return t[0] === k; })[0] || null; }
  function buildFields() {
    var t = currentTemplate(), box = $('#fields');
    box.innerHTML = '';
    if (!t) return;
    B.fieldsOf(PROMPTS[t[0]]).forEach(function (key) {
      if (AUTO[key]) return;
      var def = (LABELS[t[0]] && LABELS[t[0]][key]) || FIELDS[key] || [key.replace(/_/g, ' ').toLowerCase(), 3];
      var label = document.createElement('label'), ta = document.createElement('textarea');
      label.textContent = def[0]; ta.rows = def[1]; ta.setAttribute('data-key', key); ta.value = fieldValues[key] || '';
      ta.addEventListener('input', function () { fieldValues[key] = ta.value; ta.setAttribute('data-touched', '1'); renderPrompt(); });
      label.appendChild(ta);
      var row = document.createElement('div'); row.className = 'desk-row'; row.appendChild(label); label.className = 'grow';
      box.appendChild(row);
    });
    fillExisting();
  }
  function renderPrompt() {
    var t = currentTemplate(), out = $('#prompt'), meta = $('#prompt-meta');
    if (!t) { out.value = ''; meta.textContent = 'No prompt templates found.'; return; }
    var date = dateValue(), facts = t[2] === 'week' ? $('#facts-week').value : t[2] === 'day' ? $('#facts-day').value : '';
    var vars = { SITE: SITE, DATE: date, DATE_LONG: date ? T.fmtDateLong(date) : '', FACTS: facts };
    Object.keys(fieldValues).forEach(function (k) { vars[k] = fieldValues[k]; });
    var r = B.fillPrompt(PROMPTS[t[0]], vars);
    out.value = r.text;
    var open = r.missing.filter(function (k) { return k !== 'MY_TAKE'; });
    var help = [];
    if (open.indexOf('FACTS') >= 0) help.push(t[2] === 'week' ? 'Load the week in step 1 first.' : 'Load the day in step 1 first.');
    var own = open.filter(function (k) { return !AUTO[k]; });
    if (own.length) help.push('Still empty: ' + own.map(function (k) { return (FIELDS[k] ? FIELDS[k][0].replace(/ \(.*$/, '') : k).toLowerCase(); }).join(', ') + '.');
    if (open.indexOf('DATE') >= 0 && open.indexOf('FACTS') < 0) help.push('Pick a date in step 1.');
    meta.textContent = help.length ? help.join(' ') : r.text.length.toLocaleString('en-US') + ' characters, ready to copy.' + (r.missing.indexOf('MY_TAKE') >= 0 ? ' Adding your own take (even two lines) makes the result more yours.' : '');
    meta.classList.toggle('is-bad', help.length > 0);
    var raw = out.value; // the optional take stays as a visible marker if empty; strip it so the assistant is not confused
    out.value = raw.replace(/\{\{MY_TAKE\}\}/g, '(none)');
  }
  var existing = '';
  function fillExisting() {
    var ta = document.querySelector('#fields textarea[data-key="EXISTING_GUIDES"]');
    if (!ta || ta.getAttribute('data-touched')) return;
    ta.value = existing || '(none yet)'; fieldValues.EXISTING_GUIDES = ta.value; renderPrompt();
  }
  function loadExisting() {
    // the build lists the guides that are already published in prompts.js, so no request is needed
    existing = (window.CO_GUIDES || []).map(function (g) { return g.title + ' (' + g.path + ')'; }).join('\n');
    fillExisting();
  }

  /* ---------------------------------------------------------------- step 3: check */
  var verdict = { name: '', folder: '', text: '' };
  function todayEt() { return T.ymdIn(B.ET, new Date()); }
  function fileOf() {
    var kind = $('#kind').value, text = $('#draft').value.replace(/\r\n?/g, '\n');
    if (kind === 'note') return { folder: 'content/notes', name: ($('#n-date').value || todayEt()) + '.txt' };
    var f = B.parseFront(text), slug = B.slugify(f.data.title || '') || 'new-guide';
    return { folder: 'content/guides', name: slug + '.md' };
  }
  function renderReport() {
    var kind = $('#kind').value, text = $('#draft').value, box = $('#report');
    $('#n-date-wrap').hidden = kind !== 'note';
    var f = fileOf();
    verdict = { name: f.name, folder: f.folder, text: text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').trim() + '\n' };
    if (!text.trim()) { box.innerHTML = ''; $('#file-name').textContent = ''; updateGithub(); return; }
    var r = kind === 'note' ? B.checkNote(text, RULES) : B.checkGuide(text, RULES, todayEt());
    var html = '<ul class="desk-list">';
    r.errors.forEach(function (m) { html += '<li class="bad">' + CO.util.esc(m) + '</li>'; });
    r.warnings.forEach(function (m) { html += '<li class="warn">' + CO.util.esc(m) + '</li>'; });
    r.info.forEach(function (m) { html += '<li>' + CO.util.esc(m) + '</li>'; });
    html += '</ul>';
    html += r.errors.length ? '<p class="desk-verdict bad">Not ready: fix the red items first.</p>'
      : '<p class="desk-verdict good">' + (r.warnings.length ? 'Will be published. Read the orange items first: they are about quality.' : 'Ready to upload.') + '</p>';
    box.innerHTML = html;
    $('#file-name').textContent = 'Save it as ' + f.folder + '/' + f.name;
    updateGithub();
  }
  function updateGithub() {
    var a = $('#gh-link'), url = B.githubNewFileUrl($('#repo').value, verdict.folder || 'content/notes', verdict.name || (todayEt() + '.txt'));
    if (url) { a.href = url; a.hidden = false; } else { a.removeAttribute('href'); a.hidden = true; }
  }
  function onDownload() {
    if (!verdict.text.trim()) { say('Paste a draft first'); return; }
    var blob = new Blob([verdict.text], { type: 'text/plain;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = verdict.name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 500);
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    var tpl = $('#tpl');
    templateList().forEach(function (t) { var o = document.createElement('option'); o.value = t[0]; o.textContent = t[1]; tpl.appendChild(o); });
    var today = todayEt();
    $('#d-date').value = today; $('#n-date').value = today;
    $('#repo').value = remember('repo') || '';
    buildFields(); renderPrompt(); renderReport(); loadExisting();
    $('#load-day').addEventListener('click', onLoadDay);
    $('#load-week').addEventListener('click', onLoadWeek);
    $('#d-date').addEventListener('change', function () { if ($('#kind').value === 'note' && !$('#draft').value.trim()) $('#n-date').value = dateValue() || $('#n-date').value; renderPrompt(); renderReport(); });
    $('#facts-day').addEventListener('input', renderPrompt);
    $('#facts-week').addEventListener('input', renderPrompt);
    tpl.addEventListener('change', function () {
      var t = currentTemplate();
      if (t && /^(note)$/.test(t[0])) $('#kind').value = 'note'; else if (t && /^(week|guide)$/.test(t[0])) $('#kind').value = 'guide';
      buildFields(); renderPrompt(); renderReport();
    });
    $('#copy-prompt').addEventListener('click', function () { copy($('#prompt').value, 'Prompt'); });
    var timer;
    $('#draft').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(renderReport, 200); });
    $('#kind').addEventListener('change', renderReport);
    $('#n-date').addEventListener('change', renderReport);
    $('#copy-draft').addEventListener('click', function () { if (!verdict.text.trim()) { say('Paste a draft first'); return; } copy(verdict.text, 'Text'); });
    $('#copy-name').addEventListener('click', function () { if (!verdict.name) { say('Paste a draft first'); return; } copy(verdict.name, 'File name'); });
    $('#download').addEventListener('click', onDownload);
    $('#repo').addEventListener('input', function () { remember('repo', $('#repo').value.trim()); updateGithub(); });
  }
  boot();
})();
