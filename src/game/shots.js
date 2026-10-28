import { Quaternion, Vector3 } from 'three';
import { Billboards, SHAPE } from '../render/billboards.js';

// Struct-of-arrays projectile pools in rail-local space.
//
// Palette rule: anything that is yours is cyan / blue / white; anything that hurts you is warm (red, orange, magenta,
// yellow). Shapes differ too: the player's bolts are long streaks, enemy fire is round.

export const SHOT_SPEED = 260; // "fast" class: a visible stream, ~0.6 s to a target 150 units ahead
export const SHOT_LIFE = 2.5; // ~650 units of range: every asteroid in view is reachable
const TAIL_TIME = 0.04; // each bolt is a dash ~60% of the volley spacing: the stream reads as separate tracers
const MAGNET = 0.12; // rad/s: locked bolts bend slightly toward their target (a single bolt has to connect)
const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();

/** Player shots: fast streaks, tested as segments (prev → pos) against targets. */
export class PlayerShots {
  constructor(game, cap = 420) {
    this.game = game;
    this.cap = cap;
    this.n = 0;
    this.p = new Float32Array(cap * 3);
    this.prev = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.dmg = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.tgt = new Array(cap).fill(null); // locked enemy (bolts home slightly)
    this.tgtUid = new Uint32Array(cap);
    // Homing turns a whole volley as one rigid pattern, so its bolts never cross: each bolt carries the volley's
    // centre point c (where its centre line is now) and its spread dv (its velocity minus the centre line's).
    // Only the centre line steers toward the target; the same rotation turns every bolt's velocity.
    this.c = new Float32Array(cap * 3);
    this.dv = new Float32Array(cap * 3);
    this.bb = new Billboards(cap, { additive: true, renderOrder: 6, minPx: 2, minLen: 28 });
    this.object = this.bb.mesh;
  }
  /** (cx, cy, cz): the volley's centre point (its origin); (dvx, dvy, dvz): this bolt's spread off the centre line. */
  spawn(x, y, z, vx, vy, vz, dmg = 1, kind = 0, life = SHOT_LIFE, target = null, cx = x, cy = y, cz = z, dvx = 0, dvy = 0, dvz = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const i3 = i * 3;
    this.p[i3] = this.prev[i3] = x;
    this.p[i3 + 1] = this.prev[i3 + 1] = y;
    this.p[i3 + 2] = this.prev[i3 + 2] = z;
    this.v[i3] = vx;
    this.v[i3 + 1] = vy;
    this.v[i3 + 2] = vz;
    this.life[i] = life;
    this.age[i] = 0;
    this.dmg[i] = dmg;
    this.kind[i] = kind;
    this.tgt[i] = target;
    this.tgtUid[i] = target ? target.uid : 0;
    this.c[i3] = cx;
    this.c[i3 + 1] = cy;
    this.c[i3 + 2] = cz;
    this.dv[i3] = dvx;
    this.dv[i3 + 1] = dvy;
    this.dv[i3 + 2] = dvz;
  }
  remove(i) {
    const last = --this.n;
    if (i === last) {
      this.tgt[i] = null;
      return;
    }
    for (let k = 0; k < 3; k++) {
      this.p[i * 3 + k] = this.p[last * 3 + k];
      this.prev[i * 3 + k] = this.prev[last * 3 + k];
      this.v[i * 3 + k] = this.v[last * 3 + k];
      this.c[i * 3 + k] = this.c[last * 3 + k];
      this.dv[i * 3 + k] = this.dv[last * 3 + k];
    }
    this.life[i] = this.life[last];
    this.age[i] = this.age[last];
    this.dmg[i] = this.dmg[last];
    this.kind[i] = this.kind[last];
    this.tgt[i] = this.tgt[last];
    this.tgtUid[i] = this.tgtUid[last];
    this.tgt[last] = null;
  }
  update(dt) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.remove(i);
        continue;
      }
      this.age[i] += dt;
      const i3 = i * 3;
      const e = this.tgt[i];
      if (e) {
        if (!e.active || e.uid !== this.tgtUid[i]) this.tgt[i] = null;
        else this._steer(i3, e.pos, MAGNET * dt);
      }
      const v = this.v;
      const dv = this.dv;
      this.prev[i3] = this.p[i3];
      this.prev[i3 + 1] = this.p[i3 + 1];
      this.prev[i3 + 2] = this.p[i3 + 2];
      this.p[i3] += v[i3] * dt;
      this.p[i3 + 1] += v[i3 + 1] * dt;
      this.p[i3 + 2] += v[i3 + 2] * dt;
      this.c[i3] += (v[i3] - dv[i3]) * dt;
      this.c[i3 + 1] += (v[i3 + 1] - dv[i3 + 1]) * dt;
      this.c[i3 + 2] += (v[i3 + 2] - dv[i3 + 2]) * dt;
    }
  }
  /**
   * Turn bolt i's volley toward target point T by at most `maxAng` radians: the centre line (velocity v - dv, at c)
   * rotates toward T, and the same rotation is applied to the spread dv. Every bolt of a volley computes the same
   * rotation, so the pattern turns rigidly.
   */
  _steer(i3, T, maxAng) {
    const v = this.v;
    const dv = this.dv;
    const c = this.c;
    _a.set(v[i3] - dv[i3], v[i3 + 1] - dv[i3 + 1], v[i3 + 2] - dv[i3 + 2]);
    const sp = _a.length();
    _b.set(T.x - c[i3], T.y - c[i3 + 1], T.z - c[i3 + 2]);
    const dl = _b.length();
    if (dl < 1e-3 || sp < 1e-3) return;
    _a.divideScalar(sp);
    _b.divideScalar(dl);
    const cos = _a.dot(_b);
    if (cos < 0.2) return; // target is behind the volley: let it go
    const ang = Math.acos(Math.min(1, cos));
    if (ang < 1e-6) return;
    const k = ang <= maxAng ? 1 : maxAng / ang;
    _b.sub(_a).multiplyScalar(k).add(_a).normalize();
    _q.setFromUnitVectors(_a, _b);
    _a.set(dv[i3], dv[i3 + 1], dv[i3 + 2]).applyQuaternion(_q);
    dv[i3] = _a.x;
    dv[i3 + 1] = _a.y;
    dv[i3 + 2] = _a.z;
    v[i3] = _b.x * sp + _a.x;
    v[i3 + 1] = _b.y * sp + _a.y;
    v[i3 + 2] = _b.z * sp + _a.z;
  }
  clear() {
    this.n = 0;
    this.tgt.fill(null);
  }
  draw() {
    const bb = this.bb;
    bb.begin();
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      // kind 0: the main stream; 1: drone bolts and 2: FULL's cone, the outer streams, thin and dim (looks only)
      const kind = this.kind[i];
      const fade = Math.min(1, this.life[i] / 0.3); // shrink and fade instead of popping at the end of range
      const k = TAIL_TIME * (0.4 + 0.6 * fade) * Math.min(1, this.age[i] / TAIL_TIME); // no tail behind the muzzle
      bb.push(this.p[i3], this.p[i3 + 1], this.p[i3 + 2], this.v[i3] * k, this.v[i3 + 1] * k, this.v[i3 + 2] * k,
        kind === 1 ? 0.62 : 0.45, kind === 1 ? 0.7 : 0.9, 1.0, kind ? fade * 0.55 : fade, (kind ? 0.24 : 0.4) * (0.5 + 0.5 * fade), SHAPE.BOLT);
    }
    bb.end();
  }
}

