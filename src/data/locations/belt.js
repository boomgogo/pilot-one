// Location 2: THE BELT (ai/summary.md §4.2). An asteroid belt around an orange dwarf, with a mining colony: ore
// haulers to strip, swarms of mining drones, mass drivers lobbing boulders, a refinery's guns, and the Excavator.
// Warm side light from the star (never ahead: enemies stay lit from the front); no planet shadow.
import { BoxGeometry, CylinderGeometry, IcosahedronGeometry } from 'three';
import modelUrl from '../../assets/loc2.glb?url';
import { FarPlanet, SkyBand } from '../../render/backdrop-kit.js';
import { merged, piece } from '../../render/models.js';
import { railPath, scatter, sectionLabels } from './kit.js';

const PI = Math.PI;

// ------------------------------------------------------------------------------------------------
// Backdrop: the star (the shared sun billboard, bigger and orange), a banded giant and a moon, the belt's far side
// as a band of dust across the sky.

class BeltBackdrop {
  constructor(loc, tier, models, game) {
    this.game = game;
    const segs = Math.max(32, tier.planetSegs >> 1);
    this.giant = new FarPlanet({ radius: 9000, position: [-36000, 7000, -52000], colors: [0xb07a48, 0x6a3c24, 0xe8c898], style: 'bands', haze: 0xffa060, segs });
    this.moon = new FarPlanet({ radius: 1700, position: [-21000, 2600, -36000], colors: [0x5a4a40, 0x9a8a78, 0x302418], style: 'rock', haze: 0x806040, segs: 32 });
    this.band = new SkyBand({ count: Math.round(tier.stars * 1.6), normal: [0.05, 1, 0.12], width: 0.07, colors: [0xffc890, 0xd08a50, 0xfff0d8], size: 1.5, seed: 21 });
    this.bgObjects = [this.giant.mesh, this.moon.mesh, this.band.points];
    this.objects = [];
  }
  update(time, camPos, sunDir) {
    this.giant.update(time, camPos, sunDir);
    this.moon.update(time, camPos, sunDir);
    this.band.update(camPos, this.game.r.gl.getPixelRatio());
  }
  lightFactor() {
    return 1;
  }
}

// ------------------------------------------------------------------------------------------------
// Set dressing: mining rigs on big rocks, refinery towers, mass-driver frames.

const glow = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const AMBER = glow(0xffa030);
const RED = glow(0xff3020);

function rig(rng) {
  const h = 30 + rng() * 30;
  const pieces = [
    piece(new IcosahedronGeometry(22, 1), 0x6e4a32, 0, { s: [1.3, 0.9, 1.1] }),
    piece(new BoxGeometry(5, h, 5), 0x8a8a90, 0, { p: [0, 18 + h / 2, 0] }),
    piece(new BoxGeometry(16, 3, 16), 0xb08a20, 0, { p: [0, 18 + h, 0] }),
    piece(new BoxGeometry(2, 2, 2), 0x000000, 0xffa030, { p: [7, 20 + h, 7] }),
    piece(new CylinderGeometry(1.2, 1.2, 40, 6), 0x505058, 0, { p: [10, 30, 0], r: [0, 0, 0.5] }),
  ];
  return { geo: merged(pieces), radius: 40, lights: [[0, 22 + h, 0, RED, 4, true], [7, 20 + h, 7, AMBER, 3, false], [-7, 20 + h, -7, AMBER, 3, false]] };
}

function refineryTower(rng) {
  const pieces = [
    piece(new CylinderGeometry(9, 9, 50, 10), 0xb08a20, 0, { p: [0, 0, 0] }),
    piece(new CylinderGeometry(9.4, 9.4, 3, 10), 0x4a2a14, 0, { p: [0, 12, 0] }),
    piece(new BoxGeometry(40, 4, 4), 0x707078, 0, { p: [20, 18, 0] }),
    piece(new CylinderGeometry(3, 3, 60, 8), 0x505058, 0, { p: [38, 10, 0] }),
    piece(new CylinderGeometry(3.4, 3.4, 2, 8), 0x000000, 0xff7020, { p: [38, 41, 0] }),
  ];
  if (rng() < 0.5) pieces.push(piece(new IcosahedronGeometry(18, 1), 0x5a3c2a, 0, { p: [-10, -30, 0], s: [1.4, 0.8, 1.2] }));
  return { geo: merged(pieces), radius: 45, lights: [[38, 44, 0, glow(0xff8030), 7, false], [0, 26, 0, RED, 3, true]] };
}

