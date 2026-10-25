// Location 4: FROZEN MOON (ai/summary.md §4.2). Low over an ice moon under a ringed giant: a descent from orbit, guns
// and crawlers on the plains, a canyon that narrows the play box, geysers erupting from the ice, a dark cavern under
// it, and the Fortress. The first location with terrain: a ribbon of ice along the route (world space), built from
// the same noise every time, in chunks so the GPU only draws the part in view.
import { BufferAttribute, BufferGeometry, Color, MeshLambertMaterial, Mesh, Vector3, Quaternion } from 'three';
import modelUrl from '../../assets/loc4.glb?url';
import { FarPlanet } from '../../render/backdrop-kit.js';
import { railPath, sectionLabels } from './kit.js';

const PI = Math.PI;
const ALT = 75; // the rail's height over the ice after the descent

// ------------------------------------------------------------------------------------------------
// Value noise (2D) for the ice: deterministic, so the terrain is the same on every run.

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x, y) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < 4; i++) {
    s += a * noise2(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.7;
    a *= 0.5;
  }
  return s;
}

// ------------------------------------------------------------------------------------------------
// Backdrop: the ringed giant the moon circles, its shine, and a small far sun.

class MoonBackdrop {
  constructor(loc, tier) {
    this.giant = new FarPlanet({
      radius: 26000, position: [42000, 26000, -78000], colors: [0xc8b098, 0x8a7a8a, 0xf0e0c8], style: 'bands', haze: 0x9fb8ff,
      segs: Math.max(48, tier.planetSegs >> 1), rings: { radii: [33000, 52000], color: 0xd8c8b0, tilt: 0.42, roll: -0.25 },
    });
    this.bgObjects = [...this.giant.objects];
    this.objects = [];
  }
  update(time, camPos, sunDir) {
    this.giant.update(time, camPos, sunDir);
  }
  /** Under the ice (stage 5) it's dark: only your shots and their glows light it. */
  lightFactor(p, sunDir, stage) {
    const sec = stage?.section;
    if (sec?.id !== 'cavern') return 1;
    const t = stage.time;
    return 0.1 + 0.9 * Math.max(0, 1 - t / 2.5, (t - (sec.duration - 3)) / 3);
  }
}

// ------------------------------------------------------------------------------------------------
// The ice: a ribbon under the route (and a ceiling over the cavern), canyon walls in stage 3.

const COLS = [0, 15, 32, 52, 75, 105, 140, 185, 240, 320, 430, 600, 850, 1250, 1800];
const ICE = [new Color(0xd8e8f8), new Color(0x9ab8d4), new Color(0x5c7a98), new Color(0x3a5470)];

