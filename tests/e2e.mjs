// Browser tests (Playwright + Chromium) against freshly built copies of the site and a fake TVmaze.
// Time is fixed to Tue 2026-11-10 21:42 US Eastern (= Wed 04:42 in Kyiv, the test visitor's zone) and keeps ticking.
// Run: node tests/e2e.mjs [name filter]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, serve, openContext } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.tmp-e2e');
const PUB = 'pub-1234567890123456';
const only = process.argv[2] || '';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function build(out, extra = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--out', out, ...extra], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
}
const FX = ['--daily', '--fixtures', 'tests/fixtures.mjs', '--date', '2026-11-10'];
const adsCfg = path.join(TMP, 'ads.json');
fs.writeFileSync(adsCfg, JSON.stringify({ siteUrl: 'https://tv.test.example', adsense: { publisherId: PUB, slots: { side: '1111111111', feed: '2222222222', end: '3333333333' } } }));
build(path.join(TMP, 'live'));                                  // no saved copy: the page loads from the (fake) API
build(path.join(TMP, 'daily'), FX);                             // saved copy of 2026-11-10
build(path.join(TMP, 'ads'), [...FX, '--config', adsCfg]);      // saved copy + AdSense ids
fs.mkdirSync(path.join(TMP, 'notes')); fs.writeFileSync(path.join(TMP, 'notes/2026-11-10.txt'), 'Start with Nine Rooms tonight.\n\nThen Midnight Ledger.\n');
build(path.join(TMP, 'note'), [...FX, '--notes', path.join(TMP, 'notes')]); // saved copy + an editor's note for that day

const servers = { live: await serve(path.join(TMP, 'live')), daily: await serve(path.join(TMP, 'daily')), ads: await serve(path.join(TMP, 'ads')), note: await serve(path.join(TMP, 'note')) };
const browser = await chromium.launch();

/* ------------------------------------------------------------------ helpers */
const ms = (iso) => Date.parse(iso);
const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
async function open(site, url, opts = {}) {
  const c = await openContext(browser, opts);
  if (opts.blockStorage) await c.context.addInitScript(() => { for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { get() { throw new DOMException('blocked', 'SecurityError'); } }); });
  if (opts.setup) await opts.setup(c);
  await c.page.goto(servers[site].url + url, { waitUntil: 'load' });
  return c;
}
const apiCalls = (net) => net.calls.filter((x) => x.startsWith('/'));
const text = (page, sel) => page.locator(sel).first().innerText();
const count = (page, sel) => page.locator(sel).count();
async function railReady(page, date) { await page.waitForFunction((d) => { const r = document.querySelector('#rail'); return r && (!d || r.dataset.date === d); }, date, { timeout: 20000 }); }
function noErrors(log, allow = []) { const e = log.errors.filter((x) => !allow.some((a) => a.test(x))); assert.deepEqual(e, [], 'console errors: ' + e.join(' | ')); assert.deepEqual(log.failed, [], 'failed requests'); }

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ------------------------------------------------------------------ home: the saved copy */
test('home: saved copy renders without any API call and without console errors', async () => {
  const { context, page, net, log } = await open('daily', '/');
  await railReady(page, '2026-11-10');
  assert.equal((await text(page, '#h1')), 'New TV episodes on Tuesday, November 10, 2026');
  assert.ok(await count(page, '#rail .slot') >= 8);
  assert.ok(await count(page, '#rail .ep--pick') >= 3);
  assert.equal(apiCalls(net).length, 0, 'the saved copy should not need the API: ' + apiCalls(net));
  assert.match(await text(page, '#side-picks'), /Picks of the day/);
  assert.ok(await count(page, '#side-picks li') >= 3);
  noErrors(log); await context.close();
});

