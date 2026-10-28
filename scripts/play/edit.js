#!/usr/bin/env node
// Cut a showcase video from recorded takes (ai/plan_0.md §3.5).
//
//   node scripts/play/edit.js <youtube|short|x> [--take dir] [--attract dir] [--out recordings/videos] [--draft]
//                             [--only 3] [--keep] [--edit other-list.json]
//   npm run video -- youtube
//
// The edit list is scripts/play/edits/<name>.json: the take (a record.js --campaign folder with highlights.json, from
// `analyze.js highlights`), the attract take for cards, named music beds, the text for the upload, and the entries:
//   { "chapter": "Power" }                                    a YouTube chapter starts at the next clip
//   { "pick": "bomb", "n": 1, "pad": [-1.5, 3] }              the n-th clean highlight with that tag (filters: loc,
//                                                             after, before, where; sort: a field, highest first)
//   { "at": 812.4, "to": 820 }                                an explicit window, in game time
//   { "card": "title", "dur": 8, "from": 4 }                  a card over the attract fly-by (from: its seconds)
// and on any of them: "caption" (\n for lines), "sub" (alone: a small label), "pos": "raised" (the caption clears the
// game's hint line), "audio": "game" | "none", "bed": "<name>" (the effects stem under a continuous music bed instead
// of the game mix), "fade": "in" | "out" | "both" (dip to black).
// A bed is a slice of a segment's music stem: { "seg": "L5", "at": <game time>, "gain": 0 }; a bed keeps playing
// from where it left off when it comes back.
//
// Writes <out>/<file>.mp4, <file>.txt (title, description with chapters, tags or post text), <file>.resolved.json
// (every clip with its exact window: copy them back as { at, to } to pin a pick), a thumbnail when the list has one,
// and <file>.checks.json: size, fps, duration, codecs, loudness, flashes and motion (analyze.js video, with a contact
// sheet), against the target's numbers (ai/plan_0.md §2). --draft encodes fast for review; --only N renders the first
// N clips.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) args._.push(argv[i]);
  else args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
}
const name = args._[0];
if (!name) {
  console.log('usage: edit.js <youtube|short|x> [--take dir] [--attract dir] [--draft]');
  process.exit(1);
}

// encodes per platform (ai/plan_0.md §2); css: the layout size of captions and cards (they render at w / css[0])
const TARGETS = {
  youtube: { w: 2560, h: 1440, css: [1280, 720], crf: 16, x264: ['-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-flags', '+cgop'], ab: '384k', len: [285, 315] },
  x: { w: 1920, h: 1080, css: [1280, 720], crf: 18, x264: ['-g', '60', '-maxrate', '16M', '-bufsize', '32M'], ab: '192k', len: [38, 46], maxMB: 512 },
  short: { w: 1080, h: 1920, css: [540, 960], crf: 17, x264: ['-g', '30'], ab: '320k', len: [33, 46] },
};
const RATE = 44100; // the stems' rate (record.js)
const HANDLE = 0.3; // s of sound past a cut, crossfaded into the next clip

const edit = JSON.parse(readFileSync(args.edit ? resolve(args.edit) : join(ROOT, 'scripts/play/edits', name + '.json'), 'utf8'));
const T = TARGETS[edit.target || name];
const abs = (p) => (p ? resolve(ROOT, p) : null);
const takeDir = abs(args.take || edit.take);
const attractDir = abs(args.attract || edit.attract);
const outDir = abs(args.out || 'recordings/videos');
const file = edit.file || 'pilot-one-' + name;
const parts = join(outDir, file + '.parts');
mkdirSync(parts, { recursive: true });

const ff = (a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'inherit', 'inherit'] });
// BT.709 limited range, tagged (record.js writes the takes that way); RGBA overlays are converted with the same matrix
const BT709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
const ffErr = (a) => spawnSync('ffmpeg', ['-v', 'info', '-y', ...a], { encoding: 'utf8', maxBuffer: 256 << 20 }).stderr || '';
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------------------------------------
// takes and picks

