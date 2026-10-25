import { Group, Mesh, Quaternion, Vector3 } from 'three';
import { createShipMaterial } from '../render/materials.js';
import { SHAPE } from '../render/billboards.js';
import { PAL } from '../render/fx.js';
import { buildMembers } from './formations.js';
import { segPointDist2 } from '../core/util.js';

// Bosses live in rail-local space and face the player. Parts are separate meshes with their own hp.

const _v = new Vector3();
const _d = new Vector3();
const _side = new Vector3();
const _vert = new Vector3();
const _q = new Quaternion();
const FACE = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI); // nose (-Z) toward the player (+Z)

// Boss definitions. A location lists its bosses (data.bossDefs); later locations bring their own, with their own
// behaviour hooks (def.move, def.attack, def.coreVulnerable, def.start), so their code loads with the location.
export const CRUISER = {
  type: 'cruiser',
    // hullR: the hull's shot-absorbing sphere (world units), kept inside the turrets so every turret can be hit
    name: 'CRUISER', model: 'cruiser', bodyR: 12, hullR: 9, hold: new Vector3(0, 2, -150), enterFrom: -640, scale: 2.0, pitch: 0.45,
    parts: {
      turret0: { hp: 30, r: 2.6 },
      turret1: { hp: 30, r: 2.6 },
      turret2: { hp: 30, r: 2.6 },
      turret3: { hp: 30, r: 2.6 },
      core: { hp: 140, r: 3.2, core: true },
    },
    score: 10000, partScore: 1000, drops: ['pow', 'shield'],
};

export const MOTHERSHIP = {
  type: 'mothership',
    name: 'MOTHERSHIP', model: 'mothership', bodyR: 17, hold: new Vector3(0, 6, -205), enterFrom: -820, scale: 1.6, pitch: 0.3,
    parts: {
      wingL: { hp: 55, r: 5.0 },
      wingR: { hp: 55, r: 5.0 },
      bayL: { hp: 40, r: 4.2 },
      bayR: { hp: 40, r: 4.2 },
      core: { hp: 300, r: 5.0, core: true },
    },
    score: 50000, partScore: 2500, drops: ['pow', 'bomb'],
};

/** True if the model has every destructible part the boss logic needs. */
export function bossModelOk(def, model) {
  return Object.keys(def.parts).every((k) => model?.parts?.[k]);
}

