// Location 1: the gas-giant run, as 8 stages along one continuous flight (ai/summary.md §4.1). The tutorial location.
// World: gas giant at the origin (radius 1500), rings in the XZ plane (2100–4000, gap 3000–3150), the sun at
// azimuth -0.75 and elevation 0.36. The rail launches near the moon, dives in to the ring gate, forks over the rings /
// through the gap, crosses the inner rings and a wreck field, meets the cruiser at dusk, skims the night side and
// meets the mothership as the sun rises, then docks.
//
// Route constraints (checked by `npm run rail`): the planet's shadow only covers stage 7 (and the dawn edge of 8);
// stages 1–6 keep the sun behind or beside the camera, so enemy ships are lit from the front; stages 3–6 fit in the
// ~3.2 rad of orbit that allows, which is why their rail speed is slow (30–40 u/s).
//
// Waves are keyed to section time in rail-local space, so they are identical on every route.
// Wave fields beyond the formation ones (src/game/formations.js):
//   lesson: id       start a lesson (src/game/tutor.js): hint, then practice, done check, repeats
//   practice: id     this wave is the practice for lesson id (repeated while the lesson is open)
//   fireChance: n    fixed share of members that fire (otherwise the type's default × the stage ramp)
//   drift: n         n slow corridor rocks drifting into the player's lane
//   gate: true       laser gate: two gunships flank the corridor and sweep a beam through it
//   intro: id        a one-line intro hint (not a lesson), shown once
//   hpMul, speedMul  tougher / slower members (lesson gunships survive long enough to show their weapon)
// Each stage's title card ("1-3 · THE RINGS") is shown automatically at its start (Game.onStageStart).

import { GasGiantBackdrop } from '../../render/planets.js';
import { CRUISER, MOTHERSHIP } from '../../game/bosses.js';
import { GAS_GIANT_SONGS } from '../../audio/songs.js';

const PI = Math.PI;
const P = (r, th, h, extra = {}) => ({ p: [r * Math.cos(th), h, r * Math.sin(th)], ...extra });

/** n points along a spiral from a = [r, th, h] (exclusive) to b (inclusive); the last one gets label `id`. */
function arc(a, b, n, id, rolls = []) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const e = t * t * (3 - 2 * t);
    out.push(P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * e, { roll: rolls[i - 1] || 0, ...(i === n && id ? { id } : {}) }));
  }
  return out;
}

const START = [12000, -1.95, 1500];
const S2 = [8200, -1.86, 1050];
const GATE = [4800, -1.67, 220];
const REJOIN = [2780, -1.205, 190];
const S5 = [2550, -0.35, 170];
const S6 = [2300, 0.6, 140];
const NIGHT = [1800, 1.5, 10];

