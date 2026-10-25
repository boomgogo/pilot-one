// The campaign: five locations, flown in order (ai/summary.md §4). Only location 1 is in the initial download; each
// later one is its own chunk (data, backdrop, bosses, music) plus its own GLB, fetched while you play the one before.
// This file holds only what the title screen and the star map need.

import gasGiant from './gas-giant.js';

export const LOCATIONS = [
  { id: 'gas-giant', name: 'GAS GIANT RUN', short: 'GAS GIANT', stages: 8, map: [60, 140], threat: 1, intro: 'the tutorial', load: async () => gasGiant },
  {
    id: 'belt', name: 'THE BELT', short: 'THE BELT', stages: 6, map: [175, 70], threat: 2,
    intro: 'ore haulers to strip, swarming mining drones, boulders from mass drivers',
    load: () => import('./belt.js').then((m) => m.default),
  },
  {
    id: 'nebula', name: 'CRIMSON NEBULA', short: 'NEBULA', stages: 7, map: [300, 130], threat: 3,
    intro: 'fog, ion storms, cloaked wasps and a battleship',
    load: () => import('./nebula.js').then((m) => m.default),
  },
  {
    id: 'frozen-moon', name: 'FROZEN MOON', short: 'FROZEN MOON', stages: 6, map: [425, 60], threat: 4,
    intro: 'low over the ice: canyons, geysers, guns on the ground',
    load: () => import('./frozen-moon.js').then((m) => m.default),
  },
  {
    id: 'corona', name: 'THE CORONA', short: 'THE CORONA', stages: 8, map: [545, 120], threat: 5,
    intro: 'solar flares, mirror beams, the Dreadnought. Almost impossible',
    load: () => import('./corona.js').then((m) => m.default),
  },
];
