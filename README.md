# Pilot One

A 3D shoot 'em up game in space (repo: [`pilot-one`](https://github.com/boomgogo/pilot-one)).

An arcade shooter in 3D. The ship flies a fixed rail through space while you move around
inside a corridor, aim anywhere in a forward cone (crosshair stays centered) and roll. Enemy squadrons
arrive in predictable arcade formations, some of them upside down until you roll to match them.

## Setup and run

```bash
npm install
npm run dev
```

## Controls

| Action | Desktop | Touch | Gamepad |
|---|---|---|---|
| Aim | mouse (pointer lock) | drag with the right thumb | right stick |
| Move | W A S D | left-thumb virtual stick | left stick |
| Roll (hold) | Q / E | ⟲ ⟳ buttons | LB / RB |
| Evasive roll (3 per stage) | double-tap Q or E | double-tap ⟲ or ⟳ | double-tap LB or RB |
| Fire | click / Space (or auto-fire option) | auto-fire | RT |
| Bomb (thrown, then a shockwave) | Shift / right-click | BOMB button | LT |
| Pause | Esc / P | ❚❚ button | Start |

## The campaign

Five locations, 35 stages, about 40 minutes. A carrier fleet jumps from system to system: every location starts with
a launch and ends with a landing on the carrier, then the star map and the jump to the next one. Every game starts at
location 1, stage 1; after location 5 the game ends (`src/data/locations/`).

| # | Location | Stages | New |
|---|---|---|---|
| 1 | GAS GIANT RUN | 8 | the tutorial: one thing per stage (below) |
| 2 | THE BELT | 6 | ore haulers to strip, mining-drone swarms, mass drivers lobbing boulders, a refinery; the Excavator |
| 3 | CRIMSON NEBULA | 7 | fog, stray beams from a fleet battle, ion-storm lightning, cloaked wasps, a battleship; the Flagship |
| 4 | FROZEN MOON | 6 | guns on the ice, a canyon that narrows the play box, geysers, a dark cavern; the Fortress |
| 5 | THE CORONA | 8 | solar wind, solar flares (roll through them), mirror beams, the Dyson shell; the Gatekeeper, the Dreadnought |

- **Difficulty** rises by location (`Game.makeDifficulty`: each stage's ramp × the location's threat level).
  Location 5 is a step up and almost impossible: more and faster fire, fewer pickups, no shield back at its tallies,
  shorter boss time limits. Every hit is still telegraphed. Every boss escapes when its time runs out (the strip under
  its hp bar); if the Dreadnought escapes, the game ends without its ending. Continue works as before (score back to 0); the ending shows how many continues you used.
- **Stage ends:** a ring of lights across the corridor turns green as you fly through it; the tally counts up, grades
  the stage (S, A, B, C), shows the location's stage pips and what you got back; a short jingle plays.
- **Location ends:** the landing, the location clear screen (grades, medals: cleared, no ship lost, 90% shot down,
  all S; a full shield and bombs), the star map, the jump, and the next location's title card.
- **Records** per location (best score, medals) are kept by the browser and shown on the title screen.
- **Score:** a kill chain multiplies kill points (×2 from 10 kills, ×3 from 25, ×4 from 50) and drops after 2 s
  without a kill. Gunships, hulk parts and boss parts drop medals worth 100, 200, 500, 1,000, 2,000, 5,000, then
  1,000 more per catch up to 10,000; one that gets past starts the ladder again ("MEDAL LOST"). The good ending pays a clear bonus, doubled for a one-credit clear.
- **Hall of fame:** a local top 10 with three initials, the stage reached and continues used. You enter them on the
  game over and ending screens, with the keyboard, the ▲ ▼ buttons, or a gamepad (d-pad, A).
- **The shoot-down ratio** counts only the enemies you could engage: hit at least once, or 1.5 s in view within 350
  units. Boss and hulk parts count as kills.
- **Formations:** from location 2 on, some waves come round for a second pass. Locations 4–5 have bigger squads, and
  locations 2–5 a cap on live enemy bullets. Clear a wave fast and the next one comes sooner.
