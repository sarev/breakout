// The things in the game: balls, bats, bricks and laser bolts. A direct port of the classes in breakout.py.
//
// Positions are playfield pixels, velocities are playfield pixels per second, and every `move()` takes the
// length of one physics sub-step. Each entity holds references to the graphics (for sizes and sprites) and the
// game (for the clock, the speed model and sounds).

import {
  BAT_ANGLE_JITTER, BAT_FADE_SECONDS, BAT_HIT_COOLDOWN, BAT_HIT_SPEED_GAIN, BAT_LIFETIME, BAT_VELOCITY_SMOOTHING,
  BRICK_COLOURS, BRICK_LIVES, INTRO_DAMPING, MAX_BAT_ANGLE,
} from './config.js';
import { rgba } from './graphics.js';

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

export class Laser {
  /**
   * @param {HTMLCanvasElement} image
   * @param {number} speed Pixels per second (upwards).
   * @param {number} x Centre.
   * @param {number} y Centre.
   */
  constructor(image, speed, x, y) {
    this.image = image;
    this.x = x;
    this.y = y;
    this.vy = -speed;
    this.width = image.width;
    this.height = image.height;
    this.w2 = Math.max(1, Math.floor(this.width / 2));
    this.h2 = Math.max(1, Math.floor(this.height / 2));
  }

  /** Advance by `dt` seconds; false once off the top of the screen. */
  move(dt) {
    this.y += this.vy * dt;
    return this.y > -this.h2;
  }

  /** Collision with a brick, using a thin vertical slice around the beam's centre. */
  checkBrick(brick) {
    const thin = Math.max(2, Math.floor(this.w2 / 2));
    const b = brick.bbox();
    if (!b) return false;
    const left = this.x - thin;
    const right = this.x + thin;
    const top = this.y - this.h2;
    const bottom = this.y + this.h2;
    return left < b.x + b.w && right > b.x && top < b.y + b.h && bottom > b.y;
  }

  draw(ctx) {
    ctx.drawImage(this.image, this.x - this.w2, this.y - this.h2);
  }
}

export class Bat {
  /**
   * @param {number} id 0 is the hero bat.
   * @param {HTMLCanvasElement} image
   * @param {HTMLCanvasElement} invImage Tinted copy shown while controls are inverted.
   * @param {object} gfx
   * @param {object} game
   * @param {number} dx Horizontal offset from the hero bat (bonus bats sit beside it).
   */
  constructor(id, image, invImage, gfx, game, dx = 0) {
    this.id = id;
    this.gfx = gfx;
    this.game = game;
    this.normalImage = image;
    this.invertedImage = invImage;
    this.inverted = false;
    this.dx = dx;
    this.vx = 0;                // Sideways speed, px/s
    this.vxSmooth = 0;          // ...smoothed over BAT_VELOCITY_SMOOTHING seconds (what the serve reads)
    this.expire = null;         // Game time this bonus bat leaves play (null = permanent hero bat)
    this.nextFire = 0;          // Game time of this bat's next laser beam (laser mode only)
    this.setImage(image);
    this.x = gfx.W / 2 + dx;
  }

  /** Adopt a (re-scaled) sprite: sizes and the resting height follow from it. */
  setImage(image) {
    this.image = this.inverted ? this.invertedImage : this.normalImage;
    this.width = this.image.width;
    this.height = this.image.height;
    this.w2 = Math.max(1, Math.floor(this.width / 2));
    this.h2 = Math.max(1, Math.floor(this.height / 2));
    // Top edge: a third of a bat height off the bottom, plus the game's lift (on a touch screen the bats sit
    // higher so that they can be seen above the fingertip that's driving them)
    this.y = this.gfx.H - Math.floor(this.height * (1.3 + this.game.batLift));
  }

  /** Re-scale after a viewport change (the game then resets `dx` from the hero bat's new width). */
  relayout(image, invImage, sx) {
    this.normalImage = image;
    this.invertedImage = invImage;
    this.x *= sx;
    this.setImage(image);
  }

