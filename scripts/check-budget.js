// Fails the build when the initial download exceeds the load-time budget (see CLAUDE.md spec / ai/summary.md §2).
// Sizes are gzip (Cloudflare serves brotli, which is smaller, so this is conservative).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const KB = 1024;
const BUDGET = {
  js: 250 * KB, // three + game code: the initial bundle
  initial: 600 * KB, // everything needed before the Start button is enabled
  locJs: 40 * KB, // each later location's chunk (data, backdrop, bosses, music; ai/summary.md §2)
  locGlb: 60 * KB, // each later location's models
};
// Assets fetched after the game has started (progressive load) do not count toward the initial budget:
// location 1's mothership, and every later location (its chunk and its GLB, fetched while you play the one before).
const LAZY = [/boss-[\w-]+\.glb$/, /loc\d-[\w-]+\.glb$/, /(belt|nebula|frozen-moon|corona|kit|backdrop-kit)-[\w-]+\.js$/];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rows = [];
const over = [];
const fmt = (n) => (n / KB).toFixed(1).padStart(7) + ' KB';
let js = 0;
let initial = 0;
for (const file of walk(DIST)) {
  const rel = relative(DIST, file);
  if (rel.startsWith('_') || rel.endsWith('.svg')) continue;
  const raw = readFileSync(file);
  const gz = gzipSync(raw, { level: 9 }).length;
  const lazy = LAZY.some((re) => re.test(rel));
  if (rel.endsWith('.js') && !lazy) js += gz;
  if (!lazy) initial += gz;
  if (lazy && rel.endsWith('.js') && gz > BUDGET.locJs) over.push(`${rel} ${fmt(gz)} > ${fmt(BUDGET.locJs)}`);
  if (lazy && /loc\d/.test(rel) && gz > BUDGET.locGlb) over.push(`${rel} ${fmt(gz)} > ${fmt(BUDGET.locGlb)}`);
  rows.push({ file: rel, raw, gz, lazy });
}

rows.sort((a, b) => b.gz - a.gz);
console.log('\nbundle budget (gzip):');
for (const r of rows) console.log(`  ${fmt(r.gz)}  ${r.file}${r.lazy ? '  (lazy)' : ''}`);
console.log(`  ------\n  ${fmt(js)}  initial js    (budget ${fmt(BUDGET.js).trim()})`);
console.log(`  ${fmt(initial)}  initial total (budget ${fmt(BUDGET.initial).trim()})\n`);

let ok = true;
if (js > BUDGET.js) {
  console.error('✗ JS budget exceeded');
  ok = false;
}
if (initial > BUDGET.initial) {
  console.error('✗ initial-load budget exceeded');
  ok = false;
}
for (const o of over) {
  console.error('✗ lazy budget exceeded: ' + o);
  ok = false;
}
if (!ok) process.exit(1);
console.log('✓ within budget');