function driverFrame() {
  const pieces = [piece(new CylinderGeometry(2.5, 2.5, 160, 8), 0x606068, 0, { r: [PI / 2, 0, 0] })];
  for (let k = -3; k <= 3; k++) pieces.push(piece(new CylinderGeometry(7, 7, 3, 10), 0x202024, 0xffc040, { p: [0, 0, k * 22], r: [PI / 2, 0, 0] }));
  return { geo: merged(pieces), radius: 80, lights: [[0, 0, 80, glow(0xffd060), 8, false]] };
}

function buildScenery(ctx) {
  const objects = [
    scatter(ctx, { from: 'start', to: 'boss', count: 14, minD: 260, maxD: 900, scale: [0.8, 1.6], seed: 31, make: rig }),
    scatter(ctx, { from: 's4', to: 's5', count: 5, minD: 220, maxD: 500, scale: [1, 1.4], seed: 32, make: driverFrame }),
    scatter(ctx, { from: 's5', to: 'dock', count: 9, minD: 240, maxD: 700, scale: [1, 1.8], seed: 33, make: refineryTower, upright: true, flat: 0.35 }),
  ].filter(Boolean);
  return { objects };
}

// ------------------------------------------------------------------------------------------------
// Hulks (src/game/hulks.js). Models: assets-src/blender/build_ships.py (loc2.glb).

const HULKS = {
  hauler: {
    name: 'HAULER', model: 'hauler', scale: 2, bonus: 4000, drops: ['bomb'], exitZ: 260,
    hull: [[0, 0, -30, 4.5], [0, 0, -10, 3.5], [0, 0, 10, 3.5], [0, 0, 30, 5]],
    parts: {
      pod0: { hp: 9, r: 4.4, score: 500 }, pod1: { hp: 9, r: 4.4, score: 500 },
      pod2: { hp: 9, r: 4.4, score: 500 }, pod3: { hp: 9, r: 4.4, score: 500 },
    },
  },
  driver: {
    name: 'MASS DRIVER', model: 'driver', scale: 1.4, bonus: 3000, drops: ['shield'], exitZ: 200,
    hull: [[0, -4, 4, 13]],
    parts: {
      gunL: { hp: 22, r: 4, score: 1000, weapon: { w: 'boulder', speed: 30, rate: 3.6, size: 3.4 } },
      gunR: { hp: 22, r: 4, score: 1000, weapon: { w: 'boulder', speed: 30, rate: 3.6, size: 3.4 } },
    },
  },
  refinery: {
    name: 'REFINERY', model: 'refinery', scale: 1.3, bonus: 6000, drops: ['bomb'], exitZ: 260,
    hull: [[0, 0, -50, 7], [0, 0, -25, 7], [0, 0, 0, 7], [0, 0, 25, 7], [0, 0, 50, 7], [-8, 6, -30, 10]],
    parts: {
      tank0: { hp: 26, r: 6.5, score: 800 }, tank1: { hp: 26, r: 6.5, score: 800 },
      turret0: { hp: 14, r: 3.2, score: 700, weapon: { w: 'aimed', n: 2, spread: 0.08, speed: 44, rate: 2.9 } },
      turret1: { hp: 14, r: 3.2, score: 700, weapon: { w: 'aimed', n: 2, spread: 0.08, speed: 44, rate: 3.1 } },
      turret2: { hp: 14, r: 3.2, score: 700, weapon: { w: 'aimed', n: 2, spread: 0.08, speed: 44, rate: 2.9 } },
      turret3: { hp: 14, r: 3.2, score: 700, weapon: { w: 'aimed', n: 2, spread: 0.08, speed: 44, rate: 3.1 } },
    },
  },
};

// ------------------------------------------------------------------------------------------------
// The Excavator: drill, two rock launchers, two cutting lasers, then the core (src/game/bosses.js hooks).

function boulder(b, from, speed) {
  const g = b.game;
  const p = g.player.pos;
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const dz = p.z - from.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  const sp = speed * g.difficulty.bulletSpeed;
  g.rocks.spawn(from.x, from.y, from.z, (dx / d) * sp, (dy / d) * sp, (dz / d) * sp - g.stage.speed, 3.3, 1, 4);
  g.fx.flash(from.x, from.y, from.z, 4, [1, 0.7, 0.4], 0.12);
}

