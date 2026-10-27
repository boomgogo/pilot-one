# Plan 0: showcase recordings

Answers `ai/prompt_0.md`:

> Refine the script to autoplay the game, play as a human player and make a few game recordings
> 1. a youtube video, ~ 5 min, show off the different features and fun points of the game
> 2. a youtube short
> 3. a video for X / twitter

## 0. What this means

- **"The script"** is the recorder, `scripts/play/record.js`, and the bot it injects, `scripts/play/bot.js` (§11).
  The bot already plays like a person: it sees only the screen, reacts after a delay, sends real key and mouse events,
  and never writes game state. It stays that way. No `?god`, and not the in-game `?autoplay` autopilot, which writes
  `player.yaw` directly. The footage is real play, and lost ships are real.
- **The deliverables** are three finished files, ready to upload, plus the text and thumbnail that go with them.
  Uploading is yours to do.
- **Not in scope:** recording video of you playing. `--human` stays telemetry-only. Real-time screen capture of a
  headed window is a separate piece of work, if you want it later.

## 1. Where things stand

What the recorder already does well: frame-exact 60 fps capture (`?capture`, one bot tick + one 1/60 s step + one
screenshot per frame), sound rendered offline from the logged effect and music calls, `--campaign` through the star
map, and telemetry. `analyze.js video` already measures motion, flashes and loudness, and makes contact sheets.

Gaps for promo video, found by reading the code:

1. **Audio drifts after every held card.** The game-over hold (90 frames) and the location-clear hold (180 frames)
   write screenshots without calling `__bg.advance()`, so `game.time` stands still while the video moves on. Sound is
   logged against `game.time`, so a campaign video's sound runs 1.5 s early after each continue and 3 s early after
   each location clear. `game.update()` adds `dt` to `game.time` in every state, so advancing during the hold fixes it.
2. **The between-location screens barely show.** `ui.next()` goes through the star map in one call, so the map and
   its jump music never reach the video. `shots.js` already shows the right sequence: clear, `ui.map()`, wait for
   Launch, `ui.launch()`.
3. **Resolution.** There's no device-scale option. A bigger `--size` shrinks the HUD relative to the frame, which is
   the wrong trade for phone viewers. The `high` tier caps the pixel ratio at 2, so a 1280×720 CSS viewport at
   `deviceScaleFactor: 2` renders a true 2560×1440 frame with the HUD laid out as on a 720p screen.
4. **One mono mix.** The music can't be separated from the effects, so a montage can't run on one continuous track.
5. **No editor.** Nothing cuts, captions or encodes for a platform.
6. **The camera follows the aim** (the crosshair stays centred), so the bot's quick, overshooting flicks become whip
   pans on video. That's correct for measurement, but uncomfortable to watch.
7. **Play depends on the viewport.** The size floor (§7.4) scales enemies and their hitboxes with the screen width, and
   the bot reasons in screen pixels. A portrait run is a different run from a landscape run with the same seed.
8. **Determinism isn't verified.** Stage logic uses the seeded `makeRng`, the bot has its own seeded RNG, and
   `Math.random` appears only in visual effects (`bosses.js`, `hulks.js`, `sfx.js` noise). So the same seed at the same
   viewport should replay the same run. This needs checking, because the plan relies on it (§3.3).

## 2. Deliverables

All go to `recordings/videos/`, which is git-ignored.

| File | Format | Length | Notes |
|---|---|---|---|
| `pilot-one-youtube.mp4` | 16:9, 2560×1440, 60 fps | 5:00 ± 0:15 | 1440p gets YouTube's VP9/AV1 encode, which holds up much better on busy particle footage than its 1080p encode |
| `pilot-one-youtube.txt` | | | title options, description, chapters (from the edit), tags |
| `pilot-one-youtube-thumb.jpg` | 1280×720, < 2 MB | | hero frame plus the title |
| `pilot-one-short.mp4` | 9:16, 1080×1920, 60 fps | 35–45 s | Shorts allow up to 3 min, but short and loopable performs better |
| `pilot-one-short.txt` | | | title and description |
| `pilot-one-x.mp4` | 16:9, 1920×1080, 60 fps | 40–45 s | X's standard limit is 140 s and 512 MB. Autoplay is muted, so the captions carry the message |
| `pilot-one-x.txt` | | | post text |