function readTake(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  let hl = { highlights: [], avoid: [] };
  if (existsSync(join(dir, 'telemetry.json'))) {
    if (!existsSync(join(dir, 'highlights.json'))) execFileSync('node', [join(ROOT, 'scripts/play/analyze.js'), 'highlights', dir], { stdio: 'inherit' });
    hl = JSON.parse(readFileSync(join(dir, 'highlights.json'), 'utf8'));
  }
  return { dir, meta, ...hl };
}

const take = readTake(takeDir);
const attract = attractDir ? readTake(attractDir) : null;
const segOf = (t) => take.meta.segments.find((s) => s.film && t >= s.t0 - 1e-6 && t < s.t0 + s.frames / 60);

function pick(e, used) {
  let c = take.highlights.filter((h) => h.tag === e.pick && h.film && (e.dirty || h.clean));
  if (e.loc) c = c.filter((h) => h.seg === 'L' + e.loc);
  if (e.after !== undefined) c = c.filter((h) => h.t >= e.after);
  if (e.before !== undefined) c = c.filter((h) => h.t <= e.before);
  if (e.where) c = c.filter((h) => Object.entries(e.where).every(([k, v]) => h[k] === v));
  c = c.filter((h) => !used.some(([a, b]) => a < h.t + 1 && b > h.t - 1));
  if (e.sort) c.sort((a, b) => (b[e.sort] ?? 0) - (a[e.sort] ?? 0));
  const h = c[(e.n || 1) - 1];
  if (!h) throw new Error(`no highlight for ${JSON.stringify(e)} (${c.length} candidates)`);
  return h;
}

/** Entries → clips: { kind: 'take' | 'card', file, frame, frames, seg, from, to, ... }. */
function resolveClips() {
  const clips = [];
  const used = [];
  let chapter = null;
  for (const e of edit.entries) {
    if (e.chapter) {
      chapter = e.chapter;
      continue;
    }
    const c = { ...e, chapter };
    chapter = null;
    if (e.card) {
      const A = attract?.meta.segments[0];
      c.kind = 'card';
      c.frames = Math.round(e.dur * 60);
      if (A) {
        c.file = join(attract.dir, A.name + '.mp4');
        c.frame = Math.round((e.from || 0) * 60);
      }
      c.audio = e.bed ? 'bed' : 'none';
    } else {
      let from;
      let to;
      if (e.pick) {
        const h = pick(e, used);
        c.tag = `${h.tag}${h.part ? ' ' + h.part : ''}${h.level ? ' ' + h.level : ''}`;
        from = e.pad ? h.t + e.pad[0] : h.from;
        to = e.pad ? h.t + e.pad[1] : h.to;
      } else {
        from = e.at;
        to = e.to ?? e.at + e.dur;
      }
      if (e.dur) to = from + e.dur;
      const s = segOf(from) || segOf(to - 0.01);
      if (!s) throw new Error(`no filmed segment at ${from.toFixed(2)} for ${JSON.stringify(e)}`);
      from = Math.max(from, s.t0);
      to = Math.min(to, s.t0 + s.frames / 60);
      const shun = take.avoid.filter((w) => w.from < to && w.to > from).map((w) => w.why);
      if (shun.length && !e.dirty) console.warn(`  note: clip at ${from.toFixed(1)} overlaps ${[...new Set(shun)].join(', ')}`);
      used.push([from, to]);
      Object.assign(c, { kind: 'take', seg: s.name, file: join(take.dir, s.name + '.mp4'), frame: Math.round((from - s.t0) * 60), frames: Math.round((to - from) * 60), from: +from.toFixed(3), to: +to.toFixed(3) });
      c.audio = e.audio || (e.bed ? 'bed' : 'game');
    }
    clips.push(c);
  }
  let t = 0;
  for (const c of clips) {
    c.start = t;
    t += c.frames / 60;
  }
  return clips;
}

// ------------------------------------------------------------------------------------------------
// captions and cards: HTML in the game's style, rendered to transparent PNGs by headless Chrome

