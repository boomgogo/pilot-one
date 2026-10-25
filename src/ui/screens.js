// The between-location screens (ai/summary.md §4.3): location clear, star map, ending, and the title screen's
// records. DOM only; main.js decides when each one shows.

const $ = (id) => document.getElementById(id);
const MEDALS = [
  ['cleared', 'CLEARED'],
  ['noLoss', 'NO SHIP LOST'],
  ['ratio90', '90% SHOT DOWN'],
  ['allS', 'ALL S'],
];

/** Count numbers up from 0 in elements carrying data-v (a short, rising tally). */
function countUp(root, fmt) {
  const els = [...root.querySelectorAll('[data-v]')];
  const t0 = performance.now();
  const capture = document.body.classList.contains('capture');
  const step = (now) => {
    let busy = false;
    els.forEach((el, i) => {
      const k = capture ? 1 : Math.min(1, Math.max(0, (now - t0 - 250 - i * 220) / 500));
      el.textContent = fmt(Math.round(+el.dataset.v * k));
      if (k < 1) busy = true;
    });
    if (busy) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function medalsHtml(medals, fresh = []) {
  return MEDALS.map(([k, label]) => `<span class="medal${medals[k] ? ' on' : ''}${fresh.includes(k) ? ' new' : ''}">${label}</span>`).join('');
}

/** rec: Game.locationClear's record (grades, medals, rows, final). fresh: medals won for the first time. */
export function showLocationClear(rec, fresh, fmt) {
  $('clear-title').textContent = rec.final ? 'FINAL LOCATION CLEAR' : `LOCATION ${rec.index + 1} CLEAR`;
  $('clear-name').textContent = rec.name;
  const g = $('clear-grades');
  g.innerHTML = rec.grades.map((x, i) => `<span class="grade g${x}"><small>${rec.index + 1}-${i + 1}</small>${x}</span>`).join('');
  [...g.children].forEach((el, i) => setTimeout(() => el.classList.add('in'), 200 + i * 140));
  const rows = [...rec.rows, ['Location shot down', `${Math.round(rec.pct * 100)}%`], ['Score', rec.score]];
  const t = $('tally');
  t.innerHTML = rows
    .map(([k, v]) => `<span>${k}</span><span${k === 'Score' ? ' class="big"' : ''}${typeof v === 'number' ? ' data-v="' + v + '"' : ''}>${typeof v === 'number' ? '0' : v}</span>`)
    .join('');
  countUp(t, fmt);
  $('clear-medals').innerHTML = medalsHtml(rec.medals, fresh);
  $('clear-reward').textContent = rec.final ? 'The fleet is waiting for you' : 'Shield repaired · bombs refilled · the fleet jumps on';
}

/** The fleet's route: cleared locations lit, a line drawn from here to the next one. */
export function showStarMap(locations, next, runLocs, records) {
  const svg = $('map-svg');
  const pts = locations.map((l) => l.map);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    d += ` Q${(x0 + x1) / 2},${(y0 + y1) / 2 - 40} ${x1},${y1}`;
  }
  let html = `<path class="route" d="${d}"/>`;
  const from = pts[next - 1];
  const to = pts[next];
  if (from && to) html += `<path class="jump" id="jump-line" d="M${from[0]},${from[1]} Q${(from[0] + to[0]) / 2},${(from[1] + to[1]) / 2 - 40} ${to[0]},${to[1]}"/>`;
  locations.forEach((l, i) => {
    const [x, y] = l.map;
    const done = runLocs[i];
    const cls = done ? 'done' : i === next ? 'next' : '';
    const fill = done ? '#5dff9a' : i === next ? '#7fe8ff' : '#2a3150';
    const best = records?.locs?.[l.id];
    const medals = done ? Object.values(done.medals).filter(Boolean).length : 0;
    const sub = done ? `${'★'.repeat(medals)}` : i === next ? 'NEXT' : best ? 'reached before' : '';
    html += `<g class="${cls}">`;
    if (i === next) html += `<circle class="halo" cx="${x}" cy="${y}" r="16" fill="none" stroke="#7fe8ff" stroke-width="2"/>`;
    html += `<circle cx="${x}" cy="${y}" r="${i === next ? 9 : 7}" fill="${fill}"/>`;
    html += `<text x="${x}" y="${y + 28}">${i + 1}. ${l.short}</text>`;
    if (sub) html += `<text x="${x}" y="${y + 42}" style="fill:${done ? '#ffcf5a' : '#7fe8ff'}">${sub}</text>`;
    html += '</g>';
  });
  svg.innerHTML = html;
  const line = $('jump-line');
  if (line) {
    const len = line.getTotalLength();
    line.style.strokeDasharray = `${len}`;
    line.style.strokeDashoffset = `${len}`;
    line.getBoundingClientRect();
    line.style.transition = 'stroke-dashoffset 1.6s ease-in-out 0.3s';
    line.style.strokeDashoffset = '0';
  }
  const n = locations[next];
  $('map-next').innerHTML = `NEXT: LOCATION ${next + 1} · ${n.name}  <span class="threat">${'▲'.repeat(n.threat)}</span>`;
  $('map-new').textContent = 'NEW: ' + n.intro;
}

/** The end of the game: good (the Dreadnought destroyed) or not. res: Game.endGame's summary. */
export function showEnding(res, locations, fmt) {
  $('end-title').textContent = res.good ? 'THE DREADNOUGHT IS DOWN' : 'THE DREADNOUGHT ESCAPED';
  $('end-text').textContent = res.good
    ? 'The corona falls quiet behind you. The fleet turns for home, and every ship in it knows who brought it there.'
    : 'It slipped away into the glare. The fleet holds the line, and waits for another pilot to try.';
  const m = Math.floor(res.seconds / 60);
  const sec = Math.floor(res.seconds % 60);
  const rows = [];
  if (res.clearBonus) rows.push(['Clear bonus' + (res.continues === 0 ? ' ×2' : ''), res.clearBonus]);
  rows.push(
    ['Score', res.score],
    ['High score', res.hi],
    ['Time', `${m}:${String(sec).padStart(2, '0')}`],
    ['Continues used', String(res.continues)],
    ['Best chain', String(res.maxChain || 0)],
  );
  res.locs.forEach((r, i) => r && rows.push([`${i + 1}. ${locations[i].name}`, r.grades.join(' ')]));
  const t = $('end-tally');
  t.innerHTML = rows
    .map(([k, v]) => `<span>${k}</span><span${k === 'Score' ? ' class="big"' : ''}${typeof v === 'number' ? ' data-v="' + v + '"' : ''}>${typeof v === 'number' ? '0' : v}</span>`)
    .join('');
  countUp(t, fmt);
  let won = 0;
  for (const r of res.locs) for (const v of Object.values(r?.medals || {})) if (v) won++;
  $('end-medals').innerHTML = `<span class="medal on">${won} MEDAL${won === 1 ? '' : 'S'}</span>` + (res.continues === 0 && res.good ? '<span class="medal on new">ONE CREDIT CLEAR</span>' : '');
}

/** Title screen: each location's best score and medals (records are only shown; every game starts at 1-1). */
export function renderRecords(el, locations, records) {
  if (!records?.furthest) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = locations
    .map((l, i) => {
      const r = records.locs?.[l.id];
      if (!r) return `<div><b>${i + 1}. ${i < records.furthest ? l.short : '???'}</b>—</div>`;
      const m = Object.values(r.medals).filter(Boolean).length;
      return `<div class="reached"><b>${i + 1}. ${l.short}</b>${r.best.toLocaleString('en')}<br><span class="m">${'★'.repeat(m)}${'☆'.repeat(4 - m)}</span></div>`;
    })
    .join('');
}
