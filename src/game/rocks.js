import { DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { makeRng } from '../core/rng.js';
import { PAL } from '../render/fx.js';

// Shootable / collidable filler in the corridor: asteroids, ice chunks, wreck metal.
// Static in the world, so in rail space they stream toward the player at scroll speed.

// Rock kinds by index (Rocks.kind). Each location picks its kinds by name (section rocks, asteroid fields).
export const KINDS = ['rock', 'ice', 'metal', 'dark', 'ore', 'crystal', 'slag'];
/** Explosion colour of a rock kind (index). */
export const kindColor = (k) => (k === 1 ? PAL.cyan : k === 5 ? PAL.pink : PAL.fire);
const rng = makeRng(99);
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _a = new Vector3();

export class Rocks {
  constructor(game, geometries, material, cap = 48) {
    this.game = game;
    this.cap = cap;
    this.n = 0;
    this.p = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.axis = new Float32Array(cap * 3);
    this.ang = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.scale = new Float32Array(cap);
    this.hp = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.big = new Uint8Array(cap);
    this.uid = new Uint32Array(cap);
    this.born = new Float32Array(cap);
    this.markT = new Float32Array(cap); // first danger-marker warning (-1: never), for hit fairness telemetry
    this.arrive = new Float32Array(cap); // lesson rocks: game time they reach the player's plane (0: an ordinary rock)
    this.uidSeq = 0;
    this.meshes = KINDS.map((k) => {
      const m = new InstancedMesh(geometries[k], material, cap);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      return m;
    });
    this.objects = this.meshes;
    this.target = 0;
    this.kindIdx = 0;
    this.spawnT = 0;
  }

  setDensity(spec) {
    this.target = spec ? spec.target : 0;
    this.kindIdx = spec ? Math.max(0, KINDS.indexOf(spec.kind)) : 0;
  }

  clear() {
    this.n = 0;
  }

  spawn(x, y, z, vx, vy, vz, scale, big, kind) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    _a.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    this.axis.set([_a.x, _a.y, _a.z], i * 3);
    this.ang[i] = rng() * 6;
    this.spin[i] = (rng() * 2 - 1) * 1.2;
    this.scale[i] = scale;
    this.big[i] = big;
    this.hp[i] = big ? 5 : 2;
    this.kind[i] = kind;
    this.uid[i] = ++this.uidSeq;
    this.born[i] = this.game.time;
    this.markT[i] = -1;
    this.arrive[i] = 0;
    return i;
  }

  /**
   * Lesson rocks (wave {drift: n}): n slow rocks spread across the player's lane, each timed to cross the player's
   * plane a little apart, so their warning rings show up one by one around the ship.
   */
  drift(n, railSpeed) {
    const g = this.game;
    const pp = g.player.pos;
    for (let k = 0; k < n; k++) {
      const sx = pp.x + (rng() * 2 - 1) * 24;
      const sy = pp.y + (rng() * 2 - 1) * 14;
      const sz = -300;
      const T = 4.5 + k * 1.1; // seconds until it reaches the player's plane
      const i = this.spawn(sx, sy, sz, 0, 0, (pp.z - sz) / T - railSpeed, 1.9 + rng() * 0.5, 0, this.kindIdx);
      if (i < 0) continue;
      this.hp[i] = 8; // sturdy: the lesson is moving out of the way, not shooting it
      this.arrive[i] = g.time + T;
      this._steer(i, 1);
    }
  }

  /** The move lesson is done: lesson rocks still on their way stop following the ship. */
  unguide() {
    this.arrive.fill(0);
  }

  /** Lesson rocks drift toward where the ship is until shortly before they arrive (then it's up to you). */
  _steer(i, k) {
    const g = this.game;
    const left = this.arrive[i] - g.time;
    if (left < 1.6) return;
    const pp = g.player.pos;
    const i3 = i * 3;
    const vx = (pp.x - this.p[i3]) / left;
    const vy = (pp.y - this.p[i3 + 1]) / left;
    this.v[i3] += (vx - this.v[i3]) * k;
    this.v[i3 + 1] += (vy - this.v[i3 + 1]) * k;
  }

  remove(i) {
    const last = --this.n;
    if (i === last) return;
    for (let k = 0; k < 3; k++) {
      this.p[i * 3 + k] = this.p[last * 3 + k];
      this.v[i * 3 + k] = this.v[last * 3 + k];
      this.axis[i * 3 + k] = this.axis[last * 3 + k];
    }
    this.ang[i] = this.ang[last];
    this.spin[i] = this.spin[last];
    this.scale[i] = this.scale[last];
    this.hp[i] = this.hp[last];
    this.kind[i] = this.kind[last];
    this.big[i] = this.big[last];
    this.uid[i] = this.uid[last];
    this.born[i] = this.born[last];
    this.markT[i] = this.markT[last];
    this.arrive[i] = this.arrive[last];
  }

  radius(i) {
    return this.scale[i] * 0.95;
  }

  update(dt, railSpeed, active) {
    // keep a steady stream of filler at the section's density
    this.spawnT -= dt;
    if (active && this.n < this.target && this.spawnT <= 0) {
      this.spawnT = 0.35 + rng() * 0.5;
      const big = rng() < 0.38 ? 1 : 0;
      const sc = big ? 3.2 + rng() * 2.2 : 1.3 + rng() * 1.1;
      this.spawn((rng() * 2 - 1) * 40, (rng() * 2 - 1) * 26, -440 - rng() * 40, (rng() * 2 - 1) * 4, (rng() * 2 - 1) * 3, (rng() - 0.5) * 12, sc, big, this.kindIdx);
    }
    for (let i = this.n - 1; i >= 0; i--) {
      const i3 = i * 3;
      if (this.arrive[i]) this._steer(i, Math.min(1, dt * 3));
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += (this.v[i3 + 2] + railSpeed) * dt;
      this.ang[i] += this.spin[i] * dt;
      if (this.p[i3 + 2] > 40) this.remove(i);
    }
  }

  /** Damage rock i. Returns true if destroyed. */
  damage(i, amount) {
    const g = this.game;
    this.hp[i] -= amount;
    const x = this.p[i * 3];
    const y = this.p[i * 3 + 1];
    const z = this.p[i * 3 + 2];
    if (this.hp[i] > 0) {
      g.fx.hit(x, y, z);
      return false;
    }
    const big = this.big[i];
    const sc = this.scale[i];
    const kind = this.kind[i];
    this.remove(i);
    g.fx.explosion(x, y, z, big ? 1.4 : 0.7, kindColor(kind), 20);
    g.fx.addDebris(x, y, z, big ? 5 : 2, 10, 25, sc * 0.35);
    g.addScore(big ? 150 : 50, x, y, z);
    g.audio?.explosion(big ? 1 : 0.5);
    if (big) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + rng();
        this.spawn(x, y, z, Math.cos(a) * 9, Math.sin(a) * 9, (rng() - 0.5) * 8, 1.1 + rng() * 0.6, 0, kind);
      }
    }
    return true;
  }

  draw() {
    for (const m of this.meshes) m.count = 0;
    for (let i = 0; i < this.n; i++) {
      const mesh = this.meshes[this.kind[i]];
      const i3 = i * 3;
      _a.set(this.axis[i3], this.axis[i3 + 1], this.axis[i3 + 2]);
      _q.setFromAxisAngle(_a, this.ang[i]);
      const s = this.scale[i];
      _s.set(s, s, s);
      _p.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(mesh.count++, _m);
    }
    for (const m of this.meshes) {
      m.visible = m.count > 0; // unused kinds cost no draw call
      if (m.count) m.instanceMatrix.needsUpdate = true;
    }
  }
}
