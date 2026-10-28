import { loadSave, writeSave } from '../core/storage.js';

// Lessons and just-in-time hints (ai/summary.md §5.4).
//
// One new thing at a time, just before it is needed. A lesson starts at a wave marker {lesson: id}: its hint stays up
// until the lesson is done (a short "✓") or HINT_T has passed. While it is open only its practice waves {practice: id}
// come (the wave clock waits at the next other wave, src/game/waves.js) and the density director doesn't
// fast-forward; the practice repeats (at most twice) if it is gone and the lesson isn't done. Lessons never block the
// stage for long: after HOLD_MAX seconds of waiting, or the last repeat, the lesson closes.
// Done lessons are remembered per browser: later runs skip them. Lessons are location 1's only: later locations
// introduce each new threat with one line (data.intros, wave {intro: id}), also shown once per browser.
//
// Hint text: [KEY] is drawn as a key cap. A hint is a string, or {keyboard, touch, gamepad} for device-aware wording.

const HINT_T = 6;
const HOLD_MAX = 14;
const REPEATS = 2;

const MOVE = { keyboard: '[W] [A] [S] [D]: move', touch: 'LEFT THUMB: move', gamepad: 'LEFT STICK: move' };
const ROLL = { keyboard: 'hold [Q] / [E] to roll', touch: 'hold [⟲] / [⟳] to roll', gamepad: 'hold [LB] / [RB] to roll' };
const EVADE = { keyboard: 'DOUBLE-TAP [Q] or [E]', touch: 'DOUBLE-TAP [⟲] or [⟳]', gamepad: 'DOUBLE-TAP [LB] or [RB]' };
const BOMB = { keyboard: '[SHIFT]: bomb', touch: '[BOMB]', gamepad: '[LT]: bomb' };
const per = (f) => ({ keyboard: f('keyboard'), touch: f('touch'), gamepad: f('gamepad') });

export const LESSONS = {
  aim: {
    title: 'AIM',
    hint: { keyboard: 'MOUSE: aim · hold [CLICK] or [SPACE]: fire', touch: 'RIGHT THUMB: drag to aim · auto-fire is on', gamepad: 'RIGHT STICK: aim · [RT]: fire' },
  },
  lead: { title: 'LEAD', hint: 'Moving targets: your shots meet them at the ◇' },
  red: { title: 'POW', hint: 'RED SQUADRON: shoot down all five for a POW\nEach POW adds guns. Lose a ship and you are back to one' },
  move: {
    title: 'MOVE',
    hint: per((d) => `${MOVE[d]}. A red ring shows where something will cross:\nonly the small ring on your ship can be hit. Get it out of the red ring`),
  },
  aimed: { title: 'DODGE', hint: 'Enemy shots fly to where you were when they fired: keep moving' },
  roll: { title: 'ROLL', hint: per((d) => `INVERTED WING: shielded until you roll to match them\n${ROLL[d]}`) },
  roll90: { title: 'ROLL 90°', hint: 'Roll 90° to line up with them' },
  shells: { title: 'SHELLS', hint: 'SHELLS: slow and big. Shoot them before they burst' },
  mines: { title: 'MINES', hint: "Shot mines burst into slow shrapnel: hit them while they're far away" },
  missiles: { title: 'MISSILES', hint: 'MISSILES home in for a moment: side-step late, or shoot them' },
  laser: { title: 'LASER', hint: 'Red aim line: a laser is charging. Get off the line before it fires' },
  evade: {
    title: 'EVASIVE ROLL',
    hint: per((d) => `Can't get out of the way? ${EVADE[d]}: evasive roll\nEverything passes through you, 3 times per stage`),
  },
  boss: { title: 'BOSS', hint: 'Shoot its guns first. The core opens after.' },
  bomb: { title: 'BOMB', hint: per((d) => `${BOMB[d]}. It clears the bullets around you`), trigger: true },
};

const TIPS = {
  pairs: 'Wasps fire a pair either side of you: hold still between them',
  beam: 'The aim line freezes just before the laser fires: move then',
  // just-in-time (each at most once per run)
  still: 'Keep moving: aimed shots go where you were',
  heading: "Watch where you're heading: red rings show where shots will cross",
  evadeLeft: per((d) => `${EVADE[d]} to roll through`),
  bombNow: per((d) => `${BOMB[d]} clears bullets`),
  lastShield: 'One more hit costs a ship. Shield pickups restore it',
  medal: 'MEDAL LOST: catch every medal and its value keeps climbing',
  deflect: per((d) => `Roll to match them: ${ROLL[d]}`),
};

