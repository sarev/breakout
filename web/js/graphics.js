// Canvas, playfield geometry, sprites, backgrounds, text and the glow-trail layer.
//
// The canvas fills the browser viewport at device-pixel resolution. Inside it sits the playfield: the viewport's
// shape clamped to the allowed aspect range, centred, with black bars where the shapes differ. Every coordinate
// in the game is a playfield pixel, and `scale` says how big that is relative to the 1080p reference.

import {
  BALL_HEIGHT_PCT, BAT_HEIGHT_PCT, HAZE_BLUR_MAX, HAZE_BLUR_PER_BRICK, HAZE_VIGNETTE_MAX,
  HAZE_VIGNETTE_PER_BRICK, INTRO_HERO_SCALE, LASER_HEIGHT_PCT, MAX_PLAYFIELD_ASPECT, MIN_PLAYFIELD_ASPECT,
  MOBILE_BAT_WIDEN, MOBILE_WIDE_ASPECT, NUM_BRICK_TYPES, REFERENCE_HEIGHT, REFERENCE_WIDTH,
} from './config.js';

/** CSS colour string from an [r, g, b] triple and an alpha 0..1. */
export function rgba([r, g, b], alpha = 1) {
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Work out the playfield size for a viewport.
 *
 * @param {number} width Viewport width in device pixels.
 * @param {number} height Viewport height in device pixels.
 * @returns {{w: number, h: number}} Largest box of the clamped shape that fits.
 */
export function playfieldSize(width, height) {
  const aspect = width / height;
  const tolerance = 0.01;   // Shapes within 1% of a limit count as inside it (no one-pixel bars)
  if (aspect > MAX_PLAYFIELD_ASPECT * (1 + tolerance)) {
    const h = Math.floor(height);
    return { w: Math.round(h * MAX_PLAYFIELD_ASPECT), h };
  }
  if (aspect < MIN_PLAYFIELD_ASPECT * (1 - tolerance)) {
    const w = Math.floor(width);
    return { w, h: Math.round(w / MIN_PLAYFIELD_ASPECT) };
  }
  return { w: Math.floor(width), h: Math.floor(height) };
}

/**
 * Make an offscreen canvas holding `img` scaled to a given height, keeping its aspect ratio.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {number} height Target height in pixels.
 * @returns {HTMLCanvasElement}
 */
export function scaleImage(img, height) {
  const ratio = height / img.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * ratio));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Widen a bat sprite without distorting it: the two rounded end caps (each half the height wide) are kept as they
 * are and only the straight middle section is stretched, so the ball's end-cap collision circles still match
 * what's drawn. A factor of 1 returns the sprite unchanged.
 *
 * @param {HTMLCanvasElement} sprite A scaled bat.
 * @param {number} factor Width multiplier.
 * @returns {HTMLCanvasElement}
 */
export function widenImage(sprite, factor) {
  if (factor === 1) return sprite;
  const w = sprite.width;
  const h = sprite.height;
  const cap = Math.min(Math.floor(h / 2), Math.floor(w / 4));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * factor));
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sprite, 0, 0, cap, h, 0, 0, cap, h);
  ctx.drawImage(sprite, cap, 0, w - 2 * cap, h, cap, 0, canvas.width - 2 * cap, h);
  ctx.drawImage(sprite, w - cap, 0, cap, h, canvas.width - cap, 0, cap, h);
  return canvas;
}

/**
 * Tint a sprite by multiplying it with a colour, keeping its alpha (the inverted-controls bat).
 *
 * @param {HTMLCanvasElement} sprite
 * @param {number[]} colour [r, g, b]
 * @returns {HTMLCanvasElement}
 */
export function tintImage(sprite, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sprite, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = rgba(colour);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sprite, 0, 0);
  return canvas;
}

