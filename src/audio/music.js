// Music (ai/summary.md §9): a small sequencer on WebAudio with synthesized instruments, so a theme costs a few KB of
// note data and nothing in load time. It shares the effects' context and compressor (src/audio/sfx.js), so loud
// effects push the music down a little on their own.
//
// A song is data (src/audio/songs.js, and each location's own songs):
//   { name, bpm, inst: {channel: instrument}, mix: {channel: gain}, sections: {id: section}, form: [ids], loopFrom }
// A section: { bars, chords, mel, counter, bass, layers, styles }
//   chords: one token per bar, "Dm" or "Dm,C" (two half-bar chords); qualities: m 7 m7 maj7 sus4 sus2 dim 5
//   mel / counter / bass (optional, else generated): notes with lengths in 16ths, "D5:6 A5:2 r:4", "|" ignored
//   layers: the channels that play ("lead bass pad arp drums counter"); styles: {bass, arp, pad, drums}
// Accompaniment (bass, arp, pad, drums) is generated from the chords by style, unless written out.

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUAL = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], 5: [0, 7, 12] };
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function noteMidi(tok) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(tok);
  if (!m) return null;
  return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function chordOf(tok) {
  const m = /^([A-G][#b]?)(.*)$/.exec(tok);
  const root = NOTE[m[1][0]] + (m[1][1] === '#' ? 1 : m[1][1] === 'b' ? -1 : 0);
  return { root, iv: QUAL[m[2]] || QUAL[''] };
}

/** "D5:6 A5:2 r:4" → [{step, midi, len}] (midi null = rest). */
function parseLine(str, tr = 0) {
  const out = [];
  let step = 0;
  for (const t of str.split(/\s+/)) {
    if (!t || t === '|') continue;
    const [n, l] = t.split(':');
    const len = +(l || 4);
    const midi = n === 'r' ? null : noteMidi(n);
    if (midi !== null) out.push({ step, midi: midi + tr, len });
    step += len;
  }
  return { notes: out, steps: step };
}

// Drum patterns, 16 steps per bar: k kick, s snare, h hat, o open hat, m metal, t tom (x = hit, X = accent)
const DRUMS = {
  rock: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  drive: { k: 'x...x...x...x...', s: '....x.......x...', h: 'xxXxxxXxxxXxxxXx', o: '..............x.' },
  half: { k: 'x.........x.....', s: '........x.......', h: 'x...x...x...x...' },
  industrial: { k: 'x..x..x...x..x..', s: '....x.......x..x', m: '..x...x.x...x...', h: 'x.x.x.x.x.x.x.x.' },
  march: { k: 'x...x..xx...x...', s: '....x.......x.xx', h: 'x.xxx.xxx.xxx.xx' },
  sparse: { k: 'x.......x.......', h: '....x.......x...', t: '..............x.' },
  blast: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', o: '..x...x...x...x.' },
  roll: { s: 'x.x.x.x.xxxxxxxx', k: 'x...............' },
};
const FILL = { s: '....x.....x.xxxx', k: 'x.......x.......' };

const VOICES = {}; // instrument name → (m, t, freq, dur, vel, out)

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    sfx.music ||= this;
    this.songs = {};
    this.players = []; // {song, t0, step, gain, once}
    this.main = null;
    this.volume = 0.7;
    this.muted = false;
    this.timer = null;
  }

  /** Make songs playable by name (a location's songs register when it loads). */
  register(songs) {
    for (const s of Object.values(songs || {})) if (s?.name) this.songs[s.name] = s;
  }

  _nodes() {
    const ctx = this.sfx.ctx;
    if (!ctx) return false;
    if (this.ctx === ctx) return true;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(this.sfx.comp);
    this.delay = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    this.send = ctx.createGain();
    this.send.gain.value = 0.22;
    this.send.connect(this.delay).connect(fb).connect(this.delay);
    this.delay.connect(this.out);
    this.applyVolume();
    return true;
  }

  setVolume(v) {
    this.volume = v;
    this.applyVolume();
  }
  setMuted(m) {
    this.muted = m;
    this.applyVolume();
  }
  applyVolume() {
    if (this.out) this.out.gain.value = this.muted ? 0 : this.volume * 0.22;
  }

  /** Start a song (object or name) as the main theme. The same song keeps playing. */
  play(song) {
    if (typeof song === 'string') song = this.songs[song];
    if (this.sfx.recording) {
      // ?capture: logged against the game clock and rendered offline with the effects (renderOffline)
      if (song && song !== this.mainSong) this.sfx.recording.push([this.sfx.clock(), 'music', [song.name]]);
      this.mainSong = song;
      return;
    }
    if (!this._nodes()) {
      this.pending = song;
      return;
    }
    if (song && this.main?.song === song) return;
    this.mainSong = song;
    if (this.main) this._fade(this.main, 0.6);
    this.main = song ? this._start(song, false) : null;
    this._run();
  }

  /** A short cue over the theme (stage clear): the theme dips while it plays. */
  jingle(name, tr = null) {
    const song = typeof name === 'string' ? this.songs[name] : name;
    if (!song) return;
    if (this.sfx.recording) {
      this.sfx.recording.push([this.sfx.clock(), 'jingle', [song.name, tr ?? this.mainSong?.tr ?? 0]]);
      return;
    }
    if (!this._nodes()) return;
    const p = this._start(song, true, tr ?? this.main?.song.tr ?? 0);
    const len = this._compile(song).steps * this._stepDur(song);
    if (this.main) {
      const g = this.main.gain.gain;
      const t = this.ctx.currentTime;
      g.setTargetAtTime(0.3, t, 0.05);
      g.setTargetAtTime(1, t + len, 0.3);
    }
    this._run();
    return p;
  }

  /** Jump the main song to a section at its next bar (a boss phase). */
  goto(section) {
    const p = this.main;
    if (!p) return;
    const c = this._compile(p.song);
    const at = c.marks[section];
    if (at === undefined) return;
    p.jumpTo = at;
  }

  /** Drop the main theme to pad, bass and arpeggio (in the dark), or bring it back. */
  calm(on) {
    if (this.main) this.main.calm = on;
  }

  stop() {
    if (this.main) this._fade(this.main, 0.4);
    this.main = null;
    this.mainSong = null;
  }

  /** Resume after the context unlocked (Start): play what was asked for before. */
  resume() {
    if (this.pending && this._nodes()) {
      const s = this.pending;
      this.pending = null;
      this.play(s);
    }
  }

  _stepDur(song) {
    return 60 / song.bpm / 4;
  }

  _start(song, once, tr = 0) {
    const gain = this.ctx.createGain();
    gain.connect(this.out);
    const p = { song, t0: this.ctx.currentTime + 0.08, step: 0, gain, once, tr };
    this.players.push(p);
    return p;
  }

  _fade(p, sec) {
    const t = this.ctx.currentTime;
    p.gain.gain.setTargetAtTime(0, t, sec / 3);
    p.dead = t + sec;
  }

  _run() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), 25);
    this._tick();
  }

  _tick() {
    const now = this.ctx.currentTime;
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.dead && now > p.dead) {
        p.gain.disconnect();
        this.players.splice(i, 1);
        continue;
      }
      if (!p.dead) this._schedule(p, now + 0.15);
    }
    if (!this.players.length) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Schedule player p's steps that start before time `until`. */
  _schedule(p, until, ctx = this.ctx) {
    const c = this._compile(p.song);
    const sd = this._stepDur(p.song);
    while (p.t0 + p.step * sd < until) {
      let k = p.step - (p.offset || 0);
      if (k >= c.steps) {
        if (p.once) {
          p.dead = p.t0 + p.step * sd + 1.5;
          return;
        }
        // loop: continue from the loop point
        p.offset = (p.offset || 0) + (c.steps - c.loopStep);
        k = p.step - p.offset;
      }
      if (p.jumpTo !== undefined && k % 16 === 0) {
        p.offset = p.step - p.jumpTo;
        k = p.jumpTo;
        p.jumpTo = undefined;
      }
      const t = p.t0 + p.step * sd;
      if (!(t < p.skipBefore)) for (const e of c.events[k] || []) this._voice(ctx, p, e, t, sd);
      p.step++;
    }
  }

  _voice(ctx, p, e, t, sd) {
    const f = VOICES[e.inst];
    if (!f || (p.calm && (e.ch === 'drums' || e.ch === 'lead' || e.ch === 'counter'))) return;
    const hz = e.midi !== undefined ? midiHz(e.midi + (p.tr || 0)) : 0;
    f(this, ctx, t, hz, e.len * sd, e.vel, p.gain, e);
  }

  /** Turn a song into per-step event lists (cached): {events: [[{inst, midi, len, vel}]], steps, loopStep, marks}. */
  _compile(song) {
    if (song._c) return song._c;
    const events = [];
    const marks = {};
    let base = 0;
    let loopStep = 0;
    const add = (step, e) => (events[step] ||= []).push(e);
    song.form.forEach((id, fi) => {
      const sec = song.sections[id];
      if (fi === (song.loopFrom ?? 0)) loopStep = base;
      if (marks[id] === undefined) marks[id] = base;
      const layers = new Set((sec.layers || 'lead bass pad arp drums counter').split(/\s+/));
      const st = { ...song.styles, ...sec.styles };
      const bars = sec.bars;
      const chordAt = [];
      const ch = (sec.chords || '').split(/\s+/).filter((x) => x && x !== '|');
      for (let b = 0; b < bars; b++) {
        const tok = (ch[b % Math.max(1, ch.length)] || 'C').split(',');
        chordAt.push(tok.map(chordOf));
      }
      const mix = song.mix || {};
      const inst = song.inst;
      const tr = sec.tr || 0;
      // written lines
      for (const [chan, key] of [['lead', 'mel'], ['counter', 'counter'], ['bass', 'bass'], ['arp', 'arpLine']]) {
        if (!sec[key] || !layers.has(chan)) continue;
        const line = parseLine(sec[key], tr);
        if (line.steps !== bars * 16) console.warn(`music: ${song.name}.${id}.${key} is ${line.steps / 16} bars, not ${bars}`);
        for (const n of line.notes) add(base + n.step, { inst: inst[chan], ch: chan, midi: n.midi, len: n.len, vel: mix[chan] ?? 1 });
      }
      for (let b = 0; b < bars; b++) {
        const s0 = base + b * 16;
        const cs = chordAt[b];
        const chordFor = (step) => cs[cs.length > 1 && step >= 8 ? 1 : 0];
        // bass by style
        if (layers.has('bass') && !sec.bass && st.bass) {
          const pat = BASS[st.bass];
          for (const [step, len, oct, acc] of pat) {
            const c = chordFor(step);
            add(s0 + step, { inst: inst.bass, midi: 36 + c.root + oct + (st.bassOct || 0) + tr, len, vel: (mix.bass ?? 1) * (acc || 0.8) });
          }
        }
        // pad: the chord held for its length
        if (layers.has('pad') && st.pad !== 'none') {
          cs.forEach((c, i) => {
            const len = 16 / cs.length;
            for (const iv of c.iv.slice(0, 4)) add(s0 + i * len, { inst: inst.pad, midi: 48 + c.root + iv + (st.padOct || 0) + tr, len, vel: (mix.pad ?? 1) * 0.5 });
          });
        }
        // arpeggio over the chord tones
        if (layers.has('arp') && !sec.arpLine && st.arp) {
          const a = ARP[st.arp];
          for (let k = 0; k < 16; k += a.every) {
            const c = chordFor(k);
            const tones = [...c.iv, 12, c.iv[1] + 12];
            const n = tones[a.order[(k / a.every) % a.order.length] % tones.length];
            add(s0 + k, { inst: inst.arp, midi: 60 + c.root + n + (st.arpOct || 0) + tr, len: a.len, vel: (mix.arp ?? 1) * (k % 4 === 0 ? 0.8 : 0.55) });
          }
        }
        // drums: the style's bar, with a fill closing every fourth bar
        if (layers.has('drums') && st.drums && st.drums !== 'none') {
          const fill = (b % 4 === 3 && st.fills !== false) || (b === bars - 1 && sec.fillEnd);
          const pat = fill ? { ...DRUMS[st.drums], ...FILL } : DRUMS[st.drums];
          for (const [kind, line] of Object.entries(pat)) {
            for (let k = 0; k < 16; k++) {
              const x = line[k];
              if (x === 'x' || x === 'X') add(s0 + k, { inst: 'drum', ch: 'drums', kind, len: 1, vel: (mix.drums ?? 1) * (x === 'X' ? 1 : 0.75) });
            }
          }
        }
      }
      base += bars * 16;
    });
    song._c = { events, steps: base, loopStep, marks };
    return song._c;
  }

  /**
   * ?capture: render the logged music cues into an OfflineAudioContext (the same song data and game times as the
   * live game). events: [[time, 'music'|'jingle', [name, tr]]]; t0: the recording's start. Returns pump(to), which
   * schedules the notes up to time `to`: call it with rising times as the render goes (sfx.js offlineChunks).
   */
  renderOffline(ctx, dest, events, t0, dur) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume * 0.22;
    this.out.connect(dest);
    this.delay = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    this.send = ctx.createGain();
    this.send.gain.value = 0.22;
    this.send.connect(this.delay).connect(fb).connect(this.delay);
    this.delay.connect(this.out);
    let main = null;
    const end = dur;
    const players = []; // [player, the time it stops]
    // a cue before t0 (the song already playing when the window starts) keeps its phase: its earlier notes are skipped
    const cues = events.map(([t, kind, args]) => ({ t: t - t0, kind, song: this.songs[args[0]], tr: args[1] }));
    cues.forEach((c, i) => {
      if (!c.song) return;
      const p = { song: c.song, t0: c.t, step: 0, gain: ctx.createGain(), once: c.kind === 'jingle', tr: c.kind === 'jingle' ? c.tr : 0, skipBefore: 0 };
      p.gain.connect(this.out);
      if (c.kind === 'music') {
        const next = cues.slice(i + 1).find((q) => q.kind === 'music');
        main = p;
        players.push([p, next ? next.t : end]);
        if (next) p.gain.gain.setTargetAtTime(0, next.t, 0.2);
      } else {
        players.push([p, end]);
        const len = this._compile(c.song).steps * this._stepDur(c.song);
        if (main) {
          main.gain.gain.setTargetAtTime(0.3, c.t, 0.05);
          main.gain.gain.setTargetAtTime(1, c.t + len, 0.3);
        }
      }
    });
    return (to) => {
      for (const [p, until] of players) if (!p.dead) this._schedule(p, Math.min(until, to), ctx);
    };
  }
}

