// Location 3: CRIMSON NEBULA (ai/summary.md §4.2). Inside glowing gas: fog banks (ships and rocks fade, bullets
// don't), a capital-ship battle in the distance whose stray beams cross the corridor, ion storms, cloaked wasps, a
// battleship to fly alongside, and the enemy Flagship. The light comes from the clouds; there is no sun disc.
import { Mesh, Vector3 } from 'three';
import modelUrl from '../../assets/loc3.glb?url';
import { SkyBand, StarBody } from '../../render/backdrop-kit.js';
import { Billboards, SHAPE } from '../../render/billboards.js';
import { makeRng } from '../../core/rng.js';
import { railPath, sectionLabels } from './kit.js';

const PI = Math.PI;

// ------------------------------------------------------------------------------------------------
// Backdrop: a dense nebula sky, a young star cluster, and the Eye: a protostar glowing at the nebula's heart.

class NebulaBackdrop {
  constructor(loc, tier, models, game) {
    this.game = game;
    this.cluster = new SkyBand({ count: Math.round(tier.stars * 0.8), normal: [0.6, 0.3, 0.74], width: 0.35, colors: [0xffffff, 0xa8d8ff, 0xffc0d8], size: 1.8, seed: 31 });
    this.eye = new StarBody({ radius: 2600, position: [-26000, 4000, -60000], colors: [0xffe8f0, 0xff6aa0, 0xff4a8a], segs: 48 });
    this.bgObjects = [this.cluster.points, ...this.eye.objects];
    this.objects = [];
  }
  update(time, camPos) {
    this.cluster.update(camPos, this.game.r.gl.getPixelRatio());
    this.eye.update(time, camPos);
  }
  lightFactor() {
    return 1;
  }
}

// ------------------------------------------------------------------------------------------------
// Scenery: cloud banks along the route (soft, alpha-blended, behind and around the corridor), and the fleet battle
// (distant capital ships trading beams) in stage 2.