export class Graphics {
  /**
   * @param {HTMLCanvasElement} canvas The page's canvas.
   * @param {Object<string, HTMLImageElement>} images Loaded source images.
   * @param {number} sensitivity Mouse sensitivity multiplier.
   * @param {boolean} mobile True on a phone or tablet: the bats are drawn wider in landscape (see buildSprites).
   */
  constructor(canvas, images, sensitivity = 1, mobile = false) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.ctx = canvas.getContext('2d');
    this.images = images;
    this.sensitivity = sensitivity;
    this.brickImages = [];
    this.brickSize = 0;
    this.background = null;
    this.trailMarks = [];       // Glow blobs as {img, x, y, t}: drawn each frame with alpha falling with age
    this.icons = new Map();     // Image -> {px, canvas}: shrunk copies for icon() to reuse
    this.trailClock = 0;
    this.trailLifetime = 255 / 600;
    this.W = 0;
    this.H = 0;
    this.resize();
  }

  /**
   * Size the canvas to the viewport and lay out the playfield inside it. Called at start and on every resize.
   *
   * @returns {boolean} True if the playfield size changed (callers then rescale their objects).
   */
  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    const { w, h } = playfieldSize(this.canvas.width, this.canvas.height);
    const changed = w !== this.W || h !== this.H;
    this.W = w;
    this.H = h;
    this.offX = Math.floor((this.canvas.width - w) / 2);
    this.offY = Math.floor((this.canvas.height - h) / 2);
    this.aspect = w / h;
    this.scale = h / REFERENCE_HEIGHT;

    // Mouse gain: crossing the playfield should take the same hand travel as crossing a 1080p screen. Pointer
    // movement arrives in CSS pixels, which we convert to device pixels, so the playfield's width in device
    // pixels over the reference width is the gain (see Input).
    this.mouseGain = (w / REFERENCE_WIDTH) * Math.max(0.1, this.sensitivity);

    if (changed) {
      this.trailMarks = [];
      this.layer = null;   // Rebuilt at the new size when next wanted
      this.buildSprites();
    }
    return changed;
  }

  /**
   * An offscreen canvas the size of the playfield, for drawing a frame that is then composited with an effect
   * (see drawHazed). Made on first use and kept until the playfield changes size.
   *
   * @returns {CanvasRenderingContext2D}
   */
  layerContext() {
    if (!this.layer) {
      this.layer = document.createElement('canvas');
      this.layer.width = this.W;
      this.layer.height = this.H;
    }
    return this.layer.getContext('2d');
  }

  /**
   * Composite the layer onto the playfield through the haze of the red lens brick: blurred, with a red vignette
   * creeping in from the edges, both deeper the more lenses are in effect. The blur uses the context's own
   * filter where the browser has one (Chromium, Firefox); otherwise the layer is drawn down to a small canvas and
   * back up, which smears it much the same way.
   *
   * @param {CanvasRenderingContext2D} ctx The playfield context (origin already at the playfield's corner).
   * @param {number} count The haze's depth (Game.haze): 1 per red lens in effect, less as each fades.
   */
  drawHazed(ctx, count) {
    const layer = this.layer;
    const W = this.W;
    const H = this.H;
    const px = Math.min(HAZE_BLUR_MAX, HAZE_BLUR_PER_BRICK * count) * this.scale;
    if (typeof ctx.filter === 'string') {
      ctx.save();
      ctx.filter = `blur(${px.toFixed(1)}px)`;
      // Drawn a little larger than the playfield so the blur's soft edge falls outside the clip
      const pad = Math.ceil(px * 2);
      ctx.drawImage(layer, -pad, -pad, W + 2 * pad, H + 2 * pad);
      ctx.restore();
    } else {
      const shrink = Math.max(2, Math.round(px));
      if (!this.blurScratch) this.blurScratch = document.createElement('canvas');
      const small = this.blurScratch;
      small.width = Math.max(1, Math.round(W / shrink));
      small.height = Math.max(1, Math.round(H / shrink));
      const sctx = small.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(layer, 0, 0, small.width, small.height);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
      ctx.restore();
    }
    // The vignette: clear in the middle, red at the corners, closing in with every brick
    const alpha = Math.min(HAZE_VIGNETTE_MAX, HAZE_VIGNETTE_PER_BRICK * count);
    const outer = Math.hypot(W, H) / 2;
    const inner = outer * Math.max(0.15, 0.55 - 0.1 * count);
    const g = ctx.createRadialGradient(W / 2, H / 2, inner, W / 2, H / 2, outer);
    g.addColorStop(0, 'rgba(255, 0, 0, 0)');
    g.addColorStop(1, `rgba(220, 0, 0, ${alpha.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** Scale the sprites for the current playfield height. */
  buildSprites() {
    const h = (pct) => Math.floor((this.H * pct) / 100);
    const im = this.images;
    this.sprites = {
      ball: scaleImage(im.ball, h(BALL_HEIGHT_PCT)),
      bonusBall: scaleImage(im.bonusBall, h(BALL_HEIGHT_PCT)),
      blueGlow: scaleImage(im.blueGlow, h(BALL_HEIGHT_PCT)),
      redGlow: scaleImage(im.redGlow, h(BALL_HEIGHT_PCT)),
      // The intro's hero ball is bigger than a ball in play, so it's easy to see and to steer onto the menu
      introBall: scaleImage(im.ball, h(BALL_HEIGHT_PCT * INTRO_HERO_SCALE)),
      introGlow: scaleImage(im.blueGlow, h(BALL_HEIGHT_PCT * INTRO_HERO_SCALE)),
      bat: widenImage(scaleImage(im.bat, h(BAT_HEIGHT_PCT)), this.batWiden()),
      bonusBat: widenImage(scaleImage(im.bonusBat, h(BAT_HEIGHT_PCT)), this.batWiden()),
      blueLaser: scaleImage(im.blueLaser, h(LASER_HEIGHT_PCT)),
      greenLaser: scaleImage(im.greenLaser, h(LASER_HEIGHT_PCT)),
    };
  }

  /**
   * How much wider than normal the bats are drawn: on a phone or tablet in landscape the finger driving the bat
   * covers it, so it's made wide enough to show either side of the fingertip. In portrait the playfield is
   * narrow (letterboxed to 4:3) and a doubled bat would be too much of it, so it stays normal there.
   */
  batWiden() {
    return this.mobile && this.aspect >= MOBILE_WIDE_ASPECT ? MOBILE_BAT_WIDEN : 1;
  }

  /**
   * Scale the brick sprites for a level. Bricks are square, `W / columns` across, as in the Python version.
   *
   * @param {number} columns
   */
  buildBricks(columns) {
    this.brickSize = Math.floor(this.W / columns);
    this.brickImages = [];
    for (let i = 0; i < NUM_BRICK_TYPES; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = this.brickSize;
      canvas.height = this.brickSize;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.images[`brick${i}`], 0, 0, this.brickSize, this.brickSize);
      this.brickImages.push(canvas);
    }
  }

  /**
   * Build the tiled, darkened background for a level.
   *
   * @param {number} stage The level's stage, 1-based; clamped to the number of tile images.
   */
  buildBackground(stage) {
    const tileImg = this.images[`tile${Math.min(stage, 6)}`];
    const tile = scaleImage(tileImg, this.H);
    const bg = document.createElement('canvas');
    bg.width = this.W;
    bg.height = this.H;
    const ctx = bg.getContext('2d');
    // Tiles aligned to the bottom and horizontally centred, like the Python version
    const yOffset = tile.height - (this.H % tile.height);
    const xOffset = tile.width - (Math.floor((this.W - tile.width) / 2) % tile.width);
    for (let x = -xOffset; x < this.W; x += tile.width) {
      for (let y = -yOffset; y < this.H; y += tile.height) {
        ctx.drawImage(tile, x, y);
      }
    }
    ctx.fillStyle = `rgba(0,0,0,${130 / 255})`;
    ctx.fillRect(0, 0, this.W, this.H);
    this.background = bg;
  }

  /**
   * Start a frame: clear the whole canvas to black (the letterbox bars) and set the origin and clip to the
   * playfield. Everything drawn after this is in playfield coordinates.
   */
  begin() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.offX, this.offY);
    ctx.beginPath();
    ctx.rect(0, 0, this.W, this.H);
    ctx.clip();
    return ctx;
  }

  /** End a frame (undo `begin()`'s clip and translation). */
  end() {
    this.ctx.restore();
  }

  /**
   * Convert a pointer position in CSS pixels to playfield pixels (unclamped).
   *
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{x: number, y: number}}
   */
  clientToPlayfield(clientX, clientY) {
    return { x: clientX * this.dpr - this.offX, y: clientY * this.dpr - this.offY };
  }

  /**
   * Apply a gain: scale a pointer position about the playfield centre, clamped to the playfield.
   *
   * @param {number} x Pointer x in playfield pixels.
   * @param {number} y Pointer y in playfield pixels.
   * @param {number} gain The gain for the kind of input in use (Input.gain()); the mouse gain by default.
   * @returns {{x: number, y: number}}
   */
  pointerToPlayfield(x, y, gain = this.mouseGain) {
    const cx = this.W / 2;
    const cy = this.H / 2;
    const px = Math.max(0, Math.min(this.W - 1, cx + (x - cx) * gain));
    const py = Math.max(0, Math.min(this.H - 1, cy + (y - cy) * gain));
    return { x: px, y: py };
  }

  /**
   * Draw text centred on a point.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} text
   * @param {{x: number, y: number, size: number, colour: number[], alpha?: number, bold?: boolean, italic?: boolean,
   *          align?: string}} style
   *        `size` is in the Python game's font units at the reference resolution (scaled here). `x` is the
   *        centre of the text, or its left or right end with `align` 'left' or 'right'.
   * @returns {{x: number, y: number, w: number, h: number}} Bounding box, for hit tests.
   */
  text(ctx, text, { x, y, size, colour, alpha = 0.8, bold = false, italic = false, outline = [0, 0, 0], align = 'center' }) {
    const px = this.fontPx(size);
    ctx.font = this.font(size, bold, italic);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (outline) {
      // An outline (an [r, g, b] colour, black unless a caller passes its own or null) drawn under the fill, so
      // text stays legible over a busy background: the spinning card, the brick field, the level backdrops
      ctx.strokeStyle = rgba(outline, alpha);
      ctx.lineWidth = Math.max(1, px * 0.1);
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = rgba(colour, alpha);
    ctx.fillText(text, x, y);
    const m = ctx.measureText(text);
    const h = (m.actualBoundingBoxAscent || px * 0.7) + (m.actualBoundingBoxDescent || px * 0.2);
    const left = align === 'left' ? x : align === 'right' ? x - m.width : x - m.width / 2;
    return { x: left, y: y - h / 2, w: m.width, h };
  }

  /** The width `text()` would give a string, in canvas pixels, without drawing it. */
  textWidth(ctx, text, { size, bold = false, italic = false }) {
    ctx.font = this.font(size, bold, italic);
    return ctx.measureText(text).width;
  }

  /** The pixel size of a font `size` in the Python game's units. */
  fontPx(size) {
    return Math.max(4, Math.round(size * 0.72 * this.scale));
  }

  font(size, bold = false, italic = false) {
    return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${this.fontPx(size)}px Arial, Helvetica, sans-serif`;
  }

  /**
   * An image shrunk to a height, for drawing at that size frame after frame (the gate's balls, the bricks the
   * level banner introduces). Kept, and made again only when the size changes: shrinking a full-size sprite on
   * every frame is slow on a phone.
   *
   * @param {HTMLImageElement} img
   * @param {number} px Height in canvas pixels.
   * @returns {HTMLCanvasElement}
   */
  icon(img, px) {
    const height = Math.max(1, Math.round(px));
    const kept = this.icons.get(img);
    if (kept && kept.px === height) return kept.canvas;
    const canvas = scaleImage(img, height);
    this.icons.set(img, { px: height, canvas });
    return canvas;
  }

  // --- Glow trails ------------------------------------------------------------------------------------------
  //
  // The Python version accumulates glows in a surface and subtracts a little alpha from it every frame. The
  // obvious canvas equivalent (a `destination-out` fill) multiplies alpha rather than subtracting it, and in an
  // 8-bit canvas that never quite reaches zero, so every trail ever drawn leaves a faint ghost. Instead each
  // glow is kept as a timed mark and redrawn every frame with an alpha that falls linearly to zero over the
  // fade lifetime, then forgotten. A few hundred small drawImage calls a frame is nothing to the canvas.

  /**
   * Record a glow blob.
   *
   * @param {HTMLCanvasElement} glow
   * @param {number} x Top-left.
   * @param {number} y
   */
  addGlow(glow, x, y) {
    this.trailMarks.push({ img: glow, x, y, t: this.trailClock });
  }

  /**
   * Advance the trail clock and forget glows that have faded completely.
   *
   * @param {number} dt Seconds.
   * @param {number} rate Alpha units (0..255) per second; a glow lasts 255 / rate seconds.
   */
  fadeTrails(dt, rate) {
    this.trailClock += dt;
    this.trailLifetime = 255 / rate;
    const cutoff = this.trailClock - this.trailLifetime;
    let drop = 0;
    while (drop < this.trailMarks.length && this.trailMarks[drop].t < cutoff) drop++;
    if (drop) this.trailMarks.splice(0, drop);
  }

  /** Draw the live glows, oldest first, each at an alpha that falls with its age. */
  drawTrails(ctx) {
    for (const m of this.trailMarks) {
      const alpha = 1 - (this.trailClock - m.t) / this.trailLifetime;
      if (alpha <= 0) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(m.img, m.x, m.y);
    }
    ctx.globalAlpha = 1;
  }

  /** Forget every glow. */
  clearTrails() {
    this.trailMarks = [];
  }
}