export class Tutor {
  constructor(game) {
    this.game = game;
    const save = loadSave();
    this.save = save;
    save.tutorial ||= { done: {} };
    this.reset();
  }

  /** A new run (or loop). */
  reset() {
    this.current = null; // open lesson {id, t, holdT, practice: [waves], repeats, count, hintT, ...}
    this.tipsShown = new Set();
    this.stillHits = 0;
    this.redSeenT = -1;
    this.deflects = [];
    this.lastLessonT = -1e9;
  }

  get enabled() {
    return this.game.locIdx === 0 && !this.game.debug.noTutor;
  }

  /** A later location's new threat, in one line (data.intros): once per browser, after its first wave shows up. */
  introduce(id) {
    const text = this.game.loc?.intros?.[id];
    if (!text) return this.tip(id);
    const seen = (this.save.tutorial.intros ||= {});
    if (seen[id] || this.game.debug.noTutor) return;
    seen[id] = true;
    writeSave();
    this.game.hud.hint(this.text(text), 5);
    this.game.tm?.event('tip', { id });
  }

  isDone(id) {
    return !!this.save.tutorial.done[id];
  }

  /** Lesson open and holding the wave timeline? */
  get holding() {
    const c = this.current;
    return !!c && !LESSONS[c.id].trigger && c.holdT < HOLD_MAX;
  }

  text(h) {
    if (typeof h === 'string') return h;
    return h[this.game.input.device] || h.keyboard;
  }

  /** Wave marker {lesson: id}. */
  start(id) {
    if (!this.enabled || !LESSONS[id] || this.isDone(id)) return;
    if (this.current) this.close('superseded');
    const L = LESSONS[id];
    this.current = { id, t: this.game.time, holdT: 0, practice: [], repeats: 0, count: 0, seenRed: -1, clearT: 0, replay: [] };
    this.lastLessonT = this.game.time;
    this.game.hud.hint(this.text(L.hint), HINT_T);
    this.game.tm?.event('lesson', { id, what: 'shown' });
  }

  /** A practice wave {practice: id} was started (by the timeline or by a repeat). */
  practiceStarted(w) {
    const c = this.current;
    if (c && w.practice === c.id && !c.practice.includes(w)) c.practice.push(w);
  }

  done(id) {
    const c = this.current;
    if (!c || c.id !== id) return;
    this.save.tutorial.done[id] = true;
    writeSave();
    this.game.hud.hint('✓ ' + LESSONS[id].title, 1.4, 'ok');
    this.game.audio?.pickup();
    this.game.tm?.event('lesson', { id, what: 'done', after: +(this.game.time - c.t).toFixed(1), repeats: c.repeats });
    if (id === 'move') this.game.rocks.unguide();
    this.current = null;
  }

  close(why) {
    const c = this.current;
    if (!c) return;
    this.game.tm?.event('lesson', { id: c.id, what: why, after: +(this.game.time - c.t).toFixed(1), repeats: c.repeats });
    this.current = null;
  }

  /** One-line tip (wave {intro: id}, boss beam, just-in-time): at most once per run. */
  tip(id, time = 4) {
    if (!this.enabled || this.tipsShown.has(id)) return;
    // a lesson hint on screen wins; so does a lesson that just covered the same ground
    if (this.current && this.game.time - this.current.t < HINT_T) return;
    this.tipsShown.add(id);
    this.game.hud.hint(this.text(TIPS[id]), time);
    this.game.tm?.event('tip', { id });
  }

