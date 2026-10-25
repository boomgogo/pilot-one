import { Vector3 } from 'three';
import { Billboards, SHAPE } from '../render/billboards.js';
import { PAL } from '../render/fx.js';
import { BEAM_HIT_R } from './hitbox.js';
import { segPointDist2 } from '../core/util.js';

// Firing model: almost nothing is instant. Every firing belongs to one of four speed classes (ai/summary.md §5.1).
//
//   slow     12–30 u/s   bombs, shells, mine shrapnel   big, pulsing; most can be shot down
//   medium   35–45 u/s   enemy bullets                  round warm orbs with a trail
//   fast     40→240 u/s  player bolts, missiles         streaks with trails
//   instant  beam        lasers                         enemy lasers are telegraphed: aim line + charge,
//                                                       aim frozen for the last FREEZE seconds
//
// Escape-time rule: every enemy firing leaves the player at least `escape` seconds between the moment it is
// visible (or telegraphed) and impact. Enforced in enemyCanFire().

export const FIRE_CLASS = {
  slow: { escape: 2.5 },
  medium: { escape: 1.3 },
  fast: { escape: 1.0 },
  instant: { escape: 0.8 },
};
export const MIN_FIRE_DIST = 60; // enemies only fire from at least this far ahead of the player
export const MAX_FIRE_DIST = 220; // fewer stale aimed shots drifting about (ai/summary.md §5.1)

const _v = new Vector3();
const _d = new Vector3();
const _o = new Vector3();

/** May an enemy at `pos` fire a projectile of the given class and speed right now? */
export function enemyCanFire(game, pos, speed, cls = 'medium') {
  const p = game.player;
  if (!p.alive || game.fireHeld) return false;
  if (pos.z > p.pos.z - MIN_FIRE_DIST || pos.z < p.pos.z - MAX_FIRE_DIST) return false;
  if (!game.onScreen(pos.x, pos.y, pos.z)) return false;
  if (speed > 0 && pos.distanceTo(p.pos) / speed < FIRE_CLASS[cls].escape) return false;
  return true;
}

// ------------------------------------------------------------------------------------------------
// Bomb: thrown forward, detonates after a short fuse (or on contact), then a shockwave expands and cancels
// enemy bullets as its front passes. Not instant: ~0.5 s flight + ~0.7 s wave.

const BOMB_SPEED = 80;
const BOMB_FUSE = 0.5;
const WAVE_TIME = 0.7;
const WAVE_R = 140;

export class Bombs {
  constructor(game) {
    this.game = game;
    this.orbs = [];
    this.waves = [];
    this.bb = new Billboards(24, { additive: true, renderOrder: 9, minPx: 3 });
    this.object = this.bb.mesh;
  }

  clear() {
    this.orbs.length = 0;
    this.waves.length = 0;
  }

  get active() {
    return this.orbs.length > 0 || this.waves.length > 0;
  }

  throw(pos, dir) {
    this.orbs.push({ p: pos.clone(), v: dir.clone().multiplyScalar(BOMB_SPEED), t: 0 });
  }

