#!/usr/bin/env node
// No-crossing probe for the player's volleys (ai/summary.md §5.1): runs the game's own Player.fire() and
// PlayerShots.update() headless, on every power level, at random aim / roll / lock states, and checks that
//   1. no two bolts of one volley ever get closer than 90% of their spacing at the muzzle (they can't cross), and
//   2. on screen, the left-to-right order of the parallel bolts never swaps.
//
//   node scripts/play/probe-volleys.js [--volleys 2000] [--seed 1]
import { BufferGeometry, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { Player, POWER } from '../../src/game/player.js';
import { PlayerShots } from '../../src/game/shots.js';
import { makeRng } from '../../src/core/rng.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const VOLLEYS = +(args.volleys || 2000);
const rng = makeRng(+(args.seed || 1));
const DT = 1 / 60;

// the GLB's gun markers (assets-src/blender/build_ships.py: wingtips at ±2.3)
const model = { geometry: new BufferGeometry(), markers: { gun: [new Vector3(2.3, -0.05, -0.8), new Vector3(-2.3, -0.05, -0.8)], glow: [] } };
const mat = new MeshBasicMaterial();
mat.userData.uFlash = { value: 0 };
const target = { active: true, uid: 1, pos: new Vector3(), vel: new Vector3() };
const game = {
  time: 0,
  lockEnemy: null,
  fx: { add() {} },
  audio: null,
  tm: null,
  missiles: { launch() {} },
  missileTargets: () => [],
  beams: { player: null },
};
game.shots = new PlayerShots(game, 64);
const player = new Player(game, model, model, mat, mat);

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _d = new Vector3();
const _up = new Vector3();
const inv = new Quaternion();

function setup(level) {
  const p = player;
  p.power = level;
  p.pos.set((rng() * 2 - 1) * 26, (rng() * 2 - 1) * 15, 0);
  p.vel.set(0, 0, 0);
  p.yaw = (rng() * 2 - 1) * 0.9;
  p.pitch = (rng() * 2 - 1) * 0.6;
  p.roll = (rng() * 2 - 1) * Math.PI;
  for (let i = 0; i < 40; i++) p._camera(0.1); // settle the chase camera
  p.aimRay(_v, _d);
  const locked = rng() < 0.5;
  game.lockEnemy = locked ? target : null;
  if (locked) {
    // a target somewhere along the aim ray, drifting sideways (the lead point is where the volley is aimed)
    target.pos.copy(_v).addScaledVector(_d, 40 + rng() * 360);
    target.vel.set((rng() * 2 - 1) * 40, (rng() * 2 - 1) * 25, (rng() * 2 - 1) * 30);
    p.aimPoint.copy(target.pos);
  } else {
    p.aimPoint.copy(_v).addScaledVector(_d, 230);
  }
  // ship faces the aim point (Player.update)
  _d.subVectors(p.aimPoint, p.pos).normalize();
  _up.set(0, 1, 0).applyQuaternion(p.camQuat);
  _q.setFromRotationMatrix(_m.lookAt(p.pos, _v.addVectors(p.pos, _d), _up));
  p.shipQuat.copy(_q);
  for (let i = 0; i < 3; i++) p.dronePos[i % 2].copy(p.pos).addScaledVector(_v.set(i % 2 ? 4.8 : -4.8, 0.7, 0).applyQuaternion(p.camQuat), 1);
}

/** Camera-space x / depth of a rail point: screen x up to a constant (rolled camera frame). */
function screenX(x, y, z) {
  _v.set(x, y, z).sub(player.camPos).applyQuaternion(inv);
  return -_v.z > 0.5 ? _v.x / -_v.z : null;
}

const fails = [];
const perLevel = POWER.map(() => ({ volleys: 0, pairs: 0, minRatio: Infinity, swaps: 0 }));
for (let k = 0; k < VOLLEYS; k++) {
  const level = k % POWER.length;
  setup(level);
  const S = game.shots;
  S.clear();
  player.fire();
  const n = S.n;
  const parallel = [];
  for (let i = 0; i < n; i++) {
    const dx = S.v[i * 3];
    const dy = S.v[i * 3 + 1];
    const dz = S.v[i * 3 + 2];
    parallel.push([dx, dy, dz]);
  }
  const d0 = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d0.push([i, j, dist(i, j)]);
  inv.copy(player.camQuat).invert();
  const order0 = d0.map(([i, j]) => orderOf(i, j));
  const st = perLevel[level];
  st.volleys++;
  st.pairs += d0.length;
  let swapped = false;
  for (let step = 0; step < 2.6 / DT && S.n === n; step++) {
    target.pos.addScaledVector(target.vel, DT);
    S.update(DT);
    if (S.n !== n) break;
    d0.forEach(([i, j, a], q) => {
      const r = dist(i, j) / a;
      if (r < st.minRatio) st.minRatio = r;
      if (r < 0.9) fails.push({ level: POWER[level], step, i, j, ratio: +r.toFixed(3), locked: !!game.lockEnemy });
      const o = orderOf(i, j);
      if (order0[q] !== 0 && o !== 0 && o !== order0[q]) swapped = true;
    });
  }
  if (swapped) {
    st.swaps++;
    fails.push({ level: POWER[level], swap: true, locked: !!game.lockEnemy });
  }
}

function dist(i, j) {
  const p = game.shots.p;
  return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
}
/** Screen left/right order of bolts i and j: -1, 1, or 0 when too close to call (under ~1 px at 720p). */
function orderOf(i, j) {
  const p = game.shots.p;
  const a = screenX(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  const b = screenX(p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
  if (a === null || b === null || Math.abs(a - b) < 1 / 650) return 0;
  return Math.sign(a - b);
}

console.table(perLevel.map((s, i) => ({ level: POWER[i], volleys: s.volleys, pairs: s.pairs, minSpacingRatio: +s.minRatio.toFixed(3), screenSwaps: s.swaps })));
if (fails.length) {
  console.log(`FAIL: ${fails.length} violations, first:`, fails.slice(0, 5));
  process.exit(1);
}
console.log('PASS: no volley pair crosses or swaps sides');
