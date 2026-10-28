# Plan 1: scarce power, fuller screens

Answers `ai/prompt_1.md`:

> 1. Update the gameplay according to ai/next_0.md
> 2. losing a ship needs to mean something and it's ok if the ship has no full power for a while.
>     - full power is too strong: enemy ships are eliminated without even the player aware of them
>     - so we want the player to work for full power

Power follows one simple rule: each POW adds a level until FULL, and a lost ship drops you back to SINGLE. The only
balance knob is how many POWs the player can get (§2.1).

## 0. What this means

- **Part 1** covers `ai/next_0.md` "Gameplay and fun" items 1–11 and its Next item 1: the lull filler and the wave
  clock. Uploading and re-shooting the videos (Next 3–4) aren't gameplay, so they're out. The playtest with people
  (Next 2) stays open, and §2.8 adds to its list.
- **Part 2 reverses a decision from iteration 4.** The wreck POWs in §6.1 and two §12 targets ("back to QUAD after a
  lost ship ≤ 30 s", "expert within 15 points after its first lost ship") were there to make a lost ship cheap. This
  plan removes the wreck POWs and replaces the two targets (§2.1, §3). The supply gunship stays (§6, question 1).
- **Item 4 (nothing to chase once power is full)** is mostly answered by part 2. Once FULL is rare and a lost ship
  takes it away, getting it back is what you chase.
- **Item 10 (a shorter location 1, or a practice start)** would change §4.4's "no stage or location select". It's a
  question (§6), and it's left out by default.

## 1. Where things stand

Read from the code, alongside next_0's measurements.

**Power**
- **The rule is already one POW per level,** and a lost ship already drops you to SINGLE. The POW lesson says so: "Each
  POW adds guns. Lose a ship and you are back to one". Five POWs take SINGLE to FULL.
- **POW sources per location:**

  | Location | Red squadrons | Gunships and hulks with `drop: 'pow'` | Boss and hulk `drops` | Total |
  |---|---|---|---|---|
  | 1 | 10 | 2 | cruiser, mothership | 14 |
  | 2 | 6 | 3 | boss | 10 |
  | 3 | 7 | 2 | battleship, boss | 11 |
  | 4 | 6 | 3 | boss | 10 |
  | 5 | 9 | 0 | Gatekeeper | 10 |

  That's 55 in a campaign (location 5's nine are the fast red squadrons, `...redFast`). Location 1 alone gives almost three times what FULL needs, which is why the bot is at FULL
  at 4:14.
- **What a lost ship costs** (`Player.die`, `Game.onRespawn`): the ship drops to SINGLE, then `ceil(lost / 2)` wreck
  POWs (3 from FULL) wait ahead with a wider magnet. That's QUAD again within seconds, plus the supply gunship after
  15 s. A continue gets the same POWs. A ship lost at FULL costs about 10–30 s of lower power.
- **Kills you don't see:**
  - `missileTargets(2)` takes any enemy on screen, nearest the crosshair first. At FULL it fires every 0.7 s, for 3
    damage (darts have 1 hp, wasps 3). Missiles kill ships far from where you're aiming.
  - FULL adds more streams the player isn't aiming: the drone bolts, the cone from just outside the drones, and the
    lock homing.

  This plan doesn't weaken FULL. It makes FULL rare, and a lost ship takes it away.
- **A POW at FULL** is worth 5,000 points and nothing else.

**Pacing**
- **The lull filler** in `Game.director()` checks `!st.stageEnding`, so it never runs in a stage's last section,
  which for most stages is the only section.
- **The density floor** (`WaveRunner.update`) runs the clock 4× when `enemies.alive + (boss ? 6 : 0) < minAlive`.
  But `alive` is the length of the list, which includes ships off screen, behind you or far away. The floor also
  stops once a section's waves are used up, and the empty tail of the section stays empty.

**Fire.** Location 2–4 ramps have `fire` 0.7–1.0, and locations 2–3 have no bullet cap. Location 5's ramp `R(k)`
has fire 1.1–1.5, rate 1.15–1.6 and `minAlive` 6.

**Bosses**
- `timeLimit` isn't shown anywhere.
- `endGame(false)` doesn't pass on how much hull the Dreadnought had left.
- Boss deaths use `bigExplosion(def.boom)` with `boom` 3–5. The Dreadnought gets 7.

