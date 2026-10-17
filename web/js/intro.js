// The intro: a rotating, perspective-projected card, a swarm of bouncing balls that the pointer can shove about,
// and the difficulty menu, which is chosen by steering the hero ball into a label.

import {
  CARD_PITCH_RATE, CARD_ROLL_RATE, CARD_YAW_RATE, COLOURS, INTRO_BALLS, TRAIL_FADE_INTRO,
} from './config.js';
import { Ball } from './entities.js';
import { substeps } from './game.js';

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
    this.difficulty = game.difficulty;
    this.menuBoxes = [null, null, null];
    this.linkBoxes = { help: null, credits: null };   // Hit boxes for the Help / Credits links
    this.idle = false;                                // Settling the card to face the viewer (see setIdle)
    this.spawnBalls();
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
   * @returns {'help'|'credits'|null}
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
      this.balls.push(new Ball(i === 0 ? s.ball : s.bonusBall, i === 0 ? s.blueGlow : s.redGlow, gfx, this.game,
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
      if (ball !== this.hero) total += Math.hypot(ball.vx, ball.vy);
    }
    return total;
  }

  update(dt) {
    const gfx = this.gfx;
    this.elapsed += dt;

    const [n, h] = substeps(dt);
    for (const ball of this.balls) {
      if (ball !== this.hero) for (let i = 0; i < n; i++) ball.move(h);
      if (ball.lives < 1) ball.lives = 1;
    }

    // The hero ball is the pointer; its velocity is how far it moved this frame, so a flick shoves the others
    const p = gfx.pointerToPlayfield(this.input.raw.x, this.input.raw.y);
    if (dt > 0) {
      this.hero.vx = (p.x - this.hero.x) / dt;
      this.hero.vy = (p.y - this.hero.y) / dt;
    }
    this.hero.x = p.x;
    this.hero.y = p.y;

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

    // Menu: steering the hero ball over a label selects it
    this.selectAt(this.hero.x, this.hero.y);

    gfx.fadeTrails(dt, TRAIL_FADE_INTRO);
  }

  /**
   * Select the difficulty whose label is under a playfield point, if any. Called every frame with the hero ball's
   * position, and by the tap / click handler with the pointer's position just before a game starts: a tap on a
   * phone is over in less time than a frame takes (and the idle intro runs at a low rate), so without that the
   * game would start with whatever was selected before the finger landed.
   *
   * @returns {boolean} True if the selection changed.
   */
  selectAt(x, y) {
    let changed = false;
    this.menuBoxes.forEach((box, i) => {
      if (!box || i === this.difficulty) return;
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
        this.difficulty = i;
        this.game.difficulty = i;
        this.sfx.play('click');
        changed = true;
      }
    });
    return changed;
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

    const wave = Math.round(64 * Math.sin((2 * Math.PI * this.elapsed) / 3));
    const title = COLOURS.title.map((c) => Math.max(0, Math.min(255, c + wave)));
    gfx.text(ctx, 'Breakout', { x, y: gfx.H * 0.2, size: 400, colour: title, alpha: 224 / 255, bold: true, italic: true });
    gfx.text(ctx, 'Copyright © 2025-26, 7th software Ltd.', { x, y: gfx.H * 0.35, size: 80, colour: COLOURS.copyright, alpha: 200 / 255 });
    gfx.text(ctx, 'All rights reserved.', { x, y: gfx.H * 0.41, size: 80, colour: COLOURS.rights, alpha: 200 / 255 });
    const prompt = this.input.mobile ? 'Tap to continue' : 'Click or press any key to continue';
    gfx.text(ctx, prompt, { x, y: gfx.H * 0.46, size: 60, colour: COLOURS.presskey, alpha: 200 / 255 });

    ['Easy', 'Medium', 'Hard'].forEach((label, i) => {
      const selected = i === this.difficulty;
      this.menuBoxes[i] = gfx.text(ctx, label, {
        x, y: gfx.H * (0.6 + 0.08 * i), size: 100, alpha: 224 / 255,
        colour: selected ? COLOURS.selitem : COLOURS.item, bold: selected,
      });
    });

    // Help and Credits links, underlined, lit up when the hero ball is over them. The hit boxes are padded a
    // little so a ball or a finger doesn't have to land exactly on the letters.
    const hover = this.linkAt(this.hero.x, this.hero.y);
    [['help', 'Help', gfx.W * 0.42], ['credits', 'Credits', gfx.W * 0.58]].forEach(([name, label, lx]) => {
      const lit = hover === name;
      const box = gfx.text(ctx, label, {
        x: lx, y: gfx.H * 0.88, size: 60, alpha: lit ? 1 : 0.8, colour: lit ? COLOURS.white : COLOURS.presskey,
      });
      ctx.strokeStyle = lit ? 'rgba(255,255,255,0.9)' : 'rgba(64,224,224,0.6)';
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