const EXCAVATOR = {
  type: 'excavator', name: 'EXCAVATOR', model: 'excavator', bodyR: 15, hullR: 11, hold: { x: 0, y: 2, z: -165 }, enterFrom: -720,
  scale: 1.5, pitch: 0.35, boom: 4, hpScale: 2.5, score: 20000, partScore: 1500, drops: ['pow', 'shield'],
  parts: {
    drill: { hp: 60, r: 7 },
    launcherL: { hp: 36, r: 4.5 }, launcherR: { hp: 36, r: 4.5 },
    laserL: { hp: 30, r: 3.6 }, laserR: { hp: 30, r: 3.6 },
    core: { hp: 200, r: 4.2, core: true },
  },
  coreVulnerable: (b) => b.parts.every((p) => p.core || p.name === 'drill' || !p.alive),
  move(b, tt, dt) {
    const d = b.def;
    b.pos.set(15 * Math.sin(tt * 0.38), d.hold.y + 4 * Math.sin(tt * 0.55), d.hold.z + 12 * Math.sin(tt * 0.27));
    const drill = b.parts.find((p) => p.name === 'drill');
    if (drill?.alive) drill.mesh.rotation.z += dt * (b.phase >= 2 ? 9 : 4);
  },
  attack(b, dt) {
    const g = b.game;
    const diff = g.difficulty;
    if (b.phase === 1 && b.coreVulnerable()) {
      b.phase = 2;
      g.hud.banner('CORE EXPOSED', 1.6);
      g.audio?.warning();
    }
    for (const p of b.parts) {
      if (!p.alive || p.core) continue;
      p.fireT -= dt * diff.fireRate;
      if (p.fireT > 0) continue;
      if (p.name.startsWith('launcher')) {
        p.fireT = 3.6;
        boulder(b, p.world, 28);
      } else if (p.name.startsWith('laser')) {
        p.fireT = 6.5;
        const part = p;
        g.beams.fire(b, () => part.world, { charge: 1.1, dur: 1.2, sweep: p.name.endsWith('L') ? 0.16 : -0.16, alive: () => part.alive && b.active && b.state === 'fight' });
      } else {
        // the drill throws grit: a ring of slow orbs
        p.fireT = 3.2;
        g.enemies.ring(p.world.x, p.world.y, p.world.z, 8, 30 * diff.bulletSpeed, b.t * 0.7, 6);
        g.audio?.enemyShot();
      }
    }
    const core = b.parts.find((p) => p.core);
    if (b.phase >= 2 && core.alive) {
      b.coreT -= dt * diff.fireRate;
      if (b.coreT <= 0) {
        b.coreT = 0.42;
        b.spiral += 0.37;
        b.spiralShot(core.world, b.spiral, 36 * diff.bulletSpeed);
        if (++b.bayCount % 9 === 0) boulder(b, core.world, 30);
      }
    }
  },
};

// ------------------------------------------------------------------------------------------------
// Music (src/audio/music.js): E minor, industrial. The fleet motif E – B – A – G lives in the bass.

