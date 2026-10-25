import { Vector3 } from 'three';
import { Billboards, SHAPE } from '../render/billboards.js';
import { PAL } from '../render/fx.js';

// Zone hazards (ai/summary.md §7.3): telegraphed volumes, each answered by a skill location 1 teaches. The danger
// markers (src/game/danger.js) show them like everything else: red where you'd be hit, while there's time to move.
//
//   strike  lightning (Crimson Nebula): a bolt comes down through the corridor after a 1.5 s charge. Move out.
//   geyser  (Frozen Moon): a plume erupting from the ground as it passes; static in the world. Move out, or roll.
// Both hit only inside the disc their marker shows (around where you were when they started): the marker is the
// truth, so moving out of the ring in any direction is safe.
//   flare   (The Corona): a wall of plasma sweeping down the whole corridor. It can't be outrun: evasive roll or bomb.
//   crossfire (Crimson Nebula): stray beams from the fleet battle, telegraphed like a gunship's laser. Move.
//
// Waves: { at, hazard: 'strike', n, spread, gap, r }, { at, hazard: 'geyser', x: [..], gap, r },
//        { at, hazard: 'flare', speed }

const STRIKE_CHARGE = 1.5;
const STRIKE_ON = 0.3;
const GEYSER_ON = 1.6;
const FLARE_CHARGE = 1.6;
const FLARE_X = 70;
const FLARE_Y = 44;

