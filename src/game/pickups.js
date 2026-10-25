import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { SHAPE } from '../render/billboards.js';

export const PICKUP = {
  pow: { color: new Color(1.0, 0.62, 0.15), glow: [1.0, 0.65, 0.2], label: 'POW' },
  bomb: { color: new Color(1.0, 0.35, 0.85), glow: [1.0, 0.4, 0.9], label: 'BOMB' },
  shield: { color: new Color(0.35, 0.9, 1.0), glow: [0.4, 0.9, 1.0], label: 'SHIELD' },
  laser: { color: new Color(0.85, 1.0, 1.0), glow: [0.7, 1.0, 1.0], label: 'LASER' },
  // score medals (ai/summary.md §6.3): worth more for each one caught in a row, back to 100 when one gets past
  medal: { color: new Color(1.0, 0.85, 0.3), glow: [1.0, 0.85, 0.35], label: 'MEDAL' },
};

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const _v = new Vector3();
const _axis = new Vector3(0, 1, 0);

export class Pickups {
  constructor(game, geometry, material, cap = 20) {
    this.game = game;
    this.cap = cap;
    this.items = [];
    this.mesh = new InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, PICKUP.pow.color);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.objects = [this.mesh];
  }

  clear() {
    this.items.length = 0;
  }

  /** wreck: POWs left by a lost ship (Game.onRespawn): a wider magnet, so one pass catches most of them. */
  spawn(type, x, y, z, wreck = false) {
    if (this.items.length >= this.cap) return;
    // inside the play box: a drop from a hulk off to the side would otherwise be out of reach
    const c = this.game.corridor;
    if (c) {
      x = Math.max(-c.x * 0.9, Math.min(c.x * 0.9, x));
      y = Math.max(-c.y * 0.9, Math.min(c.y * 0.9, y));
    }
    this.game.tm?.event('drop', { type, wreck });
    this.items.push({ type, pos: new Vector3(x, y, Math.min(z, -30)), vel: new Vector3(0, 0, 18), t: 0, magnet: wreck ? 24 : 16 });
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      it.t += dt;
      _v.subVectors(p.pos, it.pos);
      const d = _v.length();
      if (p.alive && d < it.magnet) {
        // magnet
        it.vel.addScaledVector(_v.normalize(), 140 * dt);
        it.vel.multiplyScalar(Math.exp(-2 * dt));
      } else {
        it.vel.x *= Math.exp(-1.5 * dt);
        it.vel.y *= Math.exp(-1.5 * dt);
        it.vel.z += (22 - it.vel.z) * Math.min(1, dt * 2);
      }
      it.pos.addScaledVector(it.vel, dt);
      if (p.alive && d < 3.4) {
        g.collect(it.type, it.pos);
        this.items.splice(k, 1);
        continue;
      }
      if (it.pos.z > 30) {
        this.items.splice(k, 1);
        g.onPickupMissed(it.type);
      }
    }
  }

  draw(glows, time) {
    const m = this.mesh;
    let n = 0;
    for (const it of this.items) {
      _q.setFromAxisAngle(_axis, it.t * 2.6);
      const bob = Math.sin(it.t * 4) * 0.3;
      _v.copy(it.pos);
      _v.y += bob;
      _m.compose(_v, _q, _s);
      m.setMatrixAt(n, _m);
      m.setColorAt(n, PICKUP[it.type].color);
      const c = PICKUP[it.type].glow;
      glows.push(_v.x, _v.y, _v.z, 0, 0, 0, c[0], c[1], c[2], 0.55 + 0.25 * Math.sin(time * 8), 3.6, SHAPE.GLOW);
      glows.push(_v.x, _v.y, _v.z, 0, 0, 0, c[0], c[1], c[2], 0.6, 2.6 + 0.4 * Math.sin(time * 6), SHAPE.RING);
      n++;
    }
    m.count = n;
    if (n) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }
}
