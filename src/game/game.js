import { Color, FogExp2, Quaternion, Vector3 } from 'three';
import { buildRoutes } from '../world/rail.js';
import { Scenery } from '../world/scenery.js';
import { createRockMaterial, createShieldMaterial, createShipMaterial } from '../render/materials.js';
import { makeDebrisGeometry, makePickupGeometry, makeRockGeometry } from '../render/models.js';
import { Billboards } from '../render/billboards.js';
import { FX, Dust, PAL } from '../render/fx.js';
import { bakeSky, Stars, Sun } from '../render/sky.js';
import { disposeTree } from '../render/dispose.js';
import { EVADES, MAX_POWER, Player, POWER } from './player.js';
import { Enemies } from './enemies.js';
import { PlayerShots, EnemyBullets, SHOT_SPEED } from './shots.js';
import { Missiles } from './missiles.js';
import { Bombs, Beams } from './weapons.js';
import { Danger } from './danger.js';
import { Fields } from './fields.js';
import { BEHIND_SAFE, bulletHitR, missileHitR, rockHitR, shipHitR } from './hitbox.js';
import { KINDS, Rocks } from './rocks.js';
import { Pickups, PICKUP } from './pickups.js';
import { Boss, bossModelOk } from './bosses.js';
import { fallbackModel } from '../render/models.js';
import { prepareWaves, WaveRunner } from './waves.js';
import { StageRunner, TRANSIT } from './stage.js';
import { angleDiff, clamp, damp, segPointDist2 } from '../core/util.js';
import { makeRng } from '../core/rng.js';
import { Telemetry } from './telemetry.js';
import { Tutor } from './tutor.js';
import { Hulks } from './hulks.js';
import { Hazards } from './hazards.js';
import { buildMembers } from './formations.js';
import { CORRIDOR } from './player.js';

const STEP = 1 / 60;
const JUMP_T = 1.6; // the jump-in between locations (s)
// ×3 in plan 4: the chain and medals score about three times what itr 3 did
const EXTRA_LIVES = [150000, 450000, 900000, 1500000, 2250000, 3000000];
// The score loop (ai/summary.md §6.3): a chain of kills multiplies kill points while it lasts; medals rise in value
// while you keep catching them; the good ending pays a clear bonus.
const CHAIN_T = 2; // seconds without a kill before the chain drops
const chainMul = (n) => (n >= 50 ? 4 : n >= 25 ? 3 : n >= 10 ? 2 : 1);
const MEDALS = [100, 200, 500, 1000, 2000, 5000];
const CLEAR_BONUS = 500000; // + 50,000 per ship left, ×2 for one credit: about a quarter of a good run
const RESCUE_T = 15; // still weak this long after a respawn: a supply gunship comes (ai/summary.md §6.1)
// boss fights: a small wave crosses in front of the boss every 6–8 s (ai/summary.md §7.3)
const FEEDERS = [
  { f: 'sweep', n: 4 },
  { f: 'dive', n: 3 },
  { f: 'sweep', n: 4, mirror: true },
  { f: 'dive', n: 3, mirror: true, flipY: true },
].map((w) => ({ ...w, members: buildMembers(w) }));
const RESCUE = { f: 'hold', n: 1 };
RESCUE.members = buildMembers(RESCUE);
let feederId = 80000;
const newStats = (score = 0) => ({ spawned: 0, raw: 0, killed: 0, aligned: 0, hits: 0, maxChain: 0, medals: 0, startScore: score });

const _v = new Vector3();
const _o = new Vector3();
const _d = new Vector3();
const _cam = new Vector3();
const _v2 = new Vector3();
const _tp = new Vector3();
const _tv = new Vector3();
const _fc = new Vector3();
const _rp = new Vector3();
const _rq = new Quaternion();
const _rqi = new Quaternion();
const LAND_SPOT = new Vector3(0, 4.85, 12); // on the carrier deck, carrier frame
const rng = makeRng(2024);

const HIT_LABEL = {
  bullet: 'ENEMY FIRE', shell: 'SHELL', rock: 'ASTEROID', ram: 'RAMMED', boss: 'RAMMED', missile: 'MISSILE', beam: 'LASER', gate: 'LASER GATE',
  hulk: 'RAMMED', strike: 'LIGHTNING', geyser: 'GEYSER', flare: 'SOLAR FLARE',
};
const LOCK_RANGE = 650;
const BOLT_PAD = 0.5; // a bolt's own half-width: hits count from the edge of the drawn streak, not its centre line
const DEFAULT_AIM = 230;

/** Time for a projectile of speed S fired from P to meet a target at T moving with V (lead aiming). */
function intercept(P, T, V, S) {
  const rx = T.x - P.x;
  const ry = T.y - P.y;
  const rz = T.z - P.z;
  const c = rx * rx + ry * ry + rz * rz;
  const a = V.x * V.x + V.y * V.y + V.z * V.z - S * S;
  const b = 2 * (V.x * rx + V.y * ry + V.z * rz);
  const disc = b * b - 4 * a * c;
  if (disc < 0 || Math.abs(a) < 1e-6) return Math.sqrt(c) / S;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
  return Number.isFinite(t) ? Math.min(t, 3) : Math.sqrt(c) / S;
}

export class Game {
  constructor({ renderer, input, audio, music, hud, models, debug, options }) {
    this.r = renderer;
    this.input = input;
    this.audio = audio;
    this.music = music;
    this.hud = hud;
    this.models = models;
    this.loc = null; // the loaded location (src/data/locations), also this.data
    this.data = null;
    this.locIdx = 0;
    this.debug = debug;
    this.options = options;
    this.state = 'loading';
    this.time = 0;
    this.stageIdx = -1; // current stage (index into data.stages)
    this.tallied = -1; // last stage whose between-stage tally has been shown
    this.difficulty = this.makeDifficulty(0);
    this.stats = newStats();
    this.chain = { n: 0, t: 0 };
    this.medalIdx = 0;
    this.feederT = 4;
    this.feederK = 0;
    this.lastKillT = 0;
    this.fireHeld = false;
    this.rescueT = 0;
    this.hi = 0;
    this.boss = null;
    this.listeners = {};
    this.arrowBuf = Array.from({ length: 8 }, () => ({ x: 0, y: 0, angle: 0 }));
    this.arrowN = 0;
    this.tm = debug.telemetry ? new Telemetry(this) : null;
    this.tutor = new Tutor(this);
    this.snap = { score: 0, hi: 0, lives: 3, shield: 3, bombs: 2, evades: EVADES, power: 0, roll: 0, notch: null, aligned: false, locked: false, bossActive: false, bossHp: 0, bossName: '', firing: false, lead: false, leadX: 0, leadY: 0, laserT: 0 };
    this.hitStop = 0;
    this.hitLabels = new Set();
    this.lockEnemy = null;
    this.leadOn = false;
    this.leadPoint = new Vector3();
    this.leadPip = null;
  }

  on(name, fn) {
    this.listeners[name] = fn;
  }
  emit(name, ...args) {
    this.listeners[name]?.(...args);
  }

  /**
   * Difficulty for threat level T (the location index, 0–4) and a stage's ramp (src/data/locations). Each location
   * authors its own stage ramps; T scales them up from location to location (ai/summary.md §7.2). Location 1 (T = 0)
   * plays exactly as itr 2's first loop.
   */
  makeDifficulty(T, ramp = null) {
    const r = ramp || { fire: 1, rate: 1, minAlive: 4, maxCharging: 6 };
    const [fs, rs] = this.loc?.fireScale || [1, 1]; // a location's fire cut (ai/summary.md §7.2)
    return {
      fireRate: (1 + 0.08 * T) * r.rate * rs,
      bulletSpeed: (1 + 0.04 * T) * (r.speed || 1),
      fireChance: (1 + 0.1 * T) * r.fire * fs,
      hpMul: (1 + 0.12 * T) * (r.hp || 1),
      minAlive: r.minAlive,
      maxCharging: r.maxCharging,
      drops: r.drops ?? 1, // share of pickup drops that still come (location 5 takes some away)
      noShield: !!r.noShield,
      // live enemy bullets above this hold every gun (0: no cap). Locations 4–5 get harder through formations,
      // not a wall of bullets (ai/summary.md §7.2)
      maxBullets: r.maxBullets ?? (T >= 4 ? 18 : T >= 3 ? 12 : 0),
    };
  }

