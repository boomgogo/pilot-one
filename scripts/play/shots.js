#!/usr/bin/env node
// Screenshots at chosen game times, played by the bot (for checking a location's look and its transitions).
//
//   node scripts/play/shots.js [--loc 2] [--section id:seconds] [--at 3,8,20] [--out dir] [--q medium] [--size 1280x720]
//                              [--dpr 1] [--params god,k=v] [--angle gl] [--skill average] [--no-build] [--stats]
//
// Serves dist/, plays with ?bot&capture (stepped frames), and saves <out>/<loc>-<t>.jpg at each time in --at
// (seconds after Start). With --stats each shot also prints draw calls, triangles and the frame's CPU time.
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const a = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
}
const loc = +(a.loc || 1);
const times = String(a.at || '3').split(',').map(Number);
const out = resolve(a.out || join(ROOT, 'recordings/shots'));
const [W, H] = String(a.size || '1280x720').split('x').map(Number);
const dist = join(ROOT, 'dist');

if (!a['no-build']) execSync('npx vite build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
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
const params = new URLSearchParams({ bot: '', capture: '', q: a.q || 'medium' });
if (loc > 1) params.set('loc', String(loc));
if (a.section) params.set('t', a.section);
if (a.stats) params.set('debug', '');
for (const kv of String(a.params || '').split(',').filter(Boolean)) {
  const [k, v = ''] = kv.split('=');
  params.set(k, v);
}
const url = `http://127.0.0.1:${server.address().port}/?${params.toString().replace(/=(&|$)/g, '$1')}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !a.headed,
  args: [`--use-angle=${a.angle || 'gl'}`, '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +(a.dpr || 1) });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__bg && window.__bg.game, null, { timeout: 30000 });
await page.addScriptTag({ path: join(ROOT, 'scripts/play/bot.js') });
await page.evaluate((o) => window.__bot.create(o), { skill: a.skill || 'average', seed: 1, useMarkers: true });
await page.click('#start-btn');
mkdirSync(out, { recursive: true });
const t0 = await page.evaluate(() => window.__bg.game.time);
for (const t of times.sort((x, y) => x - y)) {
  for (;;) {
    const s = await page.evaluate(
      ({ t0, t }) => {
        for (let i = 0; i < 30; i++) {
          if (window.__bg.game.time - t0 >= t) break;
          window.__bot.tick();
          const st = window.__bg.advance(1);
          if (st === 'paused') window.__bg.ui.resume();
          if (st !== 'playing' && st !== 'paused') return st;
        }
        return window.__bg.game.time - t0 >= t ? 'at' : 'go';
      },
      { t0, t },
    );
    if (s === 'at') break;
    if (s === 'over') await page.evaluate(() => window.__bg.ui.cont());
    else if (s === 'locclear') {
      // the between-location screens: location clear, star map, then the jump into the next location. Their
      // tallies run on the game clock in ?capture (src/ui/screens.js), so they get game frames, not wall time
      const hold = (n) => page.evaluate((n) => window.__bg.advance(n), n);
      await hold(150);
      await page.screenshot({ path: join(out, `${loc}-clear.jpg`), type: 'jpeg', quality: 85 });
      const st = await page.evaluate(() => (window.__bg.ui.map(), window.__bg.game.state));
      if (st === 'ended') {
        await hold(150);
        await page.screenshot({ path: join(out, `${loc}-ending.jpg`), type: 'jpeg', quality: 85 });
        break;
      }
      await page.waitForFunction(() => !document.getElementById('launch-btn').disabled, null, { timeout: 30000 });
      await hold(132);
      await page.screenshot({ path: join(out, `${loc}-map.jpg`), type: 'jpeg', quality: 85 });
      await page.evaluate(() => window.__bg.ui.launch());
      console.log('  launched into the next location');
    } else if (s !== 'go') break;
  }
  await page.evaluate(() => window.__bg.advance(1));
  const file = join(out, `${loc}-${String(t).padStart(4, '0')}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
  const info = await page.evaluate(() => {
    const g = window.__bg.game;
    const i = g.r.gl.info.render;
    return {
      state: g.state, sec: g.stage.section.id, calls: i.calls, tris: i.triangles, cpu: g.cpu?.toFixed(2),
      hulks: g.hulks.list.map((h) => h.w.hulk + '@' + h.pos.toArray().map(Math.round)), boss: g.boss?.active ? g.boss.state : '',
    };
  });
  console.log(file, JSON.stringify(info));
  if (a.eval) console.log('  eval:', JSON.stringify(await page.evaluate((src) => new Function('g', 'return ' + src)(window.__bg.game), a.eval)));
}
if (errors.length) {
  console.log('console errors:');
  for (const e of [...new Set(errors)]) console.log('  ', e);
  writeFileSync(join(out, 'errors.txt'), errors.join('\n'));
}
await browser.close();
server.close();
