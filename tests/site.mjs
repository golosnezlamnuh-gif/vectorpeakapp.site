// Static checks on freshly built copies of the site: files, links, ids, sitemap, AdSense wiring, privacy, conventions.
// It builds several variants itself (offline, from tests/fixtures.mjs), so no network is needed.  Run: node tests/site.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.tmp-test');
const PUB = 'pub-1234567890123456';
const OWNER = new RegExp(['soso', 'lon', '33366'].join('')); // the owner's private address must never be published
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('  FAIL: ' + msg); } };

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function build(args, { expectFail = false } = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (expectFail ? r.status === 0 : r.status !== 0) ok(false, `build ${expectFail ? 'should have failed' : 'failed'}: ${args.join(' ')}\n${out}`);
  return { code: r.status, out };
}
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const f = path.join(dir, e.name);
  return e.isDirectory() ? walk(f, base) : [path.relative(base, f).split(path.sep).join('/')];
});
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const stripScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

const FX = ['--fixtures', 'tests/fixtures.mjs'];
const adsConfig = path.join(TMP, 'ads.config.json');
fs.writeFileSync(adsConfig, JSON.stringify({
  siteName: 'Test Guide', siteUrl: 'https://tv.test.example/', contactEmail: 'editor@test.example',
  adsense: { publisherId: 'ca-' + PUB, slots: { side: '1111111111', feed: '2222222222', end: '3333333333' } }
}));
const badConfig = path.join(TMP, 'bad.config.json');
fs.writeFileSync(badConfig, JSON.stringify({ siteUrl: 'not a url' }));
const junkAdsConfig = path.join(TMP, 'junk-ads.config.json');
fs.writeFileSync(junkAdsConfig, JSON.stringify({ siteUrl: 'https://tv.test.example', adsense: { publisherId: 'abc', slots: { side: 'x' } } }));

