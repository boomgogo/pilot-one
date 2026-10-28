# Pilot One: project summary

The design, the systems and the tuning targets of Pilot One, as built so far. Code comments point here as
`ai/summary.md §n`. The README covers setup, controls, debug parameters and the scripts. This file covers why things
are the way they are.

Screenshots: `ai/summary_screens.jpg` (HUD chain and medal value, name entry, ending, the title screen's hall of
fame) and `ai/summary_locations.jpg` (bot frames from every location).

## 1. The game

An arcade shoot 'em up in 3D space, in the browser, built with Vite and three.js.

- **A fixed rail.** The forward motion is automatic and follows a fixed path. Inside a corridor around the rail you
  move freely (W A S D), aim anywhere in a forward cone with the crosshair kept at the centre (mouse, touch, right
  stick) and roll (hold Q / E).
- **Arcade formations, in 3D.** Enemies arrive in predictable squadrons: vees, sweeps from the side, overtakes from
  behind, helixes, rings, dives, snakes. Some wings fly upside down or sideways, and you roll to match them for a
  bonus.
- **Always something to shoot and something to avoid.** Targets come to you. You never search for them.
- **The path feels chosen, but isn't.** Forks let you fly over or through, but gameplay lives in the rail's local
  frame, so the same waves meet you on every route. Only the scenery differs.
- **Where it differs from the classic 2D games:** 3D rendering, free aim and 3D dodging, made readable with danger
  markers (§5.2).

## 2. Spec and budgets

From `CLAUDE.md`:
- **Load:** time to interaction 2–3 s on an average connection, 1 s ideal, 4 s at most. Progressive load later is fine.
- **Hardware:** an average PC from the last 5 years with no dedicated GPU, and entry-level phones and touch devices
  from the last 5 years.

How the build keeps to it (`scripts/check-budget.js`, gzip sizes):

| Budget | Limit | Latest |
|---|---|---|
| Initial JS (three.js + game code) | 250 KB | 246.7 KB |
| Everything before Start is enabled | 600 KB | — |
| Each later location's JS chunk | 40 KB | — |
| Each later location's GLB | 60 KB | — |
| Time to interactive, slowest throttled profile (`npm run loadtime`) | ≤ 3 s | 2.98 s (Oct 29; the build before plan 1 measured 2.96 s the same day) |
| Frame rate, low tier, 4× CPU throttle, worst 1 s (`npm run perf`) | no drop over 10% between versions | 68–114 fps over 3 runs per stage, within 10% of the build before plan 1 (the run-to-run spread is ±20%) |

Location 1's mothership and every later location (chunk and GLB) are fetched in the background while you play the
one before (§8).

## 3. Controls

| Action | Desktop | Touch | Gamepad |
|---|---|---|---|
| Aim | mouse (pointer lock) | drag with the right thumb | right stick |
| Move | W A S D | left-thumb virtual stick | left stick |
| Roll (hold) | Q / E | ⟲ ⟳ buttons | LB / RB |
| Evasive roll | double-tap Q or E | double-tap ⟲ or ⟳ | double-tap LB or RB |
| Fire | click / Space, or auto-fire | auto-fire | RT |
| Bomb | Shift / right-click | BOMB button | LT |
| Pause | Esc / P | ❚❚ button | Start |

WASD moves relative to the screen, so it still works upside down. Mouse and touch deltas are rotated into the rolled
frame. There's no auto-level.

## 4. Campaign and locations

A carrier fleet jumps from system to system: 5 locations, 35 stages, about 40 minutes. Every game starts at 1-1, and
after location 5 the game ends. Data: `src/data/locations/`.

### 4.1 Location 1: the tutorial

One continuous flight around a gas giant, in 8 stages of 1–1.5 minutes (`gas-giant.js`). Each stage teaches one
thing just before it's needed: shooting, dodging, rolling to match wings, shooting down shells and mines, the evasive
roll, bosses and the bomb, the dark, and a final exam (the mothership). New players should pass it easily.

### 4.2 Locations 2–5

| # | Location | Stages | New | Boss |
|---|---|---|---|---|
| 2 | THE BELT | 6 | ore haulers to strip, mining-drone swarms, mass drivers lobbing boulders, a refinery | Excavator |
| 3 | CRIMSON NEBULA | 7 | fog, stray beams from a fleet battle, ion-storm lightning, cloaked wasps, a battleship | Flagship |
| 4 | FROZEN MOON | 6 | guns on the ice, a canyon that narrows the play box, geysers, a dark cavern | Fortress |
| 5 | THE CORONA | 8 | solar wind, solar flares (roll through them), mirror beams, the Dyson shell | Gatekeeper, Dreadnought |