**Hulks.** Haulers fly at x = ±88 and the refinery at ±92. The play box is 28 wide on each side of the rail.

**Medals**
- `MEDALS` has six steps.
- A missed medal sets `medalIdx = 0` and logs a telemetry event. Nothing is seen or heard.

**Budget.** The initial JS is 245.2 KB of 250 KB gzip, so there's 4.8 KB left. Almost everything below is in the
initial chunk: `game.js`, `player.js`, `enemies.js`, `waves.js`, `bosses.js`, `danger.js`, `hud.js`, `index.html`
and location 1's data.

## 2. Design

### 2.1 Scarce power (prompt part 2; items 4, 9)

1. **One POW, one level,** as now: SINGLE → TWIN → QUAD → MISSILES → SPIRAL → FULL. The weapons stay as they are.
2. **A lost ship is back to SINGLE, with nothing given back.**
   - **No wreck POWs.** `onRespawn` stops spawning them, and the "N POWs from the wreck" hint goes.
   - **A continue** starts at SINGLE too. Today it hands out the wreck POWs.
   - **The supply gunship stays:** at TWIN or lower 15 s after a respawn, one gunship with one POW, so you're at TWIN
     about 20 s after a respawn. It counts as a POW source (question 1).
3. **Fewer POWs: the one balance knob.** Starting values:

   | Location | 1 | 2 | 3 | 4 | 5 | Campaign |
   |---|---|---|---|---|---|---|
   | POWs now | 14 | 10 | 11 | 10 | 10 | 55 |
   | POWs, plan | 3 | 3 | 3 | 3 | 2 | 14 |

   - **Every POW is earned.** The sources that stay are red squadrons (all five shot down) and gunships with
     `drop: 'pow'`. The other red squadrons fly as plain squadrons. `drop: 'pow'` comes off the hulk waves, and
     `'pow'` comes off the boss and hulk `drops` lists, which keep their shields and bombs. Location 5 keeps two of
     its fast red squadrons; the Gatekeeper drops a bomb instead.
   - **Spread through each location:** one early, one in the middle, one late. A ship lost in the middle of a
     location still has a POW or two ahead.
   - **Location 1:** the POW lesson's practice squadron flies up to three times (the lesson's repeats), so almost
     every player reaches TWIN. The other two are in the middle and near the end.
   - **What the counts give.** With every POW caught and no ship lost, you leave location 1 at MISSILES and reach FULL
     at location 2's second POW, about 12–14 min into the run. A ship lost at FULL drops you to SINGLE, the supply
     gunship gives TWIN, and the 4 POWs to FULL take the rest of that location and some of the next. That's the "no
     full power for a while". In location 5, a lost ship means no FULL again.
   - **Tuning:** the counts move one POW at a time against the targets in §3. If a location is a wall (shoot-down
     ratio under target), it gets a POW more. If FULL comes too early or lasts too long, it gets one less.
4. **A POW comes to you (item 9).** 0.4 s after it drops, a POW homes on the ship while you're alive and arrives
   within about 2 s. With so few POWs, losing one to its drift would be a big loss that has nothing to do with the
   fight. Homing makes the count exact: the POWs you earn are the POWs you get. Medals keep drifting: catching them is
   how the ladder works.
5. **A POW at FULL** stays at 5,000 points.
6. **Bosses were tuned for a ship at full power** ("later bosses meet a fully powered ship", `hpScale` 1.6–4). They
   get re-tuned after this change (§2.4).
7. **Telemetry** (only adds fields, so a run's events don't change):
   - `drop` events carry `src` (red, gunship, supply), so the analyzer can count the POWs offered, dropped and caught
     in each location.
   - `award()` logs extra ships.

next_0 item 4 also floated an overdrive gauge and losing a level per hit. Neither is planned: the rule stays one POW
per level, and only a lost ship costs power.

### 2.2 Pacing (items 1, 2)

1. **Fix the lull filler.**
   - In `director()`, `!st.stageEnding` becomes `!(st.stageEnding && st.remaining <= TRANSIT)`, the same test the
     tally uses.
   - It still never runs during lessons, the landing or boss fights.
2. **The density floor counts what you can see.**
   - `Enemies.update` already projects ships that haven't been counted yet (`seen`). Now it counts every ship that's
     on screen and ahead of you within `ENGAGE_RANGE`, into `visible`.
   - Live hulk parts and an active boss count too.
   - `WaveRunner` uses `visible` instead of `alive`.