  update(dt) {
    const g = this.game;
    for (let k = this.orbs.length - 1; k >= 0; k--) {
      const o = this.orbs[k];
      o.t += dt;
      o.p.addScaledVector(o.v, dt);
      let touch = o.t >= BOMB_FUSE;
      if (!touch) for (const e of g.enemies.list) if (e.pos.distanceToSquared(o.p) < (e.def.r + 2) ** 2) touch = true;
      if (!touch && g.boss?.active && g.boss.pos.distanceToSquared(o.p) < (g.boss.def.bodyR * g.boss.def.scale) ** 2) touch = true;
      if (touch) {
        this.orbs.splice(k, 1);
        this.waves.push({ p: o.p.clone(), t: 0, r: 0, hit: new Set(), boss: false });
        g.fx.flash(o.p.x, o.p.y, o.p.z, 40, PAL.white, 0.25, 0.9);
        g.flashScreen(0.35);
        g.shakeCamera(1.6);
        g.audio?.bomb();
      }
    }
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const w = this.waves[k];
      w.t += dt;
      const u = Math.min(1, w.t / WAVE_TIME);
      w.r = WAVE_R * (1 - (1 - u) * (1 - u));
      this.sweep(w);
      if (u >= 1) this.waves.splice(k, 1);
    }
  }

  /** Everything inside the wave front: bullets are cancelled, enemies and rocks take damage once per wave. */
  sweep(w) {
    const g = this.game;
    const r2 = w.r * w.r;
    const B = g.bullets;
    let cancelled = 0;
    for (let i = B.n - 1; i >= 0; i--) {
      const dx = B.p[i * 3] - w.p.x;
      const dy = B.p[i * 3 + 1] - w.p.y;
      const dz = B.p[i * 3 + 2] - w.p.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (cancelled++ % 2 === 0) g.fx.add(B.p[i * 3], B.p[i * 3 + 1], B.p[i * 3 + 2], 0, 4, 0, 0.35, 0.8, 0.2, PAL.white, PAL.cyan, 0.9, SHAPE.FLARE);
      B.remove(i);
    }
    if (cancelled) {
      g.audio?.cancel();
      g.addScore(10 * cancelled, w.p.x, w.p.y + 4, w.p.z, false, cancelled > 2 ? `CANCEL +${10 * cancelled}` : null);
    }
    g.missiles.cancelEnemy(w.p, w.r);
    for (const e of [...g.enemies.list]) {
      if (w.hit.has(e) || e.pos.distanceToSquared(w.p) > r2) continue;
      w.hit.add(e);
      g.enemies.damage(e, 14, true);
    }
    const R = g.rocks;
    for (let i = R.n - 1; i >= 0; i--) {
      const dx = R.p[i * 3] - w.p.x;
      const dy = R.p[i * 3 + 1] - w.p.y;
      const dz = R.p[i * 3 + 2] - w.p.z;
      if (dx * dx + dy * dy + dz * dz < r2) R.damage(i, 99);
    }
    g.fields?.damageSphere(w.p, w.r, 99, w.hit);
    g.hulks?.bomb(w, 14);
    const b = g.boss;
    if (b?.active && !w.boss && b.pos.distanceTo(w.p) < w.r + b.def.bodyR * b.def.scale) {
      w.boss = true;
      b.bomb(22);
    }
  }

  draw(time) {
    const bb = this.bb;
    bb.begin();
    for (const o of this.orbs) {
      const pulse = 0.8 + 0.2 * Math.sin(time * 40);
      bb.push(o.p.x, o.p.y, o.p.z, o.v.x * 0.08, o.v.y * 0.08, o.v.z * 0.08, 0.6, 0.95, 1.0, 0.6, 1.4, SHAPE.TRAIL);
      bb.push(o.p.x, o.p.y, o.p.z, 0, 0, 0, 0.6, 0.95, 1.0, 0.95, 3.6 * pulse, SHAPE.GLOW);
      bb.push(o.p.x, o.p.y, o.p.z, 0, 0, 0, 1, 1, 1, 1, 2.6, SHAPE.FLARE);
    }
    for (const w of this.waves) {
      const u = w.t / WAVE_TIME;
      // the ring billboard peaks at 0.78 of its size: scale it so the bright ring is the actual wave front
      bb.push(w.p.x, w.p.y, w.p.z, 0, 0, 0, 0.55, 0.95, 1.0, 0.9 * (1 - u * u), w.r / 0.78, SHAPE.RING);
      bb.push(w.p.x, w.p.y, w.p.z, 0, 0, 0, 0.7, 0.9, 1.0, 0.35 * (1 - u), w.r * 0.9, SHAPE.SOFT);
    }
    bb.end();
  }
}

// ------------------------------------------------------------------------------------------------
// Lasers. Enemy lasers: aim line + charge (the escape time), aim frozen for the last FREEZE s, then a beam that
// hits instantly along its line for DUR s (optionally sweeping). The player's laser pickup draws here too.

const FREEZE = 0.4;
const FENCE_YS = [-16, -12, -8, -4, 0, 4, 8, 12, 16]; // laser-gate beams: no gap a ship fits through
const FENCE_CHARGE = 1.6;