- **Difficulty intent:** casual players may not pass location 2 easily. Experienced players, with practice and
  concentration, get through 3 and 4. Location 5 should seem impossible, passed by skill and some luck.
- **Each section of the rail** sets its own play box and drift (the canyon narrows it, for example).
- **Later locations** introduce each new threat with a one-line hint, not a lesson.

### 4.3 Between stages and locations

- **Stage tally:** a ring of lights across the corridor marks the end of a stage. A short tally shows while you keep
  flying: shoot-down bonus, aligned kills, no-hit bonus, one shield pip back. Evasive rolls refill.
- **Stage card:** "STAGE 2-5 · REFINERY" and the campaign position ("12 OF 35", or "FINAL STAGE").
- **Landing:** each location ends with an automatic landing on the carrier, with the camera pulled back to show the
  deck. Then the location clear screen (tally, records, full shield and bombs back to 2), the star map, and a jump
  that launches by itself once the next location is loaded.
- **Ending** (`src/ui/screens.js` `showEnding`): "THE DREADNOUGHT IS DOWN" with the clear bonus, or, if it gets
  away, "THE DREADNOUGHT ESCAPED" with the game-over music and how much of its hull it got away with. Both show the
  run's tally and the name entry.

### 4.4 Starting and records

- **No stage or location select.** A new game always starts at 1-1, and going back to the page (back/forward cache)
  is a new game too. Debug URL parameters (README) start anywhere in development.
- **Saved in the browser** (`src/core/storage.js`, key `pilotone.v1`): high score, best score, best grade per stage
  and medals per location (shown only, never a start point), done lessons, the hall of fame (§6.4) and options.
  Nothing about a run in progress is saved.

## 5. Firing and dodging

### 5.1 Four speed classes

Almost nothing is instant. Every firing belongs to one class (`src/game/weapons.js`):

| Class | Player | Enemies |
|---|---|---|
| Slow | bomb: thrown, then a shockwave clears bullets as it passes | shells (shoot them before they burst), mine shrapnel |
| Medium | | aimed / spread / fan / ring bullets |
| Fast | bolt stream; homing missiles from power level 2 | missiles: home for 1.5 s, then fly straight |
| Instant | laser pickup (8 s) | lasers: an aim line and a 1 s charge first |

- **Escape time:** every enemy firing leaves a minimum time between the moment it's visible (or telegraphed) and
  impact: slow 2.5 s, medium 1.3 s, fast 1.0 s, instant 0.8 s after the aim line freezes (`FIRE_CLASS`, enforced in
  `enemyCanFire()`).
- **Who's firing:** a 0.3 s gun charge glow and a muzzle flash.
- **Colours:** yours are cyan, blue and white. Anything that hurts you is warm, with a trail back to the shooter.
- **Visible fire:** bolts are screen-space billboards with a minimum width and streak length, so the stream reads at
  any distance. Every bolt of a volley flies parallel to the aim line, so the streams never cross
  (`npm run probe` checks it).
- **Lead:** when the crosshair locks a moving target, shots converge where it will be (a small diamond).
- **Range:** enemies fire only from 60–220 units ahead of you, so few stale aimed shots drift about.

### 5.2 Danger markers

The 3D dodge problem turned back into the classic 2D one (`src/game/danger.js`). Each threat about to reach your
ship's plane gets a ring where it will cross, sized to the real collision radius: red means it hits unless you move,
amber is a close call. A small ring on the ship is your hitbox. Cyan rings show where a pickup will pass. Markers are
on by default and can be turned off in the pause menu. Nothing that you couldn't see is allowed to ram you.

### 5.3 Evasive roll

Double-tap a roll key: a full barrel roll of the ship, invulnerable for 0.45 s. The view keeps its roll, so alignment
with inverted wings is kept. 3 per stage, refilled at every stage and on every new ship: a scarce, timed escape. A
laser gate (a fence of beams across the corridor) can only be rolled or bombed through.

### 5.4 Lessons and hints

`src/game/tutor.js`. A lesson shows a hint worded for the current input (keyboard, touch or gamepad) and holds the
next waves until you've done the thing or a short time has passed. The practice repeats at most twice. Done lessons
are remembered, and "Reset tutorial tips" is in the pause menu. Just-in-time hints come from what hit you.