  /** Build the systems every location shares (player, enemies, weapons, effects). Done once, at boot. */
  buildShared(progress = () => {}) {
    const r = this.r;
    const tier = r.tier;

    // materials
    this.shipMat = createShipMaterial();
    this.playerMat = createShipMaterial({ rim: 0x8fd8ff, rimStrength: 0.55 });
    this.rockSpinMat = createRockMaterial({ spin: true });
    this.rockMat = createRockMaterial();
    this.shieldMat = createShieldMaterial();

    this.stars = new Stars(tier.stars);
    r.bgScene.add(this.stars.points);
    this.sunObj = new Sun();
    r.bgScene.add(this.sunObj.bb.mesh);
    this.sunDir = new Vector3(0, 1, 0);

    // rail-space systems
    progress(0.8, 'arming the fleet');
    const root = r.railRoot;
    this.player = new Player(this, this.models.player, this.models.drone, this.playerMat, this.shipMat);
    this.enemies = new Enemies(this, this.models, this.shipMat, this.shieldMat);
    this.shots = new PlayerShots(this);
    this.bullets = new EnemyBullets(this);
    const seeds = { rock: [3, 1], ice: [5, 1], metal: [8, 0], dark: [9, 1], ore: [4, 1], crystal: [6, 0], slag: [7, 1] };
    this.rocks = new Rocks(this, Object.fromEntries(KINDS.map((k) => [k, makeRockGeometry(seeds[k][0], seeds[k][1], k)])), this.rockMat);
    this.pickups = new Pickups(this, makePickupGeometry(), this.shipMat);
    this.fx = new FX(tier.particles, tier.debris, makeDebrisGeometry(), this.shipMat);
    this.dust = new Dust(tier.dust);
    this.glows = new Billboards(320, { additive: true, renderOrder: 5, minPx: 1.2 });
    this.missiles = new Missiles(this);
    this.bombs = new Bombs(this);
    this.beams = new Beams(this);
    this.danger = new Danger(this);
    this.hulks = new Hulks(this);
    this.hazards = new Hazards(this);
    this.corridor = { x: CORRIDOR.x, y: CORRIDOR.y }; // the play box: a section can narrow it (data: box)
    this.drift = { x: 0, y: 0 }; // a section's steady push (data: drift), eased in
    for (const o of [
      ...this.player.objects, ...this.enemies.objects, this.shots.object, ...this.bullets.objects, ...this.rocks.objects,
      ...this.pickups.objects, this.fx.object, this.fx.debris, this.dust.object, this.glows.mesh,
      this.missiles.object, this.bombs.object, this.beams.object, this.danger.object, this.hazards.object,
    ]) root.add(o);
    this.waves = new WaveRunner(this);
    // shared resources a location swap must not free
    this.keep = new Set([this.shipMat, this.playerMat, this.rockSpinMat, this.rockMat, this.shieldMat]);
    for (const m of Object.values(this.models)) {
      if (m.geometry) this.keep.add(m.geometry);
      for (const p of Object.values(m.parts)) this.keep.add(p.geometry);
    }
    this.applyOptions();
  }

  /**
   * Build a location (src/data/locations): sky, backdrop, rails, scenery, asteroid fields, bosses. locModels: the
   * location's own models (its GLB), on top of the shared ones. Heavy work: done behind the loading or star-map screen.
   */
  loadLocation(loc, locModels = {}, progress = () => {}) {
    const r = this.r;
    const tier = r.tier;
    this.loc = loc;
    this.data = loc;
    this.locIdx = loc.index;
    const models = { ...this.models, ...locModels };
    this.locModels = locModels;

    // background pass
    progress(0.55, 'painting the sky');
    this.skyRT = bakeSky(r.gl, r.bgScene, tier.skySize, loc.sky);
    this.backdrop = loc.backdrop(loc, tier, models, this);
    for (const o of this.backdrop.bgObjects) r.bgScene.add(o);
    for (const o of this.backdrop.objects) r.scene.add(o);
    const e = loc.sun.elevation;
    const a = loc.sun.azimuth;
    this.sunDir.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
    r.setSunDirection(this.sunDir);
    r.setPalette(loc.light);
    // fog (Crimson Nebula): ships and rocks fade into it, bullets and glows (billboards) stay bright
    r.scene.fog = loc.fog ? new FogExp2(loc.fog.color, loc.fog.density) : null;
    this.shipMat.userData.uRim.value.set(loc.rim?.color ?? 0x6fa8ff).multiplyScalar(loc.rim?.strength ?? 0.45);

    // rails
    progress(0.65, 'laying the rails');
    const { routes, forks } = buildRoutes(loc.path);
    this.routes = routes;
    this.forks = forks;
    if (!loc.prepared) {
      prepareWaves(loc);
      loc.prepared = true;
    }

    // world scenery
    progress(0.72, 'scattering asteroids');
    this.scenery = new Scenery(loc, routes, forks, { tier, shipMaterial: this.shipMat, models, game: this });
    for (const o of this.scenery.objects) r.scene.add(o);
    this.fields = new Fields(this, loc, routes, { tier, material: this.rockSpinMat, clearance: (p, rad) => this.scenery.clear(p, rad) });
    for (const o of this.fields.objects) r.scene.add(o);

    // bosses
    this.bosses = {};
    for (const def of Object.values(loc.bossDefs || {})) {
      const m = models[def.model];
      const b = new Boss(this, def, bossModelOk(def, m) ? m : fallbackModel(def.model));
      for (const o of b.objects) r.railRoot.add(o);
      b.group.visible = false;
      this.bosses[def.type] = b;
    }
    this.hulks.setLocation(loc.hulkDefs, models);
    this.stage = new StageRunner(this, loc, routes, forks);
    this.music?.register(loc.songs);
  }

  /** A boss model that arrived after the location was built (location 1's mothership, boss.glb). */
  swapBossModel(type, model) {
    const old = this.bosses[type];
    if (!old || old.active || !bossModelOk(old.def, model)) return;
    for (const o of old.objects) o.removeFromParent();
    const b = new Boss(this, old.def, model);
    for (const o of b.objects) this.r.railRoot.add(o);
    b.group.visible = false;
    this.bosses[type] = b;
  }

  /** Remove the current location and free its GPU memory (the shared systems stay). */
  unloadLocation() {
    const r = this.r;
    if (!this.loc) return;
    this.resetWorld();
    const keep = this.keep;
    for (const o of this.backdrop.bgObjects) {
      r.bgScene.remove(o);
      disposeTree(o, keep);
    }
    for (const o of [...this.backdrop.objects, ...this.scenery.objects, ...this.fields.objects]) {
      r.scene.remove(o);
      disposeTree(o, keep);
    }
    this.backdrop.dispose?.();
    for (const b of Object.values(this.bosses)) {
      for (const o of b.objects) {
        o.removeFromParent();
        disposeTree(o, keep);
      }
    }
    for (const m of Object.values(this.locModels || {})) {
      m.geometry?.dispose();
      for (const p of Object.values(m.parts || {})) p.geometry.dispose();
    }
    r.bgScene.background = null;
    this.skyRT.dispose();
    this.bosses = {};
    this.loc = this.data = null;
  }

  applyOptions() {
    const o = this.options;
    this.input.sensitivity = o.sensitivity;
    this.input.invertY = o.invertY;
    this.input.autoFire = o.autoFire ?? this.input.isTouch;
    this.audio.setVolume(o.volume);
    this.music?.setVolume(o.musicVolume ?? 0.6);
    this.fx.scale = o.reduceFlash ? 0.5 : 1;
    this.hud.reduceFlash = o.reduceFlash;
    this.danger.enabled = o.dangerMarkers !== false && this.debug.markers !== 'off';
  }

  // ------------------------------------------------------------------------------------------
  // state transitions

  resetWorld() {
    this.enemies.clear();
    this.shots.clear();
    this.bullets.clear();
    this.rocks.clear();
    this.pickups.clear();
    this.fx.clear();
    this.waves.clear();
    this.missiles.clear();
    this.bombs.clear();
    this.beams.clear();
    this.hulks.clear();
    this.hazards.clear();
    this.fields.reset();
    this.flashLight = 0;
    this.hitStop = 0;
    this.lockEnemy = null;
    for (const b of Object.values(this.bosses)) {
      b.active = false;
      b.group.visible = false;
    }
    this.boss = null;
    this.lightning = false;
    this.boltI = 0;
    this.boltT = 1;
    this.hud.clearMessages();
  }

  attract() {
    this.state = 'title';
    this.resetWorld();
    this.player.reset(true);
    this.stage.reset(0, 2);
  }

  /** A new game: a fresh ship and run record, at the start of the loaded location (location 1, except in debug). */
  start() {
    this.hitLabels.clear();
    this.tutor.reset();
    this.player.reset(true);
    this.run = { t0: this.time, continues: 0, locs: [], maxChain: 0 };
    this.chain.n = 0;
    this.medalIdx = 0;
    this.rescueT = 0;
    this.beginLocation();
  }

  /** The start of a location: at a new game, or after the jump from the star map. */
  beginLocation() {
    const jumped = !!this.run.locs.length; // arriving from the star map (not a new game)
    this.player.endLanding();
    this.locStats = { spawned: 0, killed: 0, hits: 0, deaths: 0, grades: [], score0: this.player.score };
    this.difficulty = this.makeDifficulty(this.locIdx);
    this.beginStage();
    this.locIntro = true; // the location's title card comes before the first stage's
    // the jump: stars streak past for a moment, then a flash and the new system
    this.jumpT = jumped ? JUMP_T : 0;
    if (jumped) {
      this.audio.jump();
      this.player.invuln = Math.max(this.player.invuln, JUMP_T + 1);
    }
    this.hud.locationCard(this.locIdx + 1, this.loc.name, this.loc.subtitle);
    this.music?.play(this.loc.songs?.theme);
  }

