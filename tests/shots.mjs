// Usage: node tests/shots.mjs <siteDir> <outDir> [name,name,...]
import path from 'node:path';
import fs from 'node:fs';
import { chromium, serve, openContext } from './lib.mjs';

const [siteDir, outDir, only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const srv = await serve(path.resolve(siteDir));
const browser = await chromium.launch();
const shots = [
  ['home-desktop', '/', { width: 1280, height: 900 }, false, false],
  ['home-desktop-full', '/', { width: 1280, height: 900 }, true, false],
  ['home-mobile', '/', { width: 390, height: 844 }, false, true],
  ['home-mobile-full', '/', { width: 390, height: 844 }, true, true],
  ['show-desktop', '/show/?id=7', { width: 1280, height: 900 }, true, false],
  ['show-mobile', '/show/?id=7', { width: 390, height: 844 }, false, true],
  ['premieres-desktop', '/premieres/', { width: 1280, height: 900 }, false, false],
  ['search-desktop', '/search/?q=moon', { width: 1280, height: 700 }, false, false],
  ['about-desktop', '/about/', { width: 1280, height: 800 }, false, false],
  ['notfound-desktop', '/nope/', { width: 1280, height: 800 }, false, false],
  ['adpreview-desktop', '/?adpreview=1', { width: 1280, height: 900 }, true, false]
].filter(([n]) => !only || only.split(',').includes(n));
for (const [name, url, viewport, full, mobile] of shots) {
  const { context, page, log } = await openContext(browser, { viewport, mobile });
  await page.goto(srv.url + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: full });
  console.log(name, 'errors:', log.errors.length ? log.errors : 'none', 'failed:', log.failed.length ? log.failed : 'none');
  await context.close();
}
await browser.close(); await srv.close();
