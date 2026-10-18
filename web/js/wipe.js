// Anti-cheat for the "windscreen wiper": wobbling the bat from side to side fast enough (trivial with a finger on
// a phone) guards a whole stretch of the bottom edge and nothing can get past. We watch the control position for
// that pattern and, when it's found, tire the bat for a while so it can no longer keep up.
//
// What's detected is how often the bat turns round. Play has the bat going one way for a while, then the other:
// chasing a ball, meeting it, moving off to meet the next. Turning round more than WIPE_TURNS times inside
// WIPE_WINDOW seconds is nothing a player does to meet balls; it's a wiper (a fast narrow wobble under the
// ball's path does it as well as sweeps right across the playfield, so the width of the sweeps isn't the test).
// A turn counts only at the end of a leg (a run in one direction) of at least WIPE_LEG_TRAVEL of the playfield
// width, so that the jitter of an accelerometer-steered bat (Insane) and the twitches of a finger, which turn
// round constantly but go almost nowhere, don't add up to a penalty; and the bat must come back WIPE_HYSTERESIS
// of the width before a turn is seen at all. One desperate swipe right across the playfield is one leg and one
// turn, never a penalty.
//
// All times are on the pausable game clock.

import { WIPE_HYSTERESIS, WIPE_LEG_TRAVEL, WIPE_PENALTY, WIPE_TURNS, WIPE_WINDOW } from './config.js';

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
    this.turns = [];            // Times of the recent turns that counted
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

    // Turned round: the leg that just ended ran from legStart to extreme. It counts as a turn if it went
    // somewhere; a leg shorter than that is jitter, which is forgotten rather than held against the player
    const travel = Math.abs(this.extreme.x - this.legStart.x);
    if (travel >= WIPE_LEG_TRAVEL * W) {
      this.turns.push(this.extreme.t);
      this.turns = this.turns.filter((t0) => t - t0 <= WIPE_WINDOW);
      if (this.turns.length >= WIPE_TURNS) {
        this.tiredUntil = t + WIPE_PENALTY;
        this.turns = [];   // Carrying on wiping through the penalty will earn another one
        if (this.onTired) this.onTired();
      }
    }
    this.legStart = this.extreme;
    this.extreme = { x, t };
    this.dir = -this.dir;
  }
}
