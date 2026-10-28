# Next 1: scarce power, fuller screens

Implementation of `ai/plan_1.md`, as updated: power follows one rule, each POW adds a level until FULL and a lost
ship drops you back to SINGLE, and the only balance knob is how many POWs there are. Part 1, `ai/next_0.md`'s
gameplay items, is in too. Nothing is committed.

## Measured

Fourteen whole campaigns, each before and after: the showcase bot on seeds 1–8 at `--q high`, the average and expert
bots on seeds 1–3 at `--q medium`, all 1280×720. `npm run analyze -- campaign <takes>` prints the table. The takes
are in `recordings/p1/` (`base`, `final2`; `final4` is the showcase rerun after the last Dreadnought change), and the
summaries are in `recordings/analysis/*.campaign.json`.

| Measure | Target | Before | After |
|---|---|---|---|
| First FULL, no ship lost | 11–16 min | 4:13–4:27 | 13.5–15.7 min |
| Time at FULL, locations 2–4 | showcase 30–60%, average ≤ 20% | 84–100% | showcase 47% (15–74%), average 19–20%, expert 75% |
| Back to FULL after a ship lost at FULL | ≥ 5 min | 6 s to 3 min | 7.8–9.4 min, or never in that run |
| POW drop to pickup | ≤ 3 s | 9–17 s | 1.7 s |
| Longest gap with no kill, locations 2–4 | ≤ 12 s | 20–33 s | 9–15 s at FULL, up to 32 s below it |
| No enemy on screen, locations 1–4 | ≤ 30%, no section over 40% | 31–53%, hazard sections 51–65% | L1 23–30%, L2–4 16–46%, worst sections 37–43% |
| Enemy bullets on screen, locations 2–4 | 2–4 | 0.2–0.9 | 1.9–2.9 below FULL, 0.4–1.3 at FULL |
| Enemy bullets on screen, location 1 stages 4–8 | 1.5–3 | 0.3–0.9 | 1.1–2.0 |
| Hits from enemy fire, locations 2–4 | ≥ 30% | 6% | 15% |
| Hits warned and visible | ≥ 95% | 98% | 93% |
| Location 2–4 bosses, expert | 35–55 s | 25–32 s | 33–37 s; below FULL the Flagship and Fortress escape |
| Shoot-down ratio, average / expert, L1–4 | ≥ 70% / ≥ 85% | 89–100% / 92–100% | 68–96% / L1 78–81%, L2–4 97–100% |
| Dreadnought, showcase | destroyed in 1–3 of 8 | 0 of 8 | 3 of 8; two more escape with 3% and 6% left |
| Extra ships | no more than before | 6 | 5–6 |

What the numbers say:

- **Power works the way prompt_1 asked.** FULL takes 13–16 minutes to earn. A ship lost at FULL means at least 8
  minutes without it, and usually the rest of the run. Runs that lose a ship in locations 3–4 get what next_0 asked
  for there: 2–3 enemy bullets on screen, a quarter of the time empty, and bosses that escape.
- **A run that loses nothing still holds FULL from about 14 minutes on.** The expert lost no ship in locations 1–4,
  and neither did half of the showcase runs. At FULL the screens are emptier (about 40%) and enemies die before they
  fire. That's the remaining gap against the targets, and it's a question of threat at FULL, not of POWs.
- **Location 1 is harder to grade well:** the expert shoots down 78–81% there (was 92%), because the tutorial is flown
  at SINGLE to QUAD.

## Done

**Power** (`ai/summary.md` §6.1)
- One POW per level, as before. A lost ship drops you to SINGLE with nothing given back: the wreck POWs are gone, and
  a continue starts at SINGLE too. The supply gunship stays (one POW, 15 s after a respawn at TWIN or lower).