  invert(force = null) {
    if (force === null || force !== this.inverted) {
      this.inverted = !this.inverted;
      this.image = this.inverted ? this.invertedImage : this.normalImage;
    }
  }

  restore() {
    this.invert(false);
  }

  bbox() {
    return { x: this.x - this.w2, y: this.y, w: this.width, h: this.height };
  }

  /**
   * Follow the control position.
   *
   * @param {number} x Target centre x (before this bat's offset).
   * @param {number} dt Seconds since the last move (0 allowed: speed becomes 0).
   */
  move(x, dt) {
    x += this.dx;
    this.vx = dt > 0 ? (x - this.x) / dt : 0;
    this.x = x;
    if (dt > 0) {
      // Exponential moving average, the same at any frame rate
      const blend = Math.min(1, dt / BAT_VELOCITY_SMOOTHING);
      this.vxSmooth += (this.vx - this.vxSmooth) * blend;
    } else {
      this.vxSmooth = 0;
    }
  }

  /** Activate a bonus bat: a fresh lifetime on the game clock. */
  reset(x) {
    this.expire = this.game.time + BAT_LIFETIME;
    this.move(x, 0);
  }

  expired() {
    return this.expire !== null && this.game.time > this.expire;
  }

  draw(ctx) {
    let alpha = 1;
    if (this.expire !== null) {
      const remain = Math.max(0, this.expire - this.game.time);
      if (remain < BAT_FADE_SECONDS) {
        // Warning fade over the last two seconds: alpha from 1 down to ~0.22, never fully gone
        alpha = (55 + 200 * (remain / BAT_FADE_SECONDS)) / 255;
      }
    }
    // A tired bat (the anti-cheat, see wipe.js) is drawn faded, so it's obvious why it isn't keeping up
    if (this.game.wipe.tired(this.game.time)) alpha = Math.min(alpha, 0.35);
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(this.image, this.x - this.w2, this.y);
    if (alpha < 1) ctx.globalAlpha = 1;
  }
}

export class Brick {
  /**
   * @param {number} id Index in the level's brick list (row-major).
   * @param {object} gfx
   * @param {object} game
   * @param {number} x Centre.
   * @param {number} y Centre.
   * @param {number} type 0..8.
   */
  constructor(id, gfx, game, x, y, type) {
    this.id = id;
    this.gfx = gfx;
    this.game = game;
    this.type = type;
    this.x = x;
    this.y = y;
    this.lives = BRICK_LIVES[type];
    this.colour = BRICK_COLOURS[type];
    // Random flips for variety (not for the metal brick, whose rivets would look odd)
    const rnd = type < 7 ? randInt(0, 3) : 0;
    this.flipX = (rnd & 1) === 1;
    this.flipY = (rnd & 2) === 2;
    this.setSize(gfx.brickSize);
  }

  setSize(size) {
    this.width = size;
    this.height = size;
    this.w2 = Math.max(1, Math.floor(size / 2));
    this.h2 = Math.max(1, Math.floor(size / 2));
  }

  /**
   * Bounding box, or null once the brick is destroyed (so nothing collides with the explosion).
   *
   * @param {boolean} internal True to return the box regardless.
   */
  bbox(internal = false) {
    if (internal || this.lives > 0) {
      return { x: this.x - this.w2, y: this.y - this.h2, w: this.width, h: this.height };
    }
    return null;
  }

  /** Gone from play: the explosion has finished, or it's the indestructible kind (never counts as remaining). */
  expired() {
    return this.lives < -20 || this.lives === 99;
  }

  /**
   * Draw the brick, or its explosion (a shrinking flash that advances one step per draw).
   *
   * @returns {boolean} True if the brick still counts towards the level (not expired).
   */
  draw(ctx) {
    if (this.lives > 0) {
      const img = this.gfx.brickImages[this.type];
      if (this.flipX || this.flipY) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.drawImage(img, -this.w2, -this.h2);
        ctx.restore();
      } else {
        ctx.drawImage(img, this.x - this.w2, this.y - this.h2);
      }
    } else if (this.lives >= -20) {
      let radius = this.h2;
      if (this.lives !== 0) radius = Math.floor((radius / 20) * (20 + this.lives));
      if (radius > 0) {
        ctx.fillStyle = rgba(this.colour);
        ctx.beginPath();
        ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      this.lives -= 1;
    }
    return !this.expired();
  }

