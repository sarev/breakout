// Canvas, playfield geometry, sprites, backgrounds, text and the glow-trail layer.
//
// The canvas fills the browser viewport at device-pixel resolution. Inside it sits the playfield: the viewport's
// shape clamped to the allowed aspect range, centred, with black bars where the shapes differ. Every coordinate
// in the game is a playfield pixel, and `scale` says how big that is relative to the 1080p reference.

import {
  BALL_HEIGHT_PCT, BAT_HEIGHT_PCT, CHROME_RIM_REACH, CHROME_RIMS, CHROME_STOPS, COLOURS, FONT_STACK, GLOW_BLUE, GLOW_RED, HAZE_BLUR_MAX,
  HAZE_BLUR_PER_BRICK, HAZE_HALF_SIZE_BLUR, HAZE_VIGNETTE_MAX, HAZE_VIGNETTE_PER_BRICK, INTRO_HERO_SCALE, LASER_HEIGHT_PCT,
  LOGO_SHIMMER, MAX_PLAYFIELD_ASPECT, MIN_PLAYFIELD_ASPECT,
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
    this.icons = new Map();     // Image -> {px, tint, canvas}: shrunk (and tinted) copies for icon() to reuse
    this.texts = new Map();     // Text and look -> canvas: rendered text for cachedText() to reuse
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
      this.blurLayer = null;
      this.texts.clear();
      this.buildSprites();
    }
    return changed;
  }

  /**
   * An offscreen canvas for drawing a frame that is then composited through the haze (see drawHazed), in
   * playfield coordinates. Under a blur of `HAZE_HALF_SIZE_BLUR` px or more it's half the playfield's size (the
   * context scaled to suit), which is a quarter of the pixels to fill and blur, and the blur hides the
   * softness; a lighter blur, as a haze fades away, keeps full size, so the picture doesn't go soft just before
   * it goes sharp. Made on first use and kept until the playfield or that choice changes.
   *
   * @param {number} count The haze's depth (Game.haze).
   * @returns {CanvasRenderingContext2D}
   */
  layerContext(count) {
    const scale = this.hazeBlur(count) >= HAZE_HALF_SIZE_BLUR ? 0.5 : 1;
    if (!this.layer || this.layerScale !== scale) {
      this.layer = document.createElement('canvas');
      this.layer.width = Math.max(1, Math.round(this.W * scale));
      this.layer.height = Math.max(1, Math.round(this.H * scale));
      this.layerScale = scale;
    }
    const ctx = this.layer.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return ctx;
  }

  /** The haze's blur radius in canvas pixels, for a depth (Game.haze). */
  hazeBlur(count) {
    return Math.min(HAZE_BLUR_MAX, HAZE_BLUR_PER_BRICK * count) * this.scale;
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
    const px = this.hazeBlur(count);
    if (typeof ctx.filter === 'string') {
      // A half-size layer is blurred at its own size, into a second one, and only then drawn up to the playfield
      const half = this.layerScale < 1;
      if (half && (!this.blurLayer || this.blurLayer.width !== layer.width || this.blurLayer.height !== layer.height)) {
        this.blurLayer = document.createElement('canvas');
        this.blurLayer.width = layer.width;
        this.blurLayer.height = layer.height;
      }
      const out = half ? this.blurLayer.getContext('2d') : ctx;
      const w = half ? layer.width : W;
      const h = half ? layer.height : H;
      const r = px * this.layerScale;
      out.save();
      out.filter = `blur(${r.toFixed(1)}px)`;
      // Drawn a little larger than the playfield so the blur's soft edge falls outside the clip
      const pad = Math.ceil(r * 2);
      out.drawImage(layer, -pad, -pad, w + 2 * pad, h + 2 * pad);
      out.restore();
      if (half) ctx.drawImage(this.blurLayer, 0, 0, W, H);
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
      // The glows, and so the trails, tinted a clear blue and red (see GLOW_BLUE)
      blueGlow: tintImage(scaleImage(im.blueGlow, h(BALL_HEIGHT_PCT)), GLOW_BLUE),
      redGlow: tintImage(scaleImage(im.redGlow, h(BALL_HEIGHT_PCT)), GLOW_RED),
      // The intro's hero ball is bigger than a ball in play, so it's easy to see and to steer onto the menu
      introBall: scaleImage(im.ball, h(BALL_HEIGHT_PCT * INTRO_HERO_SCALE)),
      introGlow: tintImage(scaleImage(im.blueGlow, h(BALL_HEIGHT_PCT * INTRO_HERO_SCALE)), GLOW_BLUE),
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
    this.brickImages = [];   // Per type, its mirrorings as brickImage() makes them: [as drawn, ...]
    for (let i = 0; i < NUM_BRICK_TYPES; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = this.brickSize;
      canvas.height = this.brickSize;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.images[`brick${i}`], 0, 0, this.brickSize, this.brickSize);
      this.brickImages.push([canvas]);
    }
  }

  /**
   * A brick's sprite at the level's size, mirrored as asked. The mirrored copies are made on first use and kept
   * for the level: most bricks are mirrored, for variety, and drawing each through a mirroring transform every
   * frame was a measurable share of the frame.
   *
   * @param {number} type
   * @param {number} flip 0 as drawn, 1 left to right, 2 top to bottom, 3 both.
   * @returns {HTMLCanvasElement}
   */
  brickImage(type, flip = 0) {
    const set = this.brickImages[type];
    if (!set[flip]) {
      const plain = set[0];
      const canvas = document.createElement('canvas');
      canvas.width = plain.width;
      canvas.height = plain.height;
      const ctx = canvas.getContext('2d');
      ctx.translate(flip & 1 ? plain.width : 0, flip & 2 ? plain.height : 0);
      ctx.scale(flip & 1 ? -1 : 1, flip & 2 ? -1 : 1);
      ctx.drawImage(plain, 0, 0);
      set[flip] = canvas;
    }
    return set[flip];
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
   * @param {{x: number, y: number, size: number, colour?: number[], alpha?: number, bold?: boolean, italic?: boolean,
   *          outline?: number[]|null, align?: string, chrome?: boolean, glow?: number[]}} style
   *        `size` is in the Python game's font units at the reference resolution (scaled here). `x` is the
   *        centre of the text, or its left or right end with `align` 'left' or 'right'. `chrome` draws it as the
   *        logo's lettering is, polished metal lit by neon at the edges (`colour` is then unused); `glow` gives it a
   *        soft neon halo of that colour. Either is drawn once and kept (cachedText()), since shadows are slow.
   * @returns {{x: number, y: number, w: number, h: number}} Bounding box, for hit tests.
   */
  text(ctx, text, style) {
    if (style.chrome || style.glow) return this.cachedText(ctx, text, style);
    return this.drawText(ctx, text, style);
  }

  /** Draw text as `text()` describes, every time (no keeping). */
  drawText(ctx, text, {
    x, y, size, colour = COLOURS.steel, alpha = 0.8, bold = false, italic = false, outline = COLOURS.textEdge,
    align = 'center', chrome = false, glow = null,
  }) {
    const px = this.fontPx(size);
    ctx.save();
    ctx.font = this.font(size, bold, italic);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    if (glow) {
      // The halo: the text drawn with a blurred shadow of the glow colour, which the fill below then covers
      ctx.shadowColor = rgba(glow, 0.9);
      ctx.shadowBlur = px * 0.3;
      ctx.fillStyle = rgba(glow);
      ctx.fillText(text, x, y);
      ctx.shadowColor = 'transparent';
    }
    if (chrome) {
      // The neon lights round the edges: each a shadow cast a little way off in its direction, from a dark copy
      // of the text that the chrome then covers, so only the coloured fringe on that side shows
      ctx.fillStyle = rgba(COLOURS.textEdge);
      for (const [rim, dx, dy, strength] of CHROME_RIMS) {
        ctx.shadowColor = rgba(rim, strength);
        ctx.shadowOffsetX = dx * px * CHROME_RIM_REACH;
        ctx.shadowOffsetY = dy * px * CHROME_RIM_REACH;
        // Twice: a tight bright edge, then a wider soft spill
        ctx.shadowBlur = px * 0.04;
        ctx.fillText(text, x, y);
        ctx.shadowBlur = px * 0.16;
        ctx.fillText(text, x, y);
      }
      ctx.shadowColor = 'transparent';
    }
    if (outline) {
      // An outline (an [r, g, b] colour, near-black unless a caller passes its own or null) drawn under the fill,
      // so text stays legible over a busy background: the spinning card, the brick field, the level backdrops
      ctx.strokeStyle = rgba(outline);
      ctx.lineWidth = Math.max(1, px * (chrome ? 0.04 : 0.1));
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    if (chrome) {
      // Polished metal: a bright sky above a dark horizon, over the height of a capital
      const fill = ctx.createLinearGradient(0, y - px * 0.38, 0, y + px * 0.38);
      for (const [at, stop] of CHROME_STOPS) fill.addColorStop(at, stop);
      ctx.fillStyle = fill;
    } else {
      ctx.fillStyle = rgba(colour);
    }
    ctx.fillText(text, x, y);
    const m = ctx.measureText(text);
    ctx.restore();
    const h = (m.actualBoundingBoxAscent || px * 0.7) + (m.actualBoundingBoxDescent || px * 0.2);
    const left = align === 'left' ? x : align === 'right' ? x - m.width : x - m.width / 2;
    return { x: left, y: y - h / 2, w: m.width, h };
  }

  /**
   * Draw text as `text()` does, from a copy rendered once and kept: for text drawn every frame that rarely
   * changes (the HUD's lives and level, and the chrome and glowing text), since stroking, filling and shadowing
   * big text is slow next to copying an image. The copy is made at full opacity and drawn at the alpha asked
   * for, so text fading in or out doesn't make a new one every frame. The copies are forgotten when the
   * playfield changes size, or if many pile up.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} text
   * @param {object} style As for `text()`.
   * @returns {{x: number, y: number, w: number, h: number}} Bounding box of the text, for hit tests.
   */
  cachedText(ctx, text, { x, y, alpha = 0.8, align = 'center', ...look }) {
    const key = JSON.stringify([text, look]);
    let kept = this.texts.get(key);
    if (!kept) {
      if (this.texts.size > 128) this.texts.clear();
      const px = this.fontPx(look.size);
      const pad = Math.ceil(px * (look.glow ? 0.45 : look.chrome ? 0.2 : 0.1)) + 2;   // Room for the outline and glow
      const width = this.textWidth(this.ctx, text, look);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width) + 2 * pad;
      canvas.height = Math.ceil(px * 1.3) + 2 * pad;
      const box = this.drawText(canvas.getContext('2d'), text, { ...look, alpha: 1, x: canvas.width / 2, y: canvas.height / 2 });
      kept = { canvas, width, top: box.y - canvas.height / 2, h: box.h };
      this.texts.set(key, kept);
    }
    const left = align === 'left' ? x : align === 'right' ? x - kept.width : x - kept.width / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(kept.canvas, Math.round(left + kept.width / 2 - kept.canvas.width / 2), Math.round(y - kept.canvas.height / 2));
    ctx.restore();
    return { x: left, y: y + kept.top, w: kept.width, h: kept.h };
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
    return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${this.fontPx(size)}px ${FONT_STACK}`;
  }

  /**
   * An image shrunk to a height, for drawing at that size frame after frame (the gate's balls, the bricks the
   * level banner introduces). Kept, and made again only when the size changes: shrinking a full-size sprite on
   * every frame is slow on a phone.
   *
   * @param {HTMLImageElement} img
   * @param {number} px Height in canvas pixels.
   * @param {number[]} [tint] An [r, g, b] colour to multiply it by (tintImage()), as the glows are.
   * @returns {HTMLCanvasElement}
   */
  icon(img, px, tint = null) {
    const height = Math.max(1, Math.round(px));
    const kept = this.icons.get(img);
    if (kept && kept.px === height && kept.tint === tint) return kept.canvas;
    const scaled = scaleImage(img, height);
    const canvas = tint ? tintImage(scaled, tint) : scaled;
    this.icons.set(img, { px: height, tint, canvas });
    return canvas;
  }

  /**
   * Draw the Breakout logo centred on a point. A second copy is added on top (lighter) to make it shimmer, as the
   * old text title's colour wave did.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x Centre.
   * @param {number} y
   * @param {number} height In pixels at the reference resolution (scaled here).
   * @param {number} [shimmer] How brightly lit it is just now, from 0 to 1.
   */
  logo(ctx, x, y, height, shimmer = 0) {
    const img = this.icon(this.images.logo, height * this.scale);
    const left = Math.round(x - img.width / 2);
    const top = Math.round(y - img.height / 2);
    ctx.drawImage(img, left, top);
    if (shimmer > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = shimmer * LOGO_SHIMMER;
      ctx.drawImage(img, left, top);
      ctx.restore();
    }
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