- **POWs per location:** 2 in location 1, 3 in each of locations 2–4, 2 in location 5. Before: 14, 10, 11, 10 and 10
  (55 in all, location 5's nine fast red squadrons included). All are red squadrons now, spread through each
  location; bosses and hulks drop shields and bombs instead. Location 1 started at 3 (the plan's value) and went to
  2 after the first round: a run with no lost ship reached FULL at 11 minutes and held it for 87% of locations 2–4.
- A POW homes on the ship 0.4 s after it drops and arrives in about 2 s, so a scarce POW is never lost to its drift.
- At FULL the cone and the drone bolts are drawn thin and dim (looks only).

**Pacing** (§7.3)
- The lull filler is fixed (`!(st.stageEnding && st.remaining <= TRANSIT)`). It now fires after 6 s with no kill and
  fewer than 4 targets in view.
- The density director counts what's in view (`Enemies.visible`, hulk parts, a boss). After 1 s with nothing in view
  the wave clock jumps to the next wave, up to 10 s early (the plan said 6; 10 after round 1), never past a lesson,
  hint or message. Each jump logs a `pull` event, 28–49 per campaign.
- 4–5 more waves in each of the six hazard sections. Their empty share went from 51–66% to 32–41%.

**Fire** (§7.2)
- Location 2–4 ramps: `fire` +0.3 (up to 1.3), `rate` +0.15, `maxCharging` +1. Location 1's stages 4–8: +0.1 / +0.05.
- `burst3`: three aimed bullets 0.12 s apart on one line, for the darts in V formations in locations 2–4 (23 waves).
- Bullet caps: location 2 10, location 3 12. Feeders fire (at half rate) from location 2.
- Not done: more wasps and a `fan5` gunship in most stages. The bullets on screen depend on the player's power far
  more than on the waves.

**Bosses** (§7.3)
- A time strip under the boss bar; the seconds in the last 15 ("ESCAPES IN 9"), and a warning beep at 10.
- The escape banner says the hull left ("FLAGSHIP ESCAPED / 42% HULL LEFT"), and so does the ending ("It got away
  with 22% of its hull").
- Location 2–4 bosses: `hpScale` ×1.35 (Excavator 3.4, Flagship 3.1, Fortress 3.2), and an aimed three-way spread
  from the core every 2.4–2.6 s.
- The Gatekeeper's turrets carry warm beacons. It still escapes every time with 90–100% of its hull (§14).
- The Dreadnought: `scale` 2.2 (was 1.45), held at z −270, `hullR` 21; `hpScale` 1.55 (was 4) for the lower power
  in location 5. Since runs replay exactly up to its fight, the last rounds compare cleanly: 1.2 gave 7 of 8
  showcase kills, 1.4 gave 5, 1.55 gives 3.

**Score** (§6.3)
- Medals climb 100 … 5,000, then +1,000 per catch to 10,000.
- A missed medal is loud: two falling notes (`Sfx.medalLost`), "MEDAL LOST" flashing red, a tip the first time.
- Extra ships: 5–6 per campaign, as before (6). `EXTRA_LIVES` unchanged.

**Big moments and readability** (§7.3, §7.4)
- Haulers at x ±58 (yaw ±0.12), the refinery at ±64, mass drivers at ±60, the battleship at 52: every hull sphere at
  least 12 units outside the play box.
- Every boss dies the same way: 3 s of explosions chained across the hull, then the final blast, a ring the size of
  the boss and a white-out. `boom` 4 for the cruiser, 6 for the mothership and every other boss, 8 for the
  Dreadnought.
- Catch rings are smaller and fainter, drawn under the danger rings; POWs have none.
- One banner at a time: a pickup's banner gives way to the location and stage cards and to a warning, and shows as a
  popup at the ship instead. A new stage clears the hint line.

**Telemetry and tools**
- Events: `drop` carries `src` (red, gunship, supply, hulk, boss), plus `extra`, `pull` and `medalmiss.lost`; the
  boss escape event carries `max`, and `end` carries `hull`.
- `analyze.js campaign <takes>`: one row per campaign, boss fights and the emptiest sections.

**Found and fixed on the way:** the first version of the boss death shook the camera on each random explosion. The
bot sees through the camera, so same-seed runs diverged a few seconds after the first boss died. That would have
broken the scout and shoot replay that the showcase videos depend on (`ai/plan_0.md` §3.3). The shake now builds
every frame. A repeat of showcase seed 1 matches its run event for event (11,585 of 11,585).

**Budgets:** the initial JS is 246.7 KB of 250. Load time on the slowest profile is 2.98 s (the build before plan 1
measured 2.96 s the same day; the 2.71 s in §2 was from another day). Frame rate, 3 runs per stage against the build
before: within 10% (the spread from run to run is ±20%). `npm run probe` passes. A filmed cruiser death peaks at 2 flashes in a second
(limit 3); the bigger deaths (`boom` 6 and 8) aren't filmed yet: check them in the next re-shoot.

## Next

1. **Playtest with people** (§14.1). The bots can't say whether losing FULL feels fair or just punishing, or whether
   location 1 at 2 POWs still shows the power ladder well enough.
2. **Threat at FULL:** a run that never loses a ship still holds FULL from about 14 minutes on, and at FULL the
   screens empty fast. Options: more pairs of waves at once in locations 2–4 (location 5's density), or a lower
   POW count in locations 2–3 (the knob). The bots say the first; people may say neither.
3. **Extra ships:** 5–6 per campaign, so a run has up to 9 ships. If lost ships should cost more, raise the score
   thresholds.
4. **The Gatekeeper** (§14.3) and **location 1's grades** (§14.4).
5. **Re-shoot the showcase videos** once the game settles: they show fast FULL and wreck POWs (about 7 h of machine
   time, `ai/next_0.md`).
