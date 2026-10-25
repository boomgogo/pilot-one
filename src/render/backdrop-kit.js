import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, Points, RingGeometry, ShaderMaterial, SphereGeometry, Vector2,
  Vector3,
} from 'three';
import { NOISE } from './glsl.js';
import { makeRng } from '../core/rng.js';

// Pieces for the later locations' backdrops (ai/summary.md §8). Only location chunks import this file, so it loads
// with them, not in the initial download. Every backdrop: bgObjects (background pass), objects (gameplay scene),
// update(time, camPos, sunDir), lightFactor(p, sunDir), dispose().

const v3 = (a) => (a instanceof Vector3 ? a : new Vector3(...a));

/**
 * A distant planet in the background pass: banded (gas), cratered (rock) or icy, lit by the sun, with a rim haze.
 * o: {radius, position, colors: [a, b, c], style: 'bands'|'rock'|'ice', haze, segs}
 */
export class FarPlanet {
  constructor(o) {
    this.uniforms = {
      uSun: { value: new Vector3(0, 1, 0) },
      uCam: { value: new Vector3() },
      cA: { value: new Color(o.colors[0]) },
      cB: { value: new Color(o.colors[1]) },
      cC: { value: new Color(o.colors[2]) },
      uHaze: { value: new Color(o.haze ?? 0x6080c0) },
      uStyle: { value: { bands: 0, rock: 1, ice: 2 }[o.style || 'bands'] },
      uTime: { value: 0 },
    };
    const segs = o.segs || 64;
    this.mesh = new Mesh(
      new SphereGeometry(o.radius, segs, Math.round(segs * 0.66)),
      new ShaderMaterial({
        uniforms: this.uniforms,
        defines: { OCTAVES: 4 },
        vertexShader: /* glsl */ `
          varying vec3 vO;
          varying vec3 vW;
          void main() {
            vO = position;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun, uCam, cA, cB, cC, uHaze;
          uniform float uStyle, uTime;
          varying vec3 vO;
          varying vec3 vW;
          ${NOISE}
          void main() {
            vec3 n = normalize(vO);
            vec3 col;
            if (uStyle < 0.5) {
              float w = fbm(n * 2.4 + vec3(0.0, 0.0, uTime * 0.003)) - 0.5;
              float t = n.y * 6.0 + w * 1.4;
              col = mix(cA, cB, 0.5 + 0.5 * sin(t * 3.0));
              col = mix(col, cC, smoothstep(0.55, 0.95, abs(n.y)) * 0.6 + 0.2 * (0.5 + 0.5 * sin(t * 9.0)));
            } else if (uStyle < 1.5) {
              float h = fbm(n * 4.0);
              float cr = smoothstep(0.6, 0.7, vnoise(n * 18.0)) * 0.3;
              col = mix(cA, cB, h) - cr * cC;
            } else {
              float h = fbm(n * 3.0 + 4.0);
              float cracks = smoothstep(0.48, 0.5, abs(vnoise(n * 9.0) - 0.5) + 0.48) * 0.25;
              col = mix(cA, cB, h) + cC * cracks;
            }
            float ndl = dot(n, uSun);
            vec3 lit = col * smoothstep(-0.1, 0.45, ndl) * (0.35 + 0.65 * max(ndl, 0.0)) * 1.15 + col * 0.02;
            vec3 v = normalize(uCam - vW);
            float rim = pow(1.0 - max(dot(n, v), 0.0), 3.5);
            lit += uHaze * rim * smoothstep(-0.2, 0.5, ndl) * 0.6;
            gl_FragColor = vec4(lit, 1.0);
          }`,
      }),
    );
    this.mesh.position.copy(v3(o.position));
    this.objects = [this.mesh];
    if (o.rings) {
      // a flat ring system around it: banded, lit on the sun's side
      const [rin, rout] = o.rings.radii;
      const ring = new Mesh(
        new RingGeometry(rin, rout, 128, 2),
        new ShaderMaterial({
          uniforms: { ...this.uniforms, uR: { value: new Vector2(rin, rout) }, cR: { value: new Color(o.rings.color) } },
          defines: { OCTAVES: 2 },
          vertexShader: /* glsl */ `
            varying vec2 vP;
            void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `
            uniform vec2 uR;
            uniform vec3 cR;
            varying vec2 vP;
            ${NOISE}
            void main() {
              float x = (length(vP) - uR.x) / (uR.y - uR.x);
              float d = (0.55 + 0.25 * sin(x * 70.0) + 0.2 * sin(x * 190.0 + 1.0)) * smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.9, 1.0, x));
              gl_FragColor = vec4(cR * (0.6 + 0.5 * d), d * 0.75);
            }`,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      ring.position.copy(this.mesh.position);
      ring.rotation.set(-Math.PI / 2 + (o.rings.tilt || 0.3), 0, o.rings.roll || 0.2);
      ring.renderOrder = 2;
      this.objects.push(ring);
    }
  }
  update(time, camPos, sunDir) {
    this.uniforms.uTime.value = time;
    this.uniforms.uSun.value.copy(sunDir);
    this.uniforms.uCam.value.copy(camPos);
  }
}

/**
 * Thousands of faint points on a band of the sky (an asteroid belt's far side, a fleet's lights, a nebula's stars),
 * following the camera like the stars do. o: {count, normal, width, colors: [hex], size, radius, seed}
 */
export class SkyBand {
  constructor(o) {
    const rng = makeRng(o.seed || 7);
    const N = v3(o.normal || [0, 1, 0]).normalize();
    const count = o.count;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const v = new Vector3();
    const cols = (o.colors || [0xffd0a0]).map((c) => new Color(c));
    for (let i = 0; i < count; i++) {
      v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      v.addScaledVector(N, -v.dot(N) * (1 - (o.width || 0.12) * (rng() * 2 - 1) * (rng() < 0.7 ? 0.4 : 1))).normalize();
      v.multiplyScalar(o.radius || 85000);
      v.toArray(pos, i * 3);
      const c = cols[Math.floor(rng() * cols.length)];
      const b = 0.25 + Math.pow(rng(), 2) * 0.75;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
      size[i] = (o.size || 1.4) * (0.6 + Math.pow(rng(), 4) * 2.2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    this.material = new ShaderMaterial({
      uniforms: { uPR: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uPR;
        varying vec3 vC;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vC = aColor;
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
    this.points.renderOrder = -9;
  }
  update(camPos, pixelRatio) {
    this.points.position.copy(camPos);
    this.material.uniforms.uPR.value = pixelRatio;
  }
}

/**
 * A glowing star body seen close (The Corona): a sphere of boiling granulation with a limb glow, plus a corona
 * shell. o: {radius, position, colors: [core, limb, corona]}
 */
export class StarBody {
  constructor(o) {
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new Vector3() },
      cCore: { value: new Color(o.colors[0]) },
      cLimb: { value: new Color(o.colors[1]) },
      cCorona: { value: new Color(o.colors[2]) },
    };
    const segs = o.segs || 64;
    this.mesh = new Mesh(
      new SphereGeometry(o.radius, segs, Math.round(segs * 0.66)),
      new ShaderMaterial({
        uniforms: this.uniforms,
        defines: { OCTAVES: 4 },
        vertexShader: /* glsl */ `
          varying vec3 vO;
          varying vec3 vW;
          void main() {
            vO = position;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uCam, cCore, cLimb;
          varying vec3 vO;
          varying vec3 vW;
          ${NOISE}
          void main() {
            vec3 n = normalize(vO);
            float g = fbm(n * 9.0 + vec3(uTime * 0.02, 0.0, uTime * 0.015));
            float spots = smoothstep(0.72, 0.8, fbm(n * 3.0 + 20.0));
            vec3 v = normalize(uCam - vW);
            float mu = max(dot(n, v), 0.0);
            vec3 col = mix(cLimb, cCore, pow(mu, 0.45)) * (0.75 + 0.5 * g) * (1.0 - 0.6 * spots);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.corona = new Mesh(
      new SphereGeometry(o.radius * 1.25, Math.round(segs * 0.6), Math.round(segs * 0.4)),
      new ShaderMaterial({
        uniforms: this.uniforms,
        defines: { OCTAVES: 3 },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uCam, cCorona;
          varying vec3 vN;
          varying vec3 vW;
          ${NOISE}
          void main() {
            vec3 v = normalize(uCam - vW);
            float f = 1.0 - abs(dot(vN, v));
            float streak = 0.6 + 0.6 * fbm(vN * 6.0 + vec3(0.0, uTime * 0.05, 0.0));
            gl_FragColor = vec4(cCorona * pow(f, 2.5) * streak * 1.3, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.corona.renderOrder = 1;
    this.mesh.position.copy(v3(o.position));
    this.corona.position.copy(this.mesh.position);
  }
  get objects() {
    return [this.mesh, this.corona];
  }
  update(time, camPos) {
    this.uniforms.uTime.value = time;
    this.uniforms.uCam.value.copy(camPos);
  }
}
