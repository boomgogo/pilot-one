// Per-viewer conveniences only (high score, hall of fame, records, options, finished tutorial lessons and intros). Storage may be
// unavailable (private mode, iframes).
const KEY = 'pilotone.v1';

const DEFAULTS = {
  hi: 0,
  options: {
    sensitivity: 1,
    invertY: false,
    autoFire: null, // null = default per device (on for touch, off for desktop)
    volume: 0.7,
    musicVolume: 0.6,
    reduceFlash: false,
    quality: 'auto',
    dangerMarkers: true,
  },
};

let cache = null;

export function loadSave() {
  if (cache) return cache;
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    data = {};
  }
  cache = {
    hi: data.hi || 0,
    options: { ...DEFAULTS.options, ...(data.options || {}) },
    tutorial: data.tutorial || { done: {} },
    // per location: best score, best grade per stage, medals (ai/summary.md §4.4); only shown, never a start point
    records: data.records || { furthest: 0, locs: {} },
    // hall of fame (ai/summary.md §6.4): [{name, score, reached, continues, date}], best first
    hof: Array.isArray(data.hof) ? data.hof : [],
    lastName: data.lastName || '',
  };
  return cache;
}

export function writeSave() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}
