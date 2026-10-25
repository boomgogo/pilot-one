import { Vector3 } from 'three';
import { Billboards, SHAPE } from '../render/billboards.js';
import { bulletHitR, missileHitR, PLAYER_CORE, rockHitR, shipHitR, BEHIND_SAFE } from './hitbox.js';

// Danger markers: the 3D dodge problem turned back into the classic 2D one (ai/summary.md §5.2).
//
// For every hazard moving toward the player, predict when it reaches the player's plane (rail z = player z) and
// where it crosses it. Draw a ring there with the *true* collision radius (hitbox.js):
//   red   = the ship's centre is inside the disc: it hits unless you move
//   amber = close
// Opacity rises as the impact gets closer; red markers get a faint tether back to the hazard.
// The player's hitbox core is drawn as a small ring on the ship whenever a marker is near.

const HORIZON = 1.4; // seconds of warning shown
const NEAR = 4; // also show hazards passing within this distance of the danger disc (amber: close call)
const MAX = 24;
const RED = [1.0, 0.18, 0.24];
const AMBER = [1.0, 0.68, 0.18];
const CATCH = [0.35, 1.0, 0.75]; // pickups: where to be to catch it
const PICKUP_R = 3.4; // pickups.js collection distance
const PICKUP_HORIZON = 3;
const _c = new Vector3();
const _v = new Vector3();

export class Danger {
  constructor(game) {
    this.game = game;
    this.enabled = true;
    this.pool = Array.from({ length: 96 }, () => ({ x: 0, y: 0, z: 0, r: 1, t: 1, red: false, kind: '', hx: 0, hy: 0, hz: 0 }));
    this.list = [];
    this.nearest = Infinity;
    // drawn on top of the ship: the markers sit in the ship's own plane
    this.bb = new Billboards(MAX * 2 + 2 + (game.debug.hitbox ? 256 : 0), { additive: false, depthTest: false, renderOrder: 20, minPx: 1 });
    this.object = this.bb.mesh;
  }

  _add(n, kind, hx, hy, hz, vx, vy, vz, R, horizon = HORIZON, near = NEAR) {
    const p = this.game.player.pos;
    if (vz <= 1e-3) return n;
    const t = (p.z - hz) / vz;
    if (t <= 0 || t > horizon) return n;
    const cx = hx + vx * t;
    const cy = hy + vy * t;
    const off = Math.hypot(cx - p.x, cy - p.y);
    if (off > R + near) return n;
    if (n >= this.pool.length) return n;
    const m = this.pool[n];
    m.x = cx;
    m.y = cy;
    m.z = p.z;
    m.r = R;
    m.t = t;
    m.red = off < R && kind !== 'pickup';
    m.warn = true;
    m.kind = kind;
    m.hx = hx;
    m.hy = hy;
    m.hz = hz;
    return n + 1;
  }

  /** Recompute markers for the current state (once per frame). Also stamps first-red times for telemetry. */
  update() {
    const g = this.game;
    const p = g.player;
    this.list.length = 0;
    this.nearest = Infinity;
    if (!p.alive || g.state !== 'playing') return;
    let n = 0;
    const B = g.bullets;
    for (let i = 0; i < B.n; i++) {
      const before = n;
      n = this._add(n, B.isShell(i) ? 'shell' : 'bullet', B.p[i * 3], B.p[i * 3 + 1], B.p[i * 3 + 2], B.v[i * 3], B.v[i * 3 + 1], B.v[i * 3 + 2], bulletHitR(B.radius(i)));
      if (n > before && B.markT[i] < 0) B.markT[i] = g.time; // first warning (amber or red)
    }
    for (const it of g.pickups.items) {
      n = this._add(n, 'pickup', it.pos.x, it.pos.y, it.pos.z, it.vel.x, it.vel.y, it.vel.z, PICKUP_R, PICKUP_HORIZON, 60);
    }
    const R = g.rocks;
    const sp = g.stage.speed;
    for (let i = 0; i < R.n; i++) {
      const i3 = i * 3;
      const before = n;
      n = this._add(n, 'rock', R.p[i3], R.p[i3 + 1], R.p[i3 + 2], R.v[i3], R.v[i3 + 1], R.v[i3 + 2] + sp, rockHitR(R.radius(i)));
      if (n > before && R.markT[i] < 0) R.markT[i] = g.time;
    }
    for (const e of g.enemies.list) {
      if (e.pos.z > p.pos.z - BEHIND_SAFE) continue;
      const before = n;
      n = this._add(n, 'ship', e.pos.x, e.pos.y, e.pos.z, e.vel.x, e.vel.y, e.vel.z, shipHitR(e.def.r));
      if (n > before && e.markT < 0) e.markT = g.time;
    }
    const M = g.missiles;
    for (let i = 0; i < M.n; i++) {
      if (M.owner[i] !== 1) continue;
      M.vel(i, _v);
      const before = n;
      n = this._add(n, 'missile', M.p[i * 3], M.p[i * 3 + 1], M.p[i * 3 + 2], _v.x, _v.y, _v.z, missileHitR());
      if (n > before && M.markT[i] < 0) M.markT[i] = g.time;
    }
    for (const b of g.beams.list) {
      if (b.fence) {
        // laser gate: it fills the corridor, so the marker is a big red ring on the ship as it closes in
        const vz = b.a.vel.z;
        const t = vz > 1e-3 ? (p.pos.z - b.a.pos.z) / vz : Infinity;
        if (t <= 0 || t > HORIZON || n >= this.pool.length) continue;
        const m = this.pool[n++];
        m.x = p.pos.x;
        m.y = p.pos.y;
        m.z = p.pos.z;
        m.r = 4.5;
        m.t = t;
        m.red = b.t > b.charge - 0.2 || t < 1;
        m.kind = 'gate';
        m.hx = p.pos.x;
        m.hy = p.pos.y;
        m.hz = b.a.pos.z;
        continue;
      }
      if (!g.beams.crossing(b, p.pos.z, _c) || n >= this.pool.length) continue;
      const m = this.pool[n++];
      m.x = _c.x;
      m.y = _c.y;
      m.z = _c.z;
      m.r = b.width;
      m.t = Math.max(0, b.charge - b.t);
      m.red = Math.hypot(_c.x - p.pos.x, _c.y - p.pos.y) < b.width;
      m.kind = 'beam';
      m.hx = b.o.x;
      m.hy = b.o.y;
      m.hz = b.o.z;
    }
    n = g.hazards.markers(this.pool, n, HORIZON);
    for (let i = 0; i < n; i++) this.list.push(this.pool[i]);
    if (this.list.length > MAX) {
      this.list.sort((a, b) => a.t - b.t);
      this.list.length = MAX;
    }
    for (const m of this.list) if (m.kind !== 'pickup') this.nearest = Math.min(this.nearest, Math.hypot(m.x - p.pos.x, m.y - p.pos.y) - m.r);
  }

