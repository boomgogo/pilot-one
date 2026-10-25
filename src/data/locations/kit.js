import { Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../../core/rng.js';

// Helpers for the later locations' data (only their chunks import this).

/**
 * A rail path along a heading, with sideways and vertical swings: points every `step` units and exactly at each
 * labelled distance. o: {start: [x,y,z], heading (radians, 0 = -z), labels: [[id, distance]], swing(d) → [x, y],
 * roll(d), step, tail (units past the last label, for the dock carrier)}
 */
export function railPath(o) {
  const step = o.step || 450;
  const h = o.heading || 0;
  const f = new Vector3(-Math.sin(h), 0, -Math.cos(h));
  const l = new Vector3(Math.cos(h), 0, -Math.sin(h));
  const s0 = new Vector3(...(o.start || [0, 0, 0]));
  const end = o.labels[o.labels.length - 1][1] + (o.tail ?? 900);
  const ds = new Set();
  for (let d = 0; d <= end; d += step) ds.add(Math.round(d));
  for (const [, d] of o.labels) ds.add(d);
  const byD = new Map(o.labels.map(([id, d]) => [d, id]));
  return [...ds]
    .sort((a, b) => a - b)
    .filter((d, i, arr) => byD.has(d) || ![arr[i - 1], arr[i + 1]].some((n) => n !== undefined && Math.abs(n - d) < step * 0.35 && byD.has(n)))
    .map((d) => {
      const [x, y] = o.swing ? o.swing(d) : [0, 0];
      const p = s0.clone().addScaledVector(f, d).addScaledVector(l, x);
      p.y += y;
      const pt = { p: [p.x, p.y, p.z], roll: o.roll ? o.roll(d) : 0 };
      if (byD.has(d)) pt.id = byD.get(d);
      return pt;
    });
}

/** Labels for consecutive sections of given seconds and rail speeds: [[id, distance]] (first label at 0). */
export function sectionLabels(start, list) {
  const out = [[start, 0]];
  let d = 0;
  for (const [id, seconds, speed] of list) {
    d += Math.round(seconds * speed);
    out.push([id, d]);
  }
  return out;
}

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _m = new Matrix4();
const _o = new Vector3();

/**
 * Scatter set-dressing structures along the route (world space, kept clear of the corridor), merged into one mesh
 * per call. spec: {from, to, count, minD, maxD, scale: [a, b], seed, make(rng) → {geo, lights}, upright}
 * lights: [[x, y, z, [r, g, b], size, blink]] in the structure's frame.
 */
export function scatter(ctx, spec) {
  const { scenery, routes, shipMaterial } = ctx;
  const route = routes[0];
  const rng = makeRng(spec.seed || 1);
  const s0 = route.labels[spec.from];
  const s1 = route.labels[spec.to];
  const geoms = [];
  let tries = 0;
  while (geoms.length < spec.count && tries++ < spec.count * 12) {
    const s = s0 + rng() * (s1 - s0);
    const a = spec.angle ? spec.angle(rng) : rng() * Math.PI * 2;
    const d = spec.minD + rng() * (spec.maxD - spec.minD);
    const sc = spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0]);
    route.localToWorld(s, Math.cos(a) * d, Math.sin(a) * d * (spec.flat ?? 0.6), (rng() - 0.5) * 60, _p);
    const { geo, lights = [], radius = 30 } = spec.make(rng);
    if (!scenery.clear(_p, radius * sc)) {
      geo.dispose();
      continue;
    }
    if (spec.upright) _q.setFromAxisAngle(_o.set(0, 1, 0), rng() * Math.PI * 2);
    else _q.set(rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    _s.set(sc, sc, sc);
    geo.applyMatrix4(_m.compose(_p, _q, _s));
    geoms.push(geo);
    for (const [x, y, z, color, size, blink] of lights) {
      const wp = new Vector3(x, y, z).multiplyScalar(sc).applyQuaternion(_q).add(_p);
      scenery.glowSpots.push({ pos: wp, color, size: size * sc, phase: rng() * 10, blink: !!blink, s0: s - 2200, s1: s + 600 });
    }
  }
  if (!geoms.length) return null;
  const mesh = new Mesh(mergeGeometries(geoms, false), shipMaterial);
  mesh.geometry.computeBoundingSphere();
  scenery.items.push({ object: mesh, s0, s1, route: null });
  return mesh;
}
