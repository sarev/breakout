// The end-of-game certificate: what replaces the old three-second banner when the last level is cleared ("YOU
// WIN!") or the last life is lost ("GAME OVER!").
//
// It stays up until dismissed, and records the game: the difficulty, the time spent in play (the game clock,
// which excludes the "Level N..." banners and pauses), the lives left on a win or the level reached on a loss
// (a loser's lives are none by definition), and when the first level began. Two boxes sit in the top
// corners: a selfie box, which opens the front camera (ui.js openCamera) and then shows the photo, and a save
// box that renders the certificate to a PNG and downloads it, which on a phone lands in the gallery's Downloads
// album. The same `draw()` renders the on-screen page and the export; the export leaves out the save box, the
// camera prompt, the "continue" hint and the footnote saying the photo stays on the device, which aren't part
// of the record.

import { COLOURS } from './config.js';

const DIFFICULTY_NAMES = ['Easy', 'Medium', 'Hard'];

/** A rounded-rectangle path (Canvas 2D's roundRect is newer than some phone browsers). */
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;

export class Certificate {
  /**
   * @param {object} gfx Graphics.
   * @param {boolean} mobile True on a phone or tablet: the prompts say "tap".
   */
  constructor(gfx, mobile = false) {
    this.gfx = gfx;
    this.mobile = mobile;
    this.won = true;
    this.difficulty = '';
    this.seconds = 0;
    this.lives = 0;
    this.level = 1;
    this.startedAt = null;
    this.photo = null;        // A square canvas from the camera, or null for the placeholder
  }

  /**
   * Fill in a finished game.
   *
   * @param {object} game The finished game: difficulty, tiltBat, playSeconds, lives, level and startedAt are read.
   * @param {boolean} won True for the last level cleared, false for the last life lost.
   */
  start(game, won = true) {
    this.won = won;
    this.difficulty = game.tiltBat ? 'Insane' : DIFFICULTY_NAMES[game.difficulty] || 'Easy';
    this.seconds = game.playSeconds;
    this.lives = game.lives;
    this.level = game.level;
    this.startedAt = game.startedAt || new Date();
    this.photo = null;
  }

  /** @param {HTMLCanvasElement} photo A square image from the camera. */
  setPhoto(photo) {
    this.photo = photo;
  }

  /** The two corner boxes, in playfield pixels: squares a fifth of the height, inset from the top corners. */
  boxes() {
    const { W, H } = this.gfx;
    const side = Math.round(H * 0.2);
    const margin = Math.round(H * 0.04);
    return {
      save: { x: margin, y: margin, w: side, h: side },
      selfie: { x: W - margin - side, y: margin, w: side, h: side },
    };
  }

