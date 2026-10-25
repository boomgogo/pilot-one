import { Billboards, SHAPE } from '../render/billboards.js';
import { PAL } from '../render/fx.js';
import { MISSILE_R } from './hitbox.js';
import { segPointDist2 } from '../core/util.js';

// Missiles ("fast" class): launch slowly, accelerate, steer, and leave a smoke trail that lingers in the world.
//   player (owner 0): MISSILES power level and up, home on the nearest targets, 3 damage
//   enemy  (owner 1): gunships, home for 1.5 s with a limited turn rate (a late sharp move beats them), shootable

const SPEC = [
  { v0: 40, accel: 420, vmax: 240, turn: 3.0, homing: 2.0, life: 3.0, dmg: 3, size: 0.32, col: [0.75, 0.95, 1.0], smoke: [0.75, 0.82, 0.9] },
  { v0: 28, accel: 70, vmax: 92, turn: 1.2, homing: 1.5, life: 6.0, dmg: 1, size: 0.45, col: [1.0, 0.3, 0.2], smoke: [0.42, 0.36, 0.34] },
];

export class Missiles {
  constructor(game, cap = 64) {
    this.game = game;
    this.cap = cap;
    this.n = 0;
    this.p = new Float32Array(cap * 3);
    this.prev = new Float32Array(cap * 3);
    this.d = new Float32Array(cap * 3); // unit heading
    this.speed = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.smokeT = new Float32Array(cap);
    this.owner = new Uint8Array(cap);
    this.markT = new Float32Array(cap);
    this.dodged = new Uint8Array(cap); // passed through the ship during an evasive roll
    this.tgt = new Array(cap).fill(null);
    this.tgtUid = new Uint32Array(cap);
    this.bb = new Billboards(cap * 2, { additive: true, renderOrder: 8, minPx: 2.5, minLen: 10 });
    this.object = this.bb.mesh;
  }

  clear() {
    this.n = 0;
    this.tgt.fill(null);
  }

