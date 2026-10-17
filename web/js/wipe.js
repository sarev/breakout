// Anti-cheat for the "windscreen wiper": wiping the bat from side to side fast enough (trivial with a finger on
// a phone) sweeps the whole playfield and nothing can ever get past. We watch the control position for that
// pattern and, when it's found, tire the bat for a while so it can no longer keep up.
//
// The pattern, not the speed, is what's detected, so one desperate swipe right across the playfield to reach
// a ball that was unexpectedly knocked the other way is never punished: it's a single "leg". A leg is a sweep in
// one direction, and it only counts if it was long (WIPE_LEG_TRAVEL of the playfield width) and quick
// (WIPE_LEG_SECONDS). WIPE_LEGS counting legs inside WIPE_WINDOW seconds is wiping, which is two full
// back-and-forths with the defaults. Short, fast wiggles to catch a ball bouncing about near the bat don't count
// either, since those legs are too short.
//
// All times are on the pausable game clock.

import {
  WIPE_HYSTERESIS, WIPE_LEG_SECONDS, WIPE_LEG_TRAVEL, WIPE_LEGS, WIPE_PENALTY, WIPE_WINDOW,
} from './config.js';

export class WipeDetector {
  /**
   * @param {object} gfx Graphics, for the playfield width that the thresholds are relative to.
   */
  constructor(gfx) {
    this.gfx = gfx;
    this.onTired = null;        // Callback when a penalty starts (the game shows a notice)
    this.reset(gfx.W / 2, 0);
  }

  /** Forget everything (level start). */
  reset(x, t) {
    this.dir = 0;               // Direction of the current leg: -1, +1, or 0 before it's known
    this.legStart = { x, t };   // Where and when the current leg began (the previous turning point)
    this.extreme = { x, t };    // The furthest the current leg has reached so far
    this.legs = [];             // End times of the recent legs that counted
    this.tiredUntil = -Infinity;
  }

  /** Is the bat currently tired? */
  tired(t) {
    return t < this.tiredUntil;
  }

  /**
   * Feed the control position (where the bat wants to be, not where it is) once per frame.
   *
   * @param {number} x Target centre x in playfield pixels.
   * @param {number} t Game time.
   */
  observe(x, t) {
    const W = this.gfx.W;
    const hysteresis = WIPE_HYSTERESIS * W;
    if (this.dir === 0) {
      // No leg yet: wait until the pointer has moved clearly one way or the other
      const d = x - this.legStart.x;
      if (Math.abs(d) < hysteresis) return;
      this.dir = Math.sign(d);
      this.extreme = { x, t };
      return;
    }
    if ((x - this.extreme.x) * this.dir >= 0) {
      // Still heading the same way
      this.extreme = { x, t };
      return;
    }
    if ((this.extreme.x - x) * this.dir < hysteresis) return;   // A twitch, not a turn

    // Turned round: the leg that just ended ran from legStart to extreme
    const travel = Math.abs(this.extreme.x - this.legStart.x);
    const seconds = this.extreme.t - this.legStart.t;
    if (travel >= WIPE_LEG_TRAVEL * W && seconds <= WIPE_LEG_SECONDS) {
      this.legs.push(this.extreme.t);
      this.legs = this.legs.filter((t0) => t - t0 <= WIPE_WINDOW);
      if (this.legs.length >= WIPE_LEGS) {
        this.tiredUntil = t + WIPE_PENALTY;
        this.legs = [];   // Carrying on wiping through the penalty will earn another one
        if (this.onTired) this.onTired();
      }
    }
    this.legStart = this.extreme;
    this.extreme = { x, t };
    this.dir = -this.dir;
  }
}