test('home: times are converted to the visitor zone and the day label appears when the date changes', async () => {
  const { context, page } = await open('daily', '/');
  await railReady(page);
  const t22 = ms('2026-11-10T22:00:00-05:00'); // 05:00 on Wed in Kyiv
  const slot = page.locator(`.slot[data-t="${t22}"]`);
  assert.equal(await slot.locator('.slot-time time').innerText(), '5:00 AM');
  assert.equal(await slot.locator('.slot-time [data-tz]').innerText(), 'GMT+2');
  assert.equal(await slot.locator('.shift').innerText(), 'Wed');
  const t9 = ms('2026-11-10T09:00:00-05:00'); // 16:00 on Tue, same day: no label
  assert.equal(await page.locator(`.slot[data-t="${t9}"] .shift`).innerText(), '');
  assert.match(await text(page, '#side-picks'), /\(Wed\)/, 'picks box carries the weekday for times that land on Wednesday');
  assert.match(await text(page, '#dek'), /GMT\+2 \(Wed\)/);
  await context.close();
});

test('home: on-air status, NOW line and next-up bar follow the clock', async () => {
  const { context, page } = await open('daily', '/');
  await railReady(page);
  const live = page.locator('.ep[data-show="Midnight Ledger"]');
  assert.equal(await live.getAttribute('data-status'), 'live');
  assert.match(await text(page, '#nextbar-in .lt-tab'), /On air now/);
  assert.equal(await text(page, '#nextbar-in .lt-title'), 'Midnight Ledger');
  const t22 = ms('2026-11-10T22:00:00-05:00');
  assert.equal(await page.locator('#now').evaluate((n) => +n.nextElementSibling.dataset.t), t22, 'NOW line sits before the 22:00 group');
  assert.match(await text(page, '#now'), /^Now 4:4\d AM$/);
  await page.clock.runFor(20 * 60 * 1000); // 22:02 Eastern
  await page.waitForFunction(() => document.querySelector('.ep[data-show="Midnight Ledger"]').dataset.status === 'done', null, { timeout: 5000 });
  assert.equal(await page.locator('.ep[data-show="Salt & Ash"]').getAttribute('data-status'), 'live');
  assert.equal(await text(page, '#nextbar-in .lt-title'), 'Salt & Ash');
  assert.equal(await page.locator('#now').evaluate((n) => +n.nextElementSibling.dataset.t), ms('2026-11-10T23:30:00-05:00'));
  await context.close();
});

test('home: switching the day loads that day and keeps the URL in sync', async () => {
  const { context, page, net, log } = await open('daily', '/');
  await railReady(page);
  await page.click('#dates [data-date="2026-11-11"]');
  await railReady(page, '2026-11-11');
  assert.equal(await text(page, '#h1'), 'New TV episodes on Wednesday, November 11, 2026');
  assert.ok(apiCalls(net).some((c) => c.startsWith('/schedule?country=US&date=2026-11-11')));
  assert.ok(apiCalls(net).some((c) => c.startsWith('/schedule/web?date=2026-11-11&country=US')));
  assert.ok(apiCalls(net).some((c) => c.startsWith('/schedule/web?date=2026-11-11&country=')));
  assert.equal(await page.locator('#dates .date[aria-pressed="true"]').getAttribute('data-date'), '2026-11-11');
  assert.match(page.url(), /\?d=2026-11-11$/);
  assert.ok(await count(page, '#rail .ep') >= 15);
  assert.equal(await count(page, '#now'), 0, 'no NOW line on a future day');
  await page.click('#dates [data-date="2026-11-10"]');
  await railReady(page, '2026-11-10');
  assert.ok(!/\?/.test(page.url()), 'today needs no query string');
  noErrors(log); await context.close();
});

test('home: region switch loads that region, is remembered, and survives a reload', async () => {
  const { context, page, net, log } = await open('daily', '/');
  await railReady(page);
  await page.click('#region [data-region="GB"]');
  await page.waitForFunction(() => document.querySelector('#rail')?.dataset.region === 'GB', null, { timeout: 20000 });
  assert.ok(apiCalls(net).some((c) => c.startsWith('/schedule?country=GB&date=')));
  assert.match(await text(page, '#feed'), /Tide Warning/);
  assert.match(page.url(), /r=GB/);
  assert.equal(await page.evaluate(() => localStorage.getItem('co.region')), '"GB"');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#rail')?.dataset.region === 'GB', null, { timeout: 20000 });
  assert.equal(await page.locator('#region [data-region="GB"]').getAttribute('aria-pressed'), 'true');
  noErrors(log); await context.close();
});

