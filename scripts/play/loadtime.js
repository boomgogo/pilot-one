#!/usr/bin/env node
// Time to interactive (CLAUDE.md spec: 2–3 s, 4 s at most): dist/ served with brotli (as Cloudflare does), the cache
// off, network and CPU throttled through DevTools. "Interactive" is the game-ready mark: the Start button enabled.
//
//   node scripts/play/loadtime.js [--runs 3] [--no-build] [--dist path]
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const runs = +(argv.includes('--runs') ? argv[argv.indexOf('--runs') + 1] : 3);
const dist = argv.includes('--dist') ? resolve(argv[argv.indexOf('--dist') + 1]) : join(ROOT, 'dist');
if (!argv.includes('--no-build') && !argv.includes('--dist')) execSync('npx vite build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
const cache = new Map();
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dist, p);
  if (!f.startsWith(dist) || !existsSync(f) || statSync(f).isDirectory()) return res.writeHead(404).end();
  if (!cache.has(f)) cache.set(f, brotliCompressSync(readFileSync(f), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'content-encoding': 'br', 'cache-control': 'no-store' });
  res.end(cache.get(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist'] });
const profiles = [
  { name: '50 Mbps', down: 50e6, lat: 20, cpu: 1 },
  { name: '10 Mbps / 60 ms', down: 10e6, lat: 60, cpu: 1 },
  { name: '10 Mbps + 4× CPU', down: 10e6, lat: 60, cpu: 4 },
  { name: '1.6 Mbps / 150 ms + 4× CPU', down: 1.6e6, lat: 150, cpu: 4 },
];
const rows = [];
for (const pr of profiles) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: pr.lat, downloadThroughput: pr.down / 8, uploadThroughput: pr.down / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: pr.cpu });
    await page.goto(url);
    await page.waitForFunction(() => performance.getEntriesByName('game-ready').length > 0, null, { timeout: 60000 });
    times.push(await page.evaluate(() => performance.getEntriesByName('game-ready')[0].startTime / 1000));
    await page.close();
  }
  times.sort((a, b) => a - b);
  rows.push({ profile: pr.name, median: +times[Math.floor(times.length / 2)].toFixed(2), min: +times[0].toFixed(2), max: +times.at(-1).toFixed(2) });
}
console.table(rows);
await browser.close();
server.close();
