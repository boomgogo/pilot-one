// Shared GLSL snippets.

export const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

// Ring optical density as a function of radius (world units). Requires uniforms uRing (in, out, gapIn, gapOut).
export const RING = /* glsl */ `
uniform vec4 uRing;
float ringDensity(float r) {
  float x = (r - uRing.x) / (uRing.y - uRing.x);
  if (x < 0.0 || x > 1.0) return 0.0;
  float d = 0.62 + 0.2 * sin(x * 61.0) + 0.12 * sin(x * 173.0 + 1.3) + 0.08 * sin(x * 431.0 + 0.4);
  d *= smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.94, x);
  d *= mix(0.3, 1.0, smoothstep(0.1, 0.22, x));
  float g = (r - uRing.z) / (uRing.w - uRing.z);
  if (g > 0.0 && g < 1.0) d *= 0.02 + 0.1 * smoothstep(0.35, 0.0, min(g, 1.0 - g));
  return clamp(d, 0.0, 1.0);
}
`;
