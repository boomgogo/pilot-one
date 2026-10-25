// Location 5: THE CORONA (ai/summary.md §4.2). Close to a blue-white star, through the ruins of a Dyson
// shell, to the enemy's home and the Dreadnought. The last location, and almost impossible: from its first stage it
// is harder than anything before it (fire rate, density, bullet speed), it keeps rising, it gives fewer pickups and no
// shield back at the tallies, and its bosses have shorter time limits. It stays fair: every rule that makes a hit
// avoidable (escape time, charge glow, aim lines, danger markers, nothing from behind) still holds.
// If the Dreadnought escapes, the game ends without its ending.
import { BoxGeometry, CylinderGeometry } from 'three';
import modelUrl from '../../assets/loc5.glb?url';
import { SkyBand, StarBody } from '../../render/backdrop-kit.js';
import { merged, piece } from '../../render/models.js';
import { railPath, scatter, sectionLabels } from './kit.js';

const PI = Math.PI;
const STAR_DIR = [-0.55, 0.55, -0.63];

// ------------------------------------------------------------------------------------------------
// Backdrop: the star itself, huge and boiling, up and to the left (never straight ahead), and a thin starfield in
// its glare.

class CoronaBackdrop {
  constructor(loc, tier, models, game) {
    this.game = game;
    const d = Math.hypot(...STAR_DIR);
    const D = 70000;
    this.star = new StarBody({
      radius: 31000, position: STAR_DIR.map((v) => (v / d) * D), colors: [0xffffff, 0x8ab8ff, 0x7aa8ff], segs: Math.max(40, tier.planetSegs >> 1),
    });
    this.glare = new SkyBand({ count: Math.round(tier.stars * 0.5), normal: STAR_DIR, width: 0.6, colors: [0xcfe0ff, 0xffffff], size: 1.2, seed: 71 });
    this.bgObjects = [...this.star.objects, this.glare.points];
    this.objects = [];
  }
  update(time, camPos) {
    this.star.update(time, camPos);
    this.glare.update(camPos, this.game.r.gl.getPixelRatio());
  }
  lightFactor() {
    return 1;
  }
}

// ------------------------------------------------------------------------------------------------
// Set dressing: the Dyson shell's broken plates, lit seams, and its spars.

const GOLD = [1, 0.75, 0.3];
const WHITE = [0.85, 0.92, 1];

function shellPlate(rng) {
  const w = 160 + rng() * 140;
  const pieces = [piece(new BoxGeometry(w, 10, w), 0x0c0a10, 0)];
  for (let k = -2; k <= 2; k++) {
    pieces.push(piece(new BoxGeometry(w, 10.6, 3), 0x5a4010, 0x2a1800, { p: [0, 0, (k * w) / 5] }));
    pieces.push(piece(new BoxGeometry(3, 10.6, w), 0x5a4010, 0x2a1800, { p: [(k * w) / 5, 0, 0] }));
  }
  const lights = [];
  for (let k = 0; k < 6; k++) lights.push([(rng() - 0.5) * w, 7, (rng() - 0.5) * w, k % 3 ? WHITE : GOLD, 6, k % 2 === 0]);
  return { geo: merged(pieces), radius: w * 0.7, lights };
}

function spar() {
  const pieces = [
    piece(new CylinderGeometry(4, 4, 420, 8), 0x2a2430, 0, { r: [0, 0, PI / 2] }),
    piece(new CylinderGeometry(6, 6, 8, 8), 0x000000, 0x9fc0ff, { p: [200, 0, 0], r: [0, 0, PI / 2] }),
    piece(new CylinderGeometry(6, 6, 8, 8), 0x000000, 0x9fc0ff, { p: [-200, 0, 0], r: [0, 0, PI / 2] }),
  ];
  return { geo: merged(pieces), radius: 210, lights: [[200, 0, 0, WHITE, 10, false], [-200, 0, 0, WHITE, 10, false]] };
}

function buildScenery(ctx) {
  const objects = [
    scatter(ctx, { from: 's4', to: 'end', count: 26, minD: 260, maxD: 900, scale: [0.8, 1.4], seed: 81, make: shellPlate, flat: 0.8 }),
    scatter(ctx, { from: 's3', to: 'end', count: 10, minD: 300, maxD: 800, scale: [0.8, 1.2], seed: 82, make: spar }),
  ].filter(Boolean);
  return { objects };
}

