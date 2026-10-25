// Collision radii: the single source of truth for Game.collide() and the danger markers (src/game/danger.js),
// so a marker always means exactly what the collision test does.
//
// The player's hitbox is a small core (classic shmup): much smaller than the ship model, shown as a ring on the
// ship when threats are near.

export const PLAYER_CORE = 0.7;

/** Distance (centre to centre) below which an enemy bullet of collision radius r hits the player. */
export const bulletHitR = (r) => r + PLAYER_CORE;
/** ...a corridor rock of radius R. */
export const rockHitR = (R) => R * 0.82 + 1.2;
/** ...an enemy ship (ramming) with collision radius r. */
export const shipHitR = (r) => r * 0.7 + 1.3;
/** ...an enemy missile. */
export const MISSILE_R = 0.8;
export const missileHitR = () => MISSILE_R + PLAYER_CORE;
/** ...a laser beam (distance from the beam's centre line). */
export const BEAM_HIT_R = 2.6;
/** Enemies further than this behind the player's plane never collide: you can't dodge what you can't see. */
export const BEHIND_SAFE = 2;