  /** Pause menu: start the current stage again with a fresh ship (a practice restart). */
  restartStage() {
    const first = this.data.sections.findIndex((s) => s.stage === Math.max(0, this.stageIdx));
    this.player.reset(true);
    this.beginStage(first);
  }

  /** Start flying from section `index` (default: the first, or the debug jump). */
  beginStage(index = 0) {
    this.resetWorld();
    this.scenery.cpGreen.length = 0;
    this.overT = 0;
    this.stageIdx = -1;
    this.tallied = -1;
    const d = this.debug;
    let time = 0;
    if (d.section && !this._jumped) {
      this._jumped = true;
      index = Math.max(0, this.data.sections.findIndex((s) => s.id === d.section));
      time = d.sectionTime || 0;
    }
    const forced = d.route ? { [this.forks[0]?.id]: d.route } : {};
    this.stage.reset(index, time, index > 0 ? { ...forced, ...this.defaultChoicesBefore(index, forced) } : forced);
    this.player.pos.set(0, -3, 0);
    this.player.invuln = 2;
    this.state = 'playing';
    this.input.clearEdges();
    this.tm?.event('stage', { loc: this.locIdx + 1, section: this.stage.section.id });
  }

  /** When jumping past a fork in debug mode, pick its default branch. */
  defaultChoicesBefore(index, forced) {
    const out = {};
    const gateSection = (f) => this.data.sections.findIndex((s) => s.from === f.gate);
    for (const f of this.forks) if (gateSection(f) < index && !forced[f.id]) out[f.id] = f.options[0].key;
    return out;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.suspend();
    this.emit('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.audio.resume();
    this.input.clearEdges();
  }

  continueGame() {
    if (this.run) this.run.continues++;
    this.music?.play(this.boss?.active ? this.loc.songs?.boss : this.loc.songs?.theme);
    const p = this.player;
    p.score = 0;
    p.lives = 3;
    p.power = 0;
    const lives = p.lives;
    p.reset(false);
    p.lives = lives;
    p.invuln = 3;
    this.bullets.clear();
    this.onRespawn(p.lostPower || 0);
    this.state = 'playing';
    this.input.clearEdges();
  }

  // ------------------------------------------------------------------------------------------
  // main update

  update(dt) {
    this.time += dt;
    const input = this.input;
    if (input.edge('mute')) this.hud.hint(this.audio.toggleMute() ? 'sound off' : 'sound on', 1.2);

    if (this.state === 'title') {
      this.stage.update(dt * 0.6, false);
      if (this.stage.index > 0 || this.stage.time > 33) this.stage.reset(0, 2);
      const p = this.player;
      p.pos.set(Math.sin(this.time * 0.4) * 6, -2 + Math.sin(this.time * 0.6) * 2, 0);
      p.yaw = Math.sin(this.time * 0.23) * 0.15;
      p.pitch = 0.04;
      p.roll = Math.sin(this.time * 0.17) * 0.25;
      p._camera(dt);
      p.aimPoint.set(p.pos.x * 0.5, p.pos.y + 3, -200);
      p.shipQuat.slerp(p.camQuat, damp(4, dt));
      this.fx.update(dt);
      return;
    }

    if (this.state !== 'playing') return;

    if (input.edge('pause')) {
      this.pause();
      return;
    }
    if (input.edge('bomb')) this.useBomb();
    if (this.debug.autoplay) this.autopilot(dt);
    if (this.hitStop > 0) {
      // a brief freeze when the player is hit: the moment, and the culprit, register
      this.hitStop -= dt;
      dt *= 0.05;
    }

    const n = Math.min(4, Math.max(1, Math.round(dt / STEP)));
    const h = dt / n;
    for (let i = 0; i < n && this.state === 'playing'; i++) this.step(h, i === 0);

    if (this.overT > 0) {
      this.overT -= dt;
      if (this.overT <= 0) this.gameOver();
    }
  }

  step(h, first) {
    this.stage.update(h);
    if (this.state !== 'playing') return;
    this.tutor.update(h);
    // between stages: the last TRANSIT seconds of a stage are a short tally while you keep flying
    const st = this.stage;
    if (this.stageIdx >= 0 && this.tallied < this.stageIdx && st.stageEnding && !st.section.dock && st.remaining <= TRANSIT && st.section.stage === this.stageIdx) {
      if (this.stageIdx < this.data.stages.length - 1) this.stageTally();
    }
    // world ↔ rail frame for this substep (breakable asteroid fields live in world space)
    this.stage.route.sample(this.stage.s, _rp, _rq);
    this.fields.setFrame(_rp, _rq);
    const D = this.scenery.dock;
    if (this.player.landing && D) {
      // the deck in rail space: the ship flies onto it as the rail runs out (Player._land)
      _v.copy(LAND_SPOT).applyQuaternion(D.quat).add(D.pos).sub(_rp).applyQuaternion(_rqi.copy(_rq).invert());
      this.player.landing.target.copy(_v);
    }
    this.waves.update(h);
    // aim deltas are consumed once per frame; movement/roll/fire apply every substep
    this.player.update(h, this.input, first);
    this.computeAim();
    this.enemies.update(h);
    this.hulks.update(h);
    this.hazards.update(h);
    if (this.boss) this.boss.update(h);
    this.shots.update(h);
    this.bullets.update(h);
    this.missiles.update(h);
    this.beams.update(h);
    this.bombs.update(h);
    this.rocks.update(h, this.stage.speed, !this.boss || this.boss.state !== 'dying');
    this.pickups.update(h);
    this.fx.update(h);
    this.collide();
    this.weather(h);
    this.director(h);
    this.flashLight = Math.max(0, (this.flashLight || 0) - h * 3);
    // the play box and the drift follow the section (ai/summary.md §4.2)
    const sec = this.stage.section;
    const k = damp(1.4, h);
    this.corridor.x += ((sec.box?.x ?? CORRIDOR.x) - this.corridor.x) * k;
    this.corridor.y += ((sec.box?.y ?? CORRIDOR.y) - this.corridor.y) * k;
    this.drift.x += ((sec.drift?.[0] ?? 0) - this.drift.x) * k;
    this.drift.y += ((sec.drift?.[1] ?? 0) - this.drift.y) * k;
    const fog = this.r.scene.fog;
    if (fog) fog.density += ((sec.fog ?? this.loc.fog.density) - fog.density) * damp(0.8, h);
  }

  /**
   * Per-substep rules on top of the wave timeline: the chain's clock, the bullet cap, the rescue gunship and the
   * boss-fight feeder waves (ai/summary.md §6, §7).
   */
  director(h) {
    const c = this.chain;
    if (c.n > 0 && (c.t -= h) <= 0) c.n = 0;
    const cap = this.difficulty.maxBullets;
    this.fireHeld = !!cap && this.bullets.n >= cap;
    const p = this.player;
    if (this.rescueT > 0 && p.alive) {
      if (p.power >= 2) this.rescueT = 0;
      else if ((this.rescueT -= h) <= 0 && !this.boss?.active) {
        this.waves.start({ ...RESCUE, id: feederId++, type: 'hammer', drop: 'pow', hpMul: 0.6, noFire: true, rescue: true });
        this.hud.hint('Supply gunship: shoot it for power', 3);
        this.tm?.event('rescue', {});
      }
    }
    const b = this.boss;
    const sec = this.stage.section;
    if (b?.active && b.state === 'fight' && sec.feeders !== false) {
      if ((this.feederT -= h) <= 0) {
        this.feederT = 6 + rng() * 2;
        this.feeder();
      }
    } else {
      this.feederT = 4;
      // a lull anywhere else (nothing shot down for 8 s, fewer than 4 in the air): a feeder wave too
      const st = this.stage;
      if (!b?.active && !sec.dock && !st.stageEnding && !this.tutor.holding && this.stageIdx >= 0 && this.time - this.lastKillT > 8 && this.enemies.alive < 4) {
        this.lastKillT = this.time - 2; // the next one no sooner than 6 s from now
        this.feeder();
      }
    }
  }

  /** A small wave of darts through the gun line: no fire in locations 1–2, half rate after that. */
  feeder() {
    const w = FEEDERS[this.feederK++ % FEEDERS.length];
    this.waves.start({ ...w, id: feederId++, type: 'dart', feeder: true, noFire: this.locIdx < 2, slowFire: 2 });
    this.tm?.event('feeder', { boss: !!this.boss?.active });
  }

  /** Is a rail-local point inside the view (last rendered camera)? */
  onScreen(x, y, z, margin = 0.04) {
    _v.set(x, y, z).applyMatrix4(this.r.railRoot.matrixWorld).project(this.r.camera);
    return _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1 - margin && Math.abs(_v.y) < 1 - margin;
  }

  /**
   * Aim: the first target along the camera ray (with assist) is "locked". When locked, the shots converge on the
   * intercept point (lead), so travelling bolts still meet moving targets; locked bolts also home slightly.
   */
  computeAim() {
    const p = this.player;
    p.aimRay(_o, _d);
    const assist = this.input.isTouch ? 1.7 : 1.25;
    const sp = this.stage.speed;
    let best = LOCK_RANGE;
    let locked = false;
    let lockE = null;
    const test = (cx, cy, cz, r, vx, vy, vz, e) => {
      const ox = cx - _o.x;
      const oy = cy - _o.y;
      const oz = cz - _o.z;
      const tca = ox * _d.x + oy * _d.y + oz * _d.z;
      if (tca < 8) return;
      const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
      if (d2 > r * r) return;
      const t = tca - Math.sqrt(r * r - d2);
      if (t < best) {
        best = Math.max(8, t);
        locked = true;
        _tp.set(cx, cy, cz);
        _tv.set(vx, vy, vz);
        lockE = e;
      }
    };
    for (const e of this.enemies.list) if (!e.armored) test(e.pos.x, e.pos.y, e.pos.z, e.def.r * e.vs * assist, e.vel.x, e.vel.y, e.vel.z, e);
    const b = this.boss;
    if (b && b.active) for (const q of b.parts) if (q.alive) test(q.world.x, q.world.y, q.world.z, q.r * assist, 0, 0, 0, null);
    const hs = this.stage.speed;
    this.hulks.forParts((x, y, z, r, q, hk) => test(x, y, z, r * assist, 0, 0, hk.speed ?? hs, null));
    const R = this.rocks;
    for (let i = 0; i < R.n; i++) {
      const i3 = i * 3;
      test(R.p[i3], R.p[i3 + 1], R.p[i3 + 2], R.radius(i) * 1.1, R.v[i3], R.v[i3 + 1], R.v[i3 + 2] + sp, null);
    }
    const ft = this.fields.rayTest(_o, _d, best, _fc);
    if (ft >= 0 && ft < best) {
      best = ft;
      locked = true;
      _tp.copy(_fc);
      _tv.set(0, 0, sp);
      lockE = null;
    }
    this.locked = locked;
    this.lockEnemy = lockE;
    if (!locked) {
      p.aimPoint.copy(_o).addScaledVector(_d, DEFAULT_AIM);
      this.leadOn = false;
      return;
    }
    const t = intercept(p.pos, _tp, _tv, SHOT_SPEED);
    p.aimPoint.copy(_tp).addScaledVector(_tv, t);
    this.leadOn = _tv.lengthSq() * t * t > 9;
    if (this.leadOn) this.leadPoint.copy(p.aimPoint);
  }

  /** Up to n homing-missile targets: enemies on screen, ahead, nearest to the crosshair first. */
  missileTargets(n) {
    const out = [];
    const W = this.r.width / 2;
    const H = this.r.height / 2;
    const cand = [];
    for (const e of this.enemies.list) {
      if (e.pos.z > this.player.pos.z - 20 || e.pos.z < -560) continue;
      if (!this.toScreen(e.pos.x, e.pos.y, e.pos.z, _v)) continue;
      if (_v.x < 0 || _v.y < 0 || _v.x > W * 2 || _v.y > H * 2) continue;
      cand.push([Math.hypot(_v.x - W, _v.y - H) - (e === this.lockEnemy ? 1e4 : 0), e]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(n, cand.length); i++) out.push(cand[i][1]);
    if (out.length === 1 && n > 1) out.push(out[0]);
    return out;
  }

  /** Player laser: damage the first thing along o + d·t (t ≤ LOCK_RANGE). Returns the beam length. */
  laser(o, d, dmg) {
    let best = LOCK_RANGE;
    let hitE = null;
    let hitPart = null;
    let hitRock = -1;
    const ray = (cx, cy, cz, r) => {
      const ox = cx - o.x;
      const oy = cy - o.y;
      const oz = cz - o.z;
      const tca = ox * d.x + oy * d.y + oz * d.z;
      if (tca < 1) return -1;
      const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
      if (d2 > r * r) return -1;
      return tca - Math.sqrt(r * r - d2);
    };
    for (const e of this.enemies.list) {
      const t = ray(e.pos.x, e.pos.y, e.pos.z, e.def.r * e.vs);
      if (t > 0 && t < best) {
        best = t;
        hitE = e;
      }
    }
    const b = this.boss;
    if (b && b.active && b.state !== 'dying') {
      for (const q of b.parts) {
        if (!q.alive) continue;
        const t = ray(q.world.x, q.world.y, q.world.z, q.r);
        if (t > 0 && t < best) {
          best = t;
          hitPart = q;
          hitE = null;
        }
      }
    }
    let hulkPart = null;
    this.hulks.forParts((x, y, z, r, q, hk) => {
      const t = ray(x, y, z, r);
      if (t > 0 && t < best) {
        best = t;
        hulkPart = [hk, q];
        hitE = null;
        hitPart = null;
      }
    });
    const R = this.rocks;
    for (let i = 0; i < R.n; i++) {
      const t = ray(R.p[i * 3], R.p[i * 3 + 1], R.p[i * 3 + 2], R.radius(i));
      if (t > 0 && t < best) {
        best = t;
        hitRock = i;
        hitE = null;
        hitPart = null;
        hulkPart = null;
      }
    }
    const ft = this.fields.rayTest(o, d, best, _fc);
    const field = ft >= 0 && ft < best ? this.fields.lastRay : -1;
    if (field >= 0) best = ft;
    const hx = o.x + d.x * best;
    const hy = o.y + d.y * best;
    const hz = o.z + d.z * best;
    if (field >= 0) this.fields.damage(field, dmg);
    else if (hulkPart) this.hulks.damage(hulkPart[0], hulkPart[1], dmg);
    else if (hitRock >= 0) this.hud.hitMarker(R.damage(hitRock, dmg));
    else if (hitPart) {
      if ((hitPart.core && !b.coreVulnerable()) || b.state === 'enter') this.fx.deflect(hx, hy, hz);
      else b.damagePart(hitPart, dmg);
    } else if (hitE) {
      const res = this.enemies.damage(hitE, dmg, false, 'laser');
      if (res !== 'deflect') this.hud.hitMarker(res === 'kill');
    }
    if ((hitE || hitPart || hulkPart || hitRock >= 0 || field >= 0) && rng() < 0.35) this.fx.sparks(hx, hy, hz, 2, 20, PAL.cyan, 0.25);
    return best;
  }

  collide() {
    const S = this.shots;
    const E = this.enemies;
    const R = this.rocks;
    const B = this.bullets;
    const M = this.missiles;
    const p = this.player;
    const boss = this.boss && this.boss.active ? this.boss : null;

    // player bolts
    for (let i = S.n - 1; i >= 0; i--) {
      const i3 = i * 3;
      const ax = S.prev[i3];
      const ay = S.prev[i3 + 1];
      const az = S.prev[i3 + 2];
      const bx = S.p[i3];
      const by = S.p[i3 + 1];
      const bz = S.p[i3 + 2];
      const dmg = S.dmg[i];
      const used = this.hitAnything(ax, ay, az, bx, by, bz, dmg, 'shot', S.age[i], BOLT_PAD);
      if (used) S.remove(i);
    }
    // player missiles
    for (let i = M.n - 1; i >= 0; i--) {
      if (M.owner[i] !== 0) continue;
      const i3 = i * 3;
      if (this.hitAnything(M.prev[i3], M.prev[i3 + 1], M.prev[i3 + 2], M.p[i3], M.p[i3 + 1], M.p[i3 + 2], 3, 'missile', M.age[i], 1.2)) {
        this.fx.explosion(M.p[i3], M.p[i3 + 1], M.p[i3 + 2], 0.45, PAL.cyan, this.stage.speed * 0.4);
        M.remove(i);
      }
    }

    if (!p.alive) return;
    const pp = p.pos;
    if (p.evading) {
      // evasive roll: everything passes through; each bullet or missile that would have hit is a DODGE
      for (let i = B.n - 1; i >= 0; i--) {
        const i3 = i * 3;
        const rr = bulletHitR(B.radius(i));
        if (B.dodged[i] || Math.abs(B.p[i3 + 2] - pp.z) > 8) continue;
        if (segPointDist2(B.prev[i3], B.prev[i3 + 1], B.prev[i3 + 2], B.p[i3], B.p[i3 + 1], B.p[i3 + 2], pp.x, pp.y, pp.z) < rr * rr) {
          B.dodged[i] = 1;
          this.onDodge(B.isShell(i) ? 'shell' : 'bullet');
        }
      }
      for (let i = M.n - 1; i >= 0; i--) {
        if (M.owner[i] !== 1 || M.dodged[i]) continue;
        const i3 = i * 3;
        const rr = missileHitR();
        if (segPointDist2(M.prev[i3], M.prev[i3 + 1], M.prev[i3 + 2], M.p[i3], M.p[i3 + 1], M.p[i3 + 2], pp.x, pp.y, pp.z) < rr * rr) {
          M.dodged[i] = 1;
          this.onDodge('missile');
        }
      }
      return;
    }
    if (p.invuln <= 0) {
      for (let i = B.n - 1; i >= 0; i--) {
        const i3 = i * 3;
        const rr = bulletHitR(B.radius(i));
        if (Math.abs(B.p[i3 + 2] - pp.z) > 8) continue;
        if (segPointDist2(B.prev[i3], B.prev[i3 + 1], B.prev[i3 + 2], B.p[i3], B.p[i3 + 1], B.p[i3 + 2], pp.x, pp.y, pp.z) < rr * rr) {
          const src = {
            src: B.isShell(i) ? 'shell' : 'bullet', kind: B.kind[i], x: B.p[i3], y: B.p[i3 + 1], z: B.p[i3 + 2],
            age: +B.age[i].toFixed(2), markedFor: B.markT[i] >= 0 ? +(this.time - B.markT[i]).toFixed(2) : 0,
          };
          B.remove(i);
          p.hit(1, src);
          break;
        }
      }
      for (let i = M.n - 1; i >= 0; i--) {
        if (M.owner[i] !== 1) continue;
        const i3 = i * 3;
        const rr = missileHitR();
        if (segPointDist2(M.prev[i3], M.prev[i3 + 1], M.prev[i3 + 2], M.p[i3], M.p[i3 + 1], M.p[i3 + 2], pp.x, pp.y, pp.z) < rr * rr) {
          const src = { src: 'missile', x: M.p[i3], y: M.p[i3 + 1], z: M.p[i3 + 2], age: +M.age[i].toFixed(2), markedFor: M.markT[i] >= 0 ? +(this.time - M.markT[i]).toFixed(2) : 0 };
          M.pop(i);
          p.hit(1, src);
          break;
        }
      }
    }
    for (let k = E.list.length - 1; k >= 0; k--) {
      const e = E.list[k];
      // fair collisions: nothing rams you from behind the camera, where you can't see it coming. Overtakers flying
      // past you (moving away) and ships that only just appeared can't collide either.
      if (e.pos.z > pp.z + BEHIND_SAFE || e.vel.z < -5 || e.t < 1) continue;
      const rr = shipHitR(e.def.r);
      if (e.pos.distanceToSquared(pp) < rr * rr) {
        const src = { src: 'ram', type: e.type, x: e.pos.x, y: e.pos.y, z: e.pos.z, age: +e.t.toFixed(2), markedFor: e.markT >= 0 ? +(this.time - e.markT).toFixed(2) : 0 };
        if (p.hit(1, src, e) || p.invuln > 0) E.damage(e, 6, true, 'ram');
      }
    }
    for (let k = R.n - 1; k >= 0; k--) {
      const rr = rockHitR(R.radius(k));
      const dx = R.p[k * 3] - pp.x;
      const dy = R.p[k * 3 + 1] - pp.y;
      const dz = R.p[k * 3 + 2] - pp.z;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        p.hit(1, { src: 'rock', x: R.p[k * 3], y: R.p[k * 3 + 1], z: R.p[k * 3 + 2], age: +(this.time - R.born[k]).toFixed(2), markedFor: R.markT[k] >= 0 ? +(this.time - R.markT[k]).toFixed(2) : 0 });
        R.damage(k, 99);
      }
    }
    if (boss && boss.touches(pp, 1.2)) p.hit(1, { src: 'boss', x: boss.pos.x, y: boss.pos.y, z: boss.pos.z });
    const hk = this.hulks.list.length ? this.hulks.touches(pp, 1.2) : null;
    if (hk) p.hit(1, { src: 'hulk', x: hk.pos.x, y: hk.pos.y, z: hk.pos.z });
  }

  /**
   * A player weapon segment a→b against everything shootable: enemies, boss parts, enemy missiles and shells,
   * corridor rocks, asteroid fields. Returns true if it hit something (and applied damage).
   */
  hitAnything(ax, ay, az, bx, by, bz, dmg, by_, age, pad = 0) {
    const E = this.enemies;
    const R = this.rocks;
    const B = this.bullets;
    const boss = this.boss && this.boss.active ? this.boss : null;
    const zmin = Math.min(az, bz);
    const zmax = Math.max(az, bz);
    const list = E.list;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      const r = e.def.r * e.vs + pad;
      const ez = e.pos.z;
      if (ez < zmin - r || ez > zmax + r) continue;
      if (segPointDist2(ax, ay, az, bx, by, bz, e.pos.x, e.pos.y, ez) < r * r) {
        const res = E.damage(e, dmg, false, by_);
        if (res === 'deflect') this.audio.deflect();
        else this.hud.hitMarker(res === 'kill');
        if (this.tm && by_ === 'shot') this.tm.event('shothit', { age: +age.toFixed(2), d: Math.round(-ez), res });
        return true;
      }
    }
    if (boss && boss.hitTest(ax, ay, az, bx, by, bz, dmg)) return true;
    if (this.hulks.list.length && this.hulks.hitTest(ax, ay, az, bx, by, bz, dmg)) return true;
    if (this.missiles.shotTest(ax, ay, az, bx, by, bz)) return true;
    for (let i = 0; i < B.n; i++) {
      if (!B.isShell(i)) continue;
      const i3 = i * 3;
      const r = B.radius(i) + 0.4 + pad;
      if (segPointDist2(ax, ay, az, bx, by, bz, B.p[i3], B.p[i3 + 1], B.p[i3 + 2]) < r * r) {
        this.fx.explosion(B.p[i3], B.p[i3 + 1], B.p[i3 + 2], 0.6, PAL.fire, this.stage.speed * 0.4);
        this.addScore(50, B.p[i3], B.p[i3 + 1], B.p[i3 + 2]);
        this.audio.shellPop();
        this.hud.hitMarker(true);
        this.tutor.onShellShot();
        B.remove(i);
        return true;
      }
    }
    for (let k = 0; k < R.n; k++) {
      const r = R.radius(k) + pad;
      const rz = R.p[k * 3 + 2];
      if (rz < zmin - r || rz > zmax + r) continue;
      if (segPointDist2(ax, ay, az, bx, by, bz, R.p[k * 3], R.p[k * 3 + 1], rz) < r * r) {
        this.hud.hitMarker(R.damage(k, dmg));
        return true;
      }
    }
    return this.fields.hitSegment(ax, ay, az, bx, by, bz, dmg);
  }