## 6. Power and score

### 6.1 Power ladder

Each POW adds a level: SINGLE → TWIN → QUAD (a cone, which you roll to turn vertical) → MISSILES (wingman drones) →
SPIRAL (four bolts on a turning circle) → FULL. At FULL the outer streams (the cone and the drone bolts) are drawn
thin and dim, so they don't hide the targets. Their damage is the same.

Full power is earned, and a lost ship takes it away (plan 1). The one balance knob is how many POWs there are:
- **2 POWs in location 1, 3 in each of locations 2–4, 2 in location 5,** spread through the location. Every one is
  a red squadron shot down to the last ship; location 1's are the POW lesson's squadron and one in the inner rings.
  Bosses and hulks drop shields and bombs, not POWs. With every POW caught you leave location 1 at QUAD and reach
  FULL with location 2's last POW, about 13 minutes in.
- **A POW flies to the ship** 0.4 s after it drops, in about 2 s: what you earn is what you get. A POW caught at FULL
  is worth 5,000 points.
- **A lost ship drops you to SINGLE, with nothing given back.** A continue starts at SINGLE too. FULL again is 5 POWs
  away: the rest of that location and some of the next.
- **Supply gunship:** if you're still at power ≤ 1 15 s after a respawn, a slow gunship that doesn't fire brings one
  POW.
- **Location 5's fast red squadrons** fly at normal speed while you're under MISSILES.

### 6.2 Shoot-down ratio

The stage tally pays for the share of enemies shot down. An enemy counts only once you could engage it: hit at least
once, or 1.5 s in view within 350 units. Gate posts never count. Boss and hulk parts count as kills. A ship carried
over from the previous stage counts in the stage where it's hit.

### 6.3 Chain, medals, clear bonus

- **Chain:** ×2 / ×3 / ×4 kill points from 10 / 25 / 50 kills. It resets 2 s after the last kill or on a lost ship,
  shows on the HUD from 5, and its peak is paid at the tally (100 per kill).
- **Medals:** from gunships, hulk parts and boss parts. Their value climbs 100 → 5,000, then 1,000 more per catch up to
  10,000, for each one caught in a row, and goes back to 100 when one gets past. A miss is loud: a falling two-note
  sound, "MEDAL LOST" flashing red on the HUD, and a tip the first time.
- **Clear bonus:** 500,000 + 50,000 per ship left, doubled for a one-credit clear.
- **Extra ships** at 150k … 3M.

### 6.4 Hall of fame

`src/ui/hof.js`. A local top 10 with three initials, the stage reached and continues used, one entry per credit.
Name entry appears on the game over and ending screens and works with the keyboard, ▲ ▼ buttons and a gamepad. It
never blocks: leaving the screen saves the initials as they stand. The top 5 show on the title screen.

## 7. Enemies and difficulty

### 7.1 Formations and second passes

`src/game/formations.js` defines the paths; `src/game/waves.js` mirrors, flips, rotates and offsets them. Each
location sets the share of formations that come round for a second pass from the far side: none in location 1, a
third in locations 2–4, half in location 5.

### 7.2 Difficulty ramp

Each location authors its own stage ramps, and a location factor T scales them up from one location to the next
(`game.js` `makeDifficulty`; location 1 has T = 0). Locations 4–5 get harder through formations, not a wall of
bullets: bigger and faster squadrons, more second passes, and a fire scale per location (`fireScale`). A bullet cap
per stage (10 live enemy bullets in location 2, 12 in locations 3–4, 18 in location 5) makes enemy, hulk and boss
guns wait above it.

There is something to dodge from the enemies, not only the hazards (plan 1): locations 2–4's ramps sit close to
location 5's, location 1's stages 4–8 fire more than its lessons, and darts in V formations fire `burst3`, three
aimed bullets 0.12 s apart on one line (dodged by moving, as the red ring teaches).

### 7.3 Bosses, hulks, hazards, feeders

- **Bosses** (`bosses.js`): multi-part, each part a kill with a medal. Any boss escapes when its time limit runs out:
  a strip under its hp bar drains, the seconds show in the last 15 with a warning at 10, and the escape banner says
  how much hull it had left. Every boss dies the same way: 3 s of explosions chained across the hull, then the final
  blast, a ring the size of the boss and a white-out (`boom` 4 for the cruiser, 6 for the others, 8 for the
  Dreadnought). Location 2–4 bosses add an aimed spread from the core; the Gatekeeper's turrets carry warm beacons;
  the Dreadnought is the biggest thing in the game. When a boss dies, the rest of its section warps past at speed.
