// The shared cues and location 1's music (ai/summary.md §9). Later locations carry their own songs in their chunks.
//
// A four-note fleet motif ties every cue together: D – A – G – F (1 – 5 – 4 – ♭3, "D:6 A:2 G:4 F:4"), rising on its
// last statement to D – A – C – D. Each location states it in its own key, tempo and instruments.
// Note lengths are in 16ths: 2 = an eighth, 4 = a quarter, 8 = a half, 16 = a bar.

/** The title: a slow pad, then the motif on brass. D minor, 112 BPM. */
const TITLE = {
  name: 'title',
  bpm: 112,
  inst: { lead: 'brass', counter: 'pulse', bass: 'saw', pad: 'pad', arp: 'pluck' },
  mix: { lead: 1, bass: 0.7, pad: 1, arp: 0.5, drums: 0.7, counter: 0.8 },
  styles: { bass: 'half', drums: 'half', arp: 'bells' },
  sections: {
    intro: { bars: 4, chords: 'Dm Bb Gm A', layers: 'pad bass' },
    A: {
      bars: 8,
      chords: 'Dm Bb Gm A Dm Bb C D',
      layers: 'lead pad bass arp drums',
      mel: `D5:6 A5:2 G5:4 F5:4 | F5:6 D5:2 F5:4 G5:4 | Bb5:6 A5:2 G5:4 D5:4 | E5:8 C#5:4 A4:4 |
            D5:6 A5:2 G5:4 F5:4 | F5:4 G5:4 A5:4 Bb5:4 | G5:6 F5:2 E5:4 C5:4 | D5:6 A5:2 C6:4 D6:4`,
    },
    B: {
      bars: 8,
      chords: 'Bb C Dm Dm Gm A Dm,C Bb,A',
      layers: 'lead counter pad bass arp drums',
      mel: `F5:8 D5:4 F5:4 | G5:8 E5:4 C5:4 | A5:12 r:4 | r:16 |
            Bb5:8 A5:4 G5:4 | A5:8 C#6:4 E6:4 | D6:8 C6:8 | Bb5:8 A5:8`,
      counter: 'D4:16 | E4:16 | F4:8 A4:8 | D5:16 | D4:16 | E4:16 | F4:8 E4:8 | D4:8 C#4:8',
    },
  },
  form: ['intro', 'A', 'B', 'A'],
  loopFrom: 1,
};

/**
 * Location 1, GAS GIANT RUN: a bright arcade drive. D Dorian (the B natural is its colour), 132 BPM:
 * pulsing octave bass, a square lead with the motif as its A section, a softer counter-line in B.
 */
const GAS_GIANT = {
  name: 'gasGiant',
  tr: 0,
  bpm: 132,
  inst: { lead: 'square', counter: 'pulse', bass: 'saw', pad: 'pad', arp: 'pluck' },
  mix: { lead: 0.9, counter: 0.9, bass: 0.9, pad: 0.7, arp: 0.45, drums: 0.9 },
  styles: { bass: 'octave', drums: 'rock', arp: 'up16' },
  sections: {
    intro: { bars: 4, chords: 'Dm Dm G A', layers: 'bass pad drums arp', fillEnd: true },
    A: {
      bars: 16,
      chords: 'Dm Dm G G Dm Dm C G Dm Dm G G F G Am Am',
      mel: `D5:6 A5:2 G5:4 F5:4 | E5:4 F5:2 G5:2 A5:6 r:2 | B5:4 A5:2 G5:2 D5:6 r:2 | G5:2 A5:2 B5:4 A5:8 |
            D5:6 A5:2 G5:4 F5:4 | E5:4 F5:2 E5:2 D5:4 C5:4 | E5:4 G5:4 C6:4 B5:2 A5:2 | B5:12 r:4 |
            D5:6 A5:2 G5:4 F5:4 | E5:4 F5:2 G5:2 A5:4 C6:4 | B5:6 A5:2 G5:4 B5:4 | D6:8 B5:4 G5:4 |
            A5:6 G5:2 F5:4 C5:4 | D5:4 G5:4 B5:4 D6:4 | C6:6 B5:2 A5:4 E5:4 | A5:12 r:4`,
      layers: 'lead bass pad arp drums',
    },
    B: {
      bars: 8,
      chords: 'Bb C Dm Dm Bb C Em,A A',
      styles: { drums: 'drive' },
      mel: `F5:3 F5:3 G5:2 A5:4 Bb5:4 | G5:3 G5:3 A5:2 C6:8 | D6:4 C6:2 A5:2 F5:4 A5:4 | G5:6 F5:2 E5:4 D5:4 |
            F5:3 F5:3 G5:2 A5:4 Bb5:4 | C6:3 C6:3 D6:2 E6:8 | E6:4 D6:4 C#6:4 B5:2 A5:2 | A5:8 E5:4 C#5:4`,
      counter: 'D5:16 | E5:16 | F5:16 | E5:8 D5:8 | D5:16 | E5:16 | G5:8 E5:8 | C#5:16',
      fillEnd: true,
    },
    A2: {
      bars: 8,
      chords: 'Dm Dm G G Dm Dm C D',
      mel: `D5:6 A5:2 G5:4 F5:4 | E5:4 F5:2 G5:2 A5:6 r:2 | B5:4 A5:2 G5:2 D5:6 r:2 | G5:2 A5:2 B5:4 A5:8 |
            D5:6 A5:2 G5:4 F5:4 | E5:4 F5:2 E5:2 D5:4 C5:4 | E5:4 G5:4 C6:4 B5:2 A5:2 | D5:6 A5:2 C6:4 D6:4`,
      counter: 'r:16 | r:16 | r:16 | r:16 | A4:16 | A4:16 | G4:16 | F#4:8 A4:8',
    },
  },
  form: ['intro', 'A', 'B', 'A2'],
  loopFrom: 1,
};