function smooth01(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function buildScenery(ctx) {
  const { routes, tier } = ctx;
  const route = routes[0];
  const low = tier.name === 'low';
  const step = low ? 34 : 24;
  const cols = low ? COLS.filter((_, i) => i % 2 === 0 || i < 4) : COLS;
  const lat = [...cols.slice(1).reverse().map((c) => -c), ...cols];
  const L = route.labels;
  const canyon = [L.s3, L.s4];
  const cave = [L.s5, L.boss];
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const objects = [];
  const P = new Vector3();
  const Q = new Quaternion();
  const R = new Vector3();
  const W = new Vector3();
  const ramp = (s, [a, b], k = 400) => smooth01((s - a) / k) * smooth01((b - s) / k);

  /** One ribbon chunk over rows [r0, r1]; height(lateral, s, railY) gives world y. */
  const chunk = (r0, r1, height, ceiling) => {
    const nx = lat.length;
    const rows = r1 - r0 + 1;
    const pos = new Float32Array(rows * nx * 3);
    const col = new Float32Array(rows * nx * 3);
    for (let r = 0; r < rows; r++) {
      const s = (r0 + r) * step;
      route.sample(s, P, Q);
      R.set(1, 0, 0).applyQuaternion(Q);
      R.y = 0;
      R.normalize();
      for (let c = 0; c < nx; c++) {
        W.copy(P).addScaledVector(R, lat[c]);
        const y = height(lat[c], s, P.y, W);
        const i = (r * nx + c) * 3;
        pos[i] = W.x;
        pos[i + 1] = y;
        pos[i + 2] = W.z;
        const h = ceiling ? 0.6 : Math.max(0, Math.min(1, (y + 20) / 90));
        const k = noise2(W.x * 0.05, W.z * 0.05);
        const cc = ICE[Math.min(3, Math.floor((1 - h) * 2.2 + k * 1.3))];
        col[i] = cc.r;
        col[i + 1] = cc.g;
        col[i + 2] = cc.b;
      }
    }
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < nx - 1; c++) {
        const a = r * nx + c;
        const b = a + 1;
        const d = a + nx;
        const e = d + 1;
        // the ground faces up (seen from above), the cavern roof faces down
        if (ceiling) idx.push(a, d, b, b, d, e);
        else idx.push(a, b, d, b, e, d);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new Mesh(g, mat);
    objects.push(m);
    ctx.scenery.items.push({ object: m, s0: r0 * step, s1: r1 * step, route: null });
  };

  const ground = (l, s, railY, w) => {
    const a = Math.abs(l);
    let y = 3 * fbm2(w.x * 0.01, w.z * 0.01) - 2;
    // rougher ice away from the route; pressure ridges and drifts
    const far = smooth01((a - 140) / 300);
    y += far * (60 * fbm2(w.x * 0.0022, w.z * 0.0022) + 18 * fbm2(w.x * 0.012, w.z * 0.012) - 30);
    // canyon walls rising past the rail on both sides
    const cw = ramp(s, canyon);
    if (cw > 0) y += cw * smooth01((a - 62) / 55) * (railY + 130 + 30 * noise2(w.x * 0.02, w.z * 0.02));
    // never inside the corridor
    if (a < 70) y = Math.min(y, railY - 34);
    return y;
  };
  const roof = (l, s, railY, w) => {
    const a = Math.abs(l);
    return railY + 46 + 12 * fbm2(w.x * 0.015, w.z * 0.015) - Math.max(0, a - 260) * 0.45 + 30 * (1 - ramp(s, cave, 300));
  };

  const rows = Math.floor((L.end + 400) / step);
  const per = 48;
  for (let r = Math.floor(L.s2 * 0.55 / step); r < rows; r += per) chunk(r, Math.min(rows, r + per), ground, false);
  for (let r = Math.floor((cave[0] - 300) / step); r < Math.floor((cave[1] + 300) / step); r += per) {
    chunk(r, Math.min(Math.floor((cave[1] + 300) / step), r + per), roof, true);
  }
  return { objects, dispose: () => mat.dispose() };
}

// ------------------------------------------------------------------------------------------------
// Ground hulks: flak towers and crawlers (they sit on the ice, ALT below the rail).

const HULKS = {
  groundgun: {
    name: 'FLAK TOWER', model: 'groundgun', scale: 1.6, bonus: 2000, drops: [], exitZ: 200,
    hull: [[0, 6, 0, 8]],
    parts: {
      gun: { hp: 16, r: 4.2, score: 800, weapon: { w: 'aimed', n: 3, spread: 0.1, speed: 42, rate: 3.4 } },
      radar: { hp: 8, r: 3, score: 500 },
    },
  },
  crawler: {
    name: 'CRAWLER', model: 'crawler', scale: 2, bonus: 2500, drops: ['bomb'], exitZ: 200,
    hull: [[0, 4, 0, 13]],
    parts: {
      turret: { hp: 22, r: 4.5, score: 1000, weapon: { w: 'aimed', n: 1, speed: 46, rate: 2.6, kind: 4 } },
      cab: { hp: 14, r: 4.5, score: 800 },
    },
  },
};

// ------------------------------------------------------------------------------------------------
// The Fortress: four flak towers, two shield generators (the core is shielded while either stands), then the core,
// which wakes the geysers around you when it's hurt.

const FORTRESS = {
  type: 'fortress', name: 'FORTRESS', model: 'fortress', bodyR: 30, hullR: 14, hold: { x: 0, y: -46, z: -195 }, enterFrom: -760,
  scale: 1.35, pitch: 0.12, boom: 5, hpScale: 2.4, score: 36000, partScore: 2000, drops: ['pow', 'shield'],
  parts: {
    tower0: { hp: 30, r: 4.6 }, tower1: { hp: 30, r: 4.6 }, tower2: { hp: 30, r: 4.6 }, tower3: { hp: 30, r: 4.6 },
    gen0: { hp: 40, r: 4.6 }, gen1: { hp: 40, r: 4.6 },
    core: { hp: 260, r: 8, core: true },
  },
  coreVulnerable: (b) => b.parts.every((p) => !p.name.startsWith('gen') || !p.alive),
  move(b, tt) {
    const d = b.def;
    b.pos.set(18 * Math.sin(tt * 0.24), d.hold.y + 3 * Math.sin(tt * 0.4), d.hold.z + 10 * Math.sin(tt * 0.2));
  },
  attack(b, dt) {
    const g = b.game;
    const diff = g.difficulty;
    const core = b.parts.find((p) => p.core);
    if (b.phase === 1 && b.coreVulnerable()) {
      b.phase = 2;
      g.hud.banner('SHIELD DOWN', 1.6);
      g.audio?.warning();
    }
    if (b.phase === 2 && core.hp < core.max * 0.45) {
      b.phase = 3;
      g.hud.banner('FORTRESS ENRAGED', 1.6, true);
      g.music?.goto('B');
    }
    b.parts.forEach((p, i) => {
      if (!p.alive || p.core || !p.name.startsWith('tower')) return;
      p.fireT -= dt * diff.fireRate;
      if (p.fireT > 0) return;
      p.fireT = 3.2 + (i % 2) * 0.6;
      b.aimed(p.world, 3, 0.11, 42, 0);
      g.fx.flash(p.world.x, p.world.y, p.world.z, 3.5, [1, 0.7, 0.45], 0.1);
    });
    if (b.phase >= 2 && core.alive) {
      b.coreT -= dt * diff.fireRate;
      if (b.coreT <= 0) {
        b.coreT = 2.0;
        b.spiral += 0.4;
        g.enemies.ring(core.world.x, core.world.y, core.world.z, b.phase === 3 ? 10 : 8, 34 * diff.bulletSpeed, b.spiral, 3);
        g.audio?.enemyShot();
      }
      b.beamT -= dt;
      if (b.beamT <= 0) {
        b.beamT = b.phase === 3 ? 4.4 : 5.6;
        b.beam(core.world);
        if (b.phase === 3) g.hazards.start({ hazard: 'geyser', x: [g.player.pos.x - 12, g.player.pos.x + 12], z: -420 });
      }
    }
  },
};

// ------------------------------------------------------------------------------------------------
// Music: A minor, glassy FM bells over a sparse beat and long echoes; the motif A – E – D – C broken up on bells.

const THEME = {
  name: 'frozenMoon',
  tr: -5,
  bpm: 124,
  inst: { lead: 'bell', counter: 'glass', bass: 'sub', pad: 'pad', arp: 'glass' },
  mix: { lead: 0.95, counter: 0.9, bass: 0.95, pad: 0.6, arp: 0.35, drums: 0.8 },
  styles: { bass: 'half', drums: 'sparse', arp: 'bells', arpOct: 12 },
  sections: {
    intro: { bars: 4, chords: 'Am F C G', layers: 'pad arp bass' },
    A: {
      bars: 8,
      chords: 'Am F C G Am F Dm E',
      mel: `A5:4 r:4 E6:4 r:4 | D6:4 r:2 C6:2 r:8 | E5:4 r:4 G5:4 C6:4 | B5:8 r:8 |
            A5:4 r:4 E6:4 r:4 | D6:4 r:2 C6:2 F6:8 | E6:4 D6:4 A5:4 F5:4 | G#5:12 r:4`,
      layers: 'lead pad bass arp drums',
    },
    B: {
      bars: 8,
      chords: 'F G Em Am F G E E',
      mel: 'r:16 | r:16 | r:16 | r:16 | r:16 | r:16 | r:16 | r:16',
      counter: 'C6:6 B5:2 A5:8 | D6:6 C6:2 B5:8 | G5:6 B5:2 E6:8 | C6:8 A5:8 | A5:6 C6:2 F6:8 | G6:6 F6:2 D6:8 | E6:4 D6:4 B5:4 G#5:4 | E5:16',
      layers: 'counter pad bass arp drums',
    },
  },
  form: ['intro', 'A', 'B', 'A'],
  loopFrom: 1,
};

const BOSS = {
  name: 'frozenMoonBoss',
  tr: -5,
  bpm: 132,
  inst: { lead: 'brass', counter: 'bell', bass: 'saw', pad: 'pad', arp: 'pluck' },
  mix: { lead: 0.85, bass: 1, pad: 0.65, arp: 0.35, drums: 1, counter: 0.7 },
  styles: { drums: 'march', arp: 'updown8' },
  sections: {
    A: {
      bars: 8,
      chords: 'Am Am F E Am Am F E',
      bass: `A1:6 E2:2 D2:4 C2:4 | A1:2 A1:2 r:2 A1:2 C2:2 B1:2 A1:2 G1:2 | F1:6 C2:2 B1:4 A1:4 | E1:4 E1:2 E1:2 G#1:4 B1:4 |
             A1:6 E2:2 D2:4 C2:4 | A1:2 A1:2 r:2 A1:2 C2:2 B1:2 A1:2 G1:2 | F1:6 C2:2 B1:4 A1:4 | E1:4 D1:4 C1:4 B0:4`,
      mel: `E5:2 r:2 E5:2 r:2 A5:4 G5:4 | E5:12 r:4 | F5:2 r:2 F5:2 r:2 C6:4 A5:4 | B5:12 r:4 |
            E5:2 r:2 E5:2 r:2 A5:4 C6:4 | B5:8 A5:8 | F5:2 r:2 A5:2 r:2 C6:4 F6:4 | E6:12 r:4`,
      layers: 'lead bass pad drums',
    },
    B: {
      bars: 8,
      chords: 'Dm Dm Am Am Bb Bb E E',
      styles: { bass: 'drive16', drums: 'blast', arp: 'up16' },
      mel: 'A6:6 E6:2 D6:4 C6:4 | D6:8 F6:8 | E6:6 C6:2 B5:4 A5:4 | E6:12 r:4 | D6:6 Bb5:2 F6:4 D6:4 | G6:8 F6:8 | E6:4 G#6:4 B6:4 E6:4 | E6:12 r:4',
      counter: 'F4:16 | A4:16 | E4:16 | A4:16 | F4:16 | Bb4:16 | G#4:16 | B4:16',
      layers: 'lead counter bass pad drums arp',
      fillEnd: true,
    },
  },
  form: ['A', 'B'],
};

// ------------------------------------------------------------------------------------------------

const D1 = 65 * 52;
const labels = sectionLabels('start', [
  ['s2', 65, 52], ['s3', 70, 48], ['s4', 65, 44], ['s5', 70, 44], ['boss', 70, 40], ['dock', 72, 26], ['end', 8, 40],
]);
const squeeze = { sx: 0.5, sy: 0.75 };
const narrow = { sx: 0.75, sy: 0.6 };

const location = {
  id: 'frozen-moon',
  index: 3,
  name: 'FROZEN MOON',
  subtitle: 'low over the ice, under the rings of a giant',
  modelUrl,
  backdrop: (loc, tier) => new MoonBackdrop(loc, tier),
  sun: { azimuth: 1.0, elevation: 0.45 },
  sunStyle: { halo: [0.7, 0.85, 1], core: [0.95, 0.97, 1], size: 0.7 },
  light: { sun: 0xeef4ff, sunI: 2.5, hemiDay: 0x9fc0ff, hemiNight: 0x203050, ground: 0x6a88a8, hemiI: 1.0 },
  sky: {
    base: [0.006, 0.01, 0.024], clouds: [0.03, 0.05, 0.1], wisps: [0.02, 0.06, 0.08], band: [0.08, 0.1, 0.16],
    knots: [0.06, 0.04, 0.08], density: 0.7, gN: [0.2, 0.9, 0.3],
  },
  rim: { color: 0xffd8a0, strength: 0.78 }, // +30% in plan 4: the cavern
  // bigger squads, a third of the waves come round again, and more fire: with the size floor and the second passes
  // its ships die sooner, and at itr 3's fire it played easier than the nebula
  formations: { squad: 1.2, loop: 0.34 },
  fireScale: [1.3, 1.2],
  bossDefs: { fortress: FORTRESS },
  hulkDefs: HULKS,
  songs: { theme: THEME, boss: BOSS },
  intros: {
    ground: 'GUNS ON THE ICE: aim down and knock them out as you pass over',
    canyon: 'THE CANYON: the walls close in. Stay in the middle',
    geyser: 'GEYSERS: the vents glow before they erupt. Move out of the red ring, or roll through',
    cavern: 'UNDER THE ICE: dark. Their glows and your shots light the way',
  },

  path: railPath({
    labels,
    heading: -0.3,
    swing: (d) => [380 * Math.sin(d / 2200) + 150 * Math.sin(d / 800), ALT + Math.max(0, 1 - d / D1) ** 2 * 1300 + 6 * Math.sin(d / 700)],
    roll: (d) => (d < D1 ? 0.15 * Math.sin(d / 900) : 0),
  }),

  stages: [
    {
      name: 'DESCENT',
      ramp: { fire: 0.7, rate: 0.85, minAlive: 3, maxCharging: 3 },
      sections: [
        {
          id: 'descent', from: 'start', to: 's2', duration: 65, rocks: { kind: 'ice', target: 3 },
          waves: [
            { at: 1.5, f: 'vee', type: 'dart', n: 5 },
            { at: 5, f: 'dive', type: 'dart', n: 4 },
            { at: 9, f: 'sweep', type: 'wasp', n: 4 },
            { at: 13, f: 'helix', type: 'dart', n: 8 },
            { at: 17, f: 'dive', type: 'wasp', n: 4, mirror: true },
            { at: 21, f: 'snake', type: 'dart', n: 5, red: true },
            { at: 28, f: 'hold', type: 'hammer', n: 1, weapon: 'shells', drop: 'bomb' },
            { at: 31, f: 'vee', type: 'wasp', n: 5 },
            { at: 35, f: 'ring', type: 'dart', n: 8 },
            { at: 39, f: 'overtake', type: 'dart', n: 4 },
            { at: 43, f: 'wall', type: 'dart', n: 9 },
            { at: 47, f: 'dive', type: 'dart', n: 4, flipY: true },
            { at: 51, f: 'sweep', type: 'dart', n: 5, dy: 6 },
            { at: 55, f: 'helix', type: 'wasp', n: 6 },
            { at: 59, f: 'vee', type: 'dart', n: 5 },
          ],
        },
      ],
    },
    {
      name: 'ICE PLAINS',
      ramp: { fire: 0.75, rate: 0.9, minAlive: 3, maxCharging: 4 },
      sections: [
        {
          id: 'plains', from: 's2', to: 's3', duration: 70, rocks: { kind: 'ice', target: 2 },
          waves: [
            { at: 2, intro: 'ground' },
            { at: 2, hulk: 'groundgun', x: 40, y: -ALT + 2 },
            { at: 6, f: 'vee', type: 'dart', n: 5, dy: 8 },
            { at: 9, hulk: 'groundgun', x: -45, y: -ALT + 2 },
            { at: 12, hulk: 'crawler', x: 80, y: -ALT + 3, vx: -16 },
            { at: 16, f: 'sweep', type: 'wasp', n: 4 },
            { at: 20, hulk: 'groundgun', x: 18, y: -ALT + 2 },
            { at: 22, f: 'snake', type: 'dart', n: 5, red: true, dy: 8 },
            { at: 28, hulk: 'crawler', x: -80, y: -ALT + 3, vx: 16, yaw: PI },
            { at: 30, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles', drop: 'shield' },
            { at: 34, hulk: 'groundgun', x: -30, y: -ALT + 2 },
            { at: 36, f: 'helix', type: 'dart', n: 8 },
            { at: 40, hulk: 'groundgun', x: 50, y: -ALT + 2, drop: 'pow' },
            { at: 43, f: 'overtake', type: 'wasp', n: 4 },
            { at: 47, hulk: 'crawler', x: 78, y: -ALT + 3, vx: -14 },
            { at: 50, f: 'vee', type: 'wasp', n: 5 },
            { at: 54, hulk: 'groundgun', x: -50, y: -ALT + 2 },
            { at: 56, f: 'ring', type: 'dart', n: 8 },
            { at: 60, hulk: 'groundgun', x: 35, y: -ALT + 2 },
            { at: 62, f: 'sweep', type: 'dart', n: 5 },
          ],
        },
      ],
    },
    {
      name: 'THE CANYON',
      ramp: { fire: 0.75, rate: 0.9, minAlive: 3, maxCharging: 3 },
      sections: [
        {
          id: 'canyon', from: 's3', to: 's4', duration: 65, box: { x: 16, y: 14 }, rocks: { kind: 'ice', target: 2 },
          waves: [
            { at: 1.5, intro: 'canyon' },
            { at: 2, f: 'vee', type: 'dart', n: 5, ...narrow },
            { at: 6, f: 'helix', type: 'dart', n: 8, ...narrow },
            { at: 10, f: 'overtake', type: 'dart', n: 4, ...squeeze },
            { at: 14, f: 'wall', type: 'dart', n: 9, ...narrow },
            { at: 18, f: 'snake', type: 'dart', n: 5, red: true, sx: 0.4 },
            { at: 25, f: 'dive', type: 'wasp', n: 4, ...squeeze },
            { at: 29, f: 'hold', type: 'hammer', n: 1, drop: 'pow' },
            { at: 33, f: 'ring', type: 'dart', n: 8, ...narrow },
            { at: 37, f: 'vee', type: 'wasp', n: 5, roll: PI, ...narrow },
            { at: 41, f: 'sweep', type: 'dart', n: 5, sx: 0.4, dy: 6 },
            { at: 45, f: 'mines', type: 'mine', n: 8, ...squeeze },
            { at: 49, f: 'helix', type: 'wasp', n: 6, ...narrow },
            { at: 53, f: 'overtake', type: 'wasp', n: 4, mirror: true, ...squeeze },
            { at: 57, f: 'wall', type: 'dart', n: 9, ...narrow },
            { at: 61, f: 'vee', type: 'dart', n: 5, ...narrow },
          ],
        },
      ],
    },
    {
      name: 'GEYSER FIELD',
      ramp: { fire: 0.8, rate: 0.95, minAlive: 4, maxCharging: 4 },
      sections: [
        {
          id: 'geysers', from: 's4', to: 's5', duration: 70, rocks: { kind: 'ice', target: 2 },
          waves: [
            { at: 2, intro: 'geyser' },
            { at: 3, hazard: 'geyser', x: [0] },
            { at: 8, f: 'vee', type: 'dart', n: 5 },
            { at: 10, hazard: 'geyser', x: [-14, 14] },
            { at: 13, f: 'helix', type: 'dart', n: 8 },
            { at: 16, hazard: 'geyser', x: [-20, 0, 20], gap: 0.6 },
            { at: 19, f: 'overtake', type: 'dart', n: 4 },
            { at: 22, f: 'snake', type: 'wasp', n: 5, red: true },
            { at: 28, hazard: 'geyser', x: [-8, 8, -16, 16], gap: 0.4 },
            { at: 31, f: 'hold', type: 'hammer', n: 1, weapon: 'laser', drop: 'bomb' },
            { at: 35, hazard: 'geyser', x: [0, -12, 12], gap: 0.5 },
            { at: 38, f: 'ring', type: 'dart', n: 8 },
            { at: 41, hulk: 'groundgun', x: 40, y: -ALT + 2 },
            { at: 43, hazard: 'geyser', x: [-18, -6, 6, 18], gap: 0.5 },
            { at: 46, f: 'wall', type: 'dart', n: 9 },
            { at: 50, hazard: 'geyser', x: [10, -10] },
            { at: 52, f: 'dive', type: 'wasp', n: 4 },
            { at: 56, hazard: 'geyser', x: [-20, -10, 0, 10, 20], gap: 0.35 },
            { at: 60, f: 'vee', type: 'wasp', n: 5 },
            { at: 63, hazard: 'geyser', x: [0] },
          ],
        },
      ],
    },
    {
      name: 'UNDER THE ICE',
      ramp: { fire: 0.85, rate: 0.95, minAlive: 4, maxCharging: 4 },
      sections: [
        {
          id: 'cavern', from: 's5', to: 'boss', duration: 70, box: { x: 24, y: 14 }, calm: true, rocks: { kind: 'ice', target: 3 },
          waves: [
            { at: 1.5, intro: 'cavern' },
            { at: 2, f: 'vee', type: 'dart', n: 5 },
            { at: 6, f: 'sweep', type: 'wasp', n: 4, sx: 0.8 },
            { at: 10, f: 'helix', type: 'dart', n: 8 },
            { at: 14, f: 'mines', type: 'mine', n: 6 },
            { at: 18, f: 'overtake', type: 'dart', n: 4 },
            { at: 22, f: 'snake', type: 'dart', n: 5, red: true, sx: 0.6 },
            { at: 29, f: 'hold', type: 'hammer', n: 1, weapon: 'shells', drop: 'pow' },
            { at: 32, f: 'ring', type: 'dart', n: 8, sy: 0.7 },
            { at: 36, f: 'dive', type: 'wasp', n: 4, sx: 0.7, sy: 0.6 },
            { at: 40, f: 'wall', type: 'dart', n: 9, sy: 0.7 },
            { at: 44, f: 'vee', type: 'wasp', n: 5 },
            { at: 48, f: 'helix', type: 'wasp', n: 6, sy: 0.7 },
            { at: 52, f: 'mines', type: 'mine', n: 8 },
            { at: 56, f: 'sweep', type: 'dart', n: 5, sx: 0.7 },
            { at: 60, f: 'overtake', type: 'wasp', n: 4 },
            { at: 63, f: 'vee', type: 'dart', n: 5 },
          ],
        },
      ],
    },
    {
      name: 'FORTRESS',
      ramp: { fire: 0.9, rate: 0.8, minAlive: 4, maxCharging: 4 },
      sections: [
        {
          id: 'fortress', from: 'boss', to: 'dock', duration: 72, boss: 'fortress', bossTime: 64, rocks: { kind: 'ice', target: 2 },
          waves: [
            { at: 2.4, msg: 'WARNING\nFORTRESS', warn: true, msgT: 2.4 },
            { at: 14, f: 'vee', type: 'dart', n: 4, dy: 12 },
            { at: 26, f: 'snake', type: 'dart', n: 5, red: true, dy: 10 },
            { at: 38, hazard: 'geyser', x: [-12, 12] },
            { at: 46, f: 'sweep', type: 'wasp', n: 4, dy: 12 },
            { at: 56, f: 'dive', type: 'dart', n: 4 },
          ],
        },
        { id: 'moon-dock', from: 'dock', to: 'end', duration: 8, dock: true, waves: [] },
      ],
    },
  ],

  scenery: {
    carriers: [
      { at: 'start', ds: 170, offset: [-78, -44, 0] },
      { at: 'end', ds: 110, offset: [0, -4, 0], dock: true },
    ],
    fields: [{ from: 'start', to: 's2', kind: 'ice', count: 140, minD: 60, maxD: 360, scale: [2, 14], detail: 1, seed: 61 }],
  },
  buildScenery,
};

location.sections = location.stages.flatMap((st, i) => st.sections.map((s) => Object.assign(s, { stage: i })));

export default location;