const location = {
  id: 'gas-giant',
  index: 0,
  name: 'GAS GIANT RUN',
  subtitle: 'past the moon, through the rings, around the night side',
  backdrop: (loc, tier) => new GasGiantBackdrop(loc, tier),
  bossDefs: { cruiser: CRUISER, mothership: MOTHERSHIP },
  songs: GAS_GIANT_SONGS,
  planet: { radius: 1500, ringIn: 2100, ringOut: 4000, gapIn: 3000, gapOut: 3150 },
  sun: { azimuth: -0.75, elevation: 0.36 },
  moon: { radius: 520, position: [-3800, 2300, -6400] },

  path: [
    P(...START, { id: 'start' }),
    ...arc(START, S2, 6, 's2'),
    ...arc(S2, GATE, 6, 'gate', [0, 0.1, 0, -0.1, 0, 0]),
    P(4480, -1.63, 180),
    {
      fork: 'rings',
      gate: 'gate',
      axis: 'y',
      options: [
        {
          key: 'over',
          sign: 1,
          label: 'OVER THE RINGS',
          points: [
            P(4150, -1.585, 150),
            P(3800, -1.53, 135, { roll: -0.12 }),
            P(3480, -1.475, 132),
            P(3200, -1.41, 138, { roll: 0.1 }),
            P(2990, -1.345, 158),
            P(2880, -1.275, 175),
          ],
        },
        {
          key: 'gap',
          sign: -1,
          label: 'THROUGH THE GAP',
          points: [
            P(4210, -1.59, 70, { roll: 0.25 }),
            P(4030, -1.553, -55),
            P(3800, -1.513, -118),
            P(3520, -1.463, -130, { roll: -0.15 }),
            P(3265, -1.413, -112),
            P(3110, -1.37, -55),
            P(3075, -1.33, 20, { roll: 0.3 }),
            P(2990, -1.275, 120),
          ],
        },
      ],
    },
    P(...REJOIN, { id: 'rejoin' }),
    ...arc(REJOIN, S5, 4, 's5', [0.12, 0, -0.12, 0]),
    ...arc(S5, S6, 4, 's6', [0, 0.1, 0, 0]),
    ...arc(S6, NIGHT, 4, 'night', [0, -0.15, 0, 0]),
    P(1750, 1.66, 0),
    P(1745, 1.82, -8, { roll: 0.2 }),
    P(1750, 1.98, 0),
    P(1745, 2.14, 8, { roll: -0.2 }),
    P(1750, 2.3, 0),
    P(1755, 2.46, -5),
    P(1750, 2.62, 0, { roll: 0.15 }),
    P(1748, 2.78, 6),
    P(1752, 2.94, 0, { roll: -0.15 }),
    P(1755, 3.1, -4),
    P(1760, 3.3, 0, { id: 'boss' }),
    P(1770, 3.46, 10),
    P(1785, 3.62, 25),
    P(1800, 3.78, 40),
    P(1820, 3.94, 60),
    P(1840, 4.1, 80),
    P(1870, 4.26, 100),
    P(1900, 4.42, 120),
    P(1940, 4.62, 140, { id: 'dock' }),
    P(2000, 4.74, 165),
    P(2080, 4.84, 190, { id: 'end' }),
    P(2160, 4.93, 215),
  ],

  // ramp (§2.3): fire = share of members that fire (× the type's default), rate = volley rate multiplier,
  // minAlive = density director floor, maxCharging = most enemies charging their guns at once
  stages: [
    {
      name: 'LAUNCH',
      ramp: { fire: 0, rate: 0.5, minAlive: 2, maxCharging: 0 },
      sections: [
        {
          id: 'launch', from: 'start', to: 's2', duration: 65, rocks: { kind: 'rock', target: 2 },
          waves: [
            { at: 3, lesson: 'aim' },
            { at: 3.5, f: 'vee', type: 'dart', n: 3, practice: 'aim' },
            { at: 7, f: 'sweep', type: 'dart', n: 4, practice: 'aim' },
            { at: 11, f: 'sweep', type: 'dart', n: 4, mirror: true, dy: 6 },
            { at: 15.5, lesson: 'lead' },
            { at: 16, f: 'sweep', type: 'dart', n: 5, practice: 'lead' },
            { at: 20.5, f: 'sweep', type: 'dart', n: 5, mirror: true, dy: -5, practice: 'lead' },
            { at: 25, f: 'vee', type: 'dart', n: 5 },
            { at: 28.5, f: 'sweep', type: 'dart', n: 5, dy: -6 },
            { at: 33.5, lesson: 'red' },
            { at: 34, f: 'helix', type: 'dart', n: 5, red: true, speedMul: 0.65, practice: 'red' },
            { at: 43, f: 'vee', type: 'wasp', n: 3 },
            { at: 46.5, f: 'overtake', type: 'dart', n: 4 },
            { at: 50, f: 'sweep', type: 'wasp', n: 3, dy: 8 },
            { at: 53, f: 'wall', type: 'dart', n: 9 },
            { at: 57, f: 'sweep', type: 'dart', n: 4, dy: 7 },
            { at: 57, f: 'sweep', type: 'dart', n: 4, mirror: true, dy: -7 },
          ],
        },
      ],
    },
    {
      name: 'TRANSFER',
      ramp: { fire: 0.3, rate: 0.65, minAlive: 2, maxCharging: 2 },
      sections: [
        {
          id: 'transfer', from: 's2', to: 'gate', duration: 70, rocks: { kind: 'rock', target: 4 },
          waves: [
            { at: 3, lesson: 'move' },
            { at: 3.5, drift: 2, practice: 'move' },
            { at: 5, f: 'vee', type: 'dart', n: 3, fireChance: 0 },
            { at: 8.5, drift: 2, practice: 'move' },
            { at: 11, f: 'sweep', type: 'dart', n: 4, fireChance: 0 },
            { at: 16.5, lesson: 'aimed' },
            { at: 17, f: 'sweep', type: 'dart', n: 3, fireChance: 0.7, practice: 'aimed' },
            { at: 21.5, f: 'vee', type: 'dart', n: 3, fireChance: 0.7, practice: 'aimed' },
            { at: 26.5, f: 'helix', type: 'dart', n: 6 },
            { at: 30.5, f: 'overtake', type: 'dart', n: 4 },
            { at: 34, f: 'snake', type: 'dart', n: 5, mirror: true, speedMul: 0.7 },
            { at: 42, f: 'hold', type: 'hammer', n: 1, fireChance: 0, drop: 'shield' },
            { at: 43, f: 'sweep', type: 'dart', n: 5, dy: 6 },
            { at: 46.5, f: 'vee', type: 'dart', n: 5, dx: 8, dy: -6 },
            { at: 50.5, f: 'wall', type: 'dart', n: 9 },
            { at: 54.5, f: 'sweep', type: 'dart', n: 4, dy: 7 },
            { at: 54.5, f: 'sweep', type: 'dart', n: 4, mirror: true, dy: -7 },
            { at: 58, hint: 'CHOOSE YOUR PATH\n▲ stay high: over the rings      ▼ stay low: through the gap', hintT: 6.5 },
          ],
        },
      ],
    },
    {
      name: 'THE RINGS',
      ramp: { fire: 0.6, rate: 0.75, minAlive: 3, maxCharging: 2 },
      sections: [
        {
          id: 'rings', from: 'gate', to: 'rejoin', duration: 70, rocks: { kind: 'ice', target: 4 },
          waves: [
            { at: 2, f: 'vee', type: 'dart', n: 5 },
            { at: 5.5, lesson: 'roll' },
            { at: 6, f: 'sweep', type: 'dart', n: 6, roll: PI, practice: 'roll' },
            { at: 12.5, f: 'helix', type: 'dart', n: 8 },
            { at: 16.5, f: 'vee', type: 'dart', n: 5, roll: PI, practice: 'roll' },
            { at: 22, lesson: 'roll90' },
            { at: 22.5, f: 'sweep', type: 'dart', n: 6, rot: PI / 2, roll: PI / 2, practice: 'roll90' },
            { at: 29, f: 'overtake', type: 'dart', n: 4 },
            { at: 33, f: 'snake', type: 'dart', n: 5, roll: PI, speedMul: 0.75 },
            { at: 41.5, f: 'ring', type: 'dart', n: 8 },
            { at: 46, f: 'sweep', type: 'dart', n: 5, dy: 8 },
            { at: 46.5, f: 'sweep', type: 'dart', n: 5, mirror: true, dy: -8 },
            { at: 51, f: 'vee', type: 'dart', n: 5, roll: PI / 2, rot: PI / 2 },
            { at: 55, f: 'wall', type: 'dart', n: 9 },
            { at: 59.5, f: 'dive', type: 'dart', n: 4 },
          ],
        },
      ],
    },
    {
      name: 'INNER RINGS',
      ramp: { fire: 0.65, rate: 0.85, minAlive: 3, maxCharging: 3 },
      sections: [
        {
          id: 'inner', from: 'rejoin', to: 's5', duration: 70, rocks: { kind: 'ice', target: 4 },
          waves: [
            { at: 2, f: 'vee', type: 'dart', n: 5 },
            { at: 5.5, lesson: 'shells' },
            { at: 6, f: 'hold', type: 'hammer', n: 1, weapon: 'shells', drop: 'bomb', hpMul: 2, practice: 'shells' },
            { at: 12, f: 'sweep', type: 'dart', n: 5, dy: 8 },
            { at: 20.5, lesson: 'mines' },
            { at: 21, f: 'mines', type: 'mine', n: 6, practice: 'mines' },
            { at: 29, f: 'helix', type: 'dart', n: 8 },
            { at: 33, f: 'snake', type: 'dart', n: 5, red: true, speedMul: 0.8 },
            { at: 41, intro: 'pairs' },
            { at: 41, f: 'vee', type: 'wasp', n: 3 },
            { at: 45.5, f: 'sweep', type: 'wasp', n: 4, dy: 8 },
            { at: 49, f: 'hold', type: 'hammer', n: 1 },
            { at: 51, f: 'overtake', type: 'dart', n: 4 },
            { at: 55, f: 'mines', type: 'mine', n: 6 },
            { at: 59, f: 'dive', type: 'wasp', n: 4 },
          ],
        },
      ],
    },
    {
      name: 'WRECK FIELD',
      ramp: { fire: 0.9, rate: 0.9, minAlive: 3, maxCharging: 3 },
      sections: [
        {
          id: 'wreck', from: 's5', to: 's6', duration: 70, rocks: { kind: 'metal', target: 3 },
          waves: [
            { at: 1.5, f: 'overtake', type: 'wasp', n: 4 },
            { at: 1.5, f: 'overtake', type: 'wasp', n: 4, mirror: true },
            { at: 6, lesson: 'missiles' },
            { at: 6.5, f: 'hold', type: 'hammer', n: 1, dx: -10, weapon: 'missiles', drop: 'shield', hpMul: 2, practice: 'missiles' },
            { at: 14, f: 'helix', type: 'dart', n: 8 },
            { at: 19.5, lesson: 'laser' },
            { at: 20, f: 'hold', type: 'hammer', n: 1, dx: 12, mirror: true, weapon: 'laser', hpMul: 2, practice: 'laser' },
            { at: 27, f: 'sweep', type: 'dart', n: 5, dy: -6 },
            { at: 33, lesson: 'evade' },
            { at: 33.5, gate: true, practice: 'evade' },
            { at: 42, f: 'snake', type: 'wasp', n: 5, speedMul: 0.8 },
            { at: 48, f: 'hold', type: 'hammer', n: 1, dx: -12, weapon: 'laser', drop: 'laser' },
            { at: 50, f: 'vee', type: 'wasp', n: 5 },
            { at: 55, f: 'wall', type: 'dart', n: 9 },
            { at: 59, f: 'sweep', type: 'dart', n: 5, dy: 8 },
          ],
        },
      ],
    },
    {
      name: 'CRUISER',
      ramp: { fire: 0.8, rate: 0.9, minAlive: 3, maxCharging: 3 },
      sections: [
        {
          id: 'cruiser', from: 's6', to: 'night', duration: 60, boss: 'cruiser', bossTime: 48, rocks: { kind: 'metal', target: 2 },
          waves: [
            { at: 2.4, msg: 'WARNING\nCRUISER', warn: true, msgT: 2.4 },
            { at: 3, lesson: 'boss' },
            { at: 13, f: 'sweep', type: 'dart', n: 4, dy: 10 },
            { at: 22, f: 'snake', type: 'dart', n: 5, dy: 9 },
            { at: 33, f: 'sweep', type: 'dart', n: 4, mirror: true, dy: -10 },
            { at: 41, f: 'dive', type: 'dart', n: 4 },
          ],
        },
      ],
    },
    {
      name: 'NIGHT SIDE',
      ramp: { fire: 0.95, rate: 1, minAlive: 4, maxCharging: 4 },
      sections: [
        {
          id: 'night', from: 'night', to: 'boss', duration: 75, rocks: { kind: 'dark', target: 3 }, lightning: true, calm: true,
          waves: [
            { at: 1.5, f: 'vee', type: 'wasp', n: 5 },
            { at: 4.5, f: 'ring', type: 'dart', n: 8, roll: PI },
            { at: 8.5, f: 'sweep', type: 'dart', n: 5, dy: 6 },
            { at: 9, f: 'sweep', type: 'dart', n: 5, rot: PI / 2, dx: 10 },
            { at: 12, f: 'hold', type: 'hammer', n: 1, roll: PI },
            { at: 12.5, f: 'helix', type: 'dart', n: 8 },
            { at: 17, f: 'snake', type: 'dart', n: 5, flipY: true },
            { at: 21, f: 'overtake', type: 'wasp', n: 4 },
            { at: 21, f: 'overtake', type: 'wasp', n: 4, mirror: true, flipY: true },
            { at: 25, f: 'mines', type: 'mine', n: 6 },
            { at: 28.5, f: 'vee', type: 'wasp', n: 5, roll: PI / 2, rot: PI / 2 },
            { at: 32, f: 'hold', type: 'hammer', n: 1, dx: -12, weapon: 'missiles' },
            { at: 34, f: 'sweep', type: 'dart', n: 6 },
            { at: 39, f: 'hold', type: 'hammer', n: 1, dx: 12, mirror: true, weapon: 'laser' },
            { at: 42, f: 'wall', type: 'dart', n: 9 },
            { at: 46, f: 'dive', type: 'wasp', n: 4 },
            { at: 46.5, f: 'dive', type: 'wasp', n: 4, mirror: true, flipY: true },
            { at: 50, f: 'helix', type: 'dart', n: 10 },
            { at: 54, f: 'snake', type: 'wasp', n: 5 },
            { at: 59, f: 'mines', type: 'mine', n: 8 },
            { at: 62.5, f: 'vee', type: 'wasp', n: 5, dy: 4 },
            { at: 63, f: 'sweep', type: 'dart', n: 5, dy: -8 },
          ],
        },
      ],
    },
    {
      name: 'MOTHERSHIP',
      ramp: { fire: 1, rate: 0.65, minAlive: 4, maxCharging: 4 },
      sections: [
        {
          id: 'mothership', from: 'boss', to: 'dock', duration: 75, boss: 'mothership', bossTime: 70,
          waves: [
            { at: 2.4, msg: 'WARNING\nMOTHERSHIP', warn: true, msgT: 2.4 },
            { at: 20, f: 'snake', type: 'dart', n: 5, dy: 12 },
            { at: 27, f: 'sweep', type: 'wasp', n: 3, dy: 12 },
            { at: 40, f: 'snake', type: 'dart', n: 5, mirror: true, dy: -10 },
            { at: 46, f: 'sweep', type: 'wasp', n: 3, mirror: true, dy: -12 },
          ],
        },
        { id: 'dock', from: 'dock', to: 'end', duration: 6, dock: true, waves: [] },
      ],
    },
  ],

  scenery: {
    carriers: [
      { at: 'start', ds: 170, offset: [-78, -44, 0] },
      { at: 'end', ds: 110, offset: [0, -4, 0], dock: true },
    ],
    fields: [
      { from: 'start', to: 's2', kind: 'rock', count: 200, minD: 48, maxD: 340, scale: [2, 24], detail: 1, seed: 11 },
      { from: 's2', to: 'gate', kind: 'rock', count: 220, minD: 48, maxD: 340, scale: [2, 22], detail: 1, seed: 15 },
      { from: 'gate', to: 'rejoin', kind: 'ice', count: 300, ringPlane: true, spread: 520, scale: [2, 16], detail: 1, seed: 12, perRoute: true },
      { from: 'rejoin', to: 's5', kind: 'ice', count: 240, ringPlane: true, spread: 480, scale: [2, 14], detail: 1, seed: 16 },
      { from: 's5', to: 's6', kind: 'metal', count: 170, minD: 40, maxD: 260, scale: [1.5, 9], detail: 0, seed: 13 },
      { from: 's6', to: 'night', kind: 'metal', count: 90, minD: 40, maxD: 260, scale: [1.5, 9], detail: 0, seed: 17 },
      { from: 'night', to: 'end', kind: 'dark', count: 110, minD: 50, maxD: 260, scale: [2, 14], detail: 1, seed: 14 },
    ],
    ringDust: { from: 'gate', to: 's5', count: 5000, spread: 700 },
    wrecks: { from: 's5', to: 's6', count: 11, minD: 95, maxD: 260, scale: [1.1, 2.3], seed: 21 },
  },
};

// Flat section list (the stage runner walks sections; each knows its stage index).
location.sections = location.stages.flatMap((st, i) => st.sections.map((s) => Object.assign(s, { stage: i })));

export default location;