  /**
   * Take a hit.
   *
   * @param {number} x Impact x, for stereo panning.
   * @param {number|null} volume Hit-sound volume, or null for full.
   * @param {boolean} kill Destroy outright.
   */
  hit(x, volume = null, kill = false) {
    if (this.lives < 0) return;
    const pan = x / this.gfx.W;
    if (this.lives === 99) {
      this.game.sfx.play(`explode${this.type}`, pan, volume === null ? 1 : volume);
      return;
    }
    if (this.lives > 0) this.lives = kill ? 0 : this.lives - 1;
    if (this.lives > 0) {
      this.game.sfx.play('brick-hit', pan, volume === null ? 1 : volume);
    } else {
      this.game.sfx.play(`explode${this.type}`, pan, 1);
    }
  }
}

export class Ball {
  /**
   * @param {HTMLCanvasElement} image
   * @param {HTMLCanvasElement} glow
   * @param {object} gfx
   * @param {object} game
   * @param {number} x
   * @param {number} y
   * @param {object} opts {vx, vy, lives, intro, serveOnDrop}
   */
  constructor(image, glow, gfx, game, x, y, { vx = 0, vy = 0, lives = 2, intro = false, serveOnDrop = false } = {}) {
    this.gfx = gfx;
    this.game = game;
    this.setImage(image, glow);
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.lives = lives;         // Drops allowed before removal (null = immortal)
    this.intro = intro;
    this.serveOnDrop = serveOnDrop;
    this.dropped = false;       // Set by move() when it falls off the bottom; the game reads and clears it
    this.lastBatHit = -1e9;     // Game time of the most recent bat contact (speed-gain cool-off)
  }

  setImage(image, glow) {
    this.image = image;
    this.glow = glow;
    this.width = image.width;
    this.height = image.height;
    this.w2 = Math.max(1, Math.floor(this.width / 2));
    this.h2 = Math.max(1, Math.floor(this.height / 2));
  }

  bbox() {
    return { x: this.x - this.w2, y: this.y - this.h2, w: this.width, h: this.height };
  }

  draw(ctx) {
    const px = this.x - this.w2;
    const py = this.y - this.h2;
    ctx.drawImage(this.image, px, py);
    this.gfx.addGlow(this.glow, px, py);
  }

