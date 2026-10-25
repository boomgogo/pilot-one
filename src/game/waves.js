import { buildMembers } from './formations.js';

// Wave timeline for the current section + density director.
// The director fast-forwards the timeline when the screen is quiet, so there is never dead air.

let nextWaveId = 1;

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
  }

  load(section) {
    this.waves = section.waves;
    this.clock = 0;
    this.idx = 0;
    this.pending.length = 0;
  }

  clear() {
    this.waves = [];
    this.pending.length = 0;
  }

  update(dt) {
    const g = this.game;
    const holding = g.tutor?.holding;
    let scale = 1;
    if (!holding && this.idx < this.waves.length && this.pending.length === 0 && g.enemies.alive + (g.boss?.active ? 6 : 0) < this.minAlive) {
      const gap = this.waves[this.idx].at - this.clock;
      if (gap > 0.7) scale = 4;
    }
    let next = this.clock + dt * scale;
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