/** Location 1's bosses: the motif in the bass, ominous; heavier drums, 140 BPM, D minor. */
const GAS_GIANT_BOSS = {
  name: 'gasGiantBoss',
  tr: 0,
  bpm: 140,
  inst: { lead: 'brass', counter: 'square', bass: 'saw', pad: 'pad', arp: 'pluck' },
  mix: { lead: 0.85, bass: 1, pad: 0.7, arp: 0.4, drums: 1, counter: 0.6 },
  styles: { drums: 'march', arp: 'updown8' },
  sections: {
    A: {
      bars: 8,
      chords: 'Dm Dm Bb A Dm Dm Bb A',
      bass: `D2:6 A2:2 G2:4 F2:4 | D2:2 D2:2 r:2 D2:2 F2:2 E2:2 D2:2 C2:2 | Bb1:6 F2:2 Eb2:4 D2:4 | A1:4 A1:2 A1:2 C#2:4 E2:4 |
             D2:6 A2:2 G2:4 F2:4 | D2:2 D2:2 r:2 D2:2 F2:2 E2:2 D2:2 C2:2 | Bb1:6 F2:2 Eb2:4 D2:4 | A1:4 G1:4 F1:4 E1:4`,
      mel: `A4:2 r:2 A4:2 r:2 D5:4 C5:4 | A4:12 r:4 | Bb4:2 r:2 Bb4:2 r:2 F5:4 D5:4 | E5:12 r:4 |
            A4:2 r:2 A4:2 r:2 D5:4 F5:4 | E5:8 D5:8 | Bb4:2 r:2 D5:2 r:2 F5:4 Bb5:4 | A5:12 r:4`,
      layers: 'lead bass pad drums',
    },
    B: {
      bars: 8,
      chords: 'Gm Gm Dm Dm Eb Eb A A',
      bass: `G1:6 D2:2 C2:4 Bb1:4 | G1:2 G1:2 r:2 G1:2 Bb1:2 A1:2 G1:2 F1:2 | D2:6 A2:2 G2:4 F2:4 | D2:2 D2:2 r:2 D2:2 F2:2 E2:2 D2:2 C2:2 |
             Eb2:6 Bb2:2 Ab2:4 G2:4 | Eb2:4 Eb2:4 Eb2:4 Eb2:4 | A1:4 A1:2 A1:2 C#2:4 E2:4 | A1:2 A1:2 A1:2 A1:2 A2:8`,
      mel: `D6:6 A5:2 G5:4 F5:4 | G5:8 Bb5:8 | A5:6 F5:2 E5:4 D5:4 | A5:12 r:4 |
            G5:6 Eb5:2 Bb5:4 G5:4 | C6:8 Bb5:8 | A5:4 C#6:4 E6:4 A5:4 | A5:12 r:4`,
      counter: 'r:16 | r:16 | r:16 | r:16 | Eb5:16 | Eb5:16 | E5:16 | C#5:16',
      styles: { arp: 'up16' },
      layers: 'lead counter bass pad arp drums',
      fillEnd: true,
    },
  },
  form: ['A', 'B'],
};

