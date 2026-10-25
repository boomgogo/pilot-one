import { DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { Billboards, SHAPE } from './billboards.js';
import { makeRng } from '../core/rng.js';

// Particles and debris, all in rail-local space (children of railRoot).

const rng = makeRng(7);
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _axis = new Vector3();

export const PAL = {
  fire: [1.0, 0.62, 0.22],
  hot: [1.0, 0.92, 0.7],
  red: [1.0, 0.25, 0.2],
  cyan: [0.5, 0.92, 1.0],
  violet: [0.75, 0.45, 1.0],
  white: [1, 1, 1],
  pink: [1.0, 0.45, 0.85],
  green: [0.5, 1.0, 0.6],
  gold: [1.0, 0.8, 0.3],
};

export class FX {
  constructor(capacity, debrisCap, debrisGeometry, shipMaterial) {
    this.cap = capacity;
    this.n = 0;
    const F = (k) => new Float32Array(capacity * k);
    this.p = F(3);
    this.v = F(3);
    this.life = F(1);
    this.max = F(1);
    this.size = F(2);
    this.c0 = F(3);
    this.c1 = F(3);
    this.alpha = F(1);
    this.drag = F(1);
    this.shape = F(1);
    this.stretch = F(1);
    this.bb = new Billboards(capacity, { additive: true, renderOrder: 10 });
    this.object = this.bb.mesh;

    this.dCap = debrisCap;
    this.dn = 0;
    this.dp = new Float32Array(debrisCap * 3);
    this.dv = new Float32Array(debrisCap * 3);
    this.dAxis = new Float32Array(debrisCap * 3);
    this.dAng = new Float32Array(debrisCap);
    this.dSpin = new Float32Array(debrisCap);
    this.dLife = new Float32Array(debrisCap);
    this.dScale = new Float32Array(debrisCap);
    this.debris = new InstancedMesh(debrisGeometry, shipMaterial, debrisCap);
    this.debris.instanceMatrix.setUsage(DynamicDrawUsage);
    this.debris.count = 0;
    this.debris.frustumCulled = false;
    this.scale = 1; // reduced-flash option scales flash sizes
  }

  /** Add one particle. */
  add(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, alpha, shape = SHAPE.GLOW, drag = 0, stretch = 0) {
    let i = this.n;
    if (i >= this.cap) {
      // recycle a random old particle rather than dropping new effects
      i = (rng() * this.cap) | 0;
    } else {
      this.n++;
    }
    const i3 = i * 3;
    this.p[i3] = x;
    this.p[i3 + 1] = y;
    this.p[i3 + 2] = z;
    this.v[i3] = vx;
    this.v[i3 + 1] = vy;
    this.v[i3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i * 2] = s0;
    this.size[i * 2 + 1] = s1;
    this.c0.set(c0, i3);
    this.c1.set(c1 || c0, i3);
    this.alpha[i] = alpha;
    this.shape[i] = shape;
    this.drag[i] = drag;
    this.stretch[i] = stretch;
  }

  flash(x, y, z, size, color = PAL.hot, life = 0.12, alpha = 1) {
    this.add(x, y, z, 0, 0, 0, life, size * this.scale, size * 1.3 * this.scale, color, color, alpha, SHAPE.GLOW);
  }

  ring(x, y, z, size, color = PAL.cyan, life = 0.4, alpha = 0.9) {
    this.add(x, y, z, 0, 0, 0, life, size * 0.2, size, color, color, alpha, SHAPE.RING);
  }

  sparks(x, y, z, n, speed, color = PAL.hot, life = 0.35, dir = null, spread = 1, drift = 0) {
    for (let k = 0; k < n; k++) {
      _p.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      if (dir) _p.multiplyScalar(spread).add(dir).normalize();
      const sp = speed * (0.4 + rng() * 0.8);
      this.add(x, y, z, _p.x * sp, _p.y * sp, _p.z * sp + drift, life * (0.6 + rng() * 0.6), 0.22, 0.05, color, PAL.red, 1, SHAPE.GLOW, 2.5, 0.045);
    }
  }

  explosion(x, y, z, scale = 1, color = PAL.fire, drift = 30) {
    const s = scale;
    this.flash(x, y, z, 7 * s, PAL.hot, 0.16);
    this.ring(x, y, z, 9 * s, color, 0.45, 0.7);
    const balls = Math.round(6 + 5 * s);
    for (let k = 0; k < balls; k++) {
      _p.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).multiplyScalar(5 * s);
      this.add(x, y, z, _p.x, _p.y, _p.z + drift, 0.45 + rng() * 0.45 * s, 1.6 * s, 3.4 * s + rng() * 2 * s, PAL.hot, color, 0.85, SHAPE.GLOW, 1.2);
    }
    this.sparks(x, y, z, Math.round(10 + 8 * s), 26 * Math.sqrt(s), PAL.hot, 0.5, null, 1, drift);
    this.addDebris(x, y, z, Math.round(2 + 2 * s), 14 * Math.sqrt(s), drift, 0.6 + 0.3 * s);
  }

  bigExplosion(x, y, z, scale = 3) {
    this.explosion(x, y, z, scale, PAL.fire, 10);
    this.ring(x, y, z, 30 * scale, PAL.gold, 0.8, 0.6);
    this.flash(x, y, z, 30 * scale, PAL.hot, 0.35, 0.8);
  }

  warpIn(x, y, z, size = 5, color = PAL.cyan) {
    this.ring(x, y, z, size * 2.2, color, 0.5, 0.9);
    this.flash(x, y, z, size * 1.4, color, 0.25, 0.8);
  }

  deflect(x, y, z) {
    this.sparks(x, y, z, 4, 18, PAL.cyan, 0.25);
    this.flash(x, y, z, 1.6, PAL.cyan, 0.08, 0.8);
  }

  hit(x, y, z) {
    this.sparks(x, y, z, 3, 16, PAL.hot, 0.22);
    this.flash(x, y, z, 1.4, PAL.hot, 0.06, 0.8);
  }

  addDebris(x, y, z, n, speed, drift, scale) {
    for (let k = 0; k < n; k++) {
      let i = this.dn;
      if (i >= this.dCap) i = (rng() * this.dCap) | 0;
      else this.dn++;
      _p.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const sp = speed * (0.5 + rng());
      this.dp.set([x, y, z], i * 3);
      this.dv.set([_p.x * sp, _p.y * sp, _p.z * sp + drift], i * 3);
      _axis.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      this.dAxis.set([_axis.x, _axis.y, _axis.z], i * 3);
      this.dAng[i] = rng() * 6;
      this.dSpin[i] = (rng() * 2 - 1) * 8;
      this.dLife[i] = 1.0 + rng() * 0.8;
      this.dScale[i] = scale * (0.5 + rng());
    }
  }

  clear() {
    this.n = 0;
    this.dn = 0;
  }

  update(dt) {
    // particles
    let n = this.n;
    const p = this.p;
    const v = this.v;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        this._move(n, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const dr = this.drag[i];
      if (dr > 0) {
        const k = Math.exp(-dr * dt);
        v[i3] *= k;
        v[i3 + 1] *= k;
        v[i3 + 2] *= k;
      }
      p[i3] += v[i3] * dt;
      p[i3 + 1] += v[i3 + 1] * dt;
      p[i3 + 2] += v[i3 + 2] * dt;
    }
    this.n = n;

    // debris
    let dn = this.dn;
    for (let i = 0; i < dn; i++) {
      this.dLife[i] -= dt;
      if (this.dLife[i] <= 0) {
        dn--;
        this._moveDebris(dn, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      this.dp[i3] += this.dv[i3] * dt;
      this.dp[i3 + 1] += this.dv[i3 + 1] * dt;
      this.dp[i3 + 2] += this.dv[i3 + 2] * dt;
      this.dAng[i] += this.dSpin[i] * dt;
    }
    this.dn = dn;
  }

  _move(from, to) {
    if (from === to) return;
    for (const [arr, k] of [[this.p, 3], [this.v, 3], [this.c0, 3], [this.c1, 3], [this.size, 2]]) {
      for (let j = 0; j < k; j++) arr[to * k + j] = arr[from * k + j];
    }
    this.life[to] = this.life[from];
    this.max[to] = this.max[from];
    this.alpha[to] = this.alpha[from];
    this.drag[to] = this.drag[from];
    this.shape[to] = this.shape[from];
    this.stretch[to] = this.stretch[from];
  }

  _moveDebris(from, to) {
    if (from === to) return;
    for (const [arr, k] of [[this.dp, 3], [this.dv, 3], [this.dAxis, 3]]) {
      for (let j = 0; j < k; j++) arr[to * k + j] = arr[from * k + j];
    }
    this.dAng[to] = this.dAng[from];
    this.dSpin[to] = this.dSpin[from];
    this.dLife[to] = this.dLife[from];
    this.dScale[to] = this.dScale[from];
  }

  /** Write render buffers. */
  draw() {
    const bb = this.bb;
    bb.begin();
    for (let i = 0; i < this.n; i++) {
      const t = 1 - this.life[i] / this.max[i]; // 0 → 1
      const i3 = i * 3;
      const s = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
      const r = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      const g = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      const b = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      const a = this.alpha[i] * (1 - t * t);
      const st = this.stretch[i];
      bb.push(this.p[i3], this.p[i3 + 1], this.p[i3 + 2], this.v[i3] * st, this.v[i3 + 1] * st, this.v[i3 + 2] * st, r, g, b, a, s, this.shape[i]);
    }
    bb.end();

    const dm = this.debris;
    for (let i = 0; i < this.dn; i++) {
      const i3 = i * 3;
      _axis.set(this.dAxis[i3], this.dAxis[i3 + 1], this.dAxis[i3 + 2]);
      _q.setFromAxisAngle(_axis, this.dAng[i]);
      const sc = this.dScale[i] * Math.min(1, this.dLife[i] * 2);
      _s.set(sc, sc, sc);
      _p.set(this.dp[i3], this.dp[i3 + 1], this.dp[i3 + 2]);
      _m.compose(_p, _q, _s);
      dm.setMatrixAt(i, _m);
    }
    dm.count = this.dn;
    if (this.dn) dm.instanceMatrix.needsUpdate = true;
  }
}

/** Space dust streaks in rail-local space: the main cue for forward speed. */
export class Dust {
  constructor(count) {
    this.count = count;
    this.p = new Float32Array(count * 3);
    this.b = new Float32Array(count);
    for (let i = 0; i < count; i++) this._respawn(i, -420 + rng() * 440);
    this.bb = new Billboards(count, { additive: true, renderOrder: 3 });
    this.object = this.bb.mesh;
  }
  _respawn(i, z) {
    let x;
    let y;
    do {
      x = (rng() * 2 - 1) * 90;
      y = (rng() * 2 - 1) * 60;
    } while (Math.abs(x) < 4 && Math.abs(y) < 4);
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.b[i] = 0.25 + rng() * 0.75;
  }
  update(dt, speed, tint = 1) {
    const bb = this.bb;
    bb.begin();
    const stretch = Math.max(0.6, speed * 0.05);
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      this.p[i3 + 2] += speed * dt;
      if (this.p[i3 + 2] > 16) this._respawn(i, -420 - rng() * 40);
      const z = this.p[i3 + 2];
      const fade = Math.min(1, (z + 430) / 120);
      const a = 0.5 * this.b[i] * fade * tint;
      bb.push(this.p[i3], this.p[i3 + 1], z, 0, 0, stretch, 0.75, 0.85, 1.0, a, 0.11, SHAPE.GLOW);
    }
    bb.end();
  }
}
