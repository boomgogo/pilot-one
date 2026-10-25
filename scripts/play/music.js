#!/usr/bin/env node
// Render every music cue offline, with the game's own synth and song data (src/audio/music.js), to WAVs you can
// listen to, and report each one's loudness and peak (ai/summary.md §9).
//
//   npm run music [-- --seconds 40] [--out recordings/music] [--no-build]
// Themes and boss cues render for --seconds; one-shot cues (jingles, game over) for their own length.
import { execSync, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const seconds = +arg('seconds', 40);
const out = resolve(arg('out', join(ROOT, 'recordings/music')));
const ONCE = new Set(['stageClear', 'locClear', 'gameOver']);
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
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist'] });
mkdirSync(out, { recursive: true });
const done = new Set();
const rows = [];
for (let loc = 1; loc <= 5; loc++) {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'warning' && m.text().startsWith('music') && console.log('  ' + m.text()));
  await page.goto(`${base}?bot&capture&q=low&loc=${loc}`);
  await page.waitForFunction(() => window.__bg && window.__bg.game, null, { timeout: 30000 });
  for (const name of await page.evaluate(() => window.__bg.songs())) {
    if (done.has(name)) continue;
    done.add(name);
    const once = ONCE.has(name);
    const b64 = await page.evaluate(([n, s, j]) => window.__bg.renderMusic(n, s, j), [name, once ? 8 : seconds, once]);
    const file = join(out, name + '.wav');
    writeFileSync(file, Buffer.from(b64, 'base64'));
    const txt = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '';
    const sum = txt.slice(txt.lastIndexOf('Summary:'));
    rows.push({ cue: name, location: loc, lufs: +(sum.match(/I:\s*(-?[\d.]+) LUFS/)?.[1] ?? NaN), peakDb: +(sum.match(/Peak:\s*(-?[\d.]+) dBFS/)?.[1] ?? NaN), file: file.replace(ROOT + '/', '') });
  }
  await page.close();
}
console.table(rows);
await browser.close();
server.close();
