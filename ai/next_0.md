# Next 0: showcase recordings

Implementation of `ai/plan_0.md`. The first session built and tested the tooling and stopped at the usage limit. The
second session (Oct 28) shot the takes, cut the three videos and wrote down what the scout runs and the footage say
about the game (Gameplay and fun, below).

## Deliverables

In `recordings/videos/` (gitignored). Each video has a `.txt` with the upload text (title options, description with
chapters, tags or the post), a `.checks.json` and contact sheets in `.analysis/`. Every description says a bot played.

| File | Format | Length | Loudness | Notes |
|---|---|---|---|---|
| `pilot-one-youtube.mp4` | 2560×1440, 60 fps | 5:11 | −14.2 LUFS, true peak −4.1 dBTP | 877 MB; 12 chapters, 20 s end card for the end screen, thumbnail `pilot-one-youtube-thumb.jpg` |
| `pilot-one-short.mp4` | 1080×1920, 60 fps | 40.4 s | −14.3 LUFS, true peak −3.4 dBTP | ends on the Dreadnought going down |
| `pilot-one-x.mp4` | 1920×1080, 60 fps | 44.2 s | −14.2 LUFS, true peak −3.9 dBTP | 61.8 MB (X allows 512) |

All checks pass: size, fps, length, codecs, loudness, true peak, and at most 3 flashes in any second. The edit lists
are `scripts/play/edits/{youtube,short,x}.json`; `npm run video -- <name>` renders one again (29 min for YouTube on
this machine, 3 min for X).

## Takes

In `recordings/shoot/` (gitignored), all at `--q high --dpr 2 --master --clean` (`recordings/shoot/run.sh`):

- **Landscape: seed 7**, 1280×720 at 2× (a 2560×1440 master), the whole campaign: 138,414 frames, 38:27 of game time,
  4 h 14 min to shoot with its sound. It ranked first of 8 scout seeds (17 S grades, 12 ×4 chains, 9 bombs, 3 lost
  ships). The Dreadnought escapes.
- **Portrait: seed 4**, 540×960 at 2× (1080×1920), locations 2–5 filmed: 2 h 48 min. It's the only one of the 14 scout
  campaigns in which the Dreadnought dies, which gives the Short its ending. Location 1 isn't filmed because its lesson
  hints name keyboard keys.
- **Attract fly-bys**, 40 s at both sizes, under the cards.

Both takes replay their scout runs exactly: 10,229 of 10,229 events (landscape) and 9,801 of 9,801 (portrait), and
every segment has the scout's frame count. The scout rankings are `recordings/analysis/rank-1280x720.json` and
`rank-540x960.json`.

## Done

First session:

- **Plan updated** with the review findings (gaps 9–12, scout/shoot parity, URL p0.muon.day).
- **Capture-only game fixes:** the double-tap is timed on the game clock in `?capture` (`input.clock`); the star map
  doesn't launch itself; the clear screen's tally and grade animate on a UI clock (`setUiClock`).
- **Deterministic bot runs:** video and no-video runs give identical event streams across clears, the star map and
  location jumps; sound lines up with kills within 6 ms.
- **§12 baseline after the tap fix:** fewer free invulnerable rolls, so slightly more hits (now in `ai/summary.md`
  §12).
- **Recorder:** `--dpr`, holds that advance the clock in both modes, takes as folders with per-location segments and
  stems, `--video-locs`, `--attract`, `--clean`, `--master`, `--tune`, BT.709.
- **Offline audio** in ~1 s chunks: 8× faster.
- **Showcase bot** (`--skill showcase`): slower, smoother aim (p90 0.69 vs 0.95 rad/s) with the expert's results;
  `average` and `expert` unchanged.
- **`analyze.js highlights`** (tags, windows to avoid, `--rank`) and `flashMax1s`; **`edit.js`** (`npm run video`).

Second session:

- **Faster shoot:** the master is encoded with x264 `veryfast` (`record.js`). With `medium`, x264 at 1440p kept 5
  cores busy while the GPU sat at 28%: 275 ms a frame (landscape) and 173 ms (portrait) with both shooting at once,
  87 and 70 ms after.
- **Loudness:** gain to −14 LUFS and a 4× oversampled limiter at −2 dBFS, measured twice, instead of `loudnorm`. The
  game's peaks sit far above its loudness, so `loudnorm`'s linear mode fell back to dynamic and missed by 1–2 LU.
- **Captions and cards:** `"pos": "raised"` clears the game's hint line; portrait captions sit top right at 25 px, so
  they stay clear of the Shorts UI, and the portrait card text is larger.