// Bass patterns: [step, length, octave offset, accent]
const BASS = {
  pulse8: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 1, 0, s % 4 ? 0.7 : 1]),
  octave: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, 2, i % 2 ? 12 : 0, i % 2 ? 0.7 : 1]),
  drive16: Array.from({ length: 16 }, (_, s) => [s, 1, s % 8 === 6 ? 12 : 0, s % 4 ? 0.6 : 1]),
  gallop: [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15].map((s) => [s, s % 2 ? 1 : 1, 0, s % 4 ? 0.65 : 1]),
  half: [[0, 8, 0, 1], [8, 6, 7, 0.8]],
  whole: [[0, 16, 0, 1]],
  synco: [[0, 2, 0, 1], [3, 2, 0, 0.8], [6, 2, 12, 0.8], [8, 2, 0, 1], [11, 2, 0, 0.8], [14, 2, 7, 0.8]],
  walk: [[0, 4, 0, 1], [4, 4, 7, 0.8], [8, 4, 12, 0.9], [12, 4, 7, 0.8]],
};
// Arpeggios: every n steps, chord-tone order, note length
const ARP = {
  up16: { every: 1, order: [0, 1, 2, 3], len: 1 },
  updown8: { every: 2, order: [0, 1, 2, 3, 2, 1], len: 2 },
  bells: { every: 4, order: [3, 1, 2, 0], len: 6 },
  shimmer: { every: 1, order: [3, 4, 2, 4, 1, 4, 2, 4], len: 1 },
  broken: { every: 3, order: [0, 2, 1, 3, 4], len: 3 },
};