// Enemy projectile kinds. size = visual radius, r = collision radius.
// Classes (src/game/weapons.js): medium = aimed/spread/fan/ring/heavy, slow = shell/orb.
export const BULLET = { AIMED: 0, SPREAD: 1, FAN: 2, RING: 3, HEAVY: 4, SHELL: 5, ORB: 6 };
const KINDS = [
  { col: [1.0, 0.5, 0.2], size: 1.05, r: 0.62 }, // aimed: orange
  { col: [1.0, 0.3, 0.85], size: 1.05, r: 0.62 }, // spread: magenta
  { col: [1.0, 0.72, 0.18], size: 1.25, r: 0.72 }, // fan: amber
  { col: [1.0, 0.88, 0.3], size: 1.1, r: 0.62 }, // ring: yellow (was cyan, the player's colour)
  { col: [1.0, 0.22, 0.3], size: 1.5, r: 0.85 }, // boss heavy: red
  { col: [1.0, 0.36, 0.14], size: 2.3, r: 1.7, shell: true }, // shell: slow, big, blinking fuse, shootable
  { col: [1.0, 0.2, 0.22], size: 1.35, r: 0.78 }, // orb: slow mine shrapnel
];
export const SHELL_FUSE = 4;

/** Enemy fire: round, warm, with a short trail pointing back at the shooter, and a minimum on-screen size. */
export class EnemyBullets {
  constructor(game, cap = 420) {
    this.game = game;
    this.cap = cap;
    this.n = 0;
    this.p = new Float32Array(cap * 3);
    this.prev = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.markT = new Float32Array(cap); // first time a red danger marker was shown (-1: never)
    this.dodged = new Uint8Array(cap); // passed through the ship during an evasive roll
    this.body = new Billboards(cap, { additive: false, renderOrder: 8, minPx: 5 });
    this.halo = new Billboards(cap, { additive: true, renderOrder: 7, minPx: 11 });
    this.trail = new Billboards(cap, { additive: true, renderOrder: 7, minPx: 2.5, minLen: 12 });
    this.objects = [this.trail.mesh, this.halo.mesh, this.body.mesh];
  }
  spawn(x, y, z, vx, vy, vz, kind = 0) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const i3 = i * 3;
    this.p[i3] = this.prev[i3] = x;
    this.p[i3 + 1] = this.prev[i3 + 1] = y;
    this.p[i3 + 2] = this.prev[i3 + 2] = z;
    this.v[i3] = vx;
    this.v[i3 + 1] = vy;
    this.v[i3 + 2] = vz;
    this.life[i] = 8;
    this.age[i] = 0;
    this.kind[i] = kind;
    this.markT[i] = -1;
    this.dodged[i] = 0;
    return i;
  }
  radius(i) {
    return KINDS[this.kind[i]].r;
  }
  isShell(i) {
    return this.kind[i] === BULLET.SHELL;
  }
  remove(i) {
    const last = --this.n;
    if (i === last) return;
    for (let k = 0; k < 3; k++) {
      this.p[i * 3 + k] = this.p[last * 3 + k];
      this.prev[i * 3 + k] = this.prev[last * 3 + k];
      this.v[i * 3 + k] = this.v[last * 3 + k];
    }
    this.life[i] = this.life[last];
    this.age[i] = this.age[last];
    this.kind[i] = this.kind[last];
    this.markT[i] = this.markT[last];
    this.dodged[i] = this.dodged[last];
  }
  update(dt) {
    for (let i = this.n - 1; i >= 0; i--) {
      const i3 = i * 3;
      this.life[i] -= dt;
      this.age[i] += dt;
      const z = this.p[i3 + 2];
      if (this.life[i] <= 0 || z > 40 || z < -800 || Math.abs(this.p[i3]) > 220 || Math.abs(this.p[i3 + 1]) > 170) {
        this.remove(i);
        continue;
      }
      if (this.kind[i] === BULLET.SHELL && this.age[i] > SHELL_FUSE) {
        // fuse ran out: burst into a ring of medium bullets, unless that would be too close to dodge (escape rule)
        const x = this.p[i3];
        const y = this.p[i3 + 1];
        this.remove(i);
        const pp = this.game.player.pos;
        if (Math.hypot(x - pp.x, y - pp.y, z - pp.z) > 60) this.game.enemies.ring(x, y, z, 6, 36 * this.game.difficulty.bulletSpeed, this.game.time, BULLET.AIMED);
        this.game.fx.flash(x, y, z, 4, [1, 0.5, 0.2], 0.15);
        continue;
      }
      this.prev[i3] = this.p[i3];
      this.prev[i3 + 1] = this.p[i3 + 1];
      this.prev[i3 + 2] = z;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt;
      // a near miss: it crossed the ship's plane within a few units of the ship (the dodge lesson counts these)
      const pp = this.game.player.pos;
      if (z < pp.z && this.p[i3 + 2] >= pp.z && Math.hypot(this.p[i3] - pp.x, this.p[i3 + 1] - pp.y) < 14) this.game.tutor?.onBulletPassed(this.kind[i]);
    }
  }
  clear() {
    this.n = 0;
  }
  draw(time) {
    const b = this.body;
    const h = this.halo;
    const tr = this.trail;
    b.begin();
    h.begin();
    tr.begin();
    const pulse = 0.85 + 0.15 * Math.sin(time * 18);
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      const k = KINDS[this.kind[i]];
      const x = this.p[i3];
      const y = this.p[i3 + 1];
      const z = this.p[i3 + 2];
      let r = k.col[0];
      let g = k.col[1];
      let bl = k.col[2];
      if (k.shell) {
        // fuse: blinks faster as it runs out
        const left = Math.max(0.05, SHELL_FUSE - this.age[i]);
        const on = Math.sin(time * (6 + 30 / left)) > 0;
        if (on) {
          r = 1;
          g = 0.95;
          bl = 0.8;
        }
      }
      const s = k.size;
      const tk = Math.min(0.15, this.age[i]); // trail: ~0.15 s of travel, never behind the muzzle
      tr.push(x, y, z, this.v[i3] * tk, this.v[i3 + 1] * tk, this.v[i3 + 2] * tk, r, g, bl, 0.55, s * 0.55, SHAPE.TRAIL);
      h.push(x, y, z, 0, 0, 0, r, g, bl, 0.6 * pulse, s * 2.3, SHAPE.GLOW);
      b.push(x, y, z, 0, 0, 0, r, g, bl, 1, s, SHAPE.BULLET);
    }
    b.end();
    h.end();
    tr.end();
  }
}
