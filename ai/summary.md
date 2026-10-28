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
| Initial JS (three.js + game code) | 250 KB | 245.2 KB |
| Everything before Start is enabled | 600 KB | — |
| Each later location's JS chunk | 40 KB | — |
| Each later location's GLB | 60 KB | — |
| Time to interactive, slowest throttled profile (`npm run loadtime`) | ≤ 3 s | 2.71 s |
| Frame rate, low tier, 4× CPU throttle, worst 1 s (`npm run perf`) | no drop over 10% between versions | ≥ 103.7 fps |

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
  away, "THE DREADNOUGHT ESCAPED" with the game-over music. Both show the run's tally and the name entry.

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

### 6.1 Power ladder and recovery

Each POW adds a level: SINGLE → TWIN → QUAD (a cone, which you roll to turn vertical) → MISSILES (wingman drones) →
SPIRAL (four bolts on a turning circle) → FULL. POWs come from a whole red squadron shot down, and from some gunships
and bosses.

Losing a ship drops you to SINGLE, but the power is easy to win back:
- **Wreck POWs:** `ceil(levels lost / 2)`, up to 3, wait ahead of the respawn point with a wider magnet. A continue
  gets them too.
- **Supply gunship:** if you're still at power ≤ 1 15 s after a respawn, a slow gunship that doesn't fire brings one
  more POW.
- **Location 5's fast red squadrons** fly at normal speed while you're under MISSILES.

### 6.2 Shoot-down ratio

The stage tally pays for the share of enemies shot down. An enemy counts only once you could engage it: hit at least
once, or 1.5 s in view within 350 units. Gate posts never count. Boss and hulk parts count as kills. A ship carried
over from the previous stage counts in the stage where it's hit.

### 6.3 Chain, medals, clear bonus

- **Chain:** ×2 / ×3 / ×4 kill points from 10 / 25 / 50 kills. It resets 2 s after the last kill or on a lost ship,
  shows on the HUD from 5, and its peak is paid at the tally (100 per kill).
- **Medals:** from gunships, hulk parts and boss parts. Their value climbs 100 → 5,000 for each one caught in a row,
  and goes back to 100 when one gets past.
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
per stage (12 live enemy bullets in location 4, 18 in location 5) makes enemy, hulk and boss guns wait above it.

### 7.3 Bosses, hulks, hazards, feeders

- **Bosses** (`bosses.js`): multi-part, each part a kill with a medal. When a boss dies, the rest of its section warps
  past at speed.
- **Hulks** (`hulks.js`): big targets with destructible parts that aren't bosses (ore haulers, the refinery, the
  battleship).
- **Zone hazards** (`hazards.js`): telegraphed volumes (lightning, geysers, flares, crossfire), each answered by a
  skill that location 1 teaches.
- **Feeders:** during a boss fight, a 3–4 dart wave crosses in front of the boss every 6–8 s. Outside boss fights, a
  lull filler sends one when there's been no kill for 8 s and fewer than 4 enemies are in the air (never during
  lessons or the landing). Feeders don't fire in locations 1–2, and fire at half rate after that. The lull filler
  doesn't fire in a stage's last section yet, which is the whole of most stages: a bug (§14).

### 7.4 Readability

- **Size floor:** far enemies are drawn up to 2.5× bigger, to stay at least 2.5% of the screen width. The hitbox
  follows the drawn size, so you can hit what you see.
- **Rim light:** the ship rim light isn't fogged, and it's 30% stronger in the nebula, the frozen moon and the
  corona.

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
| `play/analyze.js` | `telemetry`: what was on screen, kill cadence, enemy fire by class and its escape time, hit fairness, per-stage and per-location tables, the dodge probe. `video`: motion, flashes, audio onsets and loudness from any video. `chart`: motion over time as SVG. `highlights`: a take's tagged moments and windows to avoid; `--rank` scores takes for showcase use. |
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

Our own targets, measured with the bot (average and expert skill):