/* ------------------------------------------------------------------ the checks that apply to every variant */
function checkSite(dir, label, o) {
  console.log(`\n[${label}]`);
  const files = walk(dir);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  const siteUrl = o.siteUrl;

  for (const need of ['index.html', '404.html', '_headers', 'robots.txt', 'sitemap.xml', 'assets/css/site.css', 'assets/js/config.js', 'assets/js/render.js', 'assets/js/ads.js',
    'assets/js/app.js', 'assets/img/favicon.svg', 'assets/fonts/archivo-latin-wdth-normal.woff2', 'assets/fonts/literata-latin-wght-normal.woff2']) ok(files.includes(need), `missing file ${need}`);
  for (const p of ['about', 'contact', 'how-it-works', 'privacy', 'terms', 'search', 'show', 'watchlist', 'premieres']) ok(files.includes(`${p}/index.html`), `missing page ${p}/`);
  ok(files.every((f) => fs.statSync(path.join(dir, f)).size < 25 * 1024 * 1024), 'a file is larger than 25 MiB (Cloudflare Pages limit)');
  ok(files.length < 1000, 'more than 1,000 files: drag-and-drop upload would not work');

  const ids404 = read(dir, '404.html');
  ok(/<title>/.test(ids404) && !/rel="canonical"/.test(ids404), '404.html: needs a title and no canonical link');

  const noindex = new Set();
  const adPages = [];
  for (const f of htmlFiles) {
    const html = read(dir, f), page = stripScripts(html), at = `${f}: `;
    ok(/^<!doctype html>/i.test(html) && /<html lang="en">/.test(html), at + 'doctype/lang');
    ok((html.match(/<title>[^<]+<\/title>/g) || []).length === 1, at + 'exactly one non-empty <title>');
    ok(/<meta name="description" content="[^"]{10,}">/.test(html), at + 'meta description');
    const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || '';
    if (/noindex/.test(robots)) noindex.add('/' + f.replace(/index\.html$/, ''));
    else { ok((page.match(/<h1[\s>]/g) || []).length === 1, at + 'indexable page needs exactly one <h1>'); ok(/<link rel="canonical" href="https?:\/\/[^"]+">/.test(html), at + 'canonical'); }
    ok((page.match(/<main[\s>]/g) || []).length === 1, at + 'one <main>');

    const ids = [...page.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
    ok(new Set(ids).size === ids.length, at + 'duplicate ids: ' + ids.filter((x, i) => ids.indexOf(x) !== i).slice(0, 3).join(', '));
    for (const m of page.matchAll(/href="#([^"]+)"/g)) ok(ids.includes(m[1]), at + `anchor #${m[1]} has no target`);

    for (const m of page.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const u = m[1];
      if (u.startsWith('#') || u.startsWith('mailto:')) continue;
      if (/^https?:\/\//.test(u)) { ok(/^https:\/\/(www\.tvmaze\.com|static\.tvmaze\.com|api\.tvmaze\.com|creativecommons\.org|example\.org|adssettings\.google\.com|www\.aboutads\.info|policies\.google\.com)\b|^https:\/\/pagead2\.googlesyndication\.com\//.test(u) || /^https?:\/\/tv\.test\.example|^https:\/\/example\.com/.test(u), at + 'unexpected external URL ' + u); continue; }
      if (!u.startsWith('/')) { ok(false, at + 'relative URL ' + u); continue; }
      const p = decodeURIComponent(u.split('#')[0].split('?')[0]), t = path.join(dir, p);
      ok(p.endsWith('/') ? fs.existsSync(path.join(t, 'index.html')) : fs.existsSync(t) || fs.existsSync(path.join(t, 'index.html')), at + `broken link ${u}`);
    }
    for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) ok(m[1].startsWith('/assets/') || /^https:\/\/pagead2\.googlesyndication\.com\//.test(m[1]), at + 'script from ' + m[1]);
    for (const m of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) ok(m[1].startsWith('/assets/'), at + 'stylesheet from ' + m[1]);
    for (const m of html.matchAll(/<script type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g)) {
      let good = true; try { JSON.parse(m[1]); } catch { good = false; }
      ok(good && !/</.test(m[1]), at + 'JSON block must parse and must not contain a raw "<"');
    }
    if (/googlesyndication/.test(html)) adPages.push(f);
  }

  // sitemap + robots
  const sm = read(dir, 'sitemap.xml'), locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok(locs.length > 5 && new Set(locs).size === locs.length, 'sitemap: has entries, no duplicates');
  for (const l of locs) {
    ok(l.startsWith(siteUrl + '/'), 'sitemap URL outside siteUrl: ' + l);
    const p = l.slice(siteUrl.length);
    ok(fs.existsSync(path.join(dir, p, 'index.html')) || (p === '/' && fs.existsSync(path.join(dir, 'index.html'))), 'sitemap URL without a page: ' + l);
    ok(!noindex.has(p), 'sitemap lists a noindex page: ' + l);
  }
  for (const must of ['/', '/premieres/', '/about/']) ok(locs.includes(siteUrl + must), 'sitemap misses ' + must);
  ok(read(dir, 'robots.txt').includes(`Sitemap: ${siteUrl}/sitemap.xml`), 'robots.txt points to the sitemap');
  ok(!locs.some((l) => /\/(search|watchlist|show)\//.test(l)), 'sitemap must not list search, watchlist or show pages');

  // headers
  const h = read(dir, '_headers');
  ok(/X-Content-Type-Options: nosniff/.test(h) && /\/assets\/\*[\s\S]*immutable/.test(h), '_headers: security + asset caching');

  // AdSense wiring
  const cfgJs = read(dir, 'assets/js/config.js'), cfg = JSON.parse(cfgJs.replace(/^window\.CO_CONFIG=/, '').replace(/;\s*$/, ''));
  const expectAdPages = htmlFiles.filter((f) => /data-page="(home|premieres|show|day)"/.test(read(dir, f)));
  if (o.ads) {
    ok(cfg.ads.client === 'ca-' + PUB && cfg.ads.slots.side === '1111111111' && cfg.ads.slots.feed === '2222222222' && cfg.ads.slots.end === '3333333333', 'config.js carries publisher and slot ids');
    ok(files.includes('ads.txt') && read(dir, 'ads.txt').trim() === `google.com, ${PUB}, DIRECT, f08c47fec0942fa0`, 'ads.txt content');
    ok(expectAdPages.length >= 3 && expectAdPages.every((f) => adPages.includes(f)), 'AdSense script on every content page');
    ok(adPages.every((f) => expectAdPages.includes(f)), 'AdSense script only on content pages, found on: ' + adPages.filter((f) => !expectAdPages.includes(f)).join(', '));
    ok(htmlFiles.filter((f) => /data-page="(home|premieres|show|day)"/.test(read(dir, f))).every((f) => read(dir, f).includes(`<meta name="google-adsense-account" content="ca-${PUB}">`)), 'google-adsense-account meta on content pages');
    ok(/id="consent-link"/.test(read(dir, 'index.html')), 'footer has the privacy and cookie settings link');
    ok(/AdSense/.test(read(dir, 'privacy/index.html')), 'privacy page explains AdSense');
    ok(/data-ad="feed"/.test(read(dir, 'index.html')) === !!o.daily, 'in-feed slot placeholders only when there is a saved list to put them in');
  } else {
    ok(cfg.ads.client === '' && Object.values(cfg.ads.slots).every((v) => v === ''), 'config.js has no ad ids');
    ok(!files.includes('ads.txt'), 'no ads.txt without a publisher id');
    ok(adPages.length === 0 && !htmlFiles.some((f) => /adsbygoogle|data-ad=/.test(read(dir, f))), 'no ad code at all without a publisher id');
    ok(!/id="consent-link"/.test(read(dir, 'index.html')), 'no consent link without ads');
    ok(!/AdSense/.test(read(dir, 'privacy/index.html')), 'privacy page does not mention AdSense when there are no ads');
  }

  // e-mail addresses and local paths must not leak into the output
  const emails = new Set();
  for (const f of files.filter((x) => /\.(html|txt|xml|js|json)$/.test(x))) {
    const t = read(dir, f);
    for (const m of t.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) emails.add(m[0]);
    ok(!/\/home\/claude|\/tmp\/claude/.test(t) && !OWNER.test(t), f + ': contains a local path or personal data');
  }
  ok([...emails].every((e) => e === o.email), `unexpected e-mail addresses in output: ${[...emails].join(', ')}`);
  ok(read(dir, 'contact/index.html').includes(o.email), 'contact page shows the configured address');

  const size = files.filter((f) => !f.startsWith('assets/fonts/')).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  console.log(`  ${files.length} files, ${(size / 1024).toFixed(0)} KB without fonts, ${htmlFiles.length} pages`);
  ok(size < 1.5 * 1024 * 1024, 'unexpectedly large site');
}

/* ------------------------------------------------------------------ variants */
const A = path.join(TMP, 'compose'), B = path.join(TMP, 'daily'), C = path.join(TMP, 'daily-ads');
build(['--out', A]);
checkSite(A, 'compose only (no data fetch)', { siteUrl: 'https://example.com', email: 'hello@example.com', ads: false, daily: false });
ok(!fs.existsSync(path.join(A, 'day')), 'compose-only build has no /day/ folder');
ok(/Loading/.test(read(A, 'index.html')) && /aria-busy="true"/.test(read(A, 'index.html')), 'compose-only home page is the loading shell');

build(['--daily', ...FX, '--date', '2026-11-10', '--out', B]);
checkSite(B, 'daily snapshot, no ads', { siteUrl: 'https://example.com', email: 'hello@example.com', ads: false, daily: true });
{
  const home = read(B, 'index.html'), day = read(B, 'day/2026-11-10/index.html');
  ok(/<h1 id="h1">New TV episodes on Tuesday, November 10, 2026<\/h1>/.test(home), 'home: dated headline');
  ok(/id="snapshot"/.test(home) && /class="rail"/.test(home) && /id="side-picks"><h2>Picks of the day/.test(home), 'home: snapshot, rail and picks box are pre-rendered');
  ok(!/Estrellas|Das Haus/.test(home), 'non-English shows are left out');
  ok(!/Night Desk|Evening Report|Weekly Quiz/.test(home.replace(/<script[\s\S]*?<\/script>/g, '')), 'talk/news/game shows hidden by default');
  ok(/Nine Rooms/.test(home) && (home.match(/class="ep ep--pick"/g) || []).length >= 3, 'picks are rendered with briefs');
  const ld = JSON.parse(day.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  ok(ld['@type'] === 'ItemList' && ld.numberOfItems === ld.itemListElement.length && ld.numberOfItems >= 3, 'day page: ItemList JSON-LD');
  const snap = JSON.parse(home.match(/<script type="application\/json" id="snapshot">([\s\S]*?)<\/script>/)[1]);
  ok(snap.date === '2026-11-10' && snap.region === 'US' && snap.rows.length === 29 && new Set(snap.rows.map((r) => r.id)).size === 29, 'snapshot: 29 unique English episodes');
  ok(JSON.parse(read(B, 'day/index.json'))['2026-11-10'].count === 26, 'archive manifest counts the visible episodes');
  ok(/class="pday"/.test(read(B, 'premieres/index.html')) && /premiere in the next 14 days/.test(read(B, 'premieres/index.html')), 'premieres page is pre-rendered');
}
// next day: the archive keeps yesterday and links to it
build(['--daily', ...FX, '--date', '2026-11-11', '--out', B]);
{
  const man = JSON.parse(read(B, 'day/index.json'));
  ok(Object.keys(man).sort().join() === '2026-11-10,2026-11-11', 'archive keeps earlier days');
  ok(fs.existsSync(path.join(B, 'day/2026-11-10/index.html')), 'yesterday page survives the next build');
  ok(/href="\/day\/2026-11-10\/">Previous day/.test(read(B, 'day/2026-11-11/index.html')), 'previous-day link');
  const arch = read(B, 'day/index.html'), sm = read(B, 'sitemap.xml');
  ok(/2026-11-10/.test(arch) && /2026-11-11/.test(arch) && /\/day\/2026-11-10\//.test(sm) && /\/day\/2026-11-11\//.test(sm), 'archive page and sitemap list both days');
  ok(/class="foot-nav"[^>]*>[\s\S]*Daily archive/.test(read(B, 'about/index.html')), 'footer links to the archive');
  checkSite(B, 'daily snapshot after a second day', { siteUrl: 'https://example.com', email: 'hello@example.com', ads: false, daily: true });
}

// editor's note: escaped, shown on the front page and on the permanent day page, absent when there is no note file
{
  const notes = path.join(TMP, 'notes'); fs.mkdirSync(notes);
  fs.writeFileSync(path.join(notes, '2026-11-10.txt'), 'First <b>paragraph</b> & more.\n\nSecond one.\n');
  const N = path.join(TMP, 'daily-note');
  build(['--daily', ...FX, '--date', '2026-11-10', '--notes', notes, '--out', N]);
  const want = /<aside class="note" id="note" data-date="2026-11-10"><h2>Editor's note<\/h2><p>First &lt;b&gt;paragraph&lt;\/b&gt; &amp; more\.<\/p><p>Second one\.<\/p><\/aside>/;
  ok(want.test(read(N, 'index.html')), 'front page shows the editor\'s note, escaped');
  ok(want.test(read(N, 'day/2026-11-10/index.html')), 'day page shows the editor\'s note, escaped');
  ok(!/class="note"/.test(read(B, 'index.html')) && !/class="note"/.test(read(B, 'day/2026-11-10/index.html')), 'no note box without a note file');
}

build(['--daily', ...FX, '--date', '2026-11-10', '--config', adsConfig, '--out', C]);
checkSite(C, 'daily snapshot with AdSense configured', { siteUrl: 'https://tv.test.example', email: 'editor@test.example', ads: true, daily: true });

/* ------------------------------------------------------------------ build safety */
{
  const empty = path.join(TMP, 'empty-fixtures.mjs');
  fs.writeFileSync(empty, 'export const scheduleUS = () => []; export const webUS = () => []; export const webGlobal = () => [];\n');
  const before = fs.readFileSync(path.join(B, 'index.html'), 'utf8');
  const r = build(['--daily', '--fixtures', path.relative(ROOT, empty), '--date', '2026-11-12', '--out', B], { expectFail: true });
  ok(r.code === 1 && /Only 0 episodes/.test(r.out) && /nothing was changed/i.test(r.out), 'an empty day aborts the build with a clear message');
  ok(fs.readFileSync(path.join(B, 'index.html'), 'utf8') === before && !fs.existsSync(path.join(B, 'day/2026-11-12')), 'an aborted build leaves the previous site untouched');
  const notList = path.join(TMP, 'bad-fixtures.mjs');
  fs.writeFileSync(notList, 'export const scheduleUS = () => ({ error: "x" }); export const webUS = () => []; export const webGlobal = () => [];\n');
  const r2 = build(['--daily', '--fixtures', path.relative(ROOT, notList), '--date', '2026-11-12', '--out', B], { expectFail: true });
  ok(r2.code === 1 && /Unexpected response/.test(r2.out), 'an unexpected API shape aborts the build');
  const r3 = build(['--config', badConfig, '--out', path.join(TMP, 'x1')], { expectFail: true });
  ok(r3.code === 1 && /siteUrl must look like/.test(r3.out), 'a bad siteUrl is rejected');
  const r4 = build(['--config', junkAdsConfig, '--out', path.join(TMP, 'x2')]);
  ok(/publisherId should look like/.test(r4.out) && !/googlesyndication/.test(read(path.join(TMP, 'x2'), 'index.html')) && !fs.existsSync(path.join(TMP, 'x2/ads.txt')), 'a malformed publisher id keeps ads off');
}

/* ------------------------------------------------------------------ source conventions */
{
  const src = ['src/assets/js/render.js', 'src/assets/js/app.js', 'src/assets/js/ads.js', 'tools/build.mjs', ...walk(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs')).map((f) => 'tests/' + f)];
  for (const f of src) {
    try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); ok(true); } catch (e) { ok(false, `${f}: syntax error\n${e.stderr}`); }
  }
  for (const f of src.filter((x) => x.startsWith('src/'))) ok(!/touchstart|touchend|touchmove|ontouch/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ': click handlers only, no touch events');
  const css = fs.readFileSync(path.join(ROOT, 'src/assets/css/site.css'), 'utf8');
  ok(/touch-action:\s*manipulation/.test(css) && /color-scheme:\s*light/.test(css), 'css: touch-action manipulation, light color scheme');
  ok(/prefers-reduced-motion/.test(css), 'css: respects reduced motion');
  const all = [...walk(ROOT).filter((f) => !/^(\.tmp-test|node_modules|site)\//.test(f) && !/\.(woff2|png|zip)$/.test(f))];
  const leaks = all.filter((f) => OWNER.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok(leaks.length === 0, 'the owner e-mail address must not appear in the project: ' + leaks.join(', '));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nsite: ${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
