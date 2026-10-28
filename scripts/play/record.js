#!/usr/bin/env node
// Play Pilot One with the human-like bot (scripts/play/bot.js) and record it.
//
//   node scripts/play/record.js [--skill average] [--route over|gap] [--seed 1] [--q medium] [--size 1280x720] [--dpr 1]
//                               [--no-video] [--no-audio] [--wav] [--max 420] [--label name] [--markers on|off]
//                               [--section rings:0] [--headed] [--realtime] [--no-build] [--url http://...]
//                               [--dist path] [--out dir] [--continues 2] [--params k=v,k2] [--loc 2] [--campaign]
//                               [--video-locs 3,5] [--master] [--clean] [--no-stems] [--tune maxAimRate=1.5,k=v]
//                               [--hold-clear 240] [--hold-map 200] [--hold-end 300] [--hold-over 90]
//   node scripts/play/record.js --attract 40 [--clean] [--size 1280x720] [--dpr 2] [--q high]
//
// --loc L starts at location L (?loc=L). A run ends at the location clear, unless --campaign: then it goes on through
// the star map into the next location, until the ending (or game over).
//
// Default mode is frame-exact capture: the page runs with ?capture, every frame is one bot tick + one 1/60 s game
// step + one screenshot piped to ffmpeg, so the video is a clean 60 fps no matter how slow the machine is.
// Sound is recorded as effect calls and rendered offline afterwards (OfflineAudioContext), then muxed in.
// The video's sound is loudness-normalised; the game's own level is in the meta file (rawLufs). --wav keeps the
// un-normalised track, and renders it for --no-video runs too.
// Held screens (game over, location clear, star map, ending) step the game clock too, with or without video, for
// the --hold-* frame counts: a --no-video scout and a filmed shoot with the same seed, --q and --size are the same
// run (ai/plan_0.md §3.3). --dpr, --master and --clean don't change the run.
// Output: recordings/<date>-<version>-<route>-<skill>[-label].{mp4,telemetry.json,meta.json}
//
// --campaign (and --attract) record a take, in a folder: recordings/<date>-<version>-<skill>-s<seed>-<WxH>[@dpr][-label]/
// with one video per location (L1.mp4 …: from the start or the jump in, to the end of the star map), each with its
// sound as un-normalised stems (L1.mix.wav, L1.sfx.wav, L1.music.wav; --no-stems: the mix only), plus
// telemetry.json and meta.json (segments: each one's game time at its first frame, and its frame count).
// --video-locs 3,5 films only those locations and fast-forwards through the rest.
// --attract S: S seconds of the title screen's fly-by, then stop (attract.mp4, a take of its own).
// --dpr N: device pixel ratio. 1280x720 at --dpr 2 is a 2560x1440 video with the HUD laid out as on a 720p screen;
// above 1.35 it needs --q high (the medium tier caps the pixel ratio). --master: JPEG 95 frames, x264 CRF 14.
// --clean: hides the version label and the GitHub ribbon (and, with --attract, the title menu).
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
  dpr: +(args.dpr || 1),
  attract: +(args.attract || 0), // seconds
  clean: !!args.clean,
  master: !!args.master,
  stems: !args['no-stems'],
  videoLocs: args['video-locs'] ? String(args['video-locs']).split(',').map(Number) : null,
  // bot preset overrides, for tuning (scripts/play/bot.js PRESETS)
  tune: Object.fromEntries(String(args.tune || '').split(',').filter(Boolean).map((kv) => kv.split('=')).map(([k, v]) => [k, isNaN(+v) ? v : +v])),
  // frames each held screen stays up (ai/plan_0.md §3.1)
  hold: { clear: +(args['hold-clear'] ?? 240), map: +(args['hold-map'] ?? 200), end: +(args['hold-end'] ?? 300), over: +(args['hold-over'] ?? 90), overTail: 120 },
};
opt.take = opt.campaign || opt.attract > 0;
const DPR_CAP = { low: 1, medium: 1.35, high: 2 }; // src/core/quality.js
if (opt.dpr > (DPR_CAP[opt.q] ?? 2)) console.warn(`warning: --dpr ${opt.dpr} is capped at ${DPR_CAP[opt.q]} by --q ${opt.q}: the 3D view is upscaled (use --q high)`);

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
  const crf = opt.master ? '14' : '18';
  // screenshots are sRGB JPEGs (BT.601 full range): converted to BT.709 limited range and tagged, as video players expect
  const vf = 'scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=full:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
  // a master is re-encoded by the editor, so it trades file size for speed: at 1440p the medium preset kept 5 cores
  // busy and was the bottleneck of a shoot (the GPU sat at 28%)
  const preset = opt.master ? 'veryfast' : 'medium';
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-', '-vf', vf, '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
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
  const page = await browser.newPage(human ? { viewport: null } : { viewport: { width: opt.size[0], height: opt.size[1] }, deviceScaleFactor: opt.dpr });
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
  if (opt.clean) {
    const hide = ['#version', '#forkme', ...(opt.attract ? ['#screen-title'] : [])];
    await page.addStyleTag({ content: `${hide.join(', ')} { display: none !important; }` });
  }
  if (!opt.attract) {
    await page.addScriptTag({ path: join(ROOT, 'scripts/play/bot.js') });
    await page.evaluate((o) => window.__bot.create(o), { skill: opt.skill, seed: opt.seed, useMarkers: opt.markers !== 'off', tune: opt.tune });
  }

  const stamp = new Date().toLocaleDateString('sv').replace(/-/g, '');
  const ver = info.version.replace('v.', '');
  const size = opt.size.join('x') + (opt.dpr !== 1 ? '@' + opt.dpr : '');
  let dir = null;
  let outBase;
  if (opt.take) {
    dir = join(opt.out, [stamp, ver, opt.attract ? 'attract' : opt.skill, opt.attract ? '' : 's' + opt.seed, size, opt.label].filter(Boolean).join('-'));
    mkdirSync(dir, { recursive: true });
    outBase = join(dir, 'take');
  } else {
    mkdirSync(opt.out, { recursive: true });
    outBase = join(opt.out, [stamp, ver, opt.route, opt.skill, opt.label].filter(Boolean).join('-'));
  }
  const telemetry = { columns: null, events: [], samples: [] };
  const pullTelemetry = async () => {
    const t = await page.evaluate(() => window.__bg.telemetry());
    if (!t) return;
    telemetry.columns = t.columns;
    telemetry.events.push(...t.events);
    telemetry.samples.push(...t.samples);
  };

  let continues = 0;
  let frames = 0;
  let endReason = 'time';
  const wall0 = Date.now();

  if (opt.realtime) {
    await page.click('#start-btn');
    const t0 = await page.evaluate(() => window.__bg.game.time);
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
    await finish({ t0, segs: [] });
    return;
  }

  // ---- frame-exact capture
  const cdp = opt.video ? await page.context().newCDPSession(page) : null;
  const screenshot = async () => {
    // a clip at the device scale: without it CDP returns CSS pixels whatever --dpr is
    const clip = { x: 0, y: 0, width: opt.size[0], height: opt.size[1], scale: opt.dpr };
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: opt.master ? 95 : 90, optimizeForSpeed: true, clip });
    return Buffer.from(shot.data, 'base64');
  };
  // n frames of one bot tick + one 1/60 s step; `until`: stop as soon as the state leaves 'playing'
  const step = (n, until) =>
    page.evaluate(
      ([n, until]) => {
        let s = window.__bg.game.state;
        let i = 0;
        while (i < n) {
          window.__bot?.tick();
          s = window.__bg.advance(1);
          i++;
          if (until && s !== 'playing') break;
        }
        return { state: s, n: i, t: window.__bg.game.time };
      },
      [n, until],
    );

  // video segments: one per location in a take (a segment's t0 is the game time its first frame shows)
  const segs = [];
  let seg = null;
  const openSeg = (name, loc) => {
    const film = opt.video && (!opt.videoLocs || opt.videoLocs.includes(loc));
    const base = dir ? join(dir, name) : outBase;
    seg = { name, loc, base, film, t0: null, frames: 0, enc: film ? ffmpegEncoder(base + '.video.mp4') : null };
    segs.push(seg);
  };
  const closeSeg = async () => {
    if (seg?.enc) await seg.enc.end();
    if (seg) delete seg.enc;
    seg = null;
  };
  let shown = 0;
  const progress = async () => {
    if (frames - shown < 600) return;
    shown = frames;
    await pullTelemetry();
    process.stdout.write(`\r  ${seg?.name || ''} frames ${frames} (${(frames / 60).toFixed(0)}s)  ${((Date.now() - wall0) / 1000).toFixed(0)}s wall   `);
  };
  /** Run n frames (or until play stops, with `until`), filmed when the segment is. Returns the state after them. */
  const run = async (n, until = false) => {
    let state = null;
    let left = n;
    while (left > 0) {
      const r = await step(seg?.enc ? 1 : Math.min(left, 60), until);
      if (seg && seg.t0 === null) seg.t0 = r.t - (r.n - 1) / 60;
      if (seg) seg.frames += r.n;
      frames += r.n;
      left -= r.n;
      state = r.state;
      if (seg?.enc) await seg.enc.write(await screenshot());
      await progress();
      if (until && state !== 'playing') break;
    }
    return state;
  };

  if (opt.attract) {
    // the title screen's fly-by (no bot, no sound: the title is silent until a person clicks)
    openSeg('attract', 0);
    await run(Math.round(opt.attract * 60));
    await closeSeg();
    endReason = 'attract';
    await finish({ t0: segs[0].t0, segs });
    return;
  }

  // A person clicks Start.
  await page.click('#start-btn');
  const t0 = await page.evaluate(() => window.__bg.game.time);
  const H = opt.hold;
  let loc = opt.loc;
  openSeg(`L${loc}`, loc);
  const maxFrames = Math.round(opt.max * 60);
  while (frames < maxFrames) {
    const state = await run(maxFrames - frames, true);
    if (state === 'playing') break; // out of time
    if (state === 'paused') {
      await page.evaluate(() => window.__bg.ui.resume());
    } else if (state === 'over') {
      if (continues++ < opt.continues) {
        await run(H.over); // the game-over card stays up for a moment before a person clicks
        await page.evaluate(() => window.__bg.ui.cont());
      } else {
        endReason = 'game over';
        await run(H.overTail);
        break;
      }
    } else if (state === 'ended') {
      endReason = 'ended';
      await run(H.end);
      break;
    } else if (state === 'locclear') {
      await run(H.clear);
      if (!opt.campaign) {
        endReason = 'location clear';
        break;
      }
      // on to the star map (or, after the last location, the ending), then launch once the next one is loaded
      const next = await page.evaluate(() => (window.__bg.ui.map(), window.__bg.game.state));
      if (next === 'ended') {
        endReason = 'ended';
        await run(H.end);
        break;
      }
      await page.waitForFunction(() => !document.getElementById('launch-btn').disabled, null, { timeout: 120000 });
      await run(H.map);
      await closeSeg();
      openSeg(`L${++loc}`, loc);
      await page.evaluate(() => window.__bg.ui.launch());
      process.stdout.write(`\n  location ${loc - 1} clear → ${loc}\n`);
    }
  }
  await closeSeg();
  process.stdout.write('\n');
  await finish({ t0, segs });

  /** Sound, mux, telemetry and meta. */
  async function finish({ t0, segs }) {
    await pullTelemetry();
    const botStats = await page.evaluate(() => window.__bot?.stats() ?? null);
    const t1 = await page.evaluate(() => window.__bg.game.time);
    // sound, per segment: the mix, plus effect and music stems in a take
    const withSound = opt.audio && !opt.realtime && !opt.attract;
    for (const s of segs) {
      if (!withSound || !(s.film || opt.wav) || !s.frames) continue;
      console.log(`rendering audio ${s.name}…`);
      const win = { t1: s.t0 + s.frames / 60, lead: 1 / 60 + 1e-6 };
      const render = async (file, o) => {
        const b64 = await page.evaluate(([t, o]) => window.__bg.renderAudio(t, o), [s.t0, { ...win, ...o }]);
        writeFileSync(file, Buffer.from(b64, 'base64'));
      };
      s.wav = dir ? s.base + '.mix.wav' : s.base + '.wav';
      await render(s.wav, {});
      if (dir && opt.stems) {
        await render(s.base + '.sfx.wav', { music: false });
        await render(s.base + '.music.wav', { effects: false });
      }
      s.rawLufs = integratedLufs(s.wav);
    }
    await browser.close();
    server?.close();

    for (const s of segs) {
      if (!s.film) continue;
      if (s.wav) {
        execSync(`ffmpeg -v error -y -i "${s.base}.video.mp4" -i "${s.wav}" -c:v copy -af loudnorm=I=-18:TP=-1.5 -ar 48000 -c:a aac -b:a 160k -shortest "${s.base}.mp4"`);
        rmSync(s.base + '.video.mp4');
        if (!dir && !opt.wav) rmSync(s.wav);
      } else {
        execSync(`mv "${s.base}.video.mp4" "${s.base}.mp4"`);
      }
    }
    const metaFile = dir ? join(dir, 'meta.json') : outBase + '.meta.json';
    const rawLufs = segs.length === 1 ? segs[0].rawLufs ?? null : null;
    const segments = segs.map(({ name, loc, film, t0, frames, rawLufs }) => ({ name, loc, film, t0, frames, rawLufs: rawLufs ?? null }));
    if (!opt.attract) writeFileSync(dir ? join(dir, 'telemetry.json') : outBase + '.telemetry.json', JSON.stringify(telemetry));
    const meta = { ...opt, url, ...info, t0, gameSeconds: +(t1 - t0).toFixed(2), frames, endReason, wallSeconds: (Date.now() - wall0) / 1000, rawLufs, segments, botStats };
    writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    console.log(`done: ${endReason}, ${meta.gameSeconds}s game time, ${meta.wallSeconds.toFixed(0)}s wall → ${dir || outBase + '.*'}`);
  }
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
