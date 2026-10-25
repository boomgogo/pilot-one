// Keyboard + mouse (Pointer Lock), touch (virtual stick / aim drag / buttons) and gamepad.
// Everything is reported in screen space: +x right, +y up. The game converts to the rolled frame.

const MOUSE_RAD_PER_PX = 0.0021;
const PAD_AIM_RATE = 2.4; // rad/s at full deflection
const DEADZONE = 0.16;
const DOUBLE_TAP_MS = 300; // a tap, then a second press of the same roll key this soon after it: evasive roll
const TAP_MS = 220; // ...where the first press is a tap (released this quickly), not a hold that adjusts the roll

export class Input {
  constructor(canvas, touchRoot, { isTouch }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;
    this.isTouch = isTouch;
    this.keys = new Set();
    this.mouseFire = false;
    this.aimDX = 0;
    this.aimDY = 0;
    this.moveX = 0;
    this.moveY = 0;
    this.roll = 0;
    this.fire = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.autoFire = false;
    this.enabled = false; // only gather aim deltas while playing
    this.locked = false;
    this.lastAimInput = 0; // ms timestamp of last aim activity (touch recentering)
    this._edges = { bomb: false, pause: false, mute: false, evadeL: false, evadeR: false };
    this._tapT = { L: -1e9, R: -1e9 }; // last roll-key press per side (ms)
    this._tapShort = { L: false, R: false }; // was that press released within TAP_MS (a tap)?
    this.device = isTouch ? 'touch' : 'keyboard'; // last input device used: hint wording (src/game/tutor.js)
    this._touch = { stickId: null, sx: 0, sy: 0, mx: 0, my: 0, aimId: null, ax: 0, ay: 0, rollL: false, rollR: false };
    this._padPrev = [];
    this.onPointerLockChange = null;
    this.ignoreBlur = false; // automation: synthetic key state must survive focus changes
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.isTouch) this.device = 'keyboard';
      if (e.code === 'KeyQ') this._rollTap('L');
      if (e.code === 'KeyE') this._rollTap('R');
      if (e.code === 'Escape' || e.code === 'KeyP') this._edges.pause = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyX') this._edges.bomb = true;
      if (e.code === 'KeyM') this._edges.mute = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyQ') this._rollRelease('L');
      if (e.code === 'KeyE') this._rollRelease('R');
    });
    addEventListener('blur', () => {
      if (this.ignoreBlur) return;
      this.keys.clear();
      this.mouseFire = false;
    });

    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this._edges.bomb = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      // Without pointer lock movementX still works while the cursor is inside the window.
      this.aimDX += e.movementX * MOUSE_RAD_PER_PX * this.sensitivity;
      this.aimDY -= e.movementY * MOUSE_RAD_PER_PX * this.sensitivity * (this.invertY ? -1 : 1);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onPointerLockChange?.(this.locked);
    });

    this._bindTouch();
  }

  _bindTouch() {
    const root = this.touchRoot;
    const t = this._touch;
    const stick = root.querySelector('#t-stick');
    const knob = root.querySelector('#t-knob');
    const buttons = {
      rollL: root.querySelector('#t-rollL'),
      rollR: root.querySelector('#t-rollR'),
      bomb: root.querySelector('#t-bomb'),
      pause: root.querySelector('#t-pause'),
    };
    const hold = (el, key) => {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('on');
        if (key === 'bomb') this._edges.bomb = true;
        else if (key === 'pause') this._edges.pause = true;
        else {
          t[key] = true;
          this._rollTap(key === 'rollL' ? 'L' : 'R');
        }
      });
      const up = () => {
        el.classList.remove('on');
        if (key === 'rollL' || key === 'rollR') {
          if (t[key]) this._rollRelease(key === 'rollL' ? 'L' : 'R');
          t[key] = false;
        }
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    for (const [k, el] of Object.entries(buttons)) hold(el, k);

    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      root.setPointerCapture?.(e.pointerId);
      if (e.clientX < innerWidth * 0.45 && t.stickId === null) {
        t.stickId = e.pointerId;
        t.sx = e.clientX;
        t.sy = e.clientY;
        t.mx = t.my = 0;
        stick.style.left = e.clientX + 'px';
        stick.style.top = e.clientY + 'px';
        knob.style.transform = '';
        stick.classList.remove('hidden');
      } else if (t.aimId === null) {
        t.aimId = e.pointerId;
        t.ax = e.clientX;
        t.ay = e.clientY;
      }
    });
    root.addEventListener('pointermove', (e) => {
      if (e.pointerId === t.stickId) {
        const R = 52;
        let dx = e.clientX - t.sx;
        let dy = e.clientY - t.sy;
        const len = Math.hypot(dx, dy);
        if (len > R) {
          dx *= R / len;
          dy *= R / len;
        }
        t.mx = dx / R;
        t.my = -dy / R;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (e.pointerId === t.aimId && this.enabled) {
        const k = (1.9 / Math.min(innerHeight, innerWidth)) * this.sensitivity;
        this.aimDX += (e.clientX - t.ax) * k;
        this.aimDY -= (e.clientY - t.ay) * k * (this.invertY ? -1 : 1);
        t.ax = e.clientX;
        t.ay = e.clientY;
        this.lastAimInput = performance.now();
      }
    });
    const end = (e) => {
      if (e.pointerId === t.stickId) {
        t.stickId = null;
        t.mx = t.my = 0;
        stick.classList.add('hidden');
      } else if (e.pointerId === t.aimId) {
        t.aimId = null;
      }
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
  }

  /** A press of a roll key / button: right after a tap of the same one, it's an evasive roll that way. */
  _rollTap(side) {
    const now = performance.now();
    if (this._tapShort[side] && now - this._tapT[side] < DOUBLE_TAP_MS) {
      this._edges['evade' + side] = true;
      this._tapT[side] = -1e9; // a triple tap is one roll, not two
    } else this._tapT[side] = now;
    this._tapShort[side] = false;
  }

  _rollRelease(side) {
    this._tapShort[side] = performance.now() - this._tapT[side] < TAP_MS;
  }

  requestLock() {
    if (this.isTouch || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => {
          try {
            const p2 = this.canvas.requestPointerLock();
            p2?.catch?.(() => {});
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* ignore */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  /** Call once per frame before the game update. */
  poll(dt) {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let roll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    let fire = this.mouseFire || k.has('Space');

    const t = this._touch;
    mx += t.mx;
    my += t.my;
    roll += (t.rollR ? 1 : 0) - (t.rollL ? 1 : 0);

    // Gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const ax = (i) => {
        const v = pad.axes[i] || 0;
        return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
      };
      const btn = (i) => !!pad.buttons[i]?.pressed;
      mx += ax(0);
      my -= ax(1);
      if (this.enabled) {
        this.aimDX += ax(2) * PAD_AIM_RATE * this.sensitivity * dt;
        this.aimDY -= ax(3) * PAD_AIM_RATE * this.sensitivity * dt * (this.invertY ? -1 : 1);
      }
      roll += (btn(5) ? 1 : 0) - (btn(4) ? 1 : 0);
      fire = fire || btn(7) || btn(0);
      const prev = this._padPrev;
      if (btn(4) && !prev[4]) this._rollTap('L');
      if (btn(5) && !prev[5]) this._rollTap('R');
      if (!btn(4) && prev[4]) this._rollRelease('L');
      if (!btn(5) && prev[5]) this._rollRelease('R');
      if (pad.buttons.some((b) => b.pressed) || pad.axes.some((v) => Math.abs(v) > 0.5)) this.device = 'gamepad';
      if (btn(6) && !prev[6]) this._edges.bomb = true;
      if (btn(1) && !prev[1]) this._edges.bomb = true;
      if (btn(9) && !prev[9]) this._edges.pause = true;
      for (let i = 0; i < pad.buttons.length; i++) prev[i] = btn(i);
      break;
    }

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX = mx;
    this.moveY = my;
    this.roll = Math.max(-1, Math.min(1, roll));
    this.fire = fire || this.autoFire;
  }

  consumeAim() {
    const r = [this.aimDX, this.aimDY];
    this.aimDX = this.aimDY = 0;
    return r;
  }

  edge(name) {
    const v = this._edges[name];
    this._edges[name] = false;
    return v;
  }

  clearEdges() {
    for (const k in this._edges) this._edges[k] = false;
    this.aimDX = this.aimDY = 0;
  }
}
