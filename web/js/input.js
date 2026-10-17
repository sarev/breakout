// Pointer handling.
//
// Two modes. By default we use the absolute cursor position, like any other canvas game: the cursor stays
// visible outside the playfield and nothing surprising happens to it. Optionally (the L key) the player can
// capture the mouse with the browser's Pointer Lock API; then we get raw movement deltas and accumulate our own
// pointer position, so the bat can be driven without the real cursor ever reaching the edge of the screen. A
// locked mouse is alarming if you weren't expecting it, which is why it's opt-in and announced on screen, and
// why losing the lock (Esc) pauses the game. Either way `playfield()` applies the mouse gain so crossing the
// playfield takes the same hand travel on any screen.
//
// Inversion (the yellow brick) is handled here too: while inverted, the effective x is mirrored about the centre.
// In the relative modes (locked mouse, touch drag) the raw position is reflected at the moment the state changes
// so the bat doesn't jump; in absolute mode the real cursor can't be moved, so the bat simply swaps sides, which
// is disorienting in exactly the way the brick intends.
//
// Touch works the same way through the same `raw` position. With `touchRelative` off (the intro) a finger places
// the pointer directly, like an unlocked mouse. With it on (in play) a drag moves the pointer by the finger's
// movement, like a locked mouse, so the finger doesn't have to sit over the bat and the mouse gain applies. A
// short tap is reported through `onTap` (serve / kick / start), and a two-finger tap through `onTwoFingerTap`
// (pause), since a touch device has no keyboard or second button.

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} gfx Graphics (for the playfield size and pointer conversion).
   */
  constructor(canvas, gfx) {
    this.canvas = canvas;
    this.gfx = gfx;
    this.raw = { x: gfx.W / 2, y: gfx.H / 2 };   // Pointer position in playfield pixels, before inversion and gain
    this.inverted = false;
    this.locked = false;
    this.wantLock = false;
    this.onLockLost = null;                       // Callback when the lock is released by the browser (Esc)
    this.onLockChange = null;                     // Callback(locked) whenever the lock state changes
    this.onTap = null;                            // Callback for a short single-finger tap
    this.onTwoFingerTap = null;                   // Callback for a two-finger tap
    this.touchRelative = false;                   // Drag moves the pointer by deltas (play) or places it (intro)
    this.touch = null;                            // {x, y, moved, fingers} while a touch is in progress

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
      this.raw.x += e.movementX * this.gfx.dpr;
      this.raw.y += e.movementY * this.gfx.dpr;
    } else {
      const p = this.gfx.clientToPlayfield(e.clientX, e.clientY);
      this.raw.x = p.x;
      this.raw.y = p.y;
    }
    this.clamp();
  }

  clamp() {
    this.raw.x = Math.max(0, Math.min(this.gfx.W - 1, this.raw.x));
    this.raw.y = Math.max(0, Math.min(this.gfx.H - 1, this.raw.y));
  }

  onTouchStart(e) {
    e.preventDefault();   // No scrolling, zooming or synthetic mouse events
    const t = e.touches[0];
    const fingers = e.touches.length;
    if (!this.touch) {
      this.touch = { x: t.clientX, y: t.clientY, moved: 0, fingers };
      if (!this.touchRelative) {
        const p = this.gfx.clientToPlayfield(t.clientX, t.clientY);
        this.raw.x = p.x;
        this.raw.y = p.y;
        this.clamp();
      }
    } else {
      this.touch.fingers = Math.max(this.touch.fingers, fingers);
    }
  }

  onTouchMove(e) {
    e.preventDefault();
    if (!this.touch) return;
    const t = e.touches[0];
    const dx = (t.clientX - this.touch.x) * this.gfx.dpr;
    const dy = (t.clientY - this.touch.y) * this.gfx.dpr;
    this.touch.x = t.clientX;
    this.touch.y = t.clientY;
    this.touch.moved += Math.hypot(dx, dy);
    if (this.touchRelative) {
      this.raw.x += dx;
      this.raw.y += dy;
    } else {
      const p = this.gfx.clientToPlayfield(t.clientX, t.clientY);
      this.raw.x = p.x;
      this.raw.y = p.y;
    }
    this.clamp();
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

  /** The controlled position: inversion then mouse gain, clamped to the playfield. */
  playfield() {
    return this.gfx.pointerToPlayfield(this.effectiveX(), this.raw.y);
  }

  /**
   * Switch inversion on or off. In the relative modes the raw position is reflected so the effective position
   * doesn't jump; in absolute mode the next cursor movement would overwrite that anyway, so it's left alone.
   */
  setInverted(flag) {
    if (flag !== this.inverted) {
      if (this.locked || this.touch !== null) this.raw.x = this.gfx.W - 1 - this.raw.x;
      this.inverted = flag;
    }
  }

  /** Put the pointer at the playfield's horizontal centre (level start). */
  centre() {
    this.raw.x = this.gfx.W / 2;
    this.raw.y = this.gfx.H - 1;
  }

  /** Rescale the pointer after a viewport change. */
  relayout(sx, sy) {
    this.raw.x *= sx;
    this.raw.y *= sy;
  }

  /** Ask for the pointer lock (must be called from a user gesture). */
  requestLock() {
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