- **`highlights --rank`** writes one file per take size, so the portrait ranking doesn't overwrite the landscape one.
- **Edit rules** learned from the footage: no captions that repeat the game's own banners (power levels, location
  names, boss warnings); no clips over a hit or a lost ship (the highlights' avoid windows); hulks and the cavern
  bomb only where they read.
- **Docs:** README "Showcase videos" (scout → rank → shoot → cut); `ai/summary.md` §4.3 (the escape ending), §7.3,
  §11, §12, §14.

## Gameplay and fun: what to improve

From the 14 scout campaigns (showcase bot, seeds 1–8 at 1280×720 and 1–6 at 540×960), the re-measured
average/expert baseline, and watching the two takes frame by frame. The bot isn't a person (§11): treat these as
the leads for the next playtest (§14.1), most important first.

1. **The lull filler never fires: a bug.** `game.js` `director()` skips it when `st.stageEnding`, which is true for
   the whole of a stage's last section, and most stages have one section. In a whole campaign it fires 5 times
   outside boss fights, each in the first frame of a boss section. It was meant to skip only the tally: use
   `!(st.stageEnding && st.remaining <= TRANSIT)`, as the tally check does (`game.js:524`), then re-measure the
   longest gap with no kill (§12: target ≤ 12 s, now 18–33 s in most sections of locations 1–4).
2. **Empty screens.** No enemy on screen in 35% (L1), 41% (L2), 50% (L3) and 50% (L4) of the samples, against 27%
   in L5. The worst sections are the hazard ones: geysers 65%, storm 62%, battleship 61%, plains 61%, fleet 52%,
   canyon 51%. Waves run on fixed timelines, so a good player clears a wave in 1–2 s and then waits. Pull the
   section's wave clock forward when the screen has been empty for about a second (capped per wave), so killing
   fast brings the next wave sooner. In hazard sections, add waves on top of the hazard rather than leaving it
   alone on screen.
3. **Little to dodge from enemies.** Enemy bullets on screen average 0.2–0.9 in L1–L4 with the showcase bot and
   0.4–1.4 with the average bot. The §12 target for L1 is 1.5–3. In L1 a red danger ring shows up about 10 times
   outside the lessons: the dodge is taught, then hardly used. Of 315 hits over 14 runs, 42 were enemy bullets; the
   rest were beams (150), lightning (49), flares (43) and geysers (26). Give L2–L4 squadrons more readable aimed
   fire and spreads, with the markers doing their job, instead of leaving all the danger to hazards.
4. **Power is maxed four minutes in.** The bot reaches FULL at 4:14 and holds SPIRAL or FULL for 93–100% of L2–L4.
   After that a POW is only 5,000 points, so there's nothing left to chase. Ideas: extra POWs fill an overdrive
   gauge for a short burst on demand, or bank toward a bomb; or a hit (not only a lost ship) costs a level.
5. **The medal ladder tops out after six catches** (100 → 5,000) and stays there: 125–138 medals per run, 7–17
   missed, almost all at 5,000. Keep it climbing past 5,000 (or multiply by the streak). A miss is silent now (the
   value just drops back to 100): make it loud.
6. **Bosses.**
   - L2–L4 bosses die in 24–41 s in every run, with no lost ship: no threat.
   - The Gatekeeper escapes in 14 of 14 runs with 0–2 of its 6 turrets down. Check with people whether the turrets
     can be read and hit while the ring turns.
   - The Dreadnought escapes in 13 of 14 runs (418–2,604 hp left). The time limit is invisible (there's no timer
     in the HUD), so the fight is a damage race the player doesn't know they're in, and a run that has gone well
     for 38 minutes ends on the escape screen and the game-over music. Show the time left, and say on the escape
     screen how close it was ("it got away with 22% of its hull").
7. **Big moments are undersold.**
   - Hulks stay far away: the refinery never shows as more than a "+5000" popup; one ore hauler of three passes
     close, and that one looks great.
   - Boss deaths are small: the Fortress goes with an explosion the size of a formation kill. "DREADNOUGHT
     DESTROYED" (a big ring and a white-out) is the treatment every boss death should get.
   - The Dreadnought is about the Flagship's size: the last boss should look like the biggest thing in the game.
8. **Readability.**
   - At FULL the player's own bolt spray fills the middle of the screen and hides the targets. Thinner or dimmer
     bolts at FULL, or a brighter enemy rim through your own fire.
   - Boss fights stack pickup rings, amber and red danger rings and the cyan hitbox ring, all large. Make the
     pickup rings smaller or thinner than the danger rings, so red always wins.
   - Banners pile up: the LASER pickup banner over the CRUISER stage card; hint lines that linger at the bottom.
9. **Rewards arrive late.** In L1 a POW reaches the ship 9–17 s after its red squadron dies. Pull it in sooner (a
   magnet that starts at the drop), so the reward lands while the kill is still fresh.
10. **Every run is 40 minutes from 1-1, with an 8-minute tutorial.** Done lessons skip their holds, but location 1
    still takes 8 minutes. For returning players: a shorter location 1 once the lessons are done, or a practice
    start at a location already reached (scored apart from the hall of fame).
11. **Location 5 is the template.** Its sections score best on every measure (27% empty, 3.3 enemy bullets on
    average, 90–150 kills a minute in heliopause, wind and road), and its footage is the best: flares and mirror
    beams as golden bars across the screen with the red ring on the ship, the shell plates, the bomb's cyan ring.
    Items 1–3 are about bringing that density to locations 1–4.

The bot also timed out of three location 1 lessons (aimed fire 24 s, roll 21 s, laser 21.5 s). That may be the
bot; check it with people.

## Next

1. **Fix the lull filler** (item 1, one condition) and re-measure the §12 gaps with the average and expert bots.
   Then try the wave clock (item 2) and see how much of the empty-screen time it takes back.
2. **Playtest with people** (§14.1), adding: the Gatekeeper's turrets, the three lessons the bot timed out of, and
   whether anything is left to chase once power is full.
3. **Upload** (not done: yours to post). YouTube: pick a title from the `.txt`, put the end-screen elements over the
   last 20 s (the card keeps to the upper half), set the thumbnail. Check the platform numbers at upload.
4. **Re-shooting after game changes** costs about 7 h of machine time for both takes (scouts, then 4 h landscape and
   3 h portrait on the GTX 1050). The edit lists pin game times, so a new take needs new picks: run `highlights`,
   then fix the times against the contact sheets. The tags carry over.