// ------------------------------------------------------------------------------------------------
// Hulks: the mirror array (stage 4: shoot the lens and its beam stops) and the shell's plate batteries (stage 5).

const HULKS = {
  mirror: {
    name: 'MIRROR', model: 'mirror', scale: 1.4, yaw: PI, tilt: PI / 2, bonus: 3000, drops: [], exitZ: 220,
    hull: [[0, 0, -2, 14]],
    parts: {
      lens: { hp: 26, r: 4.2, score: 1200, weapon: { w: 'laser', rate: 5.2, charge: 1.2, dur: 1.4, sweep: 0.1 } },
      node0: { hp: 14, r: 3.4, score: 600 },
      node1: { hp: 14, r: 3.4, score: 600 },
    },
  },
  plate: {
    name: 'PLATE BATTERY', model: 'plate', scale: 1.2, bonus: 3500, drops: [], exitZ: 220,
    hull: [[-18, 0, -18, 12], [18, 0, -18, 12], [-18, 0, 18, 12], [18, 0, 18, 12]],
    parts: {
      gun0: { hp: 18, r: 3.8, score: 900, weapon: { w: 'fan', n: 3, spread: 0.14, speed: 44, rate: 3 } },
      gun1: { hp: 18, r: 3.8, score: 900, weapon: { w: 'fan', n: 3, spread: 0.14, speed: 44, rate: 3.3 } },
      gun2: { hp: 18, r: 3.8, score: 900, weapon: { w: 'aimed', n: 2, spread: 0.07, speed: 48, rate: 2.7 } },
    },
  },
};

// ------------------------------------------------------------------------------------------------
// The Gatekeeper (stage 6): a turning ring of six turrets around its core.

const GATEKEEPER = {
  type: 'gatekeeper', name: 'GATEKEEPER', model: 'gatekeeper', bodyR: 10, hullR: 7, hold: { x: 0, y: 3, z: -210 }, enterFrom: -760,
  scale: 1.2, pitch: 0, spin: 0.35, boom: 4, hpScale: 1.6, score: 30000, partScore: 1500, drops: ['pow'],
  parts: Object.fromEntries([...Array.from({ length: 6 }, (_, i) => [`t${i}`, { hp: 26, r: 4.2 }]), ['core', { hp: 220, r: 6, core: true }]]),
  coreVulnerable: (b) => b.phase >= 2,
  move(b, tt) {
    const d = b.def;
    b.pos.set(10 * Math.sin(tt * 0.31), d.hold.y + 4 * Math.sin(tt * 0.47), d.hold.z + 8 * Math.sin(tt * 0.23));
  },
  attack(b, dt) {
    const g = b.game;
    const diff = g.difficulty;
    const core = b.parts.find((p) => p.core);
    if (b.phase === 1 && (b.parts.every((p) => p.core || !p.alive) || b.t > 38)) {
      b.phase = 2;
      g.hud.banner('CORE EXPOSED', 1.6);
      g.audio?.warning();
    }
    b.parts.forEach((p, i) => {
      if (!p.alive || p.core) return;
      p.fireT -= dt * diff.fireRate;
      if (p.fireT > 0) return;
      p.fireT = 2.6 + (i % 3) * 0.4;
      if (i % 2) b.aimed(p.world, 2, 0.07, 46, 0);
      else g.enemies.ring(p.world.x, p.world.y, p.world.z, 5, 34 * diff.bulletSpeed, b.t, 3);
      g.audio?.enemyShot();
    });
    if (b.phase >= 2 && core.alive) {
      b.coreT -= dt * diff.fireRate;
      if (b.coreT <= 0) {
        b.coreT = 0.33;
        b.spiral += 0.33;
        for (let a = 0; a < 3; a++) b.spiralShot(core.world, b.spiral + (a * PI * 2) / 3, 38 * diff.bulletSpeed);
      }
      b.beamT -= dt;
      if (b.beamT <= 0) {
        b.beamT = 3.2;
        b.beam(core.world);
      }
    }
  },
};

// ------------------------------------------------------------------------------------------------
// The Dreadnought (stage 8, the last boss): wing batteries, hangars and a spine cannon; then its core; then, hurt,
// everything at once with the star's flares. The music turns from C minor to C major as it falls.

