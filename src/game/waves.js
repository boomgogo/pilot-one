import { buildMembers } from './formations.js';

// Wave timeline for the current section + density director.
// The director fast-forwards the timeline when the screen is quiet, so there is never dead air: 4× while fewer than
// minAlive targets are in view, and a jump to the next wave once nothing has been in view for EMPTY_T s (killing fast
// brings the next wave sooner), at most PULL_MAX s ahead of its authored time (ai/summary.md §7.3).

let nextWaveId = 1;
const EMPTY_T = 1;
const PULL_MAX = 10;

// Formations a location can enlarge (loc.formations.squad) and send round for a second pass (loc.formations.loop:
// the share of waves that loop). Locations 4–5 get harder through formations, not bullets (ai/summary.md §7.1, §7.2).
const SQUAD = new Set(['vee', 'sweep', 'helix', 'dive', 'overtake', 'ring', 'swarm']);
const LOOP = new Set(['vee', 'sweep', 'helix', 'dive', 'ring', 'snake', 'wall']);

/** Pre-build every formation path of a location (done at load: no runtime allocation for paths). */
export function prepareWaves(loc) {
  const fm = loc.formations || {};
  const every = fm.loop ? Math.max(1, Math.round(1 / fm.loop)) : 0;
  let k = 0;
  for (const sec of loc.sections) {
    sec.waves.sort((a, b) => a.at - b.at);
    for (const w of sec.waves) {
      w.id = nextWaveId++;
      if (w.gate) Object.assign(w, { f: 'gatepost', type: 'hammer', n: 2, armored: true });
      const plain = w.f && !w.red && !w.practice && !w.lesson;
      if (plain && fm.squad && SQUAD.has(w.f) && (w.n || 1) >= 3) w.n = Math.round(w.n * fm.squad);
      if (plain && every && LOOP.has(w.f) && w.loop === undefined && k++ % every === 0) w.loop = true;
      if (w.f) w.members = buildMembers(w);
    }
  }
}

export class WaveRunner {
  constructor(game) {
    this.game = game;
    this.waves = [];
    this.clock = 0;
    this.idx = 0;
    this.pending = [];
    this.minAlive = 4;
    this.atLessonGate = false; // an open lesson is holding the clock before the next non-practice wave (tutor.js)
    this.inView = 0; // targets in view (inViewNow())
    this.emptyT = 0;
  }

  load(section) {
    this.waves = section.waves;
    this.dock = !!section.dock;
    this.clock = 0;
    this.idx = 0;
    this.emptyT = 0;
    this.pending.length = 0;
  }

  /** Targets you can see: enemies on screen ahead within range (Enemies.visible), live hulk parts on screen, a boss. */
  inViewNow() {
    const g = this.game;
    let n = g.enemies.visible + (g.boss?.active ? 6 : 0);
    for (const h of g.hulks.list) for (const p of h.parts) if (p.alive && g.onScreen(p.world.x, p.world.y, p.world.z, 0)) n++;
    return n;
  }

  clear() {
    this.waves = [];
    this.pending.length = 0;
  }

  update(dt) {
    const g = this.game;
    const holding = g.tutor?.holding;
    const seen = (this.inView = this.inViewNow());
    const ahead = !holding && this.idx < this.waves.length && this.pending.length === 0 ? this.waves[this.idx] : null;
    let scale = 1;
    if (ahead && seen < this.minAlive && ahead.at - this.clock > 0.7) scale = 4;
    let next = this.clock + dt * scale;
    // an empty screen: the next wave (not a lesson, hint or message, which are timed to the place) comes now
    this.emptyT = ahead && !this.dock && seen === 0 ? this.emptyT + dt : 0;
    if (this.emptyT >= EMPTY_T && (ahead.members || ahead.hulk || ahead.hazard)) {
      this.emptyT = 0;
      const to = Math.min(ahead.at, g.stage.time + PULL_MAX);
      if (to > next) {
        g.tm?.event('pull', { wave: ahead.id, s: +(to - next).toFixed(2) });
        next = to;
      }
    }
    this.atLessonGate = false;
    if (holding) {
      // an open lesson: practise it while little else happens. The clock doesn't pass the next wave that isn't
      // this lesson's practice until the lesson is done (or its hold budget runs out, see tutor.js)
      const id = g.tutor.current.id;
      for (let k = this.idx; k < this.waves.length; k++) {
        const w = this.waves[k];
        if (w.practice === id) continue;
        if (next >= w.at) {
          next = Math.max(this.clock, w.at - 1e-3);
          this.atLessonGate = true;
        }
        break;
      }
    }
    this.clock = next;
    while (this.idx < this.waves.length && this.waves[this.idx].at <= this.clock) {
      this.start(this.waves[this.idx++]);
    }
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      if (p.time <= this.clock) {
        this.pending.splice(k, 1);
        this.spawnMember(p.wave, p.member);
      }
    }
  }

  start(w) {
    const g = this.game;
    if (w.msg) g.hud.banner(w.msg, w.msgT || 2.2, !!w.warn);
    if (w.warn) g.audio?.warning();
    if (w.hint) g.hud.hint(w.hint, w.hintT || 3);
    if (w.lesson) g.tutor?.start(w.lesson);
    if (w.intro) g.tutor?.introduce(w.intro);
    if (w.practice) g.tutor?.practiceStarted(w);
    if (w.drift) g.rocks.drift(w.drift, g.stage.speed);
    if (w.hulk) g.hulks.spawn(w);
    if (w.hazard) g.hazards.start(w);
    if (!w.members) return;
    w.killed = 0;
    w.gone = 0;
    w.n = w.members.length;
    for (const m of w.members) {
      if (m.delay <= 0) this.spawnMember(w, m);
      else this.pending.push({ time: this.clock + m.delay, wave: w, member: m });
    }
  }

  spawnMember(w, m) {
    const e = this.game.enemies.spawn(w.type, m, w);
    // the shoot-down ratio counts it once it could be engaged (Enemies.engage); raw counts every spawn
    if (e && !w.armored) this.game.stats.raw++;
    else w.gone++;
  }
}