test('home: filters, counts and the talk-show switch', async () => {
  const { context, page } = await open('daily', '/');
  await railReady(page);
  const chip = (re) => page.locator('#chips .chip', { hasText: re });
  const all = await count(page, '#rail .ep');
  assert.equal(all, 26);
  assert.ok(!/Night Desk/.test(await text(page, '#feed')), 'talk shows hidden by default');
  await chip(/^Premieres/).click();
  const prem = await count(page, '#rail .ep');
  assert.equal(prem, 7);
  assert.equal(await page.locator('#rail .ep .flag:not(.flag--plain)').count(), 7);
  assert.equal(await count(page, '.ad-slot'), 0);
  await chip(/^Streaming/).click();
  assert.equal(await count(page, '#rail .ep'), 9);
  await chip(/^Comedy/).click();
  assert.ok(await count(page, '#rail .ep') > 0);
  await chip(/^Comedy/).click(); // toggles off
  await chip(/^All/).click();
  assert.equal(await count(page, '#rail .ep'), 26);
  await page.check('#chatter');
  assert.equal(await count(page, '#rail .ep'), 29);
  assert.ok(/Night Desk/.test(await text(page, '#feed')) && /Evening Report/.test(await text(page, '#feed')), 'talk and news show up when asked for');
  await page.uncheck('#chatter');
  assert.equal(await count(page, '#rail .ep'), 26);
  await context.close();
});

test('home: live path (no saved copy) shows a loading state, then the list; talk shows are filtered out; duplicates removed', async () => {
  const { context, page, net, log } = await open('live', '/');
  await railReady(page, '2026-11-10');
  assert.equal(apiCalls(net).filter((c) => c.startsWith('/schedule')).length, 3);
  assert.equal(await count(page, '#rail .ep'), 26);
  assert.equal(await count(page, '.ep[data-show="Harbor Lights"]'), 1);
  assert.equal(await count(page, '.ep[data-show="Das Haus"], .ep[data-show="Estrellas del Norte"]'), 0, 'English only');
  assert.equal(await page.locator('#feed').getAttribute('aria-busy'), null);
  noErrors(log); await context.close();
});

test("editor's note: shown with the saved day, kept while filtering, gone on other days", async () => {
  const { context, page, log } = await open('note', '/');
  await railReady(page, '2026-11-10');
  assert.match(await text(page, '#note'), /Editor's note[\s\S]*Start with Nine Rooms tonight\.[\s\S]*Then Midnight Ledger\./);
  await page.locator('#chips .chip', { hasText: /^Premieres/ }).click();
  assert.equal(await count(page, '#note'), 1, 'filters keep the note');
  await page.click('#dates [data-date="2026-11-11"]');
  await railReady(page, '2026-11-11');
  assert.equal(await count(page, '#note'), 0, 'another day has no note');
  noErrors(log); await context.close();
});

/* ------------------------------------------------------------------ follow, calendar, my shows */
test('follow: button, toast, sidebar box, my shows page, unfollow', async () => {
  const { context, page, log } = await open('daily', '/');
  await railReady(page);
  const btn = page.locator('.ep--pick[data-show="Midnight Ledger"] [data-follow]');
  assert.equal(await btn.getAttribute('aria-pressed'), 'false');
  await btn.click();
  assert.equal(await btn.getAttribute('aria-pressed'), 'true');
  assert.match(await text(page, '#toast'), /Following Midnight Ledger/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('co.follows'))[0].id), 7);
  await page.waitForFunction(() => /S02E07/.test(document.querySelector('#side-follow')?.innerText || ''), null, { timeout: 10000 });
  assert.match(await text(page, '#side-follow'), /Your next episodes/);
  // the compact rows have icon-only buttons with a tooltip that names the action
  const icon = page.locator('.ep--line[data-show="Harbor Lights"] [data-follow]');
  assert.equal(await icon.getAttribute('title'), 'Follow Harbor Lights');
  await icon.click();
  assert.equal(await icon.getAttribute('title'), 'Unfollow Harbor Lights');
  await icon.click();
  assert.equal(await icon.getAttribute('title'), 'Follow Harbor Lights');
  await page.goto(servers.daily.url + '/watchlist/');
  await page.waitForFunction(() => /S02E07/.test(document.querySelector('#wl-list')?.innerText || ''), null, { timeout: 10000 });
  assert.match(await text(page, '#wl-list'), /Midnight Ledger/);
  assert.equal(await page.locator('#wl-tools').isVisible(), true);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wl-ics')]);
  assert.equal(dl.suggestedFilename(), 'my-shows.ics');
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /SUMMARY:Midnight Ledger S02E07/); assert.match(ics, /END:VCALENDAR\r\n$/);
  await page.click('#wl-list [data-follow]');
  await page.waitForSelector('text=You are not following any shows yet');
  assert.equal(await page.evaluate(() => localStorage.getItem('co.follows')), '[]');
  noErrors(log); await context.close();
});

