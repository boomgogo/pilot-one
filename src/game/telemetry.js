import { Vector3 } from 'three';
import { bulletHitR, missileHitR, rockHitR, shipHitR, BEHIND_SAFE } from './hitbox.js';
import { CORRIDOR } from './player.js';

// Telemetry + "what is on screen" for automated play (?bot / ?capture / ?telemetry).
// Nothing here runs in normal play: the game only creates a Telemetry when one of those parameters is set.

const _v = new Vector3();
const SAMPLE_DT = 0.25;

/** Project a rail-local point. Returns false when it is behind the camera. out = {x, y (CSS px), d (depth)} */
export function projectRail(game, x, y, z, out) {
  const r = game.r;
  _v.set(x, y, z).applyMatrix4(r.railRoot.matrixWorld).applyMatrix4(r.camera.matrixWorldInverse);
  const d = -_v.z;
  if (d < 0.5) return false;
  const f = r.height / 2 / Math.tan((r.camera.fov * Math.PI) / 360);
  out.x = r.width / 2 + (_v.x / d) * f;
  out.y = r.height / 2 - (_v.y / d) * f;
  out.d = d;
  out.f = f;
  return true;
}

const _o = { x: 0, y: 0, d: 0, f: 1 };
const onScreen = (g, o, margin = 0) => o.x >= -margin && o.y >= -margin && o.x <= g.r.width + margin && o.y <= g.r.height + margin;

export class Telemetry {
  constructor(game) {
    this.game = game;
    this.events = [];
    this.samples = [];
    this.sampleT = 0;
    this.t0 = performance.now();
  }

  get t() {
    return +this.game.time.toFixed(3);
  }

  event(ev, data = {}) {
    this.events.push({ t: this.t, ev, ...data });
  }

  /** Called once per rendered frame (after the camera matrices are current). */
  frame(dt) {
    const g = this.game;
    if (g.state !== 'playing') return;
    this.sampleT -= dt;
    if (this.sampleT > 0) return;
    this.sampleT += SAMPLE_DT;
    const c = countOnScreen(g);
    this.samples.push([
      this.t, g.stage.section.id, c.enemies, c.bullets, c.shells, c.missiles, c.beams, c.rocks, c.fields, c.bolts, c.streamPx, c.pickups,
      Math.floor(g.player.score), g.player.shield, g.player.lives, g.player.power, g.player.alive ? 1 : 0,
      +c.boltPx.toFixed(1), +c.bulletPx.toFixed(1), g.danger ? g.danger.list.filter((m) => m.red).length : 0, g.stageIdx + 1,
      ...probe(g),
      g.locIdx + 1,
    ]);
  }

  dump() {
    const out = {
      columns: ['t', 'section', 'enemies', 'bullets', 'shells', 'missiles', 'beams', 'rocks', 'fields', 'bolts', 'streamPx', 'pickups', 'score', 'shield', 'lives', 'power', 'alive', 'boltPx', 'bulletPx', 'redMarkers', 'stage', 'blocked', 'stillHit', 'blockers', 'blockersMarked', 'threats', 'loc'],
      events: this.events,
      samples: this.samples,
    };
    this.events = [];
    this.samples = [];
    return out;
  }
}

// ------------------------------------------------------------------------------------------------
// Dodge probe (ai/summary.md §11): for each of 8 move directions and standing still, fly the ship that
// way for 1 s (same acceleration, speed and corridor as player.js) against the straight-line path of every hazard,
// with the true hit radii (hitbox.js). Reports how many directions are blocked within 0.6 s, whether standing still
// is hit within 1 s, how many distinct hazards block a direction and how many of those the danger markers show right
// now (danger.js rule: crossing within 1.4 s, within R + 4 of the ship), and how many bullets will pass within 3
// units of the ship if it stays still (real threats).

const DIRS = [[0, 0], ...Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)])];
const PDT = 1 / 30;
const _hz = [];

