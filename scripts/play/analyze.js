#!/usr/bin/env node
// Engagement metrics for gameplay videos and for our telemetry.
//
//   node scripts/play/analyze.js video <file> [--from s] [--to s] [--crop auto|w:h:x:y] [--label name]
//                                      [--sheet] [--out recordings/analysis]
//   node scripts/play/analyze.js telemetry <file.telemetry.json> [--label name] [--height 720]
//   node scripts/play/analyze.js chart <a.video.json> <b.video.json> ... [--file out.svg]
//   node scripts/play/analyze.js highlights <take dir> [--top 12]
//   node scripts/play/analyze.js highlights --rank <take dir> <take dir> ...
//   node scripts/play/analyze.js campaign <take dir> <take dir> ... [--label name]
//
// "video" measures the same things on every video, from pixels and sound only (so any two videos are
// comparable): motion energy over time, explosion/flash events, audio onsets (shots, hits, explosions), loudness
// range and lulls.
// "telemetry" reads our game's own records: what was on screen, kill cadence, enemy fire by class with its escape
// time, shot travel time, and hit fairness (was the culprit visible / marked before impact).
// "highlights" reads a take (record.js --campaign: a folder with telemetry.json and meta.json) and writes
// highlights.json: tagged moments (power, aligned, evade, bomb, boss-part, boss-kill, hulk, chain4, medal5k, stage-S,
// locclear, section:<id>, intensity) and windows to avoid (lost ships, hits, lessons, lulls), each with its game
// time, video segment and frame, for the video editor (scripts/play/edit.js). --rank scores takes for showcase use.
// "campaign" reads whole-campaign takes (record.js --campaign) and tabulates the ai/plan_1.md §3 targets per run: the
// first FULL, time at each power level, the climb back after a lost ship, POWs caught, empty screens, enemy fire, the
// longest gap with no kill, bosses, extra ships.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [cmd, ...rest] = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    args[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  } else args._.push(rest[i]);
}
const OUT = args.out || 'recordings/analysis';
mkdirSync(OUT, { recursive: true });

const stats = (arr) => {
  if (!arr.length) return { n: 0, mean: 0, p10: 0, p50: 0, p90: 0, max: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  const r = (v) => +v.toFixed(2);
  return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p10: r(q(0.1)), p50: r(q(0.5)), p90: r(q(0.9)), max: r(s[s.length - 1]) };
};

// ------------------------------------------------------------------------------------------------
// video

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  return { w: v.width, h: v.height, duration: +j.format.duration, audio: j.streams.some((s) => s.codec_type === 'audio') };
}

function detectCrop(file, from) {
  const txt = stderrOf('ffmpeg', ['-v', 'info', '-ss', String(from + 5), '-i', file, '-t', '8', '-vf', 'cropdetect=limit=40:round=2:reset=0', '-an', '-f', 'null', '-']);
  const m = [...txt.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)].map((x) => x[1]);
  if (!m.length) return null;
  const counts = {};
  for (const c of m) counts[c] = (counts[c] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function stderrOf(bin, a) {
  return spawnSync(bin, a, { encoding: 'utf8', maxBuffer: 256 << 20 }).stderr || '';
}

function frames(file, { from, to, crop, w, h, fps }, onFrame) {
  return new Promise((ok, fail) => {
    const vf = [crop ? `crop=${crop}` : null, `fps=${fps}`, `scale=${w}:${h}:flags=area`].filter(Boolean).join(',');
    const a = ['-v', 'error', '-ss', String(from), '-i', file, '-t', String(to - from), '-an', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
    const ff = spawn('ffmpeg', a, { stdio: ['ignore', 'pipe', 'inherit'] });
    const FS = w * h * 3;
    let buf = Buffer.alloc(0);
    let n = 0;
    ff.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= FS) {
        onFrame(buf.subarray(0, FS), n++);
        buf = buf.subarray(FS);
      }
    });
    ff.on('close', (c) => (c === 0 ? ok(n) : fail(new Error('ffmpeg ' + c))));
  });
}

function audioSamples(file, from, to, rate = 22050) {
  return new Promise((ok) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-ss', String(from), '-i', file, '-t', String(to - from), '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.on('close', () => {
      const b = Buffer.concat(chunks);
      const out = new Float32Array(b.length >> 1);
      for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(i * 2) / 32768;
      ok(out);
    });
  });
}

/** Energy-flux onsets (shots, hits, explosions): count per minute. */
function onsets(x, rate) {
  const hop = 256;
  const win = 512;
  const e = [];
  for (let i = 0; i + win < x.length; i += hop) {
    let s = 0;
    for (let j = 0; j < win; j++) s += x[i + j] * x[i + j];
    e.push(Math.log10(1e-9 + s / win));
  }
  const flux = e.map((v, i) => (i ? Math.max(0, v - e[i - 1]) : 0));
  const hopT = hop / rate;
  const W = Math.round(1 / hopT); // 1 s window for the adaptive threshold
  const out = [];
  let last = -1;
  for (let i = 1; i < flux.length - 1; i++) {
    if (e[i] < -4.5) continue; // silence
    const a = Math.max(0, i - W);
    const b = Math.min(flux.length, i + W);
    let m = 0;
    let m2 = 0;
    for (let k = a; k < b; k++) {
      m += flux[k];
      m2 += flux[k] * flux[k];
    }
    m /= b - a;
    const sd = Math.sqrt(Math.max(0, m2 / (b - a) - m * m));
    if (flux[i] > m + 1.5 * sd && flux[i] > 0.12 && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && (last < 0 || (i - last) * hopT > 0.06)) {
      out.push(i * hopT);
      last = i;
    }
  }
  return out;
}

