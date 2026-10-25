import { AdditiveBlending, Color, DoubleSide, MeshLambertMaterial, MeshPhongMaterial, ShaderMaterial } from 'three';

// Ships: Phong with vertex colors, plus
//  - aGlow (vec3 attribute): baked emissive per vertex (engines, cockpit, lights)
//  - iFlash (instanced float) / uFlash (uniform): white hit flash
//  - fresnel rim so silhouettes read against dark space; the rim is not fogged, so a ship's outline stays findable in
//    the nebula and the cavern (ai/summary.md §7.4)
export function createShipMaterial({ rim = 0x6fa8ff, rimStrength = 0.45 } = {}) {
  const mat = new MeshPhongMaterial({
    vertexColors: true,
    shininess: 38,
    specular: new Color(0x3a3f4a),
  });
  const uFlash = { value: 0 };
  const uRim = { value: new Color(rim).multiplyScalar(rimStrength) };
  mat.userData.uFlash = uFlash;
  mat.userData.uRim = uRim; // a location can tint the rim (data.rim): readability in fog and darkness
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFlash = uFlash;
    shader.uniforms.uRim = uRim;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aGlow;
attribute float iFlash;
varying vec3 vGlow;
varying float vFlash;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vGlow = aGlow;
vFlash = iFlash;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uFlash;
uniform vec3 uRim;
varying vec3 vGlow;
varying float vFlash;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float rimF = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
totalEmissiveRadiance += vGlow + vec3(max(vFlash, uFlash)) + uRim * rimF;`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
#ifdef USE_FOG
gl_FragColor.rgb += uRim * rimF * fogFactor;
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'ship';
  return mat;
}

/** Per-mesh flash (bosses, player) needs its own material instance (same program). */
export function cloneShipMaterial(base) {
  const m = createShipMaterial();
  m.shininess = base.shininess;
  return m;
}

// Rocks: flat-shaded Lambert. With `spin`, instances rotate in the vertex shader (no per-frame CPU matrix updates).
export function createRockMaterial({ spin = false } = {}) {
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  if (!spin) return mat;
  const uTime = { value: 0 };
  mat.userData.uTime = uTime;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aSpin;
uniform float uTime;
vec3 spinRot(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}`,
      )
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = spinRot(objectNormal, aSpin.xyz, uTime * aSpin.w);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = spinRot(transformed, aSpin.xyz, uTime * aSpin.w);\nvHit = aHit;')
      .replace('#include <common>', '#include <common>\nattribute float aHit;\nvarying float vHit;');
    // hit flash (breakable asteroid fields, src/game/fields.js)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHit;')
      .replace('#include <opaque_fragment>', 'outgoingLight += vHit * vec3(1.0, 0.62, 0.32);\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'rockspin';
  return mat;
}

// Deflector shell for inverted-wing enemies: additive fresnel hex shimmer. Brightness via instanceColor.
export function createShieldMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      varying vec3 vC;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #else
          vC = vec3(1.0);
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * n);
        vV = -mv.xyz;
        vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      varying vec3 vC;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        vec2 h = vP.xy * 3.2 + vec2(vP.z * 1.7, uTime * 0.6);
        vec2 g = abs(fract(h) - 0.5);
        float hex = smoothstep(0.42, 0.5, max(g.x, g.y));
        float I = f * 0.9 + hex * 0.35 * (0.4 + f);
        gl_FragColor = vec4(vec3(0.45, 0.85, 1.0) * I * vC.r, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}
