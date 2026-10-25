import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three';

// A Route is a dense, arc-length-parameterized sampling of a centripetal Catmull-Rom spline with
// twist-free (parallel transport) frames. Rail-local axes: +x right, +y up, -z forward (three.js camera convention).

const SAMPLES_PER_SEGMENT = 48;
const _v = new Vector3();
const _t = new Vector3();
const _tPrev = new Vector3();
const _up = new Vector3();
const _upR = new Vector3();
const _x = new Vector3();
const _z = new Vector3();
const _axis = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _qa = new Float32Array(4);

export class Route {
  /**
   * @param {{p: Vector3, id?: string, roll?: number}[]} points  roll in radians (+ = bank right)
   * @param {string} key  branch choice key, e.g. "over"
   * @param {Record<string,string>} choices  fork id → option key
   */
  constructor(points, key = '', choices = {}) {
    this.key = key;
    this.choices = choices;
    this.points = points;
    const K = SAMPLES_PER_SEGMENT;
    const curve = new CatmullRomCurve3(
      points.map((q) => q.p),
      false,
      'centripetal',
    );
    const nSeg = points.length - 1;
    const M = nSeg * K + 1;
    this.M = M;
    this.pos = new Float32Array(M * 3);
    this.quat = new Float32Array(M * 4);
    this.s = new Float64Array(M);
    this.labels = {};

    for (let i = 0; i < M; i++) {
      curve.getPoint(i / (M - 1), _v);
      _v.toArray(this.pos, i * 3);
      if (i > 0) {
        const dx = this.pos[i * 3] - this.pos[i * 3 - 3];
        const dy = this.pos[i * 3 + 1] - this.pos[i * 3 - 2];
        const dz = this.pos[i * 3 + 2] - this.pos[i * 3 - 1];
        this.s[i] = this.s[i - 1] + Math.hypot(dx, dy, dz);
      }
    }
    this.length = this.s[M - 1];
    points.forEach((p, j) => {
      if (p.id) this.labels[p.id] = this.s[j * K];
    });

    // Parallel transport frames.
    _up.set(0, 1, 0);
    for (let i = 0; i < M; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(M - 1, i + 1);
      _t.set(
        this.pos[b * 3] - this.pos[a * 3],
        this.pos[b * 3 + 1] - this.pos[a * 3 + 1],
        this.pos[b * 3 + 2] - this.pos[a * 3 + 2],
      ).normalize();
      if (i === 0) {
        _up.addScaledVector(_t, -_up.dot(_t)).normalize();
      } else {
        _axis.crossVectors(_tPrev, _t);
        const sin = _axis.length();
        if (sin > 1e-7) {
          const ang = Math.atan2(sin, _tPrev.dot(_t));
          _up.applyAxisAngle(_axis.multiplyScalar(1 / sin), ang);
        }
        _up.addScaledVector(_t, -_up.dot(_t)).normalize();
      }
      _tPrev.copy(_t);

      // Authored bank, eased between control points.
      const j = Math.min(nSeg - 1, Math.floor(i / K));
      const f = (i - j * K) / K;
      const e = f * f * (3 - 2 * f);
      const roll = (points[j].roll || 0) * (1 - e) + (points[j + 1].roll || 0) * e;
      _upR.copy(_up);
      if (roll) _upR.applyAxisAngle(_t, roll);

      _x.crossVectors(_t, _upR).normalize();
      _z.copy(_t).negate();
      _m.makeBasis(_x, _upR, _z);
      _q.setFromRotationMatrix(_m).normalize();
      _q.toArray(this.quat, i * 4);
    }
    this._hint = 0;
  }

  _index(s) {
    const S = this.s;
    let i = this._hint;
    if (s < S[i] || s >= S[i + 1]) {
      let lo = 0;
      let hi = this.M - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (S[mid] <= s) lo = mid;
        else hi = mid - 1;
      }
      i = lo;
      this._hint = i;
    }
    return i;
  }

  /** World position + orientation of the rail frame at arc length s. */
  sample(s, outPos, outQuat) {
    s = Math.max(0, Math.min(this.length - 1e-6, s));
    const i = this._index(s);
    const S = this.s;
    const f = (s - S[i]) / (S[i + 1] - S[i] || 1);
    const P = this.pos;
    outPos.set(
      P[i * 3] + (P[i * 3 + 3] - P[i * 3]) * f,
      P[i * 3 + 1] + (P[i * 3 + 4] - P[i * 3 + 1]) * f,
      P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * f,
    );
    if (outQuat) {
      Quaternion.slerpFlat(_qa, 0, this.quat, i * 4, this.quat, i * 4 + 4, f);
      outQuat.fromArray(_qa);
    }
    return outPos;
  }

  /** Rail-local offset (x right, y up, z back) at arc length s → world position. */
  localToWorld(s, x, y, z, out) {
    this.sample(s, out, _q);
    _v.set(x, y, z).applyQuaternion(_q);
    return out.add(_v);
  }
}

/**
 * Expand a path description with forks into one Route per combination of choices.
 * Path items: {p:[x,y,z]|Vector3, id?, roll?} or {fork:'id', gate:'label', axis:'x'|'y', options:[{key, sign, points:[...]}]}.
 * Branch routes share every point before the fork, so they are identical up to the gate point
 * as long as there is at least one shared point between the gate and the first branch point.
 */
export function buildRoutes(path) {
  let partial = [{ key: '', points: [], choices: {} }];
  const forks = [];
  for (const item of path) {
    if (item.fork) {
      forks.push({ id: item.fork, gate: item.gate, axis: item.axis || 'x', options: item.options.map((o) => ({ key: o.key, sign: o.sign, label: o.label })) });
      const next = [];
      for (const r of partial) {
        for (const opt of item.options) {
          next.push({
            key: r.key ? r.key + '+' + opt.key : opt.key,
            points: r.points.concat(opt.points.map(toPoint)),
            choices: { ...r.choices, [item.fork]: opt.key },
          });
        }
      }
      partial = next;
    } else {
      const p = toPoint(item);
      for (const r of partial) r.points.push(p);
    }
  }
  const routes = partial.map((r) => new Route(r.points, r.key, r.choices));
  // sanity: gate labels must sit at the same arc length on every route
  for (const f of forks) {
    const ss = routes.map((r) => r.labels[f.gate]);
    if (ss.some((s) => Math.abs(s - ss[0]) > 1e-3)) console.warn('fork gate mismatch', f.id, ss);
  }
  return { routes, forks };
}

function toPoint(item) {
  const p = item.p instanceof Vector3 ? item.p.clone() : new Vector3().fromArray(item.p);
  return { p, id: item.id, roll: item.roll || 0 };
}
