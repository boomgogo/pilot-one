import { Group, Mesh, Quaternion, Vector3 } from 'three';
import { createShipMaterial } from '../render/materials.js';
import { PAL } from '../render/fx.js';
import { SHAPE } from '../render/billboards.js';
import { segPointDist2 } from '../core/util.js';
import { BULLET } from './shots.js';
import { enemyCanFire } from './weapons.js';
import { ENGAGE_RANGE } from './enemies.js';

// Hulks (ai/summary.md §7.3): big targets with destructible parts that are not bosses: ore haulers, a refinery, a
// battleship, guns on the ground, mirrors. They scroll past in rail space (static in the world unless the wave gives
// them their own speed); their parts take hits, score, and some fire with the enemies' weapons and rules
// (escape-time rule, charge glow). The hull itself soaks up shots. Each location brings its own defs (data.hulkDefs):
//   { model, scale, hull: [[x, y, z, r]], parts: {name: {hp, r, score, weapon, rate}}, bonus, drops, face }
// weapon: {w: 'aimed'|'fan'|'ring'|'laser'|'missiles'|'boulder', n, spread, speed, kind}
// A wave: { at, hulk: type, x, y, z, speed, rot, yaw, drop }

const CHARGE = 0.35;
const _v = new Vector3();
const _d = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const CLS = { aimed: 'medium', fan: 'medium', ring: 'medium', laser: 'instant', missiles: 'fast', boulder: 'slow', shells: 'slow' };

