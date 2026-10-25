import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Euler, IcosahedronGeometry, Matrix4,
  OctahedronGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/rng.js';

// A "model" is { geometry, parts: {name: {geometry, position}}, markers: {prefix: [Vector3...]}, radius }.
// Geometry attributes: position, normal, color (linear RGB), aGlow (linear emissive RGB), iFlash (zeros).
// Ship GLBs come from Blender (assets-src/blender); every model also has a procedural fallback.

const _m = new Matrix4();
const _c = new Color();

function floatAttr(attr, itemSize) {
  const n = attr.count;
  const out = new Float32Array(n * itemSize);
  for (let i = 0; i < n; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return new BufferAttribute(out, itemSize);
}

/** Copy a glTF primitive into our attribute layout, baking material color/emissive into vertex attributes. */
function prepMesh(mesh, matrix) {
  const src = mesh.geometry;
  const g = new BufferGeometry();
  g.setAttribute('position', floatAttr(src.attributes.position, 3));
  if (src.attributes.normal) g.setAttribute('normal', floatAttr(src.attributes.normal, 3));
  const n = src.attributes.position.count;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const base = mat?.color || _c.set(1, 1, 1);
  const em = mat?.emissive ? mat.emissive.clone().multiplyScalar(mat.emissiveIntensity ?? 1) : new Color(0, 0, 0);
  const col = new Float32Array(n * 3);
  const glow = new Float32Array(n * 3);
  const vc = src.attributes.color;
  for (let i = 0; i < n; i++) {
    const r = vc ? vc.getX(i) : 1;
    const gg = vc ? vc.getY(i) : 1;
    const b = vc ? vc.getZ(i) : 1;
    col[i * 3] = base.r * r;
    col[i * 3 + 1] = base.g * gg;
    col[i * 3 + 2] = base.b * b;
    glow[i * 3] = em.r;
    glow[i * 3 + 1] = em.g;
    glow[i * 3 + 2] = em.b;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('aGlow', new BufferAttribute(glow, 3));
  if (src.index) g.setIndex(Array.from(src.index.array));
  else g.setIndex([...Array(n).keys()]);
  g.applyMatrix4(matrix);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function finish(geoms) {
  if (!geoms.length) return null;
  const g = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
  g.setAttribute('iFlash', new BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  g.computeBoundingSphere();
  return g;
}

/** Turn one root node of a glTF scene into a model. */
export function extractModel(root) {
  root.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(root.matrixWorld).invert();
  const body = [];
  const partLists = {};
  const markers = {};
  // Multi-material nodes load as a Group with child meshes ("part_core" → "part_core_1", "part_core_2"),
  // so the part is the outermost part_* ancestor below the root.
  const partOf = (obj) => {
    let found = null;
    for (let o = obj; o && o !== root; o = o.parent) if (o.name.startsWith('part_')) found = o;
    return found;
  };
  root.traverse((obj) => {
    if (obj.isMesh) {
      const part = partOf(obj);
      if (part) {
        const inv = new Matrix4().copy(part.matrixWorld).invert();
        (partLists[part.name] ||= { node: part, list: [] }).list.push(prepMesh(obj, _m.multiplyMatrices(inv, obj.matrixWorld)));
      } else {
        body.push(prepMesh(obj, _m.multiplyMatrices(rootInv, obj.matrixWorld)));
      }
    } else if (obj !== root) {
      const mm = /^(glow|gun|bay|eng)_/.exec(obj.name);
      if (mm) {
        const p = new Vector3().setFromMatrixPosition(_m.multiplyMatrices(rootInv, obj.matrixWorld));
        (markers[mm[1]] ||= []).push(p);
      }
    }
  });
  const parts = {};
  for (const [name, { node, list }] of Object.entries(partLists)) {
    // Blender suffixes duplicate names across models ("part_core.001", sanitized to "part_core001")
    parts[name.slice(5).replace(/(\.\d+|\d{3})$/, '')] = {
      geometry: finish(list),
      position: new Vector3().setFromMatrixPosition(_m.multiplyMatrices(rootInv, node.matrixWorld)),
    };
  }
  const geometry = finish(body);
  return { geometry, parts, markers, radius: geometry ? geometry.boundingSphere.radius : 1 };
}

// ---------------------------------------------------------------------------------------------
// Procedural geometry

export function piece(geom, color, glow = 0, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  let g = geom.index ? geom.toNonIndexed() : geom;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Color(color);
  const e = new Color(glow);
  const col = new Float32Array(n * 3);
  const gl = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col.set([c.r, c.g, c.b], i * 3);
    gl.set([e.r, e.g, e.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('aGlow', new BufferAttribute(gl, 3));
  g.applyMatrix4(new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(...r)), new Vector3(...s)));
  return g;
}

export function merged(pieces) {
  const g = mergeGeometries(pieces, false);
  g.computeVertexNormals();
  return finish([g]);
}

const H = Math.PI / 2;

/** Simple stand-ins used before/if the Blender GLBs fail to load. Nose points -Z. */
export function fallbackModel(name) {
  const markers = {};
  const parts = {};
  let pieces;
  switch (name) {
    case 'player':
      pieces = [
        piece(new ConeGeometry(0.55, 3.6, 6), 0xdfe6f2, 0, { r: [-H, 0, 0], p: [0, 0, -0.6] }),
        piece(new BoxGeometry(4.2, 0.12, 1.4), 0x9fb3cc, 0, { p: [0, 0, 0.6] }),
        piece(new BoxGeometry(0.12, 0.9, 1.0), 0x3a7bff, 0, { p: [0.9, 0.45, 0.9] }),
        piece(new BoxGeometry(0.12, 0.9, 1.0), 0x3a7bff, 0, { p: [-0.9, 0.45, 0.9] }),
        piece(new SphereGeometry(0.32, 8, 6), 0x0b2a40, 0x2aa8ff, { p: [0, 0.32, -0.6], s: [1, 0.7, 1.8] }),
        piece(new CylinderGeometry(0.28, 0.32, 0.6, 8), 0x333a46, 0, { r: [H, 0, 0], p: [0.55, 0, 1.3] }),
        piece(new CylinderGeometry(0.28, 0.32, 0.6, 8), 0x333a46, 0, { r: [H, 0, 0], p: [-0.55, 0, 1.3] }),
      ];
      markers.glow = [new Vector3(0.55, 0, 1.65), new Vector3(-0.55, 0, 1.65)];
      markers.gun = [new Vector3(1.6, 0, -0.4), new Vector3(-1.6, 0, -0.4)];
      break;
    case 'dart':
      pieces = [
        piece(new ConeGeometry(0.9, 3.2, 3), 0xc0303a, 0, { r: [-H, 0, 0] }),
        piece(new BoxGeometry(3.2, 0.12, 0.9), 0x5a1820, 0, { p: [0, 0, 0.8] }),
        piece(new SphereGeometry(0.28, 6, 4), 0x200000, 0xff3030, { p: [0, 0.25, -0.6] }),
      ];
      markers.glow = [new Vector3(0, 0, 1.6)];
      break;
    case 'wasp':
      pieces = [
        piece(new SphereGeometry(0.9, 8, 6), 0x7a3cc8, 0, { s: [1, 0.7, 1.6] }),
        piece(new BoxGeometry(0.25, 0.25, 1.6), 0x40205a, 0, { p: [0.7, 0, -1.6] }),
        piece(new BoxGeometry(0.25, 0.25, 1.6), 0x40205a, 0, { p: [-0.7, 0, -1.6] }),
        piece(new BoxGeometry(3.6, 0.1, 0.8), 0x9a6ae0, 0, { p: [0, 0.2, 0.2], r: [0, 0, 0] }),
        piece(new SphereGeometry(0.3, 6, 4), 0x100018, 0xff40ff, { p: [0, 0.35, -1.0] }),
      ];
      markers.glow = [new Vector3(0, 0, 1.5)];
      break;
    case 'hammer':
      pieces = [
        piece(new BoxGeometry(2.6, 1.6, 6), 0x5d6b52, 0),
        piece(new BoxGeometry(7, 1.1, 1.6), 0x46523e, 0, { p: [0, 0, -2.8] }),
        piece(new CylinderGeometry(0.35, 0.35, 2.4, 8), 0x2c2f33, 0, { r: [H, 0, 0], p: [2.8, 0, -4] }),
        piece(new CylinderGeometry(0.35, 0.35, 2.4, 8), 0x2c2f33, 0, { r: [H, 0, 0], p: [-2.8, 0, -4] }),
        piece(new BoxGeometry(1.2, 0.5, 0.6), 0x101010, 0xffa040, { p: [0, 0.8, -2.2] }),
      ];
      markers.glow = [new Vector3(0.8, 0, 3.1), new Vector3(-0.8, 0, 3.1)];
      markers.gun = [new Vector3(2.8, 0, -5.2), new Vector3(-2.8, 0, -5.2)];
      break;
    case 'mine': {
      pieces = [piece(new IcosahedronGeometry(1.1, 0), 0x4a4f5a, 0)];
      const dirs = new IcosahedronGeometry(1, 0).attributes.position;
      for (let i = 0; i < dirs.count; i += 3) {
        const d = new Vector3(dirs.getX(i), dirs.getY(i), dirs.getZ(i)).normalize();
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d);
        const e = new Euler().setFromQuaternion(q);
        pieces.push(piece(new ConeGeometry(0.22, 1.0, 4), 0x2a2d33, 0xff2a2a, { p: d.clone().multiplyScalar(1.4).toArray(), r: [e.x, e.y, e.z] }));
      }
      break;
    }
    case 'cruiser': {
      pieces = [
        piece(new BoxGeometry(9, 3, 30), 0x55606e, 0),
        piece(new BoxGeometry(16, 1.4, 10), 0x434c58, 0, { p: [0, 0, 4] }),
        piece(new BoxGeometry(4, 3, 6), 0x3a424d, 0x40a0ff, { p: [0, 2.4, 8] }),
      ];
      const turret = () => merged([
        piece(new CylinderGeometry(1.4, 1.8, 1.2, 8), 0x7a6a50, 0),
        piece(new BoxGeometry(0.5, 0.5, 2.6), 0x2a2a2a, 0xff6020, { p: [0, 0.4, -1.4] }),
      ]);
      [[-6.5, 1.2, 2], [6.5, 1.2, 2], [-3, 2, -9], [3, 2, -9]].forEach((p, i) => {
        parts['turret' + i] = { geometry: turret(), position: new Vector3(...p) };
      });
      parts.core = {
        geometry: merged([piece(new SphereGeometry(2.2, 12, 8), 0x301010, 0xff3040)]),
        position: new Vector3(0, 0, -14),
      };
      markers.glow = [new Vector3(-3, 0, 15.2), new Vector3(3, 0, 15.2)];
      break;
    }
    case 'mothership': {
      pieces = [
        piece(new CylinderGeometry(14, 18, 4, 16), 0x4d4a62, 0, { r: [H, 0, 0], s: [1, 1, 1] }),
        piece(new TorusGeometry(16, 1.4, 6, 24), 0x2d2a3e, 0x6a40ff),
        piece(new BoxGeometry(46, 2.4, 8), 0x3e3b52, 0, { p: [0, 0, 2] }),
      ];
      const cannon = () => merged([
        piece(new BoxGeometry(5, 4, 9), 0x6a5a7a, 0),
        piece(new CylinderGeometry(0.8, 0.8, 5, 8), 0x202028, 0xff6020, { r: [H, 0, 0], p: [0, 0, -6] }),
      ]);
      parts.wingL = { geometry: cannon(), position: new Vector3(-22, 0, 0) };
      parts.wingR = { geometry: cannon(), position: new Vector3(22, 0, 0) };
      const bay = () => merged([piece(new BoxGeometry(6, 3, 6), 0x403850, 0), piece(new BoxGeometry(4, 1.6, 0.4), 0x100808, 0xffa020, { p: [0, 0, -3.1] })]);
      parts.bayL = { geometry: bay(), position: new Vector3(-10, -5, -2) };
      parts.bayR = { geometry: bay(), position: new Vector3(10, -5, -2) };
      parts.core = { geometry: merged([piece(new SphereGeometry(4.5, 16, 12), 0x200810, 0xff2050)]), position: new Vector3(0, 0, -3) };
      break;
    }
    case 'drone':
      pieces = [
        piece(new OctahedronGeometry(0.6, 0), 0xc8d2e0, 0, { s: [1, 0.6, 1.6] }),
        piece(new SphereGeometry(0.22, 6, 4), 0x000000, 0xffa040, { p: [0, 0, 0.7] }),
      ];
      break;
    case 'carrier':
      pieces = [
        piece(new BoxGeometry(26, 7, 110), 0x7b8494, 0),
        piece(new BoxGeometry(14, 5, 20), 0x10141c, 0x30c0ff, { p: [0, 0, -46] }),
        piece(new BoxGeometry(6, 14, 18), 0x6a7282, 0x60a0ff, { p: [-9, 9, 20] }),
        piece(new BoxGeometry(40, 2.5, 36), 0x5d6574, 0, { p: [0, -2, 30] }),
      ];
      markers.glow = [new Vector3(-8, 0, 56), new Vector3(8, 0, 56), new Vector3(0, 0, 56)];
      break;
    default:
      pieces = [piece(new BoxGeometry(2, 2, 2), 0xff00ff, 0)];
  }
  const geometry = merged(pieces);
  return { geometry, parts, markers, radius: geometry.boundingSphere.radius };
}

/** Noise-displaced icosahedron, flat shaded via non-indexed normals. */
export function makeRockGeometry(seed, detail, kind = 'rock') {
  const rng = makeRng(seed);
  const g = new IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const bumps = [];
  for (let i = 0; i < 7; i++) {
    bumps.push([new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize(), rng.range(-0.35, 0.3), rng.range(2, 6)]);
  }
  const squash = new Vector3(rng.range(0.7, 1.15), rng.range(0.6, 1.0), rng.range(0.8, 1.3));
  const v = new Vector3();
  const cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    let d = cache.get(key);
    if (d === undefined) {
      d = 1;
      for (const [dir, amp, p] of bumps) d += amp * Math.pow(Math.max(0, v.dot(dir)), p);
      d += (rng() - 0.5) * 0.12;
      cache.set(key, d);
    }
    v.multiplyScalar(d).multiply(squash);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const palette = {
    rock: [0x6b5a4c, 0x7d6b5a, 0x574a40, 0x8a7a68],
    ice: [0xbcd3e6, 0xa6c2dc, 0xd8e6f2, 0x8fb0cc],
    metal: [0x3d434d, 0x4b525e, 0x2e333b, 0x5c4a3a],
    dark: [0x3a3330, 0x2f2a28, 0x453c36, 0x282422],
    ore: [0x6e4a32, 0x5a3c2a, 0x8a5a36, 0xb07a30],
    crystal: [0x8a4a9a, 0xb46ac8, 0x6a3a86, 0xe0a0f0],
    slag: [0x2a2224, 0x3a2a26, 0x221c1e, 0x5a2a1a],
  }[kind];
  for (let f = 0; f < n; f += 3) {
    _c.set(palette[Math.floor(rng() * palette.length)]);
    const k = 0.85 + rng() * 0.3;
    for (let j = 0; j < 3; j++) col.set([_c.r * k, _c.g * k, _c.b * k], (f + j) * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeBoundingSphere();
  return g;
}

export function makePickupGeometry() {
  return merged([
    piece(new OctahedronGeometry(1.1, 0), 0xffffff, 0x404040, { s: [1, 1.4, 1] }),
    piece(new TorusGeometry(1.5, 0.12, 4, 16), 0xffffff, 0x606060, { r: [H, 0, 0] }),
  ]);
}

export function makeDebrisGeometry() {
  return merged([piece(new IcosahedronGeometry(0.5, 0), 0x50555e, 0x221008, { s: [1, 0.4, 1.6] })]);
}

export function makeGateGeometry(glow = 0xffffff) {
  return merged([
    piece(new TorusGeometry(9, 0.45, 6, 32), 0x30363f, 0),
    piece(new TorusGeometry(9.7, 0.18, 4, 32), 0x000000, glow),
  ]);
}

export function makeWreckGeometry(seed) {
  const rng = makeRng(seed);
  const pieces = [];
  const count = rng.int(4, 7);
  for (let i = 0; i < count; i++) {
    const s = [rng.range(4, 14), rng.range(3, 8), rng.range(10, 40)];
    pieces.push(piece(new BoxGeometry(1, 1, 1), rng.pick([0x2a2e35, 0x23272d, 0x34383f, 0x3a2e26]), 0, {
      p: [rng.range(-10, 10), rng.range(-5, 5), rng.range(-20, 20)],
      r: [rng.range(-0.4, 0.4), rng.range(-0.6, 0.6), rng.range(-0.5, 0.5)],
      s,
    }));
  }
  for (let i = 0; i < 3; i++) {
    pieces.push(piece(new CylinderGeometry(1.2, 1.2, rng.range(10, 30), 6), 0x1c1f24, 0, {
      p: [rng.range(-12, 12), rng.range(-6, 6), rng.range(-20, 20)],
      r: [rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)],
    }));
  }
  for (let i = 0; i < 4; i++) {
    // glowing hull breaches and window strips
    pieces.push(piece(new BoxGeometry(i < 2 ? 2.4 : 0.5, i < 2 ? 1.6 : 0.5, i < 2 ? 2.4 : 9), 0x000000, i < 2 ? 0xff6a18 : 0x6ab8ff, {
      p: [rng.range(-7, 7), rng.range(-3.5, 3.5), rng.range(-14, 14)],
    }));
  }
  return merged(pieces);
}