function loudnessRange(file, from, to) {
  const txt = stderrOf('ffmpeg', ['-v', 'info', '-ss', String(from), '-i', file, '-t', String(to - from), '-vn', '-af', 'ebur128', '-f', 'null', '-']);
  // the summary comes last (per-frame lines also print LRA / I)
  const summary = txt.slice(txt.lastIndexOf('Summary:'));
  const lra = summary.match(/LRA:\s*([\d.]+) LU/);
  const I = summary.match(/I:\s*(-?[\d.]+) LUFS/);
  return { lra: lra ? +lra[1] : null, integrated: I ? +I[1] : null };
}

async function analyzeVideo(file) {
  const info = probe(file);
  const from = +(args.from || 0);
  const to = Math.min(info.duration, +(args.to || info.duration));
  const label = args.label || basename(file).replace(/\.[^.]+$/, '');
  let crop = args.crop && args.crop !== 'auto' && args.crop !== 'none' ? args.crop : null;
  if (!crop && args.crop !== 'none') {
    const c = detectCrop(file, from);
    // only crop when there are real bars (pillarboxed videos)
    if (c) {
      const [cw, ch] = c.split(':').map(Number);
      if (cw < info.w * 0.92 || ch < info.h * 0.92) crop = c;
    }
  }
  const [cw, ch] = crop ? crop.split(':').map(Number) : [info.w, info.h];
  const W = 240;
  const H = Math.round((W * ch) / cw / 2) * 2;
  const FPS = 10;
  let prev = null;
  const motion = []; // per frame
  const warm = [];
  await frames(file, { from, to, crop, w: W, h: H, fps: FPS }, (f) => {
    let diff = 0;
    let hot = 0;
    const n = W * H;
    for (let p = 0, q = 0; p < n; p++, q += 3) {
      const r = f[q];
      const g = f[q + 1];
      const b = f[q + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (prev) diff += Math.abs(l - prev[p]);
      if (r > 215 && g > 120 && b < 170 && r - b > 60) hot++;
      (prev ||= new Float32Array(n))[p] = l;
    }
    motion.push(diff / n);
    warm.push(hot / n);
  });
  // flash / explosion onsets: a jump in bright warm pixels
  const flashes = [];
  for (let i = 1; i < warm.length; i++) {
    if (warm[i] - warm[i - 1] > 0.0015 && warm[i] > 0.002 && (!flashes.length || (i - flashes[flashes.length - 1]) / FPS > 0.3)) flashes.push(i);
  }
  const secs = Math.floor(motion.length / FPS);
  const motionPerSec = [];
  for (let s = 0; s < secs; s++) motionPerSec.push(+(motion.slice(s * FPS, (s + 1) * FPS).reduce((a, b) => a + b, 0) / FPS).toFixed(2));
  // audio
  let onsetTimes = [];
  let loud = { lra: null, integrated: null };
  if (info.audio && !args['no-audio']) {
    const rate = 22050;
    const x = await audioSamples(file, from, to, rate);
    onsetTimes = onsets(x, rate);
    loud = loudnessRange(file, from, to);
  }
  // lulls: seconds with no flash and no audio onset and below-median motion, grouped into runs
  const busy = new Array(secs).fill(false);
  for (const f of flashes) busy[Math.floor(f / FPS)] = true;
  for (const t of onsetTimes) if (Math.floor(t) < secs) busy[Math.floor(t)] = true;
  const medMotion = stats(motionPerSec).p50;
  const runs = [];
  let run = 0;
  for (let s = 0; s < secs; s++) {
    const quiet = !busy[s] && motionPerSec[s] <= medMotion;
    if (quiet) run++;
    else {
      if (run) runs.push(run);
      run = 0;
    }
  }
  if (run) runs.push(run);
  const minutes = (to - from) / 60;
  const res = {
    label,
    file,
    from,
    to,
    crop,
    minutes: +minutes.toFixed(2),
    motion: stats(motionPerSec),
    motionPerSec,
    flashesPerMin: +(flashes.length / minutes).toFixed(1),
    // the photosensitivity guideline: no more than 3 flashes in any 1 s
    flashMax1s: flashes.reduce((m, f, i) => Math.max(m, flashes.filter((g) => g >= f && g < f + FPS).length), 0),
    flashGap: stats(flashes.slice(1).map((f, i) => (f - flashes[i]) / FPS)),
    audioOnsetsPerMin: info.audio ? +(onsetTimes.length / minutes).toFixed(1) : null,
    onsetGap: stats(onsetTimes.slice(1).map((t, i) => t - onsetTimes[i])),
    loudness: loud,
    lulls: { longest: Math.max(0, ...runs), over3s: runs.filter((r) => r >= 3).length, pctTimeInLulls3s: +((100 * runs.filter((r) => r >= 3).reduce((a, b) => a + b, 0)) / Math.max(1, secs)).toFixed(1) },
  };
  if (args.sheet) res.sheets = sheets(file, from, to, crop, label);
  writeFileSync(join(OUT, label + '.video.json'), JSON.stringify(res, null, 1));
  const { motionPerSec: _m, ...brief } = res;
  console.log(JSON.stringify(brief, null, 1));
}

function sheets(file, from, to, crop, label) {
  const vf = [crop ? `crop=${crop}` : null, 'fps=1/2', 'scale=-2:300', "drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=13:fontcolor=yellow:box=1:boxcolor=black@0.6", 'tile=3x3'].filter(Boolean).join(',');
  const pattern = join(OUT, `${label}_sheet_%02d.jpg`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(from), '-i', file, '-t', String(to - from), '-an', '-vf', vf, pattern]);
  return pattern;
}