  weather(h) {
    if (!this.lightning) {
      this.boltI = Math.max(0, (this.boltI || 0) - h * 6);
      return;
    }
    this.boltT -= h;
    if (this.boltT <= 0) {
      this.boltT = 0.35 + rng() * 2.2;
      this.boltI = 1;
      // a point on the cloud tops ahead of the camera
      this.stage.route.localToWorld(this.stage.s + 150 + rng() * 500, (rng() - 0.5) * 900, -200, 0, _v);
      this.boltPos = _v.clone();
      this.audio.explosion(0.4);
    }
    this.boltI *= Math.exp(-h * 9);
  }

  // ------------------------------------------------------------------------------------------
  // events

  onSectionStart(sec, time) {
    if (this.state === 'title') return;
    if (sec.stage !== this.stageIdx) this.onStageStart(sec.stage);
    this.tm?.event('section', { id: sec.id });
    this.waves.load(sec);
    if (time > 0) {
      // debug jump: skip waves that are already in the past
      this.waves.clock = time;
      while (this.waves.idx < sec.waves.length && sec.waves[this.waves.idx].at < time) this.waves.idx++;
    }
    this.rocks.setDensity(sec.rocks);
    this.lightning = !!sec.lightning;
    // the theme drops to pad and bass in the dark (location 1's night side), the boss cue for a boss
    if (sec.boss || sec.song) this.music?.play(this.loc.songs?.[sec.song || 'boss']);
    else if (time === 0 || !this.music?.mainSong) this.music?.play(this.loc.songs?.theme);
    this.music?.calm(!!sec.calm);
    if (sec.boss) {
      this.boss = this.bosses[sec.boss];
      this.boss.start(sec.bossTime ?? sec.duration - 5);
      this.bossName = this.boss.name;
    }
    if (sec.dock) this.player.startLanding(sec.duration);
  }

