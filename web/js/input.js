// Pointer handling.
//
// Two mouse modes. By default we use the absolute cursor position, like any other canvas game: the cursor stays
// visible outside the playfield and nothing surprising happens to it. Optionally (the L key) the player can
// capture the mouse with the browser's Pointer Lock API; then we get raw movement deltas and accumulate our own
// pointer position, so the bat can be driven without the real cursor ever reaching the edge of the screen. A
// locked mouse is alarming if you weren't expecting it, which is why it's opt-in and announced on screen, and
// why losing the lock (Esc) pauses the game. On a mobile device there is only the one screen and no keyboard,
// so the lock is never offered there.
//
// Touch is always absolute: the pointer is wherever the finger is, on the intro (the hero ball sits under it)
// and in play (the bat sits under it). Lifting the finger and putting it down somewhere else moves the bat
// there. An earlier version moved the bat by the finger's movement instead, like a locked mouse, which turned
// out to be very unhelpful: after a lift the bat carried on from wherever it had been left. A short tap is
// reported through `onTap` (serve / kick / start), and a two-finger tap through `onTwoFingerTap` (the pause /
// options page), since a touch device has no keyboard or second button.
//
// Gain. `playfield()` scales the pointer position about the playfield centre by a gain, which depends on how the
// pointer is being driven (see `gain()`):
//
//  - A captured mouse uses the mouse gain, so crossing the playfield takes the same hand travel on any screen.
//  - A free mouse uses the mouse gain too, but never less than 1: the real cursor can't go beyond the edge of
//    the screen, so a gain below 1 (any screen narrower than the 1920 px reference, or a small window) would
//    leave the bat unable to reach the sides of the playfield.
//  - A finger uses no gain at all, so what it's controlling sits exactly under it.
//
// The gain is chosen from the last kind of input used, so nothing jumps when a finger lifts.
//
// Inversion (the yellow brick) is handled here too: while inverted, the effective x is mirrored about the centre.
// With a captured mouse the raw position is reflected at the moment the state changes so the bat doesn't jump;
// in the absolute modes the real cursor or finger can't be moved, so the bat simply swaps sides, which is
// disorienting in exactly the way the brick intends.

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} gfx Graphics (for the playfield size and pointer conversion).
   * @param {boolean} mobile True on a touch-first device with no mouse (see main.js): no pointer lock.
   */
  constructor(canvas, gfx, mobile = false) {
    this.canvas = canvas;
    this.gfx = gfx;
    this.mobile = mobile;
    this.raw = { x: gfx.W / 2, y: gfx.H / 2 };   // Pointer position in playfield pixels, before inversion and gain
    this.inverted = false;
    this.locked = false;
    this.wantLock = false;
    this.onLockLost = null;                       // Callback when the lock is released by the browser (Esc)
    this.onLockChange = null;                     // Callback(locked) whenever the lock state changes
    this.onTap = null;                            // Callback for a short single-finger tap
    this.onTwoFingerTap = null;                   // Callback for a two-finger tap
    this.touch = null;                            // {x, y, moved, fingers} while a touch is in progress
    this.mode = 'mouse';                          // What last drove the pointer: 'mouse', 'locked' or 'touch'

    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', () => { this.touch = null; }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      const lost = this.locked && !locked;
      this.locked = locked;
      if (this.onLockChange) this.onLockChange(locked);
      if (lost && this.onLockLost) this.onLockLost();
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
  }

  onMove(e) {
    if (this.touch) return;   // A finger is in charge; ignore the synthetic mouse events some browsers send
    if (this.locked) {
      // Deltas arrive in CSS pixels; convert to device pixels so the gain's "1080p screen's worth of travel"
      // means the same physical hand movement regardless of display scaling
      this.mode = 'locked';
      this.raw.x += e.movementX * this.gfx.dpr;
      this.raw.y += e.movementY * this.gfx.dpr;
    } else {
      this.mode = 'mouse';
      const p = this.gfx.clientToPlayfield(e.clientX, e.clientY);
      this.raw.x = p.x;
      this.raw.y = p.y;
    }
    this.clamp();
  }

  /** True while the pointer is being driven by movement deltas (a captured mouse). */
  relative() {
    return this.mode === 'locked';
  }

  /** The gain to apply to the raw position for the current kind of input (see the notes at the top). */
  gain() {
    switch (this.mode) {
      case 'locked': return this.gfx.mouseGain;
      case 'touch': return 1;
      default: return Math.max(1, this.gfx.mouseGain);
    }
  }

  /**
   * Keep the raw position within range.
   *
   * With a captured mouse the range is the band where the bat is actually inside the playfield once the gain has
   * been applied: with a gain above 1 the bat reaches the edge before the raw position does, and if the raw
   * position were allowed to carry on past that point there'd be a dead zone to travel back through before the
   * bat moved again (easy to hit after overshooting under reversed controls). With a gain below 1 the band is
   * wider than the playfield, and the raw position must be allowed out to its edges or the bat could never reach
   * the sides. In the absolute modes the real cursor or finger is what it is, so the raw position is simply kept
   * on the playfield.
   */
  clamp() {
    const W = this.gfx.W;
    const H = this.gfx.H;
    let minX = 0;
    let maxX = W - 1;
    let minY = 0;
    let maxY = H - 1;
    if (this.relative()) {
      const gain = this.gain();
      const cx = W / 2;
      const cy = H / 2;
      minX = cx - cx / gain;
      maxX = cx + (W - 1 - cx) / gain;
      minY = cy - cy / gain;
      maxY = cy + (H - 1 - cy) / gain;
    }
    this.raw.x = Math.max(minX, Math.min(maxX, this.raw.x));
    this.raw.y = Math.max(minY, Math.min(maxY, this.raw.y));
  }

  /** Put the pointer under a finger. */
  placeAt(clientX, clientY) {
    this.mode = 'touch';
    const p = this.gfx.clientToPlayfield(clientX, clientY);
    this.raw.x = p.x;
    this.raw.y = p.y;
    this.clamp();
  }

  onTouchStart(e) {
    e.preventDefault();   // No scrolling, zooming or synthetic mouse events
    const t = e.touches[0];
    const fingers = e.touches.length;
    if (!this.touch) {
      this.touch = { x: t.clientX, y: t.clientY, moved: 0, fingers };
      this.placeAt(t.clientX, t.clientY);
    } else {
      this.touch.fingers = Math.max(this.touch.fingers, fingers);
    }
  }

  onTouchMove(e) {
    e.preventDefault();
    if (!this.touch) return;
    const t = e.touches[0];
    this.touch.moved += Math.hypot(t.clientX - this.touch.x, t.clientY - this.touch.y) * this.gfx.dpr;
    this.touch.x = t.clientX;
    this.touch.y = t.clientY;
    this.placeAt(t.clientX, t.clientY);
  }

  onTouchEnd(e) {
    e.preventDefault();
    if (!this.touch || e.touches.length > 0) return;   // Wait until the last finger lifts
    const { moved, fingers } = this.touch;
    this.touch = null;
    const tapTolerance = 12 * this.gfx.dpr;
    if (fingers >= 2) {
      if (this.onTwoFingerTap) this.onTwoFingerTap();
    } else if (moved < tapTolerance) {
      if (this.onTap) this.onTap();
    }
  }

  /** The pointer x after inversion (still before the gain). */
  effectiveX() {
    return this.inverted ? this.gfx.W - 1 - this.raw.x : this.raw.x;
  }

  /** The controlled position: inversion then gain, clamped to the playfield. */
  playfield() {
    return this.gfx.pointerToPlayfield(this.effectiveX(), this.raw.y, this.gain());
  }

  /**
   * Switch inversion on or off. With a captured mouse the raw position is reflected so the effective position
   * doesn't jump; in the absolute modes the next movement would overwrite that anyway, so it's left alone.
   */
  setInverted(flag) {
    if (flag !== this.inverted) {
      if (this.relative()) this.raw.x = this.gfx.W - 1 - this.raw.x;
      this.inverted = flag;
    }
  }

  /** Put the pointer at the playfield's horizontal centre (level start). */
  centre() {
    this.raw.x = this.gfx.W / 2;
    this.raw.y = this.gfx.H - 1;
    this.clamp();
  }

  /** Rescale the pointer after a viewport change. */
  relayout(sx, sy) {
    this.raw.x *= sx;
    this.raw.y *= sy;
    this.clamp();
  }

  /** Ask for the pointer lock (must be called from a user gesture). Never on a mobile device. */
  requestLock() {
    if (this.mobile) return;
    this.wantLock = true;
    if (this.locked || !this.canvas.requestPointerLock) return;
    // Ask for raw (unaccelerated) movement first; fall back to the plain request if that option is refused.
    // Either request may return a rejecting promise (or throw) where locking isn't possible, such as headless
    // browsers or an iframe: we swallow that, and absolute pointer mode carries on working.
    const plain = () => {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* unsupported */ }
    };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch (e) {
      plain();
    }
  }

  /**
   * Release the pointer lock.
   *
   * @param {boolean} keepWant True to remember that the player opted in, so a pause can release the lock and the
   *                           resume can take it back.
   */
  releaseLock(keepWant = false) {
    if (!keepWant) this.wantLock = false;
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }
}