  launch(owner, x, y, z, dx, dy, dz, target = null) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.p.set([x, y, z], i * 3);
    this.prev.set([x, y, z], i * 3);
    this.d.set([dx / l, dy / l, dz / l], i * 3);
    this.speed[i] = SPEC[owner].v0;
    this.age[i] = 0;
    this.smokeT[i] = 0;
    this.owner[i] = owner;
    this.markT[i] = -1;
    this.dodged[i] = 0;
    this.tgt[i] = target;
    this.tgtUid[i] = target?.uid || 0;
    if (owner === 1) this.game.audio?.lockWarn();
    else this.game.audio?.missile();
  }

  remove(i) {
    const last = --this.n;
    if (i !== last) {
      for (let k = 0; k < 3; k++) {
        this.p[i * 3 + k] = this.p[last * 3 + k];
        this.prev[i * 3 + k] = this.prev[last * 3 + k];
        this.d[i * 3 + k] = this.d[last * 3 + k];
      }
      this.speed[i] = this.speed[last];
      this.age[i] = this.age[last];
      this.smokeT[i] = this.smokeT[last];
      this.owner[i] = this.owner[last];
      this.markT[i] = this.markT[last];
      this.dodged[i] = this.dodged[last];
      this.tgt[i] = this.tgt[last];
      this.tgtUid[i] = this.tgtUid[last];
    }
    this.tgt[last] = null;
  }

  /** Velocity of missile i (rail-local). */
  vel(i, out) {
    const s = this.speed[i];
    return out.set(this.d[i * 3] * s, this.d[i * 3 + 1] * s, this.d[i * 3 + 2] * s);
  }

  update(dt) {
    const g = this.game;
    const pl = g.player;
    const drift = g.stage.speed;
    for (let i = this.n - 1; i >= 0; i--) {
      const sp = SPEC[this.owner[i]];
      this.age[i] += dt;
      const i3 = i * 3;
      const x = this.p[i3];
      const y = this.p[i3 + 1];
      const z = this.p[i3 + 2];
      if (this.age[i] > sp.life || z > 60 || z < -900 || Math.abs(x) > 260 || Math.abs(y) > 200) {
        if (this.owner[i] === 1) g.tutor?.onMissileGone();
        this.remove(i);
        continue;
      }
      this.speed[i] = Math.min(sp.vmax, this.speed[i] + sp.accel * dt);
      // steering target
      let tx = null;
      let ty = 0;
      let tz = 0;
      if (this.owner[i] === 0) {
        const e = this.tgt[i];
        if (e && e.active && e.uid === this.tgtUid[i]) {
          tx = e.pos.x;
          ty = e.pos.y;
          tz = e.pos.z;
        } else this.tgt[i] = null;
      } else if (this.age[i] < sp.homing && pl.alive) {
        tx = pl.pos.x;
        ty = pl.pos.y;
        tz = pl.pos.z;
      }
      if (tx !== null) this._steer(i3, tx - x, ty - y, tz - z, sp.turn * dt);
      this.prev[i3] = x;
      this.prev[i3 + 1] = y;
      this.prev[i3 + 2] = z;
      const s = this.speed[i];
      this.p[i3] += this.d[i3] * s * dt;
      this.p[i3 + 1] += this.d[i3 + 1] * s * dt;
      this.p[i3 + 2] += this.d[i3 + 2] * s * dt;
      // smoke stays where it was puffed out (it drifts toward the camera with the world)
      this.smokeT[i] -= dt;
      if (this.smokeT[i] <= 0) {
        this.smokeT[i] = 0.03;
        g.fx.add(x, y, z, 0, 0.6, drift, 0.6, 0.35, 1.5, sp.smoke, sp.smoke, this.owner[i] ? 0.5 : 0.35, SHAPE.SOFT);
      }
    }
  }

  _steer(i3, dx, dy, dz, maxAng) {
    const d = this.d;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-3) return;
    const tx = dx / l;
    const ty = dy / l;
    const tz = dz / l;
    const cos = d[i3] * tx + d[i3 + 1] * ty + d[i3 + 2] * tz;
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    const k = ang <= maxAng ? 1 : maxAng / ang;
    let nx = d[i3] + (tx - d[i3]) * k;
    let ny = d[i3 + 1] + (ty - d[i3 + 1]) * k;
    let nz = d[i3 + 2] + (tz - d[i3 + 2]) * k;
    const nl = Math.hypot(nx, ny, nz) || 1;
    d[i3] = nx / nl;
    d[i3 + 1] = ny / nl;
    d[i3 + 2] = nz / nl;
  }

  /** Bomb wave: enemy missiles inside the sphere pop. */
  cancelEnemy(c, r) {
    for (let i = this.n - 1; i >= 0; i--) {
      if (this.owner[i] !== 1) continue;
      const dx = this.p[i * 3] - c.x;
      const dy = this.p[i * 3 + 1] - c.y;
      const dz = this.p[i * 3 + 2] - c.z;
      if (dx * dx + dy * dy + dz * dz < r * r) this.pop(i);
    }
  }

  /** An enemy missile shot down (or cancelled). */
  pop(i) {
    const g = this.game;
    const i3 = i * 3;
    g.fx.explosion(this.p[i3], this.p[i3 + 1], this.p[i3 + 2], 0.5, PAL.fire, g.stage.speed * 0.5);
    g.audio?.shellPop();
    this.remove(i);
  }

  /** Player shot segment vs enemy missiles. Returns true if a missile was hit. */
  shotTest(ax, ay, az, bx, by, bz) {
    const g = this.game;
    for (let i = 0; i < this.n; i++) {
      if (this.owner[i] !== 1) continue;
      const i3 = i * 3;
      if (segPointDist2(ax, ay, az, bx, by, bz, this.p[i3], this.p[i3 + 1], this.p[i3 + 2]) < 1.4 * 1.4) {
        g.addScore(100, this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
        g.hud.hitMarker(true);
        g.tutor?.onMissileGone();
        this.pop(i);
        return true;
      }
    }
    return false;
  }

  draw(time) {
    const bb = this.bb;
    bb.begin();
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      const sp = SPEC[this.owner[i]];
      const s = this.speed[i];
      const k = 0.05;
      const c = sp.col;
      bb.push(this.p[i3], this.p[i3 + 1], this.p[i3 + 2], this.d[i3] * s * k, this.d[i3 + 1] * s * k, this.d[i3 + 2] * s * k, c[0], c[1], c[2], 1, sp.size, SHAPE.BOLT);
      const fl = 0.7 + 0.3 * Math.sin(time * 50 + i);
      bb.push(this.p[i3] - this.d[i3] * 0.8, this.p[i3 + 1] - this.d[i3 + 1] * 0.8, this.p[i3 + 2] - this.d[i3 + 2] * 0.8, 0, 0, 0, 1, 0.75, 0.4, 0.8 * fl, sp.size * 2.4, SHAPE.GLOW);
    }
    bb.end();
  }
}

export { MISSILE_R };
