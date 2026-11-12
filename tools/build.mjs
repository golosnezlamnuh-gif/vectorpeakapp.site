#!/usr/bin/env node
/* Cold Open site builder (Node 20+, no dependencies).
 *
 *   node tools/build.mjs            compose site/ from src/ and site.config.json
 *   node tools/build.mjs --daily    also fetch today's listings from TVmaze and write the saved copies:
 *                                   front page, premieres, /day/DATE/, the archive, the sitemap
 *
 * Options: --date YYYY-MM-DD   build for another US-Eastern date
 *          --out DIR           output folder (default: site)
 *          --config FILE       config file (default: site.config.json)
 *          --fixtures FILE     offline test data (a module exporting scheduleUS/webUS/webGlobal), used by the tests
 *          --notes DIR         folder with editor's notes, one YYYY-MM-DD.txt per day (default: content/notes)
 *          --no-premieres      skip the 14-day premieres fetch
 *          --allow-empty       accept a suspiciously empty day instead of aborting
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CO = require(path.join(ROOT, 'src/assets/js/render.js'));
const { util: U, time: T, model: M, view: V } = CO;

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const warnings = [];
const warn = (m) => { warnings.push(m); console.warn('  warning: ' + m); };
const die = (m) => { console.error('\nBuild failed: ' + m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SRC = path.join(ROOT, 'src');
const OUT = path.resolve(ROOT, opt('out', 'site'));
const DAILY = flag('daily');
const ET = T.REGIONS.US.tz;

/* ------------------------------------------------------------------ config */
const DEFAULTS = {
  siteName: 'Cold Open', tagline: 'Every new TV episode of the day, in a few lines.', siteUrl: 'https://example.com',
  contactEmail: 'hello@example.com', editorName: 'the Cold Open editor', defaultRegion: 'US',
  adsense: { publisherId: '', slots: { side: '', feed: '', end: '' } }
};
const merge = (a, b) => {
  const o = { ...a };
  for (const k of Object.keys(b || {})) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? merge(a[k], b[k]) : b[k];
  return o;
};
function loadConfig() {
  const file = path.resolve(ROOT, opt('config', 'site.config.json'));
  let user = {};
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`Cannot read ${file}: ${e.message}`); }
  }
  const c = merge(DEFAULTS, user);
  c.siteUrl = String(c.siteUrl).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(c.siteUrl)) die('siteUrl must look like https://yourdomain.com');
  if (/example\.com/.test(c.siteUrl)) warn('siteUrl is still the placeholder. Canonical links, the sitemap and robots.txt point to example.com until you change it.');
  if (/@example\.com$/.test(c.contactEmail)) warn('contactEmail is still the placeholder. The Contact page shows hello@example.com until you change it.');
  if (!T.REGIONS[c.defaultRegion]) c.defaultRegion = 'US';
  const pid = String(c.adsense.publisherId || '').trim().replace(/^ca-/, '');
  c.pub = /^pub-\d{10,20}$/.test(pid) ? pid : '';
  if (pid && !c.pub) warn('adsense.publisherId should look like pub-1234567890123456. Ads stay off until it does.');
  c.slots = {};
  for (const k of ['side', 'feed', 'end']) {
    const v = String((c.adsense.slots || {})[k] || '').trim();
    c.slots[k] = c.pub && /^\d{6,20}$/.test(v) ? v : '';
    if (v && !/^\d{6,20}$/.test(v)) warn(`adsense.slots.${k} should be the numeric ad unit id from AdSense. That slot stays off.`);
  }
  return c;
}
const cfg = loadConfig();

/* ------------------------------------------------------------------ small helpers */
const esc = U.esc;
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const jsonForHtml = (o) => JSON.stringify(o).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
const buildDate = new Date();
const todayEt = opt('date', T.ymdIn(ET, buildDate));
if (!T.isYmd(todayEt)) die('--date must look like 2026-11-10');
const vars = {
  siteName: cfg.siteName, tagline: cfg.tagline, siteUrl: cfg.siteUrl, contactEmail: cfg.contactEmail, editorName: cfg.editorName,
  year: String(buildDate.getUTCFullYear()), date: T.fmtDateLong(buildDate.toISOString().slice(0, 10))
};
const flags = { ads: !!cfg.pub, noads: !cfg.pub, archive: false, noarchive: true }; // archive flags are set once we know whether /day/ exists
function template(text) {
  return text
    .replace(/<!--if:(\w+)-->([\s\S]*?)<!--endif:\1-->/g, (_, k, inner) => (flags[k] ? inner : ''))
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? esc(vars[k]) : m));
}

