#!/usr/bin/env node
// Play Pilot One with the human-like bot (scripts/play/bot.js) and record it.
//
//   node scripts/play/record.js [--skill average] [--route over|gap] [--seed 1] [--q medium] [--size 1280x720]
//                               [--no-video] [--no-audio] [--wav] [--max 420] [--label name] [--markers on|off]
//                               [--section rings:0] [--headed] [--realtime] [--no-build] [--url http://...]
//                               [--dist path] [--out dir] [--continues 2] [--params k=v,k2] [--loc 2] [--campaign]
//
// --loc L starts at location L (?loc=L). A run ends at the location clear, unless --campaign: then it goes on through
// the star map into the next location, until the ending (or game over).
//
// Default mode is frame-exact capture: the page runs with ?capture, every frame is one bot tick + one 1/60 s game
// step + one screenshot piped to ffmpeg, so the video is a clean 60 fps no matter how slow the machine is.
// Sound is recorded as effect calls and rendered offline afterwards (OfflineAudioContext), then muxed in.
// The video's sound is loudness-normalised; the game's own level is in the meta file (rawLufs). --wav keeps the
// un-normalised track, and renders it for --no-video runs too.
// Output: recordings/<date>-<version>-<route>-<skill>[-label].{mp4,telemetry.json,meta.json}
//
//   node scripts/play/record.js --human [--q auto] [--label name]     (npm run play -- --human)
// --human: you play. A normal browser window opens with telemetry on (no bot); play as usual, then close the window.
// The run (hits and what caused them, lessons, rolls, bombs, per-stage numbers) is saved as <...>-human.telemetry.json;
// `npm run analyze -- telemetry <file>` summarises it.
import { spawn, spawnSync, execSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const human = !!args.human;
const opt = {
  human,
  skill: human ? 'human' : args.skill || 'average',
  route: args.route || 'over',
  seed: +(args.seed || 1),
  q: args.q || (human ? 'auto' : 'medium'),
  size: (args.size || '1280x720').split('x').map(Number),
  video: !args['no-video'] && !args.realtime && !human,
  audio: !args['no-audio'],
  wav: !!args.wav,
  max: +(args.max || 420), // seconds of game time
  label: args.label || '',
  markers: args.markers || 'on',
  section: args.section || '',
  headed: !!args.headed || !!args.realtime || human,
  realtime: !!args.realtime || human,
  build: !args['no-build'] && !args.url && !args.dist,
  url: args.url || '',
  continues: +(args.continues ?? 2),
  out: args.out || join(ROOT, 'recordings'),
  dist: args.dist ? resolve(args.dist) : join(ROOT, 'dist'),
  extra: args.params || '',
  loc: +(args.loc || 1),
  // ANGLE backend: Chrome's Vulkan path stopped giving a WebGL context on the dev machine (Oct 2026); GL works
  angle: args.angle || 'gl',
  campaign: !!args.campaign,
};

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    o[k] = v;
  }
  return o;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png' };
function serveDist() {
  const dist = opt.dist;
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(dist, p);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Integrated loudness (EBU R128) of a sound file, or null for silence. */
function integratedLufs(file) {
  const txt = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 << 20 }).stderr || '';
  const m = txt.slice(txt.lastIndexOf('Summary:')).match(/I:\s*(-?[\d.]+) LUFS/);
  return m ? +m[1] : null;
}

function ffmpegEncoder(file) {
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => ff.on('close', (c) => (c === 0 ? ok() : fail(new Error('ffmpeg exited ' + c)))));
  return {
    async write(buf) {
      if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once('drain', ok));
    },
    async end() {
      ff.stdin.end();
      await done;
    },
  };
}