  /** ?hitbox: every hazard's collision sphere (the distance at which it hits the player's centre). */
  _debugSpheres(bb) {
    const g = this.game;
    const G = [0.3, 1, 0.4];
    const B = g.bullets;
    for (let i = 0; i < B.n; i++) bb.push(B.p[i * 3], B.p[i * 3 + 1], B.p[i * 3 + 2], 0, 0, 0, G[0], G[1], G[2], 0.8, bulletHitR(B.radius(i)), SHAPE.MARKER);
    const R = g.rocks;
    for (let i = 0; i < R.n; i++) bb.push(R.p[i * 3], R.p[i * 3 + 1], R.p[i * 3 + 2], 0, 0, 0, G[0], G[1], G[2], 0.8, rockHitR(R.radius(i)), SHAPE.MARKER);
    for (const e of g.enemies.list) bb.push(e.pos.x, e.pos.y, e.pos.z, 0, 0, 0, G[0], G[1], G[2], 0.8, shipHitR(e.def.r), SHAPE.MARKER);
    const M = g.missiles;
    for (let i = 0; i < M.n; i++) if (M.owner[i] === 1) bb.push(M.p[i * 3], M.p[i * 3 + 1], M.p[i * 3 + 2], 0, 0, 0, G[0], G[1], G[2], 0.8, missileHitR(), SHAPE.MARKER);
  }

  draw(time) {
    const bb = this.bb;
    bb.begin();
    const g = this.game;
    const p = g.player;
    if (this.enabled && p.alive) {
      for (const m of this.list) {
        if (m.kind === 'pickup') {
          const k = 1 - m.t / PICKUP_HORIZON;
          bb.push(m.x, m.y, m.z, 0, 0, 0, CATCH[0], CATCH[1], CATCH[2], 0.25 + 0.5 * k, m.r * (0.9 + 0.1 * Math.sin(time * 8)), SHAPE.MARKER);
          continue;
        }
        const urgency = 1 - m.t / HORIZON;
        const c = m.red ? RED : AMBER;
        const pulse = m.red ? 0.85 + 0.15 * Math.sin(time * 24) : 1;
        bb.push(m.x, m.y, m.z, 0, 0, 0, c[0], c[1], c[2], (0.3 + 0.7 * urgency) * pulse * (m.red ? 1 : 0.5), m.r, SHAPE.MARKER);
        if (m.red) {
          // tether from the crossing point back to the hazard: where it comes from
          bb.push(m.hx, m.hy, m.hz, m.hx - m.x, m.hy - m.y, m.hz - m.z, c[0], c[1], c[2], 0.22 + 0.25 * urgency, 0.05, SHAPE.BEAM);
        }
      }
      // hitbox core on the ship, fading in as threats get near; flashing cyan while an evasive roll protects it
      const k = Math.max(0, Math.min(1, 1 - this.nearest / 10));
      if (p.evading) bb.push(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 0.3, 1.0, 1.0, 0.7 + 0.3 * Math.sin(time * 40), PLAYER_CORE * 1.8, SHAPE.MARKER);
      else if (k > 0.01) bb.push(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 0.8, 1.0, 1.0, 0.95 * k, PLAYER_CORE * 1.15, SHAPE.MARKER);
    }
    if (g.debug.hitbox) this._debugSpheres(bb);
    bb.end();
  }
}