  /**
   * Which box, if any, is under a playfield point.
   *
   * @returns {'selfie'|'save'|null}
   */
  hit(x, y) {
    for (const [name, b] of Object.entries(this.boxes())) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return name;
    }
    return null;
  }

  /**
   * The time in play as the certificate shows it: whole minutes, then the seconds to the hundredth ("3 minutes
   * 7.25 seconds"), or just the seconds under a minute. Rounded to the hundredth first, so 59.999 s is "1 minute
   * 0.00 seconds" rather than "60.00 seconds".
   */
  timeText() {
    const hundredths = Math.round(this.seconds * 100);
    const minutes = Math.floor(hundredths / 6000);
    const seconds = `${((hundredths % 6000) / 100).toFixed(2)} seconds`;
    if (minutes === 0) return seconds;
    return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds}`;
  }

  /** When the first level began, in the player's own language and time zone. */
  startedText() {
    try {
      return this.startedAt.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
    } catch (e) {
      return this.startedAt.toString();
    }
  }

  /**
   * Draw the certificate over the level backdrop.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {boolean} forExport True when rendering the PNG: no controls or prompts.
   */
  draw(ctx, forExport = false) {
    const gfx = this.gfx;
    const { W, H } = gfx;
    const x = W / 2;
    ctx.drawImage(gfx.background, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, W, H);

    // The outcome sets the banner and its colour, and how the time is put: a winner's time, a loser's endurance
    const title = this.won ? 'YOU WIN!' : 'GAME OVER!';
    const titleColour = this.won ? COLOURS.win : COLOURS.die;
    const lineColour = this.won ? COLOURS.advance : COLOURS.die;
    gfx.text(ctx, title, { x, y: H * 0.33, size: 200, colour: titleColour, alpha: 0.95, bold: true, italic: true });
    gfx.text(ctx, `Difficulty: ${this.difficulty}`, { x, y: H * 0.46, size: 80, colour: lineColour, alpha: 0.9 });
    gfx.text(ctx, `${this.won ? 'Time' : 'You lasted'}: ${this.timeText()}`, { x, y: H * 0.53, size: 80, colour: lineColour, alpha: 0.9 });
    const third = this.won ? `Lives remaining: ${this.lives}` : `You reached level ${this.level}`;
    gfx.text(ctx, third, { x, y: H * 0.6, size: 80, colour: lineColour, alpha: 0.9 });
    if (!forExport) {
      const prompt = this.mobile ? 'Tap anywhere else to continue' : 'Click or press any key to continue';
      gfx.text(ctx, prompt, { x, y: H * 0.7, size: 60, colour: COLOURS.presskey, alpha: 0.8 });
    }
    gfx.text(ctx, 'Breakout, by 7th software Ltd.', { x, y: H * 0.8, size: 50, colour: COLOURS.copyright, alpha: 0.7 });
    gfx.text(ctx, `Started ${this.startedText()}`, { x, y: H * 0.93, size: 50, colour: COLOURS.copyright, alpha: 0.8 });
    if (!forExport) {
      // A camera in a web page invites the question, so the answer is on the page that asks for one
      gfx.text(ctx, 'Your photo never leaves this device: it is not uploaded or sent anywhere', {
        x, y: H * 0.978, size: 30, colour: COLOURS.copyright, alpha: 0.6,
      });
    }

    const boxes = this.boxes();
    this.drawSelfieBox(ctx, boxes.selfie, forExport);
    if (!forExport) this.drawSaveBox(ctx, boxes.save);
  }

  /** The corner box frame: a dark, rounded panel with a cyan edge. */
  frame(ctx, b) {
    const gfx = this.gfx;
    roundedRect(ctx, b.x, b.y, b.w, b.h, Math.max(4, 12 * gfx.scale));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, 3 * gfx.scale);
    ctx.strokeStyle = rgba(COLOURS.presskey, 0.9);
    ctx.stroke();
  }

  /** The selfie box: the photo, or a person silhouette with a camera badge inviting one. */
  drawSelfieBox(ctx, b, forExport) {
    const gfx = this.gfx;
    this.frame(ctx, b);
    if (this.photo) {
      // Clipped to the panel's rounded shape, a hair inside the edge
      ctx.save();
      roundedRect(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, Math.max(3, 10 * gfx.scale));
      ctx.clip();
      ctx.drawImage(this.photo, b.x, b.y, b.w, b.h);
      ctx.restore();
      return;
    }
    // Person: a head over shoulders, in a quiet grey
    const cx = b.x + b.w / 2;
    ctx.fillStyle = 'rgba(200, 210, 230, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, b.y + b.h * 0.38, b.h * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, b.y + b.h * 0.95, b.h * 0.34, Math.PI, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();
    if (forExport) return;
    // Camera badge in the bottom-right corner: body, lens and the viewfinder bump
    const cw = b.w * 0.3;
    const ch = cw * 0.68;
    const cxr = b.x + b.w - cw - b.w * 0.07;
    const cy = b.y + b.h - ch - b.h * 0.07;
    ctx.fillStyle = rgba(COLOURS.presskey, 0.95);
    roundedRect(ctx, cxr, cy, cw, ch, ch * 0.18);
    ctx.fill();
    roundedRect(ctx, cxr + cw * 0.3, cy - ch * 0.18, cw * 0.4, ch * 0.25, ch * 0.08);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.arc(cxr + cw / 2, cy + ch * 0.52, ch * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(COLOURS.presskey, 0.95);
    ctx.beginPath();
    ctx.arc(cxr + cw / 2, cy + ch * 0.52, ch * 0.16, 0, Math.PI * 2);
    ctx.fill();
    gfx.text(ctx, this.mobile ? 'Tap for a selfie' : 'Click for a selfie', {
      x: cx, y: b.y + b.h + b.h * 0.14, size: 36, colour: COLOURS.presskey, alpha: 0.8,
    });
  }

  /** The save box: a download arrow into a tray, and its label. */
  drawSaveBox(ctx, b) {
    const gfx = this.gfx;
    this.frame(ctx, b);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h * 0.42;
    const s = b.h * 0.3;
    ctx.strokeStyle = rgba(COLOURS.presskey, 0.95);
    ctx.fillStyle = rgba(COLOURS.presskey, 0.95);
    ctx.lineWidth = Math.max(2, s * 0.14);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Arrow shaft and head
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.9);
    ctx.lineTo(cx, cy + s * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy);
    ctx.lineTo(cx, cy + s * 0.5);
    ctx.lineTo(cx + s * 0.5, cy);
    ctx.stroke();
    // Tray
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s * 0.5);
    ctx.lineTo(cx - s, cy + s);
    ctx.lineTo(cx + s, cy + s);
    ctx.lineTo(cx + s, cy + s * 0.5);
    ctx.stroke();
    gfx.text(ctx, 'Save PNG', { x: cx, y: b.y + b.h * 0.82, size: 44, colour: COLOURS.presskey, alpha: 0.9, bold: true });
  }

  /**
   * Render the certificate at the playfield's size and download it as a PNG. The file is named for the outcome,
   * the difficulty and the start time, so repeat games don't overwrite each other.
   *
   * @returns {Promise<Blob|null>} The image, or null if the browser couldn't make one.
   */
  save() {
    const { W, H } = this.gfx;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    this.draw(canvas.getContext('2d'), true);
    const d = this.startedAt;
    const two = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
    const name = `breakout-${this.won ? 'win' : 'game-over'}-${this.difficulty.toLowerCase()}-${stamp}.png`;
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        resolve(blob);
      }, 'image/png');
    });
  }
}
