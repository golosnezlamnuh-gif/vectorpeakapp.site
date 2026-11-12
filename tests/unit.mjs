import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as F from './fixtures.mjs';
const require = createRequire(import.meta.url);
const CO = require('../src/assets/js/render.js');
const { util, time, model, view } = CO;

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n', e.message); process.exitCode = 1; } };

t('stripHtml removes tags, decodes entities, collapses space', () => {
  assert.equal(util.stripHtml('<p>A <b>bold</b>&nbsp;move &amp; more&hellip; &#8217;ok&#x2019;</p><p>Two</p>'), 'A bold move & more… ’ok’ Two');
  assert.equal(util.stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>'); // decoded text, escaped later by esc()
  assert.equal(util.stripHtml(null), '');
});
t('esc escapes all five characters', () => assert.equal(util.esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'));
t('clip keeps whole sentences when it can', () => {
  assert.equal(util.clip('One short sentence. Another one that is rather long and goes on.', 40), 'One short sentence.');
  assert.match(util.clip('word '.repeat(80), 50), /…$/);
  assert.equal(util.clip('short', 50), 'short');
});
t('safeUrl allows https only and upgrades static.tvmaze.com', () => {
  assert.equal(util.safeUrl('http://static.tvmaze.com/a.jpg'), 'https://static.tvmaze.com/a.jpg');
  assert.equal(util.safeUrl('javascript:alert(1)'), '');
  assert.equal(util.safeUrl('http://evil.example/x.jpg'), '');
  assert.equal(util.safeUrl('https://a.example/x" onerror="y'), '');
});
t('date helpers', () => {
  assert.equal(time.ymdAdd('2026-11-30', 1), '2026-12-01');
  assert.equal(time.ymdAdd('2026-03-01', -1), '2026-02-28');
  assert.equal(time.ymdIn('America/New_York', new Date('2026-11-10T02:30:00Z')), '2026-11-09');
  assert.equal(time.ymdIn('Europe/Kyiv', new Date('2026-11-10T02:30:00Z')), '2026-11-10');
  assert.equal(time.fmtDateLong('2026-11-10'), 'Tuesday, November 10, 2026');
  assert.equal(time.fmtTime('2026-11-10T21:00:00-05:00', 'America/New_York'), '9:00 PM');
  assert.equal(time.fmtTime('2026-11-10T21:00:00-05:00', 'Europe/London'), '2:00 AM');
  assert.equal(time.tzName('America/New_York', '2026-11-10T21:00:00-05:00'), 'EST');
  assert.equal(time.isYmd('2026-02-30'), false);
  assert.equal(time.etaText(18 * 60000), 'in 18 min');
  assert.equal(time.etaText(125 * 60000), 'in 2 h 5 min');
  assert.equal(time.etaText(50 * 3600000), 'in 2 days');
});

const date = '2026-11-10';
const rows = model.buildRows([
  { items: F.scheduleUS(date), source: 'tv' },
  { items: F.webUS(date), source: 'web' },
  { items: F.webGlobal(date), source: 'web' }
]);
t('buildRows: merges, de-duplicates by episode id and drops non-English', () => {
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  assert.ok(!rows.some((r) => r.show === 'Estrellas del Norte' || r.show === 'Das Haus'), 'foreign language kept');
  assert.ok(rows.some((r) => r.show === 'Nine Rooms' && r.web));
  assert.equal(rows.filter((r) => r.show === 'Harbor Lights').length, 1);
});
t('flags: premieres and specials', () => {
  const byShow = (n) => rows.filter((r) => r.show === n);
  assert.equal(byShow('Bluff Creek')[0].flag, 'Series premiere');
  assert.equal(byShow('Salt & Ash')[0].flag, 'Season 4 premiere');
  assert.equal(byShow('Harbor Lights')[0].flag, '');
});
t('normalizeAiring is defensive', () => {
  assert.equal(model.normalizeAiring(null), null);
  assert.equal(model.normalizeAiring({}), null);
  assert.equal(model.normalizeAiring({ id: 1, airdate: '2026-11-10', show: { id: 2, name: 'X' } }).timed, false);
  const a = model.normalizeAiring({ id: 1, airdate: '2026-11-10', airtime: '20:00', airstamp: '2026-11-10T20:00:00-05:00', number: null, season: 2, type: 'significant_special', show: { id: 2, name: 'X', runtime: 40, image: { medium: 'javascript:1' } } });
  assert.equal(a.runtime, 40); assert.equal(a.img, ''); assert.equal(model.code(a), 'S02 special'); assert.equal(a.flag, 'Special');
  assert.equal(a.end - a.start, 40 * 60000);
});
t('filterRows: chatter hidden by default, chips work', () => {
  const base = model.filterRows(rows, {});
  assert.ok(!base.some((r) => ['Talk Show', 'News', 'Game Show'].includes(r.showType)));
  assert.ok(model.filterRows(rows, { chatter: true }).length > base.length);
  assert.ok(model.filterRows(rows, { kind: 'premieres' }).every((r) => /premiere$/.test(r.flag)));
  assert.ok(model.filterRows(rows, { kind: 'web' }).every((r) => r.web));
  assert.ok(model.filterRows(rows, { genre: 'Comedy' }).every((r) => r.genres.includes('Comedy')));
});
const list = model.filterRows(rows, {});
t('picks and groups', () => {
  const picks = model.markPicks(list);
  assert.ok(picks.size >= 3 && picks.size <= 12);
  const groups = model.groupRows(list);
  assert.equal(groups[0].t, -1, 'all-day group first');
  for (let i = 2; i < groups.length; i++) assert.ok(groups[i].t > groups[i - 1].t, 'groups sorted by time');
  assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), list.length);
});
t('rail html: structure, escaping, ad placeholders', () => {
  const ctx = { tz: 'America/New_York', date, picks: model.markPicks(list), feedAd: true };
  const html = view.railHtml(model.groupRows(list), ctx);
  assert.match(html, /<section class="slot" data-t="/);
  assert.match(html, /class="ep ep--pick"/);
  assert.match(html, /class="ep ep--line"/);
  assert.match(html, /9:00 PM/);
  assert.ok((html.match(/class="ad-slot ad-feed"/g) || []).length >= 1, 'feed ad placeholder expected for a full day');
  assert.ok(!/<script/i.test(html));
  const none = view.railHtml(model.groupRows(list), { ...ctx, feedAd: false });
  assert.ok(!/ad-slot/.test(none));
  const few = view.railHtml(model.groupRows(list.slice(0, 5)), ctx);
  assert.ok(!/ad-slot/.test(few), 'no ads on thin pages');
  // ids used by anchors exist
  const d = view.digest(list, ctx);
  for (const m of d.html.matchAll(/href="#(ep-\d+)"/g)) assert.ok(html.includes(`id="${m[1]}"`), 'digest anchor target missing ' + m[1]);
});
t('digest: facts are computed, text variant has no HTML', () => {
  const d = view.digest(list, { tz: 'America/New_York', date });
  assert.match(d.text, /^Tuesday has \d+ new episodes from \d+ shows/);
  assert.match(d.text, /New series: .*Bluff Creek/);
  assert.match(d.text, /Returning: .*Salt & Ash/);
  assert.ok(!/[<>]/.test(d.text));
  assert.equal(view.digest([], {}).html, '');
});
t('XSS: hostile data never becomes markup', () => {
  const evil = model.normalizeAiring({ id: 5, airdate: date, airtime: '20:00', airstamp: date + 'T20:00:00-05:00', season: 1, number: 2, name: '"><img src=x onerror=alert(1)>',
    summary: '<img src=x onerror=alert(1)>Hello', show: { id: 9, name: '<script>alert(1)</script>', image: { medium: 'https://static.tvmaze.com/a.jpg" onerror="x' } } }, 'tv');
  const html = view.pickRow(evil, { tz: 'America/New_York' }) + view.lineRow(evil, { tz: 'America/New_York' });
  assert.ok(!/<script|<img src=x|onerror=alert/i.test(html.replace(/&lt;[^"]*?&gt;/g, '')), html);
  // All attribute values are double-quoted by esc(); blank them out, then anything left that looks like markup is real.
  const skeleton = html.replace(/"[^"]*"/g, '""');
  assert.ok(!/<[a-z][^>]*\sonerror\s*=/i.test(skeleton), 'event-handler attribute injected');
  assert.ok(!/<img[^>]*src=x/i.test(skeleton), 'injected <img> tag');
  assert.ok(!/<script/i.test(skeleton), 'injected <script>');
});
t('ICS: valid structure, CRLF, escaping and folding', () => {
  const ics = model.buildIcs([{ id: 7, start: Date.parse('2026-11-11T02:00:00Z'), end: Date.parse('2026-11-11T03:00:00Z'),
    title: 'Salt & Ash, S04E01; "Embers"', desc: 'Line one\nLine two ' + 'x'.repeat(200), url: 'https://www.tvmaze.com/shows/5' }], Date.parse('2026-11-10T06:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /DTSTART:20261111T020000Z\r\n/);
  assert.match(ics, /DTEND:20261111T030000Z\r\n/);
  assert.match(ics, /SUMMARY:Salt & Ash\\, S04E01\\; "Embers"\r\n/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'line longer than 75 octets');
  assert.ok(!/(^|[^\r])\n/.test(ics), 'bare LF');
});
t('premieres list', () => {
  const html = view.premieresHtml([{ date, rows: list.filter((r) => /premiere$/.test(r.flag)) }, { date: '2026-11-11', rows: [] }], { tz: 'America/New_York', picks: new Set(), feedAd: false });
  assert.match(html, /Tuesday, November 10, 2026/);
  assert.ok(!/November 11/.test(html), 'empty day skipped');
  assert.ok(html.indexOf('Series premiere') < html.indexOf('Season 4 premiere'), 'series premieres first');
});

console.log(process.exitCode ? 'unit: FAILURES' : `unit: all ${passed} passed`);
