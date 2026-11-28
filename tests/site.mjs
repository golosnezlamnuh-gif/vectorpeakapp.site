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

function build(args, { expectFail = false, env = {} } = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', ...env } });
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
    'assets/js/app.js', 'assets/js/brief.js', 'assets/js/editor.js', 'assets/js/prompts.js', 'assets/img/favicon.svg', 'assets/fonts/archivo-latin-wdth-normal.woff2', 'assets/fonts/literata-latin-wght-normal.woff2']) ok(files.includes(need), `missing file ${need}`);
  for (const p of ['about', 'contact', 'how-it-works', 'privacy', 'terms', 'search', 'show', 'watchlist', 'premieres', 'editorial-policy', 'editor']) ok(files.includes(`${p}/index.html`), `missing page ${p}/`);
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

  // the editor's desk is private; the editorial policy is public and linked from every page
  ok(/<meta name="robots" content="noindex,nofollow">/.test(read(dir, 'editor/index.html')), 'editor desk: noindex,nofollow');
  ok(!htmlFiles.some((f) => f !== 'editor/index.html' && /href="\/editor\/?"/.test(read(dir, f))), 'nothing links to the editor desk');
  ok(htmlFiles.every((f) => /href="\/editorial-policy\/"/.test(read(dir, f))), 'every page links to the editorial policy');
  {
    const pj = read(dir, 'assets/js/prompts.js'), pm = pj.match(/^window\.CO_PROMPTS=(\{[\s\S]*?\});\nwindow\.CO_RULES=(\{[\s\S]*?\});\nwindow\.CO_GUIDES=(\[[\s\S]*\]);\n$/);
    let prompts = {}, rules = {}; try { prompts = JSON.parse(pm[1]); rules = JSON.parse(pm[2]); } catch { /* reported below */ }
    ok(['note', 'week', 'ideas', 'guide-outline', 'guide', 'factcheck', 'polish'].every((k) => typeof prompts[k] === 'string' && prompts[k].length > 400), 'prompts.js carries the seven prompt templates');
    ok(pm && Array.isArray(JSON.parse(pm[3])), 'prompts.js carries the list of published guides');
    ok(rules.placeholders && rules.placeholders.length >= 5 && rules.chatbot && rules.chatbot.length >= 5 && rules.placeholders.every((r) => { try { new RegExp(r[0], r[1]); return true; } catch { return false; } }), 'prompts.js carries the publishing rules as valid patterns');
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
  const expectAdPages = htmlFiles.filter((f) => /data-page="(home|premieres|show|day|guide)"/.test(read(dir, f)));
  if (o.ads) {
    ok(cfg.ads.client === 'ca-' + PUB && cfg.ads.slots.side === '1111111111' && cfg.ads.slots.feed === '2222222222' && cfg.ads.slots.end === '3333333333', 'config.js carries publisher and slot ids');
    ok(files.includes('ads.txt') && read(dir, 'ads.txt').trim() === `google.com, ${PUB}, DIRECT, f08c47fec0942fa0`, 'ads.txt content');
    ok(expectAdPages.length >= 3 && expectAdPages.every((f) => adPages.includes(f)), 'AdSense script on every content page');
    ok(adPages.every((f) => expectAdPages.includes(f)), 'AdSense script only on content pages, found on: ' + adPages.filter((f) => !expectAdPages.includes(f)).join(', '));
    ok(htmlFiles.filter((f) => /data-page="(home|premieres|show|day|guide)"/.test(read(dir, f))).every((f) => read(dir, f).includes(`<meta name="google-adsense-account" content="ca-${PUB}">`)), 'google-adsense-account meta on content pages');
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
build(['--out', A, '--date', '2026-11-10']);
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
// nothing published yet (the shipped guides are dated after this build date): no empty shells
{
  const home = read(B, 'index.html');
  ok(!/class="editorial"/.test(home) && !/href="\/guides\/"/.test(home) && !fs.existsSync(path.join(B, 'guides')) && !fs.existsSync(path.join(B, 'notes')) && !fs.existsSync(path.join(B, 'feed.xml')), 'no guides, notes or feed pages while nothing is published');
  ok(!/application\/atom\+xml/.test(home), 'no feed link while there is no feed');
  ok(/How we use AI/.test(read(B, 'editorial-policy/index.html')) && /edited by the Cold Open editor/.test(read(B, 'editorial-policy/index.html')), 'editorial policy: default text');
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


/* ------------------------------------------------------------------ guides, notes archive, feed, editorial block */
{
  const gdir = path.join(ROOT, 'content/guides');
  const mdFiles = fs.readdirSync(gdir).filter((f) => /\.md$/i.test(f) && !/^readme\.md$/i.test(f));
  const meta = mdFiles.map((f) => { const t = fs.readFileSync(path.join(gdir, f), 'utf8'); return { slug: f.replace(/\.md$/, ''), date: (t.match(/^date:\s*(\S+)/m) || [])[1], title: (t.match(/^title:\s*(.+)$/m) || [])[1] }; })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? -1 : 1));
  ok(mdFiles.length >= 9, 'at least nine guides ship with the project');

  const notes2 = path.join(TMP, 'notes2'); fs.mkdirSync(notes2);
  fs.writeFileSync(path.join(notes2, '2026-12-09.txt'), 'Hello & welcome <b>again</b>.\n\nSecond paragraph of the ninth.\n');
  fs.writeFileSync(path.join(notes2, '2026-12-10.txt'), 'Tonight: start with Nine Rooms.\n\nThen Midnight Ledger.\n');
  fs.writeFileSync(path.join(notes2, '2026-12-31.txt'), 'A note from the future.\n');
  fs.writeFileSync(path.join(notes2, '2026-12-08.txt'), 'Still has a marker [VERIFY: the time].\n');
  fs.writeFileSync(path.join(notes2, 'monday.txt'), 'Badly named.\n');

  const G = path.join(TMP, 'guides');
  const rg = build(['--daily', ...FX, '--date', '2026-12-10', '--notes', notes2, '--out', G], { env: { GITHUB_ACTIONS: 'true' } });
  checkSite(G, 'guides + notes + feed, no ads', { siteUrl: 'https://example.com', email: 'hello@example.com', ads: false, daily: true });
  ok(new RegExp(`content: ${mdFiles.length} guides published; 2 editor's notes`).test(rg.out), 'build log: all guides and two notes published');
  const guideLog = rg.out.split('\n').filter((l) => !/2026-12-08\.txt|monday\.txt|still the placeholder/.test(l)).join('\n');
  ok(!/NOT published|share \d+% of their wording|does not exist|on the short side|section heading|description is \d+ characters|header line ignored|unknown header|::warning::/.test(guideLog), 'the shipped guides produce no content warnings:\n' + guideLog);
  ok(/::warning::.*2026-12-08\.txt was NOT published/.test(rg.out) && /::warning::.*monday\.txt is ignored/.test(rg.out), 'GitHub Actions annotations are printed for held-back and misnamed files');
  const html = walk(G).filter((f) => f.endsWith('.html'));
  ok(fs.readdirSync(path.join(G, 'guides'), { withFileTypes: true }).filter((e) => e.isDirectory()).length === mdFiles.length, 'one page per guide');

  const idx = read(G, 'guides/index.html');
  ok((idx.match(/class="card-title"/g) || []).length === mdFiles.length && (idx.match(/<h2 id="cat-\d+">/g) || []).length >= 4, 'guides index: every guide listed under its category');
  ok(meta.every((m) => idx.includes(`href="/guides/${m.slug}/"`)), 'guides index links every guide');
  {
    const gm = read(G, 'assets/js/prompts.js').match(/\nwindow\.CO_GUIDES=(\[[\s\S]*\]);\n$/);
    let listed = []; try { listed = JSON.parse(gm[1]); } catch { /* reported below */ }
    ok(listed.length === mdFiles.length && meta.every((m, i) => listed[i] && listed[i].path === `/guides/${m.slug}/` && listed[i].title === m.title), 'prompts.js lists the published guides for the editor desk, newest first');
  }

  for (const m of meta) {
    const page = read(G, `guides/${m.slug}/index.html`), stripped = stripScripts(page);
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]), art = ld['@graph'][0], bc = ld['@graph'][1];
    ok(art['@type'] === 'Article' && art.wordCount >= 600 && art.datePublished === m.date && art.headline && art.description.length >= 70, `${m.slug}: Article JSON-LD with at least 600 words`);
    ok(bc['@type'] === 'BreadcrumbList' && bc.itemListElement.length === 3, `${m.slug}: breadcrumb JSON-LD`);
    ok(/<meta property="og:type" content="article">/.test(page) && new RegExp(`<meta property="article:published_time" content="${m.date}">`).test(page), `${m.slug}: article meta tags`);
    ok(/class="byline"/.test(stripped) && new RegExp(`<time datetime="${m.date}">`).test(stripped) && /class="crumbs"/.test(stripped), `${m.slug}: byline, date and breadcrumbs`);
    ok(/<nav class="toc"/.test(stripped) && /class="related"/.test(stripped) && /class="cta-box"/.test(stripped) && /id="article-end"/.test(stripped), `${m.slug}: contents list, related guides, call to action, ad anchor`);
    ok((stripped.match(/<h2[ >]/g) || []).length >= 6, `${m.slug}: has real sections`);
    ok(!/data-ad=|adsbygoogle/.test(page), `${m.slug}: no ad code without a publisher id`);
    ok(!/\[\w[^\]]*\]\(|\*\*|^#{1,3} /m.test(stripped.replace(/<pre[\s\S]*?<\/pre>/g, '')), `${m.slug}: no raw Markdown left in the page`);
  }
  const top3 = meta.slice(0, 3).map((m) => m.slug);
  for (const f of ['index.html', 'day/2026-12-10/index.html']) {
    const t = read(G, f), at = t.indexOf('class="editorial"');
    ok(at > 0 && top3.every((s, i) => t.indexOf(`href="/guides/${s}/"`, at) > 0 && (i === 0 || t.indexOf(`href="/guides/${s}/"`, at) > t.indexOf(`href="/guides/${top3[i - 1]}/"`, at))), `${f}: "From the editor" block lists the three newest guides, newest first`);
    ok(/href="\/guides\/">All guides/.test(t) && /href="\/notes\/">Editor's notes archive/.test(t), `${f}: links to the guides and the notes archive`);
  }
  ok(html.every((f) => /<nav class="nav"[^>]*>[^]*?href="\/guides\/"/.test(read(G, f))), 'every page has Guides in the main navigation');
  ok(html.every((f) => /<link rel="alternate" type="application\/atom\+xml"[^>]*href="\/feed\.xml">/.test(read(G, f))), 'every page advertises the feed');

  const nt = read(G, 'notes/index.html');
  ok(nt.indexOf('December 10, 2026') > 0 && nt.indexOf('December 10, 2026') < nt.indexOf('December 9, 2026'), 'notes archive: newest first');
  ok(/Hello &amp; welcome &lt;b&gt;again&lt;\/b&gt;\./.test(nt) && !/<b>/.test(nt), 'notes archive: text is escaped');
  ok(!/future/.test(nt) && !/VERIFY/.test(nt) && !/Badly named/.test(nt), 'notes archive: future, unfinished and misnamed notes stay out');
  ok(/<h2><a href="\/day\/2026-12-10\/">/.test(nt) && !/<h2><a href="\/day\/2026-12-09\/">/.test(nt), 'notes archive: links to a day page only when that page exists');
  ok(/data-date="2026-12-10"><h2>Editor's note<\/h2><p>Tonight: start with Nine Rooms\.<\/p>/.test(read(G, 'index.html')), 'front page shows the note of the day');

  const feed = read(G, 'feed.xml'), entries = feed.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  ok(/^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(feed) && feed.trimEnd().endsWith('</feed>'), 'feed: Atom envelope');
  ok(entries.length === Math.min(30, mdFiles.length + 2), 'feed: one entry per guide and note');
  ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(feed) && !/<(?!\/?(?:feed|title|subtitle|link|id|updated|entry|summary|author|name)[\s>/])[a-z]/i.test(feed.replace(/<\?xml[^>]*\?>/, '')), 'feed: escaped and only known elements');
  ok(entries.every((e) => /<title>[^<]+<\/title><link href="https:\/\/example\.com\/[^"]*"\/><id>[^<]+<\/id><updated>\d{4}-\d{2}-\d{2}T00:00:00Z<\/updated><summary>[^<]+<\/summary><author><name>Cold Open<\/name><\/author>/.test(e)), 'feed: every entry has title, link, id, date, summary, author');
  ok(/<updated>2026-12-10T00:00:00Z<\/updated>\n<entry>/.test(feed), 'feed: updated stamp is the newest entry');
  const sm = read(G, 'sitemap.xml');
  ok(meta.every((m) => sm.includes(`<loc>https://example.com/guides/${m.slug}/</loc>`)) && sm.includes('/guides/</loc>') && sm.includes('/notes/</loc>') && !/\/editor\//.test(sm), 'sitemap: every guide, the guides index and the notes archive; never the editor desk');
  ok(new RegExp(`<loc>https://example.com/guides/${meta[0].slug}/</loc>\\s*<lastmod>${meta[0].date}</lastmod>`).test(sm) && /\/notes\/<\/loc>\s*<lastmod>2026-12-10<\/lastmod>/.test(sm), 'sitemap: lastmod follows the content dates');

  // the same site with AdSense: guide pages carry the script and the account meta tag; the index pages do not
  const GA = path.join(TMP, 'guides-ads');
  build(['--daily', ...FX, '--date', '2026-12-10', '--notes', notes2, '--config', adsConfig, '--out', GA]);
  checkSite(GA, 'guides + notes + feed, with AdSense', { siteUrl: 'https://tv.test.example', email: 'editor@test.example', ads: true, daily: true });
  ok(!/googlesyndication/.test(read(GA, 'guides/index.html')) && !/googlesyndication/.test(read(GA, 'notes/index.html')) && !/googlesyndication/.test(read(GA, 'editorial-policy/index.html')), 'AdSense is not loaded on the guides index, the notes archive or the policy page');
  ok(/googlesyndication/.test(read(GA, `guides/${meta[0].slug}/index.html`)) && !/data-ad=/.test(read(GA, `guides/${meta[0].slug}/index.html`)), 'AdSense loads on a guide page, and the ad slot is only created by the script');
  ok(/Advertisement/.test(read(GA, 'editorial-policy/index.html')) && /Google AdSense/.test(read(GA, 'editorial-policy/index.html')), 'editorial policy mentions AdSense when ads are on');

  // named editor, bio, AI statement switched off
  const named = path.join(TMP, 'named.config.json');
  fs.writeFileSync(named, JSON.stringify({ siteUrl: 'https://tv.test.example', editorName: 'Alex Test', editorBio: 'Alex has watched too much television since 1999.', aiAssisted: false }));
  const NM = path.join(TMP, 'named');
  build(['--daily', ...FX, '--date', '2026-12-10', '--config', named, '--out', NM]);
  const pol = read(NM, 'editorial-policy/index.html'), ab = read(NM, 'about/index.html'), gp = read(NM, `guides/${meta[0].slug}/index.html`), nf = read(NM, 'feed.xml');
  ok(/edited by Alex Test\. Alex has watched too much television since 1999\./.test(pol) && /edited by Alex Test\. Alex has watched/.test(ab), 'policy and About show the editor name and bio');
  ok(!/How we use AI/.test(pol) && /Who writes it/.test(pol) && !/AI tools help/.test(ab), 'AI statement is removed when aiAssisted is false');
  ok(/By Alex Test\./.test(gp) && /"author":\{"@type":"Person","name":"Alex Test"\}/.test(gp) && /<author><name>Alex Test<\/name><\/author>/.test(nf), 'byline, JSON-LD and feed use the editor name');
  ok(/"author":\{"@type":"Organization","name":"Cold Open"/.test(read(G, `guides/${meta[0].slug}/index.html`)), 'a role such as "the Cold Open editor" is published as the organization, not as a person');
}

/* ------------------------------------------------------------------ content rules inside a real build */
{
  const gd = path.join(TMP, 'bad-guides'); fs.mkdirSync(gd);
  const words = (n, seed) => Array.from({ length: n }, (_, i) => `${seed}${(i * 7919) % 997}`).join(' ');
  const body = (seed, extra = '') => `Intro ${words(120, seed + 'a')}.\n\n## One\n\n${words(100, seed + 'b')}.\n\n## Two\n\n${words(100, seed + 'c')}. ${extra}\n\n## Three\n\n${words(100, seed + 'd')}.\n`;
  const head = (t, d, extra = '') => `---\ntitle: ${t}\ndescription: A description that is long enough to be useful in search results and in the feed, for the tests.\ndate: ${d}\n${extra}---\n\n`;
  fs.writeFileSync(path.join(gd, 'fine-guide.md'), head('A fine guide', '2026-11-01') + body('f', 'See [the other](/guides/second-guide/) and [soon](/guides/later-guide/).'));
  fs.writeFileSync(path.join(gd, 'second-guide.md'), head('A second guide', '2026-11-02') + body('s'));
  fs.writeFileSync(path.join(gd, 'later-guide.md'), head('A later guide', '2026-12-30') + body('l'));
  fs.writeFileSync(path.join(gd, 'unfinished.md'), head('Unfinished', '2026-11-03') + body('u', 'The date is [VERIFY: the date].'));
  fs.writeFileSync(path.join(gd, 'chatty.md'), head('Chatty', '2026-11-03') + body('c', 'I hope this helps!'));
  fs.writeFileSync(path.join(gd, 'tiny.md'), head('Tiny', '2026-11-03') + 'Just a few words.\n');
  fs.writeFileSync(path.join(gd, 'headless.md'), body('h'));
  fs.writeFileSync(path.join(gd, 'Bad Name.md'), head('Bad name', '2026-11-03') + body('b'));
  fs.writeFileSync(path.join(gd, 'draft-guide.md'), head('Draft guide', '2026-11-03', 'draft: true\n') + body('d2'));
  fs.writeFileSync(path.join(gd, 'README.md'), '# How to use this folder\n');
  const BG = path.join(TMP, 'bad-build');
  const r = build(['--daily', ...FX, '--date', '2026-11-10', '--guides', gd, '--out', BG], { env: { GITHUB_ACTIONS: 'true' } });
  ok(/content: 2 guides published, 1 scheduled for later, 1 draft, 5 held back \(see warnings\); 0 editor's notes/.test(r.out), 'build log counts published, scheduled, draft and held-back guides:\n' + r.out);
  ok(['unfinished', 'chatty', 'tiny', 'headless', 'Bad Name'].every((n) => new RegExp(`::warning::.*${n}\\.md was NOT published`).test(r.out)), 'every held-back guide is reported as a GitHub warning');
  ok(['fine-guide', 'second-guide'].every((n) => fs.existsSync(path.join(BG, 'guides', n, 'index.html'))) && ['later-guide', 'unfinished', 'chatty', 'tiny', 'headless', 'draft-guide', 'Bad Name'].every((n) => !fs.existsSync(path.join(BG, 'guides', n))), 'only the two good guides become pages');
  const fine = read(BG, 'guides/fine-guide/index.html');
  ok(/href="\/guides\/second-guide\/"/.test(fine) && !/href="\/guides\/later-guide\/"/.test(fine) && !/later-guide/.test(r.out), 'a link to a published guide works; a link to a scheduled guide is plain text and silent');
  const sm = read(BG, 'sitemap.xml');
  ok(!/later-guide|unfinished|chatty|tiny|headless|draft-guide/.test(sm) && /fine-guide/.test(sm), 'held-back guides are not in the sitemap');
  const idx = build(['--daily', ...FX, '--date', '2026-12-31', '--guides', gd, '--out', path.join(TMP, 'bad-build-later')]);
  ok(/content: 3 guides published/.test(idx.out) && fs.existsSync(path.join(TMP, 'bad-build-later/guides/later-guide/index.html')), 'a scheduled guide appears on its date');
  const none = build(['--daily', ...FX, '--date', '2026-11-10', '--guides', path.join(TMP, 'does-not-exist'), '--out', path.join(TMP, 'no-guides')]);
  ok(/content: 0 guides published; 0 editor's notes/.test(none.out) && !fs.existsSync(path.join(TMP, 'no-guides/guides')), 'a missing guides folder is fine');
}

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
  const src = ['src/assets/js/render.js', 'src/assets/js/app.js', 'src/assets/js/ads.js', 'src/assets/js/brief.js', 'src/assets/js/editor.js', 'tools/build.mjs', 'tools/md.mjs', 'tools/content.mjs', ...walk(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs')).map((f) => 'tests/' + f)];
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