Encodes, all with H.264 High, yuv420p, BT.709 tags, `+faststart`, and loudness at −14 LUFS integrated and −1 dBTP:

| Target | Video | Audio |
|---|---|---|
| YouTube | CRF 16, preset slow, closed GOP of 30 frames | AAC-LC 384k, stereo, 48 kHz |
| Short | CRF 17 | AAC-LC 320k, stereo, 48 kHz |
| X | CRF 18, maxrate 16M, bufsize 32M (inside the 25 Mbps ceiling, above the 5 Mbps floor) | AAC-LC 192k, stereo, 48 kHz |

The mono game sound is duplicated to both stereo channels.

All the audio is the game's own synthesized music and effects (MIT), so there's no Content ID risk.

## 3. Design

### 3.1 Recorder (`record.js`)

1. **`--dpr N`** sets `deviceScaleFactor`. Add the same option to `shots.js` for previews.
2. **Holds advance the clock.** Every held frame (game over, location clear, star map, ending) runs `advance(1)` and
   then a screenshot, so frames and game time stay 1:1 and the sound stays in sync.
3. **Between-location sequence**, with these hold lengths in frames:
   - location clear: `--hold-clear 240`
   - `ui.map()`, then wait (wall clock, no frames) until Launch is enabled
   - star map: `--hold-map 200`
   - `ui.launch()`, which starts the jump: stars streak, a flash, the new system
   - ending: 300
4. **`--attract S`** records S seconds of the title screen's attract flight before Start. **`--clean`** injects CSS that
   hides `#version`, and with `--attract` it also hides `#screen-title`, giving a clean fly-by for title and end cards.
5. **Per-location segments.** In `--campaign` mode the video goes to one file per location (`L1.mp4` … `L5.mp4`, plus
   `attract.mp4`), each with the game time of its first frame written to the meta file.
   **`--video-locs 3,5`** captures only those locations and fast-forwards through the rest without screenshots, at
   telemetry speed. The output goes to a folder per take: `recordings/<date>-<ver>-<skill>-s<seed>-<WxH>/`.
6. **Stems.** `renderAudio(t0, { music, sfx })` gains flags (a small change in `src/audio/sfx.js` `renderRecording`,
   passed through `__bg`). Each take writes `mix.wav`, `sfx.wav` and `music.wav`, all un-normalised, so their relative
   levels stay true. The per-segment mp4s keep a normalised mix for quick viewing.
7. **Master quality** (`--master`): JPEG quality 95 in, x264 CRF 14 out.
8. **Optional polish:** in `?capture`, `countUp` in `src/ui/screens.js` jumps straight to the final numbers. Driving it
   from `game.time` instead makes the tally count up on video. It only runs in capture mode, so there's no cost in play.

None of this changes what ships to players, except the stem flags on a capture-only function. `npm run build`
and `check-budget.js` must pass unchanged.

### 3.2 Showcase bot (`bot.js`)

A new preset, `--skill showcase`: a calm, good human player. It uses the same motor model (reaction delay, Fitts
moves with a minimum-jerk profile, efference copy), tuned for watchability. `average` and `expert` stay byte-for-byte
the same in behaviour, so the §12 measurements remain comparable. Every new behaviour sits behind a preset flag.

| Knob | Showcase | Why |
|---|---|---|
| reaction / dodgeSkill / evadeSkill | expert's (0.18 / 1 / 1) | few lost ships |
| tremor, overshoot | about half of expert's | the camera is the aim: less shake |
| fittsA / fittsB | a little slower than expert's | smoother pans |
| `maxAimRate` (new) | cap on rad/s per sub-movement | no whip pans |
| `stickiness` (new) | stay on a target until it dies, unless a much better one appears | fewer cuts of attention |
| `centreBias` (new) | prefer targets near the centre and ahead | the action stays framed |
| `moveHold` (new) | minimum 0.15 s per movement key | no twitchy jitter in idle wander |
| `bombStyle: 'show'` (new) | bomb when ≥ 8 enemy bullets are on screen or a boss is open, at most once per stage, keeping one in reserve below shield 2 | the bomb shows up on video (and covers open work §14.6) |

The bot already rolls to match wings, takes evasive rolls at gates and catches pickups through the cyan markers, so
medal chains come for free.

**Targets** (L1–L2, measured with `analyze.js`):
- shoot-down ratio within 5 points of expert
- no more lost ships than expert
- `analyze.js video` motion p90 at least 20% below expert's at the same seed