function buildScenery(ctx) {
  const { routes, tier, models, scenery, shipMaterial } = ctx;
  const route = routes[0];
  const rng = makeRng(51);
  const low = tier.name === 'low';
  const clouds = new Billboards(low ? 40 : 70, { additive: false, renderOrder: 3, minPx: 0 });
  const puffs = [];
  const p = new Vector3();
  const end = route.labels.end;
  for (let s = 0; s < end; s += low ? 150 : 95) {
    const a = rng() * PI * 2;
    const d = 140 + rng() * 520;
    route.localToWorld(s, Math.cos(a) * d, Math.sin(a) * d * 0.7, 0, p);
    const teal = rng() < 0.3;
    puffs.push({ s, x: p.x, y: p.y, z: p.z, size: 160 + rng() * 260, a: 0.07 + rng() * 0.08, c: teal ? [0.25, 0.55, 0.6] : [0.75, 0.22, 0.38] });
  }
  // the fleet line: a few capital ships far off to the side, beams flickering between them
  const fleet = [];
  const objects = [clouds.mesh];
  const s2 = route.labels.s2;
  const s3 = route.labels.s3;
  for (let i = 0; i < 6; i++) {
    const s = s2 + ((i + 0.5) / 6) * (s3 - s2);
    route.localToWorld(s, (i % 2 ? 1 : -1) * (900 + rng() * 500), 120 + rng() * 260, 0, p);
    const model = models[i % 3 === 0 ? 'flagship' : 'battleship'];
    if (!model?.geometry) continue;
    const m = new Mesh(model.geometry, shipMaterial);
    m.position.copy(p);
    m.rotation.y = (i % 2 ? 0.5 : -0.5) + PI;
    m.scale.setScalar(2.2);
    objects.push(m);
    scenery.items.push({ object: m, s0: s2 - 1500, s1: s3 + 800, route: null });
    fleet.push({ p: p.clone(), side: i % 2 });
  }
  return {
    objects,
    update(s, r, decided, time, bb) {
      clouds.begin();
      for (const q of puffs) {
        if (q.s < s - 250 || q.s > s + 2600) continue;
        const fade = Math.min(1, (q.s + 2600 - s) / 900) * Math.min(1, (q.s - s + 250) / 200);
        clouds.push(q.x, q.y, q.z, 0, 0, 0, q.c[0], q.c[1], q.c[2], q.a * fade, q.size, SHAPE.SOFT);
      }
      clouds.end();
      if (s < s2 - 1500 || s > s3 + 800) return;
      // beams between the ships of the two lines, a few at a time
      for (let k = 0; k < fleet.length - 1; k++) {
        const on = Math.sin(time * 1.7 + k * 2.1) > 0.55;
        if (!on) continue;
        const A = fleet[k].p;
        const B = fleet[k + 1].p;
        bb.push(B.x, B.y, B.z, B.x - A.x, B.y - A.y, B.z - A.z, 1, 0.35, 0.5, 0.8, 9, SHAPE.BEAM);
        bb.push(A.x, A.y, A.z, 0, 0, 0, 1, 0.8, 0.6, 0.7, 60, SHAPE.GLOW);
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------
// The battleship (hulk, stage 5's mid-boss): it flies alongside, below and to the right, as you overtake it.

const aimed = { w: 'aimed', n: 2, spread: 0.06, speed: 44, rate: 3.2 };
const fan = { w: 'fan', n: 5, spread: 0.18, speed: 40, rate: 3.9 };
const HULKS = {
  battleship: {
    name: 'BATTLESHIP', model: 'battleship', scale: 1.2, yaw: PI, bonus: 12000, drops: ['shield'], exitZ: 300, boom: 4,
    hull: [-70, -45, -20, 5, 30, 55, 80].map((z) => [0, 0, z, 9]),
    parts: Object.fromEntries([
      ...Array.from({ length: 8 }, (_, i) => [`turret${i}`, { hp: 18, r: 3.2, score: 900, weapon: i % 2 ? fan : aimed }]),
      ['bridge', { hp: 40, r: 6, score: 2500, explode: 2.6 }],
    ]),
  },
};

// ------------------------------------------------------------------------------------------------
// The Flagship: four broadside batteries and two missile pods, then its bridge (the core); enraged, it calls in
// the fleet's crossfire.

const FLAGSHIP = {
  type: 'flagship', name: 'FLAGSHIP', model: 'flagship', bodyR: 26, hullR: 13, hold: { x: 0, y: 5, z: -205 }, enterFrom: -820,
  scale: 1.3, pitch: 0.32, boom: 6, hpScale: 3.1, score: 30000, partScore: 2000, drops: ['bomb'],
  parts: {
    batL1: { hp: 34, r: 5 }, batL2: { hp: 34, r: 5 }, batR1: { hp: 34, r: 5 }, batR2: { hp: 34, r: 5 },
    podL: { hp: 28, r: 4.5 }, podR: { hp: 28, r: 4.5 },
    core: { hp: 260, r: 6, core: true },
  },
  coreVulnerable: (b) => b.phase >= 2,
  move(b, tt) {
    const d = b.def;
    b.pos.set(20 * Math.sin(tt * 0.27), d.hold.y + 5 * Math.sin(tt * 0.5), d.hold.z + 14 * Math.sin(tt * 0.19));
  },
  attack(b, dt) {
    const g = b.game;
    const diff = g.difficulty;
    const bats = b.parts.filter((p) => p.name.startsWith('bat'));
    const core = b.parts.find((p) => p.core);
    if (b.phase === 1 && (bats.every((p) => !p.alive) || b.t > 46)) {
      b.phase = 2;
      g.hud.banner('BRIDGE EXPOSED', 1.6);
      g.audio?.warning();
    }
    if (b.phase === 2 && core.hp < core.max * 0.45) {
      b.phase = 3;
      g.hud.banner('FLAGSHIP ENRAGED', 1.6, true);
      g.music?.goto('B');
    }
    b.parts.forEach((p, i) => {
      if (!p.alive || p.core) return;
      p.fireT -= dt * diff.fireRate;
      if (p.fireT > 0) return;
      if (p.name.startsWith('bat')) {
        p.fireT = 3.1 + (i % 2) * 0.5;
        b.fan(p.world, 5, 0.16, 40, 2);
        g.fx.flash(p.world.x, p.world.y, p.world.z, 4, [1, 0.7, 0.45], 0.1);
      } else {
        p.fireT = 5.6;
        const side = p.name === 'podL' ? -1 : 1;
        for (let k = 0; k < 2; k++) g.missiles.launch(1, p.world.x, p.world.y, p.world.z, side * (0.4 + k * 0.3), 0.2, 1);
      }
    });
    if (b.phase >= 2 && core.alive) {
      b.coreT -= dt * diff.fireRate;
      const arms = b.phase === 3 ? 2 : 1;
      if (b.coreT <= 0) {
        b.coreT = b.phase === 3 ? 0.4 : 0.36;
        b.spiral += 0.29;
        for (let a = 0; a < arms; a++) b.spiralShot(core.world, b.spiral + (a * PI * 2) / arms, 38 * diff.bulletSpeed);
      }
      // an aimed spread from the core too: something to dodge besides the pattern (plan_1 §2.4)
      b.aimT -= dt * diff.fireRate;
      if (b.aimT <= 0) {
        b.aimT = 2.6;
        b.aimed(core.world, 3, 0.1, 44, 1);
      }
      b.beamT -= dt;
      if (b.beamT <= 0) {
        b.beamT = b.phase === 3 ? 3 : 4;
        b.beam(core.world);
        if (b.phase === 3) g.hazards.start({ hazard: 'crossfire', n: 2, flip: b.bayCount++ % 2 });
      }
    }
  },
};

// ------------------------------------------------------------------------------------------------
// Music: F♯ minor, half-time, wide pads and a shimmering arpeggio; the motif F♯ – C♯ – B – A slowed, on a choir.

const THEME = {
  name: 'nebula',
  tr: 4,
  bpm: 112,
  inst: { lead: 'choir', counter: 'glass', bass: 'sub', pad: 'pad', arp: 'pluck' },
  mix: { lead: 1, counter: 0.9, bass: 1, pad: 0.9, arp: 0.3, drums: 0.7 },
  styles: { bass: 'whole', drums: 'half', arp: 'shimmer', arpOct: 12 },
  sections: {
    intro: { bars: 4, chords: 'F#m F#m D E', layers: 'pad arp bass' },
    A: {
      bars: 8,
      chords: 'F#m D Bm C#m F#m D E C#',
      mel: 'F#4:16 | C#5:16 | B4:16 | A4:16 | F#4:8 A4:8 | D5:16 | E5:8 G#4:8 | C#5:16',
      layers: 'lead pad arp bass drums',
    },
    B: {
      bars: 8,
      chords: 'Bm Bm D D A A C#m C#',
      mel: 'r:16 | r:16 | r:16 | r:16 | r:16 | r:16 | r:16 | r:16',
      counter: 'D5:6 C#5:2 B4:8 | F#5:12 r:4 | A5:6 F#5:2 E5:8 | D5:16 | C#5:6 E5:2 A5:8 | G#5:8 E5:8 | B4:6 C#5:2 E5:8 | F5:16',
      layers: 'counter pad arp bass drums',
    },
  },
  form: ['intro', 'A', 'B', 'A'],
  loopFrom: 1,
};

const BOSS = {
  name: 'nebulaBoss',
  tr: 4,
  bpm: 120,
  inst: { lead: 'brass', counter: 'choir', bass: 'saw', pad: 'pad', arp: 'pluck' },
  mix: { lead: 0.85, bass: 1, pad: 0.7, arp: 0.35, drums: 1, counter: 0.7 },
  styles: { drums: 'march', arp: 'updown8' },
  sections: {
    A: {
      bars: 8,
      chords: 'F#m F#m D C# F#m F#m D C#',
      bass: `F#1:6 C#2:2 B1:4 A1:4 | F#1:2 F#1:2 r:2 F#1:2 A1:2 G#1:2 F#1:2 E1:2 | D2:6 A1:2 G#1:4 F#1:4 | C#2:4 C#2:2 C#2:2 E#2:4 G#2:4 |
             F#1:6 C#2:2 B1:4 A1:4 | F#1:2 F#1:2 r:2 F#1:2 A1:2 G#1:2 F#1:2 E1:2 | D2:6 A1:2 G#1:4 F#1:4 | C#2:4 B1:4 A1:4 G#1:4`,
      mel: `C#5:2 r:2 C#5:2 r:2 F#5:4 E5:4 | C#5:12 r:4 | D5:2 r:2 D5:2 r:2 A5:4 F#5:4 | G#5:12 r:4 |
            C#5:2 r:2 C#5:2 r:2 F#5:4 A5:4 | G#5:8 F#5:8 | D5:2 r:2 F#5:2 r:2 A5:4 D6:4 | C#6:12 r:4`,
      layers: 'lead bass pad drums',
    },
    B: {
      bars: 8,
      chords: 'Bm Bm F#m F#m G G C# C#',
      styles: { bass: 'drive16', drums: 'blast', arp: 'up16' },
      mel: 'F#6:6 C#6:2 B5:4 A5:4 | B5:8 D6:8 | C#6:6 A5:2 G#5:4 F#5:4 | C#6:12 r:4 | B5:6 G5:2 D6:4 B5:4 | E6:8 D6:8 | C#6:4 E#6:4 G#6:4 C#6:4 | C#6:12 r:4',
      counter: 'D4:16 | F#4:16 | C#4:16 | F#4:16 | D4:16 | G4:16 | E#4:16 | G#4:16',
      layers: 'lead counter bass pad drums arp',
      fillEnd: true,
    },
  },
  form: ['A', 'B'],
};

// ------------------------------------------------------------------------------------------------

const labels = sectionLabels('start', [
  ['s2', 65, 48], ['s3', 70, 46], ['s4', 65, 44], ['s5', 70, 40], ['s6', 70, 34], ['boss', 65, 46], ['dock', 72, 26], ['end', 8, 40],
]);

const location = {
  id: 'nebula',
  index: 2,
  name: 'CRIMSON NEBULA',
  subtitle: 'inside the gas: fog, storms, and the fleet that hides in them',
  modelUrl,
  backdrop: (loc, tier, models, game) => new NebulaBackdrop(loc, tier, models, game),
  sun: { azimuth: 0.9, elevation: 0.75 },
  sunHidden: true,
  light: { sun: 0xffc0d0, sunI: 1.9, hemiDay: 0xe08aa8, hemiNight: 0x60304a, ground: 0x20405a, hemiI: 1.15 },
  sky: {
    base: [0.05, 0.012, 0.03], clouds: [0.36, 0.06, 0.14], wisps: [0.05, 0.2, 0.22], band: [0.4, 0.14, 0.24],
    knots: [0.5, 0.18, 0.12], density: 1.7, gN: [0.6, 0.3, 0.74],
  },
  fog: { color: 0x2c0c1e, density: 0.0015 },
  rim: { color: 0x9ff0ff, strength: 1.1 }, // +30% in plan 4: readability in the fog
  formations: { loop: 0.34 }, // a third of the waves come round for a second pass (ai/summary.md §7.1)
  bossDefs: { flagship: FLAGSHIP },
  hulkDefs: HULKS,
  songs: { theme: THEME, boss: BOSS },
  intros: {
    crossfire: 'STRAY BEAMS from the fleet battle: a red aim line, then the beam. Get off the line',
    strike: 'ION STORM: lightning strikes the marked lanes. Move out of the red ring',
    shade: 'CLOAKED WASPS: a shimmer in the fog until they charge their guns',
    battleship: 'BATTLESHIP: knock out its turrets as you overtake it',
  },

  path: railPath({
    labels,
    heading: 0.4,
    swing: (d) => [520 * Math.sin(d / 2400) + 200 * Math.sin(d / 900), 260 * Math.sin(d / 1600)],
    roll: (d) => 0.12 * Math.sin(d / 1300),
  }),

  stages: [
    {
      name: 'NEBULA EDGE',
      ramp: { fire: 1, rate: 1, minAlive: 3, maxCharging: 4 },
      sections: [
        {
          id: 'edge', from: 'start', to: 's2', duration: 65, rocks: { kind: 'crystal', target: 3 },
          waves: [
            { at: 1.5, f: 'vee', type: 'wasp', n: 5 },
            { at: 5, f: 'sweep', type: 'dart', n: 5, dy: 6 },
            { at: 9, f: 'helix', type: 'dart', n: 8 },
            { at: 13, f: 'overtake', type: 'wasp', n: 4 },
            { at: 17, f: 'sweep', type: 'dart', n: 5, mirror: true, dy: -6 },
            { at: 21, f: 'snake', type: 'dart', n: 5, red: true },
            { at: 28, f: 'hold', type: 'hammer', n: 1, weapon: 'laser', drop: 'bomb' },
            { at: 31, f: 'ring', type: 'dart', n: 8, roll: PI },
            { at: 35, f: 'dive', type: 'wasp', n: 4 },
            { at: 38, f: 'wall', type: 'dart', n: 9 },
            { at: 42, f: 'vee', type: 'wasp', n: 5, roll: PI / 2, rot: PI / 2 },
            { at: 46, f: 'helix', type: 'wasp', n: 6 },
            { at: 50, f: 'mines', type: 'mine', n: 6 },
            { at: 54, f: 'sweep', type: 'dart', n: 5, dy: 8 },
            { at: 54.5, f: 'sweep', type: 'dart', n: 5, mirror: true, dy: -8 },
            { at: 58, f: 'vee', type: 'dart', n: 5, weapon: 'burst3' },
          ],
        },
      ],
    },
    {
      name: 'FLEET LINE',
      ramp: { fire: 1.05, rate: 1.05, minAlive: 3, maxCharging: 5 },
      sections: [
        {
          id: 'fleet', from: 's2', to: 's3', duration: 70, rocks: { kind: 'crystal', target: 2 },
          waves: [
            { at: 1.5, f: 'sweep', type: 'wasp', n: 4 },
            { at: 3, intro: 'crossfire' },
            { at: 3.5, hazard: 'crossfire', n: 1 },
            { at: 7, f: 'vee', type: 'dart', n: 5, weapon: 'burst3' },
            { at: 10, hazard: 'crossfire', n: 1 },
            { at: 12, f: 'helix', type: 'dart', n: 8 },
            { at: 16, f: 'overtake', type: 'wasp', n: 4, mirror: true },
            { at: 19, hazard: 'crossfire', n: 2, flip: true },
            { at: 22, f: 'snake', type: 'wasp', n: 5 },
            { at: 29, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles', drop: 'shield' },
            { at: 31, hazard: 'crossfire', n: 2 },
            { at: 34, f: 'ring', type: 'dart', n: 8 },
            { at: 38, f: 'sweep', type: 'dart', n: 5, dy: -8 },
            { at: 41, hazard: 'crossfire', n: 1 },
            { at: 44, f: 'wall', type: 'dart', n: 9 },
            { at: 48, f: 'dive', type: 'wasp', n: 4 },
            { at: 48.5, f: 'dive', type: 'wasp', n: 4, mirror: true, flipY: true },
            { at: 52, hazard: 'crossfire', n: 2, flip: true },
            { at: 55, f: 'vee', type: 'wasp', n: 5 },
            { at: 59, f: 'helix', type: 'dart', n: 10 },
            { at: 63, f: 'sweep', type: 'dart', n: 5, dy: 6 },
            // more on top of the hazard: these sections were the emptiest (plan_1 §2.2)
            { at: 4, f: 'sweep', type: 'dart', n: 5, dy: 8 },
            { at: 19.5, f: 'sweep', type: 'dart', n: 5, mirror: true, dy: -8 },
            { at: 31.5, f: 'vee', type: 'wasp', n: 4, dy: 6 },
            { at: 41.5, f: 'overtake', type: 'dart', n: 4 },
            { at: 52.5, f: 'sweep', type: 'wasp', n: 4, mirror: true, dy: 8 },
          ],
        },
      ],
    },
    {
      name: 'ION STORM',
      ramp: { fire: 1.1, rate: 1.05, minAlive: 4, maxCharging: 5 },
      sections: [
        {
          id: 'storm', from: 's3', to: 's4', duration: 65, rocks: { kind: 'dark', target: 2 }, lightning: true,
          waves: [
            { at: 1.5, f: 'vee', type: 'dart', n: 5, weapon: 'burst3' },
            { at: 3, intro: 'strike' },
            { at: 4, hazard: 'strike', n: 1 },
            { at: 7, f: 'sweep', type: 'wasp', n: 4 },
            { at: 10, hazard: 'strike', n: 3 },
            { at: 13, f: 'helix', type: 'dart', n: 8 },
            { at: 17, hazard: 'strike', n: 3, spread: 14 },
            { at: 20, f: 'overtake', type: 'dart', n: 4 },
            { at: 23, f: 'snake', type: 'dart', n: 5, flipY: true },
            { at: 30, hazard: 'strike', n: 5, gap: 0.4 },
            { at: 33, f: 'hold', type: 'hammer', n: 1, weapon: 'shells' },
            { at: 37, hazard: 'strike', n: 3 },
            { at: 40, f: 'ring', type: 'wasp', n: 6 },
            { at: 44, hazard: 'strike', n: 5 },
            { at: 47, f: 'wall', type: 'dart', n: 9 },
            { at: 51, hazard: 'strike', n: 3 },
            { at: 53, f: 'dive', type: 'wasp', n: 4 },
            { at: 57, hazard: 'strike', n: 5, spread: 12 },
            { at: 60, f: 'vee', type: 'wasp', n: 5 },
            // more on top of the hazard: these sections were the emptiest (plan_1 §2.2)
            { at: 10.5, f: 'sweep', type: 'dart', n: 5, dy: 8 },
            { at: 17.5, f: 'vee', type: 'dart', n: 5, weapon: 'burst3', dy: -6 },
            { at: 30.5, f: 'overtake', type: 'wasp', n: 4 },
            { at: 37.5, f: 'sweep', type: 'wasp', n: 4, mirror: true, dy: 8 },
            { at: 44.5, f: 'helix', type: 'dart', n: 6 },
          ],
        },
      ],
    },
    {
      name: 'THE SHROUD',
      ramp: { fire: 1.15, rate: 1.1, minAlive: 4, maxCharging: 5 },
      sections: [
        {
          id: 'shroud', from: 's4', to: 's5', duration: 70, rocks: { kind: 'dark', target: 3 }, fog: 0.0026,
          waves: [
            { at: 1.5, f: 'sweep', type: 'dart', n: 5 },
            { at: 3, intro: 'shade' },
            { at: 4, f: 'vee', type: 'shade', n: 3 },
            { at: 8, f: 'helix', type: 'dart', n: 8 },
            { at: 12, f: 'sweep', type: 'shade', n: 4, dy: 6 },
            { at: 16, f: 'overtake', type: 'wasp', n: 4 },
            { at: 20, hazard: 'strike', n: 3 },
            { at: 22, f: 'snake', type: 'wasp', n: 5, red: true },
            { at: 29, f: 'hold', type: 'hammer', n: 1, weapon: 'laser', drop: 'bomb' },
            { at: 32, f: 'vee', type: 'shade', n: 5 },
            { at: 36, f: 'ring', type: 'dart', n: 8, roll: PI },
            { at: 40, f: 'sweep', type: 'shade', n: 4, mirror: true, dy: -6 },
            { at: 44, hazard: 'crossfire', n: 1 },
            { at: 47, f: 'wall', type: 'dart', n: 9 },
            { at: 51, f: 'dive', type: 'shade', n: 4 },
            { at: 55, f: 'helix', type: 'wasp', n: 6 },
            { at: 59, f: 'vee', type: 'shade', n: 5 },
            { at: 63, f: 'sweep', type: 'dart', n: 5 },
          ],
        },
      ],
    },
    {
      name: 'BATTLESHIP',
      ramp: { fire: 1.1, rate: 1.05, minAlive: 4, maxCharging: 6 },
      sections: [
        {
          id: 'battleship', from: 's5', to: 's6', duration: 70, song: 'boss', rocks: { kind: 'crystal', target: 2 },
          waves: [
            { at: 0.3, msg: 'WARNING\nBATTLESHIP', warn: true, msgT: 2.4 },
            { at: 2, intro: 'battleship' },
            { at: 2, hulk: 'battleship', x: 52, y: -38, z: -520, speed: 12 },
            { at: 8, f: 'sweep', type: 'dart', n: 5, dy: 10 },
            { at: 14, f: 'vee', type: 'shade', n: 4, dy: 8 },
            { at: 20, f: 'helix', type: 'dart', n: 8 },
            { at: 26, f: 'snake', type: 'dart', n: 5, dy: 10 },
            { at: 33, f: 'overtake', type: 'wasp', n: 4 },
            { at: 38, hazard: 'crossfire', n: 2 },
            { at: 42, f: 'sweep', type: 'wasp', n: 4, mirror: true, dy: 10 },
            { at: 48, f: 'dive', type: 'dart', n: 4 },
            { at: 54, f: 'vee', type: 'shade', n: 5 },
            { at: 60, f: 'wall', type: 'dart', n: 9 },
            // more on top of the hazard: these sections were the emptiest (plan_1 §2.2)
            { at: 5, f: 'vee', type: 'dart', n: 5, weapon: 'burst3', dy: 6 },
            { at: 11, f: 'sweep', type: 'wasp', n: 4, mirror: true, dy: -8 },
            { at: 17, f: 'overtake', type: 'dart', n: 4 },
            { at: 29.5, f: 'sweep', type: 'dart', n: 5, mirror: true, dy: -6 },
            { at: 45, f: 'vee', type: 'wasp', n: 4, dy: 8 },
          ],
        },
      ],
    },
    {
      name: 'THE EYE',
      ramp: { fire: 1.2, rate: 1.15, minAlive: 5, maxCharging: 6 },
      sections: [
        {
          id: 'eye', from: 's6', to: 'boss', duration: 65, rocks: { kind: 'crystal', target: 3 }, fog: 0.0007,
          waves: [
            { at: 3, f: 'vee', type: 'dart', n: 3, weapon: 'burst3' },
            { at: 8, f: 'sweep', type: 'dart', n: 4 },
            { at: 16, f: 'helix', type: 'dart', n: 10 },
            { at: 17, f: 'overtake', type: 'wasp', n: 4 },
            { at: 17.5, f: 'overtake', type: 'wasp', n: 4, mirror: true },
            { at: 20, hazard: 'strike', n: 3 },
            { at: 21, f: 'vee', type: 'shade', n: 5 },
            { at: 24, f: 'hold', type: 'hammer', n: 1, weapon: 'missiles' },
            { at: 26, f: 'snake', type: 'wasp', n: 5, red: true },
            { at: 32, f: 'ring', type: 'dart', n: 8, roll: PI / 2, rot: PI / 2 },
            { at: 34, hazard: 'crossfire', n: 2 },
            { at: 36, f: 'mines', type: 'mine', n: 8 },
            { at: 40, f: 'sweep', type: 'shade', n: 4, dy: 8 },
            { at: 40.5, f: 'sweep', type: 'shade', n: 4, mirror: true, dy: -8 },
            { at: 44, f: 'wall', type: 'dart', n: 9 },
            { at: 46, hazard: 'strike', n: 5 },
            { at: 48, f: 'dive', type: 'wasp', n: 4 },
            { at: 48.5, f: 'dive', type: 'wasp', n: 4, mirror: true, flipY: true },
            { at: 52, f: 'helix', type: 'shade', n: 6 },
            { at: 55, f: 'hold', type: 'hammer', n: 1, weapon: 'laser', drop: 'shield' },
            { at: 58, f: 'vee', type: 'wasp', n: 5 },
            { at: 61, f: 'sweep', type: 'dart', n: 5, dy: 6 },
          ],
        },
      ],
    },
    {
      name: 'FLAGSHIP',
      ramp: { fire: 1.2, rate: 0.95, minAlive: 4, maxCharging: 5 },
      sections: [
        {
          id: 'flagship', from: 'boss', to: 'dock', duration: 72, boss: 'flagship', bossTime: 64, rocks: { kind: 'crystal', target: 2 },
          waves: [
            { at: 2.4, msg: 'WARNING\nFLAGSHIP', warn: true, msgT: 2.4 },
            { at: 16, f: 'vee', type: 'shade', n: 4, dy: 12 },
            { at: 28, f: 'snake', type: 'dart', n: 5, dy: 12 },
            { at: 40, hazard: 'crossfire', n: 2 },
            { at: 46, f: 'sweep', type: 'wasp', n: 4, dy: -12 },
            { at: 56, hazard: 'strike', n: 3 },
          ],
        },
        { id: 'nebula-dock', from: 'dock', to: 'end', duration: 8, dock: true, waves: [] },
      ],
    },
  ],

  scenery: {
    carriers: [
      { at: 'start', ds: 170, offset: [-78, -44, 0] },
      { at: 'end', ds: 110, offset: [0, -4, 0], dock: true },
    ],
    fields: [
      { from: 'start', to: 's2', kind: 'crystal', count: 160, minD: 60, maxD: 340, scale: [2, 16], detail: 0, seed: 51 },
      { from: 's2', to: 's3', kind: 'crystal', count: 100, minD: 70, maxD: 340, scale: [2, 14], detail: 0, seed: 52 },
      { from: 's3', to: 's4', kind: 'dark', count: 140, minD: 60, maxD: 320, scale: [2, 16], detail: 1, seed: 53 },
      { from: 's4', to: 's5', kind: 'dark', count: 160, minD: 50, maxD: 280, scale: [2, 14], detail: 1, seed: 54 },
      { from: 's5', to: 's6', kind: 'crystal', count: 90, minD: 80, maxD: 300, scale: [2, 12], detail: 0, seed: 55 },
      { from: 's6', to: 'end', kind: 'crystal', count: 160, minD: 60, maxD: 340, scale: [2, 18], detail: 0, seed: 56 },
    ],
  },
  buildScenery,
};

location.sections = location.stages.flatMap((st, i) => st.sections.map((s) => Object.assign(s, { stage: i })));

export default location;
