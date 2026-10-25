import {
  AdditiveBlending, BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending,
  ShaderMaterial, Vector2,
} from 'three';

// One draw call per system: camera-facing quads, optionally stretched along a velocity vector (streaks).
// Used for bullets, shots, particles, glows, dust, beams and danger markers.
//
// Quads are built in screen space: head and tail are projected first, then the quad is expanded around the 2D
// segment in pixels. That keeps streaks that fly along the line of sight (the player's shots, seen from the chase
// camera) from collapsing into slivers, and lets each system set a minimum on-screen size (uMinPx, uMinLen are in
// pixels at 720p and scale with the drawing-buffer height).

export const SHAPE = { GLOW: 0, RING: 1, BULLET: 2, BEAM: 3, FLARE: 4, SOFT: 5, BOLT: 6, TRAIL: 7, MARKER: 8 };

/** Drawing-buffer size in pixels, shared by every billboard material (set by Renderer.resize). */
export const BILLBOARD_RES = { value: new Vector2(1280, 720) };

const vertexShader = /* glsl */ `
uniform vec2 uRes;
uniform float uMinPx;
uniform float uMinLen;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec2 iSize;
varying vec4 vColor;
varying float vShape;
varying float vX;
varying float vA;
varying float vLen;
void main() {
  vec4 head = modelViewMatrix * vec4(iPos, 1.0);
  vec4 tail = modelViewMatrix * vec4(iPos - iVel, 1.0);
  if (head.z > -0.35) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (tail.z > -0.35) tail = mix(head, tail, (head.z + 0.35) / (head.z - tail.z));
  vec4 ch = projectionMatrix * head;
  vec4 ct = projectionMatrix * tail;
  vec2 hr = 0.5 * uRes;
  vec2 sh = ch.xy / ch.w * hr;
  vec2 st = ct.xy / ct.w * hr;
  float k = uRes.y / 720.0;
  // half-width: world size at the head's depth, floored at the system's minimum pixel size
  float w = max(iSize.x * projectionMatrix[1][1] * hr.y / -head.z, uMinPx * k);
  bool streak = dot(iVel, iVel) > 1e-10;
  vec2 d = sh - st;
  float len = streak ? length(d) : 0.0;
  vec2 dir = vec2(0.0, 1.0);
  if (len > 1.0) {
    dir = d / len;
  } else if (streak) {
    // moving straight along the line of sight: point the streak from its vanishing point
    vec4 vp = projectionMatrix * vec4((modelViewMatrix * vec4(iVel, 0.0)).xyz, 0.0);
    vec2 svp = abs(vp.w) > 1e-6 ? vp.xy / vp.w * hr : sh + vec2(0.0, 1.0);
    vec2 m = vp.w > 0.0 ? svp - sh : sh - svp;
    if (dot(m, m) > 1e-4) dir = normalize(m);
  }
  float minLen = streak ? uMinLen * k : 0.0;
  if (len < minLen) {
    st = sh - dir * minLen;
    len = minLen;
  }
  float a = mix(-w, len + w, position.y * 0.5 + 0.5);
  // (perp, dir) keeps the quad's winding for every direction (front faces only are drawn)
  vec2 p = st + dir * a + vec2(dir.y, -dir.x) * (position.x * w);
  float f = len > 1e-3 ? clamp(a / len, 0.0, 1.0) : 1.0;
  float z = mix(ct.z / ct.w, ch.z / ch.w, f);
  gl_Position = vec4(p / hr, z, 1.0);
  vColor = iColor;
  vShape = iSize.y;
  vX = position.x;
  vA = a / w;
  vLen = len / w;
}
`;

