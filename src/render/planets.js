import {
  AdditiveBlending, DoubleSide, Mesh, RingGeometry, ShaderMaterial, SphereGeometry, Vector3, Vector4,
} from 'three';
import { NOISE, RING } from './glsl.js';
import { smoothstep } from '../core/util.js';

// Gas giant at the world origin, rings in the XZ plane (axis +Y). Lives in the background pass.

const _v = new Vector3();

export class GasGiant {
  /**
   * @param {object} o  {radius, ringIn, ringOut, gapIn, gapOut, segs, octaves, palette}
   */
  constructor(o) {
    this.R = o.radius;
    this.ring = new Vector4(o.ringIn, o.ringOut, o.gapIn, o.gapOut);
    this.center = new Vector3(0, 0, 0);
    this.uniforms = {
      uSun: { value: new Vector3(0, 1, 0) },
      uTime: { value: 0 },
      uRing: { value: this.ring },
      uR: { value: this.R },
      uBolt: { value: new Vector4(0, 1, 0, 0) },
      uCam: { value: new Vector3() },
    };
    const u = this.uniforms;

    this.planet = new Mesh(
      new SphereGeometry(this.R, o.segs, Math.round(o.segs * 0.66)),
      new ShaderMaterial({
        uniforms: u,
        defines: { OCTAVES: o.octaves },
        vertexShader: /* glsl */ `
          varying vec3 vW;
          varying vec3 vO;
          void main() {
            vO = position;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          uniform float uTime;
          uniform float uR;
          uniform vec4 uBolt;
          uniform vec3 uCam;
          varying vec3 vW;
          varying vec3 vO;
          ${NOISE}
          ${RING}
          void main() {
            vec3 n = normalize(vO);
            float lat = n.y;
            float lon = atan(n.z, n.x);
            vec3 q = n * 2.6 + vec3(0.0, 0.0, uTime * 0.004);
            float warp = fbm(q * 1.7) - 0.5;
            float t = lat * 7.5 + warp * 1.1;
            float bands = 0.5 + 0.5 * sin(t * 3.1);
            float fine = 0.5 + 0.5 * sin(t * 11.0 + warp * 4.0);
            vec3 cA = vec3(0.86, 0.72, 0.52);
            vec3 cB = vec3(0.62, 0.42, 0.30);
            vec3 cC = vec3(0.92, 0.88, 0.78);
            vec3 cD = vec3(0.32, 0.50, 0.62);
            vec3 col = mix(cA, cB, bands);
            col = mix(col, cC, fine * 0.35);
            col = mix(col, cD, smoothstep(0.62, 0.95, abs(lat)) * 0.7);
            // great storm
            float sd = length(vec2((lon - 1.9) * 2.2, (lat + 0.28) * 6.0));
            col = mix(col, vec3(0.78, 0.36, 0.22), smoothstep(1.0, 0.5, sd + warp * 0.6) * 0.8);

            float ndl = dot(n, uSun);
            float diff = smoothstep(-0.12, 0.45, ndl) * (0.45 + 0.55 * max(ndl, 0.0));
            // ring shadow
            float rt = -dot(vW, vec3(0.0, 1.0, 0.0)) / (uSun.y + 1e-5);
            if (rt > 0.0) {
              vec3 h = vW + uSun * rt;
              diff *= 1.0 - 0.7 * ringDensity(length(h.xz));
            }
            vec3 lit = col * diff * 1.05;
            // night side: faint airglow + lightning
            float night = smoothstep(0.0, -0.3, ndl);
            lit += col * vec3(0.025, 0.03, 0.06) * night;
            if (uBolt.w > 0.0) {
              float bolt = smoothstep(0.994, 1.0, dot(n, uBolt.xyz)) * uBolt.w;
              lit += vec3(0.55, 0.65, 1.0) * bolt * (0.5 + 0.5 * vnoise(n * 400.0)) * 1.4;
            }
            // limb haze, only on the day side
            vec3 v = normalize(uCam - vW);
            float rim = pow(1.0 - max(dot(n, v), 0.0), 4.0);
            lit += vec3(0.35, 0.5, 0.8) * rim * smoothstep(-0.05, 0.5, ndl) * 0.35;
            gl_FragColor = vec4(lit, 1.0);
          }`,
      }),
    );

    this.atmo = new Mesh(
      new SphereGeometry(this.R * 1.035, Math.round(o.segs * 0.6), Math.round(o.segs * 0.4)),
      new ShaderMaterial({
        uniforms: u,
        vertexShader: /* glsl */ `
          varying vec3 vW;
          varying vec3 vN;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          uniform vec3 uCam;
          varying vec3 vW;
          varying vec3 vN;
          void main() {
            vec3 v = normalize(uCam - vW);
            float f = 1.0 - abs(dot(vN, v));
            float rim = pow(f, 6.0);
            float lit = smoothstep(-0.25, 0.4, dot(vN, uSun));
            float fwd = pow(max(dot(-v, uSun), 0.0), 12.0);
            vec3 c = vec3(0.3, 0.5, 0.95) * rim * (0.04 + 0.5 * lit) + vec3(1.0, 0.65, 0.4) * fwd * rim * 2.0;
            gl_FragColor = vec4(c, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );

    const ringGeo = new RingGeometry(o.ringIn, o.ringOut, 256, 3);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new Mesh(
      ringGeo,
      new ShaderMaterial({
        uniforms: u,
        defines: { OCTAVES: 3 },
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          uniform vec3 uCam;
          uniform float uR;
          varying vec3 vW;
          ${NOISE}
          ${RING}
          void main() {
            float r = length(vW.xz);
            float d = ringDensity(r);
            float clump = 0.75 + 0.5 * vnoise(vW * 0.02) * vnoise(vW * 0.11 + 7.0);
            d *= clump;
            if (d < 0.004) discard;
            vec3 base = mix(vec3(0.78, 0.70, 0.60), vec3(0.62, 0.72, 0.84), smoothstep(0.3, 0.9, (r - uRing.x) / (uRing.y - uRing.x)));
            float sunSide = sign(uSun.y);
            float camSide = sign(uCam.y - vW.y);
            float lit = sunSide == camSide ? 1.0 : 0.12 + 0.3 * (1.0 - d);  // back-lit rings glow where thin
            // planet shadow on the rings
            vec3 oc = vW;
            float b = dot(oc, uSun);
            float c = dot(oc, oc) - uR * uR;
            float h = b * b - c;
            float shadow = (h > 0.0 && -b - sqrt(h) > 0.0) ? 0.06 : 1.0;
            vec3 col = base * lit * shadow * (0.6 + 0.6 * abs(uSun.y));
            gl_FragColor = vec4(col, d * 0.9);
          }`,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );

    this.group = [this.planet, this.atmo, this.rings];
    this.atmo.renderOrder = 1;
    this.rings.renderOrder = 2;
  }

  addTo(scene) {
    for (const m of this.group) scene.add(m);
  }

  update(time, camPos, sunDir) {
    this.uniforms.uTime.value = time;
    this.uniforms.uSun.value.copy(sunDir);
    this.uniforms.uCam.value.copy(camPos);
  }

  /** Lightning flash on the cloud tops near a world point. */
  setBolt(worldPoint, intensity) {
    _v.copy(worldPoint).normalize();
    this.uniforms.uBolt.value.set(_v.x, _v.y, _v.z, intensity);
  }

  /** 0 = fully occluded by the planet, 1 = sun visible (soft edge from the atmosphere). */
  sunVisibility(p, sunDir) {
    const b = p.dot(sunDir);
    if (b > 0) return 1; // planet is behind us relative to the sun
    _v.copy(p).addScaledVector(sunDir, -b);
    const d = _v.length();
    return smoothstep(this.R * 0.99, this.R * 1.06, d);
  }

  ringDensity(r) {
    const [rin, rout, gin, gout] = [this.ring.x, this.ring.y, this.ring.z, this.ring.w];
    const x = (r - rin) / (rout - rin);
    if (x < 0 || x > 1) return 0;
    let d = 0.62 + 0.2 * Math.sin(x * 61) + 0.12 * Math.sin(x * 173 + 1.3) + 0.08 * Math.sin(x * 431 + 0.4);
    d *= smoothstep(0, 0.05, x) * (1 - smoothstep(0.94, 1, x));
    d *= 0.3 + 0.7 * smoothstep(0.1, 0.22, x);
    const g = (r - gin) / (gout - gin);
    if (g > 0 && g < 1) d *= 0.05;
    return Math.max(0, Math.min(1, d));
  }

  /** Light factor at a point: planet umbra and ring shadow. */
  lightFactor(p, sunDir) {
    let f = this.sunVisibility(p, sunDir);
    const t = -p.y / (sunDir.y || 1e-5);
    if (t > 0) {
      const hx = p.x + sunDir.x * t;
      const hz = p.z + sunDir.z * t;
      f *= 1 - 0.7 * this.ringDensity(Math.hypot(hx, hz));
    }
    return f;
  }
}

export class Moon {
  constructor(radius, position, segs) {
    this.mesh = new Mesh(
      new SphereGeometry(radius, segs, Math.round(segs * 0.66)),
      new ShaderMaterial({
        uniforms: { uSun: { value: new Vector3(0, 1, 0) } },
        defines: { OCTAVES: 4 },
        vertexShader: /* glsl */ `
          varying vec3 vO;
          void main() { vO = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          varying vec3 vO;
          ${NOISE}
          void main() {
            vec3 n = normalize(vO);
            float h = fbm(n * 5.0);
            float cr = smoothstep(0.62, 0.7, vnoise(n * 14.0)) * 0.25;
            vec3 col = mix(vec3(0.42, 0.40, 0.42), vec3(0.72, 0.68, 0.64), h) - cr;
            float ndl = dot(n, uSun);
            vec3 lit = col * smoothstep(-0.05, 0.4, ndl) * (0.3 + 0.7 * max(ndl, 0.0)) * 1.2 + col * 0.015;
            gl_FragColor = vec4(lit, 1.0);
          }`,
      }),
    );
    this.mesh.position.copy(position);
  }
  update(sunDir) {
    this.mesh.material.uniforms.uSun.value.copy(sunDir);
  }
}

/**
 * Location 1's backdrop: the gas giant (planet, atmosphere, rings) and its moon. Every location's backdrop has the same
 * shape: bgObjects (background pass), objects (gameplay scene, world space), update(), lightFactor(), dispose(), and
 * optionally setBolt() for lightning.
 */
export class GasGiantBackdrop {
  constructor(loc, tier) {
    this.planet = new GasGiant({ ...loc.planet, segs: tier.planetSegs, octaves: tier.name === 'low' ? 3 : 4 });
    this.moon = loc.moon ? new Moon(loc.moon.radius, new Vector3(...loc.moon.position), 48) : null;
    this.bgObjects = [...this.planet.group, ...(this.moon ? [this.moon.mesh] : [])];
    this.objects = [];
  }
  update(time, camPos, sunDir) {
    this.planet.update(time, camPos, sunDir);
    this.moon?.update(sunDir);
  }
  lightFactor(p, sunDir) {
    return this.planet.lightFactor(p, sunDir);
  }
  setBolt(worldPoint, intensity) {
    this.planet.setBolt(worldPoint, intensity);
  }
}