// ------------------------------------------------------------------------------------------------
// Instruments. Each schedules its nodes on ctx at time t into `out` (the player's gain).

function env(ctx, out, t, a, d, peak, rel) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(peak * 0.7, t + a, d);
  g.gain.setTargetAtTime(0.0001, t + rel.start, rel.tau);
  g.connect(out);
  return g;
}

function osc(ctx, type, hz, t, stop, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  o.stop(stop);
  return o;
}

function lowpass(ctx, f0, f1, t, tau, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.setTargetAtTime(f1, t, tau);
  return f;
}

/** A bright square lead with a little vibrato (location 1, title). */
VOICES.square = (m, ctx, t, hz, dur, vel, out) => {
  const end = t + dur + 0.25;
  const g = env(ctx, out, t, 0.01, 0.2, 0.16 * vel, { start: dur, tau: 0.06 });
  const f = lowpass(ctx, 3800, 1800, t, 0.15, 2);
  f.connect(g);
  const a = osc(ctx, 'square', hz, t, end);
  const b = osc(ctx, 'square', hz, t, end, 7);
  const vib = osc(ctx, 'sine', 5.5, t, end);
  const vg = ctx.createGain();
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(hz * 0.006, t + Math.min(0.4, dur));
  vib.connect(vg);
  vg.connect(a.frequency);
  vg.connect(b.frequency);
  const bg = ctx.createGain();
  bg.gain.value = 0.5;
  a.connect(f);
  b.connect(bg).connect(f);
  if (dur > 0.3) g.connect(m.send);
};