- **Music:** a theme per location, boss cues, the final boss, jingles, the title and the ending, all synthesized in
  the browser from note data (`src/audio/music.js`, `src/audio/songs.js`, and each location's own songs). A
  four-note fleet motif ties them together. Music volume is in the pause menu.

### Location 1's stages

One flight around a gas giant, in 8 stages of 1–1.5 minutes (`src/data/locations/gas-giant.js`). Each stage teaches
one thing, just before it is needed, and enemy fire builds up stage by stage. Later locations introduce each new
threat with a one-line hint instead.

| # | Stage | Teaches |
|---|---|---|
| 1 | LAUNCH (past the moon) | shooting: aim, fire, lead, a red squadron for your first POW. Nothing shoots back |
| 2 | TRANSFER (the dive to the ring gate) | dodging: move, the warning rings, aimed shots. Ends at the fork |
| 3 | THE RINGS (over them or through the gap) | rolling to match inverted and sideways wings |
| 4 | INNER RINGS | shooting their fire down: shells and mines |
| 5 | WRECK FIELD | the evasive roll, against missiles, lasers and a laser gate |
| 6 | CRUISER | bosses and the bomb |
| 7 | NIGHT SIDE | nothing new: everything so far, in the dark |
| 8 | MOTHERSHIP | the final exam, at dawn, then the carrier |

- **Lessons** show a hint (worded for keyboard, touch or gamepad) and hold the next waves until you've done the thing
  or a short time has passed; the practice repeats at most twice. Done lessons are remembered by the browser; the
  pause menu has "Reset tutorial tips".
- **Between stages** a short tally shows while you keep flying: shoot-down bonus, aligned kills, a no-hit bonus, and
  one shield pip back. Evasive rolls refill at every stage.
- **After stage 8** you land on the carrier, and the fleet jumps to location 2.

## Weapons

Each POW adds a level, and full power takes work: there are 2 POWs in location 1, 3 in each of locations 2–4 and 2
in location 5, each one a red squadron shot down to the last ship. A POW flies to your ship once it drops. Losing a ship drops you
back to a single bolt with nothing given back, so FULL is the rest of a location away; if you are still at SINGLE or
TWIN 15 s after a respawn, a slow supply gunship brings one POW. Every bolt of a volley flies parallel to your aim
line, so the streams never cross.

| Level | Volley |
|---|---|
| SINGLE | one bolt from the nose |
| TWIN | two parallel bolts from the wingtips |
| QUAD | twin + two outer bolts angled outward (a cone; roll to turn it vertical) |
| MISSILES | + wingman drones launching homing missiles |
| SPIRAL | the twin becomes four bolts on a turning circle (a rotating cylinder of tracers) |
| FULL | the drones fire too, faster (the outer streams are drawn thin, so they don't hide the targets) |

The laser pickup (L) is an 8 s special on top.

## Firing and dodging

Almost nothing is instant: every firing travels, in one of four speed classes (`src/game/weapons.js`).

| Class | Player | Enemies |
|---|---|---|
| Slow | bomb: thrown forward, then a shockwave clears enemy bullets as it passes | shells (shoot them before they burst), mine shrapnel |
| Medium | | aimed / spread / fan / ring bullets: round, warm-coloured, with a trail back to the shooter |
| Fast | bolt stream (tracers from the guns to the crosshair); homing missiles from power level 2 | missiles: home for 1.5 s, then fly straight |
| Instant | laser pickup (L): a beam that hits instantly for 8 s | lasers: an aim line and a 1 s charge first |

- **Escape-time rule.** Every enemy firing gives you at least 1 s from when it is visible (or telegraphed) to impact.
- **Colours.** Yours is cyan / blue / white, anything that hurts you is warm.
- **Lead.** When the crosshair locks a moving target, your shots converge where it will be (a small diamond shows
  the meeting point).
- **Danger markers.** Each threat about to reach your ship's plane gets a ring where it will cross it, sized to the real
  collision radius: red means it hits unless you move, amber is a close call. A small ring on your ship is your hitbox.
  Cyan rings show where a pickup will pass. Toggle the markers in the pause menu.
- **Asteroids.** Every asteroid you can see can be shot (`src/game/fields.js`). Only the ones in your corridor can hit
  you.
- **Evasive roll.** Double-tap a roll key: the ship barrel-rolls and everything passes through it for 0.45 s. The view
  keeps its roll. A laser gate (a fence of beams across the corridor) can only be rolled (or bombed) through.

## Deploy

```bash
npx wrangler login
npm run deploy
```

Deploys `dist/` as a static site on Cloudflare Workers (assets only, `preview_urls: false`, see `wrangler.jsonc`).
`npm run build` fails if the initial download exceeds the load-time budget (`scripts/check-budget.js`).
The version label in the bottom-left corner is `v.<first 4 chars of the deployed commit>`.

## Ship models

Ships are built by a Blender script (`assets-src/blender/build_ships.py`) and compressed with gltf-transform
(meshopt) into `src/assets/*.glb`:

```bash
BLENDER=/path/to/blender npm run models
PREVIEW_DIR=/tmp/previews BLENDER=/path/to/blender npm run models   # also renders preview PNGs
```

`ships.glb` (the player, the enemies, location 1's cruiser and the carrier) is in the initial download; `boss.glb`
(location 1's mothership) and `loc2.glb` … `loc5.glb` (each later location's hulks and bosses) load in the background.
`PREVIEW_ONLY=hauler,flagship` limits the previews. If a GLB is missing or broken, the game falls back to procedural
stand-ins.

## Debug URL parameters

| Parameter | Effect |
|---|---|
| `?debug` | fps / cpu / draw-call overlay |
| `?loc=3` | start at a location (1–5) |
| `?stage=5` | start at a stage of that location |
| `?t=rings:12` | start at a section (its `id` in the location's data) and time |
| `?notutor` | no lessons |
| `?route=gap` | force a fork branch (`over` / `gap`) |
| `?q=low` | force a quality tier (`low`, `medium`, `high`) |
| `?god`, `?autoplay`, `?speed=3`, `?autostart` | invulnerable, autopilot, time scale, skip the title |
| `?hitbox` | draw every hazard's collision sphere |
| `?markers=off` | hide the danger markers |
| `?bot`, `?capture`, `?telemetry` | automation (see below): no auto-pause, frame-stepped clock, telemetry |

## Bot play, recording and analysis

`scripts/play/bot.js` plays like a person. It uses the same keyboard and mouse events, sees only what is on screen
(through a 180–300 ms reaction delay), and aims with overshooting, Fitts-like mouse moves. It never writes game state.

```bash
npm run record -- --skill average --route over        # frame-exact 60 fps video + sound + telemetry → recordings/
npm run record -- --skill expert --no-video           # telemetry only (a full stage in seconds)
npm run record -- --no-video --wav                    # telemetry + the sound track as played (.wav, not normalised)
npm run play                                          # watch the bot play in a browser window, in real time
npm run play -- --human                               # you play; close the window to save the run's telemetry
node scripts/play/analyze.js telemetry recordings/<run>.telemetry.json   # incl. a per-stage table and the dodge probe
node scripts/play/analyze.js campaign recordings/<take> ...           # whole campaigns: power over the run, empty screens, bosses
npm run probe                                         # checks that no two bolts of a volley ever cross
npm run record -- --no-video --campaign --params god  # every location, through the star map, to the ending
npm run record -- --loc 3 --no-video                  # start at location 3
npm run shots -- --loc 4 --params stage=3 --at 5,20   # screenshots at game times (+ the between-location screens)
npm run music                                         # every music cue rendered to recordings/music/*.wav, with loudness
npm run rail                                          # route check per location: length, speed, darkness, sun angle
npm run perf                                          # fps per location's busiest stage: low tier, 4× CPU throttle, real time
npm run loadtime                                      # time to interactive, served with brotli, network and CPU throttled
node scripts/play/analyze.js video recordings/<run>.mp4 --from 20 --to 132 --sheet   # motion, flashes, audio, contact sheets
node scripts/play/analyze.js chart <a>.video.json <b>.video.json --file motion.svg   # motion over time, as SVG
```

Recording drives the system Chrome (`playwright-core`, headless, on the GPU), steps the game one 1/60 s frame at a
time, and pipes screenshots to `ffmpeg`. Sound is recorded as effect calls and rendered offline afterwards. The
video's sound is loudness-normalised; the level the game actually plays at is saved as `rawLufs` in the run's
`.meta.json`.

### Showcase videos

The YouTube video, the Short and the X post are cut from bot takes (`ai/plan_0.md`). A run depends only on the
seed, `--size`, `--q` and the hold lengths, so a fast telemetry-only scout replays exactly as the filmed shoot.
`--dpr`, `--master` and `--clean` don't change the run.

```bash
# 1. scout: whole campaigns, telemetry only (about 2 min each), then rank them
npm run record -- --skill showcase --q high --campaign --max 3600 --no-video --seed 7 --out recordings/scout
npm run analyze -- highlights --rank recordings/scout/*-1280x720  # → recordings/analysis/rank-1280x720.json
# 2. shoot the best seed: 1280x720 at --dpr 2 is a 2560x1440 master with a 720p HUD (about 4 h on a GTX 1050)
npm run record -- --skill showcase --q high --campaign --max 3600 --seed 7 --dpr 2 --master --clean
npm run record -- --skill showcase --q high --campaign --max 3600 --seed 4 --size 540x960 --dpr 2 --master --clean --video-locs 2,3,4,5
npm run record -- --attract 40 --q high --dpr 2 --master --clean        # the title fly-by under the cards
# 3. cut: the edit list scripts/play/edits/<name>.json → recordings/videos/pilot-one-<name>.{mp4,txt}
npm run analyze -- highlights recordings/<take>                           # tagged moments, and windows to avoid
npm run video -- youtube --draft                                          # fast encode, for review
npm run video -- youtube                                                  # the upload: checks size, fps, length,
                                                                          # −14 LUFS, true peak and flashes
```

A take is a folder: one video per location (`L1.mp4` …) with its sound as stems (`L1.mix.wav`, `.sfx.wav`,
`.music.wav`), plus `telemetry.json` and `meta.json`. On Linux with a hybrid GPU, prefix the shoot with
`__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia` to render on the discrete GPU.


## Project layout

```
src/main.js            boot, loading, screens, frame loop
src/game/              game state, player, enemies, formations, waves, bosses, rocks, pickups, stage runner,
                       weapons (firing classes, bomb, lasers, laser gate), missiles, danger markers, hitbox
                       radii, breakable asteroid fields, tutor (lessons and hints), telemetry / bot view
src/world/             rail splines (forks, parallel-transport frames) and world scenery
src/render/            renderer (background + gameplay passes), billboards, fx, sky, planets, models, materials
src/data/locations/    the five locations: route, stages (sections, wave timelines, difficulty ramp), scenery, and
                       (later locations) their backdrop, bosses, hulks and music, each loaded as its own chunk
src/game/hulks.js      big multi-part targets that aren't bosses; hazards.js: lightning, geysers, flares, crossfire
src/ui/hud.js          DOM HUD; screens.js: location clear, star map, ending, records
src/audio/sfx.js       synthesized sound effects; music.js: the sequencer and its instruments; songs.js: shared cues
assets-src/blender/    model build script
scripts/play/          bot, recorder, analyzer, volley probe, screenshots, music render, perf, load time
scripts/rail-check.js  route check
```

## Credits and licence

- Code, ship models (`assets-src/blender/`) and music: [MIT](LICENSE).
- [three.js](https://threejs.org) (MIT) for rendering, with its bundled [meshoptimizer](https://github.com/zeux/meshoptimizer) decoder (MIT); their licences ship with the site as `THIRD_PARTY_LICENSES.txt`. Models are built with [Blender](https://www.blender.org) and
  compressed with [glTF-Transform](https://gltf-transform.dev).
- Design notes and the project's history: [`ai/summary.md`](ai/summary.md).

## Backed by

Man & Bot

Browse web games at [Maize.Live](https://maize.live)
, or watch on YouTube [@RadWebGame](https://www.youtube.com/@RadWebGame)
