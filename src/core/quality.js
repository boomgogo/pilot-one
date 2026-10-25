// Quality tiers + dynamic resolution. Target: integrated GPUs and entry-level phones (CLAUDE.md spec).

export const TIERS = {
  low: {
    name: 'low', dprCap: 1.0, minScale: 0.55, antialias: false,
    stars: 1400, dust: 110, particles: 700, sceneryRocks: 0.45, skySize: 256, planetSegs: 72, debris: 40,
  },
  medium: {
    name: 'medium', dprCap: 1.35, minScale: 0.6, antialias: true,
    stars: 2600, dust: 220, particles: 1400, sceneryRocks: 0.75, skySize: 512, planetSegs: 112, debris: 80,
  },
  high: {
    name: 'high', dprCap: 2.0, minScale: 0.65, antialias: true,
    stars: 4200, dust: 360, particles: 2200, sceneryRocks: 1.0, skySize: 1024, planetSegs: 160, debris: 120,
  },
};

export const isTouch =
  typeof window !== 'undefined' &&
  (('ontouchstart' in window && navigator.maxTouchPoints > 0) || window.matchMedia?.('(pointer: coarse)').matches);

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (isTouch && Math.min(screen.width, screen.height) < 820);

/** Guess before the GL context exists (decides MSAA). */
export function preliminaryTier(override) {
  if (TIERS[override]) return override;
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (isMobile) return mem <= 3 || cores <= 4 ? 'low' : 'medium';
  return 'medium';
}

/** Refine the tier once the GPU is known. */
export function refineTier(tier, gl, override) {
  if (TIERS[override]) return { tier: override, gpu: gpuName(gl) };
  const gpu = gpuName(gl);
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) return { tier: 'low', gpu };
  if (isMobile) {
    // Recent Adreno/Apple/Mali-G7x+ handle medium; everything else stays low.
    if (/apple gpu|adreno \(tm\) (6[4-9]\d|7\d\d|8\d\d)|mali-g(7[1-9]|[89]\d|\d{3})|immortalis/.test(g) && tier !== 'low') return { tier: 'medium', gpu };
    return { tier: tier === 'medium' ? 'medium' : 'low', gpu };
  }
  if (/nvidia|geforce|rtx|quadro|radeon rx|radeon pro|apple m\d (pro|max|ultra)|arc a\d/.test(g)) return { tier: 'high', gpu };
  return { tier: 'medium', gpu };
}

function gpuName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return 'unknown';
  }
}

/**
 * Adjusts the render scale so the frame time stays near the target.
 * Uses rAF deltas over ~1 s windows with hysteresis to avoid oscillation.
 */
export class ResolutionController {
  constructor(tier) {
    this.setTier(tier);
    this.scale = 1;
    this.acc = 0;
    this.frames = 0;
    this.goodWindows = 0;
    this.warmup = 2;
  }
  setTier(tier) {
    this.tier = TIERS[tier];
  }
  /**
   * Returns true if the scale changed. Downscale only when clearly struggling (< ~48 fps averaged over a
   * second), so 50 Hz / jittery displays are left alone; upscale after a few comfortable windows.
   */
  sample(dtMs) {
    this.acc += dtMs;
    this.frames++;
    if (this.acc < 1000) return false;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    if (this.warmup > 0) {
      // ignore the first windows: shader compiles and asset uploads cause one-off hitches
      this.warmup--;
      return false;
    }
    const prev = this.scale;
    if (avg > 21) {
      this.scale = Math.max(this.tier.minScale, this.scale - (avg > 30 ? 0.15 : 0.08));
      this.goodWindows = 0;
    } else if (avg < 18.5) {
      if (++this.goodWindows >= 3) {
        this.scale = Math.min(1, this.scale + 0.05);
        this.goodWindows = 0;
      }
    } else {
      this.goodWindows = 0;
    }
    return prev !== this.scale;
  }
  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.tier.dprCap) * this.scale;
  }
}
