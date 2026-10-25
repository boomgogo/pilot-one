import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CubeCamera, Mesh, Points, Scene, ShaderMaterial, SphereGeometry,
  SRGBColorSpace, Vector3, WebGLCubeRenderTarget,
} from 'three';
import { makeRng } from '../core/rng.js';
import { NOISE } from './glsl.js';
import { Billboards, SHAPE } from './billboards.js';

// Each location tints its own sky (data.sky); these are the gas giant's colours.
const SKY = {
  base: [0.012, 0.014, 0.035], clouds: [0.10, 0.05, 0.16], wisps: [0.02, 0.10, 0.13], band: [0.20, 0.13, 0.20],
  knots: [0.25, 0.08, 0.05], density: 1, gN: [0.35, 0.82, -0.45],
};

/** Render a procedural nebula once into a cubemap (zero per-frame cost) and use it as the bg scene background. */
export function bakeSky(renderer, bgScene, size, palette = null) {
  const P = { ...SKY, ...(palette || {}) };
  const rt = new WebGLCubeRenderTarget(size, { generateMipmaps: false, colorSpace: SRGBColorSpace });
  const scene = new Scene();
  const v3 = (a) => new Vector3(...a);
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    defines: { OCTAVES: 5 },
    uniforms: {
      cBase: { value: v3(P.base) }, cClouds: { value: v3(P.clouds) }, cWisps: { value: v3(P.wisps) }, cBand: { value: v3(P.band) },
      cKnots: { value: v3(P.knots) }, uDensity: { value: P.density }, uGN: { value: v3(P.gN).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 cBase, cClouds, cWisps, cBand, cKnots, uGN;
      uniform float uDensity;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        // galactic band along a tilted great circle
        float band = exp(-pow(dot(d, uGN) / 0.22, 2.0));
        float n1 = fbm(d * 2.2 + 3.0);
        float n2 = fbm(d * 4.5 + vec3(n1 * 1.6));
        float dust = smoothstep(0.45, 0.75, fbm(d * 7.0 + 11.0));
        float lo = 0.35 - 0.2 * (uDensity - 1.0);  // denser skies: clouds cover more of it
        vec3 col = cBase;
        col += cClouds * smoothstep(lo, 0.85, n1) * 1.2 * uDensity;                // clouds
        col += cWisps * smoothstep(lo + 0.1, 0.9, n2) * 1.1 * uDensity;           // wisps
        col += cBand * band * (0.35 + 0.65 * n2) * (1.0 - 0.8 * dust);
        col += cKnots * pow(smoothstep(0.55, 0.95, n2 * n1 * 1.6), 2.0) * uDensity; // emission knots
        // faint unresolved stars
        float st = hash13(floor(d * 900.0));
        col += vec3(0.5) * step(0.9985, st) * (0.4 + band);
        gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);  // display → linear; the sRGB target re-encodes on write
      }`,
  });
  scene.add(new Mesh(new SphereGeometry(10, 32, 16), mat));
  const cam = new CubeCamera(1, 100, rt);
  cam.update(renderer, scene);
  mat.dispose();
  bgScene.background = rt.texture;
  return rt;
}

export class Stars {
  constructor(count) {
    const rng = makeRng(42);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const v = new Vector3();
    for (let i = 0; i < count; i++) {
      // concentrate some stars along the galactic band
      v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      if (i % 3 === 0) {
        const gN = new Vector3(0.35, 0.82, -0.45).normalize();
        v.addScaledVector(gN, -v.dot(gN) * 0.85).normalize();
      }
      v.multiplyScalar(90000);
      v.toArray(pos, i * 3);
      const t = rng();
      const c = t < 0.15 ? [1.0, 0.82, 0.62] : t < 0.35 ? [0.7, 0.82, 1.0] : [1, 1, 1];
      const b = 0.35 + Math.pow(rng(), 3) * 0.9;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
      size[i] = 1.0 + Math.pow(rng(), 6) * 2.6;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    this.material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uTime;
        uniform float uPR;
        varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.75 + 0.25 * sin(uTime * (1.5 + fract(position.x * 0.013) * 3.0) + position.y);
          vC = aColor * tw;
          gl_PointSize = aSize * uPR;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float d = dot(q, q);
          if (d > 1.0) discard;
          gl_FragColor = vec4(vC * (1.0 - d), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;
  }
  update(camPos, time, pixelRatio) {
    this.points.position.copy(camPos);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uPR.value = pixelRatio;
  }
}

/** Sun disc + halo billboards, faded when occluded by the planet. style: a location's sun (colour, size). */
export class Sun {
  constructor() {
    this.bb = new Billboards(4, { additive: true, depthTest: true, renderOrder: 5 });
    this.visibility = 1;
  }
  update(camPos, sunDir, visibility, style = null) {
    this.visibility = visibility;
    const bb = this.bb;
    const h = style?.halo || [1.0, 0.75, 0.5];
    const c = style?.core || [1.0, 0.92, 0.8];
    const k = style?.size || 1;
    bb.begin();
    if (visibility > 0.001) {
      const D = 80000;
      const x = camPos.x + sunDir.x * D;
      const y = camPos.y + sunDir.y * D;
      const z = camPos.z + sunDir.z * D;
      bb.push(x, y, z, 0, 0, 0, h[0], h[1], h[2], 0.35 * visibility, 22000 * k, SHAPE.GLOW);
      bb.push(x, y, z, 0, 0, 0, c[0], c[1], c[2], 1.0 * visibility, 5200 * k, SHAPE.FLARE);
      bb.push(x, y, z, 0, 0, 0, 1.0, 1.0, 1.0, 1.0 * visibility, 1500 * k, SHAPE.GLOW);
    }
    bb.end();
  }
}