// ------------------------------------------------------------------------------------------------
// telemetry

function analyzeTelemetry(file) {
  const t = JSON.parse(readFileSync(file, 'utf8'));
  const label = args.label || basename(file).replace(/\.telemetry\.json$/, '');
  const H = +(args.height || 720);
  const C = Object.fromEntries(t.columns.map((c, i) => [c, i]));
  const S = t.samples.filter((r) => r[C.alive]);
  const ev = (type) => t.events.filter((e) => e.ev === type);
  const t0 = t.samples.length ? t.samples[0][C.t] : 0;
  const t1 = t.samples.length ? t.samples[t.samples.length - 1][C.t] : 0;
  const minutes = (t1 - t0) / 60;
  const col = (k) => S.map((r) => r[C[k]]);
  const kills = ev('kill').map((e) => e.t);
  const killGaps = kills.slice(1).map((k, i) => k - kills[i]);
  const hits = ev('hit');
  const fair = hits.filter((h) => (h.age ?? 0) >= 0.4 && (h.markedFor ?? 0) >= 0.3);
  const efire = ev('efire');
  const byCls = {};
  for (const e of efire) {
    const c = e.cls || 'medium';
    (byCls[c] ||= []).push(e.sp > 0 ? e.d / e.sp : 0);
  }
  const shotAges = ev('shothit').map((e) => e.age);
  const shotDist = ev('shothit').map((e) => e.d);
  const projectiles = S.map((r) => r[C.bullets] + (r[C.shells] || 0) + (r[C.missiles] || 0));
  const firing = S.filter((r) => r[C.bolts] > 0);
  const res = {
    label,
    minutes: +minutes.toFixed(2),
    score: t.samples.length ? t.samples[t.samples.length - 1][C.score] : 0,
    enemiesOnScreen: { ...stats(col('enemies')), zeroPct: +((100 * col('enemies').filter((v) => !v).length) / Math.max(1, S.length)).toFixed(1) },
    targetsOnScreen: stats(S.map((r) => r[C.enemies] + r[C.rocks] + (r[C.fields] ? 1 : 0))),
    enemyProjectilesOnScreen: { ...stats(projectiles), zeroPct: +((100 * projectiles.filter((v) => !v).length) / Math.max(1, S.length)).toFixed(1) },
    bulletsOnScreen: stats(col('bullets')),
    shellsOnScreen: stats(col('shells')),
    missilesOnScreen: stats(col('missiles')),
    playerBoltsOnScreen: stats(col('bolts')),
    streamCoverage: { ...stats(firing.map((r) => r[C.streamPx] / H)), pctFramesOver25: +((100 * firing.filter((r) => r[C.streamPx] / H >= 0.25).length) / Math.max(1, firing.length)).toFixed(1), boltsVisiblePctWhileFiring: +((100 * firing.length) / Math.max(1, S.length)).toFixed(1) },
    killsPerMin: +(kills.length / minutes).toFixed(1),
    killGap: stats(killGaps),
    kills: kills.length,
    killsBy: countBy(ev('kill'), 'by'),
    spawned: ev('spawn').length,
    escaped: ev('escape').length,
    fieldRocksBroken: ev('field').length,
    enemyFirePerMin: Object.fromEntries(Object.entries(byCls).map(([k, v]) => [k, +(v.length / minutes).toFixed(1)])),
    enemyFireEscapeTime: Object.fromEntries(Object.entries(byCls).map(([k, v]) => [k, stats(v.filter((x) => x > 0))])),
    playerShotTravel: { age: stats(shotAges), distance: stats(shotDist) },
    speedRatio: null,
    hits: hits.length,
    hitsPerMin: +(hits.length / minutes).toFixed(2),
    hitsBy: countBy(hits, 'src'),
    fairHitsPct: hits.length ? +((100 * fair.length) / hits.length).toFixed(0) : null,
    hitAge: stats(hits.map((h) => h.age ?? 0)),
    hitMarked: stats(hits.map((h) => h.markedFor ?? 0)),
    deaths: hits.filter((h) => h.shield <= 0).length,
    pickups: countBy(ev('pickup'), 'type'),
    bombs: ev('bomb').length,
    clear: ev('locclear').at(-1) || null,
    locations: ev('locclear'),
    ending: ev('end')[0] || null,
    lessons: lessonSummary(t.events),
    evades: ev('evade').length,
    dodges: countBy(ev('dodge'), 'src'),
    // plan 4: the death spiral, the score loop
    recoverToQuad: stats(ev('recover').filter((e) => e.to === 2).map((e) => e.s)),
    recoverFull: stats(ev('recover').filter((e) => e.full).map((e) => e.s)),
    deathsWithPower: ev('power').filter((e) => e.lost).length,
    rescues: ev('rescue').length,
    medals: { caught: ev('pickup').filter((e) => e.type === 'medal').length, missed: ev('medalmiss').length },
    maxChain: Math.max(0, ...ev('kill').map((e) => e.chain || 0)),
    secondPassKills: ev('kill').filter((e) => e.pass).length,
    stages: stageTable(t, C),
  };
  writeFileSync(join(OUT, label + '.telemetry-metrics.json'), JSON.stringify(res, null, 1));
  const { stages, ...rest } = res;
  console.log(JSON.stringify(rest, null, 1));
  console.table(stages);
  console.table(locationTable(stages));
}