/* ------------------------------------------------------------------ TVmaze data (daily mode) */
let provider = null;
let lastCall = 0;
async function remote(p) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = Math.max(0, lastCall + 650 - Date.now());
    if (wait) await sleep(wait);
    lastCall = Date.now();
    try {
      const res = await fetch('https://api.tvmaze.com' + p, {
        headers: { Accept: 'application/json', 'User-Agent': `ColdOpenBuild/1.0 (+${cfg.siteUrl})` }, signal: AbortSignal.timeout(30000)
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${p}`);
      return await res.json();
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error(`Too many retries for ${p}`);
}
async function setupProvider() {
  const f = opt('fixtures', '');
  if (!f) { provider = remote; return; }
  const fx = await import(pathToFileURL(path.resolve(ROOT, f)).href);
  provider = async (p) => {
    const u = new URL('https://x' + p), date = u.searchParams.get('date'), country = u.searchParams.get('country');
    if (u.pathname === '/schedule') return fx.scheduleUS(date);
    if (u.pathname === '/schedule/web') return country === 'US' ? fx.webUS(date) : fx.webGlobal(date);
    throw new Error('No fixture for ' + p);
  };
}
async function fetchDayRows(date) {
  const plan = [['tv', `/schedule?country=US&date=${date}`], ['web', `/schedule/web?date=${date}&country=US`], ['web', `/schedule/web?date=${date}&country=`]];
  const lists = [];
  for (const [source, p] of plan) {
    const items = await provider(p);
    if (!Array.isArray(items)) throw new Error('Unexpected response for ' + p + ' (expected a list)');
    lists.push({ items, source });
  }
  return M.buildRows(lists);
}
const slim = (a) => ({ ...a, summary: U.clip(a.summary, 300), about: a.summary ? '' : U.clip(a.about, 240) });

/** Optional editor's note for a day: content/notes/YYYY-MM-DD.txt, plain text, blank line = new paragraph. Escaped, max 4 paragraphs and 1,500 characters. */
const NOTES = path.resolve(ROOT, opt('notes', 'content/notes'));
function readNote(date) {
  const f = path.join(NOTES, date + '.txt');
  if (!fs.existsSync(f)) return '';
  const paras = fs.readFileSync(f, 'utf8').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);
  let left = 1500; const out = [];
  for (const p of paras) { if (left <= 40) break; out.push(U.clip(p, left)); left -= p.length; }
  if (paras.join('').length > 1500) warn(`${path.relative(ROOT, f)} is longer than 1,500 characters. Only the beginning is shown.`);
  return out.length ? `<aside class="note" id="note" data-date="${date}"><h2>Editor's note</h2>${out.map((p) => `<p>${esc(p)}</p>`).join('')}</aside>` : '';
}

/* ------------------------------------------------------------------ page chrome */
let hasArchive = DAILY || fs.existsSync(path.join(OUT, 'day', 'index.html'));
flags.archive = hasArchive; flags.noarchive = !hasArchive;
const assetHash = {};
const asset = (p) => `${p}${assetHash[p] ? '?v=' + assetHash[p] : ''}`;
const NAV = [['today', '/', 'Today'], ['premieres', '/premieres/', 'Premieres'], ['watchlist', '/watchlist/', 'My shows'], ['search', '/search/', 'Search']];

function headHtml(meta) {
  const title = meta.titleRaw ? meta.title : `${meta.title} | ${cfg.siteName}`;
  const url = cfg.siteUrl + meta.path;
  const hasOg = fs.existsSync(path.join(OUT, 'assets/img/og.png'));
  return [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    meta.path === '/404.html' ? '' : `<link rel="canonical" href="${esc(url)}">`,
    `<meta name="robots" content="${esc(meta.robots || 'index,follow')}">`,
    '<meta name="color-scheme" content="light">', '<meta name="theme-color" content="#1d2bd8">',
    `<link rel="icon" href="${asset('/assets/img/favicon.svg')}" type="image/svg+xml">`,
    '<link rel="preload" href="/assets/fonts/archivo-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="preload" href="/assets/fonts/literata-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>',
    meta.api ? '<link rel="preconnect" href="https://api.tvmaze.com" crossorigin>\n<link rel="preconnect" href="https://static.tvmaze.com">' : '',
    `<link rel="stylesheet" href="${asset('/assets/css/site.css')}">`,
    '<meta property="og:type" content="website">', `<meta property="og:site_name" content="${esc(cfg.siteName)}">`,
    `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    hasOg ? `<meta property="og:image" content="${esc(cfg.siteUrl)}/assets/img/og.png">` : '',
    `<meta name="twitter:card" content="${hasOg ? 'summary_large_image' : 'summary'}">`,
    meta.ads && cfg.pub ? `<meta name="google-adsense-account" content="ca-${cfg.pub}">\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${cfg.pub}" crossorigin="anonymous"></script>` : '',
    meta.jsonld ? `<script type="application/ld+json">${jsonForHtml(meta.jsonld)}</script>` : '',
    '</head>'
  ].filter(Boolean).join('\n');
}
function headerHtml(nav) {
  return `<header class="mast"><div class="mast-in"><a class="brand" href="/" aria-label="${esc(cfg.siteName)}, home"><i class="tally" aria-hidden="true"></i>${esc(cfg.siteName)}</a>` +
    `<nav class="nav" aria-label="Main">${NAV.map(([k, h, l]) => `<a href="${h}"${k === nav ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>` +
    '<p class="clock" id="clock" title="Your local time"></p></div></header>';
}
function footerHtml() {
  return `<footer class="foot"><div class="foot-in"><p class="foot-brand">${esc(cfg.siteName)}</p>` +
    '<nav class="foot-nav" aria-label="About this site"><a href="/about/">About</a><a href="/how-it-works/">How it works</a>' +
    (hasArchive ? '<a href="/day/">Daily archive</a>' : '') +
    '<a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/contact/">Contact</a>' +
    (cfg.pub ? '<a href="#" id="consent-link">Privacy and cookie settings</a>' : '') + '</nav>' +
    '<p>TV listings and descriptions from <a href="https://www.tvmaze.com/" rel="noopener">TVmaze</a>, licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a>. ' +
    `${esc(cfg.siteName)} is independent and is not affiliated with any network or streaming service.</p>` +
    `<p>&copy; ${vars.year} ${esc(cfg.siteName)}</p></div></footer>`;
}
function pageHtml(meta, main) {
  return [headHtml(meta), `<body data-page="${esc(meta.page)}">`, '<a class="skip" href="#main">Skip to content</a>', headerHtml(meta.nav), main, footerHtml(),
    '<div id="toast" class="toast" role="status" aria-live="polite"></div>',
    ['/assets/js/config.js', '/assets/js/render.js', '/assets/js/ads.js', '/assets/js/app.js'].map((s) => `<script defer src="${asset(s)}"></script>`).join('\n'),
    '</body>', '</html>', ''].join('\n');
}
const outPath = (p) => (p === '/' ? 'index.html' : p.endsWith('.html') ? p.slice(1) : p.slice(1) + 'index.html');
function parsePage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->\s*\n/);
  if (!m) die(`${file} must start with a <!--{...}--> meta comment`);
  // values go into JSON here (HTML escaping happens later, once, when the head is written)
  const json = m[1].replace(/\{\{(\w+)\}\}/g, (x, k) => (k in vars ? JSON.stringify(String(vars[k])).slice(1, -1) : x));
  return { meta: JSON.parse(json), body: raw.slice(m[0].length) };
}

/* ------------------------------------------------------------------ copy static files, generate config.js */
function cleanOut() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const e of fs.readdirSync(OUT)) if (e !== 'day') fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}
function hashAssets() {
  const walk = (dir, base) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const f = path.join(dir, e.name), rel = base + '/' + e.name;
    if (e.isDirectory()) walk(f, rel);
    else if (/\.(css|js|svg|png)$/.test(e.name)) assetHash[rel] = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
  });
  walk(path.join(OUT, 'assets'), '/assets');
}

/* ------------------------------------------------------------------ daily content builders */
function dayContext(rows, date) {
  const base = M.filterRows(rows, { chatter: false });
  const picks = M.markPicks(base);
  const ctx = { tz: ET, date, region: 'US', picks, feedAd: !!cfg.slots.feed };
  return { rows, base, picks, ctx, rail: V.railHtml(M.groupRows(base), ctx), digest: V.digest(base, ctx) };
}
function itemListLd(name, data) {
  const picks = data.base.filter((a) => data.picks.has(a.id)).slice(0, 12);
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', name, numberOfItems: picks.length,
    itemListElement: picks.map((a, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: { '@type': 'TVEpisode', name: a.title || a.show, ...(a.number ? { episodeNumber: a.number } : {}), datePublished: a.airdate || undefined,
        partOfSeason: { '@type': 'TVSeason', seasonNumber: a.season }, partOfSeries: { '@type': 'TVSeries', name: a.show } }
    }))
  };
}
function dayPageHtml(date, data, prevDate) {
  const long = T.fmtDateLong(date);
  const meta = {
    title: `New TV episodes on ${long}: ${data.base.length} episodes`, description: U.clip(data.digest.text, 158), path: `/day/${date}/`, page: 'day', nav: '',
    robots: 'index,follow', ads: true, api: true, jsonld: itemListLd(`New TV episodes on ${long}`, data)
  };
  const main = '<div class="nextbar" role="region" aria-label="Next on air"><div class="wrap nextbar-in" id="nextbar-in"><p class="nextbar-note">Times are shown in your time zone.</p></div></div>' +
    '<main id="main" class="wrap layout"><div class="col-main"><header class="top">' +
    `<h1>New TV episodes on ${esc(long)}</h1><p class="dek">${data.digest.html}</p>${readNote(date)}</header>` +
    '<nav class="ctl" aria-label="Browse other days"><div class="tools">' +
    `<a class="btn btn--solid" href="/?d=${date}">Open the live schedule</a>` +
    (prevDate ? `<a class="btn btn--ghost" href="/day/${prevDate}/">Previous day</a>` : '') +
    '<a class="btn btn--ghost" href="/day/">All days</a></div></nav>' +
    `<div id="feed">${data.rail}</div></div><aside class="col-side" id="side"><section class="side-box" id="side-follow" hidden></section>` +
    `<section class="side-box" id="side-picks">${V.picksBox(data.base, data.ctx)}</section></aside></main>`;
  return pageHtml(meta, main);
}
function premieresDigest(days) {
  const all = days.flatMap((d) => d.rows.map((r) => ({ ...r, _date: d.date })));
  const dedupe = (l) => { const s = new Set(); return l.filter((r) => (s.has(r.showId) ? false : s.add(r.showId))); };
  const series = dedupe(all.filter((r) => r.flag === 'Series premiere'));
  const seasons = dedupe(all.filter((r) => /^Season \d+ premiere$/.test(r.flag)));
  if (!series.length && !seasons.length) return { html: '', text: '' };
  const list = (l, max) => {
    const sorted = l.slice().sort((a, b) => M.score(b) - M.score(a)).slice(0, max);
    const part = (r) => `${r.show} (${r.net ? r.net + ', ' : ''}${T.fmtDayMonth(r._date)})`;
    return { html: sorted.map((r) => esc(part(r))).join(', ') + (l.length > max ? ` and ${l.length - max} more` : ''), text: sorted.map(part).join(', ') + (l.length > max ? ` and ${l.length - max} more` : '') };
  };
  const h = [], t = [];
  const s1 = `${U.plural(series.length, 'new series', 'new series')} and ${U.plural(seasons.length, 'returning season')} premiere in the next ${days.length} days.`;
  h.push(esc(s1)); t.push(s1);
  if (series.length) { const l = list(series, 4); h.push('New series: ' + l.html + '.'); t.push('New series: ' + l.text + '.'); }
  if (seasons.length) { const l = list(seasons, 4); h.push('Returning: ' + l.html + '.'); t.push('Returning: ' + l.text + '.'); }
  return { html: h.join(' '), text: t.join(' ') };
}
function archivePageHtml(manifest) {
  const dates = Object.keys(manifest).filter(T.isYmd).sort().reverse();
  const meta = { title: 'Daily archive of new TV episodes', description: 'A saved copy of every day of new TV episodes: what aired, what premiered and how busy the day was.', path: '/day/', page: 'archive', nav: '', robots: 'index,follow', ads: false, api: false };
  const items = dates.map((d) => {
    const e = manifest[d];
    return `<li><div><a class="res-name" href="/day/${d}/">${esc(T.fmtDateLong(d))}</a><p class="res-meta">${e.count} episodes${e.premieres ? `, ${e.premieres} premiere${e.premieres === 1 ? '' : 's'}` : ''}. ${esc((e.top || []).join(', '))}</p></div></li>`;
  }).join('');
  return pageHtml(meta, '<main id="main" class="page"><div class="narrow"><header class="top"><h1>Daily archive</h1>' +
    '<p class="dek">A saved copy of each day\'s new episodes, grouped by US Eastern date. Times on each page are converted to your time zone.</p></header>' +
    `<ul class="res arch">${items}</ul></div></main>`);
}

/* ------------------------------------------------------------------ main */
async function main() {
  console.log(`Cold Open build: ${DAILY ? 'daily' : 'compose only'}, output ${path.relative(process.cwd(), OUT) || '.'}`);
  let day = null, premiereDays = null;

  if (DAILY) {
    await setupProvider();
    console.log(`  fetching ${todayEt} (US networks + streaming)`);
    let rows;
    try { rows = await fetchDayRows(todayEt); } catch (e) { die(`Could not fetch today's listings: ${e.message}\nNothing was changed.`); }
    if (rows.length < 5 && !flag('allow-empty')) die(`Only ${rows.length} episodes came back for ${todayEt}. That looks like a data problem, so nothing was changed. Use --allow-empty to override.`);
    day = dayContext(rows, todayEt);
    console.log(`  ${rows.length} English-language episodes, ${day.base.length} after hiding talk/news/sports, ${day.picks.size} briefs`);
    if (!flag('no-premieres')) {
      const n = 14;
      premiereDays = [{ date: todayEt, rows: M.filterRows(rows, { kind: 'premieres' }) }];
      for (let i = 1; i < n; i++) {
        const d = T.ymdAdd(todayEt, i);
        try { premiereDays.push({ date: d, rows: M.filterRows(await fetchDayRows(d), { kind: 'premieres' }) }); }
        catch (e) { warn(`premieres: could not load ${d} (${e.message}); that day is left out`); }
      }
      console.log(`  premieres window: ${premiereDays.length} days, ${premiereDays.reduce((s, d) => s + d.rows.length, 0)} premiere episodes`);
    }
  }

  cleanOut();
  copyDir(path.join(SRC, 'assets'), path.join(OUT, 'assets'));
  copyDir(path.join(SRC, 'static'), OUT);
  const client = { siteName: cfg.siteName, siteUrl: cfg.siteUrl, defaultRegion: cfg.defaultRegion, ads: { client: cfg.pub ? 'ca-' + cfg.pub : '', slots: cfg.slots } };
  fs.writeFileSync(path.join(OUT, 'assets/js/config.js'), 'window.CO_CONFIG=' + JSON.stringify(client) + ';\n');
  hashAssets();

  const sitemap = [];
  const addMap = (p, lastmod) => sitemap.push({ loc: cfg.siteUrl + p, lastmod });
  const built = buildDate.toISOString();
  const today = built.slice(0, 10);

  for (const f of fs.readdirSync(path.join(SRC, 'pages')).filter((n) => n.endsWith('.html')).sort()) {
    const { meta, body } = parsePage(path.join(SRC, 'pages', f));
    let html = template(body);
    const fill = { h1: 'New TV episodes today', dek: '', note: '', feedattrs: '', feed: '', snapshot: '', sidepicks: '', archivelink: hasArchive ? ' Or browse the <a href="/day/">daily archive</a>.' : '' };
    if (meta.page === 'home') {
      if (day) {
        fill.h1 = esc('New TV episodes on ' + T.fmtDateLong(todayEt));
        fill.dek = day.digest.html;
        fill.note = readNote(todayEt);
        fill.sidepicks = V.picksBox(day.base, day.ctx);
        fill.feedattrs = ` data-built="${built}"`;
        fill.feed = day.rows.length ? day.rail : V.emptyHtml('No new episodes listed for this day');
        fill.snapshot = `<script type="application/json" id="snapshot">${jsonForHtml({ region: 'US', date: todayEt, built, rows: day.rows.map(slim) })}</script>`;
        meta.title = `New TV episodes on ${T.fmtDateLong(todayEt)}: ${day.base.length} episodes | ${cfg.siteName}`;
        meta.description = U.clip(day.digest.text, 158);
      } else {
        fill.feed = '<div role="status"><span class="sr">Loading</span></div>';
        fill.feedattrs = ' aria-busy="true"';
      }
    }
    if (meta.page === 'premieres' && premiereDays) {
      const dg = premieresDigest(premiereDays);
      fill.dek = dg.html;
      fill.feed = V.premieresHtml(premiereDays, { tz: ET, region: 'US', picks: new Set(), feedAd: !!cfg.slots.feed }) || V.emptyHtml('No premieres found in this window');
      fill.snapshot = `<script type="application/json" id="snapshot">${jsonForHtml({ region: 'US', start: todayEt, built, days: Object.fromEntries(premiereDays.map((d) => [d.date, d.rows.map(slim)])) })}</script>`;
      if (dg.text) meta.description = U.clip(dg.text, 158);
    }
    html = html.replace(/<!--@(\w+)-->/g, (m, k) => (k in fill ? fill[k] : m));
    write(outPath(meta.path), pageHtml(meta, html));
    if (!/noindex/.test(meta.robots || '')) addMap(meta.path, today);
  }

  if (DAILY) {
    const manifestFile = path.join(OUT, 'day', 'index.json');
    const manifest = readJson(manifestFile, {});
    const dates = Object.keys(manifest).filter((d) => d < todayEt).sort();
    const prev = dates[dates.length - 1] || '';
    write(`day/${todayEt}/index.html`, dayPageHtml(todayEt, day, prev && fs.existsSync(path.join(OUT, 'day', prev, 'index.html')) ? prev : ''));
    const topNames = [];
    day.base.slice().sort((a, b) => M.score(b) - M.score(a)).forEach((a) => { if (topNames.length < 3 && !topNames.includes(a.show)) topNames.push(a.show); });
    manifest[todayEt] = { count: day.base.length, premieres: day.base.filter((a) => /premiere$/.test(a.flag)).length, top: topNames };
    write('day/index.json', JSON.stringify(manifest, null, 1) + '\n');
    write('day/index.html', archivePageHtml(manifest));
    addMap('/day/', today);
  }
  if (hasArchive) {
    for (const d of Object.keys(readJson(path.join(OUT, 'day', 'index.json'), {})).filter(T.isYmd).sort().reverse()) addMap(`/day/${d}/`, d);
  }

  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
  write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemap.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n') + '\n</urlset>\n');
  if (cfg.pub) write('ads.txt', `google.com, ${cfg.pub}, DIRECT, f08c47fec0942fa0\n`);

  const files = []; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(OUT);
  const big = files.filter((f) => fs.statSync(f).size > 25 * 1024 * 1024);
  console.log(`  wrote ${files.length} files (Cloudflare Pages limits: 20,000 files per site, 25 MiB per file, 1,000 files for drag-and-drop upload)`);
  if (files.length > 1000) warn('More than 1,000 files: drag-and-drop upload will not work. Use the GitHub route (README, option B).');
  if (big.length) die('A file is larger than 25 MiB: ' + big.join(', '));
  console.log(cfg.pub ? `  AdSense: publisher ${cfg.pub}, slots enabled: ${Object.keys(cfg.slots).filter((k) => cfg.slots[k]).join(', ') || 'none yet (verification snippet only)'}` : '  AdSense: not configured (no ad code is included)');
  console.log(warnings.length ? `Done with ${warnings.length} warning(s).` : 'Done.');
}
main().catch((e) => die(e.stack || e.message));