const STYLE = `
:root { --cyan: #7fe8ff; --warm: #ffb04a; --mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, 'Liberation Mono', monospace; }
html, body { margin: 0; width: 100vw; height: 100vh; overflow: hidden; background: transparent; font-family: var(--mono); color: #fff; }
.glow { text-shadow: 0 0 14px rgba(127, 232, 255, 0.85), 0 0 2px rgba(0, 0, 0, 1), 0 2px 10px rgba(0, 0, 0, 0.9); }
.cap { position: absolute; left: 4%; right: 4%; text-align: center; }
.cap .band { display: inline-block; padding: 12px 26px 14px; border-radius: 14px; background: radial-gradient(ellipse at center, rgba(4, 8, 22, 0.62), rgba(4, 8, 22, 0.35) 70%, rgba(4, 8, 22, 0) 100%); }
.cap .t { font-weight: 800; letter-spacing: 0.2em; font-size: 30px; line-height: 1.25; white-space: pre-line; }
.cap .s { margin-top: 8px; font-weight: 600; letter-spacing: 0.22em; font-size: 16px; color: var(--cyan); white-space: pre-line; }
.logo { font-weight: 800; letter-spacing: 0.18em; line-height: 1; background: linear-gradient(180deg, #ffffff 0%, var(--cyan) 55%, #3a7bff 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 18px rgba(127, 232, 255, 0.55)) drop-shadow(0 3px 6px rgba(0, 0, 0, 0.9)); }
.card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  background: radial-gradient(ellipse at center, rgba(3, 6, 18, 0.25), rgba(3, 6, 18, 0.75)); }
.card .line { font-weight: 700; letter-spacing: 0.22em; white-space: pre-line; }
.card .url { margin-top: 26px; font-weight: 800; letter-spacing: 0.12em; color: var(--warm); text-shadow: 0 0 16px rgba(255, 176, 74, 0.6), 0 2px 8px rgba(0, 0, 0, 0.9); }
`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function captionHtml(c) {
  const portrait = T.h > T.w;
  // Shorts: clear of the top 12%, the bottom 20% and the right 12% (the Shorts buttons); landscape: the lower third,
  // or "pos": "raised" to clear the game's own hint line at the bottom
  const pos = portrait ? 'top: 15%; right: 13%;' : c.pos === 'raised' ? 'bottom: 11%;' : 'bottom: 4%;';
  const size = portrait ? 'font-size: 25px;' : '';
  // a sub alone is a small label
  const t = c.caption ? `<div class="t" style="${size}">${esc(c.caption)}</div>` : '';
  const s = c.sub ? `<div class="s" style="${c.caption ? '' : 'margin-top: 0;'}">${esc(c.sub)}</div>` : '';
  return `<div class="cap glow" style="${pos}"><div class="band">${t}${s}</div></div>`;
}

function cardHtml(c) {
  const portrait = T.h > T.w;
  // portrait: the logo shrinks to fit the width, the lines and the URL stay readable on a phone
  const k = portrait ? 0.62 : 1;
  const kt = portrait ? 0.95 : 1;
  const lines = (c.lines || []).map((l, i) => `<div class="line glow" style="font-size: ${(i === 0 ? 24 : 18) * kt}px; margin-top: ${i ? 10 : 22}px; color: ${i === 0 ? '#fff' : 'var(--cyan)'}">${esc(l)}</div>`).join('');
  // the end card keeps to the upper half on YouTube: its end-screen elements go in the lower half
  const box = c.card === 'end' && !portrait ? 'justify-content: flex-start; padding-top: 9%;' : '';
  return `<div class="card" style="${box}"><div class="logo" style="font-size: ${84 * k}px">${esc(c.title ?? 'PILOT ONE')}</div>${lines}${c.url ? `<div class="url" style="font-size: ${30 * kt}px">${esc(c.url)}</div>` : ''}</div>`;
}