  /** A new stage: its difficulty ramp, fresh per-stage stats, its title card. */
  onStageStart(i) {
    const st = this.data.stages[i];
    this.stageIdx = i;
    this.difficulty = this.makeDifficulty(this.locIdx, st.ramp);
    this.waves.minAlive = this.difficulty.minAlive;
    this.stats = newStats(this.player.score);
    this.lastKillT = this.time;
    this.player.evades = EVADES; // evasive rolls refill every stage
    this.tutor.close('stage end');
    const label = `${this.locIdx + 1}-${i + 1}`;
    this.hud.setStage(label, i, this.data.stages.length);
    // the location's own title card comes first on its first stage
    // "12 OF 35": where this stage sits in the whole campaign
    const counts = this.stageCounts || [];
    let n = i + 1;
    for (let k = 0; k < this.locIdx; k++) n += counts[k] || 0;
    const total = counts.length ? counts.reduce((a, b) => a + b, 0) : this.data.stages.length;
    this.hud.stageCard(label, st.name, this.locIntro ? 3.2 : 0, n < total ? `${n} OF ${total}` : 'FINAL STAGE');
    this.locIntro = false;
    this.scenery.checkpoint(i, false);
    this.tm?.event('stage', { n: i + 1, loc: this.locIdx + 1, name: st.name });
  }