const DREADNOUGHT = {
  type: 'dreadnought', name: 'DREADNOUGHT', model: 'dreadnought', bodyR: 30, hullR: 14, hold: { x: 0, y: 6, z: -225 }, enterFrom: -900,
  scale: 1.45, pitch: 0.3, boom: 7, hpScale: 4, score: 100000, partScore: 4000, drops: [], final: true, launches: true,
  parts: {
    wingL: { hp: 60, r: 6 }, wingR: { hp: 60, r: 6 },
    hangarL: { hp: 46, r: 5.5 }, hangarR: { hp: 46, r: 5.5 },
    spine: { hp: 50, r: 4.5 },
    core: { hp: 420, r: 7, core: true },
  },
  coreVulnerable: (b) => b.phase >= 2,
  move(b, tt) {
    const d = b.def;
    b.pos.set(16 * Math.sin(tt * 0.25), d.hold.y + 6 * Math.sin(tt * 0.41), d.hold.z + 16 * Math.sin(tt * 0.17));
  },
  attack(b, dt) {
    const g = b.game;
    const diff = g.difficulty;
    const core = b.parts.find((p) => p.core);
    const outer = b.parts.filter((p) => !p.core);
    if (b.phase === 1 && (outer.every((p) => !p.alive) || b.t > 52)) {
      b.phase = 2;
      g.hud.banner('CORE EXPOSED', 1.6);
      g.audio?.warning();
      g.music?.goto('P2');
    }
    if (b.phase === 2 && core.hp < core.max * 0.4) {
      b.phase = 3;
      g.hud.banner('DREADNOUGHT ENRAGED', 1.8, true);
      g.music?.goto('P3');
    }
    for (const p of outer) {
      if (!p.alive) continue;
      p.fireT -= dt * diff.fireRate;
      if (p.fireT > 0) continue;
      if (p.name.startsWith('wing')) {
        p.fireT = 2.7;
        b.fan(p.world, 7, 0.14, 42, 2);
        g.fx.flash(p.world.x, p.world.y, p.world.z, 4, [1, 0.7, 0.45], 0.1);
      } else if (p.name.startsWith('hangar')) {
        p.fireT = 6;
        b.launch(p.world, p.name === 'hangarL' ? b.launchL : b.launchR);
      } else {
        p.fireT = 5;
        const part = p;
        g.beams.fire(b, () => part.world, { charge: 1.0, dur: 1.4, sweep: 0.14 * (b.bayCount++ % 2 ? 1 : -1), alive: () => part.alive && b.active && b.state === 'fight' });
      }
    }
    if (b.phase >= 2 && core.alive) {
      b.coreT -= dt * diff.fireRate;
      const arms = b.phase === 3 ? 3 : 2;
      if (b.coreT <= 0) {
        b.coreT = b.phase === 3 ? 0.36 : 0.4;
        b.spiral += 0.31;
        for (let a = 0; a < arms; a++) b.spiralShot(core.world, b.spiral + (a * PI * 2) / arms, 40 * diff.bulletSpeed);
      }
      b.beamT -= dt;
      if (b.beamT <= 0) {
        b.beamT = b.phase === 3 ? 2.8 : 3.6;
        b.beam(core.world);
      }
      b.flareT = (b.flareT ?? 9) - dt;
      if (b.flareT <= 0) {
        b.flareT = b.phase === 3 ? 7 : 11;
        g.hazards.start({ hazard: 'flare' });
        if (b.phase === 3) g.hazards.start({ hazard: 'crossfire', n: 2, flip: b.bayCount % 2 });
      }
    }
  },
};

// ------------------------------------------------------------------------------------------------
// Music: C minor, relentless: a driving 16th bass, a choir, the motif harmonised and rising (C – G – B♭ – C).