/** Soft pulse for counter-melodies. */
VOICES.pulse = (m, ctx, t, hz, dur, vel, out) => {
  const end = t + dur + 0.3;
  const g = env(ctx, out, t, 0.02, 0.3, 0.09 * vel, { start: dur, tau: 0.1 });
  const f = lowpass(ctx, 2200, 1200, t, 0.2);
  f.connect(g);
  osc(ctx, 'triangle', hz, t, end).connect(f);
  const s = osc(ctx, 'square', hz, t, end, -5);
  const sg = ctx.createGain();
  sg.gain.value = 0.35;
  s.connect(sg).connect(f);
  g.connect(m.send);
};

/** Brass: a saw opening its filter (title, Corona, fanfares). */
VOICES.brass = (m, ctx, t, hz, dur, vel, out) => {
  const end = t + dur + 0.3;
  const g = env(ctx, out, t, 0.05, 0.4, 0.14 * vel, { start: dur, tau: 0.08 });
  const f = lowpass(ctx, 500, 2600, t, 0.07, 1.5);
  f.frequency.setTargetAtTime(1400, t + 0.2, 0.3);
  f.connect(g);
  osc(ctx, 'sawtooth', hz, t, end).connect(f);
  osc(ctx, 'sawtooth', hz, t, end, 9).connect(f);
  g.connect(m.send);
};