export class Hazards {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.bb = new Billboards(220, { additive: true, renderOrder: 8, minPx: 1.5 });
    this.object = this.bb.mesh;
  }

  clear() {
    this.list.length = 0;
  }

  /** A wave entry {hazard, ...}. */
  start(w) {
    const g = this.game;
    const p = g.player.pos;
    if (w.hazard === 'strike') {
      // strikes walk across the player's lane: the first right where you are, the rest either side
      for (let i = 0; i < (w.n || 1); i++) {
        const x = (w.x ?? p.x) + (i ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (w.spread ?? 13) : 0);
        this.list.push({ kind: 'strike', x, y: p.y, r: w.r ?? 4.5, t: -i * (w.gap ?? 0.45), charge: STRIKE_CHARGE, hit: false, dodged: false });
      }
    } else if (w.hazard === 'geyser') {
      const xs = Array.isArray(w.x) ? w.x : [w.x ?? p.x];
      xs.forEach((x, i) => this.list.push({ kind: 'geyser', x, y: p.y, z: (w.z ?? -560) - i * (w.gap ?? 0) * g.stage.speed, r: w.r ?? 6, on: 0, t: 0, hit: false, dodged: false }));
    } else if (w.hazard === 'crossfire') {
      // stray beams from the fleet battle: telegraphed lasers from far off to the sides (Beams, like a gunship's)
      for (let i = 0; i < (w.n || 1); i++) {
        const side = (i + (w.flip ? 1 : 0)) % 2 ? 1 : -1;
        const from = new Vector3(side * (260 + i * 30), (i % 3) * 30 - 30, -120 - i * 60);
        g.beams.fire(this, () => from, { charge: 1.3 + i * 0.35, dur: 0.7, len: 900, width: 3 });
      }
    } else if (w.hazard === 'flare') {
      this.list.push({ kind: 'flare', z: w.z ?? -720, v: w.speed ?? 150, t: 0, hit: false, dodged: false });
      g.audio?.beamCharge();
    }
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const pp = p.pos;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const h = this.list[k];
      h.t += dt;
      if (h.kind === 'strike') {
        if (h.t >= h.charge && !h.fired) {
          h.fired = true;
          g.audio?.zap();
          g.flashLight = 0.8;
          g.fx.flash(h.x, h.y, pp.z, 9, [0.7, 0.8, 1], 0.2, 0.9);
        }
        if (h.fired && h.t < h.charge + STRIKE_ON && Math.hypot(pp.x - h.x, pp.y - h.y) < h.r) this._touch(h, h.x, h.y, pp.z);
        if (h.t > h.charge + STRIKE_ON + 0.3) this.list.splice(k, 1);
      } else if (h.kind === 'geyser') {
        h.z += g.stage.speed * dt;
        const tReach = (pp.z - h.z) / Math.max(1, g.stage.speed);
        // erupts 1 s before it reaches the player's plane, for GEYSER_ON s
        if (!h.on && tReach < 1.0) {
          h.on = h.t;
          g.audio?.rumble();
        }
        const active = h.on && h.t - h.on < GEYSER_ON;
        if (active && Math.hypot(pp.x - h.x, pp.y - h.y) < h.r && Math.abs(pp.z - h.z) < h.r + 2) this._touch(h, h.x, h.y, h.z);
        if (h.z > 80) this.list.splice(k, 1);
      } else {
        if (h.t > FLARE_CHARGE) h.z += h.v * dt;
        if (!h.crossed && h.z >= pp.z) {
          h.crossed = true;
          if (Math.abs(pp.x) < FLARE_X && Math.abs(pp.y) < FLARE_Y) this._touch(h, pp.x, pp.y, pp.z);
          g.flashLight = 1;
          g.audio?.zap();
        }
        if (h.z > 60) this.list.splice(k, 1);
      }
    }
  }

  _touch(h, x, y, z) {
    const g = this.game;
    const p = g.player;
    if (p.evading) {
      if (!h.dodged) {
        h.dodged = true;
        g.onDodge(h.kind);
      }
      return;
    }
    if (h.hit) return;
    const marked = h.markT !== undefined ? +(this.game.time - h.markT).toFixed(2) : 0;
    if (p.hit(1, { src: h.kind, x, y, z, age: +h.t.toFixed(2), markedFor: marked })) h.hit = true;
  }

  /** Danger markers for hazards about to hit the player's plane (src/game/danger.js). Returns the new count. */
  markers(pool, n, horizon) {
    const g = this.game;
    const pp = g.player.pos;
    for (const h of this.list) {
      if (n >= pool.length) break;
      let t;
      let x = pp.x;
      let r = 4.5;
      let red;
      if (h.kind === 'strike') {
        t = h.charge - h.t;
        if (t < 0 || t > horizon + 0.2) continue;
        x = h.x;
        r = h.r;
        red = Math.hypot(pp.x - h.x, pp.y - h.y) < h.r;
      } else if (h.kind === 'geyser') {
        t = (pp.z - h.z) / Math.max(1, g.stage.speed);
        if (t < 0 || t > horizon) continue;
        x = h.x;
        r = h.r;
        red = Math.hypot(pp.x - h.x, pp.y - h.y) < h.r;
      } else {
        t = h.t < FLARE_CHARGE ? horizon : (pp.z - h.z) / h.v;
        if (t < 0 || t > horizon) continue;
        red = true;
      }
      h.markT ??= g.time; // first warning (telemetry: how long it was marked before a hit)
      const m = pool[n++];
      m.x = x;
      m.y = h.kind === 'flare' ? pp.y : h.y;
      m.z = pp.z;
      m.r = r;
      m.t = Math.max(0, t);
      m.red = red;
      m.kind = h.kind;
      m.hx = x;
      m.hy = h.kind === 'strike' ? 40 : h.kind === 'geyser' ? -40 : pp.y;
      m.hz = h.kind === 'geyser' ? h.z : h.kind === 'flare' ? h.z : pp.z;
    }
    return n;
  }

  draw(time) {
    const bb = this.bb;
    const g = this.game;
    const pz = g.player.pos.z;
    bb.begin();
    for (const h of this.list) {
      if (h.kind === 'strike') {
        if (!h.fired) {
          // the charge: a faint flickering filament where it will come down
          if (h.t < 0) continue;
          const k = h.t / h.charge;
          const a = (0.15 + 0.35 * k) * (0.6 + 0.4 * Math.sin(time * 50 + h.x));
          bb.push(h.x, 42, pz, 0, 84, 0, 0.6, 0.7, 1, a, 0.25 + 0.4 * k, SHAPE.BEAM);
          bb.push(h.x, 40, pz, 0, 0, 0, 0.6, 0.75, 1, 0.3 + 0.5 * k, 3 + 5 * k, SHAPE.GLOW);
        } else if (h.t < h.charge + STRIKE_ON + 0.3) {
          const k = 1 - (h.t - h.charge) / (STRIKE_ON + 0.3);
          for (let j = 0; j < 4; j++) {
            const y0 = 42 - j * 21;
            const jx = Math.sin(time * 90 + j * 7 + h.x) * 1.6;
            bb.push(h.x + jx, y0, pz, jx * 0.5, 21, 0, 0.85, 0.9, 1, k, 1.4, SHAPE.BEAM);
          }
          bb.push(h.x, h.y, pz, 0, 0, 0, 0.7, 0.8, 1, 0.8 * k, h.r * 2.4, SHAPE.GLOW);
        }
      } else if (h.kind === 'geyser') {
        const on = h.on && h.t - h.on < GEYSER_ON;
        const k = on ? Math.min(1, (h.t - h.on) * 5) * Math.min(1, (GEYSER_ON - (h.t - h.on)) * 3) : 0;
        // vents glow at the base as they come in; the plume roars up when it erupts
        bb.push(h.x, -44, h.z, 0, 0, 0, 0.7, 0.9, 1, 0.5 + 0.3 * Math.sin(time * 9 + h.x), h.r * 1.6, SHAPE.GLOW);
        if (k > 0) {
          for (let j = 0; j < 6; j++) {
            const y = -44 + j * 16 + ((time * 60 + j * 11) % 16);
            bb.push(h.x + Math.sin(time * 7 + j) * 1.5, y, h.z, 0, 14, 0, 0.82, 0.92, 1, 0.55 * k, h.r * (0.9 + j * 0.08), SHAPE.SOFT);
          }
          bb.push(h.x, 26, h.z, 0, 70, 0, 0.9, 0.97, 1, 0.5 * k, h.r * 0.7, SHAPE.BEAM);
        }
      } else {
        // the flare: a sheet of plasma across the corridor, flickering where it is before it moves
        const charging = h.t < FLARE_CHARGE;
        const a = charging ? 0.25 + 0.25 * Math.sin(time * 30) : 0.75;
        const c = PAL.gold;
        for (let j = -2; j <= 2; j++) {
          bb.push(FLARE_X, j * 18, h.z, FLARE_X * 2, 0, 0, c[0], c[1] * 0.85, c[2] * 0.6, a, charging ? 1.5 : 4, SHAPE.BEAM);
        }
        for (let i = -3; i <= 3; i++) bb.push(i * 22, 0, h.z, 0, 0, 0, 1, 0.6, 0.25, a * 0.6, 26, SHAPE.SOFT);
      }
    }
    bb.end();
  }
}
