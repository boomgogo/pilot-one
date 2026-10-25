#!/usr/bin/env node
// Frame rate per stage on a throttled machine (ai/summary.md §11): real-time rendering on the GPU, the CPU slowed
// down 4× (Chrome DevTools throttling), the autopilot playing with ?god so every stage runs to its busiest part.
//
//   node scripts/play/perf.js [--q low] [--cpu 4] [--seconds 25] [--stages 1:5,2:4] [--size 1280x720] [--no-build]
// Prints, per location and stage: mean fps, the slowest 1-second window, draw calls and triangles at their peak.
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const q = arg('q', 'low');
const cpu = +arg('cpu', 4);
const seconds = +arg('seconds', 25);
const [W, H] = arg('size', '1280x720').split('x').map(Number);
// the busiest stage of each location by default
const stages = arg('stages', '1:7,2:5,3:6,4:2,5:7').split(',').map((x) => x.split(':').map(Number));
const dist = join(ROOT, 'dist');

if (!argv.includes('--no-build')) execSync('npx vite build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dist, p);
  if (!f.startsWith(dist) || !existsSync(f) || statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  createReadStream(f).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const rows = [];
for (const [loc, stage] of stages) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await page.goto(`${base}?q=${q}&loc=${loc}&stage=${stage}&god&autoplay&bot&debug`);
  await page.waitForFunction(() => window.__bg && window.__bg.game?.state === 'playing', null, { timeout: 60000 });
  // per-frame timing inside the page: rAF deltas, plus the renderer's counters at their peak
  const res = await page.evaluate(
    (secs) =>
      new Promise((done) => {
        const dts = [];
        let last = performance.now();
        let calls = 0;
        let tris = 0;
        const t0 = last;
        const step = (now) => {
          dts.push(now - last);
          last = now;
          const i = window.__bg.game.r.gl.info.render;
          calls = Math.max(calls, i.calls);
          tris = Math.max(tris, i.triangles);
          if (now - t0 < secs * 1000) requestAnimationFrame(step);
          else done({ dts, calls, tris, scale: window.__bg.game.r.res.scale, sec: window.__bg.game.stage.section.id });
        };
        requestAnimationFrame(step);
      }),
    seconds,
  );
  const dts = res.dts.slice(30);
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  let worst = 0;
  for (let i = 0, acc = 0, n = 0, j = 0; i < dts.length; i++) {
    acc += dts[i];
    n++;
    while (acc > 1000 && j < i) {
      worst = Math.max(worst, acc / n);
      acc -= dts[j++];
      n--;
    }
  }
  rows.push({ loc, stage, section: res.sec, fps: +(1000 / mean).toFixed(1), worst1s: worst ? +(1000 / worst).toFixed(1) : null, calls: res.calls, tris: res.tris, resScale: res.scale });
  await page.close();
}
console.log(`tier ${q}, CPU throttle ${cpu}×, ${W}×${H}`);
console.table(rows);
await browser.close();
server.close();