const THEME = {
  name: 'corona',
  tr: -2,
  bpm: 150,
  inst: { lead: 'brass', counter: 'brass', bass: 'saw', pad: 'choir', arp: 'pluck' },
  mix: { lead: 0.9, counter: 0.6, bass: 0.95, pad: 0.85, arp: 0.35, drums: 1 },
  styles: { bass: 'drive16', drums: 'drive', arp: 'up16' },
  sections: {
    intro: { bars: 4, chords: 'Cm Cm Ab Bb', layers: 'bass drums pad', fillEnd: true },
    A: {
      bars: 8,
      chords: 'Cm Ab Bb Cm Fm Ab G G',
      mel: `C5:6 G5:2 F5:4 Eb5:4 | Eb5:6 C5:2 Eb5:4 F5:4 | D5:6 F5:2 Bb5:4 F5:4 | G5:12 r:4 |
            C6:6 G5:2 F5:4 Eb5:4 | Eb5:4 F5:4 G5:4 Ab5:4 | B5:6 D6:2 G5:4 B5:4 | C5:6 G5:2 Bb5:4 C6:4`,
      counter: `Eb4:6 Eb5:2 C5:4 C5:4 | C5:6 Ab4:2 C5:4 C5:4 | Bb4:6 D5:2 F5:4 D5:4 | Eb5:12 r:4 |
                Ab5:6 Eb5:2 C5:4 C5:4 | C5:4 C5:4 Eb5:4 F5:4 | G5:6 B5:2 D5:4 G5:4 | Eb4:6 Eb5:2 G5:4 G5:4`,
      layers: 'lead counter bass pad drums arp',
    },
    B: {
      bars: 8,
      chords: 'Ab Bb Cm Cm Ab Bb G G',
      styles: { drums: 'blast' },
      mel: 'Eb6:8 C6:8 | D6:8 F6:8 | Eb6:6 D6:2 C6:8 | G5:16 | Ab5:6 C6:2 Eb6:8 | F6:6 D6:2 Bb5:8 | B5:4 D6:4 F6:4 B5:4 | G5:16',
      layers: 'lead bass pad drums arp',
      fillEnd: true,
    },
  },
  form: ['intro', 'A', 'B', 'A'],
  loopFrom: 1,
};

const GATE_BOSS = {
  ...THEME,
  name: 'coronaBoss',
  bpm: 156,
  styles: { bass: 'drive16', drums: 'march', arp: 'updown8' },
  form: ['B', 'A'],
  loopFrom: 0,
};

/** The Dreadnought: three sections, one per phase; the last in C major. */
const FINAL = {
  name: 'dreadnought',
  tr: -2,
  bpm: 160,
  inst: { lead: 'brass', counter: 'choir', bass: 'saw', pad: 'choir', arp: 'pluck' },
  mix: { lead: 0.9, counter: 0.7, bass: 1, pad: 0.8, arp: 0.35, drums: 1 },
  styles: { bass: 'drive16', drums: 'march', arp: 'up16' },
  sections: {
    P1: {
      bars: 8,
      chords: 'Cm Cm Ab G Cm Cm Ab G',
      bass: `C2:6 G2:2 F2:4 Eb2:4 | C2:2 C2:2 r:2 C2:2 Eb2:2 D2:2 C2:2 Bb1:2 | Ab1:6 Eb2:2 D2:4 C2:4 | G1:4 G1:2 G1:2 B1:4 D2:4 |
             C2:6 G2:2 F2:4 Eb2:4 | C2:2 C2:2 r:2 C2:2 Eb2:2 D2:2 C2:2 Bb1:2 | Ab1:6 Eb2:2 D2:4 C2:4 | G1:4 F1:4 Eb1:4 D1:4`,
      mel: `G4:2 r:2 G4:2 r:2 C5:4 Bb4:4 | G4:12 r:4 | Ab4:2 r:2 Ab4:2 r:2 Eb5:4 C5:4 | D5:12 r:4 |
            G4:2 r:2 G4:2 r:2 C5:4 Eb5:4 | D5:8 C5:8 | Ab4:2 r:2 C5:2 r:2 Eb5:4 Ab5:4 | G5:12 r:4`,
      layers: 'lead bass pad drums',
    },
    P2: {
      bars: 8,
      chords: 'Fm Fm Cm Cm Db Db G G',
      styles: { drums: 'blast' },
      mel: 'C6:6 G5:2 F5:4 Eb5:4 | F5:8 Ab5:8 | G5:6 Eb5:2 D5:4 C5:4 | G5:12 r:4 | F5:6 Db5:2 Ab5:4 F5:4 | Bb5:8 Ab5:8 | G5:4 B5:4 D6:4 G5:4 | G5:12 r:4',
      counter: 'Ab4:16 | C5:16 | G4:16 | Eb4:16 | Ab4:16 | F4:16 | D4:16 | B3:16',
      layers: 'lead counter bass pad drums arp',
    },
    P3: {
      bars: 8,
      chords: 'C Ab Bb C F Ab G C',
      styles: { drums: 'blast' },
      mel: 'C5:6 G5:2 Bb5:4 C6:4 | C6:8 Eb6:8 | D6:6 F6:2 D6:4 Bb5:4 | C6:16 | A5:6 C6:2 F6:8 | Eb6:8 C6:8 | B5:4 D6:4 G6:4 B5:4 | C6:16',
      counter: 'E4:16 | Eb4:16 | D4:16 | E4:16 | F4:16 | Ab4:16 | G4:16 | G4:16',
      layers: 'lead counter bass pad drums arp',
      fillEnd: true,
    },
  },
  form: ['P1', 'P2', 'P3'],
  loopFrom: 0,
};