- **Hulks** (`hulks.js`): big targets with destructible parts that aren't bosses (ore haulers, the refinery, the
  battleship). They pass close: every hull sphere at least 12 units outside the play box.
- **Zone hazards** (`hazards.js`): telegraphed volumes (lightning, geysers, flares, crossfire), each answered by a
  skill that location 1 teaches.
- **Feeders:** during a boss fight, a 3–4 dart wave crosses in front of the boss every 6–8 s. Outside boss fights, a
  lull filler sends one when there's been no kill for 8 s and fewer than 4 targets are in view (never during
  lessons, the landing or a stage's closing tally). Feeders don't fire in location 1, and fire at half rate after
  that.
- **The density director** (`waves.js`) counts what you can see: enemies on screen and ahead within 350 units, live
  hulk parts on screen, a boss. The wave clock runs 4× while fewer than the stage's `minAlive` are in view, and after
  1 s with nothing in view it jumps to the next wave, at most 6 s ahead of its time (never past a lesson, a hint or
  a message, which are timed to the place). Killing fast brings the next wave sooner.

### 7.4 Readability

- **Size floor:** far enemies are drawn up to 2.5× bigger, to stay at least 2.5% of the screen width. The hitbox
  follows the drawn size, so you can hit what you see.
- **Rim light:** the ship rim light isn't fogged, and it's 30% stronger in the nebula, the frozen moon and the
  corona.
- **Red wins:** pickup catch rings are small and faint, drawn under the danger rings. POWs fly to you and have none.
- **One banner at a time:** location card > stage card > warning > pickup. A pickup during a card or a warning shows
  as a popup at the ship; a stage card clears the hint line.

## 8. Rendering, loading, performance

- **Two passes** share one world coordinate system (`src/render/renderer.js`): a background scene (sky cubemap,
  stars, planets, rings, near = 1) and the gameplay scene (near = 0.3) after a depth clear.
- **Rail frame:** everything that plays is a child of `railRoot`, whose transform is the rail frame. Only scenery is
  in world space.
- **Quality tiers** (`src/core/quality.js`): low, medium and high, guessed from the device and then adjusted by
  dynamic resolution.
- **Lazy locations** (`src/main.js`): each later location's chunk (data, backdrop, bosses, hulks, music) and GLB are
  fetched once, ahead of time. `src/render/backdrop-kit.js` is imported only by location chunks.
- **Draw calls:** 14–41 at peak (41 in the refinery).

## 9. Audio

Everything is synthesized in the browser, so there are no audio files to download.
- **Effects:** `src/audio/sfx.js`.
- **Music:** `src/audio/music.js` is a small sequencer on WebAudio with synthesized instruments, so a theme costs a
  few KB of note data. `src/audio/songs.js` holds the shared cues (title, boss, jingles, ending) and location 1's
  theme, and later locations carry their own songs in their chunks. A four-note fleet motif ties them together.
- **Loudness:** about −19 LUFS with music, effects on top (`npm run music` reports each cue).

## 10. Models