  /** Grade of a stage from its shoot-down ratio and hits taken. */
  grade(s) {
    const pct = s.spawned ? s.killed / s.spawned : 0;
    if (pct >= 0.9 && s.hits === 0) return 'S';
    if (pct >= 0.75 && s.hits <= 1) return 'A';
    if (pct >= 0.5) return 'B';
    return 'C';
  }

  /** The current stage's numbers into the location's totals (once per stage). */
  closeStage() {
    const s = this.stats;
    const L = this.locStats;
    if (!L || s.closed) return;
    s.closed = true;
    L.spawned += s.spawned;
    L.killed += s.killed;
    L.hits += s.hits;
    L.grades[this.stageIdx] = this.grade(s);
  }

  /**
   * Between-stage tally (non-blocking): shoot-down bonus, aligned kills, a no-hit bonus, one shield pip back. The
   * stage's checkpoint gate turns green as you fly through it, and the stage-clear jingle plays.
   */
  stageTally() {
    const i = this.stageIdx;
    this.tallied = i;
    const s = this.stats;
    const p = this.player;
    const pct = s.spawned ? s.killed / s.spawned : 0;
    const ratioBonus = Math.round(pct * 100) * 100;
    const alignBonus = s.aligned * 300;
    const noHit = s.hits === 0 ? 5000 : 0;
    const chainBonus = s.maxChain * 100;
    this.award(ratioBonus + alignBonus + noHit + chainBonus);
    const repair = p.alive && p.shield < 3 && this.difficulty.drops >= 1;
    if (repair) p.shield++;
    this.rocks.setDensity(null);
    this.closeStage();
    const rows = [
      ['Shot down', `${s.killed} / ${s.spawned}  (${Math.round(pct * 100)}%)`],
      ['Ratio bonus', ratioBonus],
    ];
    if (alignBonus) rows.push(['Aligned kills', alignBonus]);
    if (noHit) rows.push(['No hits', noHit]);
    if (s.maxChain >= 5) rows.push([`Max chain ${s.maxChain} ×100`, chainBonus]);
    if (s.medals) rows.push(['Medals caught', String(s.medals)]);
    const rewards = [repair ? '+1 SHIELD' : null, 'ROLLS REFILLED'].filter(Boolean);
    this.hud.stageTally(`STAGE ${this.locIdx + 1}-${i + 1} CLEAR`, rows, TRANSIT - 0.4, {
      grade: this.locStats.grades[i], stage: i, stages: this.data.stages.length, rewards,
    });
    this.scenery.checkpoint(i, true);
    this.music?.jingle('stageClear');
    this.audio.extraLife();
    this.tm?.event('stageclear', { n: i + 1, loc: this.locIdx + 1, spawned: s.spawned, raw: s.raw, killed: s.killed, aligned: s.aligned, hits: s.hits, maxChain: s.maxChain, medals: s.medals, bonus: ratioBonus + alignBonus + noHit + chainBonus, score: p.score, grade: this.locStats.grades[i] });
  }

  onSectionEnd(sec) {
    if (this.state === 'title') return;
    if (this.boss && this.boss.active) this.boss.finish(false);
    this.boss = null;
    if (sec.dock) this.locationClear();
  }

  onForkChosen(fork, option) {
    this.tm?.event('fork', { key: option.key });
    this.hud.banner(option.label, 1.6);
    this.audio.whoosh();
  }

  onBossDone(boss, killed) {
    if (this.boss === boss) {
      if (killed) {
        this.hud.banner(`${boss.name} DESTROYED`, 2.4);
        this.stage.warp = true;
        this.bullets.clear();
        if (boss.def.final) this.run.finalKilled = true;
      } else if (boss.def.final) {
        // the last boss got away: the game ends without its ending (ai/summary.md §4.3)
        this.endGame(false);
      }
      this.boss = null;
      this.music?.play(this.loc.songs?.theme);
    }
  }

  /** One more kill on the chain. Returns the kill-point multiplier. */
  bumpChain() {
    const c = this.chain;
    const before = chainMul(c.n);
    c.n++;
    c.t = CHAIN_T;
    this.lastKillT = this.time;
    if (c.n > this.stats.maxChain) this.stats.maxChain = c.n;
    if (this.run && c.n > this.run.maxChain) this.run.maxChain = c.n;
    const mul = chainMul(c.n);
    if (mul > before) this.hud.chainUp?.();
    return mul;
  }

  onEnemyKilled(e, aligned, by = 'shot') {
    const mul = this.bumpChain();
    this.tm?.event('kill', { type: e.type, red: e.red, aligned, wave: e.wave.id, f: e.wave.f || 'launch', age: +e.t.toFixed(2), by, chain: this.chain.n, pass: e.passes });
    const s = this.stats;
    s.killed++;
    if (aligned) s.aligned++;
    this.tutor.onKill(e, aligned, by);
    const k = (aligned ? 2 : 1) * mul;
    const pts = e.def.score * k;
    this.addScore(pts, e.pos.x, e.pos.y, e.pos.z, false, k > 1 ? `${pts} ×${k}` : null);
    if (e.type === 'hammer') this.pickups.spawn('medal', e.pos.x + 4, e.pos.y, e.pos.z);
    this.fx.explosion(e.pos.x, e.pos.y, e.pos.z, e.def.explode, e.red ? PAL.red : PAL.fire, this.stage.speed * 0.35);
    this.audio.explosion(e.def.explode);
    if (e.def.explode > 2) this.player.shake = Math.max(this.player.shake, 0.6);
    const w = e.wave;
    w.killed = (w.killed || 0) + 1;
    if (!w.launched && w.n >= 3 && w.killed === w.n) {
      const bonus = 100 * w.n * (w.red ? 2 : 1);
      this.addScore(bonus, e.pos.x, e.pos.y + 3, e.pos.z, true, w.red ? `SQUADRON +${bonus}` : `FORMATION +${bonus}`);
      if (w.red) {
        this.pickups.spawn('pow', e.pos.x, e.pos.y, e.pos.z);
        this.tutor.onSquadron();
      }
    }
    if (w.drop && e.type === 'hammer') this.dropPickup(w.drop, e.pos.x, e.pos.y, e.pos.z);
  }

  /** A boss or hulk part destroyed: a kill like any other (ai/summary.md §6.2), with a medal. */
  onPartKilled(pos, size, score, boom) {
    this.stats.killed++;
    const mul = this.bumpChain();
    const pts = score * mul;
    this.fx.explosion(pos.x, pos.y, pos.z, size, PAL.fire, 10);
    this.audio.explosion(boom);
    this.addScore(pts, pos.x, pos.y, pos.z, true, mul > 1 ? `${pts} ×${mul}` : null);
    this.pickups.spawn('medal', pos.x, pos.y, pos.z);
  }

  /** Back from a lost ship: up to 3 POWs wait at the wreck, ahead of you (ai/summary.md §6.1). */
  onRespawn(lost) {
    const p = this.player;
    const n = Math.min(3, Math.ceil(lost / 2));
    for (let i = 0; i < n; i++) this.pickups.spawn('pow', p.pos.x + (i - (n - 1) / 2) * 7, p.pos.y + (i % 2 ? 3 : -1), -78 - i * 6, true);
    if (n) this.hud.hint(`${n} POW${n > 1 ? 's' : ''} from the wreck`, 2.4);
    this.rescueT = RESCUE_T;
    this.recover = { t: this.time, lost, two: false };
  }

  /** A pickup drifted past without being caught: a missed medal starts the medal ladder again. */
  onPickupMissed(type) {
    if (type !== 'medal') return;
    this.medalIdx = 0;
    this.tm?.event('medalmiss', {});
  }

  /** A pickup drop (gunships, hulks, bosses). Location 5 takes some away: its ramp's `drops` and `noShield`. */
  dropPickup(type, x, y, z) {
    const d = this.difficulty;
    if (type !== 'pow' && (rng() > d.drops || (type === 'shield' && d.noShield))) return;
    this.pickups.spawn(type, x, y, z);
  }

  onEnemyEscaped(e) {
    this.tm?.event('escape', { type: e.type, wave: e.wave.id });
    e.wave.gone = (e.wave.gone || 0) + 1;
  }

  onPlayerDied() {
    if (this.locStats) this.locStats.deaths++;
    this.chain.n = 0;
    this.hud.flash(0.6);
    if (this.player.lives <= 0) this.overT = 2.4;
    else this.hud.hint(`${this.player.lives} ship${this.player.lives > 1 ? 's' : ''} left`, 2);
  }