async function main() {
  if (opt.build) {
    console.log('building…');
    execSync('npx vite build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  let server = null;
  let base = opt.url;
  if (!base) {
    server = await serveDist();
    base = `http://127.0.0.1:${server.address().port}/`;
  }
  const params = new URLSearchParams();
  if (human) params.set('telemetry', '');
  else params.set('bot', '');
  if (!opt.realtime) params.set('capture', '');
  if (opt.q !== 'auto') params.set('q', opt.q);
  if (!human) params.set('route', opt.route);
  if (opt.markers === 'off') params.set('markers', 'off');
  if (opt.section) params.set('t', opt.section);
  if (opt.loc > 1) params.set('loc', String(opt.loc));
  for (const kv of String(opt.extra || '').split(',').filter(Boolean)) {
    const [k, v = ''] = kv.split('=');
    params.set(k, v);
  }
  const url = base + '?' + params.toString().replace(/=(&|$)/g, '$1');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !opt.headed,
    args: [
      `--use-angle=${opt.angle}`, ...(opt.angle === 'vulkan' ? ['--enable-features=Vulkan'] : []), '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
    ],
  });
  const page = await browser.newPage(human ? { viewport: null } : { viewport: { width: opt.size[0], height: opt.size[1] }, deviceScaleFactor: 1 });
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('[page]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__bg && window.__bg.game, null, { timeout: 30000 });
  const info = await page.evaluate(() => ({ version: window.__bg.version, gpu: window.__bg.gpu, tier: window.__bg.tier, readyMs: window.__bg.readyMs }));
  console.log('page ready', info, url);
  if (human) {
    await recordHuman(page, browser, info, url, server);
    return;
  }
  await page.addScriptTag({ path: join(ROOT, 'scripts/play/bot.js') });
  await page.evaluate((o) => window.__bot.create(o), { skill: opt.skill, seed: opt.seed, useMarkers: opt.markers !== 'off' });

  const stamp = new Date().toLocaleDateString('sv').replace(/-/g, '');
  const name = [stamp, info.version.replace('v.', ''), opt.route, opt.skill, opt.label].filter(Boolean).join('-');
  mkdirSync(opt.out, { recursive: true });
  const outBase = join(opt.out, name);
  const telemetry = { columns: null, events: [], samples: [] };
  const pullTelemetry = async () => {
    const t = await page.evaluate(() => window.__bg.telemetry());
    if (!t) return;
    telemetry.columns = t.columns;
    telemetry.events.push(...t.events);
    telemetry.samples.push(...t.samples);
  };

  // A person clicks Start.
  await page.click('#start-btn');
  const t0 = await page.evaluate(() => window.__bg.game.time);
  let continues = 0;
  let frames = 0;
  let endReason = 'time';
  const wall0 = Date.now();

  if (opt.realtime) {
    await page.evaluate(() => window.__bot.run());
    while (true) {
      await page.waitForTimeout(1000);
      const st = await page.evaluate(() => ({ s: window.__bg.game.state, t: window.__bg.game.time }));
      await pullTelemetry();
      if (st.s === 'over') {
        if (continues++ < opt.continues) await page.click('#continue-btn');
        else {
          endReason = 'game over';
          break;
        }
      }
      if (st.s === 'locclear') {
        if (!opt.campaign) {
          endReason = 'location clear';
          break;
        }
        await page.evaluate(() => window.__bg.ui.next());
      }
      if (st.s === 'ended') {
        endReason = 'ended';
        break;
      }
      if (st.t - t0 > opt.max) break;
    }
  } else {
    const enc = opt.video ? ffmpegEncoder(outBase + '.video.mp4') : null;
    const cdp = opt.video ? await page.context().newCDPSession(page) : null;
    const maxFrames = Math.round(opt.max * 60);
    let tail = -1; // frames still to record after the stage ends (shows the tally)
    const batch = opt.video ? 1 : 30;
    while (frames < maxFrames) {
      const state = await page.evaluate((n) => {
        let s;
        for (let i = 0; i < n; i++) {
          window.__bot.tick();
          s = window.__bg.advance(1);
          if (s !== 'playing') break;
        }
        return s;
      }, batch);
      frames += batch;
      if (enc) {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
        await enc.write(Buffer.from(shot.data, 'base64'));
      }
      if (frames % 600 < batch) {
        await pullTelemetry();
        const t = await page.evaluate(() => window.__bg.game.time);
        process.stdout.write(`\r  game ${(t - t0).toFixed(0)}s  frames ${frames}  ${((Date.now() - wall0) / 1000).toFixed(0)}s wall   `);
      }
      if (tail > 0) {
        if (--tail === 0) break;
        continue;
      }
      if (state === 'over') {
        if (continues++ < opt.continues) {
          // the game-over card stays up for a moment before a person clicks
          for (let i = 0; i < 90 && enc; i++) {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
            await enc.write(Buffer.from(shot.data, 'base64'));
          }
          await page.evaluate(() => window.__bg.ui.cont());
        } else {
          endReason = 'game over';
          tail = enc ? 120 : 1;
        }
      } else if (state === 'locclear') {
        if (!opt.campaign) {
          endReason = 'location clear';
          tail = enc ? 240 : 1;
        } else {
          for (let i = 0; i < 180 && enc; i++) {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
            await enc.write(Buffer.from(shot.data, 'base64'));
          }
          const next = await page.evaluate(() => window.__bg.ui.next());
          console.log(`\n  location clear → ${next}`);
          if (next === 'ended') {
            endReason = 'ended';
            tail = enc ? 240 : 1;
          }
        }
      } else if (state === 'ended') {
        endReason = 'ended';
        tail = enc ? 240 : 1;
      } else if (state === 'paused') {
        await page.evaluate(() => window.__bg.ui.resume());
      }
    }
    process.stdout.write('\n');
    if (enc) await enc.end();
  }
  await pullTelemetry();
  const botStats = await page.evaluate(() => window.__bot.stats());
  const t1 = await page.evaluate(() => window.__bg.game.time);

  // sound
  let hasAudio = false;
  let rawLufs = null;
  if (opt.audio && !opt.realtime && (opt.video || opt.wav)) {
    console.log('rendering audio…');
    const b64 = await page.evaluate((t) => window.__bg.renderAudio(t), t0);
    writeFileSync(outBase + '.wav', Buffer.from(b64, 'base64'));
    rawLufs = integratedLufs(outBase + '.wav');
    hasAudio = true;
  }
  await browser.close();
  server?.close();

  if (opt.video) {
    if (hasAudio) {
      execSync(`ffmpeg -v error -y -i "${outBase}.video.mp4" -i "${outBase}.wav" -c:v copy -af loudnorm=I=-18:TP=-1.5 -ar 48000 -c:a aac -b:a 160k -shortest "${outBase}.mp4"`);
      rmSync(outBase + '.video.mp4');
      if (!opt.wav) rmSync(outBase + '.wav');
    } else {
      execSync(`mv "${outBase}.video.mp4" "${outBase}.mp4"`);
    }
  }
  writeFileSync(outBase + '.telemetry.json', JSON.stringify(telemetry));
  const meta = { ...opt, url, ...info, gameSeconds: +(t1 - t0).toFixed(2), frames, endReason, wallSeconds: (Date.now() - wall0) / 1000, rawLufs, botStats };
  writeFileSync(outBase + '.meta.json', JSON.stringify(meta, null, 2));
  console.log(`done: ${endReason}, ${meta.gameSeconds}s game time, ${meta.wallSeconds.toFixed(0)}s wall → ${outBase}.*`);
}

/** --human: pull telemetry every second while you play; save it when the window closes. */
async function recordHuman(page, browser, info, url, server) {
  const stamp = new Date().toLocaleDateString('sv').replace(/-/g, '');
  const name = [stamp, info.version.replace('v.', ''), 'human', opt.label].filter(Boolean).join('-');
  mkdirSync(opt.out, { recursive: true });
  const outBase = join(opt.out, name);
  const telemetry = { columns: null, events: [], samples: [] };
  const wall0 = Date.now();
  console.log('play in the browser window; close it when you are done');
  let closed = false;
  page.on('close', () => (closed = true));
  browser.on('disconnected', () => (closed = true));
  const save = () => {
    writeFileSync(outBase + '.telemetry.json', JSON.stringify(telemetry));
    const hits = telemetry.events.filter((e) => e.ev === 'hit').length;
    writeFileSync(outBase + '.meta.json', JSON.stringify({ ...opt, url, ...info, wallSeconds: (Date.now() - wall0) / 1000, hits }, null, 2));
  };
  while (!closed) {
    await new Promise((ok) => setTimeout(ok, 1000));
    if (closed) break;
    try {
      const t = await page.evaluate(() => window.__bg.telemetry());
      if (t) {
        telemetry.columns = t.columns;
        telemetry.events.push(...t.events);
        telemetry.samples.push(...t.samples);
        save();
      }
    } catch {
      break; // the window went away mid-call
    }
  }
  save();
  await browser.close().catch(() => {});
  server?.close();
  console.log(`saved ${telemetry.samples.length} samples, ${telemetry.events.length} events → ${outBase}.telemetry.json`);
  console.log(`summary: node scripts/play/analyze.js telemetry ${outBase}.telemetry.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
