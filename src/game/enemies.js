import { Color, DynamicDrawUsage, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { angleDiff, damp, DEG } from '../core/util.js';
import { PAL } from '../render/fx.js';
import { SHAPE } from '../render/billboards.js';
import { BULLET } from './shots.js';
import { enemyCanFire } from './weapons.js';

// Enemy types. hp in player-shot units; r = collision radius; rate = seconds between volleys.
// A wave can swap a gunship's weapon: {weapon: 'shells' | 'missiles' | 'laser'} (see WEAPON below).
export const ENEMY = {
  dart: { model: 'dart', hp: 1, r: 2.7, score: 100, fire: 'aimed', rate: 3.4, fireChance: 0.28, glow: [1, 0.35, 0.2], explode: 1 },
  wasp: { model: 'wasp', hp: 3, r: 2.9, score: 200, fire: 'spread3', rate: 3.8, fireChance: 0.45, glow: [1, 0.35, 0.95], explode: 1.2 },
  hammer: { model: 'hammer', hp: 20, r: 7.0, score: 1500, fire: 'fan5', rate: 2.4, fireChance: 1, glow: [1, 0.6, 0.2], explode: 2.4 },
  mine: { model: 'mine', hp: 3, r: 2.4, score: 300, fire: null, onDeath: 'ring8', glow: [1, 0.2, 0.2], explode: 1.3, spin: 1.6 },
  // The Belt: mining drones come in swarms and ram (shoot them, or move: the danger markers show where)
  miner: { model: 'miner', hp: 1, r: 2.2, score: 80, fire: null, glow: [1, 0.65, 0.15], explode: 0.8 },
  // Crimson Nebula: cloaked wasps, a shimmer in the fog until they charge their guns (or are hit, or close)
  shade: { model: 'shade', hp: 3, r: 2.9, score: 300, fire: 'spread3', rate: 3.6, fireChance: 0.6, glow: [0.2, 1, 0.85], explode: 1.2, cloak: true },
};

// Enemy weapons by firing class (src/game/weapons.js). speed: base projectile speed (× difficulty).
const WEAPON = {
  aimed: { cls: 'medium', speed: 46 },
  spread3: { cls: 'medium', speed: 44 },
  fan5: { cls: 'medium', speed: 40 },
  shells: { cls: 'slow', speed: 18, rate: 2.6 },
  missiles: { cls: 'fast', speed: 60, rate: 4.2 },
  laser: { cls: 'instant', speed: 0, rate: 5.2 },
};
const CHARGE = 0.3; // gun glow before a volley: who is about to fire
// The shoot-down ratio counts only enemies you could engage (ai/summary.md §6.2): hit at least once, or ENGAGE_T s in
// view within ENGAGE_RANGE (98% of the bots' hits land inside 340 units). Gate posts never count.
const ENGAGE_T = 1.5;
export const ENGAGE_RANGE = 350;
const SIZE_FLOOR = 0.025;

const RED_TINT = new Color(1.0, 0.32, 0.26);
const INVERT_TINT = new Color(0.62, 1.0, 0.92);
const WHITE = new Color(1, 1, 1);
const ALIGN_TOLERANCE = 30 * DEG;

const _v = new Vector3();
const _up = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _dir = new Vector3();
const _side = new Vector3();
const _vert = new Vector3();
const _col = new Color();
const _mz = new Vector3();

class Enemy {
  constructor() {
    this.active = false;
    this.pos = new Vector3();
    this.prev = new Vector3();
    this.quat = new Quaternion();
    this.vel = new Vector3();
  }
}

export class Enemies {
  constructor(game, models, shipMaterial, shieldMaterial, cap = 72) {
    this.game = game;
    this.pool = Array.from({ length: cap }, () => new Enemy());
    this.list = []; // active enemies
    this.uidSeq = 0;
    this.meshes = {};
    this.objects = [];
    for (const [type, def] of Object.entries(ENEMY)) {
      const model = models[def.model];
      const g = model.geometry.clone();
      const c = type === 'hammer' ? 10 : cap;
      const flash = new InstancedBufferAttribute(new Float32Array(c), 1);
      flash.setUsage(DynamicDrawUsage);
      g.setAttribute('iFlash', flash);
      const mesh = new InstancedMesh(g, shipMaterial, c);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      for (let i = 0; i < c; i++) mesh.setColorAt(i, WHITE);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes[type] = { mesh, flash, model, n: 0, cap: c };
      this.objects.push(mesh);
    }
    const sg = new IcosahedronGeometry(1, 2);
    this.shields = new InstancedMesh(sg, shieldMaterial, 32);
    this.shields.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < 32; i++) this.shields.setColorAt(i, WHITE);
    this.shields.count = 0;
    this.shields.frustumCulled = false;
    this.objects.push(this.shields);
    this.shieldMaterial = shieldMaterial;
  }

  clear() {
    for (const e of this.list) e.active = false;
    this.list.length = 0;
  }

  /** Spawn one member of a wave. anchor: optional Vector3 the path is relative to (boss bays). */
  spawn(type, member, wave, anchor = null) {
    const e = this.pool.find((x) => !x.active);
    if (!e) return null;
    const def = ENEMY[type];
    const g = this.game;
    e.active = true;
    e.uid = ++this.uidSeq;
    e.type = type;
    e.def = def;
    e.hp = def.hp * (wave.hpMul || 1);
    e.member = member;
    e.wave = wave;
    e.anchor = anchor ? anchor.clone() : null;
    e.t = 0;
    e.flash = 0;
    e.roll = wave.roll || 0;
    e.weapon = (def.fire && wave.weapon) || def.fire;
    e.rate = WEAPON[e.weapon]?.rate || def.rate;
    e.charge = 0;
    e.markT = -1;
    e.shielded = !!wave.roll;
    e.shieldLevel = e.shielded ? 1 : 0;
    e.red = !!wave.red;
    e.spin = 0;
    e.seen = 0;
    e.counted = wave.armored ? true : null; // the stage's stats it was counted in; armored waves (gate posts) never
    e.passes = 0;
    e.vs = 1; // drawn (and hit) scale: the size floor
    // location 5's fast red squadrons fly at normal speed while you are weak (ai/summary.md §6.1): a single bolt can
    // still finish them and win the POW back
    e.sm = wave.red && (wave.speedMul || 1) > 1 && g.player.power < 3 ? 1 / wave.speedMul : 1;
    // deterministic per-member firing: some members never fire, others start at a staggered phase
    const seed = ((wave.id * 7919 + member.index * 104729) % 1000) / 1000;
    // a wave's own fireChance (lesson waves) is used as is in the first loop, and they fire early; otherwise the
    // type's default × the stage ramp × the loop difficulty (Game.makeDifficulty). Gunships (fireChance 1) always fire.
    // The ramp's rate only spaces out later volleys: the first one still comes while the wave is in view.
    const d = g.difficulty;
    const own = wave.fireChance !== undefined && g.locIdx === 0;
    const chance = own ? wave.fireChance : def.fireChance >= 1 ? 1 : def.fireChance * d.fireChance;
    e.canFire = !!def.fire && seed < chance && !wave.gate && !wave.noFire;
    if (wave.slowFire) e.rate *= wave.slowFire;
    // deflects everything: laser-gate posts, and lesson gunships until they have shown their weapon once
    e.armored = !!wave.armored || (!!wave.practice && type === 'hammer');
    e.gate = !!wave.gate;
    e.gateOn = false;
    const phase = (seed * 7.31) % 1;
    // lesson and practice waves show their weapon soon after coming into range (fireT only runs while in range)
    e.fireT = own || wave.practice ? 1.2 + 0.8 * phase : e.rate * (0.35 + 0.65 * phase) / Math.max(1, d.fireRate);
    member.curve.getPointAt(0, e.pos);
    if (anchor) e.pos.add(anchor);
    e.prev.copy(e.pos);
    this._orient(e, 1, 1);
    this.list.push(e);
    g.tm?.event('spawn', { type, wave: wave.id });
    if (e.pos.z > -480 && e.pos.z < 0 && !anchor) g.fx.warpIn(e.pos.x, e.pos.y, e.pos.z, def.r * 1.4, e.shielded ? PAL.cyan : PAL.violet);
    return e;
  }

  _orient(e, dt, snap = 0) {
    const g = this.game;
    if (e.member.face === 'none') {
      e.spin += dt * (e.def.spin || 1);
      _q.setFromAxisAngle(_v.set(0.3, 1, 0.2).normalize(), e.spin);
    } else {
      if (e.member.face === 'player') {
        _dir.subVectors(g.player.pos, e.pos);
      } else {
        _dir.copy(e.vel);
        if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
      }
      _dir.normalize();
      _up.set(-Math.sin(e.roll), Math.cos(e.roll), 0);
      if (Math.abs(_dir.dot(_up)) > 0.98) _up.set(0, 0, 1);
      // Matrix4.lookAt aims +Z from target to eye, so -Z (the model nose) points along _dir
      _m.lookAt(e.pos, _v.addVectors(e.pos, _dir), _up);
      _q.setFromRotationMatrix(_m);
    }
    if (snap) e.quat.copy(_q);
    else e.quat.slerp(_q, damp(9, dt));
  }

  update(dt) {
    const g = this.game;
    const list = this.list;
    let charging = 0;
    for (const e of list) if (e.charge > 0) charging++;
    for (let k = list.length - 1; k >= 0; k--) {
      const e = list[k];
      e.t += dt;
      const m = e.member;
      let u = (e.t * m.speed * e.sm) / m.length;
      if (u >= 1 && e.wave.loop && e.passes === 0) {
        // a second pass (ai/summary.md §7.1): the ship comes back round and flies the formation again from the far side
        e.passes = 1;
        e.t = 0;
        u = 0;
        m.curve.getPointAt(0, e.pos);
        if (e.anchor) e.pos.add(e.anchor);
        e.prev.copy(e.pos);
        if (e.pos.z < 0) g.fx.warpIn(e.pos.x, e.pos.y, e.pos.z, e.def.r * 1.4, PAL.violet);
      }
      if (u >= 1) {
        this._remove(k, true);
        continue;
      }
      e.vs = this.sizeFloor(e);
      if (!e.counted) {
        if (e.pos.z < 0 && e.pos.z > -ENGAGE_RANGE && g.onScreen(e.pos.x, e.pos.y, e.pos.z, 0)) e.seen += dt;
        if (e.seen >= ENGAGE_T) this.engage(e);
      }
      e.prev.copy(e.pos);
      m.curve.getPointAt(u, e.pos);
      if (e.anchor) e.pos.add(e.anchor);
      if (dt > 0) e.vel.subVectors(e.pos, e.prev).multiplyScalar(1 / dt);
      this._orient(e, dt);
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 6);

      if (e.shielded) {
        const aligned = Math.abs(angleDiff(g.player.roll, e.roll)) < ALIGN_TOLERANCE;
        e.shieldLevel += ((aligned ? 0 : 1) - e.shieldLevel) * damp(10, dt);
      }

      // laser gate: the left post strings the fence to its partner as the pair closes in
      if (e.gate && !e.gateOn && m.index === 0 && e.pos.z > -200) {
        const partner = list.find((o) => o !== e && o.wave === e.wave && o.active);
        if (partner) g.beams.fence(e, partner);
        e.gateOn = true;
      }

      // firing: the escape-time rule (weapons.js) decides when a shot is fair; the gun glows for CHARGE s first.
      // At most maxCharging enemies charge at once (the stage ramp): the rest wait their turn.
      const wasCharging = e.charge > 0;
      e.charge = 0;
      if (e.canFire && e.t > 0.9) {
        const w = WEAPON[e.weapon];
        const ready = enemyCanFire(g, e.pos, w.speed * g.difficulty.bulletSpeed, w.cls);
        if (!ready || (!wasCharging && e.fireT - dt < CHARGE && charging >= g.difficulty.maxCharging)) {
          e.fireT = Math.max(e.fireT, CHARGE);
        } else {
          if (!wasCharging && e.fireT - dt < CHARGE) charging++;
          e.fireT -= dt;
          if (e.fireT < CHARGE) e.charge = 1 - Math.max(0, e.fireT) / CHARGE;
          if (e.fireT <= 0) {
            e.fireT = (e.rate / g.difficulty.fireRate) * (0.85 + ((e.t * 13.7) % 0.3));
            if (!e.gate) e.armored = false;
            this.fire(e);
          }
        }
      }
    }
  }

  /** Gun position: a little ahead of the nose. */
  muzzle(e, out) {
    return out.set(0, 0, -e.def.r * 0.9 * e.vs).applyQuaternion(e.quat).add(e.pos);
  }

  fire(e) {
    const g = this.game;
    const b = g.bullets;
    const w = WEAPON[e.weapon];
    const sp = w.speed * g.difficulty.bulletSpeed;
    this.muzzle(e, _v);
    g.fx.flash(_v.x, _v.y, _v.z, 2.4, [1, 0.75, 0.45], 0.09);
    _dir.subVectors(g.player.pos, e.pos).normalize();
    // fan plane follows the enemy's roll: an inverted gunship fires vertical fans
    _side.set(Math.cos(e.roll), Math.sin(e.roll), 0);
    _side.addScaledVector(_dir, -_side.dot(_dir)).normalize();
    _vert.crossVectors(_side, _dir).normalize();
    const x = e.pos.x;
    const y = e.pos.y;
    const z = e.pos.z;
    g.tm?.event('efire', { type: e.type, mode: e.weapon, cls: w.cls, d: Math.round(e.pos.distanceTo(g.player.pos)), sp: Math.round(sp) });
    switch (e.weapon) {
      case 'aimed':
        b.spawn(x, y, z, _dir.x * sp, _dir.y * sp, _dir.z * sp, 0);
        break;
      case 'spread3':
        // a pair either side of the aim line: stay put and both miss, drift and one finds you
        for (let i = -1; i <= 1; i += 2) {
          _v.copy(_dir).addScaledVector(_side, i * 0.07).normalize().multiplyScalar(sp * 0.95);
          b.spawn(x, y, z, _v.x, _v.y, _v.z, 1);
        }
        break;
      case 'fan5':
        for (let i = -2; i <= 2; i++) {
          _v.copy(_dir).addScaledVector(_side, i * 0.2).normalize().multiplyScalar(sp * 0.85);
          b.spawn(x, y, z, _v.x, _v.y, _v.z, 2);
        }
        break;
      case 'shells':
        // two slow lobbed shells: shoot them (50 pts) or they burst into a ring after their fuse
        for (let i = -1; i <= 1; i += 2) {
          _v.copy(_dir).addScaledVector(_side, i * 0.12).addScaledVector(_vert, 0.05).normalize().multiplyScalar(sp);
          b.spawn(x, y, z, _v.x, _v.y, _v.z, BULLET.SHELL);
        }
        break;
      case 'missiles':
        for (let i = -1; i <= 1; i += 2) {
          _v.copy(_dir).addScaledVector(_side, i * 0.5).normalize();
          g.missiles.launch(1, x + _side.x * i * 3, y + _side.y * i * 3, z, _v.x, _v.y, _v.z);
        }
        return;
      case 'laser': {
        const uid = e.uid;
        g.beams.fire(e, () => this.muzzle(e, _mz), { charge: 1.0, dur: 1.1, sweep: 0.12 * (uid % 2 ? 1 : -1), alive: () => e.active && e.uid === uid });
        return;
      }
    }
    g.audio?.enemyShot();
  }

  /** Radial ring of bullets around the direction to the player. */
  ring(x, y, z, n, sp, phase, kind = 3) {
    const g = this.game;
    _dir.set(g.player.pos.x - x, g.player.pos.y - y, g.player.pos.z - z).normalize();
    _side.set(1, 0, 0).addScaledVector(_dir, -_dir.x).normalize();
    _vert.crossVectors(_side, _dir).normalize();
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      _v.copy(_dir).multiplyScalar(0.85)
        .addScaledVector(_side, Math.cos(a) * 0.42)
        .addScaledVector(_vert, Math.sin(a) * 0.42)
        .normalize()
        .multiplyScalar(sp);
      g.bullets.spawn(x, y, z, _v.x, _v.y, _v.z, kind);
    }
  }

  /**
   * Far ships are drawn bigger, to stay at least SIZE_FLOOR of the screen width (up to ×2.5); the hitbox follows
   * the drawn size, so you can hit what you see (ai/summary.md §7.4).
   */
  sizeFloor(e) {
    const d = 12 - e.pos.z; // the camera sits about 12 behind the ship
    if (d < 60) return 1;
    const cam = this.game.r.camera;
    const tanH = Math.tan((cam.fov * Math.PI) / 360) * cam.aspect;
    return Math.min(2.5, Math.max(1, (SIZE_FLOOR * d * tanH) / e.def.r));
  }

  /** Into the shoot-down ratio's count: once per stage (a ship from the last stage, hit in this one, counts here too). */
  engage(e) {
    const s = this.game.stats;
    if (e.counted === true || e.counted === s) return;
    e.counted = s;
    s.spawned++;
  }

  /** Apply damage from a player weapon. Returns 'deflect' | 'hit' | 'kill'. */
  damage(e, amount, fromBomb = false, by = fromBomb ? 'bomb' : 'shot') {
    const g = this.game;
    this.engage(e);
    if (e.armored) {
      g.fx.deflect(e.pos.x, e.pos.y, e.pos.z);
      return 'deflect';
    }
    if (e.shielded && e.shieldLevel > 0.5 && !fromBomb) {
      g.tutor?.onDeflect();
      g.fx.deflect(e.pos.x, e.pos.y, e.pos.z);
      return 'deflect';
    }
    e.hp -= amount;
    e.flash = 1;
    if (e.hp > 0) {
      g.audio?.hit();
      return 'hit';
    }
    const idx = this.list.indexOf(e);
    const aligned = e.shielded && !fromBomb;
    this._remove(idx, false);
    g.onEnemyKilled(e, aligned, by);
    // mines burst into slow shrapnel (slow class): plenty of time to slip between the orbs. Not when killed
    // point-blank (no time to react) or far away (the orbs would just drift as clutter).
    const md = e.pos.distanceTo(g.player.pos);
    if (e.def.onDeath === 'ring8' && md > 45 && md < 220) this.ring(e.pos.x, e.pos.y, e.pos.z, 4, 18 * g.difficulty.bulletSpeed, 0.4, BULLET.ORB);
    return 'kill';
  }

  _remove(k, escaped) {
    const e = this.list[k];
    if (!e) return;
    e.active = false;
    this.list[k] = this.list[this.list.length - 1];
    this.list.pop();
    if (escaped) this.game.onEnemyEscaped(e);
  }

  /** Count of enemies that matter for the density director. */
  get alive() {
    return this.list.length;
  }

  draw(glows, time) {
    for (const t of Object.values(this.meshes)) t.n = 0;
    let ns = 0;
    let shieldsVisible = false;
    for (const e of this.list) {
      const t = this.meshes[e.type];
      if (t.n >= t.cap) continue;
      _s.setScalar(e.vs);
      _m.compose(e.pos, e.quat, _s);
      t.mesh.setMatrixAt(t.n, _m);
      t.mesh.setColorAt(t.n, e.red ? RED_TINT : e.shielded ? INVERT_TINT : WHITE);
      t.flash.array[t.n] = e.flash;
      t.n++;
      // cloaked: only a shimmer (the deflector shell's hex) until it charges, is hit, or is close
      if (e.def.cloak && e.charge <= 0 && e.flash < 0.05 && e.pos.z < -110) {
        t.n--;
        if (ns < 32) {
          const r = e.def.r * 1.3 * e.vs;
          _s.set(r, r * 0.5, r);
          _m.compose(e.pos, e.quat, _s);
          this.shields.setMatrixAt(ns, _m);
          this.shields.setColorAt(ns, _col.setRGB(0.3 + 0.12 * Math.sin(time * 7 + e.uid), 0, 0));
          ns++;
        }
        continue;
      }
      // charge glow at the gun before a volley: shows who is about to fire
      if (e.charge > 0) {
        this.muzzle(e, _v);
        glows.push(_v.x, _v.y, _v.z, 0, 0, 0, 1, 0.82, 0.55, 0.35 + 0.65 * e.charge, 0.5 + 1.5 * e.charge, SHAPE.GLOW);
      }
      // far away: a faint beacon in its engine colour, so a ship stays findable in fog, glare and the dark
      const far = -e.pos.z;
      if (far > 200) {
        const c = e.def.glow;
        glows.push(e.pos.x, e.pos.y, e.pos.z, 0, 0, 0, c[0], c[1], c[2], Math.min(0.45, (far - 200) / 300), far * 0.011, SHAPE.GLOW);
      }
      // engine glows
      const gm = t.model.markers.glow;
      if (gm) {
        const c = e.def.glow;
        for (const p of gm) {
          _v.copy(p).multiplyScalar(e.vs).applyQuaternion(e.quat).add(e.pos);
          glows.push(_v.x, _v.y, _v.z, 0, 0, 0, c[0], c[1], c[2], 0.9, (0.9 + 0.15 * Math.sin(time * 30 + e.t)) * e.vs, SHAPE.GLOW);
        }
      }
      if (e.shielded && e.shieldLevel > 0.02 && ns < 32) {
        const r = e.def.r * 1.45 * e.vs;
        _s.set(r, r, r);
        _m.compose(e.pos, e.quat, _s);
        this.shields.setMatrixAt(ns, _m);
        this.shields.setColorAt(ns, _col.setRGB(e.shieldLevel, 0, 0));
        ns++;
        shieldsVisible = true;
      }
    }
    for (const t of Object.values(this.meshes)) {
      t.mesh.count = t.n;
      t.mesh.visible = t.n > 0; // types not in this location cost no draw call
      if (t.n) {
        t.mesh.instanceMatrix.needsUpdate = true;
        t.mesh.instanceColor.needsUpdate = true;
        t.flash.needsUpdate = true;
      }
    }
    this.shields.count = ns;
    if (ns) {
      this.shields.instanceMatrix.needsUpdate = true;
      this.shields.instanceColor.needsUpdate = true;
    }
    this.shieldMaterial.uniforms.uTime.value = time;
    return shieldsVisible;
  }
}