  /** Add `amount` px/s of speed without changing direction (the next move() clamps to the ceiling). */
  kick(amount) {
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 0) {
      const f = (speed + amount) / speed;
      this.vx *= f;
      this.vy *= f;
    }
  }

  /**
   * Integrate over `dt` seconds, clamp speed, bounce off the walls, and handle the floor.
   *
   * @param {number} dt
   * @param {number} level
   */
  move(dt, level = 1) {
    const gfx = this.gfx;
    const minVertical = 60 * gfx.scale;
    let minSpeed = 0;

    if (!this.intro) {
      minSpeed = this.game.minBallSpeed(level);
      const maxSpeed = this.game.maxBallSpeed(level);
      const speed = Math.hypot(this.vx, this.vy);
      if (speed === 0) {
        this.vx = 0;
        this.vy = -minSpeed;
      } else if (speed < minSpeed) {
        const f = minSpeed / speed;
        this.vx *= f;
        this.vy *= f;
      } else if (speed > maxSpeed) {
        const f = maxSpeed / speed;
        this.vx *= f;
        this.vy *= f;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.intro) {
      const retain = Math.pow(INTRO_DAMPING, dt);
      this.vx *= retain;
      this.vy *= retain;
    }

    const damp = this.intro ? 0.7 : 1;
    const adjustDirection = () => {
      // Very horizontal motion is nudged more vertical so the ball can't skate between the side walls for ever
      const threshold = 0.35;
      if (this.vx !== 0 && Math.abs(this.vy / this.vx) < threshold) {
        this.vy = (this.vy < 0 ? -1 : 1) * Math.abs(this.vx) * threshold;
      }
    };
    const wallSound = () => {
      this.game.sfx.play('wall-hit', this.x / gfx.W, this.game.velocityToVolume(this.vx, this.vy));
    };

    if (this.x < this.w2) {
      this.x = this.w2;
      this.vx = -this.vx * damp;
      if (this.vy === 0) this.vy = minVertical;
      adjustDirection();
      wallSound();
    } else if (this.x > gfx.W - this.w2) {
      this.x = gfx.W - this.w2;
      this.vx = -this.vx * damp;
      if (this.vy === 0) this.vy = minVertical;
      adjustDirection();
      wallSound();
    }

    if (this.y < this.h2) {
      this.y = this.h2;
      this.vy = -this.vy * damp;
      wallSound();
    } else if (this.y > gfx.H - this.h2) {
      if (this.intro) {
        this.y = gfx.H - this.h2;
        this.vy = -this.vy * damp;
        wallSound();
      } else {
        // Fell off the bottom
        if (this.lives !== null && this.lives > 0) this.lives -= 1;
        this.game.sfx.play('drop', this.x / gfx.W);
        this.dropped = true;
        if (this.serveOnDrop) {
          // The hero ball stops dead; the game puts it back on the bat to be served
          this.vx = 0;
          this.vy = 0;
        } else {
          // A bonus ball re-enters from a side, heading up and inwards, at the minimum speed
          const angle = (rand(20, 70) * Math.PI) / 180;
          const vx = Math.sin(angle) * minSpeed;
          const vy = -Math.cos(angle) * minSpeed;
          if (Math.random() < 0.5) {
            this.x = 0;
            this.vx = vx;
          } else {
            this.x = gfx.W - 1;
            this.vx = -vx;
          }
          // Just above the bats, so it never re-enters inside one
          this.y = Math.min(gfx.H * 0.8, this.game.bats[0].y - this.height);
          this.vy = vy;
        }
      }
    }
  }

  /**
   * Collision with a bat: rounded ends reflect about the contact normal; the flat top aims the ball by where it
   * landed (centre straight up, ends out to MAX_BAT_ANGLE). A hit adds a slice of speed, subject to the cool-off.
   *
   * @returns {boolean} True if there was a contact.
   */
  checkBat(bat) {
    const a = this.bbox();
    const b = bat.bbox();
    if (!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)) return false;

    const batLeft = bat.x - bat.w2;
    const batRight = bat.x + bat.w2;
    const capRadius = bat.h2;

    const resolveCap = (cx, cy) => {
      const distance = Math.hypot(this.x - cx, this.y - cy);
      if (distance >= capRadius + this.h2) return false;
      const overlap = capRadius + this.h2 - distance;
      const normal = Math.atan2(this.y - cy, this.x - cx);
      this.x += Math.cos(normal) * overlap;
      this.y += Math.sin(normal) * overlap;
      const speed = Math.hypot(this.vx, this.vy);
      this.vx = speed * Math.cos(normal);
      this.vy = speed * Math.sin(normal);
      return true;
    };

    if (this.x < batLeft + capRadius) {
      if (!resolveCap(batLeft + capRadius, bat.y + capRadius)) return false;
    } else if (this.x > batRight - capRadius) {
      if (!resolveCap(batRight - capRadius, bat.y + capRadius)) return false;
    } else {
      // Flat top: aim by landing position
      this.y = bat.y - this.h2;
      const offset = Math.max(-1, Math.min(1, (this.x - bat.x) / bat.w2));
      const jitter = (Math.random() * 2 - 1) * BAT_ANGLE_JITTER;
      const angle = ((offset * MAX_BAT_ANGLE + jitter) * Math.PI) / 180;
      const speed = Math.hypot(this.vx, this.vy);
      this.vx = speed * Math.sin(angle);
      this.vy = -speed * Math.cos(angle);
    }

    this.game.sfx.play('bat-hit', this.x / this.gfx.W, this.game.velocityToVolume(this.vx, this.vy));

    // A flurry of contacts (the bat swept into the ball at an end cap) only adds speed once
    const now = this.game.time;
    if (now - this.lastBatHit >= BAT_HIT_COOLDOWN) {
      const gain = BAT_HIT_SPEED_GAIN[this.game.difficulty] * this.game.targetBallSpeed(this.game.level);
      this.kick(gain);
    }
    this.lastBatHit = now;
    return true;
  }

  /**
   * Collision with a brick: edges snap and reflect one component; corners reflect about the corner normal.
   *
   * @returns {boolean} True if there was a contact (the brick has been hit).
   */
  checkBrick(brick) {
    const b = brick.bbox();
    if (!b) return false;
    const a = this.bbox();
    if (!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)) return false;

    const left = brick.x - brick.w2;
    const right = brick.x + brick.w2;
    const top = brick.y - brick.h2;
    const bottom = brick.y + brick.h2;
    const vol = () => this.game.velocityToVolume(this.vx, this.vy);

    let cornerX;
    let cornerY;
    if (this.x < left) {
      if (this.y < top) {
        [cornerX, cornerY] = [left, top];
      } else if (this.y > bottom) {
        [cornerX, cornerY] = [left, bottom];
      } else {
        this.x = left - this.w2;
        this.vx = -Math.abs(this.vx);
        brick.hit(this.x, vol());
        return true;
      }
    } else if (this.x > right) {
      if (this.y < top) {
        [cornerX, cornerY] = [right, top];
      } else if (this.y > bottom) {
        [cornerX, cornerY] = [right, bottom];
      } else {
        this.x = right + this.w2;
        this.vx = Math.abs(this.vx);
        brick.hit(this.x, vol());
        return true;
      }
    } else if (this.y < top) {
      this.y = top - this.h2;
      this.vy = -Math.abs(this.vy);
      brick.hit(this.x, vol());
      return true;
    } else {
      this.y = bottom + this.h2;
      this.vy = Math.abs(this.vy);
      brick.hit(this.x, vol());
      return true;
    }

    const distance = Math.hypot(this.x - cornerX, this.y - cornerY);
    if (distance < this.h2) {
      const overlap = this.h2 - distance;
      const normal = Math.atan2(this.y - cornerY, this.x - cornerX);
      this.x += Math.cos(normal) * overlap;
      this.y += Math.sin(normal) * overlap;
      const speed = Math.hypot(this.vx, this.vy);
      this.vx = speed * Math.cos(normal);
      this.vy = speed * Math.sin(normal);
      brick.hit(this.x, vol());
      return true;
    }
    return false;
  }

  /** Elastic collision with another ball of the same size and mass. */
  checkBall(other) {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    const dist = Math.hypot(dx, dy);
    // The balls touch when their centres are the two radii apart: the balls in play are all one size, but the
    // intro's hero ball is bigger than the rest
    const sumR = this.w2 + other.w2;
    if (dist >= sumR || dist === 0) return false;
    const overlap = sumR - dist;
    const nx = dx / dist;
    const ny = dy / dist;
    // Masses go with area, so a big ball shoves a small one aside and is barely deflected itself; equal sizes
    // give the usual half-and-half. The separation and the impulse are both shared out by mass.
    const m1 = this.w2 * this.w2;
    const m2 = other.w2 * other.w2;
    const share1 = m2 / (m1 + m2);   // This ball's share of the correction (the lighter it is, the more it moves)
    const share2 = m1 / (m1 + m2);
    this.x -= overlap * share1 * nx;
    this.y -= overlap * share1 * ny;
    other.x += overlap * share2 * nx;
    other.y += overlap * share2 * ny;
    const vn = (this.vx - other.vx) * nx + (this.vy - other.vy) * ny;
    const damp = this.intro ? 0.7 : 1;
    this.vx -= vn * nx * damp * 2 * share1;
    this.vy -= vn * ny * damp * 2 * share1;
    other.vx += vn * nx * damp * 2 * share2;
    other.vy += vn * ny * damp * 2 * share2;
    const vol = Math.min(8, Math.sqrt(Math.abs(vn) / 60)) / 8;
    this.game.sfx.play('ball-hit', this.x / this.gfx.W, vol);
    return true;
  }
}