### 3.3 Scout, then shoot

1. **Determinism check.** Run the same seed twice with `--no-video --campaign`, at the same size, and compare the
   event streams (kill times, power, stage clears). They should match exactly.
2. **Scout.** Run 6–8 seeds of the showcase campaign with `--no-video` at 1280×720, and 4–6 at 540×960 for the Short.
   Telemetry-only runs are fast. Rank the takes with `analyze.js highlights --rank` (§3.4). A good take:
   - reaches location 5 without a continue (a continue resets the score on the HUD)
   - holds SPIRAL or FULL for a long time
   - has S grades, a ×4 chain, and a 5,000 medal
   - reaches the Dreadnought
3. **Shoot.**
   - **Landscape:** the chosen seed, at 1280×720 with `--dpr 2 --q high --master --clean --attract 20`, all five
     locations. This one master feeds both the YouTube and X cuts.
   - **Portrait:** 540×960 with `--dpr 2`, which is 1080×1920 with a phone-sized HUD. Capture only the locations the
     Short uses, with `--video-locs`.

   If the determinism check fails, the shoot run becomes its own scout: shoot two or three seeds with video on and keep
   the best.

### 3.4 Highlights (`analyze.js highlights`)

A new subcommand of the existing analyzer, which already reads telemetry. From a take's telemetry and segment meta it
writes `highlights.json`: tagged moments, each with a game-time window and the segment and frame it falls in.

| Tag | From |
|---|---|
| `power` | `power` events reaching SPIRAL or FULL; laser pickups |
| `aligned` | 3 or more aligned kills within 3 s |
| `evade` | `evade` events, with gate sections marked |
| `bomb` | `bomb` events with ≥ 8 bullets cleared |
| `boss-part`, `boss-kill`, `hulk` | `boss` and `hulk` events |
| `chain4` | chain reaching 50 |
| `medal5k` | a 5,000 medal. Needs `value` added to the `pickup` telemetry event (a one-line, telemetry-only change in `game.js`) |
| `stage-S`, `locclear`, `hazard:<section>` | stage clears, location clears, section ids (canyon, flares, cavern…) |
| `intensity` | per-second score from samples: enemies on screen + enemy bullets + kills. The top windows make the hooks |
| `avoid` | windows around a lost ship, a lesson hold, or a lull with no kill |

`--rank` scores several takes against the criteria in §3.3.

### 3.5 Editor (`scripts/play/edit.js`, `npm run video -- youtube|short|x`)

Input is an edit list, one checked-in JSON file per video in `scripts/play/edits/`. Each entry is one of:
- a pick: `{ "pick": "bomb", "n": 1, "pad": [-1.5, 3] }`, resolved from `highlights.json`
- an explicit window: `{ "seg": "L3", "from": 812.4, "to": 820 }`
- a card: `{ "card": "end", "dur": 18 }`

An entry can also carry `caption`, `audio: "game" | "bed"`, and `fade`.

The editor writes the resolved list next to the output, so picks can be reviewed and then pinned to explicit times.

1. **Cards and captions** are HTML rendered to transparent PNGs by headless Chrome (`playwright-core` is already a
   dependency), styled like the game: mono, letter-spaced, cyan glow. There's no font file to ship and no drawtext
   styling limits. They're overlaid with ffmpeg `overlay` and alpha fades. The title and end cards sit over the attract
   fly-by.
2. **Video.**
   - Cut each entry from its segment, frame-accurate (frame = (t − segment start) × 60).
   - Scale to the target and overlay its caption, giving intermediates with identical parameters, then concatenate.
   - Use hard cuts inside a chapter. Between chapters, use a dip to black or the game's own jump flash.
3. **Audio.**
   - `game` entries take the mix slice with a 0.3 s handle and crossfade at cuts (`acrossfade`). The video still cuts
     hard; the sound doesn't click.
   - `bed` entries take the `sfx.wav` slice under one continuous song, rendered by `__bg.renderMusic(name, seconds)`
     from the game's own song data.
   - Optional: snap montage cuts to the bed's beat (`bpm` in the song data).
   - Two-pass `loudnorm` to −14 LUFS and −1 dBTP, then upmix to stereo.
4. **Checks after every render.**
   - `ffprobe` against the target table in §2: size, fps, duration, codecs, file size.
   - Integrated loudness and true peak.
   - `analyze.js video`: flashes per second (see the risks) and motion.
   - A contact sheet, so the cut can be reviewed frame by frame.
