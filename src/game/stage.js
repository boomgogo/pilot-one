// Drives rail progress through the world's sections and decides forks.
// Within a section, progress is linear in section time, so every route reaches each landmark at the same time.
// Sections are grouped into stages (src/data/world1.js); a stage's last TRANSIT seconds are the between-stage tally.

export const TRANSIT = 5;

export class StageRunner {
  constructor(game, data, routes, forks) {
    this.game = game;
    this.data = data;
    this.routes = routes;
    this.forks = forks;
    this.reset();
  }

  reset(startSection = 0, startTime = 0, forced = {}) {
    this.choices = {};
    this.decided = {};
    for (const f of this.forks) {
      if (forced[f.id]) {
        this.choices[f.id] = forced[f.id];
        this.decided[f.id] = true;
      } else {
        this.choices[f.id] = f.options[0].key;
      }
    }
    this.route = this._routeFor(this.choices);
    this.index = startSection;
    this.time = startTime;
    this.warp = false;
    this.done = false;
    this.s = this._s();
    this.speed = 0;
    this.entered = -1;
  }

  _routeFor(choices) {
    return this.routes.find((r) => this.forks.every((f) => r.choices[f.id] === choices[f.id])) || this.routes[0];
  }

  get section() {
    return this.data.sections[this.index];
  }

  /** Is the current section the last one of its stage? */
  get stageEnding() {
    const next = this.data.sections[this.index + 1];
    return !next || next.stage !== this.section.stage;
  }

  _s() {
    const sec = this.section;
    const a = this.route.labels[sec.from];
    const b = this.route.labels[sec.to];
    return a + (b - a) * Math.min(1, this.time / sec.duration);
  }

  /** Remaining time in the section (seconds). */
  get remaining() {
    return this.section.duration - this.time;
  }

  update(dt, active = true) {
    if (this.done) return;
    if (this.entered !== this.index) {
      this.entered = this.index;
      this.game.onSectionStart(this.section, this.time);
    }
    // after a boss falls the rest of its section warps past, but never the transit (the tally plays at normal speed)
    this.time += dt * (this.warp && this.remaining > TRANSIT ? 7 : 1);
    const s = this._s();
    // fork gates
    for (const f of this.forks) {
      if (this.decided[f.id]) continue;
      if (s >= this.route.labels[f.gate]) {
        const v = this.game.player.pos[f.axis];
        const opt = f.options.find((o) => (v >= 0 ? o.sign > 0 : o.sign < 0)) || f.options[0];
        this.choices[f.id] = opt.key;
        this.decided[f.id] = true;
        this.route = this._routeFor(this.choices);
        if (active) this.game.onForkChosen(f, opt);
      }
    }
    const ns = this._s();
    this.speed = dt > 0 ? (ns - this.s) / dt : 0;
    this.s = ns;
    if (this.time >= this.section.duration) {
      const sec = this.section;
      this.warp = false;
      if (this.index < this.data.sections.length - 1) {
        this.index++;
        this.time = 0;
        this.game.onSectionEnd(sec);
      } else {
        this.done = true;
        this.game.onSectionEnd(sec);
      }
    }
  }

  /** Place the rail anchor. */
  apply(root) {
    this.route.sample(this.s, root.position, root.quaternion);
  }

  /** Total stage progress 0..1 (for the HUD / debug). */
  get progress() {
    const r = this.route;
    return this.s / r.labels[this.data.sections[this.data.sections.length - 1].to];
  }
}
