// Shared test helpers: a Cloudflare-Pages-like static server, a fake TVmaze, and a Playwright loader.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as F from './fixtures.mjs';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');
export { F };

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml' };

/** Serves a folder the way Cloudflare Pages does: /about/ -> about/index.html, unknown paths -> 404.html with status 404. */
export function serve(dir) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    let file = path.join(dir, p);
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (p.endsWith('/')) file = path.join(file, 'index.html');
    else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) { res.writeHead(308, { Location: p + '/' + u.search }); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    const nf = path.join(dir, '404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

const posterSvg = (seed) => {
  const hues = [222, 12, 160, 280, 42, 330]; const h = hues[Number(seed) % hues.length] || 222;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210" height="295" viewBox="0 0 210 295"><rect width="210" height="295" fill="hsl(${h} 38% 78%)"/><rect y="200" width="210" height="95" fill="hsl(${h} 45% 30%)"/><circle cx="105" cy="105" r="46" fill="hsl(${h} 50% 92%)"/></svg>`;
};

/** Fake TVmaze + posters. Returns a log of API calls and a way to inject failures. */
export async function installNetwork(context, opts = {}) {
  const calls = [];
  const state = { failures: opts.failures || [] }; // [{match: RegExp, status, times, headers}]
  await context.route('https://static.tvmaze.com/**', (route) => {
    const m = route.request().url().match(/\/(\d+)\//);
    route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: posterSvg(m ? m[1] : 1) });
  });
  await context.route(/googlesyndication|doubleclick|googleadservices|fundingchoices/, (route) => {
    calls.push('AD ' + route.request().url());
    route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.adsbygoogle=window.adsbygoogle||[];' });
  });
  await context.route('https://api.tvmaze.com/**', async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname + url.search;
    calls.push(key);
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    for (const f of state.failures) {
      if (f.match.test(key) && (f.times === undefined || f.times > 0)) {
        if (f.times !== undefined) f.times--;
        return route.fulfill({ status: f.status, headers: { ...cors, ...(f.headers || {}) }, body: '[]' });
      }
    }
    const q = url.searchParams, date = q.get('date'), country = q.get('country');
    const ok = (body) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify(body) });
    if (url.pathname === '/schedule') return ok(country === 'US' ? F.scheduleUS(date) : country === 'GB' ? F.scheduleGB(date) : []);
    if (url.pathname === '/schedule/web') return ok(country === 'US' ? F.webUS(date) : country === '' ? F.webGlobal(date) : []);
    let m = url.pathname.match(/^\/shows\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (!F.SHOWS[id]) return route.fulfill({ status: 404, headers: cors, body: '{}' });
      return ok(url.search.includes('nextepisode') ? F.showWithNext(id) : F.showFull(id));
    }
    if (url.pathname === '/search/shows') return ok(F.search(q.get('q') || ''));
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  return { calls, state };
}

/** A page with a fixed "now" that keeps ticking, a collected console log, and the fake network. */
export async function openContext(browser, { now = '2026-11-10T21:42:00-05:00', tz = 'Europe/Kyiv', locale = 'en-US', viewport = { width: 1280, height: 900 }, failures, mobile = false } = {}) {
  const context = await browser.newContext({ timezoneId: tz, locale, viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  const net = await installNetwork(context, { failures });
  const page = await context.newPage();
  const log = { errors: [], failed: [] };
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => log.failed.push(r.url() + ' ' + (r.failure() || {}).errorText));
  if (now) await page.clock.install({ time: new Date(now) });
  return { context, page, net, log };
}