const THEME = {
  name: 'belt',
  tr: 2,
  bpm: 140,
  inst: { lead: 'bell', counter: 'pulse', bass: 'saw', pad: 'pad', arp: 'pluck' },
  mix: { lead: 0.9, counter: 0.85, bass: 1, pad: 0.55, arp: 0.35, drums: 0.95 },
  styles: { drums: 'industrial', arp: 'broken' },
  sections: {
    intro: { bars: 4, chords: 'Em Em Em Em', layers: 'bass drums', styles: { bass: 'synco' }, fillEnd: true },
    A: {
      bars: 8,
      chords: 'Em Em C D Em Em Am B',
      bass: `E2:3 E2:3 B2:2 A2:4 G2:4 | E2:2 E2:1 E2:1 r:2 E3:2 D3:2 B2:2 G2:2 A2:2 | C2:3 C2:3 G2:2 C3:4 G2:4 | D2:3 D2:3 A2:2 D3:4 F#2:4 |
             E2:3 E2:3 B2:2 A2:4 G2:4 | E2:2 E2:1 E2:1 r:2 E3:2 D3:2 B2:2 G2:2 A2:2 | A1:3 A1:3 E2:2 A2:4 C3:4 | B1:3 B1:3 F#2:2 B2:4 D#3:4`,
      mel: `r:8 E5:2 r:2 G5:2 r:2 | B5:4 A5:4 G5:4 r:4 | r:8 E5:2 r:2 G5:2 r:2 | A5:4 F#5:4 D5:4 r:4 |
            r:8 E5:2 r:2 G5:2 r:2 | B5:4 A5:4 G5:4 E6:4 | C6:6 B5:2 A5:4 E5:4 | D#5:8 F#5:4 B5:4`,
      layers: 'lead bass pad drums arp',
    },
    B: {
      bars: 8,
      chords: 'C D Em Em C D B B',
      styles: { bass: 'synco' },
      mel: `E5:6 G5:2 C6:8 | D6:6 C6:2 A5:8 | B5:4 G5:4 E5:4 G5:4 | F#5:8 E5:8 |
            E5:6 G5:2 C6:4 E6:4 | F#6:6 E6:2 D6:8 | D#6:4 B5:4 F#5:4 B5:4 | B5:16`,
      counter: 'G4:16 | A4:16 | G4:16 | B4:16 | G4:16 | A4:16 | F#4:16 | D#4:16',
      layers: 'counter bass pad drums arp lead',
      fillEnd: true,
    },
  },
  form: ['intro', 'A', 'B', 'A'],
  loopFrom: 1,
};

const BOSS = {
  name: 'beltBoss',
  tr: 2,
  bpm: 148,
  inst: { lead: 'brass', counter: 'bell', bass: 'saw', pad: 'pad', arp: 'pluck' },
  mix: { lead: 0.85, bass: 1, pad: 0.6, arp: 0.4, drums: 1, counter: 0.6 },
  styles: { drums: 'industrial' },
  sections: {
    A: {
      bars: 8,
      chords: 'Em Em C B Em Em C B',
      bass: `E2:2 E2:2 E2:2 B2:2 A2:2 A2:2 G2:2 G2:2 | E2:2 E2:2 E2:2 B2:2 A2:2 A2:2 G2:2 G2:2 |
             C2:2 C2:2 C2:2 G2:2 F#2:2 F#2:2 E2:2 E2:2 | B1:2 B1:2 B1:2 F#2:2 B2:2 A2:2 F#2:2 D#2:2 |
             E2:2 E2:2 E2:2 B2:2 A2:2 A2:2 G2:2 G2:2 | E2:2 E2:2 E2:2 B2:2 A2:2 A2:2 G2:2 G2:2 |
             C2:2 C2:2 C2:2 G2:2 F#2:2 F#2:2 E2:2 E2:2 | B1:2 B1:2 B1:2 F#2:2 B2:2 A2:2 F#2:2 D#2:2`,
      mel: `E5:2 r:2 E5:2 r:2 B5:4 A5:4 | G5:12 r:4 | G5:2 r:2 G5:2 r:2 E6:4 D6:4 | D#6:12 r:4 |
            E5:2 r:2 E5:2 r:2 B5:4 A5:4 | G5:12 r:4 | G5:2 r:2 G5:2 r:2 E6:4 D6:4 | F#5:4 A5:4 B5:8`,
      layers: 'lead bass pad drums',
    },
    B: {
      bars: 8,
      chords: 'Am Am Em Em C D B B',
      styles: { bass: 'drive16', drums: 'blast', arp: 'up16' },
      mel: 'A5:8 C6:8 | B5:8 A5:8 | G5:8 B5:8 | E6:16 | E6:8 D6:8 | F#6:8 A6:8 | F#6:8 D#6:8 | B5:16',
      counter: 'E5:4 r:12 | r:16 | B4:4 r:12 | r:16 | G5:4 r:12 | A5:4 r:12 | F#5:4 r:12 | D#5:4 r:12',
      layers: 'lead counter bass pad drums arp',
      fillEnd: true,
    },
  },
  form: ['A', 'B'],
};

// ------------------------------------------------------------------------------------------------
// The route: one long flight down the belt, heading away from the star's side.

const labels = sectionLabels('start', [
  ['s2', 65, 48], ['s3', 70, 48], ['s4', 65, 52], ['s5', 70, 44], ['boss', 72, 42], ['dock', 72, 26], ['end', 8, 40],
]);