// ------------------------------------------------------------------------------------------------

const labels = sectionLabels('start', [
  ['s2', 65, 50], ['s3', 65, 48], ['s4', 65, 46], ['s5', 70, 42], ['s6', 70, 44], ['s7', 60, 26], ['boss', 70, 48], ['dock', 95, 24],
  ['end', 8, 40],
]);
// the step up: on top of the threat level (Game.makeDifficulty, T = 4)
const R = (k, extra = {}) => ({ fire: 1.1 + 0.4 * k, rate: 1.15 + 0.45 * k, speed: 1.1 + 0.05 * k, minAlive: 6, maxCharging: 6 + Math.round(k * 2), drops: 0.5, ...extra });
const fast = { speedMul: 1.15 };
const redFast = { red: true, speedMul: 1.2 };

const location = {
  id: 'corona',
  index: 4,
  name: 'THE CORONA',
  subtitle: 'into the glare of a dying star, to the Dreadnought',
  modelUrl,
  backdrop: (loc, tier, models, game) => new CoronaBackdrop(loc, tier, models, game),
  sun: { azimuth: Math.atan2(STAR_DIR[2], STAR_DIR[0]), elevation: Math.asin(STAR_DIR[1] / Math.hypot(...STAR_DIR)) },
  sunStyle: { halo: [0.6, 0.75, 1], core: [0.9, 0.95, 1], size: 2.6 },
  light: { sun: 0xdde8ff, sunI: 3.2, hemiDay: 0x9ab8ff, hemiNight: 0x3a4a80, ground: 0x302848, hemiI: 1.05 },
  sky: {
    base: [0.02, 0.03, 0.07], clouds: [0.08, 0.12, 0.3], wisps: [0.1, 0.16, 0.3], band: [0.2, 0.26, 0.45],
    knots: [0.3, 0.2, 0.4], density: 1.2, gN: STAR_DIR,
  },
  rim: { color: 0xffc070, strength: 0.98 }, // +30% in plan 4: the glare
  // harder through formations, not bullets (ai/summary.md §7.2): bigger squads, half the waves come round again, less fire
  formations: { squad: 1.4, loop: 0.5 },
  fireScale: [0.9, 0.95],
  bossDefs: { gatekeeper: GATEKEEPER, dreadnought: DREADNOUGHT },
  hulkDefs: HULKS,
  songs: { theme: THEME, boss: GATE_BOSS, final: FINAL },
  intros: {
    wind: 'SOLAR WIND pushes you sideways: fly against it',
    flare: 'SOLAR FLARES sweep the whole corridor. They can\'t be outrun: roll through, or bomb',
    mirror: 'MIRRORS focus the star into beams: shoot the lens and the beam stops',
    plate: 'THE SHELL: its plates carry guns. Knock them out as you pass over',
  },

  path: railPath({
    labels,
    heading: -0.6,
    swing: (d) => [600 * Math.sin(d / 2600) + 220 * Math.sin(d / 950 + 2), 240 * Math.sin(d / 1900)],
    roll: (d) => 0.1 * Math.sin(d / 1200),
  }),

  stages: [
    {
      name: 'HELIOPAUSE',
      ramp: R(0),
      sections: [
        {
          id: 'heliopause', from: 'start', to: 's2', duration: 65, rocks: { kind: 'slag', target: 4 },
          waves: [
            { at: 1.5, f: 'vee', type: 'wasp', n: 5, ...fast },
            { at: 4, f: 'sweep', type: 'dart', n: 6, dy: 6 },
            { at: 4.5, f: 'sweep', type: 'dart', n: 6, mirror: true, dy: -6 },
            { at: 8, f: 'helix', type: 'dart', n: 10, ...fast },
            { at: 12, f: 'overtake', type: 'wasp', n: 4 },
            { at: 12.5, f: 'overtake', type: 'wasp', n: 4, mirror: true },
            { at: 16, f: 'snake', type: 'dart', n: 5, ...redFast },
            { at: 22, f: 'ring', type: 'wasp', n: 8 },
            { at: 25, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles' },
            { at: 27, f: 'wall', type: 'dart', n: 9, ...fast },
            { at: 31, f: 'dive', type: 'wasp', n: 4 },
            { at: 31.5, f: 'dive', type: 'wasp', n: 4, mirror: true, flipY: true },
            { at: 35, f: 'vee', type: 'shade', n: 5 },
            { at: 39, f: 'swarm', type: 'miner', n: 14 },
            { at: 43, f: 'hold', type: 'hammer', n: 1, weapon: 'laser', dx: 12 },
            { at: 45, f: 'helix', type: 'wasp', n: 8 },
            { at: 49, f: 'mines', type: 'mine', n: 8 },
            { at: 52, f: 'sweep', type: 'wasp', n: 5, dy: 8, ...fast },
            { at: 55, f: 'ring', type: 'dart', n: 10, roll: PI },
            { at: 59, f: 'vee', type: 'wasp', n: 5, roll: PI / 2, rot: PI / 2 },
          ],
        },
      ],
    },
    {
      name: 'SOLAR WIND',
      ramp: R(0.15),
      sections: [
        {
          id: 'wind', from: 's2', to: 's3', duration: 65, drift: [11, 0], rocks: { kind: 'slag', target: 5 },
          waves: [
            { at: 1, intro: 'wind' },
            { at: 2, f: 'sweep', type: 'dart', n: 6, mirror: true },
            { at: 5, f: 'vee', type: 'wasp', n: 5, ...fast },
            { at: 9, f: 'helix', type: 'dart', n: 10 },
            { at: 13, f: 'hold', type: 'hammer', n: 1, weapon: 'shells' },
            { at: 15, f: 'snake', type: 'wasp', n: 5, ...redFast },
            { at: 21, f: 'swarm', type: 'miner', n: 14, dx: 10 },
            { at: 25, f: 'overtake', type: 'dart', n: 5 },
            { at: 25.5, f: 'overtake', type: 'dart', n: 5, mirror: true },
            { at: 29, f: 'wall', type: 'dart', n: 9, ...fast },
            { at: 33, f: 'ring', type: 'wasp', n: 8, roll: PI },
            { at: 37, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles', drop: 'bomb' },
            { at: 39, f: 'dive', type: 'shade', n: 5 },
            { at: 43, f: 'mines', type: 'mine', n: 10 },
            { at: 47, f: 'sweep', type: 'wasp', n: 5, dy: -8, ...fast },
            { at: 47.5, f: 'sweep', type: 'wasp', n: 5, mirror: true, dy: 8, ...fast },
            { at: 51, f: 'helix', type: 'shade', n: 6 },
            { at: 55, f: 'vee', type: 'wasp', n: 5, ...fast },
            { at: 59, f: 'swarm', type: 'miner', n: 16, dx: -10 },
          ],
        },
      ],
    },
    {
      name: 'FLARE ZONE',
      ramp: R(0.3),
      sections: [
        {
          id: 'flares', from: 's3', to: 's4', duration: 65, rocks: { kind: 'slag', target: 3 },
          waves: [
            { at: 2, intro: 'flare' },
            { at: 3, hazard: 'flare' },
            { at: 7, f: 'vee', type: 'wasp', n: 5, ...fast },
            { at: 11, f: 'helix', type: 'dart', n: 10 },
            { at: 14, hazard: 'flare' },
            { at: 17, f: 'snake', type: 'dart', n: 5, ...redFast },
            { at: 23, f: 'overtake', type: 'wasp', n: 4 },
            { at: 23.5, f: 'overtake', type: 'wasp', n: 4, mirror: true },
            { at: 26, hazard: 'flare', speed: 170 },
            { at: 29, f: 'hold', type: 'hammer', n: 1, weapon: 'laser' },
            { at: 31, f: 'ring', type: 'dart', n: 10 },
            { at: 35, f: 'sweep', type: 'shade', n: 5, dy: 6 },
            { at: 38, hazard: 'flare' },
            { at: 41, f: 'wall', type: 'dart', n: 9, ...fast },
            { at: 45, f: 'dive', type: 'wasp', n: 4 },
            { at: 45.5, f: 'dive', type: 'wasp', n: 4, mirror: true, flipY: true },
            { at: 49, hazard: 'flare', speed: 180 },
            { at: 52, f: 'swarm', type: 'miner', n: 14 },
            { at: 56, f: 'vee', type: 'shade', n: 5 },
            { at: 60, hazard: 'flare', speed: 190 },
          ],
        },
      ],
    },
    {
      name: 'MIRROR ARRAY',
      ramp: R(0.45, { noShield: true }),
      sections: [
        {
          id: 'mirrors', from: 's4', to: 's5', duration: 70, rocks: { kind: 'metal', target: 3 },
          waves: [
            { at: 2, intro: 'mirror' },
            { at: 2, hulk: 'mirror', x: -80, y: 20, z: -760, speed: 24 },
            { at: 6, f: 'sweep', type: 'dart', n: 6, ...fast },
            { at: 9, hulk: 'mirror', x: 84, y: -16, z: -760, speed: 24 },
            { at: 12, f: 'helix', type: 'wasp', n: 8 },
            { at: 16, hulk: 'mirror', x: -86, y: -18, z: -760, speed: 26 },
            { at: 18, f: 'snake', type: 'wasp', n: 5, ...redFast },
            { at: 24, hulk: 'mirror', x: 80, y: 22, z: -760, speed: 26 },
            { at: 26, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles' },
            { at: 29, f: 'vee', type: 'shade', n: 5 },
            { at: 32, hazard: 'flare' },
            { at: 34, hulk: 'mirror', x: -84, y: 4, z: -760, speed: 26 },
            { at: 36, f: 'wall', type: 'dart', n: 9, ...fast },
            { at: 40, hulk: 'mirror', x: 86, y: 0, z: -760, speed: 26 },
            { at: 42, f: 'overtake', type: 'wasp', n: 5 },
            { at: 46, f: 'ring', type: 'wasp', n: 8 },
            { at: 50, hulk: 'mirror', x: -82, y: -14, z: -760, speed: 28 },
            { at: 52, f: 'swarm', type: 'miner', n: 14 },
            { at: 56, hazard: 'flare', speed: 180 },
            { at: 58, f: 'vee', type: 'wasp', n: 5, ...fast },
            { at: 62, f: 'sweep', type: 'shade', n: 5 },
          ],
        },
      ],
    },
    {
      name: 'SHELL PLATES',
      ramp: R(0.6, { noShield: true }),
      sections: [
        {
          id: 'plates', from: 's5', to: 's6', duration: 70, rocks: { kind: 'metal', target: 3 },
          waves: [
            { at: 2, intro: 'plate' },
            { at: 2, hulk: 'plate', x: -26, y: -54 },
            { at: 6, f: 'vee', type: 'wasp', n: 5, ...fast },
            { at: 9, hulk: 'plate', x: 30, y: -56 },
            { at: 12, f: 'helix', type: 'dart', n: 10 },
            { at: 16, hulk: 'plate', x: -10, y: -54 },
            { at: 18, f: 'snake', type: 'dart', n: 5, ...redFast },
            { at: 24, hulk: 'plate', x: 34, y: -58 },
            { at: 26, f: 'overtake', type: 'wasp', n: 5 },
            { at: 26.5, f: 'overtake', type: 'wasp', n: 5, mirror: true },
            { at: 30, hazard: 'flare' },
            { at: 32, hulk: 'plate', x: -30, y: -55 },
            { at: 34, f: 'ring', type: 'dart', n: 10, roll: PI },
            { at: 38, hulk: 'mirror', x: 84, y: 10, z: -760, speed: 26 },
            { at: 40, f: 'hold', type: 'hammer', n: 1, weapon: 'laser' },
            { at: 43, hulk: 'plate', x: 12, y: -54 },
            { at: 45, f: 'swarm', type: 'miner', n: 16 },
            { at: 49, f: 'dive', type: 'shade', n: 5 },
            { at: 52, hulk: 'plate', x: -24, y: -56 },
            { at: 54, f: 'wall', type: 'dart', n: 9, ...fast },
            { at: 58, hazard: 'flare', speed: 190 },
            { at: 60, f: 'vee', type: 'wasp', n: 5, ...fast },
            { at: 63, f: 'sweep', type: 'dart', n: 6, dy: 6, ...fast },
          ],
        },
      ],
    },
    {
      name: 'GATEKEEPER',
      ramp: R(0.6, { noShield: true }),
      sections: [
        {
          id: 'gatekeeper', from: 's6', to: 's7', duration: 70, boss: 'gatekeeper', bossTime: 52, rocks: { kind: 'slag', target: 2 },
          waves: [
            { at: 2.4, msg: 'WARNING\nGATEKEEPER', warn: true, msgT: 2.4 },
            { at: 14, f: 'snake', type: 'wasp', n: 5, ...redFast, dy: 12 },
            { at: 24, f: 'vee', type: 'shade', n: 5, dy: 12 },
            { at: 34, hazard: 'flare' },
            { at: 40, f: 'sweep', type: 'wasp', n: 5, dy: -12, ...fast },
          ],
        },
      ],
    },
    {
      name: 'THE CORE ROAD',
      ramp: R(0.85, { noShield: true }),
      sections: [
        {
          id: 'road', from: 's7', to: 'boss', duration: 60, drift: [-8, 0], rocks: { kind: 'slag', target: 5 },
          waves: [
            { at: 1.5, f: 'vee', type: 'wasp', n: 5, ...fast },
            { at: 2, hulk: 'plate', x: 26, y: -54 },
            { at: 5, f: 'swarm', type: 'miner', n: 16 },
            { at: 8, hulk: 'mirror', x: -84, y: 12, z: -760, speed: 26 },
            { at: 9, f: 'helix', type: 'shade', n: 8 },
            { at: 12, hazard: 'flare', speed: 190 },
            { at: 14, f: 'snake', type: 'wasp', n: 5, ...redFast },
            { at: 19, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles', dx: -12 },
            { at: 19.5, f: 'hold', type: 'hammer', n: 1, weapon: 'laser', dx: 12, mirror: true },
            { at: 22, hazard: 'crossfire', n: 2 },
            { at: 24, f: 'wall', type: 'dart', n: 9, ...fast },
            { at: 27, hazard: 'strike', n: 3 },
            { at: 28, f: 'overtake', type: 'wasp', n: 5 },
            { at: 28.5, f: 'overtake', type: 'wasp', n: 5, mirror: true },
            { at: 32, hulk: 'plate', x: -30, y: -56 },
            { at: 33, f: 'ring', type: 'wasp', n: 10, roll: PI },
            { at: 36, hazard: 'flare', speed: 200 },
            { at: 38, f: 'mines', type: 'mine', n: 10 },
            { at: 41, f: 'dive', type: 'shade', n: 5 },
            { at: 41.5, f: 'dive', type: 'wasp', n: 5, mirror: true, flipY: true },
            { at: 45, hazard: 'crossfire', n: 3, flip: true },
            { at: 47, f: 'swarm', type: 'miner', n: 18 },
            { at: 50, f: 'vee', type: 'wasp', n: 5, roll: PI / 2, rot: PI / 2, ...fast },
            { at: 54, f: 'sweep', type: 'shade', n: 5, dy: 8 },
          ],
        },
      ],
    },
    {
      name: 'DREADNOUGHT',
      ramp: R(1, { noShield: true, rate: 1.3 }),
      sections: [
        {
          id: 'dreadnought', from: 'boss', to: 'dock', duration: 95, boss: 'dreadnought', bossTime: 86, song: 'final', rocks: { kind: 'slag', target: 2 },
          waves: [
            { at: 2.4, msg: 'WARNING\nDREADNOUGHT', warn: true, msgT: 2.8 },
            { at: 16, f: 'snake', type: 'wasp', n: 5, ...redFast, dy: 12 },
            { at: 30, f: 'vee', type: 'shade', n: 5, dy: 12 },
            { at: 44, f: 'sweep', type: 'wasp', n: 5, dy: -12, ...fast },
            { at: 58, f: 'snake', type: 'dart', n: 5, ...redFast, mirror: true, dy: -10 },
            { at: 72, f: 'dive', type: 'shade', n: 5 },
          ],
        },
        { id: 'corona-dock', from: 'dock', to: 'end', duration: 8, dock: true, waves: [] },
      ],
    },
  ],

  scenery: {
    carriers: [
      { at: 'start', ds: 170, offset: [-78, -44, 0] },
      { at: 'end', ds: 110, offset: [0, -4, 0], dock: true },
    ],
    fields: [
      { from: 'start', to: 's3', kind: 'slag', count: 220, minD: 50, maxD: 340, scale: [2, 18], detail: 1, seed: 71 },
      { from: 's3', to: 's5', kind: 'slag', count: 160, minD: 60, maxD: 320, scale: [2, 16], detail: 1, seed: 72 },
      { from: 's5', to: 'end', kind: 'metal', count: 180, minD: 40, maxD: 280, scale: [1.5, 10], detail: 0, seed: 73 },
    ],
  },
  buildScenery,
};

location.sections = location.stages.flatMap((st, i) => st.sections.map((s) => Object.assign(s, { stage: i })));

export default location;
