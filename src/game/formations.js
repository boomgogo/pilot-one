import { CatmullRomCurve3, Vector3 } from 'three';

// Arcade formations in rail-local space (x right, y up, -z ahead; the player sits near z=0, camera at z≈+12).
// Each template returns, for member i of n: waypoints, a start delay and how the ship faces.
// Waves transform templates (mirror / flipY / rotate around the forward axis / offset) so one shape gives many variants,
// e.g. a horizontal sweep rotated 90° becomes a vertical column: roll your wide shot to match it.

const TAU = Math.PI * 2;

export const TEMPLATES = {
  /** Head-on V: approaches, then breaks outward around the player. */
  vee(i, n) {
    const k = i - (n - 1) / 2;
    const side = k === 0 ? 0 : Math.sign(k);
    const sx = k * 5.5;
    const sz = Math.abs(k) * 6;
    const lead = side === 0;
    return {
      points: [
        [sx, 6, -440 + sz],
        [sx, 5, -260 + sz],
        [sx * 1.1, 3, -130 + sz],
        [sx * 1.25 + side * 10, lead ? 8 : 4, -62 + sz],
        [sx * 1.4 + side * 34, lead ? 26 : 14, 6 + sz],
        [sx * 1.4 + side * 64, lead ? 46 : 30, 60 + sz],
      ],
      delay: 0,
      speed: 78,
    };
  },

  /** Chain entering from the side and crossing in front of the player. */
  sweep(i) {
    return {
      points: [
        [-95, 4, -210],
        [-48, 6, -155],
        [-16, 4, -122],
        [16, 0, -112],
        [48, -2, -132],
        [95, 0, -185],
      ],
      delay: i * 0.34,
      speed: 70,
    };
  },

  /** Overtakes from behind, flies ahead, U-turns and comes back past the player. */
  overtake(i) {
    return {
      points: [
        [16, -14, 60],
        [14, -8, 4],
        [9, 0, -110],
        [3, 8, -200],
        [-9, 10, -218],
        [-18, 6, -172],
        [-18, 2, -92],
        [-12, -6, -6],
        [-8, -16, 60],
      ],
      delay: i * 0.3,
      speed: 82,
    };
  },

  /** Corkscrew down the corridor around the player. */
  helix(i) {
    const pts = [];
    for (let j = 0; j < 18; j++) {
      const ang = j * 0.52;
      pts.push([15 * Math.cos(ang), 11 * Math.sin(ang), -450 + j * 28]);
    }
    return { points: pts, delay: i * 0.27, speed: 72 };
  },

  /** Ring that approaches, spins, tightens, then bursts outward. */
  ring(i, n) {
    const a = (i / n) * TAU;
    const r = 13;
    const pts = [
      [r * Math.cos(a), r * Math.sin(a), -450],
      [r * Math.cos(a), r * Math.sin(a), -210],
    ];
    for (let k = 1; k <= 9; k++) {
      const b = a + (k * TAU) / 8;
      pts.push([r * Math.cos(b), r * Math.sin(b), -175 + k * 4]);
    }
    const c = a + (10 * TAU) / 8;
    pts.push([r * 0.35 * Math.cos(c), r * 0.35 * Math.sin(c), -100]);
    pts.push([r * 2.8 * Math.cos(c + 0.6), r * 2.8 * Math.sin(c + 0.6), 30]);
    return { points: pts, delay: 0, speed: 58, fireWindow: 2 };
  },

  /** Dive in from above, cross in front, exit below. */
  dive(i) {
    return {
      points: [
        [0, 55, -210],
        [0, 24, -160],
        [2, 5, -118],
        [8, -13, -86],
        [17, -34, -55],
        [26, -58, -22],
      ],
      delay: i * 0.3,
      speed: 72,
    };
  },

  /** Red squadron chain: sine + loop path across the view. Kill all 5 for a POW. */
  snake(i) {
    return {
      points: [
        [-85, 0, -245],
        [-46, 10, -205],
        [-16, 0, -172],
        [14, -10, -190],
        [40, 2, -232],
        [28, 16, -262],
        [0, 10, -218],
        [-20, -4, -162],
        [-42, -12, -124],
        [-95, -8, -112],
      ],
      delay: i * 0.34,
      speed: 56,
    };
  },

  /** Gunship: enters, strafes slowly in front, exits upward. */
  hold() {
    return {
      points: [
        [0, 10, -340],
        [0, 6, -210],
        [-6, 4, -150],
        [-16, 2, -140],
        [14, 0, -134],
        [-12, 4, -140],
        [12, 6, -146],
        [0, 30, -175],
        [0, 75, -230],
      ],
      delay: 0,
      speed: 26,
      face: 'player',
    };
  },

  /** Drifting mine field (static in the world, so it approaches at roughly scroll speed). */
  mines(i) {
    const x = (((i * 37) % 7) - 3) * 8 + ((i * 13) % 3) * 2;
    const y = (((i * 53) % 5) - 2) * 6.5;
    return { points: [[x, y, -470], [x * 1.02, y, -200], [x * 1.04, y, 45]], delay: i * 0.22, speed: 52, face: 'none' };
  },

  /** 3×3 wall approaching head-on, then bursting outward. */
  wall(i) {
    const col = (i % 3) - 1;
    const row = Math.floor(i / 3) - 1;
    const x = col * 9;
    const y = row * 7;
    return {
      points: [
        [x, y, -450],
        [x, y, -220],
        [x * 1.1, y * 1.1, -118],
        [x * 2.5 + (col === 0 ? 7 : 0), y * 2.5 + (row === 0 && col === 0 ? 7 : 0), -42],
        [x * 6 + (col === 0 ? 20 : 0), y * 6 + (row === 0 && col === 0 ? 20 : 0), 40],
      ],
      delay: 0,
      speed: 52,
    };
  },

  /**
   * Laser-gate post (wave {gate: true}): two armored gunships just outside the corridor close in on the player's
   * plane with a fence of beams strung between them (src/game/weapons.js Beams.fence).
   */
  gatepost(i) {
    const x = i ? 36 : -36;
    return {
      points: [
        [x, 2, -470],
        [x, 1, -300],
        [x, 0, -150],
        [x, 0, 0],
        [x * 1.05, 0, 70],
        [x * 1.6, 6, 150],
      ],
      delay: 0,
      speed: 45,
      face: 'path',
    };
  },

  /** Mining-drone swarm (The Belt): a loose cloud that closes in on the corridor and streams past. */
  swarm(i, n) {
    const a = i * 2.399; // golden angle: an even scatter
    const r = 6 + 22 * Math.sqrt((i + 0.5) / n);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.6;
    return {
      points: [
        [x * 2.2, y * 2.2, -470],
        [x * 1.2, y * 1.2, -300],
        [x * 0.7 + Math.sin(a * 3) * 6, y * 0.7, -160],
        [x * 0.55, y * 0.55, -60],
        [x * 1.6, y * 1.6, 60],
      ],
      delay: (i % 4) * 0.18 + Math.floor(i / 4) * 0.12,
      speed: 96,
    };
  },

  /** Launched from a boss bay: relative to the boss position. Mirror for the other bay. */
  launch(i) {
    return {
      points: [
        [0, 0, 0],
        [4, -4, 12],
        [14, -6, 50],
        [20, 0, 110],
        [24, 10, 175],
        [30, 22, 230],
      ],
      delay: i * 0.35,
      speed: 60,
    };
  },
};