/** Stage clear: the motif's answer, about 1.5 s. Written in D; played in the location's key. */
const STAGE_CLEAR = {
  name: 'stageClear',
  bpm: 150,
  inst: { lead: 'square', counter: 'pulse', bass: 'saw', pad: 'pad' },
  mix: { lead: 1, counter: 0.9, bass: 0.8, pad: 0.6, drums: 0.7 },
  styles: { drums: 'none' },
  sections: {
    J: {
      bars: 1,
      chords: 'D',
      mel: 'E5:2 F#5:2 G5:2 A5:2 D6:8',
      counter: 'C#5:2 D5:2 E5:2 F#5:2 A5:8',
      bass: 'A2:4 A2:4 D2:8',
      layers: 'lead counter bass',
    },
  },
  form: ['J'],
};

/** Location clear: the rising motif, harmonised, over a snare roll (about 4 s). */
const LOC_CLEAR = {
  name: 'locClear',
  bpm: 112,
  inst: { lead: 'brass', counter: 'brass', bass: 'saw', pad: 'pad', arp: 'pluck' },
  mix: { lead: 1, counter: 0.7, bass: 0.8, pad: 0.8, drums: 0.8, arp: 0.4 },
  styles: { drums: 'roll', arp: 'up16', fills: false },
  sections: {
    F: {
      bars: 2,
      chords: 'D G,A',
      mel: 'D5:6 A5:2 C6:4 D6:4 | D6:8 E6:4 F#6:4',
      counter: 'A4:6 F#5:2 A5:4 A5:4 | B5:8 C#6:8',
      bass: 'D2:8 A2:8 | G2:8 A2:8',
      layers: 'lead counter bass pad drums arp',
    },
    G: { bars: 1, chords: 'D', mel: 'D6:16', counter: 'A5:16', bass: 'D2:16', layers: 'lead counter bass pad', styles: { drums: 'none' } },
  },
  form: ['F', 'G'],
};

/** The star map and the jump: a held chord rising, looping quietly until Launch. */
const JUMP = {
  name: 'jump',
  bpm: 96,
  inst: { pad: 'pad', arp: 'bell', bass: 'sub' },
  mix: { pad: 1, arp: 0.5, bass: 0.6 },
  styles: { arp: 'bells', bass: 'whole', arpOct: 12 },
  sections: { M: { bars: 4, chords: 'Dsus2 Bbmaj7 Gm7 Asus4', layers: 'pad arp bass' } },
  form: ['M'],
};

/** Game over: the motif backwards, falling. */
const GAME_OVER = {
  name: 'gameOver',
  bpm: 84,
  inst: { lead: 'pulse', pad: 'pad', bass: 'sub' },
  mix: { lead: 1, pad: 0.8, bass: 0.7 },
  sections: { O: { bars: 2, chords: 'Gm Dm', mel: 'F5:4 G5:4 A5:4 D5:4 | D4:16', bass: 'G2:16 | D2:16', layers: 'lead pad bass' } },
  form: ['O'],
};

/** The ending: the title theme in D major, slow, the motif in full and resolved. */
const ENDING = {
  name: 'ending',
  bpm: 92,
  inst: { lead: 'brass', counter: 'pulse', bass: 'sub', pad: 'choir', arp: 'bell' },
  mix: { lead: 1, counter: 0.8, bass: 0.8, pad: 1, arp: 0.4, drums: 0.6 },
  styles: { bass: 'half', arp: 'bells', drums: 'half' },
  sections: {
    I: { bars: 2, chords: 'D Dsus4', layers: 'pad bass arp' },
    E: {
      bars: 8,
      chords: 'D Bm G A D G A D',
      mel: `D5:6 A5:2 G5:4 F#5:4 | F#5:6 D5:2 F#5:4 B5:4 | B5:6 A5:2 G5:4 D5:4 | E5:8 C#5:4 A4:4 |
            D5:6 A5:2 G5:4 F#5:4 | G5:4 A5:4 B5:4 D6:4 | E6:6 D6:2 C#6:4 E6:4 | D6:16`,
      counter: 'r:16 | r:16 | D5:16 | C#5:16 | A4:16 | B4:16 | A4:8 G4:8 | F#4:16',
      layers: 'lead counter pad bass arp drums',
    },
  },
  form: ['I', 'E'],
  loopFrom: 1,
};

export const SHARED_SONGS = { TITLE, STAGE_CLEAR, LOC_CLEAR, JUMP, GAME_OVER, ENDING };

/** Location 1's cues (data.songs): theme, boss. */
export const GAS_GIANT_SONGS = { theme: GAS_GIANT, boss: GAS_GIANT_BOSS };