export class Beams {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.bb = new Billboards(96, { additive: true, renderOrder: 9, minPx: 1.6 });
    this.object = this.bb.mesh;
    this.player = null; // {a: Vector3, b: Vector3, k: 0..1} while the player's laser is on
  }

  clear() {
    this.list.length = 0;
    this.player = null;
  }

  /** origin: () => Vector3 (follows the shooter); alive: () => bool (the beam stops when its shooter dies). */
  fire(owner, origin, { charge = 1.0, dur = 1.0, len = 420, sweep = 0, width = BEAM_HIT_R, alive = null } = {}) {
    const o = origin();
    _d.subVectors(this.game.player.pos, o).normalize();
    this.list.push({ owner, origin, alive, o: o.clone(), d: _d.clone(), t: 0, charge, dur, len, sweep, width });
    this.game.audio?.beamCharge();
  }

  /**
   * Laser gate: horizontal beams strung between two flanking gunships (a, b) across the whole corridor. After its
   * charge it can't be outrun as the posts close in on the player's plane: roll through it (or bomb).
   */
  fence(a, b) {
    this.list.push({ fence: true, owner: a, a, b, ua: a.uid, ub: b.uid, t: 0, charge: FENCE_CHARGE, dur: Infinity, width: BEAM_HIT_R, o: new Vector3(), d: new Vector3(1, 0, 0), len: 0, sweep: 0, dodged: false });
    this.game.audio?.beamCharge();
  }

  clearOwner(owner) {
    this.list = this.list.filter((b) => b.owner !== owner);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const b = this.list[k];
      b.t += dt;
      if (b.fence) {
        const A = b.a.pos;
        const Bp = b.b.pos;
        if (!b.a.active || b.a.uid !== b.ua || !b.b.active || b.b.uid !== b.ub || A.z > p.pos.z + 40) {
          this.list.splice(k, 1);
          continue;
        }
        b.o.copy(A);
        if (b.t > b.charge && p.alive) {
          for (const y of FENCE_YS) {
            if (segPointDist2(A.x, y, A.z, Bp.x, y, Bp.z, p.pos.x, p.pos.y, p.pos.z) < b.width * b.width) {
              this.touch(b, p.pos.z);
              break;
            }
          }
        }
        continue;
      }
      if (b.alive && !b.alive()) {
        this.list.splice(k, 1);
        continue;
      }
      b.o.copy(b.origin());
      if (b.t < b.charge - FREEZE && p.alive) b.d.subVectors(p.pos, b.o).normalize();
      if (b.t > b.charge && b.sweep) b.d.applyAxisAngle(_v.set(0, 1, 0), b.sweep * dt);
      if (b.t > b.charge + b.dur + 0.25) {
        if (!b.hitPlayer) g.tutor?.onBeamMissed(false);
        this.list.splice(k, 1);
        continue;
      }
      if (b.t > b.charge && b.t < b.charge + b.dur && p.alive) {
        _o.copy(b.o).addScaledVector(b.d, b.len);
        if (segPointDist2(b.o.x, b.o.y, b.o.z, _o.x, _o.y, _o.z, p.pos.x, p.pos.y, p.pos.z) < b.width * b.width) this.touch(b, b.o.z);
      }
    }
  }

  /** Beam b is on the player: a hit, or a DODGE during an evasive roll. */
  touch(b, z) {
    const g = this.game;
    const p = g.player;
    if (p.evading) {
      if (!b.dodged) {
        b.dodged = true;
        g.onDodge(b.fence ? 'gate' : 'beam');
      }
      return;
    }
    if (p.hit(1, { src: b.fence ? 'gate' : 'beam', x: p.pos.x, y: p.pos.y, z, age: +b.t.toFixed(2), markedFor: +b.t.toFixed(2) })) b.hitPlayer = true;
  }

  /** Where beam b crosses the player's plane (rail z = pz), or null. Used by the danger markers. */
  crossing(b, pz, out) {
    if (b.fence || b.d.z <= 1e-3) return null;
    const s = (pz - b.o.z) / b.d.z;
    if (s < 0 || s > b.len) return null;
    return out.set(b.o.x + b.d.x * s, b.o.y + b.d.y * s, pz);
  }

  draw(time) {
    const bb = this.bb;
    bb.begin();
    for (const b of this.list) {
      if (b.fence) {
        this._drawFence(b, time);
        continue;
      }
      const lx = b.d.x * b.len;
      const ly = b.d.y * b.len;
      const lz = b.d.z * b.len;
      const ex = b.o.x + lx;
      const ey = b.o.y + ly;
      const ez = b.o.z + lz;
      if (b.t < b.charge) {
        // telegraph: flickering aim line + a charge glow growing at the muzzle
        const frozen = b.t > b.charge - FREEZE;
        const a = (frozen ? 0.75 : 0.4) + 0.25 * Math.sin(b.t * (frozen ? 70 : 35));
        bb.push(ex, ey, ez, lx, ly, lz, 1, 0.22, 0.3, a, frozen ? 0.3 : 0.18, SHAPE.BEAM);
        const c = b.t / b.charge;
        bb.push(b.o.x, b.o.y, b.o.z, 0, 0, 0, 1, 0.45, 0.5, 0.9, 1 + 3 * c, SHAPE.GLOW);
      } else {
        const k = Math.min(1, (b.t - b.charge) * 8) * Math.min(1, (b.charge + b.dur + 0.25 - b.t) * 4);
        const fl = 0.9 + 0.1 * Math.sin(time * 60);
        bb.push(ex, ey, ez, lx, ly, lz, 1, 0.3, 0.45, k, 2.4 * fl, SHAPE.BEAM);
        bb.push(ex, ey, ez, lx, ly, lz, 1, 0.9, 0.95, k, 0.9, SHAPE.BEAM);
      }
    }
    this._drawPlayer(time);
    bb.end();
  }

  _drawFence(b, time) {
    const bb = this.bb;
    const A = b.a.pos;
    const B = b.b.pos;
    const lx = B.x - A.x;
    const lz = B.z - A.z;
    const on = b.t > b.charge;
    const k = on ? Math.min(1, (b.t - b.charge) * 8) : 0.3 + 0.3 * Math.sin(b.t * (b.t > b.charge - FREEZE ? 70 : 30));
    const fl = 0.9 + 0.1 * Math.sin(time * 60);
    for (const y of FENCE_YS) {
      if (on) {
        bb.push(B.x, y, B.z, lx, 0, lz, 1, 0.3, 0.45, k * 0.85, 1.6 * fl, SHAPE.BEAM);
        bb.push(B.x, y, B.z, lx, 0, lz, 1, 0.9, 0.95, k, 0.5, SHAPE.BEAM);
      } else {
        bb.push(B.x, y, B.z, lx, 0, lz, 1, 0.22, 0.3, k, 0.16, SHAPE.BEAM);
      }
    }
    for (const P of [A, B]) bb.push(P.x, P.y, P.z, 0, 0, 0, 1, 0.45, 0.5, 0.9, 3 + (on ? 2 : 3 * Math.min(1, b.t / b.charge)), SHAPE.GLOW);
  }

  _drawPlayer(time) {
    const bb = this.bb;
    const pl = this.player;
    if (pl) {
      const lx = pl.b.x - pl.a.x;
      const ly = pl.b.y - pl.a.y;
      const lz = pl.b.z - pl.a.z;
      const fl = 0.85 + 0.15 * Math.sin(time * 90);
      bb.push(pl.b.x, pl.b.y, pl.b.z, lx, ly, lz, 0.35, 0.85, 1.0, pl.k, 1.2 * pl.k * fl, SHAPE.BEAM);
      bb.push(pl.b.x, pl.b.y, pl.b.z, lx, ly, lz, 0.9, 1.0, 1.0, pl.k, 0.4 * pl.k, SHAPE.BEAM);
      bb.push(pl.b.x, pl.b.y, pl.b.z, 0, 0, 0, 0.6, 0.95, 1.0, pl.k, 2.2 * fl, SHAPE.GLOW);
    }
  }
}