function probe(g) {
  const p = g.player;
  if (!p.alive) return [0, 0, 0, 0, 0];
  // hazards: position, velocity (rail-local, incl. scroll for world-static rocks), hit radius
  let n = 0;
  const add = (x, y, z, vx, vy, vz, r) => {
    if (vz <= 0 && z < p.pos.z - 1) return; // moving away
    const h = (_hz[n++] ||= {});
    h.x = x;
    h.y = y;
    h.z = z;
    h.vx = vx;
    h.vy = vy;
    h.vz = vz;
    h.r = r;
    h.blocks = false;
  };
  const B = g.bullets;
  for (let i = 0; i < B.n; i++) add(B.p[i * 3], B.p[i * 3 + 1], B.p[i * 3 + 2], B.v[i * 3], B.v[i * 3 + 1], B.v[i * 3 + 2], bulletHitR(B.radius(i)));
  const M = g.missiles;
  for (let i = 0; i < M.n; i++) {
    if (M.owner[i] !== 1) continue;
    M.vel(i, _v);
    add(M.p[i * 3], M.p[i * 3 + 1], M.p[i * 3 + 2], _v.x, _v.y, _v.z, missileHitR());
  }
  const R = g.rocks;
  const sp = g.stage.speed;
  for (let i = 0; i < R.n; i++) add(R.p[i * 3], R.p[i * 3 + 1], R.p[i * 3 + 2], R.v[i * 3], R.v[i * 3 + 1], R.v[i * 3 + 2] + sp, rockHitR(R.radius(i)));
  for (const e of g.enemies.list) if (!e.armored && e.pos.z < p.pos.z - BEHIND_SAFE && e.vel.z > -5) add(e.pos.x, e.pos.y, e.pos.z, e.vel.x, e.vel.y, e.vel.z, shipHitR(e.def.r));
  let blocked = 0;
  let stillHit = 0;
  for (let d = 0; d < DIRS.length; d++) {
    let x = p.pos.x;
    let y = p.pos.y;
    let vx = p.vel.x;
    let vy = p.vel.y;
    const k = 1 - Math.exp(-9 * PDT);
    let first = Infinity;
    for (let t = PDT; t <= 1 + 1e-6 && first === Infinity; t += PDT) {
      vx += (DIRS[d][0] * 30 - vx) * k;
      vy += (DIRS[d][1] * 30 - vy) * k;
      x = Math.max(-CORRIDOR.x, Math.min(CORRIDOR.x, x + vx * PDT));
      y = Math.max(-CORRIDOR.y, Math.min(CORRIDOR.y, y + vy * PDT));
      for (let i = 0; i < n; i++) {
        const h = _hz[i];
        const dx = h.x + h.vx * t - x;
        const dy = h.y + h.vy * t - y;
        const dz = h.z + h.vz * t - p.pos.z;
        if (dx * dx + dy * dy + dz * dz < h.r * h.r) {
          first = t;
          if (d > 0 && t <= 0.6) h.blocks = true;
          break;
        }
      }
    }
    if (d === 0) stillHit = first <= 1 ? 1 : 0;
    else if (first <= 0.6) blocked++;
  }
  let blockers = 0;
  let marked = 0;
  for (let i = 0; i < n; i++) {
    const h = _hz[i];
    if (!h.blocks) continue;
    blockers++;
    const t = h.vz > 1e-3 ? (p.pos.z - h.z) / h.vz : Infinity;
    if (t > 0 && t <= 1.4 && Math.hypot(h.x + h.vx * t - p.pos.x, h.y + h.vy * t - p.pos.y) < h.r + 4) marked++;
  }
  let threats = 0;
  for (let i = 0; i < B.n; i++) {
    const vz = B.v[i * 3 + 2];
    if (vz <= 1e-3) continue;
    const t = (p.pos.z - B.p[i * 3 + 2]) / vz;
    if (t <= 0 || t > 3) continue;
    if (Math.hypot(B.p[i * 3] + B.v[i * 3] * t - p.pos.x, B.p[i * 3 + 1] + B.v[i * 3 + 1] * t - p.pos.y) < 3) threats++;
  }
  return [blocked, stillHit, blockers, marked, threats];
}

function countOnScreen(g) {
  const c = { enemies: 0, bullets: 0, shells: 0, missiles: 0, beams: 0, rocks: 0, fields: 0, bolts: 0, streamPx: 0, pickups: 0, boltPx: 0, bulletPx: 0 };
  const k720 = g.r.height / 720;
  for (const e of g.enemies.list) if (projectRail(g, e.pos.x, e.pos.y, e.pos.z, _o) && onScreen(g, _o)) c.enemies++;
  if (g.boss?.active) for (const p of g.boss.parts) if (p.alive && projectRail(g, p.world.x, p.world.y, p.world.z, _o) && onScreen(g, _o)) c.enemies++;
  const B = g.bullets;
  for (let i = 0; i < B.n; i++) {
    if (!projectRail(g, B.p[i * 3], B.p[i * 3 + 1], B.p[i * 3 + 2], _o) || !onScreen(g, _o)) continue;
    if (B.isShell?.(i)) c.shells++;
    else c.bullets++;
    // on-screen radius in px (the billboard's minimum size applies, see shots.js)
    c.bulletPx += Math.max((B.radius(i) * 1.6 * _o.f) / _o.d, (B.body?.material.uniforms?.uMinPx?.value || 0) * k720);
  }
  if (c.bullets + c.shells) c.bulletPx /= c.bullets + c.shells;
  const M = g.missiles;
  if (M) for (let i = 0; i < M.n; i++) if (M.owner[i] === 1 && projectRail(g, M.p[i * 3], M.p[i * 3 + 1], M.p[i * 3 + 2], _o) && onScreen(g, _o)) c.missiles++;
  c.beams = g.beams ? g.beams.list.length : g.boss?.beams?.length || 0;
  const R = g.rocks;
  for (let i = 0; i < R.n; i++) if (projectRail(g, R.p[i * 3], R.p[i * 3 + 1], R.p[i * 3 + 2], _o) && onScreen(g, _o)) c.rocks++;
  c.fields = g.fields ? g.fields.visibleInRange : 0;
  // player bolts: count on screen, and how far the stream reaches from the ship across the screen
  const S = g.shots;
  const p = g.player;
  const ship = projectRail(g, p.pos.x, p.pos.y, p.pos.z, _o) ? { x: _o.x, y: _o.y } : null;
  let reach = 0;
  for (let i = 0; i < S.n; i++) {
    if (!projectRail(g, S.p[i * 3], S.p[i * 3 + 1], S.p[i * 3 + 2], _o) || !onScreen(g, _o)) continue;
    c.bolts++;
    c.boltPx += Math.max((0.4 * _o.f) / _o.d, (S.bb.material.uniforms?.uMinPx?.value || 0) * k720) * 2;
    if (ship) reach = Math.max(reach, Math.hypot(_o.x - ship.x, _o.y - ship.y));
  }
  c.streamPx = c.bolts > 1 ? Math.round(reach) : 0;
  if (c.bolts) c.boltPx /= c.bolts;
  for (const it of g.pickups.items) if (projectRail(g, it.pos.x, it.pos.y, it.pos.z, _o) && onScreen(g, _o)) c.pickups++;
  return c;
}