/** FM bell (Frozen Moon, the Belt's metal). */
VOICES.bell = (m, ctx, t, hz, dur, vel, out, e) => {
  const len = Math.max(1.2, dur * 1.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.13 * vel, t + 0.005);
  g.gain.setTargetAtTime(0.0001, t + 0.01, len / 4);
  g.connect(out);
  g.connect(m.send);
  const c = osc(ctx, 'sine', hz, t, t + len);
  const mod = osc(ctx, 'sine', hz * (e?.ratio || 3.5), t, t + len);
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(hz * 2.2, t);
  mg.gain.setTargetAtTime(hz * 0.2, t, len / 5);
  mod.connect(mg).connect(c.frequency);
  c.connect(g);
};

/** Glassy sine pair with echoes (Frozen Moon lead). */
VOICES.glass = (m, ctx, t, hz, dur, vel, out) => {
  const len = dur + 0.6;
  const g = env(ctx, out, t, 0.01, 0.25, 0.12 * vel, { start: dur, tau: 0.2 });
  osc(ctx, 'sine', hz, t, t + len).connect(g);
  const o2 = osc(ctx, 'sine', hz * 2.005, t, t + len);
  const g2 = ctx.createGain();
  g2.gain.value = 0.35;
  o2.connect(g2).connect(g);
  g.connect(m.send);
};

