import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Renderer } from './render/renderer.js';
import { extractModel, fallbackModel } from './render/models.js';
import { isTouch, preliminaryTier, refineTier, TIERS } from './core/quality.js';
import { Input } from './core/input.js';
import { loadSave, writeSave } from './core/storage.js';
import { Sfx, wavBase64 } from './audio/sfx.js';
import { Music } from './audio/music.js';
import { SHARED_SONGS } from './audio/songs.js';
import { Hud } from './ui/hud.js';
import { Game } from './game/game.js';
import { LOCATIONS } from './data/locations/index.js';
import { formatScore } from './core/util.js';
import { showLocationClear, showStarMap, showEnding, renderRecords } from './ui/screens.js';
import { viewSnapshot } from './game/telemetry.js';
import { addEntry, NameEntry, qualifies, renderHof } from './ui/hof.js';

const $ = (id) => document.getElementById(id);
const T0 = performance.now();

// Ship models exported from Blender (assets-src/blender). Missing files fall back to procedural stand-ins.
const MODEL_URLS = import.meta.glob('./assets/*.glb', { query: '?url', import: 'default', eager: true });
const SHIP_NAMES = ['player', 'drone', 'dart', 'wasp', 'hammer', 'mine', 'miner', 'shade', 'cruiser', 'carrier'];

const params = new URLSearchParams(location.search);
// ?loc=L starts at location L (debug); ?t=section:seconds jumps to a section; ?stage=N to the start of stage N
const bootLoc = Math.min(LOCATIONS.length, Math.max(1, +(params.get('loc') || 1))) - 1;
const debug = {
  stats: params.has('debug'),
  god: params.has('god'),
  autoplay: params.has('autoplay'),
  section: null, // set once the boot location is loaded (?stage / ?t)
  sectionTime: 0,
  route: params.get('route'),
  timeScale: parseFloat(params.get('speed') || '1'),
  // automation (scripts/play): no auto-pause, telemetry, and a stepped clock for frame-exact capture
  bot: params.has('bot'),
  capture: params.has('capture'),
  telemetry: params.has('bot') || params.has('capture') || params.has('telemetry'),
  hitbox: params.has('hitbox'),
  noTutor: params.has('notutor'),
  markers: params.get('markers'),
};
if (debug.capture) document.body.classList.add('capture');

const save = loadSave();
const options = save.options;
if (isTouch) document.body.classList.add('is-touch');

const ui = {
  title: $('screen-title'),
  pause: $('screen-pause'),
  over: $('screen-over'),
  clear: $('screen-clear'),
  map: $('screen-map'),
  end: $('screen-end'),
  forkme: $('forkme'),
  touch: $('touch'),
  bar: $('load-bar'),
  status: $('load-status'),
  loadBox: $('load-box'),
  start: $('start-btn'),
  hiLine: $('hi-line'),
};

function progress(v, text) {
  ui.bar.style.width = Math.round(v * 100) + '%';
  if (text) ui.status.textContent = text + '…';
}

async function loadGlb(url, onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  const out = {};
  for (const child of gltf.scene.children) out[child.name] = extractModel(child);
  return out;
}

async function loadShips() {
  let models = {};
  const url = MODEL_URLS['./assets/ships.glb'];
  if (url) {
    try {
      models = await loadGlb(url, (f) => progress(0.1 + 0.4 * f, 'loading ships'));
    } catch (err) {
      console.warn('ships.glb failed, using procedural ships', err);
    }
  }
  for (const n of [...SHIP_NAMES, 'mothership']) if (!models[n]) models[n] = fallbackModel(n);
  return models;
}

let game;
let renderer;
let input;
const audio = new Sfx();
const music = new Music(audio);
music.register(SHARED_SONGS);
const hud = new Hud();
hud.onTick = () => audio.tick();
// Location loading (ai/summary.md §8): each location's chunk and GLB are fetched once, ahead of time.
const prepared = new Map();
let bossModels = null; // location 1's mothership (boss.glb), loaded after Start

function prepareLocation(i) {
  if (!prepared.has(i)) {
    prepared.set(i, (async () => {
      const data = await LOCATIONS[i].load();
      let models = {};
      if (data.modelUrl) {
        try {
          models = await loadGlb(data.modelUrl);
        } catch (err) {
          console.warn(`location ${i + 1} models failed, using procedural ones`, err);
        }
      }
      return { data, models };
    })());
  }
  return prepared.get(i);
}