const location = {
  id: 'belt',
  index: 1,
  name: 'THE BELT',
  subtitle: 'an orange dwarf, a billion rocks, and the colony that mines them',
  modelUrl,
  backdrop: (loc, tier, models, game) => new BeltBackdrop(loc, tier, models, game),
  sun: { azimuth: 0.27, elevation: 0.36 },
  sunStyle: { halo: [1, 0.55, 0.25], core: [1, 0.78, 0.5], size: 1.9 },
  light: { sun: 0xffc890, sunI: 2.9, hemiDay: 0xd8a878, hemiNight: 0x604030, ground: 0x402418, hemiI: 0.85 },
  sky: {
    base: [0.02, 0.012, 0.01], clouds: [0.16, 0.08, 0.04], wisps: [0.08, 0.05, 0.02], band: [0.3, 0.17, 0.08],
    knots: [0.3, 0.12, 0.03], density: 0.9, gN: [0.05, 1, 0.12],
  },
  bossDefs: { excavator: EXCAVATOR },
  hulkDefs: HULKS,
  formations: { loop: 0.34 }, // a third of the waves come round for a second pass (ai/summary.md §7.1)
  songs: { theme: THEME, boss: BOSS },
  intros: {
    hauler: 'ORE HAULER: it doesn\'t shoot. Break its cargo pods for points and a bomb',
    swarm: 'MINING DRONES ram you: shoot the swarm down, or slip through its gaps',
    driver: 'MASS DRIVER: it lobs boulders. Shoot them (they split) or move out of the red ring',
    refinery: 'REFINERY GUNS: knock them out as the refinery goes by',
  },

  path: railPath({
    labels,
    heading: 0,
    swing: (d) => [700 * Math.sin(d / 2900) + 260 * Math.sin(d / 1150 + 1), 180 * Math.sin(d / 2100)],
    roll: (d) => 0.09 * Math.sin(d / 1500),
  }),

  // ramp (gas-giant.js): fire share, volley rate, density floor, most charging at once
  stages: [
    {
      name: 'OUTER BELT',
      ramp: { fire: 0.85, rate: 0.88, minAlive: 3, maxCharging: 4 },
      sections: [
        {
          id: 'outer', from: 'start', to: 's2', duration: 65, rocks: { kind: 'ore', target: 4 },
          waves: [
            { at: 1.5, f: 'vee', type: 'dart', n: 5 },
            { at: 5, f: 'sweep', type: 'dart', n: 5, dy: 6 },
            { at: 9, f: 'helix', type: 'dart', n: 8 },
            { at: 13, f: 'sweep', type: 'wasp', n: 4, mirror: true, dy: -6 },
            { at: 17, f: 'overtake', type: 'dart', n: 4 },
            { at: 21, f: 'snake', type: 'dart', n: 5, red: true },
            { at: 28, f: 'hold', type: 'hammer', n: 1, drop: 'bomb' },
            { at: 30, f: 'vee', type: 'wasp', n: 5 },
            { at: 34, f: 'wall', type: 'dart', n: 9 },
            { at: 38, intro: 'swarm' },
            { at: 38, f: 'swarm', type: 'miner', n: 8 },
            { at: 42, f: 'dive', type: 'wasp', n: 4 },
            { at: 45, f: 'sweep', type: 'dart', n: 5, dy: 8 },
            { at: 45.5, f: 'sweep', type: 'dart', n: 5, mirror: true, dy: -8 },
            { at: 50, f: 'ring', type: 'dart', n: 8 },
            { at: 54, f: 'helix', type: 'wasp', n: 6 },
            { at: 58, f: 'vee', type: 'dart', n: 5, dy: 6 },
          ],
        },
      ],
    },
    {
      name: 'ORE CONVOY',
      ramp: { fire: 0.85, rate: 0.9, minAlive: 4, maxCharging: 4 },
      sections: [
        {
          id: 'convoy', from: 's2', to: 's3', duration: 70, rocks: { kind: 'rock', target: 3 },
          waves: [
            { at: 1.5, f: 'sweep', type: 'dart', n: 5 },
            { at: 3, intro: 'hauler' },
            { at: 3, hulk: 'hauler', x: 88, y: -8, speed: 26, yaw: 0.5 },
            { at: 6, f: 'vee', type: 'wasp', n: 5 },
            { at: 12, f: 'helix', type: 'dart', n: 8 },
            { at: 16, f: 'overtake', type: 'wasp', n: 4 },
            { at: 16, hulk: 'hauler', x: -88, y: 6, speed: 26, yaw: -0.5 },
            { at: 24, f: 'snake', type: 'dart', n: 5, red: true, dy: 8 },
            { at: 31, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles', drop: 'shield' },
            { at: 33, f: 'sweep', type: 'dart', n: 5, dy: -6 },
            { at: 37, f: 'swarm', type: 'miner', n: 10 },
            { at: 34, hulk: 'hauler', x: 88, y: 10, speed: 28, yaw: 0.5, drop: 'pow' },
            { at: 44, f: 'dive', type: 'dart', n: 4 },
            { at: 48, f: 'vee', type: 'wasp', n: 5, roll: PI },
            { at: 48, hulk: 'hauler', x: -88, y: -10, speed: 30, yaw: -0.5 },
            { at: 54, f: 'ring', type: 'dart', n: 8 },
            { at: 58, f: 'wall', type: 'dart', n: 9 },
            { at: 62, f: 'sweep', type: 'wasp', n: 4, dy: 6 },
          ],
        },
      ],
    },
    {
      name: 'THE SWARM',
      ramp: { fire: 0.9, rate: 0.95, minAlive: 4, maxCharging: 4 },
      sections: [
        {
          id: 'swarm', from: 's3', to: 's4', duration: 65, rocks: { kind: 'ore', target: 3 },
          waves: [
            { at: 1.5, f: 'swarm', type: 'miner', n: 10 },
            { at: 5, f: 'vee', type: 'dart', n: 5 },
            { at: 8, f: 'swarm', type: 'miner', n: 12, mirror: true },
            { at: 12, f: 'helix', type: 'wasp', n: 6 },
            { at: 16, f: 'swarm', type: 'miner', n: 12, dy: 6 },
            { at: 20, f: 'hold', type: 'hammer', n: 1, weapon: 'shells', drop: 'bomb' },
            { at: 22, f: 'swarm', type: 'miner', n: 10, dx: 10 },
            { at: 26, f: 'snake', type: 'wasp', n: 5, red: true },
            { at: 33, f: 'swarm', type: 'miner', n: 14 },
            { at: 37, f: 'overtake', type: 'dart', n: 4 },
            { at: 37.5, f: 'overtake', type: 'dart', n: 4, mirror: true },
            { at: 41, f: 'swarm', type: 'miner', n: 12, flipY: true },
            { at: 45, f: 'ring', type: 'dart', n: 8, roll: PI / 2, rot: PI / 2 },
            { at: 49, f: 'swarm', type: 'miner', n: 14 },
            { at: 53, f: 'dive', type: 'wasp', n: 4 },
            { at: 56, f: 'swarm', type: 'miner', n: 12, dx: -8 },
            { at: 60, f: 'vee', type: 'dart', n: 5 },
          ],
        },
      ],
    },
    {
      name: 'CRUSHER FIELD',
      ramp: { fire: 0.95, rate: 1, minAlive: 4, maxCharging: 5 },
      sections: [
        {
          id: 'crusher', from: 's4', to: 's5', duration: 70, rocks: { kind: 'ore', target: 6 },
          waves: [
            { at: 1.5, f: 'vee', type: 'dart', n: 5 },
            { at: 3, intro: 'driver' },
            { at: 3, hulk: 'driver', x: 70, y: -30, z: -700, speed: 18 },
            { at: 8, f: 'sweep', type: 'wasp', n: 4 },
            { at: 12, hulk: 'driver', x: -72, y: -26, z: -700, speed: 18 },
            { at: 14, f: 'helix', type: 'dart', n: 8 },
            { at: 18, f: 'swarm', type: 'miner', n: 10 },
            { at: 22, f: 'snake', type: 'dart', n: 5, red: true, mirror: true },
            { at: 28, f: 'hold', type: 'hammer', n: 1, weapon: 'shells', drop: 'pow' },
            { at: 30, hulk: 'driver', x: 74, y: 22, z: -700, speed: 18 },
            { at: 33, f: 'vee', type: 'wasp', n: 5 },
            { at: 37, f: 'wall', type: 'dart', n: 9 },
            { at: 41, hulk: 'driver', x: -70, y: 18, z: -700, speed: 18 },
            { at: 44, f: 'overtake', type: 'wasp', n: 4 },
            { at: 48, f: 'swarm', type: 'miner', n: 12 },
            { at: 52, f: 'mines', type: 'mine', n: 8 },
            { at: 56, f: 'dive', type: 'dart', n: 4 },
            { at: 60, f: 'sweep', type: 'dart', n: 5, dy: 6 },
            { at: 60.5, f: 'sweep', type: 'dart', n: 5, mirror: true, dy: -6 },
          ],
        },
      ],
    },
    {
      name: 'REFINERY',
      ramp: { fire: 1, rate: 1.05, minAlive: 4, maxCharging: 5 },
      sections: [
        {
          id: 'refinery', from: 's5', to: 'boss', duration: 72, rocks: { kind: 'metal', target: 3 },
          waves: [
            { at: 1.5, f: 'vee', type: 'wasp', n: 5 },
            { at: 3, intro: 'refinery' },
            { at: 3, hulk: 'refinery', x: -92, y: -10, z: -760, speed: 20, yaw: PI },
            { at: 8, f: 'sweep', type: 'dart', n: 5 },
            { at: 12, f: 'helix', type: 'dart', n: 8 },
            { at: 16, f: 'hold', type: 'hammer', n: 1, weapon: 'laser' },
            { at: 20, hulk: 'refinery', x: 94, y: 8, z: -760, speed: 20, drop: 'pow' },
            { at: 24, f: 'swarm', type: 'miner', n: 12 },
            { at: 28, f: 'snake', type: 'wasp', n: 5, red: true },
            { at: 34, f: 'vee', type: 'dart', n: 5, roll: PI },
            { at: 38, hulk: 'refinery', x: -92, y: 12, z: -760, speed: 22, yaw: PI },
            { at: 42, f: 'mines', type: 'mine', n: 6 },
            { at: 46, f: 'overtake', type: 'wasp', n: 4, mirror: true },
            { at: 50, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles', drop: 'shield' },
            { at: 54, f: 'ring', type: 'wasp', n: 6 },
            { at: 58, f: 'wall', type: 'dart', n: 9 },
            { at: 62, f: 'swarm', type: 'miner', n: 14 },
          ],
        },
      ],
    },
    {
      name: 'EXCAVATOR',
      ramp: { fire: 0.9, rate: 0.8, minAlive: 4, maxCharging: 4 },
      sections: [
        {
          id: 'excavator', from: 'boss', to: 'dock', duration: 72, boss: 'excavator', bossTime: 64, rocks: { kind: 'ore', target: 2 },
          waves: [
            { at: 2.4, msg: 'WARNING\nEXCAVATOR', warn: true, msgT: 2.4 },
            { at: 18, f: 'swarm', type: 'miner', n: 8, dy: 10 },
            { at: 30, f: 'snake', type: 'dart', n: 5, red: true, dy: 10 },
            { at: 44, f: 'swarm', type: 'miner', n: 10, dy: -8 },
            { at: 54, f: 'sweep', type: 'wasp', n: 4, dy: 12 },
          ],
        },
        { id: 'belt-dock', from: 'dock', to: 'end', duration: 8, dock: true, waves: [] },
      ],
    },
  ],

  scenery: {
    carriers: [
      { at: 'start', ds: 170, offset: [-78, -44, 0] },
      { at: 'end', ds: 110, offset: [0, -4, 0], dock: true },
    ],
    fields: [
      { from: 'start', to: 's2', kind: 'ore', count: 260, minD: 50, maxD: 360, scale: [2, 22], detail: 1, seed: 41 },
      { from: 's2', to: 's3', kind: 'rock', count: 200, minD: 60, maxD: 380, scale: [2, 20], detail: 1, seed: 42 },
      { from: 's3', to: 's4', kind: 'ore', count: 220, minD: 50, maxD: 360, scale: [2, 22], detail: 1, seed: 43 },
      { from: 's4', to: 's5', kind: 'ore', count: 360, minD: 45, maxD: 330, scale: [3, 26], detail: 1, seed: 44 },
      { from: 's5', to: 'boss', kind: 'metal', count: 160, minD: 40, maxD: 260, scale: [1.5, 9], detail: 0, seed: 45 },
      { from: 'boss', to: 'end', kind: 'ore', count: 110, minD: 60, maxD: 320, scale: [2, 18], detail: 1, seed: 46 },
    ],
  },
  buildScenery,
};

location.sections = location.stages.flatMap((st, i) => st.sections.map((s) => Object.assign(s, { stage: i })));

export default location;
