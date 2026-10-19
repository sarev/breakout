// Steering the bat by rolling the phone: a phone-only option on the Options page, at any difficulty.
//
// The phone is held like a steering wheel, roughly upright, in portrait or landscape. Rolling it anticlockwise
// sends the bat left and clockwise sends it right, and a modest lean (TILT_BAT_FULL_*) is enough to reach the
// edge. The accelerometer's reading, gravity in the device's own frame (x towards its right-hand side, y towards
// its top, z out of the screen), is low-pass filtered and the angle of "up" within the screen plane is taken from
// it. Pitching the phone back only shortens that in-plane vector without changing its angle, and turning on the
// spot (yaw) doesn't move gravity at all, so neither has any effect on the bat. Level is the angle "up" was at
// when a level started (or the game resumed), snapped to the nearest right angle: "roughly portrait" means
// portrait, and the player's natural slight lean doesn't become a permanent offset. Nothing here depends on
// which way round the screen is, so turning the phone just means taking level again (Game.relayout()).
//
// Android reports the reaction force (pointing up) and iOS reports gravity (pointing down): either works, since
// everything is measured relative to the reference angle and the flip is a 180° turn, which the snapping absorbs.
//
// The angles and smoothing were dialled in on a Galaxy S23 with web/tilt.html, a standalone page that draws the
// bat and steers it the same way, with sliders and readouts: use that to try changes before copying them into
// config.js.

import {
  TILT_BAT_DEAD_ZONE, TILT_BAT_FLAT, TILT_BAT_FULL_LANDSCAPE, TILT_BAT_FULL_PORTRAIT, TILT_BAT_SMOOTHING,
} from './config.js';

const DEG = 180 / Math.PI;

/** Shortest signed difference between two angles, in degrees. */
function wrap(d) {
  return ((d % 360) + 540) % 360 - 180;
}

export class TiltSteer {
  constructor() {
    this.up = { x: 0, y: 1, z: 0 };   // Filtered "up" vector in the device's frame (unit length)
    this.haveReading = false;
    this.lastStamp = 0;
    this.refAngle = null;             // Device-frame angle of "up" that counts as level, degrees; null: take it next
    this.heldRoll = 0;                // The last roll that was trustworthy (kept while the phone is too flat to tell)
  }

  /** True once readings are arriving and level has been taken: the bat can be steered. */
  get active() {
    return this.haveReading && this.refAngle !== null;
  }

  /**
   * Fold a fresh accelerometer reading into the filtered vector. Any scale will do (it's normalised); the first
   * reading after a reset seeds the filter outright so there's no lag at the start of a level.
   *
   * @param {number} x Device-frame x component (towards the right-hand side).
   * @param {number} y Device-frame y component (towards the top).
   * @param {number} z Device-frame z component (out of the screen).
   * @param {number} stamp The event's timestamp in milliseconds.
   */
  feed(x, y, z, stamp) {
    const mag = Math.hypot(x, y, z);
    if (!(mag > 0.5)) return;         // A vector with no length (or no reading at all) says nothing
    x /= mag; y /= mag; z /= mag;
    if (!this.haveReading) {
      this.up = { x, y, z };
      this.haveReading = true;
    } else {
      const dt = Math.max(0, Math.min(100, stamp - this.lastStamp)) / 1000;
      // Exponential smoothing with a time constant: the same feel whatever rate the events arrive at
      const k = TILT_BAT_SMOOTHING > 0 ? 1 - Math.exp(-dt / TILT_BAT_SMOOTHING) : 1;
      this.up.x += (x - this.up.x) * k;
      this.up.y += (y - this.up.y) * k;
      this.up.z += (z - this.up.z) * k;
    }
    this.lastStamp = stamp;
    if (this.refAngle === null) this.level();
  }

  /** Angle of "up" in the device frame: 0 when the device is upright in portrait, positive clockwise. */
  upAngle() {
    return Math.atan2(-this.up.x, this.up.y) * DEG;
  }

  /** How far the screen is tipped back from vertical: 0 upright, 90 flat on its back (where roll means nothing). */
  pitch() {
    return Math.atan2(this.up.z, Math.hypot(this.up.x, this.up.y)) * DEG;
  }

  /**
   * Take the phone's current angle, snapped to the nearest right angle, as level. Called when a level starts, when
   * the game resumes, and when the phone is turned round. Before any reading has arrived it arranges for the
   * first one to be taken as level instead.
   */
  level() {
    if (!this.haveReading) {
      this.refAngle = null;
      return;
    }
    this.refAngle = Math.round(this.upAngle() / 90) * 90;
    this.heldRoll = 0;
  }

  /** The current roll from level in degrees, clockwise positive. Held at its last value while the phone is flat. */
  roll() {
    if (!this.active) return 0;
    if (Math.abs(this.pitch()) <= TILT_BAT_FLAT) this.heldRoll = wrap(this.upAngle() - this.refAngle);
    return this.heldRoll;
  }

  /**
   * Where the roll puts the bat, from -1 (against the left edge) to 1 (against the right), linear between the dead
   * zone and the full-deflection angle for the way round the screen is.
   *
   * @param {boolean} landscape True when the playfield is wider than it is tall.
   * @returns {number}
   */
  position(landscape) {
    const angle = this.roll();
    const a = Math.abs(angle);
    if (a <= TILT_BAT_DEAD_ZONE) return 0;
    const full = landscape ? TILT_BAT_FULL_LANDSCAPE : TILT_BAT_FULL_PORTRAIT;
    const span = Math.max(1, full - TILT_BAT_DEAD_ZONE);
    return Math.sign(angle) * Math.min(1, (a - TILT_BAT_DEAD_ZONE) / span);
  }
}