5. **Text files.** The YouTube chapters are written from the edit list's chapter entries: 0:00 first, at least 3
   chapters, each 10 s or longer.

### 3.6 The three videos

Times are targets. The exact moments come from the take's highlights.

**YouTube, about 5:00.** Chapters in bold.

| Time | Chapter | What's on screen | Caption |
|---|---|---|---|
| 0:00–0:10 | **Intro** | Cold open: the 3–4 hottest moments (FULL spiral stream through a squadron, a bomb clearing a bullet curtain, boss parts going up, a roll through a flare) | — |
| 0:10–0:18 | | Title card over the attract fly-by | PILOT ONE · a 3D arcade shoot 'em up in your browser |
| 0:18–0:50 | **Fly the rail** | Carrier launch, location card, the first formations, free aim, the lead diamond, a red squadron giving a POW | FLY THE RAIL · AIM ANYWHERE |
| 0:50–1:20 | **Dodge and roll** | Danger markers, aimed fire dodged, an inverted wing matched by rolling, ALIGNED kills | RED RING: MOVE · ROLL TO MATCH THEIR WINGS |
| 1:20–1:50 | **Power** | Montage (music bed) of TWIN → QUAD → MISSILES → SPIRAL → FULL, then the laser | the level names |
| 1:50–2:15 | **Evade and bomb** | A barrel roll through a laser gate, missiles, the cruiser, a bomb shockwave | BARREL ROLL THROUGH · THE BOMB CLEARS BULLETS |
| 2:15–2:45 | **Mothership** | The fight, the kill, the landing on the carrier, the clear screen, the star map, the jump | — |
| 2:45–3:10 | **The Belt** | Ore haulers stripped, mass-driver boulders, the refinery, the Excavator | location name |
| 3:10–3:35 | **Crimson Nebula** | Fog, stray beams, lightning, cloaked wasps, the battleship, the Flagship | location name |
| 3:35–4:00 | **Frozen Moon** | Ice guns, the canyon, geysers, the cavern, the Fortress | location name |
| 4:00–4:30 | **The Corona** | Solar wind, a flare rolled through, mirror beams, the Dyson shell, the Gatekeeper, the Dreadnought | location name |
| 4:30–4:45 | **Score** | ×4 chain, medal ladder to 5,000, an S grade, name entry | CHAIN · MEDALS · HALL OF FAME |
| 4:45–5:05 | **Play** | End card over the fly-by, leaving room for YouTube's end-screen elements (5–20 s) | 5 LOCATIONS · 7 BOSSES · FREE IN YOUR BROWSER · CAN YOU STOP THE DREADNOUGHT? · URL |

Real-time stretches use the game mix. Montages (power, the cold open) use a music bed: L5's theme or the boss cue.

**Short, 35–45 s, vertical.** No title card; it opens on action. Captions stay inside the safe area, clear of the
top 12%, the bottom 20% and the right 12% (the Shorts buttons). The whole Short runs on one music bed.

| Time | What's on screen | Caption |
|---|---|---|
| 0–2 s | Hook: a dense bullet pattern, then an evasive roll through it | 3D SHMUP · IN YOUR BROWSER |
| 2–8 s | An inverted wing, matched by rolling, then aligned kills | ROLL TO MATCH |
| 8–16 s | Power up to SPIRAL/FULL, shredding a formation | |
| 16–24 s | A bomb clears the screen | |
| 24–36 s | Boss parts popping, the medal ladder climbing, the boss blowing up | |
| 36–40 s | Title and URL, then a cut that loops back into the opening frame | PILOT ONE · PLAY FREE |

**X, 40–45 s, 16:9.** Cut from the landscape master. The first frame is the hook, since it's what shows before
playback. There are captions on every beat.

| Time | What's on screen |
|---|---|
| 0–3 s | The biggest single moment, a bomb or a boss kill, with "a 3D arcade shmup in your browser" |
| 3–28 s | Five feature beats of about 5 s each: aim, roll to match, power, evasive roll, bomb |
| 28–38 s | The five locations, 2 s each, on one music bed |
| 38–45 s | End card with the URL |

### 3.7 Claims in captions

- **"Plays on phones"** is the spec's aim, but §14.8 says no real phone has been tested yet. Leave it out until one
  has.