3. **An empty screen brings the next wave.**
   - After 1.0 s with nothing visible, the wave clock jumps to the next wave's `at`.
   - A wave never comes more than 6 s before its authored time.
   - The jump never passes a lesson gate (`tutor.holding`), and never happens in a dock section.
   - Each jump logs a `pull` telemetry event.
   - Once a section's waves are used up, the fixed lull filler covers the rest.
4. **Waves on top of the hazards.**
   - The sections: `fleet`, `storm` and `battleship` in `nebula.js`; `plains`, `canyon` and `geysers` in
     `frozen-moon.js`. These are the emptiest sections, at 51–65% of samples.
   - Location 5's heliopause and wind are the template.
   - Each section gets 3–5 waves in the gaps between the hazard's pulses, in the lanes the hazard leaves open:
     - geysers: waves high, over the free columns
     - canyon: snakes and dives along it, no walls, since its play box is 16 wide
     - storm: waves away from the lightning's telegraphed volumes
   - The new waves don't carry POWs: the counts in §2.1.3 stay as they are.

### 2.3 Fire to dodge (item 3)

1. **Ramps.**
   - Locations 2–4 move `fire` and `rate` toward location 5's (fire about 1.0–1.3).
   - Location 1's stages 4–8 go up one step.
   - Stages 1–3 stay as they are: they're the dodge and roll lessons, and new players must still pass location 1
     easily (§4.1).
2. **More readable shooters in the waves.**
   - More wasps (`spread3`), and a `fan5` gunship in most stages.
   - A new dart weapon, `burst3`: three aimed bullets 0.12 s apart on one line. It's medium class, under the same
     escape rule (`enemyCanFire`). It reads as a stream, and you dodge it by moving, which is the dodge the red
     marker teaches.
3. **Bullet caps.** Location 2 gets a cap of 10 and location 3 a cap of 12 (location 4 stays at 12, location 5 at
   18), so a dense wave can't become a curtain.
4. **Feeders** fire at half rate from location 2 (today: from location 3).

### 2.4 Bosses (item 6)

1. **Time left on the boss bar,** for every boss, since any of them can escape: a thin strip under the hp bar that
   drains. Digits show in the last 15 s, with a warning tick at 10 s.
2. **An escape says how close it was.**
   - The banner: "FLAGSHIP ESCAPED · 31% HULL".
   - The ending: "THE DREADNOUGHT ESCAPED", then "it got away with 22% of its hull". `onBossDone` passes the hull
     fraction to `endGame`.
3. **Location 2–4 bosses**, re-tuned once the power change is in:
   - `hpScale`, so the expert takes 35–55 s of the 64 s.
   - Each boss's phase 2 gets aimed spreads under the cap, so the fight takes hits.
4. **The Gatekeeper.** Live turrets get a warm beacon, like far enemies, so they read while the ring turns. Measure
   turrets down per fight. Whether the spin needs slowing is for the playtest.
5. **The Dreadnought.** Re-tune `hpScale` and `bossTime` for the new power curve against the target in §3.

### 2.5 Score (item 5)

- **The ladder** goes 100, 200, 500, 1,000, 2,000, 5,000, then +1,000 for each catch up to 10,000.
- **A missed medal is loud:**
  - a falling two-note sound
  - the HUD's medal value flashes red with "MEDAL LOST"
  - a one-time tip the first time it happens
- **Extra ships.** Higher medals mean higher scores, which means more extra ships, and that works against part 2.
  Compare extra ships per campaign with the baseline, and raise `EXTRA_LIVES` if there are more.

### 2.6 Big moments (item 7)

1. **Hulks pass closer.**
   - Haulers at ±55 instead of ±88, the refinery at ±60 instead of ±92.
   - Hull spheres stay at least 12 units outside the play box.
   - Check the battleship and the mass drivers too.