  addScore(pts, x, y, z, big = false, label = null) {
    this.award(pts);
    if (this.toScreen(x, y, z, _v)) this.hud.popup(label || String(pts), _v.x, _v.y, big ? 'gold' : label ? 'cyan' : '');
  }

  /** Points without a popup (tallies); extra ships at the score thresholds. */
  award(pts) {
    const p = this.player;
    const before = p.score;
    p.score += pts;
    for (const t of EXTRA_LIVES) {
      if (before < t && p.score >= t) {
        p.lives++;
        this.hud.banner('EXTRA SHIP', 1.6);
        this.audio.extraLife();
      }
    }
    if (p.score > this.hi) this.hi = p.score;
  }

  collect(type, pos) {
    this.tm?.event('pickup', type === 'medal' ? { type, value: MEDALS[this.medalIdx] } : { type });
    const p = this.player;
    this.fx.ring(pos.x, pos.y, pos.z, 6, PICKUP[type].glow, 0.4);
    if (type === 'pow') {
      if (p.power < MAX_POWER) {
        p.power++;
        this.tm?.event('power', { level: p.power });
        const R = this.recover;
        if (R && p.power >= 2 && !R.two) {
          R.two = true;
          this.tm?.event('recover', { to: 2, s: +(this.time - R.t).toFixed(1), lost: R.lost });
        }
        if (R && p.power >= R.lost) {
          this.tm?.event('recover', { to: R.lost, s: +(this.time - R.t).toFixed(1), lost: R.lost, full: true });
          this.recover = null;
        }
        this.hud.banner('POWER UP\n' + POWER[p.power], 1.6);
        this.audio.powerUp();
      } else {
        this.addScore(5000, pos.x, pos.y, pos.z, true);
        this.audio.pickup();
      }
    } else if (type === 'medal') {
      const v = MEDALS[this.medalIdx];
      this.medalIdx = Math.min(MEDALS.length - 1, this.medalIdx + 1);
      this.stats.medals++;
      this.addScore(v, pos.x, pos.y, pos.z, true, `MEDAL ${v}`);
      this.audio.pickup();
    } else if (type === 'bomb') {
      p.bombs = Math.min(5, p.bombs + 1);
      this.hud.hint('+1 BOMB', 1.2);
      this.audio.pickup();
    } else if (type === 'laser') {
      p.laserT = 8;
      this.hud.banner('LASER\nhold fire: instant beam', 1.6);
      this.audio.powerUp();
    } else if (type === 'shield') {
      if (p.shield < 3) p.shield++;
      else this.addScore(2000, pos.x, pos.y, pos.z, true);
      this.hud.hint('SHIELD +1', 1.2);
      this.audio.pickup();
    }
  }

  /** Bomb: thrown forward, then an expanding shockwave clears bullets as it passes (weapons.js Bombs). */
  useBomb() {
    const p = this.player;
    if (!p.alive || p.bombs <= 0 || this.bombs.active) return;
    p.bombs--;
    p.invuln = Math.max(p.invuln, 1.6);
    _d.subVectors(p.aimPoint, p.pos).normalize();
    this.bombs.throw(_v.copy(p.pos).addScaledVector(_d, 3), _d);
    this.audio.whoosh();
    this.tutor.onBomb();
    this.tm?.event('bomb', { shield: p.shield, bullets: this.bullets.n });
  }

  /** Feedback when the player takes a hit: hit-stop, impact flash, culprit flash, direction arc, first-time label. */
  onPlayerHit(src, culprit) {
    const p = this.player;
    this.stats.hits++;
    this.tutor.onHit(src);
    this.hitStop = 0.07;
    if (culprit) culprit.flash = 1;
    if (!src || src.x === undefined) return;
    const pp = p.pos;
    this.fx.flash((pp.x + src.x) / 2, (pp.y + src.y) / 2, pp.z, 3.2, PAL.red, 0.18, 1);
    // direction on screen: rail-local offset rotated into the (rolled) camera frame; head-on reads as "ahead"
    const dx = src.x - pp.x;
    const dy = src.y - pp.y;
    let deg = 0;
    if (Math.hypot(dx, dy) > 0.4) {
      const c = Math.cos(p.roll);
      const s = Math.sin(p.roll);
      deg = (Math.atan2(dx * c + dy * s, -dx * s + dy * c) * 180) / Math.PI;
    }
    this.hud.hitDirection(deg);
    const label = HIT_LABEL[src.src];
    if (label && !this.hitLabels.has(label) && this.toScreen(pp.x, pp.y, pp.z, _v)) {
      this.hitLabels.add(label);
      this.hud.popup('HIT BY ' + label, _v.x, _v.y - 46, 'warn');
    }
  }

  onEvade() {
    const p = this.player;
    this.audio.evade();
    this.tm?.event('evade', { left: p.evades });
  }

  /** Something passed through the ship during an evasive roll. */
  onDodge(src) {
    const p = this.player;
    this.tm?.event('dodge', { src });
    this.tutor.onDodge(src);
    if (this.toScreen(p.pos.x, p.pos.y, p.pos.z, _v)) this.hud.popup('DODGE', _v.x, _v.y - 30, 'cyan');
  }

  shakeCamera(v) {
    this.player.shake = Math.max(this.player.shake, v);
  }
  flashScreen(v) {
    this.hud.flash(v);
  }

  /**
   * Landed on the carrier: the location clear screen (ai/summary.md §4.3). The last stage's tally, the location's
   * grades and medals, then a full shield and bombs as the reward. main.js shows the screen and the star map.
   */
  locationClear() {
    const s = this.stats;
    const p = this.player;
    const L = this.locStats;
    this.closeStage();
    this.tm?.event('stageclear', { n: this.stageIdx + 1, loc: this.locIdx + 1, spawned: s.spawned, killed: s.killed, aligned: s.aligned, hits: s.hits, score: p.score, grade: L.grades[this.stageIdx] });
    const pct = s.spawned ? s.killed / s.spawned : 0;
    const ratioBonus = Math.round(pct * 100) * 100;
    const alignBonus = s.aligned * 300;
    const noHit = s.hits === 0 ? 5000 : 0;
    const chainBonus = s.maxChain * 100;
    const shieldBonus = p.shield * 2000;
    const livesBonus = Math.max(0, p.lives - 1) * 10000;
    const locPct = L.spawned ? L.killed / L.spawned : 0;
    const grades = this.data.stages.map((_, i) => L.grades[i] || 'C');
    const medals = { cleared: true, noLoss: L.deaths === 0, ratio90: locPct >= 0.9, allS: grades.every((g) => g === 'S') };
    this.award(ratioBonus + alignBonus + noHit + chainBonus + shieldBonus + livesBonus);
    p.shield = 3;
    p.bombs = Math.max(p.bombs, 2);
    const final = this.locIdx === this.locCount - 1;
    const rec = { index: this.locIdx, id: this.loc.id, name: this.loc.name, grades, medals, pct: locPct, deaths: L.deaths, score: p.score, final };
    this.run.locs[this.locIdx] = rec;
    this.tm?.event('locclear', { loc: this.locIdx + 1, pct: +locPct.toFixed(3), deaths: L.deaths, grades: grades.join(''), score: p.score });
    this.state = 'locclear';
    this.music?.play(this.loc.songs?.clear || 'locClear');
    this.emit('locclear', {
      ...rec,
      rows: [
        [`Stage ${this.locIdx + 1}-${this.stageIdx + 1}: shot down`, `${s.killed} / ${s.spawned}  (${Math.round(pct * 100)}%)`],
        ['Ratio bonus', ratioBonus],
        ['Aligned kills ×300', alignBonus],
        ['No hits', noHit],
        [`Max chain ${s.maxChain} ×100`, chainBonus],
        ['Shield bonus ×2,000', shieldBonus],
        ['Ships left ×10,000', livesBonus],
      ],
    });
  }

  /** The end of the game: the ending (the Dreadnought destroyed) or not (it escaped). */
  endGame(good) {
    this.state = 'ended';
    const r = this.run;
    const p = this.player;
    // the clear bonus (ai/summary.md §6.3): doubled for a one-credit clear
    const clearBonus = good ? (CLEAR_BONUS + 50000 * Math.max(0, p.lives - 1)) * (r.continues === 0 ? 2 : 1) : 0;
    this.award(clearBonus);
    this.tm?.event('end', { good, score: p.score, continues: r.continues, clearBonus, maxChain: r.maxChain });
    this.music?.play(good ? 'ending' : 'gameOver');
    this.emit('ended', { good, score: p.score, hi: this.hi, continues: r.continues, seconds: this.time - r.t0, locs: r.locs, clearBonus, maxChain: r.maxChain, reached: this.reached() });
  }

  gameOver() {
    this.music?.play('gameOver');
    this.tm?.event('over', { score: this.player.score });
    this.state = 'over';
    this.emit('over', { score: this.player.score, hi: this.hi, reached: this.reached(), continues: this.run?.continues || 0 });
  }