/** Saw bass with a square sub. */
VOICES.saw = (m, ctx, t, hz, dur, vel, out) => {
  const end = t + dur + 0.1;
  const g = env(ctx, out, t, 0.005, 0.12, 0.22 * vel, { start: dur * 0.9, tau: 0.03 });
  const f = lowpass(ctx, 1400, 420, t, 0.08, 3);
  f.connect(g);
  osc(ctx, 'sawtooth', hz, t, end).connect(f);
  const s = osc(ctx, 'square', hz / 2, t, end);
  const sg = ctx.createGain();
  sg.gain.value = 0.45;
  s.connect(sg).connect(f);
};

/** Round sub bass (Nebula, Frozen Moon). */
VOICES.sub = (m, ctx, t, hz, dur, vel, out) => {
  const end = t + dur + 0.2;
  const g = env(ctx, out, t, 0.02, 0.4, 0.3 * vel, { start: dur, tau: 0.08 });
  osc(ctx, 'sine', hz, t, end).connect(g);
  const tri = osc(ctx, 'triangle', hz * 2, t, end);
  const tg = ctx.createGain();
  tg.gain.value = 0.18;
  tri.connect(tg).connect(g);
};

/** Detuned saw pad. */
VOICES.pad = (m, ctx, t, hz, dur, vel, out) => {
  const end = t + dur + 0.8;
  const g = env(ctx, out, t, Math.min(0.5, dur * 0.3), 1, 0.05 * vel, { start: dur, tau: 0.25 });
  const f = lowpass(ctx, 900, 1500, t, 0.6);
  f.connect(g);
  osc(ctx, 'sawtooth', hz, t, end, -8).connect(f);
  osc(ctx, 'sawtooth', hz, t, end, 8).connect(f);
  g.connect(m.send);
};

/** Choir-like pad: the pad through two vowel formants (Corona, Nebula). */
VOICES.choir = (m, ctx, t, hz, dur, vel, out) => {
  const end = t + dur + 0.8;
  const g = env(ctx, out, t, Math.min(0.6, dur * 0.35), 1, 0.11 * vel, { start: dur, tau: 0.3 });
  const mixg = ctx.createGain();
  for (const [fq, q] of [[720, 5], [1180, 7]]) {
    const b = ctx.createBiquadFilter();
    b.type = 'bandpass';
    b.frequency.value = fq;
    b.Q.value = q;
    mixg.connect(b).connect(g);
  }
  osc(ctx, 'sawtooth', hz, t, end, -6).connect(mixg);
  osc(ctx, 'sawtooth', hz, t, end, 6).connect(mixg);
  g.connect(m.send);
};

/** Short plucked square (arpeggios). */
VOICES.pluck = (m, ctx, t, hz, dur, vel, out) => {
  const end = t + dur + 0.15;
  const g = env(ctx, out, t, 0.002, 0.06, 0.06 * vel, { start: Math.min(dur, 0.12), tau: 0.04 });
  const f = lowpass(ctx, 4200, 500, t, 0.07);
  f.connect(g);
  osc(ctx, 'square', hz, t, end).connect(f);
  g.connect(m.send);
};

/** Drum kit: kick, snare, hats, metal hit, tom (noise from the effects' buffer). */
VOICES.drum = (m, ctx, t, hz, dur, vel, out, e) => {
  const noise = (len, type, fq, q, gain) => {
    const src = ctx.createBufferSource();
    src.buffer = m.sfx.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = fq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g).connect(out);
    src.start(t, (t * 7.31) % 0.5);
    src.stop(t + len + 0.02);
  };
  const tone = (f0, f1, len, gain, type = 'sine') => {
    const o = osc(ctx, type, f0, t, t + len + 0.02);
    o.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(out);
  };
  switch (e.kind) {
    case 'k':
      tone(150, 42, 0.32, 0.5);
      break;
    case 's':
      noise(0.16, 'bandpass', 1900, 0.8, 0.28);
      tone(210, 160, 0.09, 0.14, 'triangle');
      break;
    case 'h':
      noise(0.04, 'highpass', 7500, 0.7, 0.09);
      break;
    case 'o':
      noise(0.22, 'highpass', 6500, 0.7, 0.08);
      break;
    case 'm':
      tone(1420, 1300, 0.12, 0.05, 'square');
      tone(2210, 2100, 0.1, 0.04, 'square');
      noise(0.06, 'bandpass', 3500, 3, 0.1);
      break;
    case 't':
      tone(140, 80, 0.25, 0.3);
      break;
  }
};