const fragmentShader = /* glsl */ `
varying vec4 vColor;
varying float vShape;
varying float vX;
varying float vA;
varying float vLen;
void main() {
  float qy = vA < 0.0 ? vA : (vA > vLen ? vA - vLen : 0.0);
  float d = length(vec2(vX, qy));
  if (d > 1.0) discard;
  vec3 col = vColor.rgb;
  float a = vColor.a;
  vec4 outc;
  if (vShape < 0.5) {            // GLOW: soft halo + hot core
    float g = 1.0 - d;
    float core = smoothstep(0.42, 0.0, d);
    outc = vec4(col + core * 0.8, (g * g * 0.75 + core * 0.6) * a);
  } else if (vShape < 1.5) {     // RING (shockwave)
    float r = exp(-pow((d - 0.78) / 0.11, 2.0));
    outc = vec4(col, r * a);
  } else if (vShape < 2.5) {     // BULLET: dark backing, coloured body, white core (normal blending, reads on bright bg)
    float body = smoothstep(0.86, 0.74, d);
    float ring = body - smoothstep(0.62, 0.5, d);
    float core = smoothstep(0.44, 0.28, d);
    vec3 c = mix(vec3(0.06, 0.0, 0.04), col * 1.2, body);
    c = mix(c, min(col * 1.6 + 0.25, vec3(1.0)), ring * 0.6);
    c = mix(c, vec3(1.0, 0.98, 0.92), core);
    outc = vec4(c, smoothstep(1.0, 0.9, d) * a);
  } else if (vShape < 3.5) {     // BEAM: flat along, soft across
    float x = abs(vX);
    float core = smoothstep(0.35, 0.0, x);
    outc = vec4(col + core, (smoothstep(1.0, 0.2, x) * 0.8 + core) * a * smoothstep(1.0, 0.6, abs(qy)));
  } else if (vShape < 4.5) {     // FLARE: glow + cross spikes
    float g = 1.0 - d;
    float spikes = max(smoothstep(0.06, 0.0, abs(vX)), smoothstep(0.06, 0.0, abs(qy))) * g;
    outc = vec4(col + smoothstep(0.25, 0.0, d), (g * g * g + spikes * 0.9) * a);
  } else if (vShape < 5.5) {     // SOFT: smooth puff (smoke / dust)
    float g = 1.0 - d;
    outc = vec4(col, g * g * a);
  } else if (vShape < 6.5) {     // BOLT: hot white head, coloured edge, tail fading back toward the gun
    float t = vLen > 0.01 ? clamp(vA / vLen, 0.0, 1.0) : 1.0;
    float core = smoothstep(0.55, 0.0, abs(vX)) * smoothstep(1.0, 0.5, d);
    float edge = smoothstep(1.0, 0.55, d);
    vec3 c = mix(col, vec3(1.0), core * (0.3 + 0.7 * t));
    outc = vec4(c * (1.0 + 0.4 * t), edge * mix(0.1, 1.0, t * t) * a);
  } else if (vShape < 7.5) {     // TRAIL: soft streak fading toward the tail
    float t = vLen > 0.01 ? clamp(vA / vLen, 0.0, 1.0) : 1.0;
    float g = 1.0 - d;
    outc = vec4(col, g * g * t * t * a);
  } else {                        // MARKER: faint filled disc with a crisp rim
    float rim = smoothstep(1.0, 0.93, d) - smoothstep(0.86, 0.79, d);
    outc = vec4(col, (rim + smoothstep(1.0, 0.9, d) * 0.14) * a);
  }
  gl_FragColor = outc;
}
`;

export class Billboards {
  constructor(capacity, { additive = true, depthTest = true, renderOrder = 0, minPx = 0, minLen = 0 } = {}) {
    this.capacity = capacity;
    this.count = 0;
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity * 2);
    this.attrs = [
      ['iPos', this.pos, 3],
      ['iVel', this.vel, 3],
      ['iColor', this.col, 4],
      ['iSize', this.size, 2],
    ].map(([name, arr, n]) => {
      const a = new InstancedBufferAttribute(arr, n);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    });
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new ShaderMaterial({
      uniforms: { uRes: BILLBOARD_RES, uMinPx: { value: minPx }, uMinLen: { value: minLen } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin() {
    this.count = 0;
  }

  push(x, y, z, vx, vy, vz, r, g, b, a, size, shape) {
    const i = this.count;
    if (i >= this.capacity) return;
    const i3 = i * 3;
    const i4 = i * 4;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i4] = r;
    this.col[i4 + 1] = g;
    this.col[i4 + 2] = b;
    this.col[i4 + 3] = a;
    this.size[i * 2] = size;
    this.size[i * 2 + 1] = shape;
    this.count = i + 1;
  }

  end() {
    const n = this.count;
    this.geometry.instanceCount = n;
    if (n === 0) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}