async function renderOverlays(clips) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: T.css[0], height: T.css[1] }, deviceScaleFactor: T.w / T.css[0] });
  const shot = async (html, path) => {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${STYLE}</style>${html}`);
    await page.screenshot({ path, omitBackground: true });
  };
  for (const [i, c] of clips.entries()) {
    if (c.card) await shot(cardHtml(c), (c.png = join(parts, `card-${i}.png`)));
    else if (c.caption || c.sub) await shot(captionHtml(c), (c.png = join(parts, `cap-${i}.png`)));
  }
  if (edit.thumb) await shot(edit.thumb.html ?? cardHtml({ card: 'thumb', ...edit.thumb }), (edit.thumb.png = join(parts, 'thumb.png')));
  await browser.close();
}

// ------------------------------------------------------------------------------------------------
// video: one intermediate per clip (same size, rate and codec), then concatenated

function renderClip(c, i) {
  const out = join(parts, `clip-${String(i).padStart(3, '0')}.mp4`);
  const D = c.frames / 60;
  const a = [];
  // frame-accurate: seek a quarter frame early, so the first kept frame is exactly c.frame
  if (c.file) a.push('-ss', Math.max(0, (c.frame - 0.25) / 60).toFixed(6), '-i', c.file);
  else a.push('-f', 'lavfi', '-i', `color=c=black:s=${T.w}x${T.h}:r=60`);
  const g = [`[0:v]setpts=PTS-STARTPTS,scale=${T.w}:${T.h}:flags=lanczos,format=yuv420p,setsar=1${c.kind === 'card' ? ',eq=brightness=-0.06' : ''}[b]`];
  let last = 'b';
  if (c.png) {
    a.push('-loop', '1', '-framerate', '60', '-i', c.png);
    const fin = c.kind === 'card' ? 0.4 : 0.2;
    g.push(`[1:v]format=rgba,fade=t=in:st=${fin}:d=0.35:alpha=1,fade=t=out:st=${Math.max(0, D - 0.5).toFixed(3)}:d=0.35:alpha=1,scale=out_color_matrix=bt709:out_range=tv,format=yuva420p[o]`);
    g.push(`[${last}][o]overlay=0:0:shortest=1:format=yuv420[v1]`);
    last = 'v1';
  }
  const fades = [];
  if (c.fade === 'in' || c.fade === 'both') fades.push('fade=t=in:st=0:d=0.3');
  if (c.fade === 'out' || c.fade === 'both') fades.push(`fade=t=out:st=${(D - 0.3).toFixed(3)}:d=0.3`);
  if (fades.length) {
    g.push(`[${last}]${fades.join(',')}[v2]`);
    last = 'v2';
  }
  g.push(`[${last}]${BT709}[vo]`);
  ff([...a, '-filter_complex', g.join(';'), '-map', '[vo]', '-frames:v', String(c.frames), '-r', '60', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', out]);
  return out;
}

// ------------------------------------------------------------------------------------------------
// sound: the stems mixed in Node (float), then loudness-normalised by ffmpeg in two passes

const wavCache = new Map();
function wav(path) {
  if (!wavCache.has(path)) {
    const b = readFileSync(path);
    const n = (b.length - 44) >> 1;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
    wavCache.set(path, x);
  }
  return wavCache.get(path);
}

function writeWavF32(path, x) {
  const b = Buffer.alloc(44 + x.length * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 4, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); // IEEE float
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(32, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 4, 40);
  for (let i = 0; i < x.length; i++) b.writeFloatLE(x[i], 44 + i * 4);
  writeFileSync(path, b);
}

/** Add src[s0 …) into out[o0 …) for n samples, with a fade-in of fi and a fade-out over the last fo samples. */
function place(out, src, s0, o0, n, fi, fo, gain = 1) {
  for (let i = 0; i < n; i++) {
    const o = o0 + i;
    const s = s0 + i;
    if (o < 0 || o >= out.length || s < 0 || s >= src.length) continue;
    let g = gain;
    if (i < fi) g *= i / fi;
    if (i >= n - fo) g *= (n - i) / fo;
    out[o] += src[s] * g;
  }
}

function mixSound(clips, total) {
  const out = new Float32Array(Math.ceil(total * RATE));
  const H = Math.round(HANDLE * RATE);
  const contiguous = (a, b) => a && b && a.kind === 'take' && b.kind === 'take' && a.seg === b.seg && a.audio === b.audio && b.frame === a.frame + a.frames;
  const stem = (c, kind) => join(take.dir, `${c.seg}.${kind}.wav`);
  clips.forEach((c, i) => {
    if (c.kind !== 'take' || c.audio === 'none') return;
    const src = wav(stem(c, c.audio === 'bed' ? 'sfx' : 'mix'));
    const n = Math.round((c.frames / 60) * RATE);
    const joinPrev = contiguous(clips[i - 1], c);
    const joinNext = contiguous(c, clips[i + 1]);
    place(out, src, Math.round((c.frame / 60) * RATE), Math.round(c.start * RATE), n + (joinNext ? 0 : H), joinPrev ? 0 : Math.round(0.008 * RATE), joinNext ? 0 : H);
  });
  // beds: each run of clips on the same bed gets one continuous slice of its music stem
  const cursor = {};
  for (let i = 0; i < clips.length; ) {
    const b = clips[i].bed;
    if (!b) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < clips.length && clips[j + 1].bed === b) j++;
    const bed = edit.beds?.[b];
    if (!bed) throw new Error('no bed named ' + b);
    const s = take.meta.segments.find((x) => x.name === bed.seg);
    const src = wav(join(take.dir, `${bed.seg}.music.wav`));
    const t0 = clips[i].start;
    const len = clips[j].start + clips[j].frames / 60 - t0;
    const at = (cursor[b] ?? bed.at - s.t0) + 0;
    const tail = 1.0;
    place(out, src, Math.round(at * RATE), Math.round(t0 * RATE), Math.round((len + tail) * RATE), Math.round((t0 > 0 ? 0.25 : 0.02) * RATE), Math.round(tail * RATE), 10 ** ((bed.gain || 0) / 20));
    cursor[b] = at + len;
    i = j + 1;
  }
  return out;
}

// Gain to −14 LUFS, then a 4× oversampled peak limiter (about true peak) at −2 dBFS. The game's sound has peaks far
// above its loudness, so loudnorm's linear mode can't reach −14 and falls back to its dynamic mode, which misses the
// target by 1–2 LU. The limiter takes some loudness off, so the gain is measured once more and corrected.
function lufs(input, af) {
  const sum = ffErr(['-i', input, ...(af ? ['-af', af + ',ebur128'] : ['-af', 'ebur128']), '-f', 'null', '-']);
  return +sum.slice(sum.lastIndexOf('Summary:')).match(/I:\s*(-?[\d.]+) LUFS/)[1];
}
function loudnorm(input) {
  const chain = (g) => `volume=${g.toFixed(2)}dB,aresample=176400,alimiter=limit=${10 ** (-2 / 20)}:attack=1:release=60:level=false,aresample=${RATE}`;
  let g = -14 - lufs(input);
  g += -14 - lufs(input, chain(g));
  return chain(g);
}

// ------------------------------------------------------------------------------------------------
// checks (ai/plan_0.md §3.5.4)

function checks(mp4) {
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,color_primaries,sample_rate,channels,bit_rate:format=duration,size', '-of', 'json', mp4]).toString());
  const v = p.streams.find((s) => s.codec_type === 'video');
  const au = p.streams.find((s) => s.codec_type === 'audio');
  const txt = ffErr(['-i', mp4, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const sum = txt.slice(txt.lastIndexOf('Summary:'));
  const I = +(sum.match(/I:\s*(-?[\d.]+) LUFS/) || [])[1];
  const TP = +(sum.match(/Peak:\s*(-?[\d.]+) dBFS/) || [])[1];
  const an = execFileSync('node', [join(ROOT, 'scripts/play/analyze.js'), 'video', mp4, '--sheet', '--out', join(outDir, file + '.analysis')], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const vj = JSON.parse(an);
  const dur = +p.format.duration;
  const MB = +p.format.size / 1e6;
  const res = {
    size: `${v.width}x${v.height}`, fps: v.r_frame_rate, video: `${v.codec_name} ${v.profile} ${v.pix_fmt} ${v.color_primaries}`, audio: `${au.codec_name} ${au.sample_rate} Hz ${au.channels} ch`,
    duration: +dur.toFixed(2), MB: +MB.toFixed(1), lufs: I, truePeak: TP, flashesPerMin: vj.flashesPerMin, flashMax1s: vj.flashMax1s, motion: vj.motion, sheets: vj.sheets,
  };
  const fails = [];
  if (v.width !== T.w || v.height !== T.h) fails.push('size');
  if (v.r_frame_rate !== '60/1') fails.push('fps');
  if (dur < T.len[0] || dur > T.len[1]) fails.push(`duration outside ${T.len.join('–')} s`);
  if (T.maxMB && MB > T.maxMB) fails.push('file size');
  if (Math.abs(I + 14) > 1) fails.push('loudness');
  if (TP > -1) fails.push('true peak');
  if (vj.flashMax1s > 3) fails.push('more than 3 flashes in a second');
  res.fails = fails;
  return res;
}

// ------------------------------------------------------------------------------------------------

const clips = resolveClips().slice(0, args.only ? +args.only : undefined);
const total = clips.reduce((a, c) => a + c.frames / 60, 0);
console.log(`${clips.length} clips, ${mmss(total)} (${total.toFixed(1)} s) → ${join(outDir, file)}.mp4`);
writeFileSync(
  join(outDir, file + '.resolved.json'),
  JSON.stringify(clips.map(({ png, file: f, ...c }) => ({ ...c, start: +c.start.toFixed(3), at: c.from, to: c.to })), null, 1),
);

await renderOverlays(clips);
const list = [];
for (const [i, c] of clips.entries()) {
  process.stdout.write(`\r  clip ${i + 1}/${clips.length}   `);
  list.push(renderClip(c, i));
}
process.stdout.write('\n');
writeFileSync(join(parts, 'list.txt'), list.map((f) => `file '${f}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', join(parts, 'list.txt'), '-c', 'copy', join(parts, 'video.mp4')]);