2. **Every boss death gets the Dreadnought's treatment.**
   - One shared ending in `Boss` `dying`: about 3 s of explosions chained across the hull, then the final blast with
     a ring the size of the boss, and a white-out (halved with reduce flash).
   - `boom` by rank: cruiser 4, mothership and the location bosses 6, Gatekeeper 6, Dreadnought 8.
   - It must stay within 3 flashes per second (`analyze.js video`'s `flashMax1s`).
3. **The biggest thing in the game.**
   - The Dreadnought goes from `scale` 1.45 to about 2.2, held farther back so it fills the view without crowding the
     corridor.
   - `hullR` is in world units, so it's scaled by hand.
   - Check that every part can still be hit, the ram radius, and the danger markers on its fire.

### 2.7 Readability (item 8)

1. **Your own fire at FULL:** the cone and the drone bolts are drawn thinner and dimmer than the main stream, so they
   stop hiding the targets. This only changes how they look: their damage stays.
2. **Pickup rings:**
   - The cyan catch rings get smaller and thinner than the danger rings, and are drawn under them (`danger.js`), so
     red always wins.
   - POWs now come to you (§2.1.4), so most catch rings belong to medals.
3. **One banner at a time, by priority:** location card > stage card > boss warning > pickup banner.
   - A pickup during a card shows as a popup at the ship, not a banner.
   - A new stage card clears the hint line.

### 2.8 Not in this plan

- **Item 10:** see §6.
- **Re-shooting the showcase videos:**
  - The game changes under them.
  - It costs about 7 h of machine time.
  - The edit lists' times have to be picked again.
  - It goes into `next_1.md`.
- **For the playtest with people (§14.1):**
  - Does a lost ship feel like a loss without feeling like the run is over?
  - Is FULL worth the climb?
  - Does location 1 still feel like the guns grow, with 3 POWs?
  - The boss timer.
  - The loud medal miss.
  - The Gatekeeper's turrets.
  - The three location 1 lessons the bot timed out of.

## 3. Targets

The new and changed §12 rows. Measured with the bots (§11), with seeds and settings as in §4 step 0.

| Measure | Target | Now |
|---|---|---|
| First FULL, expert and showcase, no ship lost | 11–16 min into the run (location 2) | 4:14 (location 1) |
| First FULL, average bot | location 3 or later | baseline from step 0 |
| Time at FULL in locations 2–4 | showcase 30–60%, average ≤ 20% | showcase 93–100% at SPIRAL or FULL |
| After a ship lost at FULL: back to FULL, median | ≥ 5 min | under 30 s to QUAD (replaces "≤ 30 s") |
| POW drop to pickup | ≤ 3 s | 9–17 s in location 1 |
| Shoot-down ratio, locations 1–4 | average ≥ 70%, expert ≥ 85% (unchanged) | 69–89%, 84–93% |
| Expert after its first lost ship | ≥ 75% shoot-down | 88–95% (replaces "within 15 points") |
| Longest gap with no kill | ≤ 12 s (unchanged) | 15–31 s |
| No enemy on screen, locations 1–4 | ≤ 30% of samples, no section over 40% | 35–50%; hazard sections 51–65% |
| Enemy bullets on screen, location 1 stages 4–8 | mean 1.5–3, p90 ≤ 6 (the existing location 1 target) | 0.2–0.9 |
| Enemy bullets on screen, locations 2–4 | mean 2–4, p90 ≤ 8 | 0.2–0.9 |
| Share of hits from enemy fire (bullets, shells, missiles), locations 2–4 | ≥ 30% | 13% (42 of 315, all locations) |
| Hits warned and visible | ≥ 95% (unchanged) | 87–100% in location 5 |
| Location 2–4 boss fight, expert | 35–55 s | 24–41 s |
| Location 2–4 boss fights, average bot | a lost ship in at least 1 of the 3 | none |
| Dreadnought, showcase, 8 campaigns | destroyed in 1–3 | 1 of 14 |
| Extra ships per campaign | no more than the baseline | baseline from step 0 |

## 4. Steps

Every step is measured before the next one starts. Bot runs depend only on seed, size, `--q` and holds, so before
and after compare run for run.

0. **Measure first.**
   - **Telemetry fields** (§2.1.7). They only add fields: a run with them must give the same kill times as one
     without.
   - **`analyze.js telemetry` additions:**
     - share of samples with no enemy on screen, per stage, section and location
     - time to each power level, and the share of time at each level per location
     - time to win back the level held before each lost ship
     - POWs offered, dropped and caught per location, by source
     - time from POW drop to pickup
     - boss fight time and hull left
     - extra ships
     - wave pulls
   - **Baseline:**
     - average and expert: seeds 1–3, `--campaign --no-video --q medium`
     - showcase: seeds 1–8, `--campaign --no-video --q high` at 1280×720, as next_0's scouts were run
1. **Pacing** (§2.2).
   - Lull fix, then `visible`, then the empty-screen pull, then the hazard waves.
   - Re-measure the no-kill gaps and the empty share after each one.
2. **Power** (§2.1).
   - Wreck POWs out, the continue at SINGLE, then the POW homing.
   - Cut each location's sources to the starting counts, spread early, middle and late.
   - Move the counts one POW at a time against the first-FULL, time-at-FULL and back-to-FULL targets, keeping the
     shoot-down ratios.
3. **Fire** (§2.3). Ramps first, then `burst3` and the wave edits, then caps. Check bullets on screen, hits by
   source and that hits stay fair. Then re-check the shoot-down ratios; if they fall short, the location gets a POW
   more (§2.1.3) before anything else changes.
4. **Bosses** (§2.4).
   - Timer and escape text.
   - Re-tune the location 2–4 bosses.
   - Gatekeeper beacons.
   - Dreadnought: the 8 showcase campaigns again.
5. **Score** (§2.5). The ladder, the loud miss, then extra ships against the baseline.
6. **Big moments and readability** (§2.6, §2.7). Check them in `npm run shots` frames and a short recording of each
   boss death (`analyze.js video --sheet`, flashes per second).
7. **Budgets** (§2):
   - `npm run build` (`check-budget.js`)
   - `npm run loadtime` (≤ 3 s)
   - `npm run perf` (no worse than 10% below 103.7 fps; the busiest stages now have more enemies and bullets)
   - `npm run probe` (the volley rule still holds with the thinner FULL streams)
8. **Docs.**
   - `ai/summary.md`:
     - §6.1 (one POW a level, back to SINGLE with no wreck POWs, the POWs in each location)
     - §6.3 (the ladder, the loud miss)
     - §7.2 (ramps and caps)
     - §7.3 (the lull filler is fixed; the wave pull)
     - §12 (§3's rows)
     - §14 (remove items 2, 4, 9 and 10 as they're done)
   - README "Weapons" and "The campaign" (score).
   - `ai/next_1.md`.

## 5. Risks

| Risk | Answer |
|---|---|
| Less power makes locations 3–4 a wall for average players | The average shoot-down target stays at ≥ 70%. A location that misses it gets a POW more: the counts are the power knob. Enemy `hpMul` only if a POW more brings FULL too early |
| A new player spends location 1 at SINGLE and TWIN | The practice squadron guarantees TWIN; the other two POWs give QUAD and MISSILES by the end. The average bot's location 1 ratio is checked, and the playtest asks (§2.8) |
| A lost ship in location 5 ends any chance at the Dreadnought | Location 5 gives at most 2 POWs plus the supply gunship: MISSILES at best after a lost ship. Intended near-impossible (§4.2). Lever: a third POW there |
| The wave pull makes play depend more on the viewport (`visible` uses the screen) | Already true through the size floor (plan_0 gap 7). Scouts and shoots keep the same size |
| Pulled waves land on authored set pieces (a hulk pass, a hazard pulse) | The 6 s cap per wave; hazard and hulk entries move with the clock, so their spacing stays |
| The initial JS goes over 250 KB (4.8 KB left) | The power change removes code (the wreck POWs) and adds only the homing. Keep the rest small. If it doesn't fit, move the boss-death ending and the escape text into location chunks. `check-budget.js` fails the build, so it can't go out by accident |
| Bigger boss deaths break the flash limit | `flashMax1s` on a recording of each boss death; reduce flash halves the white-out |
| Higher medals give more extra ships | Compare with the baseline; raise `EXTRA_LIVES` |
| The bot isn't a person (§11) | The targets steer the tuning; the playtest list (§2.8) decides how it feels |

## 6. Questions for you

1. **The supply gunship after a lost ship: keep it (default), or remove it?** Keeping it gives one POW back, so
   you're at TWIN about 20 s after a respawn. Removing it means SINGLE until the next POW you earn, which can be
   minutes away.
2. **Item 10, for returning players:** leave it out (default), a faster location 1 once every lesson is done, or a
   practice start at a location already reached, scored apart from the hall of fame? The last two change §4.4.