export class Hulks {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.defs = {};
    this.models = {};
  }

  setLocation(defs, models) {
    this.clear();
    this.defs = defs || {};
    this.models = models;
  }

  clear() {
    for (const h of this.list) this._free(h);
    this.list.length = 0;
  }

  _free(h) {
    h.group.removeFromParent();
    h.mat.dispose();
  }

  spawn(w) {
    const g = this.game;
    const def = this.defs[w.hulk];
    const model = def && this.models[def.model];
    if (!model?.geometry) return null;
    const mat = createShipMaterial({ rim: def.rim ?? 0xffb07a, rimStrength: 0.55 });
    const group = new Group();
    group.add(new Mesh(model.geometry, mat));
    const sc = (def.scale || 1) * (w.scale || 1);
    group.scale.setScalar(sc);
    const parts = [];
    let i = 0;
    for (const [name, spec] of Object.entries(def.parts)) {
      const pm = model.parts[name];
      if (!pm) continue;
      const mesh = new Mesh(pm.geometry, mat);
      mesh.position.copy(pm.position);
      group.add(mesh);
      const hp = spec.hp * g.difficulty.hpMul;
      const weapon = spec.weapon && { ...spec.weapon, ...(w.weapon || {}) };
      parts.push({
        name, mesh, spec, hp, max: hp, r: spec.r * sc, alive: true, flash: 0, weapon,
        offset: pm.position.clone().multiplyScalar(sc), world: new Vector3(), charge: 0,
        fireT: (spec.rate || weapon?.rate || 3) * (0.4 + 0.6 * ((i++ * 0.618) % 1)),
      });
    }
    const quat = new Quaternion().setFromAxisAngle(_v.set(0, 1, 0), (w.yaw ?? def.yaw ?? 0) + Math.PI);
    if (def.tilt) quat.multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), def.tilt)); // e.g. a mirror dish stood up
    if (w.rot) quat.premultiply(_q.setFromAxisAngle(_v.set(0, 0, 1), w.rot));
    const h = {
      def, w, group, mat, parts, quat, t: 0, sc, killed: 0,
      pos: new Vector3(w.x || 0, w.y || 0, w.z ?? -900),
      speed: w.speed, // closing speed (u/s); undefined: static in the world (the rail's speed)
      hull: (def.hull || [[0, 0, 0, model.radius * 0.6]]).map(([x, y, z, r]) => ({ o: new Vector3(x, y, z).multiplyScalar(sc), r: r * sc, world: new Vector3() })),
    };
    g.r.railRoot.add(group);
    this.list.push(h);
    h.seen = 0;
    h.counted = null; // the stage's stats its parts were counted in
    g.stats.raw += parts.length;
    g.tm?.event('spawn', { type: 'hulk:' + w.hulk, wave: w.id });
    this._place(h);
    return h;
  }

  _place(h) {
    for (const p of h.parts) p.world.copy(p.offset).applyQuaternion(h.quat).add(h.pos);
    for (const s of h.hull) s.world.copy(s.o).applyQuaternion(h.quat).add(h.pos);
  }

  update(dt) {
    const g = this.game;
    const diff = g.difficulty;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const h = this.list[k];
      h.t += dt;
      h.pos.z += (h.speed ?? g.stage.speed) * dt;
      if (h.w.vx) h.pos.x += h.w.vx * dt;
      if (h.w.vy) h.pos.y += h.w.vy * dt;
      this._place(h);
      // into the shoot-down ratio once you could engage it (ai/summary.md §6.2)
      if (!h.counted) {
        if (h.pos.z < 0 && h.pos.z > -ENGAGE_RANGE && g.onScreen(h.pos.x, h.pos.y, h.pos.z, 0)) h.seen += dt;
        if (h.seen >= 1.5) this.engage(h);
      }
      if (h.pos.z > (h.def.exitZ ?? 160)) {
        for (const p of h.parts) if (p.alive) g.onEnemyEscaped({ type: 'hulk', wave: h.w });
        this._free(h);
        this.list.splice(k, 1);
        continue;
      }
      for (const p of h.parts) {
        if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 6);
        if (!p.alive) {
          if (Math.random() < dt * 6) g.fx.add(p.world.x, p.world.y, p.world.z, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, 6, 0.9, 1.2, 3.5, PAL.fire, [0.25, 0.1, 0.08], 0.6, SHAPE.GLOW, 0.5);
          continue;
        }
        const wp = p.weapon;
        if (!wp) continue;
        p.charge = 0;
        const ready = enemyCanFire(g, p.world, (wp.speed || 40) * diff.bulletSpeed, CLS[wp.w] || 'medium');
        if (!ready) {
          p.fireT = Math.max(p.fireT, CHARGE);
          continue;
        }
        p.fireT -= dt * diff.fireRate;
        if (p.fireT < CHARGE) p.charge = 1 - Math.max(0, p.fireT) / CHARGE;
        if (p.fireT <= 0) {
          p.fireT = wp.rate || p.spec.rate || 3;
          this.fire(h, p);
        }
      }
    }
  }

  /** One volley from part p (the same weapons as gunships and bosses). */
  fire(h, p) {
    const g = this.game;
    const wp = p.weapon;
    const sp = (wp.speed || 40) * g.difficulty.bulletSpeed;
    const o = p.world;
    g.fx.flash(o.x, o.y, o.z, 3, [1, 0.7, 0.45], 0.1);
    _d.subVectors(g.player.pos, o).normalize();
    _s.set(1, 0, 0).addScaledVector(_d, -_d.x).normalize();
    const n = wp.n || 1;
    switch (wp.w) {
      case 'laser':
        g.beams.fire(h, () => p.world, { charge: wp.charge || 1.0, dur: wp.dur || 1.1, sweep: wp.sweep || 0, alive: () => p.alive && this.list.includes(h) });
        return;
      case 'missiles':
        for (let i = 0; i < n; i++) g.missiles.launch(1, o.x, o.y, o.z, _d.x + (i - (n - 1) / 2) * 0.5, _d.y + 0.2, _d.z);
        return;
      case 'boulder':
        // a slow rock lobbed at where you are: shoot it or move (it splits when shot)
        g.rocks.spawn(o.x, o.y, o.z, _d.x * sp, _d.y * sp, _d.z * sp - g.stage.speed, wp.size || 3.6, 1, g.rocks.kindIdx);
        return;
      case 'ring':
        g.enemies.ring(o.x, o.y, o.z, n, sp, h.t * 0.7, wp.kind ?? 3);
        break;
      case 'shells':
        for (let i = 0; i < n; i++) {
          _v.copy(_d).addScaledVector(_s, (i - (n - 1) / 2) * 0.14).normalize().multiplyScalar(sp);
          g.bullets.spawn(o.x, o.y, o.z, _v.x, _v.y, _v.z, BULLET.SHELL);
        }
        break;
      default: // aimed / fan
        for (let i = 0; i < n; i++) {
          _v.copy(_d).addScaledVector(_s, (i - (n - 1) / 2) * (wp.spread ?? 0.12)).normalize().multiplyScalar(sp);
          g.bullets.spawn(o.x, o.y, o.z, _v.x, _v.y, _v.z, wp.kind ?? (wp.w === 'fan' ? 2 : 0));
        }
    }
    g.audio?.enemyShot();
  }

  /** Player weapon segment a→b. Returns true if consumed (a part hit, or the hull soaked it up). */
  hitTest(ax, ay, az, bx, by, bz, dmg) {
    for (const h of this.list) {
      for (const p of h.parts) {
        if (!p.alive) continue;
        if (segPointDist2(ax, ay, az, bx, by, bz, p.world.x, p.world.y, p.world.z) < p.r * p.r) {
          this.damage(h, p, dmg);
          return true;
        }
      }
      for (const s of h.hull) {
        if (segPointDist2(ax, ay, az, bx, by, bz, s.world.x, s.world.y, s.world.z) < s.r * s.r) {
          this.game.fx.hit(bx, by, bz);
          return true;
        }
      }
    }
    return false;
  }

  /** Aim lock and laser: every live part as a sphere. cb(x, y, z, r, part, hulk). */
  forParts(cb) {
    for (const h of this.list) for (const p of h.parts) if (p.alive) cb(p.world.x, p.world.y, p.world.z, p.r, p, h);
  }

  engage(h) {
    const s = this.game.stats;
    if (h.counted === s) return;
    // first time: every part; a hulk carried over from the last stage: the parts still standing
    s.spawned += h.counted ? h.parts.length - h.killed : h.parts.length;
    h.counted = s;
  }

  damage(h, p, dmg) {
    const g = this.game;
    this.engage(h);
    p.hp -= dmg;
    p.flash = 1;
    g.fx.hit(p.world.x, p.world.y, p.world.z);
    g.hud.hitMarker(p.hp <= 0);
    if (p.hp > 0) return;
    p.alive = false;
    p.mesh.visible = false;
    h.killed++;
    g.onPartKilled(p.world, p.spec.explode || 1.8, p.spec.score || 500, 1.4);
    g.tm?.event('kill', { type: 'hulk:' + p.name, wave: h.w.id, by: 'shot', chain: g.chain.n });
    if (h.killed === h.parts.length) {
      // the whole hulk stripped: a bonus, its drops, a bigger blast
      const bonus = h.def.bonus || 0;
      if (bonus) g.addScore(bonus, h.pos.x, h.pos.y + 6, h.pos.z, true, `${h.def.name || 'HULK'} +${bonus}`);
      g.fx.bigExplosion(h.pos.x, h.pos.y, h.pos.z, h.def.boom || 2);
      g.shakeCamera(1.2);
      const drops = h.w.drop ? [h.w.drop] : h.def.drops || [];
      drops.forEach((d, i) => g.dropPickup(d, h.pos.x + (i - (drops.length - 1) / 2) * 8, h.pos.y, h.pos.z));
      g.tm?.event('hulk', { type: h.w.hulk, killed: true });
    }
  }

  /** Bomb wave: damage parts inside it, once per wave. */
  bomb(w, dmg) {
    for (const h of this.list) {
      for (const p of h.parts) {
        if (!p.alive || w.hit.has(p) || p.world.distanceTo(w.p) > w.r + p.r) continue;
        w.hit.add(p);
        this.damage(h, p, dmg);
      }
    }
  }

  /** Ram test against the player (hulls are kept outside the corridor, but a narrowed one can bring them close). */
  touches(pos, r) {
    for (const h of this.list) for (const s of h.hull) if (s.world.distanceToSquared(pos) < (s.r + r) ** 2) return h;
    return null;
  }

  draw(glows, time) {
    for (const h of this.list) {
      h.group.position.copy(h.pos);
      h.group.quaternion.copy(h.quat);
      let f = 0;
      for (const p of h.parts) {
        f = Math.max(f, p.flash);
        if (p.alive && p.charge > 0) glows.push(p.world.x, p.world.y, p.world.z, 0, 0, 0, 1, 0.82, 0.55, 0.4 + 0.6 * p.charge, (0.8 + 2 * p.charge) * h.sc, SHAPE.GLOW);
        else if (p.alive && p.weapon) glows.push(p.world.x, p.world.y, p.world.z, 0, 0, 0, 1, 0.4, 0.3, 0.35 + 0.15 * Math.sin(time * 6 + p.r), 0.7 * h.sc, SHAPE.GLOW);
      }
      h.mat.userData.uFlash.value = f * 0.5;
    }
  }
}
