import { formatScore } from '../core/util.js';
import { MAX_POWER, POWER } from '../game/player.js';

// DOM HUD. Writes only when values change; popups and arrows are pooled elements moved with transforms.

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      score: $('hud-score'),
      hi: $('hud-hi'),
      ships: $('hud-ships'),
      shield: $('hud-shield'),
      bombs: $('hud-bombs'),
      evade: $('hud-evade'),
      power: $('hud-power'),
      bossBar: $('boss-bar'),
      bossName: document.querySelector('#boss-bar .name'),
      bossFill: document.querySelector('#boss-bar .fill'),
      banner: $('banner'),
      hint: $('hint'),
      stage: $('hud-stage'),
      locBar: document.querySelector('#loc-progress > i'),
      tally: $('stage-tally'),
      tallyGrade: document.querySelector('#stage-tally .grade'),
      tallyPips: document.querySelector('#stage-tally .stage-pips'),
      tallyRewards: document.querySelector('#stage-tally .rewards'),
      stageCard: $('stage-card'),
      locCard: $('loc-card'),
      flash: $('flash'),
      damage: $('damage'),
      rollDial: $('roll-dial'),
      rollTick: $('roll-tick'),
      rollNotch: $('roll-notch'),
      lock: $('lock-ring'),
      inner: $('inner-ring'),
      hitmark: $('hitmark'),
      hitdir: $('hitdir'),
      lead: $('lead'),
      laser: $('hud-laser'),
      laserFill: document.querySelector('#hud-laser .bar > i'),
      chain: $('hud-chain'),
      chainN: document.querySelector('#hud-chain .n'),
      chainBar: document.querySelector('#hud-chain .bar > i'),
      medal: $('hud-medal'),
      debug: $('debug'),
    };
    this.hitV = 0;
    this.hitKill = false;
    this.dirV = 0;
    this.prev = {};
    this.bannerT = 0;
    this.hintT = 0;
    this.tallyT = 0;
    this.counts = []; // tally rows counting up: {el, v, t}
    this.stageCardT = 0;
    this.stageCardDelay = 0;
    this.locCardT = 0;
    this.onTick = null; // a tick sound per counting step (set by main.js)
    this.flashV = 0;
    this.damageV = 0;
    this.popups = [];
    const pc = $('popups');
    for (let i = 0; i < 16; i++) {
      const d = document.createElement('div');
      d.className = 'popup';
      d.style.opacity = '0';
      pc.appendChild(d);
      this.popups.push({ el: d, t: 0, x: 0, y: 0, active: false });
    }
    this.arrows = [];
    const ac = $('arrows');
    for (let i = 0; i < 8; i++) {
      const d = document.createElement('div');
      d.className = 'arrow';
      d.style.display = 'none';
      ac.appendChild(d);
      this.arrows.push(d);
    }
    this.reduceFlash = false;
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  _set(key, value, fn) {
    if (this.prev[key] === value) return;
    this.prev[key] = value;
    fn(value);
  }

  _pips(el, n, total, cls, label = '') {
    let html = label ? `<span class="pname">${label}</span>` : '';
    for (let i = 0; i < total; i++) html += `<i class="pip ${cls}${i < n ? ' on' : ''}"></i>`;
    el.innerHTML = html;
  }

  banner(text, time = 2, warn = false) {
    const b = this.el.banner;
    b.textContent = text;
    b.classList.toggle('warn', warn);
    b.classList.add('show');
    this.bannerT = time;
  }

  /** Hint line under the ship. [KEY] is drawn as a key cap; cls 'ok' = a lesson just done. */
  hint(text, time = 3, cls = '') {
    const h = this.el.hint;
    h.innerHTML = escapeHtml(text).replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');
    h.className = cls ? 'show ' + cls : 'show';
    this.hintT = time;
  }

  clearMessages() {
    this.bannerT = this.hintT = this.tallyT = this.stageCardT = this.locCardT = 0;
    this.stageCardDelay = 0;
    this.counts.length = 0;
    this.el.banner.classList.remove('show');
    this.el.hint.classList.remove('show');
    this.el.tally.classList.add('hidden');
    this.el.stageCard.classList.remove('show');
    this.el.locCard.classList.remove('show');
  }

  /** "STAGE 2-4" and the thin bar of the location's progress (stage i of n). */
  setStage(label, i = 0, n = 1) {
    this.el.stage.textContent = 'STAGE ' + label;
    this.el.locBar.style.width = ((100 * i) / n).toFixed(1) + '%';
  }

  /** "2-5 · REFINERY", shown for a few seconds as a stage starts (after `delay` s: the location card first). */
  stageCard(label, name, delay = 0, sub = '') {
    const c = this.el.stageCard;
    c.children[0].textContent = 'STAGE ' + label;
    c.children[1].textContent = name;
    c.children[2].textContent = sub;
    this.stageCardDelay = delay;
    this.stageCardT = delay + 2.6;
    if (delay <= 0) c.classList.add('show');
  }

  /** The location's title card: "LOCATION 2" / its name / its subtitle. */
  locationCard(n, name, subtitle) {
    const c = this.el.locCard;
    c.children[0].textContent = 'LOCATION ' + n;
    c.children[1].textContent = name;
    c.children[2].textContent = subtitle || '';
    c.classList.add('show');
    this.locCardT = 3.2;
  }

  /**
   * Between-stage tally card: rows of [label, value] (numbers count up), a grade, the location's stage pips and the
   * rewards; it fades out after `time` seconds.
   */
  stageTally(title, rows, time, { grade = '', stage = 0, stages = 1, rewards = [] } = {}) {
    const t = this.el.tally;
    t.firstElementChild.textContent = title;
    const body = t.querySelector('.tally');
    body.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span${typeof v === 'number' ? ' data-v="' + v + '"' : ''}>${typeof v === 'number' ? '0' : v}</span>`).join('');
    this.counts = [...body.querySelectorAll('[data-v]')].map((el, i) => ({ el, v: +el.dataset.v, t: -0.25 - i * 0.35 }));
    const g = this.el.tallyGrade;
    g.textContent = grade;
    g.className = 'grade g' + grade;
    let pips = '';
    for (let i = 0; i < stages; i++) pips += `<i class="${i < stage ? 'done' : i === stage ? 'now' : ''}"></i>`;
    this.el.tallyPips.innerHTML = pips;
    this.el.tallyRewards.textContent = rewards.join('  ·  ');
    t.classList.remove('hidden', 'fade');
    this.tallyT = time;
  }

  damage() {
    this.damageV = 1;
  }

  /** The chain's multiplier just stepped up: a pulse. */
  chainUp() {
    const c = this.el.chain;
    c.classList.remove('pulse');
    void c.offsetWidth;
    c.classList.add('pulse');
  }

  flash(v) {
    this.flashV = Math.max(this.flashV, this.reduceFlash ? v * 0.25 : v);
  }

  /** Crosshair hit confirmation: white ticks on a hit, red on a kill. */
  hitMarker(kill) {
    if (kill || this.hitV < 0.6) {
      this.hitKill = kill || (this.hitKill && this.hitV > 0.3);
      this.hitV = 1;
    }
  }

  /** Red arc on the roll dial pointing at what hit you (screen angle, 0 = up, clockwise degrees). */
  hitDirection(deg) {
    this.dirV = 1;
    this.el.hitdir.setAttribute('transform', `rotate(${deg.toFixed(0)})`);
  }

  popup(text, sx, sy, cls = '') {
    const p = this.popups.find((q) => !q.active) || this.popups[0];
    p.active = true;
    p.t = 0;
    p.x = sx;
    p.y = sy;
    p.el.textContent = text;
    p.el.className = 'popup ' + cls;
  }

  /** s: game snapshot for the HUD */
  update(dt, s) {
    const e = this.el;
    this._set('score', Math.floor(s.score), (v) => (e.score.textContent = formatScore(v)));
    this._set('hi', Math.floor(s.hi), (v) => (e.hi.textContent = 'HI ' + formatScore(v)));
    this._set('ships', s.lives, (v) => this._pips(e.ships, Math.max(0, v - 1), Math.max(2, v - 1), 'ship'));
    this._set('shield', s.shield, (v) => this._pips(e.shield, v, 3, ''));
    this._set('bombs', s.bombs, (v) => this._pips(e.bombs, v, Math.max(2, v), 'bomb'));
    this._set('evades', s.evades, (v) => this._pips(e.evade, v, 3, 'evade', 'ROLL'));
    this._set('power', s.power, (v) => this._pips(e.power, v, MAX_POWER, 'pow', POWER[v]));
    this._set('boss', s.bossActive, (v) => e.bossBar.classList.toggle('hidden', !v));
    if (s.bossActive) {
      this._set('bossName', s.bossName, (v) => (e.bossName.textContent = v));
      this._set('bossHp', Math.round(s.bossHp * 200), (v) => (e.bossFill.style.width = v / 2 + '%'));
    }
    // roll dial: tick shows "rail up", notch shows the nearest inverted wing's up (top = aligned)
    const deg = (s.roll * 180) / Math.PI;
    this._set('roll', Math.round(deg * 2), () => e.rollTick.setAttribute('transform', `rotate(${deg.toFixed(1)})`));
    if (s.notch === null) {
      this._set('notch', 'none', () => e.rollNotch.setAttribute('visibility', 'hidden'));
    } else {
      const nd = ((s.roll - s.notch) * 180) / Math.PI;
      this._set('notch', Math.round(nd * 2) + (s.aligned ? 'a' : ''), () => {
        e.rollNotch.setAttribute('visibility', 'visible');
        e.rollNotch.setAttribute('transform', `rotate(${nd.toFixed(1)})`);
        e.rollNotch.firstElementChild.setAttribute('fill', s.aligned ? '#5dff9a' : '#ffb04a');
      });
    }
    this._set('lock', s.locked, (v) => (e.lock.style.opacity = v ? '0.9' : '0'));
    this._set('firing', s.firing, (v) => (e.inner.style.opacity = v ? '0.35' : '0.9'));
    if (s.lead) {
      e.lead.style.opacity = '0.85';
      e.lead.style.transform = `translate(${s.leadX.toFixed(0)}px, ${s.leadY.toFixed(0)}px) rotate(45deg)`;
      this.prev.leadOn = true;
    } else if (this.prev.leadOn) {
      e.lead.style.opacity = '0';
      this.prev.leadOn = false;
    }
    // chain and medal value (ai/summary.md §6.3): hidden under a chain of 5
    this._set('chainOn', s.chain >= 5, (v) => e.chain.classList.toggle('hidden', !v));
    if (s.chain >= 5) {
      this._set('chain', s.chain * 10 + s.chainMul, () => (e.chainN.textContent = `${s.chain} CHAIN${s.chainMul > 1 ? ' ×' + s.chainMul : ''}`));
      this._set('chainK', Math.round(s.chainK * 40), (v) => (e.chainBar.style.width = (v * 2.5).toFixed(0) + '%'));
    }
    this._set('medal', s.medal, (v) => (e.medal.textContent = v > 100 ? 'MEDAL ' + formatScore(v) : ''));
    this._set('laserOn', s.laserT > 0, (v) => e.laser.classList.toggle('hidden', !v));
    if (s.laserT > 0) this._set('laserT', Math.ceil(s.laserT * 20), (v) => (e.laserFill.style.width = Math.min(100, v / 1.6) + '%'));
    if (this.hitV > 0.001 || this.prev.hitOn) {
      this.hitV *= Math.exp(-dt * 9);
      e.hitmark.style.opacity = this.hitV.toFixed(3);
      this._set('hitKill', this.hitKill, (v) => e.hitmark.setAttribute('stroke', v ? '#ff4d6d' : '#ffffff'));
      this.prev.hitOn = this.hitV > 0.001;
    }
    if (this.dirV > 0.001 || this.prev.dirOn) {
      this.dirV = Math.max(0, this.dirV - dt / 0.8);
      e.hitdir.setAttribute('opacity', this.dirV.toFixed(3));
      this.prev.dirOn = this.dirV > 0.001;
    }

    // messages
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) e.banner.classList.remove('show');
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) e.hint.classList.remove('show');
    }
    if (this.tallyT > 0) {
      this.tallyT -= dt;
      if (this.tallyT <= 0.4) e.tally.classList.add('fade');
      if (this.tallyT <= 0) e.tally.classList.add('hidden');
      for (const c of this.counts) {
        const before = c.t;
        c.t += dt;
        if (c.t < 0 || before >= 0.6) continue;
        const k = Math.min(1, c.t / 0.6);
        c.el.textContent = formatScore(Math.round(c.v * k));
        if (Math.floor(before * 20) !== Math.floor(c.t * 20) && k < 1) this.onTick?.();
      }
    }
    if (this.stageCardT > 0) {
      this.stageCardT -= dt;
      if (this.stageCardDelay > 0) {
        this.stageCardDelay -= dt;
        if (this.stageCardDelay <= 0) e.stageCard.classList.add('show');
      }
      if (this.stageCardT <= 0) e.stageCard.classList.remove('show');
    }
    if (this.locCardT > 0) {
      this.locCardT -= dt;
      if (this.locCardT <= 0) e.locCard.classList.remove('show');
    }
    // flashes
    if (this.flashV > 0.001 || this.prev.flashOn) {
      this.flashV *= Math.exp(-dt * 7);
      e.flash.style.opacity = this.flashV.toFixed(3);
      this.prev.flashOn = this.flashV > 0.001;
    }
    if (this.damageV > 0.001 || this.prev.dmgOn) {
      this.damageV *= Math.exp(-dt * 3.5);
      e.damage.style.opacity = this.damageV.toFixed(3);
      this.prev.dmgOn = this.damageV > 0.001;
    }
    // popups drift up and fade
    for (const p of this.popups) {
      if (!p.active) continue;
      p.t += dt;
      const k = p.t / 0.9;
      if (k >= 1) {
        p.active = false;
        p.el.style.opacity = '0';
        continue;
      }
      p.el.style.transform = `translate(${p.x.toFixed(0)}px, ${(p.y - k * 36).toFixed(0)}px) translate(-50%, -50%)`;
      p.el.style.opacity = (1 - k * k).toFixed(2);
    }
  }

  /** arrows: array of {x, y, angle} in screen px (edge positions) */
  setArrows(list, n) {
    for (let i = 0; i < this.arrows.length; i++) {
      const a = this.arrows[i];
      if (i < n) {
        const q = list[i];
        a.style.display = 'block';
        a.style.transform = `translate(${q.x.toFixed(0)}px, ${q.y.toFixed(0)}px) translate(-50%, -50%) rotate(${q.angle.toFixed(1)}deg)`;
      } else if (a.style.display !== 'none') {
        a.style.display = 'none';
      }
    }
  }

  debug(text) {
    this.el.debug.textContent = text;
  }
}