/**
 * What a person can see right now, in screen pixels: used by the bot (scripts/play/bot.js).
 * Off-screen things are only reported through the HUD's edge arrows.
 */
export function viewSnapshot(g) {
  const r = g.r;
  const p = g.player;
  const snap = {
    t: g.time,
    state: g.state,
    w: r.width,
    h: r.height,
    f: r.height / 2 / Math.tan((r.camera.fov * Math.PI) / 360),
    sensitivity: g.input.sensitivity,
    ship: null,
    hud: { ...g.snap },
    laserT: p.laserT || 0,
    targets: [],
    hazards: [],
    markers: [],
    pickups: [],
    arrows: [],
    lead: g.leadPip ? { ...g.leadPip } : null,
  };
  if (p.alive && projectRail(g, p.pos.x, p.pos.y, p.pos.z, _o)) {
    snap.ship = { x: _o.x, y: _o.y, d: _o.d, hit: (0.7 * _o.f) / _o.d, pxPerUnit: _o.f / _o.d, cx: p.pos.x / 28, cy: p.pos.y / 16 };
  }
  const add = (list, x, y, z, radius, data) => {
    if (!projectRail(g, x, y, z, _o) || !onScreen(g, _o, 4)) return;
    const s = (radius * _o.f) / _o.d;
    if (s < 1.2 && list === snap.targets) return; // too small to notice
    list.push({ x: _o.x, y: _o.y, d: _o.d, s, ...data });
  };
  for (const e of g.enemies.list) {
    // a cloaked wasp is only a shimmer: hard to notice until it charges, is hit, or comes close (enemies.js draw)
    if (e.def.cloak && e.charge <= 0 && e.flash < 0.05 && e.pos.z < -110) continue;
    add(snap.targets, e.pos.x, e.pos.y, e.pos.z, e.def.r, {
      id: e.uid, kind: 'enemy', type: e.type, red: e.red, shielded: e.shielded && e.shieldLevel > 0.5, roll: e.roll, big: e.type === 'hammer', armored: e.armored,
    });
  }
  const b = g.boss;
  if (b?.active && b.state !== 'dying') {
    for (const q of b.parts) {
      if (!q.alive) continue;
      const open = !q.core || b.coreVulnerable();
      add(snap.targets, q.world.x, q.world.y, q.world.z, q.r, { id: 'boss-' + q.name, kind: 'boss', type: q.name, big: true, open });
    }
  }
  g.hulks?.forParts((x, y, z, r, q, h) => add(snap.targets, x, y, z, r, { id: `hulk-${h.w.id}-${q.name}`, kind: 'boss', type: q.name, big: true, open: true }));
  const R = g.rocks;
  for (let i = 0; i < R.n; i++) add(snap.targets, R.p[i * 3], R.p[i * 3 + 1], R.p[i * 3 + 2], R.radius(i), { id: 'rock-' + R.uid[i], kind: 'rock' });
  if (g.fields) g.fields.forVisible((x, y, z, rad, id) => add(snap.targets, x, y, z, rad, { id: 'field-' + id, kind: 'field' }));
  const B = g.bullets;
  for (let i = 0; i < B.n; i++) add(snap.hazards, B.p[i * 3], B.p[i * 3 + 1], B.p[i * 3 + 2], B.radius(i), { kind: B.isShell?.(i) ? 'shell' : 'bullet' });
  const M = g.missiles;
  if (M) for (let i = 0; i < M.n; i++) if (M.owner[i] === 1) add(snap.hazards, M.p[i * 3], M.p[i * 3 + 1], M.p[i * 3 + 2], 0.8, { kind: 'missile' });
  if (g.danger) {
    for (const m of g.danger.list) {
      if (!projectRail(g, m.x, m.y, m.z, _o)) continue;
      snap.markers.push({ x: _o.x, y: _o.y, r: (m.r * _o.f) / _o.d, red: m.red, t: m.t, kind: m.kind });
    }
  }
  for (const it of g.pickups.items) add(snap.pickups, it.pos.x, it.pos.y, it.pos.z, 1.5, { type: it.type });
  for (let i = 0; i < g.arrowN; i++) snap.arrows.push({ ...g.arrowBuf[i] });
  return snap;
}
