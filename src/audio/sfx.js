// Synthesized sound effects (WebAudio): nothing to download, so they cost nothing at load time.

// Every public effect. ?capture records calls with game time and renders them offline afterwards.
const EFFECTS = [
  'shot', 'enemyShot', 'hit', 'deflect', 'explosion', 'playerHit', 'pickup', 'powerUp', 'bomb', 'warning', 'beamCharge',
  'extraLife', 'whoosh', 'evade', 'missile', 'lockWarn', 'laser', 'shellPop', 'cancel', 'tick', 'zap', 'rumble', 'jump',
  'medalLost',
];

/**
 * Fill an OfflineAudioContext about a second at a time: fill(k, len) runs now for k = 0, then at the start of each
 * later ~1 s chunk (a render-quantum boundary). Scheduling a whole render up front keeps every future note in the
 * audio graph from the start, which made a minute of music take two minutes to render.
 */
export function offlineChunks(ctx, dur, fill) {
  const len = (128 * 344) / ctx.sampleRate;
  fill(0, len);
  for (let k = 1; k * len < dur; k++) {
    ctx.suspend(k * len).then(() => {
      fill(k, len);
      ctx.resume();
    });
  }
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.muted = false;
    this.last = {};
  }

  /** Must be called from a user gesture (Start button). */
  init() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.initWith(new AC());
  }

  initWith(ctx) {
    this.ctx = ctx;
    this.master = this.ctx.createGain();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 6;
    // makeup gain: the synthesized effects measured ~-40 LUFS in recordings without it, ~-24 with it (references: ~-19)
    this.makeup = this.ctx.createGain();
    this.makeup.gain.value = 3.5;
    this.master.connect(this.comp).connect(this.makeup).connect(this.ctx.destination);
    this.applyVolume();
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    this.applyVolume();
  }
  toggleMute() {
    this.muted = !this.muted;
    this.applyVolume();
    this.music?.setMuted(this.muted);
    return this.muted;
  }
  applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.6;
  }
  suspend() {
    this.ctx?.suspend?.();
  }
  resume() {
    this.ctx?.resume?.();
  }

  /** ?capture: log effect calls against the game clock instead of playing them in wall-clock time. */
  startRecording(clock) {
    this.recording = [];
    this.clock = clock;
    this.init = () => {};
    for (const name of EFFECTS) {
      this[name] = (...args) => {
        if (!this.muted) this.recording.push([clock(), name, args]);
      };
    }
  }

  /**
   * Render the recorded calls from game time t0 with an OfflineAudioContext. Returns a base64 mono WAV.
   * t1: the window's end (default: the last call + 3 s). lead: calls this long before t0 still play, at the start
   * (the ones made by the click or launch that opens a video segment). music / effects: false leaves that part out
   * (stems for the video editor, ai/plan_0.md §3.1). The song playing before the window is carried in at its phase.
   */
  async renderRecording(t0 = 0, { t1 = null, lead = 0, music = true, effects = true } = {}, sampleRate = 44100) {
    const rec = this.recording || [];
    const isMusic = (e) => e[1] === 'music' || e[1] === 'jingle';
    const end = t1 ?? (rec.length ? Math.max(rec[rec.length - 1][0], this.clock?.() ?? 0) : t0) + 3;
    const all = rec.filter((e) => e[0] >= t0 - lead && e[0] < end).map((e) => (e[0] < t0 ? [t0, e[1], e[2]] : e));
    const ev = effects ? all.filter((e) => !isMusic(e)) : [];
    const before = rec.filter((e) => e[0] < t0 - lead && e[1] === 'music').pop();
    const dur = Math.max(0.1, end - t0);
    const ctx = new OfflineAudioContext(1, Math.ceil(dur * sampleRate), sampleRate);
    const sfx = new Sfx();
    sfx.offline = true;
    sfx.volume = this.volume;
    sfx.initWith(ctx);
    let pump = null;
    if (this.music && music) {
      // the music, from the same song data and cue times (src/audio/music.js)
      const mu = new this.music.constructor(sfx);
      mu.songs = this.music.songs;
      mu.volume = this.music.volume;
      pump = mu.renderOffline(ctx, sfx.comp, [...(before ? [before] : []), ...all.filter(isMusic)], t0, dur);
    }
    // the calls go in about a second ahead of the render, each at its own time (sfx.at)
    let i = 0;
    offlineChunks(ctx, dur, (k, len) => {
      for (; i < ev.length && ev[i][0] - t0 < (k + 1) * len; i++) {
        const [t, name, args] = ev[i];
        sfx.at = Math.max(0, t - t0);
        sfx[name](...args);
      }
      sfx.at = null;
      pump?.((k + 2) * len);
    });
    const buf = await ctx.startRendering();
    return wavBase64(buf.getChannelData(0), sampleRate);
  }

  /** The audio clock. An offline render sets `at` to schedule a call at its own time. */
  now() {
    return this.at ?? this.ctx.currentTime;
  }

  _ok(name, minGap) {
    if (!this.ctx || this.muted || (!this.offline && this.ctx.state !== 'running')) return false;
    const t = this.now();
    if (this.last[name] && t - this.last[name] < minGap) return false;
    this.last[name] = t;
    return true;
  }

  _tone(type, f0, f1, dur, gain, delay = 0) {
    const c = this.ctx;
    const t = this.now() + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(dur, gain, f0, f1, q = 0.7, delay = 0, type = 'lowpass') {
    const c = this.ctx;
    const t = this.now() + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const flt = c.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  shot() {
    if (!this._ok('shot', 0.07)) return;
    this._tone('square', 1400, 380, 0.055, 0.035);
  }
  enemyShot() {
    if (!this._ok('eshot', 0.09)) return;
    this._tone('sawtooth', 520, 260, 0.09, 0.03);
  }
  hit() {
    if (!this._ok('hit', 0.04)) return;
    this._noise(0.05, 0.08, 4000, 1500, 1, 0, 'bandpass');
  }
  deflect() {
    if (!this._ok('deflect', 0.06)) return;
    this._tone('triangle', 2400, 1800, 0.07, 0.05);
  }
  explosion(size = 1) {
    if (!this._ok('boom' + Math.round(size), 0.05)) return;
    const d = 0.25 + size * 0.22;
    this._noise(d, 0.22 + size * 0.08, 1800, 60, 0.8);
    this._tone('sine', 120, 35, d, 0.18 * Math.min(size, 2));
  }
  playerHit() {
    if (!this._ok('phit', 0.1)) return;
    this._tone('square', 220, 70, 0.25, 0.12);
    this._noise(0.25, 0.2, 2500, 200, 0.8);
  }
  pickup() {
    if (!this._ok('pick', 0.05)) return;
    [660, 880, 1320].forEach((f, i) => this._tone('square', f, f * 1.01, 0.08, 0.05, i * 0.06));
  }
  powerUp() {
    if (!this._ok('pow', 0.1)) return;
    [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone('square', f, f, 0.09, 0.05, i * 0.055));
  }
  bomb() {
    if (!this._ok('bomb', 0.2)) return;
    this._noise(1.2, 0.35, 3000, 50, 0.6);
    this._tone('sawtooth', 300, 40, 1.0, 0.15);
  }
  warning() {
    if (!this._ok('warn', 1)) return;
    for (let i = 0; i < 3; i++) {
      this._tone('square', 880, 660, 0.22, 0.05, i * 0.5);
      this._tone('square', 660, 880, 0.22, 0.05, i * 0.5 + 0.25);
    }
  }
  beamCharge() {
    if (!this._ok('beam', 0.3)) return;
    this._tone('sawtooth', 200, 1600, 1.0, 0.04);
    this._noise(1.0, 0.06, 300, 4000, 4, 0, 'bandpass');
  }
  /** A medal got past: the ladder starts again (ai/summary.md §6.3). Two falling notes. */
  medalLost() {
    if (!this._ok('medalLost', 0.3)) return;
    this._tone('square', 784, 740, 0.12, 0.06);
    this._tone('square', 523, 330, 0.26, 0.06, 0.13);
  }
  extraLife() {
    if (!this._ok('1up', 0.3)) return;
    [784, 988, 1175, 1568].forEach((f, i) => this._tone('triangle', f, f, 0.14, 0.08, i * 0.09));
  }
  whoosh() {
    if (!this._ok('whoosh', 0.3)) return;
    this._noise(0.9, 0.12, 300, 3000, 2, 0, 'bandpass');
  }
  evade() {
    if (!this._ok('evade', 0.2)) return;
    this._noise(0.45, 0.14, 600, 5200, 1.6, 0, 'bandpass');
    this._tone('sine', 420, 1260, 0.4, 0.05);
  }
  missile() {
    if (!this._ok('missile', 0.12)) return;
    this._noise(0.35, 0.07, 900, 3500, 1.2, 0, 'bandpass');
  }
  lockWarn() {
    if (!this._ok('lock', 0.5)) return;
    this._tone('square', 1760, 1760, 0.06, 0.04);
    this._tone('square', 1760, 1760, 0.06, 0.04, 0.1);
  }
  laser() {
    if (!this._ok('laser', 0.09)) return;
    this._tone('sawtooth', 900, 1100, 0.1, 0.025);
  }
  shellPop() {
    if (!this._ok('pop', 0.06)) return;
    this._tone('triangle', 900, 300, 0.12, 0.06);
  }
  cancel() {
    if (!this._ok('cancel', 0.05)) return;
    this._tone('sine', 1500, 2400, 0.08, 0.03);
  }
  /** Tally counting up. */
  tick() {
    if (!this._ok('tick', 0.045)) return;
    this._tone('square', 1900, 1900, 0.025, 0.018);
  }
  /** Lightning strike / solar flare hitting its zone. */
  zap() {
    if (!this._ok('zap', 0.12)) return;
    this._noise(0.35, 0.22, 6000, 400, 0.9, 0, 'bandpass');
    this._tone('sawtooth', 1800, 90, 0.3, 0.06);
  }
  /** Something big passing or erupting (geysers, a hulk's engines). */
  rumble() {
    if (!this._ok('rumble', 0.4)) return;
    this._noise(1.1, 0.16, 400, 60, 0.7);
  }
  /** The jump between locations. */
  jump() {
    if (!this._ok('jump', 1)) return;
    this._noise(1.6, 0.16, 200, 6000, 1.4, 0, 'bandpass');
    this._tone('sawtooth', 60, 900, 1.5, 0.06);
    this._tone('sine', 900, 40, 0.8, 0.12, 1.5);
  }
}

export function wavBase64(samples, rate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