Built by a Blender script, `assets-src/blender/build_ships.py`, then welded and compressed with gltf-transform
(meshopt) by `scripts/build-models.sh`.
- **Files:** `ships.glb` (player, enemies, cruiser, carrier) in the initial download; `boss.glb` (the mothership) and
  `loc2.glb` … `loc5.glb` (each later location's hulks and bosses) loaded with their location.
- **Conventions:** game units are metres. The nose is along Blender +Y (three.js −Z). Low poly, flat shaded, colour
  from materials. Child empties `glow_*`, `gun_*` and `bay_*` are markers read by the game, and child meshes `part_*`
  are destructible boss parts.
- If a GLB is missing, the game falls back to procedural stand-ins.

## 11. Tooling

All in `scripts/`. See the README for the commands.

| Tool | What it does |
|---|---|
| `play/bot.js` | plays like a person: real input events, sees only the screen through a 180–300 ms reaction delay, Fitts-like mouse moves. Never writes game state. Presets `average`, `expert`, and `showcase` (a calm, good player for video: capped aim speed, sticks to a target, prefers centred targets, bombs into bullet curtains) |
| `play/record.js` | frame-exact 60 fps video, sound and telemetry; real-time play (`npm run play`, also `--human`); whole-campaign takes (one video and sound stems per location, `--video-locs`), `--dpr`, `--attract` fly-bys, `--clean`, `--master`. A run depends only on seed, size, `--q` and holds: video and no-video runs are identical |
| `play/analyze.js` | `telemetry`: what was on screen, kill cadence, enemy fire by class and its escape time, hit fairness, per-stage and per-location tables, the dodge probe. `video`: motion, flashes, audio onsets and loudness from any video. `chart`: motion over time as SVG. `highlights`: a take's tagged moments and windows to avoid; `--rank` scores takes for showcase use. `campaign`: whole-campaign takes side by side (first FULL, time at each power level, the climb back after a lost ship, POWs caught, empty screens, enemy fire, bosses, extra ships) |
| `play/edit.js` | `npm run video -- youtube\|short\|x`: cuts a take into a platform video from an edit list (`play/edits/*.json`): captions and cards rendered by Chrome, music beds from the stems, −14 LUFS, checks against the platform's numbers |
| `src/game/telemetry.js` | the in-game side: records every 0.25 s, plus events; the dodge probe flies the ship's escape in 8 directions against each threat |
| `play/probe-volleys.js` | checks that no two bolts of a volley ever cross |
| `rail-check.js` | per location and route: length, speed, darkness, sun angle |
| `play/perf.js` | fps per location's busiest stage: low tier, 4× CPU throttle, real time |
| `play/loadtime.js` | time to interactive, served with brotli, network and CPU throttled |
| `play/music.js` | renders every music cue to WAV and reports loudness and peak |
| `play/shots.js` | screenshots at given game times, plus the between-location screens |
| `check-budget.js` | fails the build over the download budget (§2) |

**Bot numbers aren't people.** The bot aims through the crosshair lock, and can't tell whether a run feels fair.

## 12. Tuning targets

Our own targets, measured with the bots (§11). Since plan 1 (Oct 29) they are measured on whole campaigns:
showcase seeds 1–8 at `--q high`, average and expert seeds 1–3 at `--q medium`, all at 1280×720, with
`analyze.js campaign`. "Before" is the same 14 campaigns on the build before plan 1 (`recordings/p1/base`).

| Measure | Target | Latest | Before |
|---|---|---|---|
| First FULL, no ship lost (expert, showcase) | 11–16 min | 13.5–15.7 min | 4:13–4:27 |
| Time at FULL, locations 2–4 | showcase 30–60%, average ≤ 20% | showcase 47% (15–74), average 19–20%, expert 75% (it lost no ship) | 84–100% |
| Back to FULL after a ship lost at FULL | ≥ 5 min | 7.8–9.4 min when it comes back; mostly not before the end of the run | 6 s to 3 min |
| POW drop to pickup | ≤ 3 s | 1.7 s | 9–17 s in location 1 |
| Shoot-down ratio, average bot, locations 1–4 | ≥ 70% | L1 72–75%, L2 94–96%, L3 77–78%, L4 68–80% | 89–100% |
| Shoot-down ratio, expert, locations 1–4 | ≥ 85% | L1 78–81% (not met: the tutorial is flown at SINGLE to QUAD), L2–4 97–100% | 92–100% |
| Longest gap with no kill, locations 2–4 (location 1's lessons hold the waves) | ≤ 12 s | 9–15 s at FULL, up to 32 s below it | 20–33 s |
| No enemy on screen, locations 1–4 | ≤ 30% of samples, no section over 40% | L1 23–30%; L2–4 16–46% (the strong runs at FULL are the emptiest); worst sections 37–43% | 31–53%; hazard sections 51–65% |
| Enemy bullets on screen, location 1 stages 4–8 | mean 1.5–3, p90 ≤ 6 | 1.1–2.0 | 0.3–0.9 |
| Enemy bullets on screen, locations 2–4 | mean 2–4 | 1.9–2.9 below FULL, 0.4–1.3 at FULL | 0.2–0.9 |
| Hits from enemy fire (bullets, shells, missiles), locations 2–4 | ≥ 30% | 15% (not met: beams and hazards still lead) | 6% |
| Hits warned (marker ≥ 0.3 s) and visible (≥ 0.4 s) before impact | ≥ 95% | 93% (the rest: flying into a bullet in view for 1.5–4.6 s) | 98% |
| Location 2–4 boss fight | expert 35–55 s | expert 33–37 s; below FULL the Flagship and the Fortress escape | 25–32 s |
| Enemy fire on screen, location 5 (mean) | ≤ 7 | 4.0–5.3 | 3.3–3.8 |
| Enemies on screen, location 5 (mean) | ≥ 9 | 6.6–8.8 | 4.7–5.7 |
| Player stream on screen while firing | ≥ 25% of screen height | median 40% (before plan 1) | |
| Extra ships per campaign | no more than before | 5–6 | 6 |
| Location 5 outcome | doesn't clear; the showcase bot destroys the Dreadnought in 1–3 of 8 | destroyed in 3 of 8 (82–84 s of 86); two more escape with 3% and 6% of the hull | none of 14 |

## 13. How it got here

1. **Iteration 0:** one stage on a rail with a fork, formations, inverted wings, bosses, the Blender ships, and the
   Cloudflare deploy.
2. **Iteration 1:** visible fire for both sides, the four speed classes, danger markers, breakable asteroids, the
   human-like bot, the recorder and the analyzer.
3. **Iteration 2:** location 1 as 8 teaching stages, the power ladder, the evasive roll, lessons and hints, parallel
   volleys.
4. **Iteration 3:** four more locations, the carrier and star map, music, better explosions, no stage select, the
   name Pilot One.
5. **Iteration 4:** recovery after a lost ship, kills during boss fights, a fairer tally, chain and medals, the hall
   of fame, location 4–5 difficulty from formations, readability.
6. **Showcase videos (plan 0):** deterministic bot campaigns, the showcase bot, the recorder's takes and the editor.
7. **Plan 1:** scarce power (one POW a level, 3 per location, back to SINGLE with nothing given back), fuller
   screens (the lull filler fixed, the wave pull), enemy fire to dodge, boss timers and bigger boss deaths, a longer
   medal ladder.

## 14. Open work

1. **Playtest by people** (plan 1 §2.8): does a lost ship feel like a loss without feeling like the run is over; is
   FULL worth the climb; location 1 with 2 POWs; the boss timer; the loud medal miss; the Gatekeeper's turrets; the
   three location 1 lessons the bot times out of (aimed fire, roll, laser); location 5 (`?loc=5`); name entry on a
   phone and with a gamepad.
2. **Empty screens at FULL:** a strong player at FULL still clears a wave in a second or two: no enemy on screen in
   37–46% of locations 2–4 (16–30% when below FULL); the worst sections are about 40% (the nebula's edge, the
   cavern, the geysers). Next: more pairs of waves at once in those sections, as location 5 does.
3. **The Gatekeeper** escapes in 14 of 14 campaigns with 90–100% of its hull: the bots don't hurt the turning ring.
   Check with people (the turrets now carry beacons) before changing its hp.
4. **Location 1's shoot-down ratio:** the expert gets 78–81% (target 85%): the tutorial is flown at SINGLE to QUAD,
   and fast formations get past. Its grades are harder than before.
5. **Hits from enemy fire:** 15% of the hits in locations 2–4 (target 30%); beams, lightning and flares still lead.
   Enemy fire bites when you're below FULL (about 2–3 bullets on screen), much less at FULL.
6. **Extra ships:** every campaign reaches 5–6 of the 6 score thresholds, so a run has up to 9 ships before a
   continue. If lost ships should cost more, raise `EXTRA_LIVES` (`game.js`).
7. **Formations:** entries from behind with a 1.2 s warning, side columns of 5, rammers that lead the ship.
8. **Bomb readability:** reads well on video in location 5 (the cyan ring); in the location 4 cavern it is a faint
   wave in the dark.
9. **Tech:** merge hulk draw calls (41 in the refinery), whole-game loudness, gamepad focus on the location clear and
   star map screens.
10. **Not tested yet:** a real phone and a real gamepad.
11. **Returning players** (next_0 item 10, not planned): every run starts at 1-1 with the 8-minute tutorial.
12. **The showcase videos** show the game before plan 1 (fast FULL, wreck POWs): a re-shoot is about 7 h of machine
    time (`ai/next_0.md`).

## 15. Working conventions

- Prompts and plans are numbered and paired in `ai/`: `prompt_N.md` → `plan_N.md` → `next_N.md`, from 0 in this
  repo. `next_N.md` summarises the implementation and what to work on next.
- Tuning claims come with bot measurements (§11), and the budgets in §2 are checked on every build.