/** Per location (ai/summary.md §12 targets): hits and deaths, enemy fire on screen. */
function locationTable(stages) {
  const out = new Map();
  for (const s of stages) {
    const loc = String(s.stage).split('-')[0];
    const o = out.get(loc) || { loc, seconds: 0, hits: 0, deaths: 0, bulletsMean: 0, enemiesMean: 0, noKillMax: 0, shotDown: [0, 0] };
    o.bulletsMean += (s.bulletsMean || 0) * s.seconds;
    o.enemiesMean += (s.enemiesMean || 0) * s.seconds;
    o.noKillMax = Math.max(o.noKillMax, s.noKillMax || 0);
    o.seconds += s.seconds;
    o.hits += s.hits;
    o.deaths += s.deaths;
    const [k, n] = (s.shotDown || '0/0').split('/').map(Number);
    o.shotDown[0] += k;
    o.shotDown[1] += n;
    out.set(loc, o);
  }
  return [...out.values()].map((o) => ({
    ...o,
    bulletsMean: +(o.bulletsMean / Math.max(1, o.seconds)).toFixed(1),
    enemiesMean: +(o.enemiesMean / Math.max(1, o.seconds)).toFixed(1),
    shotDown: o.shotDown[1] ? `${Math.round((100 * o.shotDown[0]) / o.shotDown[1])}%` : '',
  }));
}

/** Per stage (ai/summary.md §12 targets): enemy fire on screen, hits, kills, power, lessons. */
function stageTable(t, C) {
  if (C.stage === undefined) return [];
  const rows = new Map();
  const row = (n) => {
    if (!rows.has(n)) rows.set(n, { stage: n, seconds: 0, bullets: [], enemies: 0, samples: 0, hits: [], deaths: 0, killed: 0, spawned: 0, raw: 0, maxChain: 0, medals: 0, t0: null, lastKill: null, maxGap: 0, powerEnd: 0, lessonsDone: 0, lessonsMissed: 0, repeats: 0, evades: 0, dodges: 0, blocked: 0, anyBlocked: 0, stillHit: 0, blockers: 0, blockersMarked: 0, threats: 0 });
    return rows.get(n);
  };
  // stages are numbered per location ("2-4"); older recordings have no location column (location 1)
  const key = (loc, n) => `${loc || 1}-${n}`;
  for (const r of t.samples) {
    if (!r[C.alive] || !r[C.stage]) continue;
    const o = row(key(r[C.loc], r[C.stage]));
    o.samples++;
    o.bullets.push(r[C.bullets] + (r[C.shells] || 0) + (r[C.missiles] || 0));
    o.enemies += r[C.enemies];
    o.powerEnd = r[C.power];
    if (C.blocked !== undefined) {
      o.blocked += r[C.blocked];
      o.anyBlocked += r[C.blocked] > 0 ? 1 : 0;
      o.stillHit += r[C.stillHit];
      o.blockers += r[C.blockers];
      o.blockersMarked += r[C.blockersMarked];
      o.threats += r[C.threats];
    }
  }
  let n = 0;
  for (const e of t.events) {
    if (e.ev === 'stage' && e.n) {
      n = key(e.loc, e.n);
      const s = row(n);
      s.t0 = s.lastKill = e.t;
    }
    if (!n) continue;
    const o = row(n);
    // the longest stretch with no kill (from the stage start; boss and hulk parts count)
    if (e.ev === 'kill' || e.ev === 'stageclear' || e.ev === 'locclear') {
      if (o.lastKill !== null) o.maxGap = Math.max(o.maxGap, e.t - o.lastKill);
      if (e.ev === 'kill') o.lastKill = e.t;
    }
    if (e.ev === 'hit') {
      o.hits.push(e.src);
      if (e.shield <= 0) o.deaths++;
    } else if (e.ev === 'stageclear') {
      o.killed = e.killed;
      o.spawned = e.spawned;
      o.raw = e.raw ?? e.spawned;
      o.maxChain = e.maxChain ?? 0;
      o.medals = e.medals ?? 0;
    } else if (e.ev === 'lesson') {
      if (e.what === 'done') o.lessonsDone++;
      else if (e.what === 'repeat') o.repeats++;
      else if (e.what !== 'shown') o.lessonsMissed++;
    } else if (e.ev === 'evade') o.evades++;
    else if (e.ev === 'dodge') o.dodges++;
  }
  return [...rows.values()].map((o) => {
    const b = stats(o.bullets);
    return {
      stage: o.stage,
      seconds: Math.round(o.samples / 4),
      bulletsMean: b.mean,
      bulletsP90: b.p90,
      enemiesMean: +(o.enemies / Math.max(1, o.samples)).toFixed(1),
      hits: o.hits.length,
      hitsBy: o.hits.join(' '),
      deaths: o.deaths,
      shotDown: o.spawned ? `${o.killed}/${o.spawned}` : '',
      raw: o.raw,
      noKillMax: +o.maxGap.toFixed(1),
      maxChain: o.maxChain,
      medals: o.medals,
      powerEnd: o.powerEnd,
      lessons: `${o.lessonsDone} done, ${o.lessonsMissed} missed, ${o.repeats} repeats`,
      evades: o.evades,
      dodges: o.dodges,
      // dodge probe (telemetry.js probe): directions blocked within 0.6 s (of 8), % of moments any is blocked,
      // % standing still is hit within 1 s, % of blocking hazards marked, real threats among the bullets on screen
      blockedDirs: +(o.blocked / Math.max(1, o.samples)).toFixed(2),
      anyBlockedPct: Math.round((100 * o.anyBlocked) / Math.max(1, o.samples)),
      stillHitPct: Math.round((100 * o.stillHit) / Math.max(1, o.samples)),
      blockersMarkedPct: o.blockers ? Math.round((100 * o.blockersMarked) / o.blockers) : null,
      threatsMean: +(o.threats / Math.max(1, o.samples)).toFixed(2),
    };
  });
}

