import { InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { makeRng } from '../core/rng.js';
import { makeRockGeometry } from '../render/models.js';
import { KINDS, kindColor } from './rocks.js';

// Asteroid fields along the routes (world space), and every rock in them is breakable (prompt_1 issue 4).
// Fields are kept clear of the corridor, so they never hurt the player; chunks of a big rock that land in the
// corridor become ordinary corridor rocks (game/rocks.js), which do.
//
// Shots live in rail space; once per substep the game hands us the rail frame (setFrame) and we test shot
// segments in world space against a hash grid of rock spheres.

const CELL = 64;
const RANGE = 700; // aim lock / "visible in range" distance
const ZERO = new Matrix4().makeScale(0, 0, 0);
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

const key = (ix, iy, iz) => ix * 73856093 ^ iy * 19349663 ^ iz * 83492791;

export class Fields {
  /** clearance(point, radius) → true if the point keeps away from every route's corridor. */
  constructor(game, stage, routes, { tier, material, clearance }) {
    this.game = game;
    this.material = material;
    this.fields = []; // {mesh, s0, s1, route, base: Float32Array (matrices), hit: InstancedBufferAttribute, first}
    this.objects = [];
    // per rock (struct of arrays)
    const cx = [];
    const cy = [];
    const cz = [];
    const rad = [];
    const fieldOf = [];
    const instOf = [];
    const scale = [];
    const geoCache = {};
    for (const f of stage.scenery.fields) {
      const key0 = f.kind + f.detail;
      const geo = (geoCache[key0] ||= makeRockGeometry(f.seed * 13 + 1, f.detail, f.kind));
      const list = f.perRoute ? routes : [routes[0]];
      for (const r of list) {
        const rocks = this._place(f, r, f.perRoute ? r : null, tier, clearance);
        if (!rocks.length) continue;
        const g = geo.clone();
        const spin = new Float32Array(rocks.length * 4);
        rocks.forEach((k, i) => spin.set(k.spin, i * 4));
        g.setAttribute('aSpin', new InstancedBufferAttribute(spin, 4));
        const hit = new InstancedBufferAttribute(new Float32Array(rocks.length), 1);
        g.setAttribute('aHit', hit);
        const mesh = new InstancedMesh(g, material, rocks.length);
        const base = new Float32Array(rocks.length * 16);
        const first = cx.length;
        rocks.forEach((k, i) => {
          mesh.setMatrixAt(i, k.m);
          k.m.toArray(base, i * 16);
          cx.push(k.p.x);
          cy.push(k.p.y);
          cz.push(k.p.z);
          rad.push(geo.boundingSphere.radius * k.maxS * 0.9);
          scale.push(k.maxS);
          fieldOf.push(this.fields.length);
          instOf.push(i);
        });
        mesh.computeBoundingSphere();
        this.objects.push(mesh);
        this.fields.push({ mesh, s0: k0(r, f.from), s1: k0(r, f.to), route: f.perRoute ? r : null, base, hit, first, count: rocks.length, kind: f.kind, visible: true });
      }
    }
    const n = cx.length;
    this.n = n;
    this.cx = Float32Array.from(cx);
    this.cy = Float32Array.from(cy);
    this.cz = Float32Array.from(cz);
    this.rad = Float32Array.from(rad);
    this.scale = Float32Array.from(scale);
    this.fieldOf = Uint16Array.from(fieldOf);
    this.instOf = Uint32Array.from(instOf);
    this.hpMax = new Float32Array(n);
    for (let i = 0; i < n; i++) this.hpMax[i] = Math.min(7, 1 + Math.ceil(this.scale[i] / 4));
    this.hp = Float32Array.from(this.hpMax);
    this.alive = new Uint8Array(n).fill(1);
    this.flash = new Float32Array(n);
    this.flashing = new Set();
    this.stamp = new Uint32Array(n);
    this.stampN = 0;
    // hash grid of rock spheres
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const r = this.rad[i];
      const x0 = Math.floor((this.cx[i] - r) / CELL);
      const x1 = Math.floor((this.cx[i] + r) / CELL);
      const y0 = Math.floor((this.cy[i] - r) / CELL);
      const y1 = Math.floor((this.cy[i] + r) / CELL);
      const z0 = Math.floor((this.cz[i] - r) / CELL);
      const z1 = Math.floor((this.cz[i] + r) / CELL);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          for (let z = z0; z <= z1; z++) {
            const k = key(x, y, z);
            let c = this.grid.get(k);
            if (!c) this.grid.set(k, (c = []));
            c.push(i);
          }
        }
      }
    }
    this.toWorld = new Matrix4();
    this.toRail = new Matrix4();
    this.visibleInRange = 0;
    this.broken = 0;
  }

  _place(f, route, routeTag, tier, clearance) {
    const rng = makeRng(f.seed + (routeTag ? routeTag.key.length * 101 : 0));
    const count = Math.round(f.count * tier.sceneryRocks);
    const s0 = route.labels[f.from];
    const s1 = route.labels[f.to];
    const out = [];
    let tries = 0;
    while (out.length < count && tries++ < count * 6) {
      const s = s0 + rng() * (s1 - s0);
      const scale = f.scale[0] + Math.pow(rng(), 2.2) * (f.scale[1] - f.scale[0]);
      if (f.ringPlane) {
        // scatter around the route, then flatten onto the ring plane (world y ≈ 0)
        route.sample(s, _p, _q);
        _x.set(1, 0, 0).applyQuaternion(_q);
        _y.set(0, 0, 1).applyQuaternion(_q);
        _p.addScaledVector(_x, (rng() * 2 - 1) * f.spread).addScaledVector(_y, (rng() * 2 - 1) * 60);
        _p.y = (rng() * 2 - 1) * 22;
      } else {
        const a = rng() * Math.PI * 2;
        const d = f.minD + Math.pow(rng(), 1.6) * (f.maxD - f.minD);
        route.localToWorld(s, Math.cos(a) * d, Math.sin(a) * d * 0.75, (rng() * 2 - 1) * 30, _p);
      }
      if (!clearance(_p, scale)) continue;
      _q.set(rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      _s.set(scale * (0.8 + rng() * 0.5), scale * (0.7 + rng() * 0.4), scale * (0.8 + rng() * 0.6));
      const sx = rng() * 2 - 1;
      const sy = rng() * 2 - 1;
      const sz = rng() * 2 - 1;
      const sl = Math.hypot(sx, sy, sz) || 1;
      out.push({
        p: _p.clone(),
        m: new Matrix4().compose(_p, _q, _s),
        maxS: Math.max(_s.x, _s.y, _s.z),
        spin: [sx / sl, sy / sl, sz / sl, (rng() * 2 - 1) * 0.25],
      });
    }
    return out;
  }

  reset() {
    for (const f of this.fields) {
      for (let i = 0; i < f.count; i++) f.mesh.instanceMatrix.array.set(f.base.subarray(i * 16, i * 16 + 16), i * 16);
      f.mesh.instanceMatrix.clearUpdateRanges();
      f.mesh.instanceMatrix.needsUpdate = true;
      f.hit.array.fill(0);
      f.hit.needsUpdate = true;
    }
    this.hp.set(this.hpMax);
    this.alive.fill(1);
    this.flash.fill(0);
    this.flashing.clear();
    this.broken = 0;
  }

  /** Rail frame for this substep (rail-local → world), from the stage's current position on its route. */
  setFrame(pos, quat) {
    this.toWorld.compose(pos, quat, _s.set(1, 1, 1));
    this.toRail.copy(this.toWorld).invert();
  }

  /** Field visibility follows the route (same rule as world/scenery.js). */
  update(s, route, decided, dt) {
    for (const f of this.fields) {
      f.visible = s > f.s0 - 3200 && s < f.s1 + 500 && (!f.route || !decided || f.route === route);
      f.mesh.visible = f.visible;
    }
    // hit flashes decay
    for (const i of this.flashing) {
      this.flash[i] = Math.max(0, this.flash[i] - dt * 6);
      const f = this.fields[this.fieldOf[i]];
      const j = this.instOf[i];
      f.hit.array[j] = this.flash[i];
      f.hit.addUpdateRange(j, 1);
      f.hit.needsUpdate = true;
      if (this.flash[i] <= 0) this.flashing.delete(i);
    }
    // how many rocks are within reach of the player (telemetry / HUD)
    const pw = _a.copy(this.game.player.pos).applyMatrix4(this.toWorld);
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || !this.fields[this.fieldOf[i]].visible) continue;
      const dx = this.cx[i] - pw.x;
      const dy = this.cy[i] - pw.y;
      const dz = this.cz[i] - pw.z;
      if (dx * dx + dy * dy + dz * dz < RANGE * RANGE) c++;
    }
    this.visibleInRange = c;
  }

  _cell(x, y, z) {
    return this.grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)));
  }

  /** Rail-local shot segment a→b. Returns true if it hit (and damaged) a rock. */
  hitSegment(ax, ay, az, bx, by, bz, dmg) {
    _a.set(ax, ay, az).applyMatrix4(this.toWorld);
    _b.set(bx, by, bz).applyMatrix4(this.toWorld);
    const cells = [this._cell(_a.x, _a.y, _a.z), this._cell(_b.x, _b.y, _b.z)];
    const sn = ++this.stampN;
    for (const cell of cells) {
      if (!cell) continue;
      for (const i of cell) {
        if (this.stamp[i] === sn || !this.alive[i]) continue;
        this.stamp[i] = sn;
        if (!this.fields[this.fieldOf[i]].visible) continue;
        if (segSphere(_a, _b, this.cx[i], this.cy[i], this.cz[i], this.rad[i])) {
          this.damage(i, dmg);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Rail-local ray (origin o, unit dir d) up to maxT: nearest rock hit (radius × 1.1 for aim assist).
   * Returns the distance along the ray or -1; writes the rock centre (rail-local) into outC.
   */
  rayTest(o, d, maxT, outC) {
    _a.copy(o).applyMatrix4(this.toWorld);
    _b.copy(d).transformDirection(this.toWorld);
    const sn = ++this.stampN;
    let best = maxT;
    let hit = -1;
    for (let t = 0; t <= maxT + CELL; t += CELL * 0.5) {
      const cell = this._cell(_a.x + _b.x * t, _a.y + _b.y * t, _a.z + _b.z * t);
      if (!cell) continue;
      for (const i of cell) {
        if (this.stamp[i] === sn) continue;
        this.stamp[i] = sn;
        if (!this.alive[i] || !this.fields[this.fieldOf[i]].visible) continue;
        const r = this.rad[i] * 1.1;
        const ox = this.cx[i] - _a.x;
        const oy = this.cy[i] - _a.y;
        const oz = this.cz[i] - _a.z;
        const tca = ox * _b.x + oy * _b.y + oz * _b.z;
        if (tca < 8) continue;
        const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
        if (d2 > r * r) continue;
        const th = tca - Math.sqrt(r * r - d2);
        if (th < best) {
          best = Math.max(8, th);
          hit = i;
        }
      }
      if (hit >= 0 && t > best + CELL) break;
    }
    this.lastRay = hit;
    if (hit < 0) return -1;
    outC.set(this.cx[hit], this.cy[hit], this.cz[hit]).applyMatrix4(this.toRail);
    return best;
  }

  /** Bomb wave: damage every rock inside a rail-local sphere once (hitSet keeps track across frames). */
  damageSphere(c, r, dmg, hitSet) {
    const w = _a.copy(c).applyMatrix4(this.toWorld);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || !this.fields[this.fieldOf[i]].visible) continue;
      const dx = this.cx[i] - w.x;
      const dy = this.cy[i] - w.y;
      const dz = this.cz[i] - w.z;
      const rr = r + this.rad[i];
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      const k = 'f' + i;
      if (hitSet.has(k)) continue;
      hitSet.add(k);
      this.damage(i, dmg);
    }
  }

  damage(i, dmg) {
    const g = this.game;
    this.hp[i] -= dmg;
    this.flash[i] = 1;
    this.flashing.add(i);
    const c = _b.set(this.cx[i], this.cy[i], this.cz[i]).applyMatrix4(this.toRail);
    if (this.hp[i] > 0) {
      g.hud.hitMarker(false);
      return;
    }
    this.break(i, c.x, c.y, c.z);
  }

  break(i, x, y, z) {
    const g = this.game;
    this.alive[i] = 0;
    this.broken++;
    const f = this.fields[this.fieldOf[i]];
    const j = this.instOf[i];
    f.mesh.setMatrixAt(j, ZERO);
    f.mesh.instanceMatrix.addUpdateRange(j * 16, 16);
    f.mesh.instanceMatrix.needsUpdate = true;
    const sc = this.scale[i];
    const drift = g.stage.speed; // stays where it was in the world
    const kind = Math.max(0, KINDS.indexOf(f.kind));
    g.fx.explosion(x, y, z, Math.min(3, 0.5 + sc * 0.18), kindColor(kind), drift);
    g.fx.addDebris(x, y, z, Math.min(6, 1 + Math.round(sc / 4)), 8 + sc, drift, Math.min(1.4, 0.3 + sc * 0.08));
    g.audio?.explosion(sc > 8 ? 1.4 : 0.7);
    g.hud.hitMarker(true);
    const pts = Math.max(30, Math.min(250, Math.round(sc * 1.2) * 10));
    g.addScore(pts, x, y, z);
    g.tm?.event('field', { scale: +sc.toFixed(1), pts });
    // big rocks split: chunks inside the corridor's reach become corridor rocks (they can hit you)
    if (sc > 8 && Math.abs(x) < 50 && Math.abs(y) < 34) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + i;
        g.rocks.spawn(x, y, z, Math.cos(a) * 8, Math.sin(a) * 8, -g.stage.speed + (k - 1) * 4, 1.2 + (k % 2) * 0.6, 0, kind);
      }
    }
  }

  /** Visible, in-range rocks in rail-local space: cb(x, y, z, radius, id). */
  forVisible(cb) {
    const pw = _a.copy(this.game.player.pos).applyMatrix4(this.toWorld);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || !this.fields[this.fieldOf[i]].visible) continue;
      const dx = this.cx[i] - pw.x;
      const dy = this.cy[i] - pw.y;
      const dz = this.cz[i] - pw.z;
      if (dx * dx + dy * dy + dz * dz > RANGE * RANGE) continue;
      _b.set(this.cx[i], this.cy[i], this.cz[i]).applyMatrix4(this.toRail);
      if (_b.z > 0) continue;
      cb(_b.x, _b.y, _b.z, this.rad[i], i);
    }
  }
}

function k0(route, label) {
  return route.labels[label];
}

function segSphere(a, b, cx, cy, cz, r) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = cx - a.x;
  const apy = cy - a.y;
  const apz = cz - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-9 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz < r * r;
}