/** Replace the loaded location with location i (behind the star map, or on the way back to the title). */
async function switchLocation(i) {
  const { data, models } = await prepareLocation(i);
  if (game.loc === data) return;
  game.unloadLocation();
  game.loadLocation(data, i === 0 && bossModels ? { ...models, ...bossModels } : models);
  try {
    await renderer.gl.compileAsync(renderer.scene, renderer.camera);
    await renderer.gl.compileAsync(renderer.bgScene, renderer.bgCamera);
  } catch {
    /* compiled on first frame instead */
  }
}

function show(el, v) {
  el.classList.toggle('hidden', !v);
}

function setPlayingUi(playing) {
  hud.show(playing);
  show(ui.touch, playing && isTouch);
  show(ui.forkme, !playing);
  input.enabled = playing;
  document.body.style.cursor = playing ? 'none' : '';
}

function persistHi() {
  if (game && game.hi > save.hi) {
    save.hi = Math.floor(game.hi);
    writeSave();
  }
}

// The hall of fame's name entry, open on the game over or ending screen (ai/summary.md §6.4)
let entry = null;

/** After a credit ends: the name entry if the score makes the top 10, otherwise the table as it stands. */
function openHof(el, res) {
  entry?.close();
  entry = null;
  if (!qualifies(save.hof, Math.floor(res.score))) {
    renderHof(el, save.hof, formatScore, { max: 5 });
    return;
  }
  entry = new NameEntry(el, save.lastName || 'AAA', (name) => {
    entry = null;
    save.lastName = name;
    const date = new Date().toISOString().slice(0, 10);
    const mark = addEntry(save.hof, { name, score: Math.floor(res.score), reached: res.reached, continues: res.continues || 0, date });
    writeSave();
    renderHof(el, save.hof, formatScore, { mark });
  });
}

/** Leaving the screen saves the entry as it stands. */
function closeHof() {
  entry?.confirm();
}

function renderTitleTables() {
  ui.hiLine.textContent = save.hi ? 'HIGH SCORE ' + formatScore(save.hi) : '';
  renderRecords($('records'), LOCATIONS, save.records);
  renderHof($('hof'), save.hof, formatScore, { max: 5 });
}