const _v = new Vector3();

/**
 * Build the per-member paths of a wave (done once at stage load, so no runtime allocation).
 * wave: {f, n, mirror, flipY, rot, dx, dy, dz, sx, sy, speed, delay} (sx, sy: squeeze the shape, e.g. in a canyon)
 */
export function buildMembers(wave) {
  const tpl = TEMPLATES[wave.f];
  if (!tpl) throw new Error('unknown formation ' + wave.f);
  const n = wave.n || 1;
  const cos = Math.cos(wave.rot || 0);
  const sin = Math.sin(wave.rot || 0);
  const members = [];
  for (let i = 0; i < n; i++) {
    const m = tpl(i, n, wave);
    const pts = m.points.map(([x, y, z]) => {
      if (wave.mirror) x = -x;
      if (wave.flipY) y = -y;
      x *= wave.sx ?? 1;
      y *= wave.sy ?? 1;
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      return new Vector3(rx + (wave.dx || 0), ry + (wave.dy || 0), z + (wave.dz || 0));
    });
    const curve = new CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = 160;
    const length = curve.getLength();
    members.push({
      index: i,
      curve,
      length,
      speed: (wave.speed || m.speed) * (wave.speedMul || 1),
      delay: m.delay * (wave.delayMul || 1) + (wave.stagger || 0) * i,
      face: wave.face || m.face || 'path',
      fireWindow: m.fireWindow || 0,
      start: curve.getPointAt(0, _v).clone(),
    });
  }
  return members;
}