test('calendar: add-to-calendar downloads a valid .ics for that episode', async () => {
  const { context, page } = await open('daily', '/');
  await railReady(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.ep--pick[data-show="Salt & Ash"] [data-ics]')]);
  assert.equal(dl.suggestedFilename(), 'salt-ash-s04e01.ics');
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(ics, /DTSTART:20261111T030000Z\r\n/);   // 22:00 EST
  assert.match(ics, /DTEND:20261111T035800Z\r\n/);     // + 58 minutes
  assert.match(ics, /SUMMARY:Salt & Ash S04E01 \(FX\)\r\n/);
  assert.match(ics, /DESCRIPTION:Episode: Embers\r\n/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines folded at 75 bytes');
  await context.close();
});

test('storage blocked: the site still works and says why Follow cannot save', async () => {
  const { context, page, log } = await open('daily', '/', { blockStorage: true });
  await railReady(page);
  await page.click('.ep--pick [data-follow]');
  assert.match(await text(page, '#toast'), /blocking storage/);
  noErrors(log); await context.close();
});

/* ------------------------------------------------------------------ show page, search, premieres, 404 */
test('show page: next episode, progress, cast, episode guide, follow', async () => {
  const { context, page, log } = await open('daily', '/show/?id=7');
  await page.waitForSelector('.show-title');
  assert.equal(await text(page, '.show-title'), 'Midnight Ledger');
  assert.match(await page.title(), /^Midnight Ledger: next episode/);
  assert.match(await text(page, '.nextep'), /Next episode[\s\S]*S02E06/);
  assert.match(await text(page, '.show-body'), /5 of 10 episodes have aired/);
  assert.equal(await count(page, '.cast li'), 4);
  assert.equal(await count(page, 'details.season'), 2);
  assert.equal(await page.locator('details.season').first().getAttribute('open'), '');
  assert.equal(await count(page, '.eplist .is-next'), 1);
  await page.click('.show-main [data-follow]');
  assert.equal(await page.locator('.show-main [data-follow]').getAttribute('aria-pressed'), 'true');
  assert.match(await text(page, '.show-main [data-follow]'), /Following/);
  noErrors(log); await context.close();
});

test('show page: bad or unknown ids show a helpful message', async () => {
  for (const [q, re] of [['?id=abc', /We could not find that/], ['', /We could not find that/], ['?id=999999', /We could not find that/]]) {
    const { context, page } = await open('daily', '/show/' + q);
    await page.waitForSelector('.state');
    assert.match(await text(page, '.state'), re);
    assert.equal(await count(page, '.state a[href="/search/"]'), 1);
    await context.close();
  }
});

test('search: results, short query, no match, errors', async () => {
  const { context, page, net, log } = await open('daily', '/search/?q=moon');
  await page.waitForSelector('#results .res');
  assert.equal(await count(page, '#results .res li'), 1);
  assert.match(await text(page, '#results .res-name'), /Paper Moons/);
  await page.fill('#q', 'a'); await page.press('#q', 'Enter');
  assert.match(await text(page, '#results'), /at least two letters/);
  await page.fill('#q', 'zzzz'); await page.press('#q', 'Enter');
  await page.waitForSelector('#results .state');
  assert.match(await text(page, '#results'), /No shows found for "zzzz"/);
  await page.fill('#q', 'salt'); // typing alone searches after a short pause
  await page.waitForSelector('#results .res', { timeout: 5000 });
  assert.match(await text(page, '#results .res-name'), /Salt & Ash/);
  assert.match(page.url(), /\?q=salt$/);
  const searches = apiCalls(net).filter((c) => c.startsWith('/search/shows'));
  assert.ok(searches.length >= 3 && searches.length <= 4, 'debounced: ' + searches.join(' '));
  noErrors(log); await context.close();
});

test('premieres: saved copy, filters, region switch, load more', async () => {
  const { context, page, net, log } = await open('daily', '/premieres/');
  await page.waitForSelector('.pday');
  assert.match(await text(page, '#prem-dek, .dek'), /3 new series and 4 returning seasons/);
  const today = () => page.locator('.pday').first();   // the fixtures repeat some premieres every day, so look at the first day only
  assert.match(await today().locator('.pday-h').innerText(), /Tuesday, November 10, 2026/);
  assert.equal(await today().locator('.ep--pick').count(), 7);
  await page.click('#chips [data-kind="series"]');
  assert.equal(await today().locator('.ep--pick').count(), 3);
  assert.equal(await today().locator('.flag', { hasText: 'Series premiere' }).count(), 3);
  await page.click('#chips [data-kind="all"]');
  assert.equal(apiCalls(net).length, 0, 'the saved copy covers the first 14 days');
  await page.click('#prem-more');
  await page.waitForFunction(() => document.querySelector('#prem-status')?.textContent === '' && !document.querySelector('#prem-more').hidden, null, { timeout: 30000 });
  assert.ok(apiCalls(net).some((c) => c.includes('date=2026-11-25')), 'load more fetches days 15 to 21');
  await page.click('#region [data-region="GB"]');
  await page.waitForFunction(() => /Tide Warning/.test(document.querySelector('#prem-list')?.innerText || '') || /No premieres/.test(document.querySelector('#prem-list')?.innerText || ''), null, { timeout: 30000 });
  noErrors(log); await context.close();
});

test('404: unknown addresses get the not-found page with a 404 status', async () => {
  const c = await openContext(browser);
  const res = await c.page.goto(servers.daily.url + '/no/such/page/');
  assert.equal(res.status(), 404);
  assert.match(await text(c.page, '.state h2'), /off the air/);
  assert.equal(await count(c.page, '.testcard .bars'), 1);
  assert.equal(await c.page.locator('meta[name=robots]').getAttribute('content'), 'noindex,nofollow');
  await c.context.close();
});

/* ------------------------------------------------------------------ failure handling */
test('API: a 429 with Retry-After is retried and then succeeds', async () => {
  const failures = [{ match: /^\/schedule\?country=US&date=2026-11-10/, status: 429, times: 1, headers: { 'retry-after': '1' } }];
  const { context, page, net, log } = await open('live', '/', { failures });
  await railReady(page, '2026-11-10');
  assert.equal(apiCalls(net).filter((c) => c.startsWith('/schedule?country=US')).length, 2);
  assert.equal(await count(page, '#rail .ep'), 26);
  noErrors(log, [/429/]); await context.close();
});

test('API: when TV listings fail, streaming is shown and the notice names the missing side', async () => {
  const failures = [{ match: /^\/schedule\?country=US/, status: 500 }];
  const { context, page } = await open('live', '/', { failures });
  await railReady(page, '2026-11-10');
  await page.waitForFunction(() => /TV network listings are unavailable/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 30000 });
  assert.ok(await count(page, '#rail .ep') > 3);
  assert.equal(await count(page, '.ep[data-show="The Long Shift"]'), 0, 'TV-only shows are missing');
  await context.close();
});

test('API: when everything fails the page explains it and Try again recovers', async () => {
  const failures = [{ match: /^\/schedule/, status: 500, times: 12 }]; // 3 requests x (1 try + 3 retries) = 12 attempts, all of them fail
  const { context, page } = await open('live', '/', { failures });
  await page.waitForSelector('#feed .state', { timeout: 40000 });
  assert.match(await text(page, '#feed .state'), /(could not reach|Something went wrong|busy)/);
  assert.equal(await count(page, '.ad-slot'), 0);
  await page.click('#retry');
  await railReady(page, '2026-11-10');
  assert.ok(await count(page, '#rail .ep') > 0);
  await context.close();
});

test('empty day: friendly message, no ad slots', async () => {
  const failures = [{ match: /date=2026-11-14/, status: 200 }]; // every endpoint answers [] for that date
  const { context, page } = await open('ads', '/', { failures });
  await railReady(page);
  await page.click('#dates [data-date="2026-11-14"]');
  await page.waitForSelector('#feed .state');
  assert.match(await text(page, '#feed .state'), /Nothing matches|No new episodes listed for this day/);
  assert.equal(await count(page, '.ad-slot'), 0);
  await context.close();
});

/* ------------------------------------------------------------------ advertising */
test('ads off: no ad code, no ad requests, no slots, even with ?adpreview unset', async () => {
  const { context, page, net } = await open('daily', '/');
  await railReady(page);
  assert.equal(await count(page, '.ad-slot, ins.adsbygoogle, script[src*=googlesyndication]'), 0);
  assert.equal(net.calls.filter((c) => c.startsWith('AD')).length, 0);
  await context.close();
});

test('ads preview: ?adpreview=1 shows labelled placeholders where slots will go', async () => {
  const { context, page, net } = await open('daily', '/?adpreview=1');
  await railReady(page);
  await page.waitForSelector('.ad-slot.is-preview');
  assert.ok(await count(page, '.ad-side.is-preview') === 1 && await count(page, '.ad-feed.is-preview') >= 1);
  assert.equal(await page.locator('.ad-slot .ad-label').first().innerText(), 'Advertisement');
  assert.equal(net.calls.filter((c) => c.startsWith('AD')).length, 0);
  await context.close();
});

test('ads on: slots are created with the configured ids, labelled, limited, and only on content pages', async () => {
  const { context, page, net, log } = await open('ads', '/');
  await railReady(page, '2026-11-10');
  await page.waitForSelector('ins.adsbygoogle');
  assert.ok(net.calls.some((c) => /^AD https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-1234567890123456/.test(c)));
  assert.equal(await page.locator('.ad-side ins').getAttribute('data-ad-slot'), '1111111111');
  assert.equal(await page.locator('.ad-side ins').getAttribute('data-ad-client'), 'ca-' + PUB);
  const feed = await count(page, '.ad-feed ins[data-ad-slot="2222222222"]');
  assert.ok(feed >= 1 && feed <= 3, 'in-feed slots: ' + feed);
  assert.equal(await count(page, '.ad-slot .ad-label'), feed + 1);
  assert.equal(await page.locator('#rail > .ad-feed').first().evaluate((n) => !!n.previousElementSibling && !!n.nextElementSibling), true, 'in-feed ads sit between time groups');
  assert.equal(await page.evaluate(() => window.adsbygoogle.length), feed + 1, 'each slot is pushed once');
  const pushed = await page.evaluate(() => window.adsbygoogle.length);
  await page.locator('#chips .chip', { hasText: /^Premieres/ }).click();
  assert.equal(await count(page, '.ad-feed'), 0, 'filters remove in-feed ads instead of refreshing them');
  assert.equal(await page.evaluate(() => window.adsbygoogle.length), pushed, 'no extra ad requests when filtering');
  noErrors(log);
  for (const url of ['/about/', '/privacy/', '/terms/', '/contact/', '/how-it-works/', '/search/', '/watchlist/', '/nope/']) {
    await page.goto(servers.ads.url + url);
    assert.equal(await count(page, '.ad-slot, ins.adsbygoogle, script[src*=googlesyndication]'), 0, 'no ads on ' + url);
  }
  await page.goto(servers.ads.url + '/show/?id=7');
  await page.waitForSelector('.show-title');
  assert.equal(await page.locator('.ad-slot[data-ad="end"] ins').getAttribute('data-ad-slot'), '3333333333');
  await context.close();
});

/* ------------------------------------------------------------------ security */
test('XSS: hostile titles, summaries, networks and image URLs from the API stay inert', async () => {
  const evil = {
    id: 666, name: '<img src=x onerror="window.__xss=1">', season: 1, number: 1, type: 'regular', airdate: '2026-11-10', airtime: '21:30', airstamp: '2026-11-10T21:30:00-05:00', runtime: 30,
    summary: '<script>window.__xss=2</script><p onclick="window.__xss=3">hi</p>', rating: { average: null }, image: { medium: 'javascript:window.__xss=4' },
    show: { id: 6660, name: '"><svg onload="window.__xss=5">', type: 'Scripted', language: 'English', genres: ['"><b onmouseover=window.__xss=6>'], weight: 99, rating: { average: 9 },
      network: { id: 1, name: '</span><img src=x onerror=window.__xss=7>', country: { code: 'US' } }, image: { medium: 'javascript:window.__xss=8' }, summary: '<img src=x onerror=window.__xss=9>' }
  };
  const { context, page } = await open('live', '/', {
    setup: async ({ context }) => {
      await context.route(/api\.tvmaze\.com\/schedule\?country=US/, (r) => r.fulfill({ status: 200, headers: CORS, body: JSON.stringify([evil]) }));
      await context.addInitScript(() => { localStorage.setItem('co.follows', JSON.stringify([{ id: 666, name: '<img src=x onerror=window.__xss=10>', img: 'javascript:window.__xss=11' }])); });
    }
  });
  await railReady(page);
  await page.waitForFunction(() => document.querySelector('#side-follow li'), null, { timeout: 10000 });
  assert.match(await text(page, '#feed'), /<img src=x onerror="window\.__xss=1">|svg onload/, 'shown as text');
  await page.goto(servers.live.url + '/watchlist/');
  await page.waitForSelector('#wl-list');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await count(page, 'img[src^="javascript"], svg[onload], img[onerror]'), 0);
  await context.close();
});