function startGame() {
  audio.init();
  music.resume();
  for (const s of [ui.over, ui.clear, ui.map, ui.end]) show(s, false);
  input.requestLock();
  show(ui.title, false);
  setPlayingUi(true);
  game.start();
  if (isTouch && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
}

function toTitle() {
  closeHof();
  persistHi();
  for (const s of [ui.pause, ui.over, ui.clear, ui.map, ui.end]) show(s, false);
  setPlayingUi(false);
  input.releaseLock();
  music.play('title');
  renderTitleTables();
  show(ui.title, true);
  if (game.locIdx === bootLoc && game.loc) {
    game.attract();
    return;
  }
  // every new game starts at location 1 (ai/summary.md §4.4): load it back behind the title
  ui.start.disabled = true;
  switchLocation(bootLoc).then(() => {
    game.attract();
    ui.start.disabled = false;
  });
}

/** Records per browser: per location the best score, best grade per stage and medals (only shown, never a start). */
function saveRecords(rec) {
  const R = (save.records ||= { furthest: 0, locs: {} });
  R.furthest = Math.max(R.furthest || 0, rec.index + 1);
  const r = (R.locs[rec.id] ||= { best: 0, grades: [], medals: {} });
  const fresh = Object.keys(rec.medals).filter((k) => rec.medals[k] && !r.medals[k]);
  const rank = { S: 4, A: 3, B: 2, C: 1 };
  rec.grades.forEach((g, i) => {
    if (!r.grades[i] || rank[g] > rank[r.grades[i]]) r.grades[i] = g;
  });
  for (const k of fresh) r.medals[k] = true;
  r.best = Math.max(r.best, Math.floor(rec.score));
  writeSave();
  return fresh;
}

let nextReady = null; // the next location, loading behind the location clear and star map screens

function onLocationClear(rec) {
  persistHi();
  const fresh = saveRecords(rec);
  setPlayingUi(false);
  input.releaseLock();
  showLocationClear(rec, fresh, formatScore);
  show(ui.clear, true);
  $('next-btn').focus({ preventScroll: true });
  if (!rec.final) {
    nextReady = switchLocation(rec.index + 1);
    nextReady.then(() => {
      $('launch-btn').disabled = false;
      $('launch-btn').textContent = 'Launch';
    });
  }
}

function toStarMap() {
  show(ui.clear, false);
  const i = game.run.locs.length; // the next location
  if (game.run.locs[game.run.locs.length - 1]?.final) {
    game.endGame(true);
    return;
  }
  showStarMap(LOCATIONS, i, game.run.locs, save.records);
  music.play('jump');
  show(ui.map, true);
  const b = $('launch-btn');
  if (b.disabled) b.textContent = 'Preparing the jump…';
  b.focus({ preventScroll: true });
  // launches by itself after a few seconds, once the next location is ready (ai/summary.md §4.3)
  clearInterval(autoLaunch);
  let left = 9;
  autoLaunch = setInterval(() => {
    if (b.disabled || ui.map.classList.contains('hidden')) return;
    if (--left <= 0) launch();
    else b.textContent = `Launch (${left})`;
  }, 1000);
}
let autoLaunch = null;

async function launch() {
  clearInterval(autoLaunch);
  await nextReady;
  if (ui.map.classList.contains('hidden')) return;
  show(ui.map, false);
  setPlayingUi(true);
  input.requestLock();
  audio.init();
  game.beginLocation();
  $('launch-btn').disabled = true;
  prepareLocation(game.locIdx + 1 < LOCATIONS.length ? game.locIdx + 1 : game.locIdx); // prefetch the one after
}

function openPause() {
  setPlayingUi(false);
  input.releaseLock(); // P or a gamepad pauses without the browser dropping the lock: free the mouse for the menu
  hud.show(true);
  show(ui.pause, true);
  syncOptionsUi();
}

function resumeGame() {
  show(ui.pause, false);
  setPlayingUi(true);
  input.requestLock();
  audio.init();
  game.resume();
}

function syncOptionsUi() {
  $('opt-sens').value = options.sensitivity;
  $('opt-invert').checked = options.invertY;
  $('opt-autofire').checked = options.autoFire ?? isTouch;
  $('opt-volume').value = options.volume;
  $('opt-music').value = options.musicVolume ?? 0.6;
  $('opt-flash').checked = options.reduceFlash;
  $('opt-danger').checked = options.dangerMarkers !== false;
  $('opt-quality').value = options.quality;
  $('tips-btn').textContent = 'Reset tutorial tips';
}

function bindOptions() {
  const changed = () => {
    writeSave();
    game?.applyOptions();
  };
  $('opt-sens').addEventListener('input', (e) => ((options.sensitivity = parseFloat(e.target.value)), changed()));
  $('opt-invert').addEventListener('change', (e) => ((options.invertY = e.target.checked), changed()));
  $('opt-autofire').addEventListener('change', (e) => ((options.autoFire = e.target.checked), changed()));
  $('opt-volume').addEventListener('input', (e) => ((options.volume = parseFloat(e.target.value)), changed()));
  $('opt-music').addEventListener('input', (e) => ((options.musicVolume = parseFloat(e.target.value)), changed()));
  $('opt-flash').addEventListener('change', (e) => ((options.reduceFlash = e.target.checked), changed()));
  $('opt-danger').addEventListener('change', (e) => ((options.dangerMarkers = e.target.checked), changed()));
  $('opt-quality').addEventListener('change', (e) => {
    options.quality = e.target.value;
    writeSave();
    const t = TIERS[options.quality] ? options.quality : renderer.autoTier;
    renderer.tierName = t;
    renderer.tier = TIERS[t];
    renderer.res.setTier(t);
    renderer.resize();
    hud.hint('particle and star counts change after a reload', 2.5);
  });
}

function bindButtons() {
  ui.start.addEventListener('click', startGame);
  $('resume-btn').addEventListener('click', resumeGame);
  $('restart-btn').addEventListener('click', () => {
    show(ui.pause, false);
    setPlayingUi(true);
    input.requestLock();
    audio.init();
    game.restartStage();
  });
  $('quit-btn').addEventListener('click', toTitle);
  $('tips-btn').addEventListener('click', () => {
    save.tutorial = { done: {} };
    writeSave();
    game.tutor.save = save;
    $('tips-btn').textContent = 'Tutorial tips reset';
  });
  $('over-quit-btn').addEventListener('click', toTitle);
  $('continue-btn').addEventListener('click', () => {
    closeHof();
    show(ui.over, false);
    setPlayingUi(true);
    input.requestLock();
    game.continueGame();
  });
  $('next-btn').addEventListener('click', toStarMap);
  $('launch-btn').addEventListener('click', launch);
  $('end-btn').addEventListener('click', toTitle);
  $('t-pause').addEventListener('click', () => game.pause());
  // re-acquire pointer lock if the browser refused it (e.g. resuming right after Esc)
  $('game').addEventListener('click', () => {
    if (game.state === 'playing' && !input.locked) input.requestLock();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !debug.bot) {
      game?.pause();
      persistHi();
    }
  });
  addEventListener('pagehide', persistHi);
  // back/forward cache: going back to the page is a new game too (ai/summary.md §4.4)
  addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
}