export class Boss {
  constructor(game, def, model) {
    this.game = game;
    this.type = def.type;
    this.def = def;
    this.name = this.def.name;
    this.group = new Group();
    this.bodyMat = createShipMaterial({ rim: 0xff7a9a, rimStrength: 0.7 });
    this.body = new Mesh(model.geometry, this.bodyMat);
    this.body.frustumCulled = false;
    this.group.add(this.body);
    this.parts = [];
    for (const [name, spec] of Object.entries(this.def.parts)) {
      const pm = model.parts[name];
      if (!pm) continue;
      const mat = createShipMaterial({ rim: 0xff7a9a, rimStrength: 0.7 });
      const mesh = new Mesh(pm.geometry, mat);
      mesh.position.copy(pm.position);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.parts.push({ name, mesh, mat, offset: pm.position.clone().multiplyScalar(this.def.scale), base: spec.hp, hp: spec.hp, max: spec.hp, r: spec.r * this.def.scale, core: !!spec.core, alive: true, flash: 0, fireT: 1 + this.parts.length * 0.4, world: new Vector3() });
    }
    this.group.scale.setScalar(this.def.scale);
    this.tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -this.def.pitch); // nose down
    this.pos = new Vector3();
    this.quat = new Quaternion();
    this.active = false;
    this.launchQueue = [];
    this.objects = [this.group];
    if (this.type === 'mothership' || def.launches) {
      this.launchL = buildMembers({ f: 'launch', n: 3, mirror: true });
      this.launchR = buildMembers({ f: 'launch', n: 3 });
    }
  }

  get maxHp() {
    return this.parts.reduce((a, p) => a + p.max, 0);
  }
  get hp() {
    return this.parts.reduce((a, p) => a + Math.max(0, p.hp), 0);
  }

  start(timeLimit) {
    const d = this.def;
    this.active = true;
    this.state = 'enter';
    this.t = 0;
    this.timeLimit = timeLimit;
    this.phase = 1;
    this.spiral = 0;
    this.launchT = 4;
    this.beamT = 3;
    this.coreT = 1;
    this.dyingT = 0;
    this.bayCount = 0;
    this.game.beams.clearOwner(this);
    this.launchQueue.length = 0;
    for (const p of this.parts) {
      p.max = p.base * this.game.difficulty.hpMul * (d.hpScale || 1); // later bosses meet a fully powered ship
      p.hp = p.max;
      p.alive = true;
      p.mesh.visible = true;
      p.flash = 0;
    }
    // every part is a kill in the shoot-down ratio (ai/summary.md §6.2)
    this.game.stats.spawned += this.parts.length;
    this.game.stats.raw += this.parts.length;
    this.pos.set(d.hold.x, d.hold.y, d.enterFrom);
    this.quat.copy(FACE);
    this.group.visible = true;
    d.start?.(this);
  }

  coreVulnerable() {
    if (this.def.coreVulnerable) return this.def.coreVulnerable(this);
    if (this.type === 'cruiser') return this.parts.every((p) => p.core || !p.alive);
    return this.phase >= 2;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const d = this.def;
    this.t += dt;
    const t = this.t;

    if (this.state === 'enter') {
      const k = Math.min(1, t / 5);
      const e = 1 - Math.pow(1 - k, 3);
      this.pos.z = d.enterFrom + (d.hold.z - d.enterFrom) * e;
      if (k >= 1) this.state = 'fight';
    } else if (this.state === 'fight') {
      const tt = t - 5;
      if (d.move) {
        d.move(this, tt, dt);
      } else if (this.type === 'cruiser') {
        this.pos.set(16 * Math.sin(tt * 0.45), d.hold.y + 5 * Math.sin(tt * 0.7), d.hold.z + 14 * Math.sin(tt * 0.33));
      } else {
        this.pos.set(12 * Math.sin(tt * 0.3), d.hold.y + 6 * Math.sin(tt * 0.45), d.hold.z + 18 * Math.sin(tt * 0.21));
      }
      if (t > this.timeLimit) {
        g.tm?.event('boss', { name: this.name, escaped: true, hp: Math.round(this.hp), bt: +t.toFixed(1) });
        this.state = 'retreat';
        this.retreatT = 0;
        g.hud.banner(this.name + ' ESCAPED', 2);
      }
      if (!g.fireHeld) this.attack(dt); // over the stage's bullet cap: its guns wait (ai/summary.md §7.2)
    } else if (this.state === 'retreat') {
      this.retreatT += dt;
      this.pos.z -= (40 + this.retreatT * 260) * dt;
      this.pos.y += 30 * dt;
      if (this.pos.z < -1400) this.finish(false);
    } else if (this.state === 'dying') {
      this.dyingT += dt;
      this.pos.z -= 8 * dt;
      this.pos.y -= 3 * dt;
      if (Math.random() < dt * 14) {
        _v.set((Math.random() - 0.5) * d.bodyR * 2, (Math.random() - 0.5) * d.bodyR, (Math.random() - 0.5) * d.bodyR * 1.5).add(this.pos);
        g.fx.explosion(_v.x, _v.y, _v.z, 1.6 + Math.random() * 1.6, PAL.fire, 5);
        g.audio?.explosion(1.2);
      }
      if (this.dyingT > 2.4) {
        g.fx.bigExplosion(this.pos.x, this.pos.y, this.pos.z, d.boom ?? (this.type === 'mothership' ? 5 : 3));
        g.audio?.explosion(3);
        g.shakeCamera(2.5);
        g.flashScreen(0.8);
        this.finish(true);
        return;
      }
    }

    // nose-down tilt shows the deck and its parts to the camera, plus a banking sway
    _q.setFromAxisAngle(_v.set(0, 0, 1), Math.sin(t * 0.45) * 0.12 + (d.spin || 0) * t);
    this.quat.copy(FACE).multiply(this.tilt).multiply(_q);

    for (const p of this.parts) {
      p.world.copy(p.offset).applyQuaternion(this.quat).add(this.pos);
      if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 5);
      // smoke from destroyed parts
      if (!p.alive && Math.random() < dt * 10) {
        g.fx.add(p.world.x, p.world.y, p.world.z, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, 6, 0.9, 1.2, 3.5, PAL.fire, [0.25, 0.1, 0.08], 0.6, SHAPE.GLOW, 0.5);
      }
    }

    // launched fighters (staggered)
    for (let k = this.launchQueue.length - 1; k >= 0; k--) {
      const q = this.launchQueue[k];
      if (this.state !== 'fight') {
        this.launchQueue.length = 0;
        break;
      }
      if (this.t < q.t) continue;
      this.launchQueue.splice(k, 1);
      g.enemies.spawn('dart', q.member, q.wave, q.from);
      g.stats.raw++;
    }
  }

  attack(dt) {
    if (this.def.attack) return this.def.attack(this, dt);
    const g = this.game;
    const diff = g.difficulty;
    if (this.type === 'cruiser') {
      const coreOpen = this.coreVulnerable();
      if (coreOpen && this.phase === 1) {
        this.phase = 2;
        g.hud.banner('CORE EXPOSED', 1.6);
        g.tutor?.trigger('bomb');
      }
      for (const p of this.parts) {
        if (!p.alive || p.core) continue;
        p.fireT -= dt * diff.fireRate;
        if (p.fireT <= 0) {
          p.fireT = 2.4;
          this.aimed(p.world, 2, 0.09, 42, 1);
          g.fx.flash(p.world.x, p.world.y, p.world.z, 3, [1, 0.7, 0.45], 0.1);
        }
      }
      if (coreOpen) {
        const core = this.parts.find((p) => p.core);
        this.coreT -= dt * diff.fireRate;
        if (core.alive && this.coreT <= 0) {
          this.coreT = 2.2;
          this.spiral += 0.27;
          g.enemies.ring(core.world.x, core.world.y, core.world.z, 6, 32 * diff.bulletSpeed, this.spiral, 3);
          this.aimed(core.world, 1, 0, 46, 4);
        }
      }
    } else {
      // mothership
      const outer = this.parts.filter((p) => !p.core);
      if (this.phase === 1 && (outer.every((p) => !p.alive) || this.t > 40)) {
        this.phase = 2;
        g.hud.banner('CORE EXPOSED', 1.6);
        g.audio?.warning();
      }
      const core = this.parts.find((p) => p.core);
      if (this.phase === 2 && core.hp < core.max * 0.45) {
        this.phase = 3;
        g.hud.banner('MOTHERSHIP ENRAGED', 1.6, true);
      }
      for (const p of outer) {
        if (!p.alive) continue;
        p.fireT -= dt * diff.fireRate;
        if (p.fireT > 0) continue;
        if (p.name.startsWith('wing')) {
          p.fireT = 2.8;
          this.fan(p.world, 5, 0.18, 40, 2);
          g.fx.flash(p.world.x, p.world.y, p.world.z, 4, [1, 0.7, 0.45], 0.1);
        } else if (this.bayCount++ % 2 === 0) {
          p.fireT = 6.5;
          const members = p.name === 'bayL' ? this.launchL : this.launchR;
          this.launch(p.world, members);
        } else {
          // the other bay cycle launches a missile pair (fast class: homing for 1.5 s, shootable)
          p.fireT = 6.5;
          const side = p.name === 'bayL' ? -1 : 1;
          for (let i = 0; i < 2; i++) g.missiles.launch(1, p.world.x, p.world.y, p.world.z, side * (0.4 + i * 0.3), 0.2, 1);
        }
      }
      if (this.phase >= 2 && core.alive) {
        this.coreT -= dt * diff.fireRate;
        const arms = this.phase === 3 ? 2 : 1;
        if (this.coreT <= 0) {
          // spiral arms: a readable stream, not a bullet curtain (enemy fire stays sparser than the player's)
          this.coreT = this.phase === 3 ? 0.42 : 0.36;
          this.spiral += 0.31;
          for (let a = 0; a < arms; a++) this.spiralShot(core.world, this.spiral + (a * Math.PI * 2) / arms, 38 * diff.bulletSpeed);
        }
        this.beamT -= dt;
        if (this.beamT <= 0) {
          this.beamT = this.phase === 3 ? 2.6 : 3.6;
          this.beam(core.world);
        }
      }
    }
  }

  aimed(from, n, spacing, speed, kind) {
    const g = this.game;
    _d.subVectors(g.player.pos, from).normalize();
    _side.set(1, 0, 0).addScaledVector(_d, -_d.x).normalize();
    const sp = speed * g.difficulty.bulletSpeed;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * spacing;
      _v.copy(_d).addScaledVector(_side, o).normalize().multiplyScalar(sp);
      g.bullets.spawn(from.x, from.y, from.z, _v.x, _v.y, _v.z, kind);
    }
    g.audio?.enemyShot();
  }

  fan(from, n, spacing, speed, kind) {
    this.aimed(from, n, spacing, speed, kind);
  }

  spiralShot(from, angle, speed) {
    const g = this.game;
    _d.subVectors(g.player.pos, from).normalize();
    _side.set(1, 0, 0).addScaledVector(_d, -_d.x).normalize();
    _vert.crossVectors(_side, _d).normalize();
    _v.copy(_d).multiplyScalar(0.8).addScaledVector(_side, Math.cos(angle) * 0.5).addScaledVector(_vert, Math.sin(angle) * 0.5).normalize().multiplyScalar(speed);
    g.bullets.spawn(from.x, from.y, from.z, _v.x, _v.y, _v.z, 3);
  }

  launch(from, members) {
    const g = this.game;
    const wave = { id: 9000 + Math.floor(this.t * 10), roll: 0, n: members.length, killed: 0, gone: 0, launched: true };
    members.forEach((m, i) => this.launchQueue.push({ t: this.t + i * 0.35, member: m, wave, from: from.clone() }));
    g.fx.flash(from.x, from.y, from.z, 5, PAL.gold, 0.2);
  }

  /** Telegraphed laser from a part (src/game/weapons.js Beams): aim line + 1 s charge, then the beam. */
  beam(from) {
    this.game.tutor?.tip('beam');
    this.game.beams.fire(this, () => from, { charge: 1.0, dur: 1.2, alive: () => this.active && this.state === 'fight' });
  }

  /** Shot segment test. Returns true if the shot was consumed. */
  hitTest(ax, ay, az, bx, by, bz, dmg) {
    if (!this.active || this.state === 'dying') return false;
    const g = this.game;
    for (const p of this.parts) {
      if (!p.alive) continue;
      if (segPointDist2(ax, ay, az, bx, by, bz, p.world.x, p.world.y, p.world.z) < p.r * p.r) {
        if (p.core && !this.coreVulnerable()) {
          g.fx.deflect(bx, by, bz);
          return true;
        }
        if (this.state === 'enter') {
          g.fx.deflect(bx, by, bz);
          return true;
        }
        this.damagePart(p, dmg);
        return true;
      }
    }
    const r = this.def.hullR ?? this.def.bodyR * this.def.scale;
    if (segPointDist2(ax, ay, az, bx, by, bz, this.pos.x, this.pos.y, this.pos.z) < r * r) {
      g.fx.hit(bx, by, bz);
      return true;
    }
    return false;
  }

  damagePart(p, dmg) {
    const g = this.game;
    p.hp -= dmg;
    p.flash = 1;
    g.fx.hit(p.world.x, p.world.y, p.world.z);
    g.hud.hitMarker(p.hp <= 0);
    if (p.hp > 0) return;
    g.tutor?.onBossPart(p.core);
    g.tm?.event('boss', { name: this.name, part: p.name, bt: +this.t.toFixed(1) });
    p.alive = false;
    p.mesh.visible = false;
    g.onPartKilled(p.world, p.core ? 3 : 2, p.core ? this.def.score : this.def.partScore, 1.5);
    g.shakeCamera(p.core ? 2 : 0.8);
    if (p.core) {
      this.state = 'dying';
      this.dyingT = 0;
      g.beams.clearOwner(this);
      g.bullets.clear();
      for (const q of this.parts) {
        if (q.alive) {
          // the rest goes down with the core: kills too, without their own score
          q.alive = false;
          q.mesh.visible = false;
          g.stats.killed++;
        }
      }
    }
  }

  bomb(dmg) {
    if (!this.active || this.state !== 'fight') return;
    for (const p of this.parts) {
      if (!p.alive) continue;
      if (p.core && !this.coreVulnerable()) continue;
      this.damagePart(p, dmg);
    }
  }

  /** Ram test against the player. */
  touches(pos, r) {
    if (!this.active || this.state === 'dying') return false;
    const R = this.def.bodyR * this.def.scale * 0.8 + r;
    return this.pos.distanceToSquared(pos) < R * R;
  }

  finish(killed) {
    const g = this.game;
    this.active = false;
    this.group.visible = false;
    g.beams.clearOwner(this);
    if (killed) {
      for (const [i, type] of this.def.drops.entries()) g.dropPickup(type, this.pos.x + (i - 0.5) * 8, this.pos.y, this.pos.z);
    }
    g.onBossDone(this, killed);
  }

  draw(time) {
    if (!this.active) return;
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
    this.bodyMat.userData.uFlash.value = 0;
    for (const p of this.parts) p.mat.userData.uFlash.value = p.flash * 0.9 + (p.core && this.coreVulnerable() ? 0.15 + 0.15 * Math.sin(time * 8) : 0);
  }
}

export function bossHpFraction(boss) {
  return boss && boss.active ? boss.hp / boss.maxHp : 0;
}
