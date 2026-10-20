// The on-screen teaching: the gate's guide to the balls (the blue one is your life, the red ones are free), and
// the "Level N..." banner's introductions to each kind of brick the first time a game meets it.
//
// Both are drawn on the canvas and scale with the playfield like everything else, shrinking further if need be
// to fit a narrow (portrait) screen. The pictures come from the full-size sprites through Graphics.icon(), which
// shrinks each one once and keeps it, as scaling a 1024 px sprite down on every frame is slow on a phone.

import { BRICK_INTROS, COLOURS, GLOW_BLUE, GLOW_RED } from './config.js';

/**
 * A ball's glowing tail, as the game draws its trails: glow blobs fading along a path. This one trails off to the
 * left of the ball, away from the line of text beside it, curving up (`turn` -1) or down (1).
 *
 * @param {HTMLCanvasElement} glow The glow, already sized and tinted.
 * @param {number} cx Centre of the ball.
 * @param {number} cy
 * @param {number} length Along the path, in canvas pixels.
 * @param {number} turn -1 to curve up, 1 to curve down.
 * @param {number} alpha
 */
function drawTail(ctx, glow, cx, cy, length, turn, alpha) {
  const blobs = 36;
  const step = length / blobs;
  let x = cx;
  let y = cy;
  // Furthest (faintest) first, so the brighter blobs near the ball go on top, as the newest trail marks do
  const points = [];
  for (let i = 0; i < blobs; i++) {
    const s = i / blobs;
    const heading = turn * (0.35 + 0.95 * s);   // Radians from due left, turning up or down as it goes
    x -= step * Math.cos(heading);
    y += step * Math.sin(heading);
    points.push([x, y, 1 - s]);
  }
  for (const [px, py, strength] of points.reverse()) {
    ctx.globalAlpha = alpha * strength;
    ctx.drawImage(glow, px - glow.width / 2, py - glow.height / 2);
  }
  ctx.globalAlpha = 1;
}

/**
 * The gate's guide to the balls: the blue hero ball, which costs a life when it falls, and the red bonus balls,
 * which cost nothing. A picture and a few words each, in a block centred across the playfield.
 *
 * @param {object} gfx Graphics.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} images The loaded images (ball and bonusBall are used).
 * @param {number} y Playfield y of the first line's centre.
 * @param {number} alpha
 */
export function drawBallGuide(gfx, ctx, images, y, alpha) {
  const lines = [
    [images.ball, images.blueGlow, GLOW_BLUE, -1, 'Keep the blue ball up: if it drops, you lose a life!'],
    [images.bonusBall, images.redGlow, GLOW_RED, 1, 'Red bonus balls are free: drop as many as you like'],
  ];
  // Full size, in playfield pixels: the ball, the space after it, and from one line to the next. The text is the
  // prompt's size; the whole block shrinks to fit the playfield's width, with a margin either side (the tails
  // reach out to the left of it).
  const icon = 70 * gfx.scale;
  const gap = 28 * gfx.scale;
  const step = 95 * gfx.scale;
  const width = icon + gap + Math.max(...lines.map((line) => gfx.textWidth(ctx, line[4], { size: 60 })));
  const k = Math.min(1, (gfx.W * 0.92) / width);
  const left = (gfx.W - width * k) / 2;
  lines.forEach(([ball, glow, tint, turn, text], i) => {
    const cy = y + i * step * k;
    drawTail(ctx, gfx.icon(glow, icon * k, tint), left + (icon * k) / 2, cy, 150 * gfx.scale * k, turn, alpha * 0.5);
    ctx.globalAlpha = alpha;
    ctx.drawImage(gfx.icon(ball, icon * k), left, cy - (icon * k) / 2);
    ctx.globalAlpha = 1;
    gfx.text(ctx, text, { x: left + (icon + gap) * k, y: cy, size: 60 * k, colour: COLOURS.steel, alpha, align: 'left' });
  });
}

/**
 * The "Level N..." banner's introductions: a heading, then a card for each kind of brick new to this game (its
 * picture, its name and a few words), in centred rows between `top` and `bottom`, the cards shrunk if need be to
 * fit, and faded in one after another.
 *
 * @param {object} gfx Graphics.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} images The loaded images (brick0, brick1...).
 * @param {number[]} types The brick types to introduce, in order.
 * @param {number} elapsed Seconds since the banner went up.
 * @param {number} top Playfield y of the heading.
 * @param {number} bottom Playfield y the cards must end above.
 */
export function drawBrickIntros(gfx, ctx, images, types, elapsed, top, bottom) {
  const n = types.length;
  if (!n) return;
  const s = gfx.scale;
  const fade = (delay) => Math.max(0, Math.min(0.9, (elapsed - delay) / 0.5));
  gfx.text(ctx, n === 1 ? 'New brick' : 'New bricks', { x: gfx.W / 2, y: top, size: 70, colour: COLOURS.presskey, glow: COLOURS.neonCyan, alpha: fade(0.2) });

  // A card at full size, in playfield pixels. Fewest rows that fit across, the cards spread evenly over them
  // (eight make two rows of four, not five and three), and all of it shrunk until the rows fit the height.
  const card = { w: 430 * s, h: 245 * s, icon: 120 * s };
  const area = bottom - (top + 55 * s);
  let k = 1;
  let cols;
  let rows;
  for (;;) {
    cols = Math.max(1, Math.min(n, Math.floor((gfx.W * 0.96) / (card.w * k))));
    rows = Math.ceil(n / cols);
    cols = Math.ceil(n / rows);
    if (rows * card.h * k <= area || k < 0.4) break;
    k *= 0.9;
  }
  const first = top + 55 * s + (area - rows * card.h * k) / 2;   // The rows are centred in the space they have

  types.forEach((type, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const x = gfx.W / 2 + ((i % cols) - (inRow - 1) / 2) * card.w * k;
    const y = first + row * card.h * k;
    const alpha = fade(0.4 + 0.15 * i);
    const px = card.icon * k;
    ctx.globalAlpha = alpha;
    ctx.drawImage(gfx.icon(images[`brick${type}`], px), x - px / 2, y);
    ctx.globalAlpha = 1;
    const [name, words] = BRICK_INTROS[type];
    gfx.text(ctx, name, { x, y: y + px + 36 * k * s, size: 50 * k, colour: COLOURS.steel, alpha, bold: true });
    gfx.text(ctx, words, { x, y: y + px + 82 * k * s, size: 40 * k, colour: COLOURS.presskey, alpha });
  });
}