  /** "4-3": the stage reached, for the hall of fame. */
  reached() {
    return `${this.locIdx + 1}-${Math.max(0, this.stageIdx) + 1}`;
  }

  // ------------------------------------------------------------------------------------------
  // debug autopilot (used for automated performance runs)

  autopilot(dt) {
    const p = this.player;
    const inp = this.input;
    let target = null;
    let bestZ = -Infinity;
    for (const e of this.enemies.list) {
      if (e.pos.z < -20 && e.pos.z > -260 && e.pos.z > bestZ) {
        bestZ = e.pos.z;
        target = e.pos;
      }
    }
    if (!target && this.boss?.active) target = this.boss.parts.find((q) => q.alive)?.world || this.boss.pos;
    if (target) {
      _v.subVectors(target, p.camPos).normalize();
      const yaw = Math.atan2(-_v.x, -_v.z);
      const pitch = Math.asin(clamp(_v.y, -1, 1));
      p.yaw += (clamp(yaw, -0.9, 0.9) - p.yaw) * damp(6, dt);
      p.pitch += (clamp(pitch, -0.6, 0.6) - p.pitch) * damp(6, dt);
    }
    let shielded = null;
    for (const e of this.enemies.list) if (e.shielded) shielded = e.roll;
    const want = shielded ?? 0;
    const diff = angleDiff(want, p.roll);
    inp.roll = Math.abs(diff) > 0.1 ? -Math.sign(diff) : 0;
    // dodge the nearest incoming bullet, otherwise drift
    let mx = Math.sin(this.time * 0.7) * 0.6;
    let my = Math.sin(this.time * 0.43) * 0.5;
    const B = this.bullets;
    let best = 1e9;
    for (let i = 0; i < B.n; i++) {
      const dz = p.pos.z - B.p[i * 3 + 2];
      if (dz < 0 || dz > 45) continue;
      const dx = p.pos.x - B.p[i * 3];
      const dy = p.pos.y - B.p[i * 3 + 1];
      const d = dx * dx + dy * dy;
      if (d < best && d < 36) {
        best = d;
        mx = Math.sign(dx || 1);
        my = Math.sign(dy || 1);
      }
    }
    inp.moveX = mx;
    inp.moveY = my;
    inp.fire = true;
  }

  // ------------------------------------------------------------------------------------------
  // render

  toScreen(x, y, z, out) {
    out.set(x, y, z).applyMatrix4(this.r.railRoot.matrixWorld).project(this.r.camera);
    if (out.z > 1 || out.z < -1) return false;
    out.x = (out.x * 0.5 + 0.5) * this.r.width;
    out.y = (-out.y * 0.5 + 0.5) * this.r.height;
    return true;
  }

  render(dt) {
    const r = this.r;
    const p = this.player;
    const t = this.time;
    const st0 = this.stage;
    this.stage.apply(r.railRoot);
    p.applyCamera(r.camera, t, this.options.reduceFlash);

    // camera world position for background / lighting
    _cam.copy(r.camera.position).applyQuaternion(r.railRoot.quaternion).add(r.railRoot.position);
    const bd = this.backdrop;
    const light = bd.lightFactor(_cam, this.sunDir, st0);
    const bolt = this.boltI || 0;
    if (bd.setBolt) {
      if (bolt > 0.01 && this.boltPos) bd.setBolt(this.boltPos, bolt);
      else bd.setBolt(_cam, 0);
    }
    r.setLighting(light, bolt * 0.35 + (this.flashLight || 0));
    this.stars.update(_cam, t, r.gl.getPixelRatio());
    this.sunObj.update(_cam, this.sunDir, this.loc.sunHidden ? 0 : light, this.loc.sunStyle);
    bd.update(t, _cam, this.sunDir, st0, dt);
    const st = this.stage;
    const decided = st.decided[this.forks[0]?.id] ?? true;
    this.scenery.update(st.s, st.route, decided, t, this.state === 'paused' ? 0 : dt);
    this.fields.setFrame(r.railRoot.position, r.railRoot.quaternion);
    this.fields.update(st.s, st.route, decided, this.state === 'paused' ? 0 : dt);

    const playing = this.state === 'playing' || this.state === 'paused';
    const g = this.glows;
    g.begin();
    p.draw(g, t);
    const shieldsVisible = this.enemies.draw(g, t);
    this.hulks.draw(g, t);
    this.pickups.draw(g, t);
    g.end();
    this.hazards.draw(t);
    this.fx.draw();
    this.shots.draw();
    this.bullets.draw(t);
    this.missiles.draw(t);
    this.bombs.draw(t);
    this.beams.draw(t);
    this.danger.update();
    this.danger.draw(t);
    this.rocks.draw();
    this.rockSpinMat.userData.uTime.value = t;
    let dustSpeed = st.speed;
    if (this.jumpT > 0 && this.state === 'playing') {
      const k = this.jumpT / JUMP_T;
      dustSpeed += 2600 * k * k;
      this.jumpT -= dt;
      if (this.jumpT <= 0) this.hud.flash(0.7);
    }
    this.dust.update(this.state === 'paused' ? 0 : dt, dustSpeed, 1 + (this.jumpT > 0 ? 2 : 0));
    for (const b of Object.values(this.bosses)) b.draw(t);

    if (playing) this.updateHud(dt, shieldsVisible);
    r.render();
    this.tm?.frame(dt);
  }

  updateHud(dt, shieldsVisible) {
    const p = this.player;
    const s = this.snap;
    s.score = p.score;
    s.hi = this.hi;
    s.lives = p.lives;
    s.shield = p.shield;
    s.bombs = p.bombs;
    s.evades = p.evades;
    s.evading = p.evadeT >= 0;
    s.power = p.power;
    s.roll = p.roll;
    s.locked = this.locked;
    s.firing = this.input.fire && p.alive;
    s.laserT = p.laserT;
    s.chain = this.chain.n;
    s.chainK = this.chain.t / CHAIN_T;
    s.chainMul = chainMul(this.chain.n);
    s.medal = MEDALS[this.medalIdx];
    s.lead = this.leadOn && this.locked && this.toScreen(this.leadPoint.x, this.leadPoint.y, this.leadPoint.z, _v2);
    if (s.lead) {
      s.leadX = _v2.x;
      s.leadY = _v2.y;
      this.leadPip = { x: _v2.x, y: _v2.y };
    } else this.leadPip = null;
    // nearest shielded enemy defines the roll notch
    s.notch = null;
    s.aligned = false;
    if (shieldsVisible) {
      let best = -Infinity;
      for (const e of this.enemies.list) {
        if (e.shielded && e.pos.z > best) {
          best = e.pos.z;
          s.notch = e.roll;
          s.aligned = e.shieldLevel < 0.5;
        }
      }
    }
    const boss = this.boss;
    s.bossActive = !!(boss && boss.active && boss.state !== 'retreat');
    if (s.bossActive) {
      s.bossName = boss.name;
      s.bossHp = boss.hp / boss.maxHp;
    }
    this.hud.update(dt, s);

    // off-screen arrows for nearby threats (enemies overtaking from behind)
    let n = 0;
    const W = this.r.width;
    const H = this.r.height;
    for (const e of this.enemies.list) {
      if (n >= 6) break;
      if (e.pos.z < -60) continue;
      _v.copy(e.pos).applyMatrix4(this.r.railRoot.matrixWorld).project(this.r.camera);
      const behind = _v.z > 1;
      let x = _v.x;
      let y = _v.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      if (!behind && Math.abs(x) < 0.95 && Math.abs(y) < 0.92) continue;
      const ang = Math.atan2(-y, x);
      const m = 34;
      const a = this.arrowBuf[n++];
      const k = Math.min((W / 2 - m) / Math.abs(Math.cos(ang) * W / 2 || 1e-6), (H / 2 - m) / Math.abs(Math.sin(ang) * H / 2 || 1e-6));
      a.x = W / 2 + Math.cos(ang) * (W / 2) * Math.min(1, k);
      a.y = H / 2 + Math.sin(ang) * (H / 2) * Math.min(1, k);
      a.angle = (ang * 180) / Math.PI + 90;
    }
    this.hud.setArrows(this.arrowBuf, n);
    this.arrowN = n;

    if (this.debug.stats) {
      const info = this.r.gl.info;
      this.hud.debug(
        `fps ${this.fps?.toFixed(0) ?? '-'}  cpu ${this.cpu?.toFixed(1)}ms (update ${this.cpuUpdate?.toFixed(1)})  scale ${this.r.res.scale.toFixed(2)}  tier ${this.r.tierName}\n` +
          `calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k\n` +
          `loc ${this.locIdx + 1}  sec ${this.stage.section.id} ${this.stage.time.toFixed(1)}s  route ${this.stage.route.key}  v ${this.stage.speed.toFixed(0)}\n` +
          `enemies ${this.enemies.list.length}  bullets ${this.bullets.n}  shots ${this.shots.n}  fx ${this.fx.n}  rocks ${this.rocks.n}`,
      );
    }
  }
}
