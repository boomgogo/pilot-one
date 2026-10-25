#!/usr/bin/env node
// Route check for every location's rail (ai/summary.md §11). For every section and route:
//   length and rail speed; how much of it is dark, using the location's own lighting (its backdrop's lightFactor:
//   the gas giant's shadow, the Frozen Moon's cavern); how often the sun is within 45° of straight ahead (enemy ships
//   are then lit from behind; a location can hide its sun); and the closest other pass of the rail.
// Location 1 also prints where each fork route crosses the ring plane.
//
//   npm run rail [-- --loc 2] [--step 20]
import { Quaternion, Vector3 } from 'three';
import { buildRoutes } from '../src/world/rail.js';
import { TIERS } from '../src/core/quality.js';
import { LOCATIONS } from '../src/data/locations/index.js';

const arg = (k, d) => (process.argv.includes('--' + k) ? process.argv[process.argv.indexOf('--' + k) + 1] : d);
const STEP = +arg('step', 20) || 20;
const only = +arg('loc', 0);
const tier = { ...TIERS.low, planetSegs: 8, stars: 10 };
const fakeGame = { r: { gl: { getPixelRatio: () => 1 } } };

for (const [i, meta] of LOCATIONS.entries()) {
  if (only && only !== i + 1) continue;
  const W = await meta.load();
  console.log(`\n=== location ${i + 1}: ${W.name}`);
  check(W);
}

function check(W) {
  const { routes } = buildRoutes(W.path);
  const backdrop = W.backdrop(W, tier, {}, fakeGame);
  const e = W.sun.elevation;
  const a = W.sun.azimuth;
  const sun = new Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
  const p = new Vector3();
  const quat = new Quaternion();
  const fwd = new Vector3();
  // all rail samples, for the pass-separation test
  const all = [];
  for (const r of routes) for (let s = 0; s < r.length; s += 40) all.push({ r, s, p: r.sample(s, new Vector3()) });
  const rows = [];
  let total = 0;
  for (const sec of W.sections) {
    for (const r of routes) {
      const s0 = r.labels[sec.from];
      const s1 = r.labels[sec.to];
      if (s0 === undefined || s1 === undefined) {
        rows.push({ section: sec.id, route: r.key, error: `missing label ${sec.from} or ${sec.to}` });
        continue;
      }
      let n = 0;
      let dark = 0;
      let light = 0;
      let sunAhead = 0;
      let minSep = Infinity;
      for (let s = s0; s <= s1; s += STEP) {
        r.sample(s, p, quat);
        n++;
        // the stage runner as the backdrop sees it: this section, this far in
        const f = backdrop.lightFactor(p, sun, { section: sec, time: ((s - s0) / Math.max(1, s1 - s0)) * sec.duration });
        light += f;
        if (f < 0.5) dark++;
        fwd.set(0, 0, -1).applyQuaternion(quat);
        if (!W.sunHidden && fwd.dot(sun) > Math.cos(Math.PI / 4)) sunAhead++;
        for (const o of all) {
          if (Math.abs(o.s - s) < 2500) continue; // same pass, or the other fork branch alongside
          const d = o.p.distanceTo(p);
          if (d < minSep) minSep = d;
        }
      }
      const len = s1 - s0;
      if (r === routes[0]) total += sec.duration;
      rows.push({
        stage: sec.stage + 1,
        section: sec.id,
        route: r.key,
        length: Math.round(len),
        seconds: sec.duration,
        speed: +(len / sec.duration).toFixed(1),
        darkPct: Math.round((100 * dark) / n),
        meanLight: +(light / n).toFixed(2),
        sunAheadPct: Math.round((100 * sunAhead) / n),
        minPassSep: Number.isFinite(minSep) ? Math.round(minSep) : '-',
      });
    }
  }
  console.table(rows);
  if (W.planet && routes.length > 1) {
    // ring-plane crossings at the fork (gate → rejoin)
    for (const r of routes) {
      let prev = null;
      const xs = [];
      for (let s = r.labels.gate; s <= r.labels.rejoin; s += 5) {
        r.sample(s, p);
        if (prev && Math.sign(prev.y) !== Math.sign(p.y)) xs.push(Math.round(Math.hypot(p.x, p.z)));
        prev = p.clone();
      }
      console.log(`route ${r.key}: ring-plane crossings at radius ${xs.length ? xs.join(', ') : 'none'} (gap ${W.planet.gapIn}–${W.planet.gapOut})`);
    }
  }
  console.log(`total ${total} s (${(total / 60).toFixed(1)} min), rail ${Math.round(routes[0].length)} units`);
}
