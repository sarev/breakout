// The intro: a rotating, perspective-projected card, a swarm of bouncing balls that the pointer can shove about,
// and the difficulty menu. A game only starts from the menu: a click or tap on a label, or (with a keyboard) the
// arrow keys and Enter. On a desktop the hero ball is the mouse pointer, so it lights up the label it's over; on
// a phone it's only a toy. Steering the bat by rolling the phone (see tilt.js) isn't a difficulty but a phone-only
// setting on the Options page, and while it's on the intro says so above the two-finger hint.

import {
  CARD_PITCH_RATE, CARD_ROLL_RATE, CARD_YAW_RATE, COLOURS, INTRO_BALLS, LOGO_HEIGHT, LOGO_HEIGHT_MOBILE, LOGO_SHIMMER_PERIOD,
  TRAIL_FADE_INTRO, TILT_ACCEL, TILT_DAMPING,
} from './config.js';
import { Ball } from './entities.js';
import { substeps } from './game.js';
import { rgba } from './graphics.js';

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/**
 * Draw a textured triangle: the affine map from the source triangle (image pixels) to the destination triangle
 * (canvas pixels), clipped to the destination. Canvas 2D has no perspective transform, so the card is cut into a
 * grid of these; with enough cells the piecewise-affine result is indistinguishable from a true warp.
 */
function drawTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
  const [sx0, sy0] = s0; const [sx1, sy1] = s1; const [sx2, sy2] = s2;
  const [dx0, dy0] = d0; const [dx1, dy1] = d1; const [dx2, dy2] = d2;

  // Solve for the 2x3 affine matrix M with M * (sx, sy, 1) = (dx, dy) at the three corners
  const det = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
  if (Math.abs(det) < 1e-6) return;
  const a = ((dx1 - dx0) * (sy2 - sy0) - (dx2 - dx0) * (sy1 - sy0)) / det;
  const b = ((dy1 - dy0) * (sy2 - sy0) - (dy2 - dy0) * (sy1 - sy0)) / det;
  const c = ((dx2 - dx0) * (sx1 - sx0) - (dx1 - dx0) * (sx2 - sx0)) / det;
  const d = ((dy2 - dy0) * (sx1 - sx0) - (dy1 - dy0) * (sx2 - sx0)) / det;
  const e = dx0 - a * sx0 - c * sy0;
  const f = dy0 - b * sx0 - d * sy0;

  ctx.save();
  ctx.beginPath();
  // Expand the clip very slightly about the triangle's centre to hide hairline seams between cells
  const cx = (dx0 + dx1 + dx2) / 3;
  const cy = (dy0 + dy1 + dy2) / 3;
  const grow = (x, y) => [x + Math.sign(x - cx) * 0.7, y + Math.sign(y - cy) * 0.7];
  const g0 = grow(dx0, dy0); const g1 = grow(dx1, dy1); const g2 = grow(dx2, dy2);
  ctx.moveTo(g0[0], g0[1]);
  ctx.lineTo(g1[0], g1[1]);
  ctx.lineTo(g2[0], g2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export class Intro {
  /**
   * @param {object} gfx
   * @param {object} game
   * @param {object} sfx
   * @param {object} input
   * @param {HTMLImageElement} cardImage
   */
  constructor(gfx, game, sfx, input, cardImage) {
    this.gfx = gfx;
    this.game = game;
    this.sfx = sfx;
    this.input = input;
    this.card = cardImage;
    this.pitch = 0;
    this.yaw = 0;
    this.roll = 0;
    this.elapsed = 0;
    this.grid = 10;   // Card subdivision per side
    this.labels = ['Easy', 'Medium', 'Hard'];
    this.choice = game.difficulty;   // Index into `labels` of the selected menu item
    this.hovered = -1;          // The label the hero ball was over last frame (desktop), or -1
    this.menuBoxes = this.labels.map(() => null);
    this.linkBoxes = { options: null };   // Hit box for the Options link (desktop only)
    this.idle = false;                                // Settling the card to face the viewer (see setIdle)
    this.tiltActive = false;                          // Hero ball rolled by the device's tilt (phones), not the pointer
    this.tilt = { x: 0, y: 0 };                       // Current tilt as a roll vector in screen terms, -1..1 each way
    this.spawnBalls();
  }

  /**
   * Feed a device orientation reading (a phone). Level is truly flat, lying on its back, which is the sensor's
   * own zero: hold the phone flat and every deviation rolls the ball, like a ball on a tray. Held at a viewing
   * angle instead, the ball simply rests against the bottom edge. The reading is in the device's own frame
   * (beta tilts about its short axis, gamma about its long one), so it's turned to match which way round the
   * screen is.
   *
   * @param {number} beta Degrees, positive when the top of the device is raised.
   * @param {number} gamma Degrees, positive when the right-hand side of the device is lowered.
   * @param {number} angle The screen's rotation from the device's natural (portrait) orientation: 0, 90, 180, 270.
   */
  onOrientation(beta, gamma, angle) {
    const toRad = Math.PI / 180;
    // Which way the ball rolls, in the device's frame: towards its right-hand side, and towards its bottom
    const right = Math.sin(gamma * toRad);
    const down = Math.sin(beta * toRad);
    // ...turned into screen terms. At 90 degrees the device has been turned anticlockwise, so its right-hand
    // side is at the top of the screen and its bottom is at the screen's right; 270 is the mirror of that.
    switch (((angle % 360) + 360) % 360) {
      case 90: this.tilt = { x: down, y: -right }; break;
      case 180: this.tilt = { x: -right, y: -down }; break;
      case 270: this.tilt = { x: -down, y: right }; break;
      default: this.tilt = { x: right, y: down };
    }
    this.tiltActive = true;
  }

  /**
   * Switch between the card rotating (attract mode) and easing back to face the viewer (idle). A card rotating
   * at a throttled frame rate looks broken, so when the page goes idle the card turns square-on and stops, and
   * the frame rate is only dropped once `cardSettled()` reports it has got there.
   */
  setIdle(flag) {
    this.idle = flag;
  }

  /** Whether the card is face-on and still (within a hair), so the frame rate can be dropped. */
  cardSettled() {
    const near = (a) => Math.abs(a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI) < 0.002;
    return this.idle && near(this.pitch) && near(this.yaw) && near(this.roll);
  }

  /**
   * Which link, if any, is under a playfield point.
   *
   * @returns {'options'|null}
   */
  linkAt(x, y) {
    for (const [name, box] of Object.entries(this.linkBoxes)) {
      if (box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return name;
    }
    return null;
  }

  spawnBalls() {
    const gfx = this.gfx;
    const s = gfx.sprites;
    this.balls = [];
    for (let i = 0; i < INTRO_BALLS; i++) {
      this.balls.push(new Ball(i === 0 ? s.introBall : s.bonusBall, i === 0 ? s.introGlow : s.redGlow, gfx, this.game,
        randInt(0, gfx.W - 1), randInt(0, gfx.H - 1),
        { vx: randInt(-5, 5) * 120 * gfx.scale, vy: randInt(-5, 5) * 120 * gfx.scale, lives: 1, intro: true }));
    }
    this.hero = this.balls[0];
  }

  /** Rebuild for a new viewport size. */
  relayout() {
    this.spawnBalls();
  }

  /** Total speed of the drifting balls (px/s), excluding the pointer-driven hero: how lively the scene still is. */
  totalSpeed() {
    let total = 0;
    for (const ball of this.balls) {
      // The hero ball counts when it's rolling under tilt (it's then part of the scene, not the pointer)
      if (ball !== this.hero || this.tiltActive) total += Math.hypot(ball.vx, ball.vy);
    }
    return total;
  }

  update(dt) {
    const gfx = this.gfx;
    this.elapsed += dt;

    const [n, h] = substeps(dt);
    if (this.tiltActive) {
      // The hero ball rolls with the tilt: accelerated by it, slowed by rolling friction, and bouncing off
      // the edges like the others (it goes through the same move)
      this.hero.vx += this.tilt.x * TILT_ACCEL * gfx.scale * dt;
      this.hero.vy += this.tilt.y * TILT_ACCEL * gfx.scale * dt;
      const retain = Math.pow(TILT_DAMPING, dt);
      this.hero.vx *= retain;
      this.hero.vy *= retain;
    }
    for (const ball of this.balls) {
      if (ball !== this.hero || this.tiltActive) for (let i = 0; i < n; i++) ball.move(h);
      if (ball.lives < 1) ball.lives = 1;
    }

    if (!this.tiltActive) {
      // The hero ball is the pointer; its velocity is how far it moved this frame, so a flick shoves the others
      // The same mapping as a click uses (main.js), so the link the ball lights up is the one a click opens
      const p = this.input.playfield();
      if (dt > 0) {
        this.hero.vx = (p.x - this.hero.x) / dt;
        this.hero.vy = (p.y - this.hero.y) / dt;
      }
      this.hero.spin(p.x - this.hero.x, p.y - this.hero.y, dt);   // It doesn't go through move(), so spin it here
      this.hero.x = p.x;
      this.hero.y = p.y;
    }

    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) this.balls[i].checkBall(this.balls[j]);
    }

    if (this.idle) {
      // Ease each angle to its nearest face-on orientation (a multiple of a full turn, so the image isn't
      // mirrored) with a 0.2 s time constant, and snap once it's close enough to count as settled
      const settle = (a) => {
        const target = Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
        a += (target - a) * Math.min(1, dt / 0.2);
        return Math.abs(target - a) < 0.001 ? target : a;
      };
      this.pitch = settle(this.pitch);
      this.yaw = settle(this.yaw);
      this.roll = settle(this.roll);
    } else {
      this.pitch += (CARD_PITCH_RATE * Math.PI / 180) * dt;
      this.yaw += (CARD_YAW_RATE * Math.PI / 180) * dt;
      this.roll += (CARD_ROLL_RATE * Math.PI / 180) * dt;
    }

    // Menu: on a desktop the hero ball is the mouse pointer, so moving it onto a label selects that label, as a
    // cursor would; only moving onto one, so a pointer resting on a label doesn't undo the arrow keys. On a phone
    // the ball is a toy, rolled by the finger or the tilt, and selects nothing: tapping a label is the choice.
    if (!this.input.mobile) {
      const over = this.labelAt(this.hero.x, this.hero.y);
      if (over >= 0 && over !== this.hovered) this.select(over);
      this.hovered = over;
    }

    gfx.fadeTrails(dt, TRAIL_FADE_INTRO);
  }

  /** The index into `labels` of the menu label under a playfield point, or -1. */
  labelAt(x, y) {
    return this.menuBoxes.findIndex(
      (box) => box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
  }

  /**
   * Select a menu item, clicking if that's a change.
   *
   * @param {number} i Index into `labels`.
   */
  select(i) {
    if (i !== this.choice) this.sfx.play('click');
    this.choice = i;
    this.game.difficulty = i;
  }

  /** The up and down arrow keys: move the selection one item, stopping at the ends. */
  moveChoice(step) {
    this.select(Math.max(0, Math.min(this.labels.length - 1, this.choice + step)));
  }

  /**
   * A click or tap at a playfield point: select the label there, if there is one. It's the point itself that
   * counts, not where the hero ball has got to: a tap on a phone is over in less time than a frame takes (and
   * the idle intro runs at a low rate), and a tilt-rolled ball can be anywhere.
   *
   * @returns {boolean} True if it landed on a label, which starts that game.
   */
  selectAt(x, y) {
    const i = this.labelAt(x, y);
    if (i >= 0) this.select(i);
    return i >= 0;
  }

  /** Rotate a card-space point and project it to the playfield. Returns null if the card is edge-on. */
  project(x, y) {
    let z = 0;
    const cp = Math.cos(this.pitch); const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw); const sy = Math.sin(this.yaw);
    const cr = Math.cos(this.roll); const sr = Math.sin(this.roll);
    let y1 = y * cp - z * sp; let z1 = y * sp + z * cp; y = y1; z = z1;
    let x1 = x * cy + z * sy; z1 = -x * sy + z * cy; x = x1; z = z1;
    x1 = x * cr - y * sr; y1 = x * sr + y * cr; x = x1; y = y1;
    const fov = 900 * this.gfx.scale;
    const s = fov / (z + fov);
    return [this.gfx.W * 0.5 + x * s, this.gfx.H * 0.5 - y * s];
  }

  drawCard(ctx) {
    const gfx = this.gfx;
    const img = this.card;
    const cw = gfx.W * 0.4;
    const ch = cw * (img.height / img.width);

    // Edge-on test: the rotated normal's z component (the Python version's dot with the view direction)
    const cp = Math.cos(this.pitch); const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw); const sy = Math.sin(this.yaw);
    const normalZ = Math.abs(cp * cy);   // normal (0,0,1) after pitch then yaw; roll doesn't change z
    if (normalZ < 0.01 || sp * 0 !== 0 || sy * 0 !== 0) return;

    const g = this.grid;
    const pts = [];
    for (let j = 0; j <= g; j++) {
      const row = [];
      for (let i = 0; i <= g; i++) {
        row.push(this.project(-cw / 2 + (cw * i) / g, ch / 2 - (ch * j) / g));
      }
      pts.push(row);
    }
    const su = img.width / g;
    const sv = img.height / g;
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        const s00 = [i * su, j * sv]; const s10 = [(i + 1) * su, j * sv];
        const s01 = [i * su, (j + 1) * sv]; const s11 = [(i + 1) * su, (j + 1) * sv];
        drawTriangle(ctx, img, s00, s10, s11, pts[j][i], pts[j][i + 1], pts[j + 1][i + 1]);
        drawTriangle(ctx, img, s00, s11, s01, pts[j][i], pts[j + 1][i + 1], pts[j + 1][i]);
      }
    }
  }

  draw(ctx) {
    const gfx = this.gfx;
    const x = gfx.W / 2;
    this.drawCard(ctx);

    // On a phone the logo is toned down and the menu made bigger: the labels are tap targets there, and the
    // whole screen is only a few inches across. It's packed a little tighter, to leave room below it for the
    // two-finger hint and, with tilt steering on, a reminder of that.
    const layout = this.input.mobile
      ? { logo: LOGO_HEIGHT_MOBILE, menuSize: 130, menuTop: 0.54, menuStep: 0.1, tilt: 0.88, hint: 0.94 }
      : { logo: LOGO_HEIGHT, menuSize: 100, menuTop: 0.6, menuStep: 0.08 };

    gfx.logo(ctx, x, gfx.H * 0.17, layout.logo, 0.5 + 0.5 * Math.sin((2 * Math.PI * this.elapsed) / LOGO_SHIMMER_PERIOD));
    // The small print stays small, under the logo; the prompt, what to do next, stands out more
    gfx.text(ctx, 'Copyright © 2025-26, 7th software Ltd.', { x, y: gfx.H * 0.35, size: 60, colour: COLOURS.steel, alpha: 200 / 255 });
    const prompt = this.input.mobile
      ? 'Tap a difficulty to play'
      : 'Click a difficulty to play, or use the arrow keys and Enter';
    gfx.text(ctx, prompt, { x, y: gfx.H * 0.45, size: 72, colour: COLOURS.presskey, glow: COLOURS.neonCyan, alpha: 240 / 255, bold: true });

    this.labels.forEach((label, i) => {
      const selected = i === this.choice;
      this.menuBoxes[i] = gfx.text(ctx, label, {
        x, y: gfx.H * (layout.menuTop + layout.menuStep * i), size: layout.menuSize, alpha: 224 / 255,
        colour: COLOURS.steel, chrome: selected, bold: selected,
      });
    });

    // On a phone the Options page is a two-finger tap away, so the link gives way to a hint
    if (this.input.mobile) {
      this.linkBoxes = {};
      gfx.text(ctx, 'Two-finger tap for the menu', { x, y: gfx.H * layout.hint, size: 60, alpha: 0.8, colour: COLOURS.presskey, glow: COLOURS.neonCyan });
      if (this.game.tiltBat) {
        gfx.text(ctx, 'Steering the bat by tilting', { x, y: gfx.H * layout.tilt, size: 60, alpha: 0.8, colour: COLOURS.steel });
      }
    }

    // The Options link (music, fullscreen, mouse capture, Help and Credits are all on that page), underlined, lit
    // up when the hero ball is over it. The hit box is padded a little so a ball or a finger doesn't have to land
    // exactly on the letters.
    const hover = this.linkAt(this.hero.x, this.hero.y);
    const links = this.input.mobile ? [] : [['options', 'Options', gfx.W / 2]];
    links.forEach(([name, label, lx]) => {
      const lit = hover === name;
      const box = gfx.text(ctx, label, {
        x: lx, y: gfx.H * 0.88, size: 60, alpha: lit ? 1 : 0.8, colour: lit ? COLOURS.steel : COLOURS.presskey, glow: COLOURS.neonCyan,
      });
      ctx.strokeStyle = lit ? rgba(COLOURS.steel, 0.9) : rgba(COLOURS.presskey, 0.6);
      ctx.lineWidth = Math.max(1, 2 * gfx.scale);
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + box.h + 4 * gfx.scale);
      ctx.lineTo(box.x + box.w, box.y + box.h + 4 * gfx.scale);
      ctx.stroke();
      const pad = 16 * gfx.scale;
      this.linkBoxes[name] = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
    });

    gfx.drawTrails(ctx);
    for (const ball of this.balls) ball.draw(ctx);
  }
}