async function boot() {
  progress(0.04, 'starting engines');
  const override = params.get('q') || (TIERS[options.quality] ? options.quality : null);
  let tier = preliminaryTier(override);
  try {
    renderer = new Renderer($('game'), tier);
  } catch (err) {
    ui.status.textContent = 'WebGL is not available on this device or browser.';
    console.error(err);
    return;
  }
  const refined = refineTier(tier, renderer.gl.getContext(), override);
  renderer.autoTier = refined.tier;
  if (refined.tier !== tier) {
    tier = refined.tier;
    renderer.tierName = tier;
    renderer.tier = TIERS[tier];
    renderer.res.setTier(tier);
    renderer.resize();
  }
  input = new Input($('game'), ui.touch, { isTouch });

  const [models, first] = await Promise.all([loadShips(), prepareLocation(bootLoc)]);
  progress(0.5, 'building the stage');
  await new Promise((r) => setTimeout(r, 0));

  // ?stage=N / ?t=section:seconds within the boot location
  const loc0 = first.data;
  const stageParam = loc0.stages[+(params.get('stage') || 0) - 1];
  const [section, sectionTime] = (params.get('t') || (stageParam ? stageParam.sections[0].id : '')).split(':');
  debug.section = section || null;
  debug.sectionTime = sectionTime ? parseFloat(sectionTime) : 0;

  game = new Game({ renderer, input, audio, music, hud, models, debug, options });
  game.hi = save.hi;
  game.locCount = LOCATIONS.length;
  game.stageCounts = LOCATIONS.map((l) => l.stages);
  game.buildShared(progress);
  game.loadLocation(loc0, first.models, progress);
  progress(0.86, 'compiling shaders');
  game.on('pause', openPause);
  game.on('over', (res) => {
    persistHi();
    $('over-score').textContent = formatScore(res.score);
    $('over-hi').textContent = formatScore(game.hi);
    setPlayingUi(false);
    input.releaseLock();
    openHof($('over-hof'), res);
    show(ui.over, true);
  });
  game.on('locclear', onLocationClear);
  game.on('ended', (res) => {
    persistHi();
    setPlayingUi(false);
    input.releaseLock();
    showEnding(res, LOCATIONS, formatScore);
    openHof($('end-hof'), res);
    show(ui.end, true);
    $('end-btn').focus({ preventScroll: true });
  });
  input.onPointerLockChange = (locked) => {
    if (!locked && game.state === 'playing' && !isTouch && !debug.bot) game.pause();
  };
  if (debug.bot) input.ignoreBlur = true;
  if (debug.capture) audio.startRecording(() => game.time);

  progress(0.88, 'compiling shaders');
  try {
    await renderer.gl.compileAsync(renderer.bgScene, renderer.bgCamera);
    await renderer.gl.compileAsync(renderer.scene, renderer.camera);
  } catch {
    /* compileAsync unsupported: shaders compile on first frame */
  }

  game.attract();
  bindButtons();
  bindOptions();
  syncOptionsUi();
  if (!debug.capture) requestAnimationFrame(frame);

  // interactive
  progress(1, 'ready');
  show(ui.loadBox, false);
  show(ui.start, true);
  ui.start.focus({ preventScroll: true });
  renderTitleTables();
  const readyMs = performance.now() - T0;
  performance.mark('game-ready');
  window.__bg = {
    readyMs,
    tier,
    gpu: refined.gpu,
    game,
    version: __APP_VERSION__,
    // automation API (scripts/play)
    view: () => viewSnapshot(game),
    telemetry: () => game.tm?.dump() ?? null,
    advance: (n = 1) => {
      for (let i = 0; i < n; i++) tick(1000 / 60);
      return game.state;
    },
    renderAudio: (t0) => audio.renderRecording(t0),
    // scripts/play/music.js: one cue rendered offline (the same synth as the game), as a base64 WAV
    songs: () => Object.keys(music.songs),
    renderMusic: async (name, seconds = 30, jingle = false) => {
      const rate = 44100;
      const ctx = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
      const sfx = new Sfx();
      sfx.offline = true;
      sfx.initWith(ctx);
      const mu = new Music(sfx);
      mu.songs = music.songs;
      mu.volume = options.musicVolume ?? 0.6;
      mu.renderOffline(ctx, sfx.comp, [[0, jingle ? 'jingle' : 'music', [name, 0]]], 0, seconds);
      const buf = await ctx.startRendering();
      return wavBase64(buf.getChannelData(0), rate);
    },
    ui: {
      start: startGame, resume: resumeGame, cont: () => $('continue-btn').click(), title: toTitle, map: toStarMap, launch,
      // after a location clear: on to the star map, then launch into the next location (or the ending)
      next: async () => {
        toStarMap();
        if (game.state === 'ended') return 'ended';
        await launch();
        return game.state;
      },
    },
    locations: LOCATIONS.map((l) => l.id),
  };
  dispatchEvent(new CustomEvent('game-ready', { detail: { readyMs } }));
  if (params.has('autostart') || debug.autoplay) startGame();

  // progressive load: the mothership model is only needed ~8 minutes in; the next location right after that
  const bossUrl = MODEL_URLS['./assets/boss.glb'];
  if (bossUrl) {
    loadGlb(bossUrl)
      .then((m) => {
        bossModels = { mothership: m.mothership };
        if (game.locIdx === 0) game.swapBossModel('mothership', m.mothership);
      })
      .catch((err) => console.warn('boss.glb failed, using procedural boss', err));
  }
  setTimeout(() => prepareLocation(bootLoc + 1 < LOCATIONS.length ? bootLoc + 1 : bootLoc), 4000);
}