The shoot-down ratios are from seed 1, `--q medium`, after the double-tap fix (Oct 28: in `?capture` the evasive
roll's double-tap is timed on the game clock). Before it, ordinary roll-key presses registered as extra evasive rolls
at telemetry speed, which gave the bots free invulnerability and 2–10 points more.

| Measure | Target | Latest |
|---|---|---|
| Enemy bullets on screen, location 1 | mean 1.5–3, p90 ≤ 6, bosses up to about 15 | — |
| Enemy fire on screen, location 5 (mean) | ≤ 7 | 4.7–5.2 |
| Enemies on screen, location 5 (mean) | ≥ 9 | 7.8–9.1 |
| Hits warned (marker ≥ 0.3 s) and visible (≥ 0.4 s) before impact | ≥ 95% | 87–100% in location 5 |
| Shoot-down ratio, average bot, locations 1–4 | ≥ 70% | 69–89% (L1 89, L2 69, L3 81, L4 78) |
| Shoot-down ratio, expert, locations 1–4 | ≥ 85% | 84–93% (L1 92, L2 87, L3 93, L4 84) |
| Expert after its first lost ship | within 15 points of before | 88–95% |
| Back to QUAD after a lost ship, median | ≤ 30 s | 4–30 s |
| Longest gap with no kill | ≤ 12 s | 15–31 s (not met) |
| Player stream on screen while firing | ≥ 25% of screen height | median 40% |
| Location 5 outcome | doesn't clear | both bots reach the Dreadnought; it escapes. The showcase bot destroys it in 1 of 14 campaigns (Oct 28 scout) |

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

## 14. Open work

1. **Playtest by people:** a lost ship and getting the power back; whether the chain and medals are worth chasing;
   location 5 (`?loc=5`); name entry on a phone and with a gamepad.
2. **Empty screens:** with the showcase bot, no enemy is on screen in 35–50% of the samples in locations 1–4 (27% in
   location 5); hazard sections are the emptiest (geysers 65%, storm 62%, battleship 61%). Waves run on fixed
   timelines, so a fast player waits. Pull a section's wave clock forward when the screen has been empty for about a
   second, and add waves on top of the hazards.
3. **Location 5's wall:** the Dreadnought escapes in 13 of 14 showcase campaigns with no visible timer, so the run
   ends on the escape screen. Show the time left, and say on the escape screen how close it was. The Gatekeeper
   escapes in 14 of 14 with 0–2 of 6 turrets down: check that people can read and hit the turrets.
4. **Lulls:** gaps with no kill of 15–33 s remain. First fix the lull filler: `director()` in `game.js` skips it
   whenever `st.stageEnding`, which is true for the whole last section; it should skip only the tally
   (`!(st.stageEnding && st.remaining <= TRANSIT)`). Then re-measure.
5. **Formations:** entries from behind with a 1.2 s warning, side columns of 5, rammers that lead the ship.
6. **Bomb readability:** reads well on video in location 5 (the cyan ring); in the location 4 cavern it is a faint
   wave in the dark.
7. **Tech:** merge hulk draw calls (41 in the refinery), whole-game loudness, gamepad focus on the location clear and
   star map screens.
8. **Not tested yet:** a real phone and a real gamepad.
9. **Goals once power is full:** FULL comes at 4:14, and SPIRAL or FULL holds for 93–100% of locations 2–4; the
   medal ladder tops out after six catches. Give extra POWs a use, keep the ladder climbing past 5,000, and make a
   missed medal loud.
10. **Threat and spectacle in locations 2–4:** 0.2–0.9 enemy bullets on screen (most hits come from hazards), bosses
    that never take a ship, hulks that pass far away, small boss deaths. Numbers and ideas: `ai/next_0.md`.

## 15. Working conventions

- Prompts and plans are numbered and paired in `ai/`: `prompt_N.md` → `plan_N.md` → `next_N.md`, from 0 in this
  repo. `next_N.md` summarises the implementation and what to work on next.
- Tuning claims come with bot measurements (§11), and the budgets in §2 are checked on every build.