console.log('mixing sound…');
writeWavF32(join(parts, 'sound.wav'), mixSound(clips, total));
const norm = loudnorm(join(parts, 'sound.wav'));

console.log('encoding…');
const out = join(outDir, file + '.mp4');
const preset = args.draft ? 'veryfast' : 'slow';
ff([
  '-i', join(parts, 'video.mp4'), '-i', join(parts, 'sound.wav'), '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', preset, '-crf', String(T.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...T.x264,
  '-vf', BT709,
  '-af', `${norm},aresample=48000`, '-c:a', 'aac', '-b:a', T.ab, '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', out,
]);

if (edit.thumb) {
  // the hero frame from the take, with the title over it: 1280×720 JPEG under 2 MB
  const s = segOf(edit.thumb.at);
  const png = join(parts, 'thumb-frame.png');
  ff(['-ss', ((edit.thumb.at - s.t0 - 0.25 / 60) || 0).toFixed(6), '-i', join(take.dir, s.name + '.mp4'), '-frames:v', '1', png]);
  const thumb = join(outDir, file + '-thumb.jpg');
  ff(['-i', png, '-i', edit.thumb.png, '-filter_complex', `[0:v]scale=1280:720:flags=lanczos:in_color_matrix=bt709:in_range=tv,format=rgb24[b];[1:v]scale=1280:720:flags=lanczos[o];[b][o]overlay=0:0:format=rgb`, '-q:v', '2', thumb]);
  console.log(`thumbnail ${thumb} (${(statSync(thumb).size / 1e6).toFixed(2)} MB)`);
}

// text for the upload; YouTube chapters from the edit list: 0:00 first, at least 3, each 10 s or longer
const m = edit.meta || {};
let text = '';
if (m.titles) text += 'TITLE OPTIONS\n' + m.titles.map((t) => '- ' + t).join('\n') + '\n\n';
if (m.post) text += 'POST\n' + m.post + '\n\n';
if (m.description) text += 'DESCRIPTION\n' + m.description + '\n';
const chapters = clips.filter((c) => c.chapter).map((c) => [c.start, c.chapter]);
if (chapters.length) {
  const bad = chapters.length < 3 || chapters[0][0] !== 0 || chapters.some(([t], i) => (chapters[i + 1]?.[0] ?? total) - t < 10);
  if (bad) console.warn('warning: chapters need 0:00 first, at least 3, each 10 s or longer');
  text += '\nCHAPTERS\n' + chapters.map(([t, n]) => `${mmss(t)} ${n}`).join('\n') + '\n';
}
if (m.tags) text += '\nTAGS\n' + m.tags.join(', ') + '\n';
writeFileSync(join(outDir, file + '.txt'), text);

console.log('checking…');
const res = checks(out);
writeFileSync(join(outDir, file + '.checks.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, sheets: undefined }, null, 1));
console.log(res.fails.length ? 'FAILS: ' + res.fails.join(', ') : 'all checks pass');
if (!args.keep) rmSync(parts, { recursive: true, force: true });
