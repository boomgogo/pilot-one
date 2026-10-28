// A bot that plays Pilot One the way a person does. Injected into the page by scripts/play/record.js.
//
// Same information as a person: only what is on screen (window.__bg.view(): screen-space targets, hazards,
// danger markers, HUD), seen through a reaction delay. Same inputs as a person: keyboard and mouse DOM events
// that go through the game's own Input class. It never writes game state.
//
// Motor model: aim moves are ballistic sub-movements (Fitts-like duration, minimum-jerk profile, overshoot,
// then a correction), plus hand tremor. Keys are held at least 70 ms.
// Like a person, the bot knows how it just moved its own hand (efference copy): when it predicts where a target
// is now, it removes the screen motion caused by its own aiming, instead of chasing its own tail.
(() => {
  const PRESETS = {
    novice: { reaction: 0.3, tremor: 0.0055, overshoot: 0.14, fittsA: 0.12, fittsB: 0.16, dwell: 0.14, fireDuty: 0.8, dodgeSkill: 0.55, retarget: 0.6, evadeSkill: 0.6 },
    average: { reaction: 0.23, tremor: 0.0035, overshoot: 0.09, fittsA: 0.1, fittsB: 0.12, dwell: 0.1, fireDuty: 0.87, dodgeSkill: 0.8, retarget: 0.45, evadeSkill: 0.85 },
    expert: { reaction: 0.18, tremor: 0.002, overshoot: 0.05, fittsA: 0.08, fittsB: 0.09, dwell: 0.07, fireDuty: 0.94, dodgeSkill: 1, retarget: 0.35, evadeSkill: 1 },
    // a calm, good player for showcase video (ai/plan_0.md §3.2): the camera is the aim, so smooth, framed aim moves.
    // maxAimRate: peak aim speed (rad/s) of a sub-movement; stickiness: stay on a target unless another scores this
    // many times better; centreBias: prefer targets near the crosshair; moveHold: minimum hold of a movement key (s);
    // bombStyle 'show': also bomb into a bullet curtain or an open boss, once per stage, while one is left to spare
    showcase: {
      reaction: 0.18, tremor: 0.0006, overshoot: 0.015, fittsA: 0.1, fittsB: 0.11, dwell: 0.09, fireDuty: 0.96, dodgeSkill: 1, retarget: 0.35, evadeSkill: 1,
      maxAimRate: 1.6, stickiness: 1.6, centreBias: 1, moveHold: 0.15, bombStyle: 'show',
    },
  };
  const MOUSE_RAD_PER_PX = 0.0021; // must match src/core/input.js
  const MIN_HOLD = 0.07;
  const ROLL_REPRESS = 0.36; // adjusting the roll, a person doesn't re-press a roll key this fast (that's a double-tap)
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

  function mulberry32(a) {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const angleDiff = (a, b) => {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d <= -Math.PI) d += Math.PI * 2;
    return d;
  };
  const minJerk = (u) => u * u * u * (10 - 15 * u + 6 * u * u);

  class Bot {
    constructor(opts = {}) {
      this.opts = { skill: 'average', seed: 1, useMarkers: true, ...opts };
      this.p = { ...PRESETS[this.opts.skill], ...this.opts.tune }; // tune: preset overrides (record.js --tune)
      this.rng = mulberry32(this.opts.seed * 7919 + 13);
      this.history = [];
      this.keys = new Map(); // code → time pressed
      this.move = null; // current aim sub-movement
      this.dwellUntil = 0;
      this.target = null;
      this.targetT = -1;
      this.fireOffUntil = 0;
      this.nextFireCheck = 0;
      this.dodge = null; // {keys:[...], until}
      this.bombCd = 0;
      this.levelT = 0;
      this.evadeSeq = null; // scripted double-tap: [{at, code, down}]
      this.evadeCd = 0;
      this.lastPress = {}; // roll key → time of its last press
      this.aimCum = { x: 0, y: 0 }; // radians sent so far (efference copy)
      this.aimLog = [];
      this.now = 0;
      this.stats = { aimMoves: 0, dodges: 0, bombs: 0, retargets: 0, evades: 0 };
      this.aimRates = []; // rad/s sent per frame while playing: the camera's pan speed (the view follows the aim)
      this.lastCum = { x: 0, y: 0 };
    }

    gauss() {
      const u = 1 - this.rng();
      const v = this.rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    key(code, down, t) {
      const held = this.keys.has(code);
      if (down === held) return;
      const minHold = this.p.moveHold && MOVE_KEYS.has(code) ? this.p.moveHold : MIN_HOLD;
      if (!down && t - this.keys.get(code) < minHold) return; // keep the minimum hold
      if (down) this.keys.set(code, t);
      else this.keys.delete(code);
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
    }

    releaseAll(t) {
      for (const code of [...this.keys.keys()]) {
        this.keys.delete(code);
        window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
      }
      this.move = null;
      this.dodge = null;
      this.evadeSeq = null;
    }

    mouse(dxRad, dyRad, sens) {
      this.aimCum.x += dxRad;
      this.aimCum.y += dyRad;
      const k = 1 / (MOUSE_RAD_PER_PX * (sens || 1));
      const mx = dxRad * k;
      const my = dyRad * k;
      if (Math.abs(mx) < 0.01 && Math.abs(my) < 0.01) return;
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: mx, movementY: my, bubbles: true }));
    }

    /** The snapshot a person would be reacting to now: the newest one at least `reaction` seconds old. */
    perceived(now) {
      const h = this.history;
      const want = now - this.p.reaction;
      let best = h[0];
      for (const s of h) {
        if (s.t <= want) best = s;
        else break;
      }
      return best;
    }

    /** Own aim (radians) sent up to time t. */
    cumAt(t) {
      const L = this.aimLog;
      for (let i = L.length - 1; i >= 0; i--) if (L[i].t <= t) return L[i];
      return L[0] || { x: 0, y: 0 };
    }

    /**
     * Where an object is now: perceived position + its own motion (extrapolated over the reaction delay), minus
     * the screen shift caused by the bot's own aiming since then (efference copy).
     */
    predict(obj, older, lead) {
      const f = this.cur.f;
      const cs = this.cumAt(this.cur.t);
      let vx = 0;
      let vy = 0;
      const o = older && obj.id !== undefined ? older.targets.find((q) => q.id === obj.id) : null;
      if (o) {
        const co = this.cumAt(older.t);
        const dt = Math.max(1e-3, this.cur.t - older.t);
        // remove the apparent motion caused by our own aim change between the two snapshots
        vx = (obj.x - o.x + (cs.x - co.x) * f) / dt;
        vy = (obj.y - o.y + (cs.y - co.y) * f) / dt;
      }
      return {
        x: obj.x + vx * lead - (this.aimCum.x - cs.x) * f,
        y: obj.y + vy * lead - (this.aimCum.y - cs.y) * f,
      };
    }

    tick() {
      const now = window.__bg.view();
      const t = now.t;
      this.now = t;
      this.aimLog.push({ t, x: this.aimCum.x, y: this.aimCum.y });
      while (this.aimLog.length > 2 && this.aimLog[1].t < t - 1.5) this.aimLog.shift();
      this.history.push(now);
      while (this.history.length > 2 && this.history[1].t < t - 1.2) this.history.shift();
      if (now.state !== 'playing') {
        this.releaseAll(t);
        return;
      }
      const seen = this.perceived(t);
      this.cur = seen;
      const older = this.history.find((s) => s.t >= seen.t - 0.12) || seen;
      if (!seen.ship) {
        // dead: wait for respawn, keep hands still
        for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']) this.key(c, false, t);
        return;
      }
      this.aim(seen, older, now, t);
      this.aimRates.push(Math.hypot(this.aimCum.x - this.lastCum.x, this.aimCum.y - this.lastCum.y) * 60);
      this.lastCum = { ...this.aimCum };
      this.fire(seen, t);
      this.evade(seen, t);
      if (!this.evadeSeq) this.roll(seen, older, t);
      this.dodgeAndPosition(seen, t);
      this.bomb(seen, t);
    }

    pickTarget(seen, t) {
      const cx = seen.w / 2;
      const cy = seen.h / 2;
      let best = null;
      let bestScore = 0;
      let cur = null;
      let curScore = 0;
      // shells can be shot down too, and should be
      const shells = seen.hazards.filter((h) => h.kind === 'shell').map((h, i) => ({ ...h, id: 'shell-' + i, kind: 'shell' }));
      for (const q of [...seen.targets, ...shells]) {
        let v = 0.25;
        if (q.armored) continue;
        if (q.kind === 'shell') v = 2.4;
        else if (q.kind === 'enemy') v = q.red ? 3 : q.type === 'hammer' ? 2.6 : q.type === 'wasp' ? 1.6 : q.type === 'mine' ? 1.1 : 1.3;
        else if (q.kind === 'boss') v = q.open ? 2.6 : 0.15;
        else if (q.kind === 'rock') v = 0.7;
        if (q.kind === 'enemy' && q.shielded && !seen.hud.aligned) v *= 0.45;
        const dist = Math.hypot(q.x - cx, q.y - cy);
        let score = v / (1 + (dist * (1 + (this.p.centreBias || 0))) / 260);
        if (q.d < 260) score *= 1.25;
        if (score > bestScore) {
          bestScore = score;
          best = q;
        }
        if (this.target && q.id === this.target) {
          cur = q;
          curScore = score;
        }
      }
      if (cur && this.p.stickiness && curScore * this.p.stickiness >= bestScore) return cur;
      if (cur && t - this.targetT < this.p.retarget * 4 && curScore >= bestScore * 0.7) return cur;
      if (best && best.id !== this.target) {
        this.target = best.id;
        this.targetT = t;
        this.stats.retargets++;
      }
      return best;
    }

    aim(seen, older, now, t) {
      const p = this.p;
      const sens = now.sensitivity;
      // tremor every frame
      this.mouse(this.gauss() * p.tremor * 0.25, this.gauss() * p.tremor * 0.25, sens);
      if (this.move) {
        const m = this.move;
        const u = Math.min(1, (t - m.t0) / m.T);
        const f = minJerk(u);
        this.mouse((f - m.f) * m.ax, (f - m.f) * m.ay, sens);
        m.f = f;
        if (u >= 1) {
          this.move = null;
          this.dwellUntil = t + p.dwell * (0.7 + this.rng() * 0.6);
        }
        return;
      }
      if (t < this.dwellUntil) return;
      const q = this.pickTarget(seen, t);
      if (!q) {
        // nothing to shoot: drift the aim back toward the middle of the cone, slowly
        return;
      }
      const pos = this.predict(q, older, p.reaction + 0.05);
      const ox = pos.x - seen.w / 2;
      const oy = pos.y - seen.h / 2;
      const D = Math.hypot(ox, oy);
      const W = Math.max(8, q.s * 2);
      if (D < Math.max(5, q.s * 0.5)) return;
      let T = p.fittsA + p.fittsB * Math.log2(1 + D / W);
      const gain = 1 + p.overshoot * 0.4 + this.gauss() * p.overshoot;
      const ax = Math.atan(ox / seen.f) * gain;
      const ay = Math.atan(oy / seen.f) * gain;
      // a minimum-jerk move peaks at 1.875× its mean speed
      if (p.maxAimRate) T = Math.max(T, (1.875 * Math.hypot(ax, ay)) / p.maxAimRate);
      this.move = { t0: t, T, f: 0, ax, ay };
      this.stats.aimMoves++;
    }

    fire(seen, t) {
      const anything = seen.targets.length > 0;
      if (t >= this.nextFireCheck) {
        this.nextFireCheck = t + 0.5;
        if (this.rng() > this.p.fireDuty) this.fireOffUntil = t + 0.12 + this.rng() * 0.25;
      }
      this.key('Space', anything && t >= this.fireOffUntil, t);
    }

    roll(seen, older, t) {
      const h = seen.hud;
      // where the roll is now: perceived roll + the rate it was turning at (people anticipate and let go early)
      const rate = older && older !== seen ? angleDiff(h.roll, older.hud.roll) / Math.max(1e-3, seen.t - older.t) : 0;
      const rollNow = h.roll + rate * (t - seen.t + 0.08);
      let want = null;
      let tol = 0.15;
      if (h.notch !== null && h.notch !== undefined) {
        want = h.notch;
        this.levelT = 0;
      } else if (Math.abs(angleDiff(0, h.roll)) > 0.45) {
        // level out a while after the inverted wing is gone; "roughly level" is good enough
        this.levelT += 1 / 60;
        if (this.levelT > 1.5) {
          want = 0;
          tol = 0.3;
        }
      }
      if (want === null) {
        this.key('KeyQ', false, t);
        this.key('KeyE', false, t);
        return;
      }
      const d = angleDiff(want, rollNow);
      // E decreases the ship's roll angle, Q increases it (src/game/player.js)
      this.rollKey('KeyE', d < -tol, t);
      this.rollKey('KeyQ', d > tol, t);
    }

    /** Roll keys while adjusting the roll: never re-pressed so fast that it reads as a double-tap. */
    rollKey(code, down, t) {
      if (down && !this.keys.has(code)) {
        if (t - (this.lastPress[code] ?? -9) < ROLL_REPRESS) return;
        this.lastPress[code] = t;
      }
      this.key(code, down, t);
    }

    /**
     * Evasive roll: double-tap Q when a red marker is on the ship and it can't be side-stepped in time (time to
     * impact < the time to move out of it), and always at a laser gate.
     */
    evade(seen, t) {
      if (this.evadeSeq) {
        while (this.evadeSeq.length && this.evadeSeq[0].at <= t) {
          const s = this.evadeSeq.shift();
          this.key(s.code, s.down, t);
        }
        if (!this.evadeSeq.length) this.evadeSeq = null;
        return;
      }
      if (t < this.evadeCd || !(seen.hud.evades > 0) || seen.hud.evading) return;
      const ship = seen.ship;
      const age = t - seen.t;
      let need = false;
      for (const m of seen.markers) {
        if (!m.red || m.kind === 'pickup') continue;
        const tNow = m.t - age;
        if (tNow < 0.18 || tNow > 0.55) continue;
        const inside = m.r - Math.hypot(m.x - ship.x, m.y - ship.y);
        if (inside <= 0) continue;
        const escape = 0.12 + inside / ship.pxPerUnit / 30;
        if (m.kind === 'gate' || escape > tNow) need = true;
      }
      if (!need || this.rng() > this.p.evadeSkill) {
        if (need) this.evadeCd = t + 0.6; // froze: a person doesn't get a second chance at the same one
        return;
      }
      for (const c of ['KeyQ', 'KeyE']) this.key(c, false, t);
      this.evadeSeq = [
        { at: t, code: 'KeyQ', down: true },
        { at: t + 0.075, code: 'KeyQ', down: false },
        { at: t + 0.15, code: 'KeyQ', down: true },
        { at: t + 0.23, code: 'KeyQ', down: false },
      ];
      this.lastPress.KeyQ = t + 0.15;
      this.evadeCd = t + 1;
      this.stats.evades++;
      this.evade(seen, t);
    }

    threats(seen) {
      const ship = seen.ship;
      const out = [];
      const threatMarkers = seen.markers.filter((m) => m.kind !== 'pickup');
      if (this.opts.useMarkers && threatMarkers.length) {
        for (const m of threatMarkers) out.push({ x: m.x, y: m.y, r: m.r, w: m.red ? 1 : 0.5, t: m.t });
        return out;
      }
      // no markers: a person judges by apparent size and closeness on screen
      for (const hz of seen.hazards) {
        const near = Math.hypot(hz.x - ship.x, hz.y - ship.y);
        const big = hz.s > ship.hit * 0.6;
        if (big && near < ship.hit * 6 + hz.s * 2) out.push({ x: hz.x, y: hz.y, r: hz.s + ship.hit * 2.5, w: 0.8, t: 0.6 });
      }
      for (const q of seen.targets) {
        if (q.kind !== 'rock' && q.kind !== 'enemy') continue;
        if (q.d > ship.d + 40) continue;
        const near = Math.hypot(q.x - ship.x, q.y - ship.y);
        if (near < q.s + ship.hit * 4) out.push({ x: q.x, y: q.y, r: q.s + ship.hit * 2, w: 0.8, t: 0.6 });
      }
      return out;
    }

    dodgeAndPosition(seen, t) {
      const ship = seen.ship;
      const th = this.threats(seen);
      const inside = th.filter((q) => q.w >= 1 && Math.hypot(q.x - ship.x, q.y - ship.y) < q.r);
      const danger = inside.length > 0 || th.some((q) => q.w < 1 && Math.hypot(q.x - ship.x, q.y - ship.y) < q.r * 0.8);
      let dir = null;
      if (danger && this.rng() < this.p.dodgeSkill + 0.15) {
        if (!this.dodge || t > this.dodge.until) {
          dir = this.escapeDir(seen, th);
          this.dodge = { dir, until: t + 0.18 + this.rng() * 0.1 };
          this.stats.dodges++;
        } else dir = this.dodge.dir;
      } else if (this.dodge && t < this.dodge.until) {
        dir = this.dodge.dir;
      } else {
        this.dodge = null;
        dir = this.wander(seen, t);
      }
      const [dx, dy] = dir || [0, 0];
      this.key('KeyD', dx > 0.35, t);
      this.key('KeyA', dx < -0.35, t);
      this.key('KeyW', dy > 0.35, t);
      this.key('KeyS', dy < -0.35, t);
    }

    escapeDir(seen, th) {
      const ship = seen.ship;
      const step = 30 * ship.pxPerUnit * 0.35; // how far the ship gets in ~0.35 s
      let best = [0, 0];
      let bestScore = -Infinity;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a); // screen-up positive
        const fx = ship.x + dx * step;
        const fy = ship.y - dy * step;
        let score = Infinity;
        for (const q of th) score = Math.min(score, (Math.hypot(q.x - fx, q.y - fy) - q.r) * (q.w >= 1 ? 1 : 1.5));
        // the corridor edge is felt, not seen: avoid pushing into it (rotate by roll: keys are screen-relative)
        const roll = seen.hud.roll || 0;
        const wx = dx * Math.cos(roll) - dy * Math.sin(roll);
        const wy = dx * Math.sin(roll) + dy * Math.cos(roll);
        if (Math.abs(ship.cx) > 0.8 && Math.sign(wx) === Math.sign(ship.cx)) score -= step;
        if (Math.abs(ship.cy) > 0.8 && Math.sign(wy) === Math.sign(ship.cy)) score -= step;
        score += this.gauss() * step * 0.15 * (1.2 - this.p.dodgeSkill);
        if (score > bestScore) {
          bestScore = score;
          best = [dx, dy];
        }
      }
      return best;
    }

    /** Idle movement: collect pickups, otherwise drift back toward the middle with a little wander. */
    wander(seen, t) {
      const ship = seen.ship;
      // a catch marker shows where a pickup will pass the ship's plane: move into it
      const cm = seen.markers.find((m) => m.kind === 'pickup');
      if (cm) {
        const dx = cm.x - ship.x;
        const dy = ship.y - cm.y;
        const l = Math.hypot(dx, dy);
        if (l > cm.r * 0.3) return [dx / l, dy / l];
        return [0, 0];
      }
      const pk = seen.pickups[0];
      if (pk && !this.opts.useMarkers) {
        const dx = pk.x - ship.x;
        const dy = ship.y - pk.y;
        const l = Math.hypot(dx, dy);
        if (l > 8) return [dx / l, dy / l];
      }
      const roll = seen.hud.roll || 0;
      // corridor offset back into screen space
      const sx = ship.cx * Math.cos(roll) + ship.cy * Math.sin(roll);
      const sy = -ship.cx * Math.sin(roll) + ship.cy * Math.cos(roll);
      const wx = Math.sin(t * 0.37 + this.opts.seed) * 0.6 - sx;
      const wy = Math.sin(t * 0.29 + this.opts.seed * 2) * 0.5 - sy;
      return [wx, wy];
    }

    bomb(seen, t) {
      if (this.keys.has('ShiftLeft')) {
        this.key('ShiftLeft', false, t);
        return;
      }
      if (t < this.bombCd || seen.hud.bombs <= 0) return;
      const ship = seen.ship;
      const reds = seen.markers.filter((m) => m.red && Math.hypot(m.x - ship.x, m.y - ship.y) < m.r * 1.3).length;
      const crowd = seen.hazards.filter((h) => Math.hypot(h.x - ship.x, h.y - ship.y) < ship.hit * 8).length;
      if (seen.hud.shield <= 1 && (reds >= 2 || crowd >= 4)) {
        this.key('ShiftLeft', true, t);
        this.bombCd = t + 3;
        this.stats.bombs++;
        return;
      }
      if (this.p.bombStyle !== 'show') return;
      // showcase: a bomb into a bullet curtain, or into an open boss under fire; once per stage (read off the HUD),
      // and below 2 shield pips one bomb stays in reserve
      const stage = document.getElementById('hud-stage')?.textContent || '';
      if (stage === this.showBombStage || seen.hud.bombs <= (seen.hud.shield < 2 ? 1 : 0)) return;
      const bullets = seen.hazards.filter((h) => h.kind === 'bullet' || h.kind === 'shell').length;
      const bossOpen = seen.targets.some((q) => q.kind === 'boss' && q.open && String(q.id).startsWith('boss-'));
      if (bullets >= 8 || (bossOpen && bullets >= 3)) {
        this.key('ShiftLeft', true, t);
        this.showBombStage = stage;
        this.bombCd = t + 3;
        this.stats.bombs++;
      }
    }
  }

  window.__bot = {
    create(opts) {
      this.bot = new Bot(opts);
      return this.bot.opts;
    },
    tick() {
      this.bot?.tick();
    },
    /** Real-time mode: tick on every animation frame. */
    run() {
      const loop = () => {
        this.tick();
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    },
    stats() {
      const b = this.bot;
      if (!b) return null;
      const r = [...b.aimRates].sort((x, y) => x - y);
      const q = (f) => +(r[Math.min(r.length - 1, Math.floor(r.length * f))] || 0).toFixed(2);
      return { ...b.stats, aimRate: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) } };
    },
  };
})();
