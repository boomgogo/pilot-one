import { BufferAttribute, Color, Matrix4, Mesh, Points, PointsMaterial, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/rng.js';
import { makeGateGeometry, makeWreckGeometry } from '../render/models.js';
import { Billboards, SHAPE } from '../render/billboards.js';
import { TRANSIT } from '../game/stage.js';

// World-space set dressing along the routes: ring dust, wrecks, carriers, gates. Nothing here is collidable: it is
// kept clear of every route's corridor so path choice is visual. Asteroid fields (also world space, also clear of the
// corridor, but breakable) live in game/fields.js and use clear() below for the same clearance rule.

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const CLEAR_CELL = 64;
const cellKey = (ix, iy, iz) => (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);

const CP_AMBER = [1, 0.62, 0.18];
const CP_GREEN = [0.35, 1, 0.5];

export class Scenery {
  constructor(stage, routes, forks, { tier, shipMaterial, models, game }) {
    this.items = []; // {object, s0, s1, route}
    this.objects = [];
    this.routes = routes;
    this.dock = null; // the carrier you land on: {pos, quat} (world)
    this.cpGreen = []; // per stage: its checkpoint gate has turned green
    this.glows = new Billboards(320, { additive: true, renderOrder: 4 });
    this.glowSpots = []; // {pos, color, size, phase, s0, s1, route, blink}
    this.objects.push(this.glows.mesh);

    // sample points of every route for the clearance test, in a hash grid (cells of CLEAR_CELL units)
    this.clearGrid = new Map();
    for (const r of routes) {
      for (let s = 0; s < r.length; s += 22) {
        const p = r.sample(s, new Vector3());
        const k = cellKey(Math.floor(p.x / CLEAR_CELL), Math.floor(p.y / CLEAR_CELL), Math.floor(p.z / CLEAR_CELL));
        let c = this.clearGrid.get(k);
        if (!c) this.clearGrid.set(k, (c = []));
        c.push(p);
      }
    }

    const sc = stage.scenery;
    if (sc.ringDust) this.addRingDust(sc.ringDust, routes, tier);
    if (sc.wrecks) this.addWrecks(sc.wrecks, routes[0], shipMaterial);
    for (const c of sc.carriers || []) this.addCarrier(c, routes, models.carrier, shipMaterial);
    for (const f of forks) this.addGate(f, routes[0], shipMaterial);
    this.addCheckpoints(stage, routes, shipMaterial);
    // a location's own set dressing (stations, clouds, terrain…): its code loads with the location
    this.extra = stage.buildScenery?.({ scenery: this, routes, forks, tier, shipMaterial, models, game }) || null;
    if (this.extra) for (const o of this.extra.objects || []) this.objects.push(o);
  }

  /**
   * A ring of lights across the corridor at the point where each stage's tally starts (ai/summary.md §4.3): amber
   * ahead, green as you fly through. Not at the last stage (it ends with the landing). One per route where the
   * routes differ there.
   */
  addCheckpoints(stage, routes, material) {
    const geo = makeGateGeometry(0xffa640);
    for (let i = 0; i < stage.stages.length - 1; i++) {
      const secs = stage.stages[i].sections;
      const sec = secs[secs.length - 1];
      const placed = [];
      for (const r of routes) {
        const a = r.labels[sec.from];
        const b = r.labels[sec.to];
        if (a === undefined || b === undefined) continue;
        const s = a + (b - a) * Math.max(0, 1 - (TRANSIT - 0.6) / sec.duration);
        if (placed.some((q) => q.route.sample(q.s, _x).distanceTo(r.sample(s, _y)) < 5)) continue;
        placed.push({ route: r, s });
      }
      const tagged = placed.length > 1;
      for (const { route, s } of placed) {
        const mesh = new Mesh(geo, material);
        route.sample(s, mesh.position, mesh.quaternion);
        mesh.scale.setScalar(4.3);
        this.objects.push(mesh);
        this.items.push({ object: mesh, s0: s - 2500, s1: s + 60, route: tagged ? route : null });
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const wp = new Vector3(Math.cos(a) * 41.5, Math.sin(a) * 41.5, 0).applyQuaternion(mesh.quaternion).add(mesh.position);
          this.glowSpots.push({ pos: wp, color: CP_AMBER, size: 3.2, phase: k * 0.2, blink: false, cp: i, s0: s - 2500, s1: s + 60, route: tagged ? route : null });
        }
      }
    }
  }

  /** Stage i's checkpoint gate turns green (its tally started) or back to amber (a restart). */
  checkpoint(i, green) {
    this.cpGreen[i] = green;
  }

  /** Does a body of `radius` at `point` keep clear of every route's corridor? */
  clear(point, radius) {
    const R = radius + 34;
    const r2 = R * R;
    const x0 = Math.floor((point.x - R) / CLEAR_CELL);
    const x1 = Math.floor((point.x + R) / CLEAR_CELL);
    const y0 = Math.floor((point.y - R) / CLEAR_CELL);
    const y1 = Math.floor((point.y + R) / CLEAR_CELL);
    const z0 = Math.floor((point.z - R) / CLEAR_CELL);
    const z1 = Math.floor((point.z + R) / CLEAR_CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const c = this.clearGrid.get(cellKey(x, y, z));
          if (c) for (const q of c) if (q.distanceToSquared(point) < r2) return false;
        }
      }
    }
    return true;
  }

  addRingDust(spec, routes, tier) {
    const rng = makeRng(77);
    const count = Math.round(spec.count * tier.sceneryRocks);
    const pos = new Float32Array(count * 3);
    const r = routes;
    for (let i = 0; i < count; i++) {
      const route = r[i % r.length];
      const s0 = route.labels[spec.from];
      const s1 = route.labels[spec.to];
      route.sample(s0 + rng() * (s1 - s0), _p, _q);
      _x.set(1, 0, 0).applyQuaternion(_q);
      _y.set(0, 0, 1).applyQuaternion(_q);
      _p.addScaledVector(_x, (rng() * 2 - 1) * spec.spread).addScaledVector(_y, (rng() * 2 - 1) * 80);
      _p.y = (rng() * 2 - 1) * 6;
      pos.set([_p.x, _p.y, _p.z], i * 3);
    }
    const g = new Points();
    g.geometry.setAttribute('position', new BufferAttribute(pos, 3));
    g.geometry.computeBoundingSphere();
    g.material = new PointsMaterial({ color: new Color(0xd6e6ff), size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false });
    this.objects.push(g);
    const s0 = routes[0].labels[spec.from];
    const s1 = Math.max(...routes.map((rr) => rr.labels[spec.to]));
    this.items.push({ object: g, s0, s1, route: null });
  }

  addWrecks(spec, route, material) {
    const rng = makeRng(spec.seed);
    const s0 = route.labels[spec.from];
    const s1 = route.labels[spec.to];
    const geoms = [];
    let tries = 0;
    while (geoms.length < spec.count && tries++ < 60) {
      const s = s0 + rng() * (s1 - s0);
      const a = rng() * Math.PI * 2;
      const d = spec.minD + rng() * (spec.maxD - spec.minD);
      const scale = spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0]);
      route.localToWorld(s, Math.cos(a) * d, Math.sin(a) * d * 0.7, 0, _p);
      if (!this.clear(_p, 22 * scale)) continue;
      const g = makeWreckGeometry(spec.seed * 31 + geoms.length);
      _q.set(rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      _s.set(scale, scale, scale);
      g.applyMatrix4(_m.compose(_p, _q, _s));
      geoms.push(g);
      // fires and blinking lights on the hulks
      for (let k = 0; k < 3; k++) {
        const fp = new Vector3((rng() - 0.5) * 16, (rng() - 0.5) * 8, (rng() - 0.5) * 30).multiplyScalar(scale).applyQuaternion(_q).add(_p);
        const fire = k < 2;
        this.glowSpots.push({ pos: fp, color: fire ? [1, 0.5, 0.15] : [1, 0.15, 0.1], size: (fire ? 7 : 2.5) * scale, phase: rng() * 10, blink: !fire, s0: s - 600, s1: s + 400 });
      }
    }
    if (!geoms.length) return;
    const mesh = new Mesh(mergeGeometries(geoms, false), material);
    mesh.geometry.computeBoundingSphere();
    this.objects.push(mesh);
    this.items.push({ object: mesh, s0, s1, route: null });
  }

  addCarrier(spec, routes, model, material) {
    const route = routes[0];
    const s = route.labels[spec.at] + spec.ds;
    const mesh = new Mesh(model.geometry, material);
    route.sample(s, mesh.position, mesh.quaternion);
    _p.fromArray(spec.offset).applyQuaternion(mesh.quaternion);
    mesh.position.add(_p);
    if (spec.dock) this.dock = { pos: mesh.position.clone(), quat: mesh.quaternion.clone() };
    mesh.scale.setScalar(1);
    this.objects.push(mesh);
    this.items.push({ object: mesh, s0: s - 3000, s1: s + 400, route: null });
    for (const g of model.markers.glow || []) {
      const wp = g.clone().applyQuaternion(mesh.quaternion).add(mesh.position);
      this.glowSpots.push({ pos: wp, color: [0.4, 0.8, 1.0], size: 4.5, phase: 0, blink: false, s0: s - 3000, s1: s + 400 });
    }
    // runway lights
    for (let k = 0; k < 8; k++) {
      const wp = new Vector3(k % 2 ? 11 : -11, 4, -50 + Math.floor(k / 2) * 30).applyQuaternion(mesh.quaternion).add(mesh.position);
      this.glowSpots.push({ pos: wp, color: [1, 0.85, 0.4], size: 1.6, phase: k * 0.4, blink: true, s0: s - 3000, s1: s + 400 });
    }
  }

  addGate(fork, route, material) {
    const s = route.labels[fork.gate];
    for (const opt of fork.options) {
      const color = opt.sign > 0 ? 0x5fdcff : 0xffa640;
      const mesh = new Mesh(makeGateGeometry(color), material);
      const off = fork.axis === 'y' ? [0, opt.sign * 11, 0] : [opt.sign * 15, 0, 0];
      route.sample(s, mesh.position, mesh.quaternion);
      _p.fromArray(off).applyQuaternion(mesh.quaternion);
      mesh.position.add(_p);
      this.objects.push(mesh);
      this.items.push({ object: mesh, s0: s - 2500, s1: s + 60, route: null });
      const c = new Color(color);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const wp = new Vector3(Math.cos(a) * 9.7, Math.sin(a) * 9.7, 0).add(new Vector3(...off)).applyQuaternion(mesh.quaternion);
        route.sample(s, _p);
        wp.add(_p);
        this.glowSpots.push({ pos: wp, color: [c.r, c.g, c.b], size: 1.4, phase: k * 0.35, blink: true, s0: s - 2500, s1: s + 60 });
      }
    }
  }

  /** decided: whether the fork for per-route items has been chosen yet. */
  update(s, route, decided, time, dt = 0) {
    for (const it of this.items) {
      const visible = s > it.s0 - 3200 && s < it.s1 + 500 && (!it.route || !decided || it.route === route);
      it.object.visible = visible;
    }
    const bb = this.glows;
    bb.begin();
    for (const g of this.glowSpots) {
      if (s < g.s0 - 600 || s > g.s1) continue;
      if (g.route && decided && g.route !== route) continue;
      let c = g.color;
      let f;
      if (g.cp !== undefined) {
        // checkpoint lights: a slow amber chase ahead, steady green once the stage is clear
        const green = this.cpGreen[g.cp];
        c = green ? CP_GREEN : CP_AMBER;
        f = green ? 1 : 0.55 + 0.45 * Math.max(0, Math.sin(time * 4 - g.phase * 2));
      } else {
        f = g.blink ? (Math.sin(time * 5 + g.phase) > 0.2 ? 1 : 0.15) : 0.75 + 0.25 * Math.sin(time * 13 + g.phase) * Math.sin(time * 7.3 + g.phase * 2);
      }
      bb.push(g.pos.x, g.pos.y, g.pos.z, 0, 0, 0, c[0], c[1], c[2], 0.9 * f, g.size, SHAPE.GLOW);
    }
    this.extra?.update?.(s, route, decided, time, bb, dt);
    bb.end();
  }
}
