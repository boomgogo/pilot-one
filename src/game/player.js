import { Euler, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { clamp, damp } from '../core/util.js';
import { SHAPE } from '../render/billboards.js';
import { PAL } from '../render/fx.js';
import { SHOT_LIFE, SHOT_SPEED } from './shots.js';

export const CORRIDOR = { x: 28, y: 16 };
const YAW_LIMIT = 0.92; // ~53°
const PITCH_LIMIT = 0.62; // ~36°
const ROLL_RATE = Math.PI; // rad/s (hold Q/E)
const MOVE_SPEED = 30;
// Raised chase camera: the ship sits lower on screen, so the bolt stream from the guns to the crosshair spans more of it.
export const CAM_OFFSET = new Vector3(0, 5.0, 14.0);
// Landing on the carrier at a location's end (ai/summary.md §4.3): the camera pulls back to show the deck.
const LAND_CAM = new Vector3(0, 10, 34);
const MUZZLE = [0.85, 0.97, 1.0];
const LASER_DPS = 40;
const NOSE = new Vector3(0, 0, -2.4); // single bolt, spiral axis and laser origin (ship frame)
const CONE = 0.105; // ~6°: the QUAD's outer bolts angle outward
const CONE_X = 2.9; // ...from just outboard of the wingtip guns, so they never cross the parallel bolts
const SPIRAL_R = 1.8;
const SPIRAL_STEP = Math.PI / 6; // the spiral's 4 bolts turn 30° per volley: a rotating cylinder of tracers

// Evasive roll (ai/summary.md §5.3): double-tap Q or E. A full barrel roll of the ship (the view
// keeps its roll, so alignment with inverted wings is kept), invulnerable for EVADE_INV s. EVADES per ship, refilled
// on a new ship and at every stage start.
export const EVADES = 3;
const EVADE_TIME = 0.5;
const EVADE_INV = 0.45;
const EVADE_CD = 0.25;

// Power ladder (ai/summary.md §6.1). Each POW adds a level; losing a ship drops back to SINGLE.
// Every bolt of a volley flies parallel to the aim line, so no two can cross; only the cone diverges.
export const POWER = ['SINGLE', 'TWIN', 'QUAD', 'MISSILES', 'SPIRAL', 'FULL'];
export const MAX_POWER = POWER.length - 1;
const LV = { TWIN: 1, QUAD: 2, MISSILES: 3, SPIRAL: 4, FULL: 5 };

const _v = new Vector3();
const _v2 = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _dir = new Vector3();
const _m4 = new Matrix4();
const _nose = new Vector3();
const _off = new Vector3();
const _spin = new Quaternion();
const _z = new Vector3(0, 0, 1);
const NO_AIM = [0, 0];

export class Player {
  constructor(game, model, droneModel, material, droneMaterial) {
    this.game = game;
    this.model = model;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.camQuat = new Quaternion();
    this.shipQuat = new Quaternion();
    this.aimPoint = new Vector3(0, 0, -200);
    this.camPos = new Vector3().copy(CAM_OFFSET);
    this.camOffset = new Vector3().copy(CAM_OFFSET);
    this.landing = null; // {t, dur, from, target}: flying onto the carrier deck, controls released
    this.mesh = new Mesh(model.geometry, material);
    this.mesh.frustumCulled = false;
    this.material = material;
    this.drones = [new Mesh(droneModel.geometry, droneMaterial), new Mesh(droneModel.geometry, droneMaterial)];
    this.dronePos = [new Vector3(-5, 0, 2), new Vector3(5, 0, 2)];
    for (const d of this.drones) {
      d.visible = false;
      d.frustumCulled = false;
    }
    this.objects = [this.mesh, ...this.drones];
    this.guns = model.markers.gun || [new Vector3(1.6, 0, -0.4), new Vector3(-1.6, 0, -0.4)];
    this.engines = model.markers.glow || [new Vector3(0, 0, 1.8)];
    this.shake = 0;
    this.reset(true);
  }

  reset(full) {
    if (full) {
      this.lives = 3;
      this.power = 0;
      this.score = 0;
    }
    this.pos.set(0, -3, 0);
    this.vel.set(0, 0, 0);
    this.yaw = this.pitch = 0;
    this.roll = 0;
    this.shield = 3;
    this.bombs = 2;
    this.invuln = 2;
    this.alive = true;
    this.respawnT = 0;
    this.fireCd = 0;
    this.missileCd = 0.4;
    this.spiralA = 0;
    this.laserT = 0;
    this.laserK = 0;
    this.flash = 0;
    this.evades = EVADES;
    this.evadeT = -1; // seconds into an evasive roll (-1: not rolling)
    this.evadeDir = 1;
    this.evadeCd = 0;
    this.taps = []; // recent roll-key presses {t, roll}: the evasive roll returns to the roll before the first tap
    this.prevRollIn = 0;
    this.landing = null;
    this.camOffset.copy(CAM_OFFSET);
    this.camPos.copy(CAM_OFFSET).add(this.pos);
  }

  /** The dock section: the ship flies itself onto the carrier deck over `dur` seconds (target set by the game). */
  startLanding(dur) {
    this.landing = { t: 0, dur, from: this.pos.clone(), target: new Vector3(0, 0, -100) };
    this.evadeT = -1;
    this.laserT = 0;
  }

  /** Back to flying (a new location starts): controls back, the normal chase camera. */
  endLanding() {
    if (!this.landing) return;
    this.landing = null;
    this.pos.set(0, -3, 0);
    this.vel.set(0, 0, 0);
    this.yaw = this.pitch = 0;
    this.camOffset.copy(CAM_OFFSET);
    this.camPos.copy(CAM_OFFSET).add(this.pos);
  }

  _land(dt) {
    const L = this.landing;
    L.t += dt;
    const k = Math.min(1, L.t / L.dur);
    const e = k * k * (3 - 2 * k);
    this.pos.lerpVectors(L.from, L.target, e);
    this.vel.set(0, 0, 0);
    const d = damp(2.5, dt);
    this.yaw -= this.yaw * d;
    this.pitch += (-0.16 * e - this.pitch) * d;
    this.roll -= this.roll * d;
    this.invuln = Math.max(this.invuln, 0.5);
    this.camOffset.lerpVectors(CAM_OFFSET, LAND_CAM, Math.min(1, e * 1.6));
    this.aimPoint.set(this.pos.x, this.pos.y - 8 * e, this.pos.z - 200);
    this._camera(dt);
    _dir.subVectors(this.aimPoint, this.pos).normalize();
    _q.setFromRotationMatrix(_m4.lookAt(this.pos, _v.addVectors(this.pos, _dir), _up.set(0, 1, 0)));
    this.shipQuat.slerp(_q, damp(6, dt));
    this.game.beams.player = null;
    for (let i = 0; i < 2; i++) {
      _v.copy(this.pos).add(_v2.set(i ? 4.8 : -4.8, 0.7, 2));
      this.dronePos[i].lerp(_v, damp(8, dt));
      this.drones[i].position.copy(this.dronePos[i]);
      this.drones[i].quaternion.copy(this.shipQuat);
    }
  }

  /** Invulnerable part of an evasive roll: everything passes through. */
  get evading() {
    return this.evadeT >= 0 && this.evadeT < EVADE_INV;
  }

  update(dt, input, takeAim = true) {
    const g = this.game;
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0 && this.lives > 0) {
        const lives = this.lives;
        this.reset(false);
        this.lives = lives;
        this.invuln = 3;
        g.fx.warpIn(this.pos.x, this.pos.y, this.pos.z, 4, PAL.cyan);
        g.onRespawn(this.lostPower || 0);
      }
      this._camera(dt);
      return;
    }
    if (this.landing) {
      this._land(dt);
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt * 4);

    // evasive roll: double-tap edges are read once per frame (first substep)
    if (input.roll !== 0 && this.prevRollIn === 0) {
      this.taps.push({ t: g.time, roll: this.roll });
      if (this.taps.length > 3) this.taps.shift();
    }
    this.prevRollIn = input.roll;
    if (takeAim) {
      const ev = input.edge('evadeL') ? 1 : input.edge('evadeR') ? -1 : 0;
      if (ev) this.startEvade(ev);
    }
    this.evadeCd = Math.max(0, this.evadeCd - dt);
    if (this.evadeT >= 0) {
      this.evadeT += dt;
      // a streak behind the spinning ship
      g.fx.add(this.pos.x, this.pos.y, this.pos.z + 0.6, 0, 0, g.stage.speed * 0.6 + 14, 0.25, 0.7, 1.6, PAL.cyan, PAL.white, 0.55, SHAPE.SOFT);
      if (this.evadeT >= EVADE_TIME) {
        this.evadeT = -1;
        this.evadeCd = EVADE_CD;
      }
    }

    // roll (hold), no auto-level; held still during an evasive roll
    if (this.evadeT < 0) this.roll -= input.roll * ROLL_RATE * dt;
    if (this.roll > Math.PI) this.roll -= Math.PI * 2;
    if (this.roll < -Math.PI) this.roll += Math.PI * 2;
    const c = Math.cos(this.roll);
    const s = Math.sin(this.roll);

    // aim: screen-space deltas rotated into the rolled frame
    const [dx, dy] = takeAim ? input.consumeAim() : NO_AIM;
    this.yaw -= dx * c - dy * s;
    this.pitch += dx * s + dy * c;
    this.yaw = clamp(this.yaw, -YAW_LIMIT, YAW_LIMIT);
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    // touch: drift the aim back to center when the aim thumb is idle
    if (input.isTouch && performance.now() - input.lastAimInput > 900) {
      const k = damp(1.2, dt);
      this.yaw -= this.yaw * k;
      this.pitch -= this.pitch * k;
    }

    // movement: screen-relative
    const wx = input.moveX * c - input.moveY * s;
    const wy = input.moveX * s + input.moveY * c;
    const k = damp(9, dt);
    this.vel.x += (wx * MOVE_SPEED - this.vel.x) * k;
    this.vel.y += (wy * MOVE_SPEED - this.vel.y) * k;
    // the play box (a canyon narrows it) and a section's drift (the solar wind): src/game/game.js step()
    const box = g.corridor;
    this.pos.x += (this.vel.x + g.drift.x) * dt;
    this.pos.y += (this.vel.y + g.drift.y) * dt;
    if (Math.abs(this.pos.x) > box.x) {
      this.pos.x = Math.sign(this.pos.x) * box.x;
      this.vel.x *= -0.2;
    }
    if (Math.abs(this.pos.y) > box.y) {
      this.pos.y = Math.sign(this.pos.y) * box.y;
      this.vel.y *= -0.2;
    }

    this._camera(dt);

    // ship faces the aim point, with a visual bank from lateral motion
    _dir.subVectors(this.aimPoint, this.pos).normalize();
    _up.set(0, 1, 0).applyQuaternion(this.camQuat);
    _q.setFromRotationMatrix(_m4.lookAt(this.pos, _v.addVectors(this.pos, _dir), _up));
    const sx = this.vel.x * c + this.vel.y * s; // screen-space lateral velocity
    const sy = -this.vel.x * s + this.vel.y * c;
    _q2.setFromEuler(_e.set(sy * 0.012, 0, -sx * 0.022));
    _q.multiply(_q2);
    this.shipQuat.slerp(_q, damp(16, dt));

    // weapons
    this.fireCd -= dt;
    this.missileCd -= dt;
    this.laserT = Math.max(0, this.laserT - dt);
    if (this.laserT > 0 && input.fire) {
      // laser pickup: an instant beam (with a short spin-up) replaces the bolts
      this.laserK = Math.min(1, this.laserK + dt / 0.15);
      this.fireLaser(dt);
    } else {
      this.laserK = 0;
      g.beams.player = null;
      if (input.fire && this.fireCd <= 0) {
        this.fireCd = this.power >= LV.FULL ? 0.066 : 0.078;
        this.fire();
      }
    }
    if (input.fire && this.power >= LV.MISSILES && this.missileCd <= 0) this.fireMissiles();

    // wingman drones (MISSILES and up) trail beside the ship
    const showDrones = this.power >= LV.MISSILES;
    _right.set(1, 0, 0).applyQuaternion(this.camQuat);
    _up.set(0, 1, 0).applyQuaternion(this.camQuat);
    for (let i = 0; i < 2; i++) {
      const d = this.drones[i];
      d.visible = showDrones && this.alive;
      _v.copy(this.pos).addScaledVector(_right, i ? 4.8 : -4.8).addScaledVector(_up, 0.7);
      this.dronePos[i].lerp(_v, damp(8, dt));
      d.position.copy(this.dronePos[i]);
      d.quaternion.copy(this.shipQuat);
      d.rotateZ(this.game.time * 3 * (i ? 1 : -1));
    }
  }

  /** dir: +1 = Q side (roll angle increases), -1 = E side. */
  startEvade(dir) {
    const g = this.game;
    if (!this.alive || this.evadeT >= 0 || this.evadeCd > 0 || this.evades <= 0) return;
    // undo what the taps themselves rolled: back to the angle before the first of the two
    const first = this.taps.length >= 2 ? this.taps[this.taps.length - 2] : null;
    if (first && g.time - first.t < 0.8) this.roll = first.roll;
    this.evades--;
    this.evadeT = 0;
    this.evadeDir = dir;
    g.onEvade();
  }

  _camera(dt) {
    _e.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.camQuat.setFromEuler(_e);
    _v.copy(this.camOffset).applyQuaternion(this.camQuat).add(this.pos);
    this.camPos.lerp(_v, damp(14, dt));
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  applyCamera(camera, time, reduceShake) {
    camera.position.copy(this.camPos);
    camera.quaternion.copy(this.camQuat);
    const sh = reduceShake ? this.shake * 0.25 : this.shake;
    if (sh > 0) {
      camera.position.x += Math.sin(time * 97) * sh * 0.6;
      camera.position.y += Math.sin(time * 71 + 1) * sh * 0.6;
    }
  }

  /** Camera ray (rail-local) for aiming. */
  aimRay(origin, dir) {
    origin.copy(this.camPos);
    dir.set(0, 0, -1).applyQuaternion(this.camQuat);
  }

  fire() {
    const g = this.game;
    const lv = this.power;
    const A = this.aimPoint; // the lead (intercept) point when locked, see Game.computeAim
    // volley frame: f along the aim line from the nose, u = camera up (the pattern rolls with you), r = right
    _nose.copy(NOSE).applyQuaternion(this.shipQuat).add(this.pos);
    _fwd.subVectors(A, _nose).normalize();
    _up.set(0, 1, 0).applyQuaternion(this.camQuat);
    _up.addScaledVector(_fwd, -_up.dot(_fwd)).normalize();
    _right.crossVectors(_fwd, _up);
    if (lv >= LV.SPIRAL) {
      this.spiralA += SPIRAL_STEP;
      for (let k = 0; k < 4; k++) {
        const a = this.spiralA + (k * Math.PI) / 2;
        _v.copy(_nose).addScaledVector(_right, Math.cos(a) * SPIRAL_R).addScaledVector(_up, Math.sin(a) * SPIRAL_R);
        this._bolt(_v, 0, k % 2 === 0);
      }
    } else if (lv >= LV.TWIN) {
      for (const gun of this.guns) this._bolt(_v.copy(gun).applyQuaternion(this.shipQuat).add(this.pos), 0, true);
    } else {
      this._bolt(_nose, 0, true);
    }
    if (lv >= LV.QUAD) {
      // the cone: outboard bolts angled outward, in the camera's horizontal plane (roll to turn it vertical).
      // It always leaves from outside every parallel bolt (at FULL: just outside the drones), so it never crosses one.
      for (const side of [-1, 1]) {
        if (lv >= LV.FULL) _v.copy(this.dronePos[side < 0 ? 0 : 1]).addScaledVector(_right, side * 0.9);
        else _v.copy(_nose).addScaledVector(_right, side * CONE_X);
        _dir.copy(_fwd).applyAxisAngle(_up, -side * CONE).multiplyScalar(SHOT_SPEED);
        // spread off the centre line: homing turns it with the rest of the volley
        _off.copy(_fwd).multiplyScalar(-SHOT_SPEED).add(_dir);
        // at FULL the outer streams (this cone, the drone bolts) are drawn thin, so they don't hide the targets
        g.shots.spawn(_v.x, _v.y, _v.z, _dir.x, _dir.y, _dir.z, 1, lv >= LV.FULL ? 2 : 0, SHOT_LIFE, g.lockEnemy, _nose.x, _nose.y, _nose.z, _off.x, _off.y, _off.z);
      }
    }
    if (lv >= LV.FULL) for (const p of this.dronePos) this._bolt(p, 1, false);
    g.audio?.shot();
  }

  /** One bolt of a volley from rail-local position p, parallel to the volley's aim line (_fwd). */
  _bolt(p, kind, flash) {
    const g = this.game;
    _dir.copy(_fwd).multiplyScalar(SHOT_SPEED);
    // the volley's centre point is the nose: locked volleys turn as one rigid pattern (shots.js _steer)
    g.shots.spawn(p.x, p.y, p.z, _dir.x, _dir.y, _dir.z, 1, kind, SHOT_LIFE, g.lockEnemy, _nose.x, _nose.y, _nose.z);
    // muzzle flash: makes firing obvious even when the bolts are far away
    if (flash) g.fx.add(p.x, p.y, p.z, this.vel.x, this.vel.y, 0, 0.06, 0.95, 0.45, MUZZLE, PAL.cyan, 1, SHAPE.FLARE);
  }

  /** Laser: damage the first thing along the aim line, every substep. */
  fireLaser(dt) {
    const g = this.game;
    _v.copy(NOSE).applyQuaternion(this.shipQuat).add(this.pos);
    _dir.subVectors(this.aimPoint, _v).normalize();
    const t = g.laser(_v, _dir, LASER_DPS * dt * this.laserK);
    const pl = (g.beams.player ||= { a: new Vector3(), b: new Vector3(), k: 0 });
    pl.a.copy(_v);
    pl.b.copy(_v).addScaledVector(_dir, t);
    pl.k = this.laserK;
    g.audio?.laser();
  }

  /** MISSILES and up: the drones launch homing missiles at up to two targets on screen. */
  fireMissiles() {
    const g = this.game;
    const targets = g.missileTargets(2);
    if (!targets.length) return;
    this.missileCd = this.power >= LV.FULL ? 0.7 : 0.9;
    targets.forEach((e, i) => {
      const p = this.dronePos[i % 2];
      _up.set(0, 1, 0).applyQuaternion(this.camQuat);
      _fwd.set(0, 0, -1).applyQuaternion(this.camQuat).addScaledVector(_up, 0.5);
      g.missiles.launch(0, p.x, p.y, p.z, _fwd.x, _fwd.y, _fwd.z, e);
    });
  }

  /** Returns true if the hit was taken. src: {src, x, y, z, ...} for telemetry; culprit: object to flash. */
  hit(amount = 1, src = null, culprit = null) {
    const g = this.game;
    if (!this.alive || this.invuln > 0 || this.evading || g.debug.god) return false;
    this.shield -= amount;
    // which way you were moving, and where: for tuning from recorded runs (npm run play -- --human)
    g.tm?.event('hit', { ...src, shield: this.shield, vx: Math.round(this.vel.x), vy: Math.round(this.vel.y), sec: g.stage.section.id });
    g.onPlayerHit(src, culprit);
    this.flash = 1;
    this.shake = Math.max(this.shake, 1.4);
    g.hud.damage();
    g.audio?.playerHit();
    g.fx.sparks(this.pos.x, this.pos.y, this.pos.z, 12, 22, PAL.cyan, 0.4);
    if (this.shield <= 0) {
      this.die();
    } else {
      this.invuln = 1.6;
    }
    return true;
  }

  die() {
    const g = this.game;
    this.alive = false;
    this.shield = 0;
    this.lives -= 1;
    if (this.power > 0) g.tm?.event('power', { level: 0, lost: this.power });
    this.lostPower = this.power; // for telemetry (Game.onRespawn): how much the climb back has to win
    this.power = 0; // a lost ship starts again from a single bolt, with nothing given back (ai/summary.md §6.1)
    this.respawnT = 2.4;
    this.shake = 2.5;
    g.fx.explosion(this.pos.x, this.pos.y, this.pos.z, 2.2, PAL.cyan, 0);
    g.fx.bigExplosion(this.pos.x, this.pos.y, this.pos.z, 1);
    g.audio?.explosion(2);
    g.onPlayerDied();
  }

  draw(glows, time) {
    const visible = this.alive && (!!this.landing || !(this.invuln > 0 && Math.floor(time * 14) % 2 === 0));
    this.mesh.visible = visible;
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.shipQuat);
    if (this.evadeT >= 0) {
      // the barrel roll: the ship spins once around its nose (eased), the view does not
      const u = Math.min(1, this.evadeT / EVADE_TIME);
      const e = u * u * (3 - 2 * u);
      this.mesh.quaternion.multiply(_spin.setFromAxisAngle(_z, this.evadeDir * Math.PI * 2 * e));
    }
    this.material.userData.uFlash.value = this.flash * 0.8;
    if (!this.alive) return;
    for (const e of this.engines) {
      _v2.copy(e).applyQuaternion(this.shipQuat).add(this.pos);
      const fl = 0.85 + 0.15 * Math.sin(time * 40 + e.x);
      glows.push(_v2.x, _v2.y, _v2.z, 0, 0, 0, 0.35, 0.7, 1.0, 0.8, 0.42 * fl, SHAPE.GLOW);
    }
    if (this.power >= LV.MISSILES) {
      for (const p of this.dronePos) glows.push(p.x, p.y, p.z, 0, 0, 0, 1.0, 0.75, 0.35, 0.7, 0.9, SHAPE.GLOW);
    }
  }
}