  /** Called once per frame while playing. */
  update(dt) {
    const g = this.game;
    const c = this.current;
    if (!c) {
      this._watchCrowd();
      return;
    }
    if (this.holding && g.waves.atLessonGate) c.holdT += dt;
    // "you moved out of a red ring": a red marker that then went away without a hit
    if (c.id === 'move') {
      const red = g.danger.list.some((m) => m.red && (m.kind === 'rock' || m.kind === 'ship') && m.t < 1.1);
      if (red) c.seenRed = g.time;
      else if (c.seenRed > 0 && g.time - c.seenRed > 0.35) {
        c.seenRed = -1;
        return this.done(c.id);
      }
    }
    // practice repeats: everything from the practice waves is gone and the lesson is still open. A repeat replays
    // them with their authored spacing (game time: the wave clock is waiting at the next other wave)
    while (c.replay.length && c.replay[0].t <= g.time) g.waves.start(c.replay.shift().w);
    if (c.practice.length && !c.replay.length && !LESSONS[c.id].trigger) {
      const live = g.enemies.list.some((e) => c.practice.includes(e.wave)) || g.waves.pending.some((p) => c.practice.includes(p.wave));
      const rocksLive = c.practice.some((w) => w.drift) && g.rocks.n > 0;
      if (!live && !rocksLive) {
        c.clearT += dt;
        if (c.clearT > 1.2) {
          c.clearT = 0;
          if (c.repeats >= REPEATS) return this.close('timeout');
          c.repeats++;
          g.tm?.event('lesson', { id: c.id, what: 'repeat', n: c.repeats });
          g.hud.hint(this.text(LESSONS[c.id].hint), 4);
          const t0 = c.practice[0].at;
          c.replay = c.practice.map((w) => ({ t: g.time + (w.at - t0), w }));
        }
      } else c.clearT = 0;
    }
    if (c.holdT >= HOLD_MAX && !LESSONS[c.id].trigger) this.close('timeout');
  }

  _watchCrowd() {
    const g = this.game;
    const p = g.player;
    if (!p.alive || p.bombs <= 0) return;
    const reds = g.danger.list.filter((m) => m.red && m.kind !== 'pickup').length;
    if (reds >= 3) this.tip('bombNow', 3);
  }

  // ------------------------------------------------------------------------------------------
  // game events

  onKill(e, aligned, by) {
    const c = this.current;
    if (!c) return;
    const g = this.game;
    if (c.id === 'aim' && ++c.count >= 3) this.done('aim');
    else if (c.id === 'lead' && by === 'shot' && g.leadOn && ++c.count >= 2) this.done('lead');
    else if ((c.id === 'roll' || c.id === 'roll90') && aligned) this.done(c.id);
    else if (c.id === 'mines' && e.type === 'mine' && e.pos.distanceTo(g.player.pos) > 150) this.done('mines');
  }

  /** A whole red squadron shot down (its POW is out): the lesson is done, no more practice squadrons. */
  onSquadron() {
    if (this.current?.id === 'red') this.done('red');
  }

  /** An enemy bullet crossed the ship's plane near the ship without hitting it (shots.js). */
  onBulletPassed(kind) {
    const c = this.current;
    if (c?.id === 'aimed' && kind === 0 && ++c.count >= 2) this.done('aimed');
  }

  onShellShot() {
    if (this.current?.id === 'shells') this.done('shells');
  }

  /** An enemy missile was shot down, or went by without hitting. */
  onMissileGone() {
    if (this.current?.id === 'missiles') this.done('missiles');
  }

  /** A telegraphed enemy beam finished without hitting the player. */
  onBeamMissed(fence) {
    if (!fence && this.current?.id === 'laser') this.done('laser');
  }

  onDodge() {
    if (this.current?.id === 'evade') this.done('evade');
  }

  onBossPart(core) {
    if (!core && this.current?.id === 'boss') this.done('boss');
  }

  /** Event-triggered lessons (no wave marker): 'bomb' when the cruiser's core opens. */
  trigger(id) {
    if (this.current && !LESSONS[this.current.id].trigger && this.game.time - this.current.t < HINT_T) return;
    this.start(id);
  }

  onBomb() {
    if (this.current?.id === 'bomb') this.done('bomb');
  }

  onDeflect() {
    const t = this.game.time;
    this.deflects.push(t);
    while (this.deflects.length && this.deflects[0] < t - 2) this.deflects.shift();
    if (this.deflects.length >= 12) this.tip('deflect', 3.5);
  }

  /** Just-in-time hints from what hit you (ai/summary.md §5.4). */
  onHit(src) {
    const g = this.game;
    const p = g.player;
    const speed = Math.hypot(p.vel.x, p.vel.y);
    if (p.shield === 1) this.tip('lastShield', 3.5);
    if (src?.src === 'bullet') {
      if (speed < 4 && src.kind === 0 && ++this.stillHits >= 2) this.tip('still', 3.5);
      else if (speed > 12 && (src.markedFor ?? 0) < 0.3) this.tip('heading', 3.5);
    }
    if (p.evades > 0 && this.isDone('evade')) this.tip('evadeLeft', 3);
    const c = this.current;
    if (c?.id === 'move') c.seenRed = -1; // that red ring went away by hitting you
  }
}