function lessonSummary(events) {
  const out = {};
  for (const e of events) {
    if (e.ev !== 'lesson') continue;
    const o = (out[e.id] ||= { repeats: 0 });
    if (e.what === 'repeat') o.repeats++;
    else if (e.what !== 'shown') {
      o.result = e.what;
      o.after = e.after;
    }
  }
  return out;
}

function countBy(list, key) {
  const o = {};
  for (const e of list) o[e[key]] = (o[e[key]] || 0) + 1;
  return o;
}

// ------------------------------------------------------------------------------------------------
// chart: per-second motion energy (or a telemetry column) for several runs, as an SVG line chart

function chart(files) {
  const series = files.map((f) => {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return { label: j.label, ys: smooth(j.motionPerSec || [], 5) };
  });
  const W = 900;
  const Hh = 300;
  const pad = 52;
  const maxX = Math.max(...series.map((s) => s.ys.length));
  // the first seconds are a scene cut (title screen → game) that would set the scale: scale to the rest and clip it
  const maxY = Math.max(1, ...series.flatMap((s) => s.ys.slice(8)));
  const colors = ['#2a78d6', '#e2732b', '#2aa876', '#a84bd1', '#c23b4b'];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="system-ui, sans-serif" font-size="12">`;
  svg += `<rect width="${W}" height="${Hh}" fill="#ffffff"/>`;
  svg += `<line x1="${pad}" y1="${Hh - pad}" x2="${W - 10}" y2="${Hh - pad}" stroke="#999"/><line x1="${pad}" y1="10" x2="${pad}" y2="${Hh - pad}" stroke="#999"/>`;
  for (let s = 0; s <= maxX; s += 30) svg += `<text x="${pad + ((W - pad - 10) * s) / maxX}" y="${Hh - pad + 16}" text-anchor="middle" fill="#555">${s}s</text>`;
  for (const f of [0, 0.5, 1]) svg += `<text x="${pad - 5}" y="${Hh - pad - (Hh - pad - 10) * f + 4}" text-anchor="end" fill="#555">${+(maxY * f).toFixed(1)}</text>`;
  svg += `<text x="10" y="${Hh / 2}" transform="rotate(-90 10 ${Hh / 2})" text-anchor="middle" fill="#555">motion energy (5 s mean)</text>`;
  series.forEach((s, k) => {
    const pts = s.ys.map((y, i) => `${(pad + ((W - pad - 10) * i) / maxX).toFixed(1)},${(Hh - pad - ((Hh - pad - 10) * Math.min(y, maxY)) / maxY).toFixed(1)}`).join(' ');
    svg += `<polyline fill="none" stroke="${colors[k % colors.length]}" stroke-width="2" points="${pts}"/>`;
    svg += `<text x="${W - 16}" y="${20 + k * 16}" text-anchor="end" fill="${colors[k % colors.length]}">${s.label}</text>`;
  });
  svg += '</svg>';
  const out = args.file || join(OUT, 'motion.svg');
  writeFileSync(out, svg);
  console.log('wrote', out);
}

function smooth(a, k) {
  return a.map((_, i) => {
    const s = a.slice(Math.max(0, i - k + 1), i + 1);
    return s.reduce((x, y) => x + y, 0) / s.length;
  });
}

// ------------------------------------------------------------------------------------------------
// highlights (ai/plan_0.md §3.4)

const POWER = ['SINGLE', 'TWIN', 'QUAD', 'MISSILES', 'SPIRAL', 'FULL']; // src/game/player.js

function readTake(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const tm = JSON.parse(readFileSync(join(dir, 'telemetry.json'), 'utf8'));
  return { meta, tm, C: Object.fromEntries(tm.columns.map((c, i) => [c, i])) };
}

/** The video segment showing game time t, and the frame in it. */
function locate(meta, t) {
  for (const s of meta.segments || []) {
    if (s.t0 === null) continue;
    const f = Math.round((t - s.t0) * 60);
    if (f >= 0 && f < s.frames) return { seg: s.name, frame: f, film: s.film };
  }
  return { seg: null, frame: null, film: false };
}

function takeHighlights(dir) {
  const { meta, tm, C } = readTake(dir);
  const E = tm.events;
  const ev = (k) => E.filter((e) => e.ev === k);
  const out = [];
  const add = (tag, t, from, to, info = {}) => out.push({ tag, t: +t.toFixed(3), from: +from.toFixed(3), to: +to.toFixed(3), ...locate(meta, t), ...info });

  for (const e of ev('power')) if (e.level >= 4) add('power', e.t, e.t - 1, e.t + 4, { level: POWER[e.level] });
  for (const e of ev('power')) if (e.level >= 1 && e.level < 4) add('power-low', e.t, e.t - 1, e.t + 3, { level: POWER[e.level] });
  for (const e of ev('pickup')) if (e.type === 'laser') add('laser', e.t, e.t - 0.5, e.t + 6);
  const aligned = ev('kill').filter((e) => e.aligned);
  for (let i = 0; i < aligned.length; i++) {
    let j = i;
    while (j + 1 < aligned.length && aligned[j + 1].t - aligned[i].t <= 3) j++;
    if (j - i >= 2) {
      add('aligned', aligned[i].t, aligned[i].t - 2, aligned[j].t + 1, { kills: j - i + 1 });
      i = j;
    }
  }
  let section = null;
  const sectionAt = [];
  for (const e of E) {
    if (e.ev === 'section') {
      section = e.id;
      sectionAt.push(e);
    }
    if (e.ev === 'evade') add('evade', e.t, e.t - 1.5, e.t + 1.5, { section });
    if (e.ev === 'bomb') add(e.bullets >= 8 ? 'bomb' : 'bomb-small', e.t, e.t - 1.5, e.t + 3, { bullets: e.bullets });
    if (e.ev === 'boss' && e.part) add(e.core ? 'boss-kill' : 'boss-part', e.t, e.t - 2, e.t + (e.core ? 5 : 1.5), { name: e.name, part: e.part });
    if (e.ev === 'boss' && e.escaped) add('boss-escaped', e.t, e.t - 2, e.t + 3, { name: e.name });
    if (e.ev === 'hulk' && e.killed) add('hulk', e.t, e.t - 3, e.t + 2, { type: e.type });
    if (e.ev === 'pickup' && e.type === 'medal' && e.value >= 5000) add('medal5k', e.t, e.t - 3, e.t + 1.5, { value: e.value });
    if (e.ev === 'stageclear' && e.grade === 'S') add('stage-S', e.t, e.t - 1, e.t + 4, { loc: e.loc, n: e.n });
    if (e.ev === 'locclear') add('locclear', e.t, e.t - 1, e.t + 4, { loc: e.loc });
    if (e.ev === 'kill' && e.chain === 50) add('chain4', e.t, e.t - 2, e.t + 2);
  }
  sectionAt.forEach((e, i) => add('section:' + e.id, e.t, e.t, sectionAt[i + 1]?.t ?? e.t + 30));

  // windows to keep out of the edit
  const avoid = [];
  const shun = (why, from, to) => avoid.push({ why, from: +from.toFixed(3), to: +to.toFixed(3) });
  for (const e of ev('hit')) shun('hit', e.t - 2, e.t + 1);
  let lives = null;
  for (const r of tm.samples) {
    if (lives !== null && r[C.lives] < lives) shun('lost ship', r[C.t] - 4, r[C.t] + 4);
    lives = r[C.lives];
  }
  const shown = {};
  for (const e of ev('lesson')) {
    if (e.what === 'shown') shown[e.id] = e.t;
    else if (shown[e.id] !== undefined) {
      shun('lesson', shown[e.id], e.t + 1);
      delete shown[e.id];
    }
  }
  const kills = ev('kill').map((e) => e.t);
  // a gap with no kill in play (not across a held screen: the location clear and star map, or a game over)
  const held = E.filter((e) => e.ev === 'locclear' || e.ev === 'over').map((e) => e.t);
  for (let i = 1; i < kills.length; i++) {
    if (kills[i] - kills[i - 1] > 4 && !held.some((t) => t > kills[i - 1] && t < kills[i])) shun('lull', kills[i - 1] + 1.5, kills[i] - 0.5);
  }

  // intensity: enemies + enemy bullets on screen + kills, per second; the best 5 s windows are the hooks
  const per = new Map();
  for (const r of tm.samples) {
    if (!r[C.alive]) continue;
    const k = Math.floor(r[C.t]);
    per.set(k, (per.get(k) || 0) + (r[C.enemies] + r[C.bullets] * 0.5) / 4);
  }
  for (const t of kills) per.set(Math.floor(t), (per.get(Math.floor(t)) || 0) + 1.5);
  const secs = [...per.keys()].sort((a, b) => a - b);
  const win = [];
  for (const k of secs) {
    let sc = 0;
    for (let j = 0; j < 5; j++) sc += per.get(k + j) || 0;
    win.push({ k, sc });
  }
  win.sort((a, b) => b.sc - a.sc);
  const overlaps = (a0, a1) => avoid.some((w) => w.from < a1 && w.to > a0);
  const picked = [];
  for (const w of win) {
    if (picked.length >= +(args.top || 12)) break;
    if (overlaps(w.k, w.k + 5) || picked.some((p) => Math.abs(p.k - w.k) < 8)) continue;
    picked.push(w);
    add('intensity', w.k + 2.5, w.k, w.k + 5, { score: +w.sc.toFixed(1) });
  }
  for (const h of out) h.clean = !overlaps(h.from, h.to);
  out.sort((a, b) => a.t - b.t);
  return { meta, tm, highlights: out, avoid };
}

function highlights(dirs) {
  if (!args.rank) {
    const dir = dirs[0];
    const { highlights: H, avoid } = takeHighlights(dir);
    writeFileSync(join(dir, 'highlights.json'), JSON.stringify({ highlights: H, avoid }, null, 1));
    const n = countBy(H, 'tag');
    console.log(`${H.length} highlights (${H.filter((h) => h.clean).length} clean), ${avoid.length} windows to avoid → ${join(dir, 'highlights.json')}`);
    console.log(Object.entries(n).map(([k, v]) => `${k} ${v}`).join(' · '));
    return;
  }
  // --rank (ai/plan_0.md §3.3): a good take reaches location 5 without a continue, holds SPIRAL/FULL, has S grades,
  // a ×4 chain and a 5,000 medal, and reaches the Dreadnought
  const rows = dirs.map((dir) => {
    const { meta, tm, highlights: H, avoid } = takeHighlights(dir);
    const C = Object.fromEntries(tm.columns.map((c, i) => [c, i]));
    const reached = Math.max(0, ...tm.samples.map((r) => r[C.loc]));
    const continues = tm.events.filter((e) => e.ev === 'over').length - (meta.endReason === 'game over' ? 1 : 0);
    const highPower = tm.samples.filter((r) => r[C.power] >= 4).length / 4;
    const tag = (k) => H.filter((h) => h.tag === k).length;
    const dread = tm.events.some((e) => e.ev === 'boss' && /dreadnought/i.test(e.name || ''));
    const lost = avoid.filter((w) => w.why === 'lost ship').length;
    const firstContinueLoc = (() => {
      const o = tm.events.find((e) => e.ev === 'over');
      if (!o) return null;
      const s = tm.samples.find((r) => r[C.t] >= o.t);
      return s ? s[C.loc] : reached;
    })();
    const score = reached * 10 + (firstContinueLoc === null || firstContinueLoc >= 5 ? 15 : firstContinueLoc * 2) + highPower / 30 + tag('stage-S') * 2 + Math.min(3, tag('chain4')) * 2 + Math.min(3, tag('medal5k')) * 2 + (dread ? 10 : 0) + tag('bomb') - lost * 1.5;
    return {
      take: basename(dir), seed: meta.seed, size: meta.size?.join?.('x'), reached, continues, firstContinueAt: firstContinueLoc, end: meta.endReason,
      'SPIRAL+ s': Math.round(highPower), S: tag('stage-S'), chain4: tag('chain4'), medal5k: tag('medal5k'), bombs: tag('bomb'), evades: tag('evade'), lost, dreadnought: dread, score: +score.toFixed(1),
    };
  });
  rows.sort((a, b) => b.score - a.score);
  console.table(rows);
  // one file per take size, so ranking the portrait takes doesn't overwrite the landscape ranking
  const sizes = [...new Set(rows.map((r) => r.size))].join('+');
  writeFileSync(join(OUT, `rank-${sizes}.json`), JSON.stringify(rows, null, 1));
}

// ------------------------------------------------------------------------------------------------
// campaign (ai/plan_1.md §3): power over a whole run, empty screens, enemy fire, bosses, for several takes at once

const EXTRA_LIVES = [150000, 450000, 900000, 1500000, 2250000, 3000000]; // src/game/game.js
const ENEMY_FIRE = new Set(['bullet', 'shell', 'missile']);
const median = (a) => (a.length ? stats(a).p50 : null);

function campaignRun(dir) {
  const { meta, tm, C } = readTake(dir);
  const E = tm.events;
  const S = tm.samples;
  const t0 = S.length ? S[0][C.t] : 0;
  // location at time t, from the stage events
  const marks = E.filter((e) => e.ev === 'stage' && e.loc).map((e) => [e.t, e.loc]);
  const locAt = (t) => {
    let l = 1;
    for (const [mt, ml] of marks) if (mt <= t) l = ml;
    return l;
  };
  const L = (n) => (out.loc[n] ||= { samples: 0, empty: 0, lv: [0, 0, 0, 0, 0, 0], drops: {}, caught: 0, hits: 0, enemyHits: 0, lost: 0, pulls: 0 });
  const out = { take: basename(dir), skill: meta.skill, seed: meta.seed, end: meta.endReason, loc: {} };
  const sections = {};
  const l1late = [];
  for (const r of S) {
    if (!r[C.alive]) continue;
    const o = L(r[C.loc]);
    o.samples++;
    o.lv[r[C.power]]++;
    if (!r[C.enemies]) o.empty++;
    const sk = `${r[C.loc]}:${r[C.section]}`;
    const so = (sections[sk] ||= { n: 0, empty: 0 });
    so.n++;
    if (!r[C.enemies]) so.empty++;
    if (r[C.loc] === 1 && r[C.stage] >= 4) l1late.push(r[C.bullets] + (r[C.shells] || 0) + (r[C.missiles] || 0));
  }
  // power: the first FULL, and the climb back after each lost ship
  const pw = E.filter((e) => e.ev === 'power');
  const firstFull = pw.find((e) => e.level === 5);
  const back = { full: [], fullOpen: 0, before: [], beforeOpen: 0 };
  pw.forEach((e, i) => {
    if (!e.lost) return;
    const again = pw.slice(i + 1).find((f) => f.lost || f.level >= e.lost);
    const ok = again && !again.lost;
    const k = e.lost === 5 ? 'full' : null;
    if (k) ok ? back.full.push(again.t - e.t) : back.fullOpen++;
    if (e.lost >= 4) ok ? back.before.push(again.t - e.t) : back.beforeOpen++;
  });
  // POWs: drops by source and catches, drop-to-pickup time
  const powDrop = [];
  const toPickup = [];
  for (const e of E) {
    const o = L(locAt(e.t));
    if (e.ev === 'drop' && e.type === 'pow') {
      const src = e.src || (e.wreck ? 'wreck' : '?');
      o.drops[src] = (o.drops[src] || 0) + 1;
      powDrop.push([e.t, src]);
    } else if (e.ev === 'pickup' && e.type === 'pow') {
      o.caught++;
      const d = powDrop.shift();
      if (d && d[1] !== 'wreck') toPickup.push(e.t - d[0]);
    } else if (e.ev === 'hit') {
      o.hits++;
      if (ENEMY_FIRE.has(e.src)) o.enemyHits++;
      if (e.shield <= 0) o.lost++;
    } else if (e.ev === 'pull') o.pulls++;
  }
  // bosses: fight time (from its start, entry included) or the hull it escaped with
  const bosses = [];
  for (const e of E) {
    if (e.ev !== 'boss') continue;
    if (e.core) bosses.push({ name: e.name, killed: e.bt });
    else if (e.escaped) bosses.push({ name: e.name, escaped: e.max ? +(e.hp / e.max).toFixed(2) : null, hp: e.hp });
  }
  // extra ships: upward crossings of the thresholds (a continue resets the score)
  let extra = 0;
  let prev = 0;
  for (const r of S) {
    const sc = r[C.score];
    for (const th of EXTRA_LIVES) if (prev < th && sc >= th) extra++;
    prev = sc;
  }
  const stages = stageTable(tm, C);
  out.locTable = locationTable(stages);
  out.firstFull = firstFull ? +((firstFull.t - t0) / 60).toFixed(2) : null;
  out.back = back;
  out.toPickup = toPickup;
  out.l1lateBullets = stats(l1late);
  out.sections = sections;
  out.bosses = bosses;
  out.extra = extra;
  out.medals = { caught: E.filter((e) => e.ev === 'pickup' && e.type === 'medal').length, missed: E.filter((e) => e.ev === 'medalmiss').length };
  out.continues = E.filter((e) => e.ev === 'over').length - (meta.endReason === 'game over' ? 1 : 0);
  out.reached = Math.max(0, ...S.map((r) => r[C.loc]));
  out.minutes = +((S.length ? S[S.length - 1][C.t] - t0 : 0) / 60).toFixed(1);
  out.dread = bosses.find((b) => /DREADNOUGHT/.test(b.name)) || null;
  return out;
}

/** What an escaped boss had left: its hull share (or its hp, in recordings from before plan 1). */
const bossLeft = (b) => (b.escaped !== null ? `${Math.round(b.escaped * 100)}%` : `${b.hp}hp`);

function campaign(dirs) {
  const runs = dirs.map(campaignRun);
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
  const share = (o, from) => (o ? pct(o.lv.slice(from).reduce((x, y) => x + y, 0), o.samples) : null);
  const mid = (r, f) => [2, 3, 4].map((l) => f(r.loc[l], l));
  const rows = runs.map((r) => {
    const sum = (k) => [2, 3, 4].reduce((a, l) => a + (r.loc[l]?.[k] || 0), 0);
    const lt = Object.fromEntries(r.locTable.map((o) => [o.loc, o]));
    return {
      run: `${r.skill} s${r.seed}`,
      end: r.end,
      reached: r.reached,
      cont: r.continues,
      min: r.minutes,
      firstFull: r.firstFull,
      'FULL% L2-4': mid(r, (o) => share(o, 5)).join(' '),
      'SPIRAL+% L2-4': mid(r, (o) => share(o, 4)).join(' '),
      'backFULL s': r.back.full.map((s) => Math.round(s)).join(' ') + (r.back.fullOpen ? ` +${r.back.fullOpen} never` : ''),
      'POW caught L1-5': [1, 2, 3, 4, 5].map((l) => r.loc[l]?.caught ?? '-').join(' '),
      'pow→ship s': median(r.toPickup),
      'empty% L1-4': [1, 2, 3, 4].map((l) => (r.loc[l] ? pct(r.loc[l].empty, r.loc[l].samples) : '-')).join(' '),
      'noKill L1-4': [1, 2, 3, 4].map((l) => lt[l]?.noKillMax ?? '-').join(' '),
      'bullets L1late': r.l1lateBullets.mean,
      'bullets L2-4': [2, 3, 4].map((l) => lt[l]?.bulletsMean ?? '-').join(' '),
      'eFire% L2-4': pct(sum('enemyHits'), sum('hits')),
      'shotDown L1-4': [1, 2, 3, 4].map((l) => lt[l]?.shotDown ?? '-').join(' '),
      'lost L1-5': [1, 2, 3, 4, 5].map((l) => r.loc[l]?.lost ?? '-').join(' '),
      pulls: Object.values(r.loc).reduce((a, o) => a + o.pulls, 0),
      extra: r.extra,
      dread: r.dread ? (r.dread.killed !== undefined ? `down ${r.dread.killed}s` : bossLeft(r.dread)) : '-',
    };
  });
  console.table(rows);
  // bosses: locations 2–4 kill times, escapes
  const B = {};
  for (const r of runs) for (const b of r.bosses) (B[b.name] ||= []).push(b.killed !== undefined ? `${Math.round(b.killed)}s` : `esc ${bossLeft(b)}`);
  console.table(Object.entries(B).map(([name, v]) => ({ boss: name, fights: v.join(' ') })));
  // the emptiest sections over all runs
  const secs = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.sections)) {
    const o = (secs[k] ||= { n: 0, empty: 0 });
    o.n += v.n;
    o.empty += v.empty;
  }
  const worst = Object.entries(secs).filter(([k]) => !k.startsWith('5:') && !/dock$/.test(k)).map(([k, v]) => ({ section: k, empty: pct(v.empty, v.n), samples: v.n })).sort((a, b) => b.empty - a.empty).slice(0, 10);
  console.table(worst);
  const label = args.label || 'campaign';
  writeFileSync(join(OUT, `${label}.campaign.json`), JSON.stringify({ rows, bosses: B, worst, runs: runs.map(({ sections, ...r }) => r) }, null, 1));
}

if (cmd === 'video') await analyzeVideo(args._[0]);
else if (cmd === 'telemetry') analyzeTelemetry(args._[0]);
else if (cmd === 'campaign') campaign(args._);
else if (cmd === 'chart') chart(args._);
else if (cmd === 'highlights') highlights(args.rank && args.rank !== true ? [args.rank, ...args._] : args._);
else {
  console.log('usage: analyze.js video <file> | telemetry <file> | chart <a.video.json> ... | highlights <take> | highlights --rank <take> ... | campaign <take> ...');
  process.exit(1);
}