- **"Loads in a second"** isn't measured: the slowest throttled load is 2.71 s. Use "no install" instead.
- **"7 bosses"** (cruiser, mothership, Excavator, Flagship, Fortress, Gatekeeper, Dreadnought) and **"5 locations,
  35 stages"** are from the data.

## 4. Steps

1. **Recorder groundwork** (§3.1, items 1–7).
   - Check sync: record from 1-8 with `--campaign --params stage=8` through the clear screen, the map and the jump into
     location 2, at `--max` 180 s. Audio onsets from `analyze.js video` should line up with telemetry kill times to
     within a frame on both sides of the holds.
   - Measure capture speed at 1280×720 with `--dpr 1.5` and `--dpr 2`, on the default GPU and with NVIDIA offload
     (`__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia`); `meta.gpu` shows which one ran.
     A campaign is about 144k frames. If 1440p takes over about 6 h, master at `--dpr 1.5` (1920×1080) and upload
     1080p instead.
2. **Determinism check** (§3.3.1).
3. **Showcase preset** (§3.2).
   - Tune on L1–L2 against the targets.
   - Re-run `--skill expert --no-video` on seed 1 to confirm the existing presets are unchanged (identical event stream).
4. **Highlights** (§3.4), including the medal value in the `pickup` event.
5. **Portrait check** before scouting: `npm run shots -- --size 540x960 --dpr 2 --at 5,40,90`, then look at the frames
   for HUD overlap and hints that only make sense on desktop. If portrait doesn't work with the desktop HUD, fall back
   to an 810×1440 centre crop of the landscape master, scaled to 1080×1920, and say so in `next_0.md`.
6. **Scout** both sizes and pick the takes. The landscape seed and take go in `next_0.md`.
7. **Shoot** the landscape master (overnight if needed) and the portrait locations.
8. **Editor and cards** (§3.5). Write the three edit lists from the highlights.
9. **Render, review, iterate.**
   - Read the contact sheets: no lost ship in a hook, captions readable and inside the safe areas, no lesson holds
     and no stretch longer than about 3 s with nothing on screen.
   - Pin the picks to explicit times.
   - Check §2's targets with the post-render checks.
10. **Package** the text files and the thumbnail.
11. **Docs.**
    - README: the new options, `npm run video`, and the scout → shoot → edit workflow.
    - `ai/summary.md` §11: add `edit.js`, the highlights subcommand and the showcase preset to the tooling table.
    - `ai/next_0.md`: what was done, the chosen take, the measured capture speed, and what's next.

## 5. Risks

| Risk | Answer |
|---|---|
| Capture is slow (headless Chrome may run on the Intel GPU) | NVIDIA offload, `--video-locs`, or 1080p masters; the scout is telemetry-only either way |
| Runs aren't deterministic | Shoot several seeds with video on and keep the best; scouting becomes a filter only |
| The showcase bot still loses ships in location 5 | Fine, and honest: location 5 is meant to be near impossible. The edit uses moments before the loss, and "Can you stop the Dreadnought?" turns it into the call to action |
| Flashes (explosions, the bomb) exceed about 3 per second in some windows | `analyze.js video` flags them. Re-shoot those windows with the reduce-flash option set through `localStorage` (`pilotone.v1`), or avoid them in the edit. It must be decided before scouting, as a re-shoot may change the run |
| The `high` tier looks better than most players' devices | It's the same game at its top setting, which is common practice; no caption claims otherwise |
| Platform limits change | §2's numbers come from third-party guides and X's API docs (Oct 2026). Check them in YouTube Studio and on X at upload |

## 6. Questions for you

1. **The URL** for the end cards and descriptions: the workers.dev address, a custom domain, or Maize.Live?
2. **Is the X account Premium?** If not, X plays 1080p uploads at 720p and caps length at 140 s. The plan already
   fits inside both limits.
3. **The `v.xxxx` version label:** hide it in the videos (`--clean`, the plan's default) or keep it?

## 7. Sources for the platform limits

- X API media best practices: https://docs.x.com/x-api/media/quickstart/best-practices.md
- X video specs summary: https://postfa.st/sizes/x/video
- YouTube Shorts length (3 min since October 2024): https://1of10.com/blog/how-long-can-youtube-shorts-be/
- YouTube Shorts specs summary: https://postfa.st/sizes/youtube/shorts/2025