/* ------------------------------------------------------------------ layout, accessibility, motion */
test('layout: no sideways scrolling and nameless controls on any page at phone, tablet and desktop widths', async () => {
  const pages = ['/', '/premieres/', '/show/?id=7', '/search/?q=moon', '/watchlist/', '/about/', '/how-it-works/', '/privacy/', '/terms/', '/contact/', '/no/such/', '/day/', '/day/2026-11-10/'];
  for (const width of [320, 390, 768, 1024, 1280]) {
    const { context, page } = await open('daily', '/', { viewport: { width, height: 800 }, mobile: width < 700 });
    for (const url of pages) {
      await page.goto(servers.daily.url + url, { waitUntil: 'load' });
      await page.waitForTimeout(url === '/' || url.includes('show') || url.includes('search') ? 700 : 100);
      const r = await page.evaluate(() => ({
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        nameless: [...document.querySelectorAll('button, a[href], input, select')].filter((el) => !(el.innerText || '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('title') && !(el.labels && el.labels.length) && !el.querySelector('img[alt]:not([alt=""])') && el.type !== 'hidden' && !el.closest('[aria-hidden="true"]') && el.tabIndex >= 0).map((el) => el.outerHTML.slice(0, 80)),
        noAlt: [...document.querySelectorAll('img:not([alt])')].length
      }));
      assert.ok(r.over <= 0, `${url} at ${width}px scrolls sideways by ${r.over}px`);
      assert.deepEqual(r.nameless, [], `${url}: controls without a name`);
      assert.equal(r.noAlt, 0, `${url}: images without alt`);
    }
    await context.close();
  }
});

test('keyboard: skip link works and focus is visible', async () => {
  const { context, page } = await open('daily', '/');
  await railReady(page);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => location.hash), '#main');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
  await context.close();
});

test('motion: reduced-motion visitors get no animation', async () => {
  for (const [mode, expectAnim] of [['no-preference', true], ['reduce', false]]) {
    const c = await openContext(browser);
    await c.page.emulateMedia({ reducedMotion: mode });
    await c.page.goto(servers.daily.url + '/');
    await railReady(c.page);
    const anim = await c.page.evaluate(() => getComputedStyle(document.querySelector('.lt-tab')).animationName);
    assert.equal(anim !== 'none', expectAnim, `${mode}: animation-name=${anim}`);
    await c.context.close();
  }
});

/* ------------------------------------------------------------------ run */
let failed = 0;
for (const [name, fn] of tests.filter(([n]) => n.includes(only))) {
  const t0 = Date.now();
  try { await fn(); console.log(`ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e.stack || e).split('\n').slice(0, 6).join('\n      ')}`); }
}
await browser.close();
for (const s of Object.values(servers)) await s.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ne2e: ${tests.filter(([n]) => n.includes(only)).length - failed}/${tests.filter(([n]) => n.includes(only)).length} passed`);
process.exit(failed ? 1 : 0);