let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
let needsRender = true;
addEventListener('resize', () => (needsRender = true));

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, Math.max(0, now - last));
  last = now;
  tick(dtMs);
}

/** One frame: input → update → render. Driven by rAF, or by __bg.advance() in ?capture mode. */
function tick(dtMs) {
  const dt = (dtMs / 1000) * debug.timeScale;
  const active = game.state === 'playing' || game.state === 'title';
  if (active && !debug.capture) {
    renderer.sampleFrame(dtMs);
    fpsAcc += dtMs;
    fpsN++;
    if (fpsAcc > 500) {
      game.fps = (1000 * fpsN) / fpsAcc;
      fpsAcc = fpsN = 0;
    }
  }
  const c0 = performance.now();
  input.poll(dt);
  entry?.poll(dt);
  game.update(dt);
  const c1 = performance.now();
  if (active || needsRender || game.state === 'loading') {
    game.render(active ? dt : 0);
    needsRender = false;
  }
  if (debug.stats) {
    const c2 = performance.now();
    game.cpu = game.cpu ? game.cpu * 0.95 + (c2 - c0) * 0.05 : c2 - c0;
    game.cpuUpdate = game.cpuUpdate ? game.cpuUpdate * 0.95 + (c1 - c0) * 0.05 : c1 - c0;
  }
  if (game.state !== 'playing' && game.state !== 'title') {
    // keep checking edges so Esc / P resumes from the pause screen
    if (game.state === 'paused' && input.edge('pause') && !ui.pause.classList.contains('hidden')) resumeGame();
  }
}

boot();
