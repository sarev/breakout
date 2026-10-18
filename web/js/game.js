// The Game: owns the playfield state and advances it. A port of the Game class in breakout.py.

import {
  BASE_BALL_SPEED, BLACKOUT_HOLD, BLACKOUT_RATE, BORING_TIMEOUT, COLOURS, DEBUG_LIVES, ENDGAME_SPEED_BOOST,
  FULL_VOLUME_SPEED, INVERSION_SECONDS, KICK_SPEED_GAIN, LASER_DURATION, LASER_PERIOD, LASER_SPEED_FACTOR,
  LASER_STAGGER, LEVEL_DEFS, LEVEL_SPEED_RAMP, MAX_BALLS, MAX_SPEED_FRACTION, MIN_SPEED_FRACTION,
  MOBILE_BAT_LIFT, NET_GAP, NET_HOLD, NET_PULSE, NET_THICKNESS, NET_TRAVEL, PHYSICS_HZ,
  RANDOM_BRICK_TYPES, REGEN_FRACTION, REGEN_INTERVAL, REGEN_PATIENCE, SERVE_FLICK_GAIN, SERVE_JITTER,
  SERVE_MAX_ANGLE, SERVE_TIMEOUT, STARTING_LIVES, TRAIL_FADE_GAME, WIPE_TIRED_SPEED,
} from './config.js';
import { Ball, Bat, Brick, Laser } from './entities.js';
import { tintImage } from './graphics.js';
import { TiltSteer } from './tilt.js';
import { WipeDetector } from './wipe.js';

// Where each bat sits relative to the hero bat (id 0), in hero-bat widths: the bonus bats alternate left and right
const BAT_OFFSETS = [0, -1, 1, -2, 2, -3, 3];

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/**
 * Split a frame time into fixed-rate physics sub-steps.
 *
 * @param {number} dt
 * @returns {[number, number]} [number of steps, step length]
 */
export function substeps(dt) {
  const n = Math.max(1, Math.ceil(dt * PHYSICS_HZ));
  return [n, dt / n];
}

export class Game {
  /**
   * @param {object} gfx Graphics.
   * @param {object} sfx Sound effects.
   * @param {object} input Input (pointer and keys).
   * @param {object} opts {debug, mobile}: mobile raises the bats clear of the fingertip (see Bat.setImage).
   */
  constructor(gfx, sfx, input, { debug = false, mobile = false } = {}) {
    this.gfx = gfx;
    this.sfx = sfx;
    this.input = input;
    this.debug = debug;
    this.batLift = mobile ? MOBILE_BAT_LIFT : 0;   // In bat heights; read by Bat when it lays itself out
    this.wipe = new WipeDetector(gfx);             // Anti-cheat: tires the bat if it's wiped back and forth
    this.steer = mobile ? new TiltSteer() : null;  // Rolling the phone steers the bat on Insane (main.js feeds it)
    this.tiltBat = false;                          // Insane: the bat follows the phone's roll, not the finger

    this.bats = [];
    this.extraBats = [];
    this.balls = [];
    this.bricks = [];
    this.lasers = [];
    this.bricksTotal = 0;
    this.bricksRemaining = 0;

    this.time = 0;              // The pausable game clock (seconds); every timer runs off it
    this.running = true;
    this.paused = false;
    this.darkAlpha = null;      // Blackout state: negative = darkening, positive = clearing, null = off
    this.inversionRemaining = 0;
    this.laserRemaining = 0;
    this.haze = 0;              // Red lens bricks broken this level: each blurs and reddens the view further
    this.regen = null;          // {left, nextAt, waitingSince} while a regenerator is bringing bricks back
    this.net = null;            // The safety net while it's about: {y (its top), holdUntil, leaving}
    this.boringDeadline = 0;
    this.serving = false;
    this.serveDeadline = 0;
    this.level = 1;
    this.difficulty = 0;
    this.playSeconds = 0;       // Time in play this game (the game clock: no banners, no pauses), for the certificate
    this.startedAt = null;      // Wall-clock Date the first level began, for the certificate
    this.lowestBrick = 0;

    this.buildSprites();
    this.heroBall = new Ball(this.sprites.ball, this.sprites.blueGlow, gfx, this, 0, 0, { serveOnDrop: true });
    this.reset();
  }

  /** Derive the bat and ball sprites (including the inverted bat tint) from the graphics' current scale. */
  buildSprites() {
    const s = this.gfx.sprites;
    this.sprites = {
      ...s,
      invBat: tintImage(s.bat, [255, 224, 128]),
      invBonusBat: tintImage(s.bonusBat, [255, 224, 128]),
    };
    this.laserSpeed = this.gfx.H * LASER_SPEED_FACTOR;
    if (this.bats.length === 0 && this.extraBats.length === 0) {
      const hero = new Bat(0, this.sprites.bat, this.sprites.invBat, this.gfx, this);
      this.bats = [hero];
      for (let i = 1; i < 7; i++) {
        this.extraBats.push(new Bat(i, this.sprites.bonusBat, this.sprites.invBonusBat, this.gfx, this, BAT_OFFSETS[i] * hero.width));
      }
    }
  }

  // --- Levels -----------------------------------------------------------------------------------------------

  static get maxLevel() {
    return LEVEL_DEFS.length;
  }

  static levelDef(level) {
    return LEVEL_DEFS[level - 1];
  }

  static columns(level) {
    return LEVEL_DEFS[level - 1][0].length;
  }

  get lives() {
    return this.heroBall.lives;
  }

  set lives(value) {
    this.heroBall.lives = value;
  }

  get inverted() {
    return this.inversionRemaining > 0;
  }

  /** Reset for a new game. */
  reset(level = 1) {
    this.level = level;
    this.paused = false;
    this.running = true;
    this.lives = this.debug ? DEBUG_LIVES : STARTING_LIVES + (2 - this.difficulty);   // A cheat, for testing
    this.playSeconds = 0;
    this.startedAt = null;
    this.balls = [this.heroBall];
    this.gfx.buildBackground(this.level);
    this.input.centre();
    this.bats[0].x = this.gfx.W / 2;
  }

  /** Lay out a level's bricks and put the hero ball on the bat ready to serve. */
  initialiseLevel() {
    this.gfx.buildBricks(Game.columns(this.level));
    this.createBricks();
    this.haze = 0;   // The haze lasts for the rest of a level, and no further
    this.net = null;
    this.regen = null;
    if (!this.startedAt) this.startedAt = new Date();   // The first level of the game: stamped on the certificate
    this.input.centre();
    this.bats[0].x = this.gfx.W / 2;
    this.wipe.reset(this.gfx.W / 2, this.time);
    if (this.steer) this.steer.level();   // However the phone is held as the level starts is level
    this.boringDeadline = this.time + BORING_TIMEOUT;
    this.darkAlpha = null;
    this.clearInversion();
    while (this.bats.length > 1) this.extraBats.push(this.bats.pop());
    this.balls.length = 1;
    this.lasers = [];
    this.laserRemaining = 0;
    this.gfx.clearTrails();
    this.startServe();
  }

  createBricks() {
    this.bricks = [];
    const rows = Game.levelDef(this.level);
    const size = this.gfx.brickSize;
    this.bottomEdge = size * rows.length;
    this.lowestBrick = this.bottomEdge + this.heroBall.height;
    const mix = RANDOM_BRICK_TYPES[this.difficulty];
    // Red lens bricks: the layouts carry Hard's full set (one on level 4, two on 5, three on 6); Medium keeps
    // only the first on any level, and Easy has none. The rest become ordinary bricks.
    let lensesLeft = this.difficulty >= 2 ? Infinity : (this.difficulty === 1 ? 1 : 0);
    let id = 0;
    rows.forEach((row, yn) => {
      const y = Math.floor(size / 2) + yn * size;
      row.forEach((cell, xn) => {
        const x = Math.floor(size / 2) + xn * size;
        let type = cell;
        if (type === 9 && lensesLeft > 0) {
          lensesLeft -= 1;
        } else if (type === 9) {
          type = mix[randInt(0, 9)];
        } else if (type === 0) {
          type = mix[randInt(0, 9)];
        } else if (this.difficulty === 0 && (type === 7 || type === 4)) {
          type = 0;   // Easy: no metal or black hole bricks
        } else if (this.difficulty === 1 && type === 4) {
          type = 0;   // Medium: no black hole bricks
        } else if (this.difficulty < 2 && type === 5) {
          type = 3;   // Easy and medium: extra lives instead of inversion
        }
        this.bricks.push(new Brick(id++, this.gfx, this, x, y, type));
      });
    });
    this.bricksTotal = this.countLiveBricks();
    this.bricksRemaining = this.bricksTotal;
  }

  /**
   * End the yellow brick's reversed controls at once: at a level start, and when a game ends, so the intro's
   * pointer isn't left mirrored (which once sent a click on Help to Credits).
   */
  clearInversion() {
    this.inversionRemaining = 0;
    this.input.setInverted(false);
    for (const bat of this.bats.concat(this.extraBats)) bat.restore();
  }

  countLiveBricks() {
    let n = 0;
    for (const b of this.bricks) if (b.lives > 0 && b.lives < 99) n++;
    return n;
  }

  clearedFraction() {
    return this.bricksTotal > 0 ? 1 - this.bricksRemaining / this.bricksTotal : 0;
  }

  /** Re-scale everything after the viewport changed. */
  relayout(sx, sy) {
    this.buildSprites();
    if (this.steer) this.steer.level();   // The phone has been turned round: however it's held now is level
    const allBats = this.bats.concat(this.extraBats);
    for (const bat of allBats) {
      bat.relayout(bat.id === 0 ? this.sprites.bat : this.sprites.bonusBat,
        bat.id === 0 ? this.sprites.invBat : this.sprites.invBonusBat, sx);
    }
    // The bonus bats sit side by side with the hero bat, so their offsets follow its width, which can change by
    // more than the viewport did (the bats are drawn wider on a phone in landscape than in portrait)
    const heroWidth = allBats.find((bat) => bat.id === 0).width;
    for (const bat of allBats) bat.dx = BAT_OFFSETS[bat.id] * heroWidth;
    if (this.net) this.net.y *= sy;
    for (const ball of this.balls) {
      ball.setImage(ball === this.heroBall ? this.sprites.ball : this.sprites.bonusBall,
        ball === this.heroBall ? this.sprites.blueGlow : this.sprites.redGlow);
      ball.x *= sx; ball.y *= sy; ball.vx *= sx; ball.vy *= sy;
    }
    this.gfx.buildBackground(this.level);
    if (this.bricks.length) {
      this.gfx.buildBricks(Game.columns(this.level));
      const size = this.gfx.brickSize;
      const cols = Game.columns(this.level);
      for (const brick of this.bricks) {
        const row = Math.floor(brick.id / cols);
        const col = brick.id % cols;
        brick.setSize(size);
        brick.x = Math.floor(size / 2) + col * size;
        brick.y = Math.floor(size / 2) + row * size;
      }
      this.bottomEdge = size * Game.levelDef(this.level).length;
      this.lowestBrick = this.bottomEdge + this.heroBall.height;
    }
    for (const laser of this.lasers) { laser.x *= sx; laser.y *= sy; laser.vy = -this.laserSpeed; }
    if (this.serving) this.holdHeroBall();
  }

  // --- Speed model ------------------------------------------------------------------------------------------

  targetBallSpeed(level) {
    const boost = 1 + ENDGAME_SPEED_BOOST * this.clearedFraction();
    return BASE_BALL_SPEED[this.difficulty] * Math.pow(LEVEL_SPEED_RAMP, level - 1) * boost * this.gfx.scale;
  }

  minBallSpeed(level) {
    return MIN_SPEED_FRACTION * this.targetBallSpeed(level);
  }

  maxBallSpeed(level) {
    return MAX_SPEED_FRACTION * this.targetBallSpeed(level);
  }

  velocityToVolume(vx, vy) {
    const full = FULL_VOLUME_SPEED * this.gfx.scale;
    return Math.min(full, Math.hypot(vx, vy)) / full;
  }

  // --- Serving ----------------------------------------------------------------------------------------------

  startServe() {
    this.serving = true;
    this.serveDeadline = this.time + SERVE_TIMEOUT;
    this.heroBall.vx = 0;
    this.heroBall.vy = 0;
    this.holdHeroBall();
  }

  holdHeroBall() {
    const bat = this.bats[0];
    this.heroBall.x = bat.x;
    this.heroBall.y = bat.y - this.heroBall.h2 - 1;
  }

  /** Launch the waiting ball, aimed by the bat's smoothed sideways speed. */
  serve() {
    if (!this.serving) return;
    this.serving = false;
    const speed = this.targetBallSpeed(this.level);
    const flick = this.bats[0].vxSmooth * SERVE_FLICK_GAIN;
    const limit = (SERVE_MAX_ANGLE * Math.PI) / 180;
    let angle = Math.atan2(flick, speed) + (rand(-SERVE_JITTER, SERVE_JITTER) * Math.PI) / 180;
    angle = Math.max(-limit, Math.min(limit, angle));
    this.heroBall.vx = speed * Math.sin(angle);
    this.heroBall.vy = -speed * Math.cos(angle);
    this.sfx.play('bat-hit', this.heroBall.x / this.gfx.W, 0.5);
  }

  /**
   * Where the hero bat should be: the control position with the mouse gain applied, or on Insane the phone's
   * roll mapped across the bat's travel (the yellow brick reverses that too). Until the accelerometer has
   * delivered a reading the finger steers as usual, so a phone without one still has a playable game.
   */
  batTargetX() {
    if (this.tiltBat && this.steer && this.steer.active) {
      const gfx = this.gfx;
      let pos = this.steer.position(gfx.W >= gfx.H);
      if (this.inverted) pos = -pos;
      return gfx.W / 2 + pos * (gfx.W / 2 - this.bats[0].w2);
    }
    return this.input.playfield().x;
  }

  kickAllBalls() {
    const amount = KICK_SPEED_GAIN * this.targetBallSpeed(this.level);
    for (const ball of this.balls) ball.kick(amount);
  }

  // --- Brick effects ----------------------------------------------------------------------------------------

  addBonusBall(lives = 2) {
    if (this.balls.length >= MAX_BALLS) return null;
    const x = Math.random() < 0.5 ? 0 : this.gfx.W - 1;
    const angle = (rand(5, 85) * Math.PI) / 180;
    const speed = this.targetBallSpeed(this.level) * rand(0.6, 1);
    const vx = Math.sin(angle) * speed;
    const vy = -Math.cos(angle) * speed;
    this.balls.push(new Ball(this.sprites.bonusBall, this.sprites.redGlow, this.gfx, this, x, this.gfx.H * 0.8,
      { vx: x ? -vx : vx, vy, lives }));
    return x;
  }

  brickCascade(ids) {
    const n = this.bricks.length;
    const cascade = [...new Set(ids)].filter((i) => i >= 0 && i < n && this.bricks[i].lives > 0 && this.bricks[i].lives < 99);
    for (const i of cascade) {
      const brick = this.bricks[i];
      if (brick.lives <= 0) continue;   // Already taken out by a nested cascade: don't fire its effect twice
      brick.hit(brick.x + brick.w2, null, true);
      this.killBrick(brick);
    }
  }

  /** Apply a destroyed brick's effect. */
  killBrick(brick) {
    if (this.debug) {
      console.log(`[${this.time.toFixed(2)}s] brick ${brick.id} (type ${brick.type}) destroyed; `
        + `${this.countLiveBricks()} left, ${this.balls.length} ball(s), ${this.lasers.length} laser(s)`);
    }
    switch (brick.type) {
      case 1:
        this.addBonusBall();
        break;
      case 2:
        if (this.extraBats.length) {
          this.extraBats.sort((a, b) => a.id - b.id);
          const bat = this.extraBats.shift();
          bat.reset(this.batTargetX());
          bat.nextFire = this.time + this.bats.length * LASER_STAGGER;
          this.bats.push(bat);
        }
        break;
      case 3:
        this.heroBall.lives += 1;
        break;
      case 4:
        if (this.darkAlpha === null || this.darkAlpha === 0) {
          this.darkAlpha = -1;
        } else if (this.darkAlpha > 0) {
          this.darkAlpha = -this.darkAlpha;   // Already clearing: head back to black from here
        }
        break;
      case 5:
        this.inversionRemaining = INVERSION_SECONDS;
        this.input.setInverted(true);
        for (const bat of this.bats.concat(this.extraBats)) bat.invert(true);
        break;
      case 6: {
        const cols = Game.columns(this.level);
        const row = Math.floor(brick.id / cols);
        const col = brick.id % cols;
        const ids = [];
        for (const r of [row - 1, row, row + 1]) {
          for (const c of [col - 1, col, col + 1]) {
            if (r >= 0 && c >= 0 && c < cols) ids.push(r * cols + c);
          }
        }
        this.brickCascade(ids);
        break;
      }
      case 7:
        return;
      case 8:
        if (this.laserRemaining <= 0) {
          this.bats.forEach((bat, i) => { bat.nextFire = this.time + i * LASER_STAGGER; });
        }
        this.laserRemaining += LASER_DURATION;
        break;
      case 9:
        this.haze += 1;   // Worse with every one, until the level ends
        break;
      case 10:
        this.raiseNet();
        break;
      case 11:
        this.startRegeneration();
        break;
      default:
        break;
    }
    this.boringDeadline = this.time + BORING_TIMEOUT;
  }

  // --- Per-frame update -------------------------------------------------------------------------------------

  /**
   * Advance the simulation by `dt` seconds (nothing happens while paused).
   */
  update(dt) {
    if (this.paused) return;
    this.time += dt;
    this.playSeconds += dt;
    this.bricksRemaining = this.countLiveBricks();

    this.checkInversion(dt);
    this.checkLasers(dt);
    this.animateBats(dt);
    this.animateNet(dt);
    this.regenerate();

    if (this.serving) {
      this.holdHeroBall();
      if (this.time >= this.serveDeadline) this.serve();
    }

    const [n, h] = substeps(dt);
    for (let i = 0; i < n; i++) {
      this.moveLasers(h);
      this.animateBalls(h);
    }

    this.checkBoring();
  }

  checkInversion(dt) {
    if (this.inversionRemaining <= 0) return;
    const before = this.inversionRemaining;
    const after = Math.max(0, before - dt);
    this.inversionRemaining = after;
    if (Math.floor(before) !== Math.floor(after) && after > 0) {
      const pan = this.input.effectiveX() / this.gfx.W;
      this.sfx.play(Math.floor(after) === 0 ? 'restore' : 'tick', pan);
    }
    if (after === 0) {
      for (const bat of this.bats.concat(this.extraBats)) bat.restore();
      this.input.setInverted(false);
    }
  }

  moveLasers(dt) {
    const alive = [];
    for (const laser of this.lasers) {
      if (!laser.move(dt)) continue;
      let hit = false;
      for (const brick of this.bricks) {
        if ((!brick.expired() || brick.lives === 99) && laser.checkBrick(brick)) {
          brick.hit(laser.x);
          if (brick.lives === 0) this.killBrick(brick);
          hit = true;
          break;
        }
      }
      if (!hit) alive.push(laser);
    }
    this.lasers = alive;
  }

  checkLasers(dt) {
    if (this.laserRemaining <= 0) return;
    this.laserRemaining = Math.max(0, this.laserRemaining - dt);
    if (this.laserRemaining < 1e-6) {
      this.laserRemaining = 0;
      return;
    }
    this.bats.forEach((bat, i) => {
      if (this.time >= bat.nextFire) {
        const image = i === 0 ? this.sprites.blueLaser : this.sprites.greenLaser;
        this.lasers.push(new Laser(image, this.laserSpeed, bat.x, bat.y + bat.h2));
        this.sfx.play(`laser${randInt(0, 2)}`, bat.x / this.gfx.W);
        bat.nextFire = Math.max(bat.nextFire + LASER_PERIOD, this.time);
      }
    });
  }

  checkBoring() {
    if (this.time > this.boringDeadline) {
      this.boringDeadline = this.time + BORING_TIMEOUT;
      const x = this.addBonusBall(3);
      if (x !== null) this.sfx.play('bonus', x / this.gfx.W);
    }
  }

  animateBats(dt) {
    let target = this.batTargetX();
    // The anti-cheat watches where the bat is being sent, and while it's tired the bats can only crawl towards
    // it (the hero bat's position stands for all of them: the others are at fixed offsets from it)
    this.wipe.observe(target, this.time);
    if (this.wipe.tired(this.time)) {
      const maxStep = WIPE_TIRED_SPEED * this.gfx.W * dt;
      const hero = this.bats[0];
      target = hero.x + Math.max(-maxStep, Math.min(maxStep, target - hero.x));
    }
    const lost = [];
    for (const bat of this.bats) {
      bat.move(target, dt);
      if (bat.expired()) lost.push(bat);
    }
    for (const bat of lost) {
      this.bats.splice(this.bats.indexOf(bat), 1);
      this.extraBats.push(bat);
    }
  }

  animateBalls(dt) {
    const lost = [];
    for (const ball of this.balls) {
      if (this.serving && ball === this.heroBall) continue;
      ball.move(dt, this.level);
      if (ball.dropped) {
        ball.dropped = false;
        if (ball.serveOnDrop && ball.lives > 0) {
          this.startServe();
          continue;
        }
      }
      for (const bat of this.bats) ball.checkBat(bat);
      if (ball.lives < 1) lost.push(ball);
      if (ball.y < this.lowestBrick) {
        for (const brick of this.bricks) {
          if (ball.checkBrick(brick)) {
            if (brick.lives === 0) this.killBrick(brick);
            break;
          }
        }
      }
    }
    for (const ball of lost) this.balls.splice(this.balls.indexOf(ball), 1);
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i];
        const b = this.balls[j];
        if (this.serving && (a === this.heroBall || b === this.heroBall)) continue;
        a.checkBall(b);
      }
    }
  }

  // --- Regenerator ------------------------------------------------------------------------------------------

  /**
   * A regenerator brick has been broken: queue up a share (`REGEN_FRACTION`) of the level's destructible
   * bricks to be brought back, one every `REGEN_INTERVAL` seconds. Another regenerator while that's still
   * going adds its share to the queue.
   */
  startRegeneration() {
    const share = Math.max(1, Math.round(this.bricksTotal * REGEN_FRACTION));
    if (this.regen) {
      this.regen.left += share;
    } else {
      this.regen = { left: share, nextAt: this.time + REGEN_INTERVAL, waitingSince: null };
    }
  }

  /**
   * Pop the next queued brick back in, when its time comes: into the place of a brick whose explosion has
   * finished and that no ball is in or touching (a brick appearing round a ball would trap it), as an
   * ordinary brick of the difficulty's random mix. If every such place is taken the pop waits for one, and
   * after `REGEN_PATIENCE` seconds of that the rest of the queue is dropped, so the level can still end.
   */
  regenerate() {
    const regen = this.regen;
    if (!regen || this.time < regen.nextAt) return;
    const free = this.bricks.filter((b) => b.lives < -20 && !this.ballNear(b));
    if (!free.length) {
      if (regen.waitingSince === null) regen.waitingSince = this.time;
      if (this.time - regen.waitingSince > REGEN_PATIENCE) this.regen = null;
      return;
    }
    const brick = free[randInt(0, free.length - 1)];
    brick.revive(RANDOM_BRICK_TYPES[this.difficulty][randInt(0, 9)], this.time);
    this.sfx.play('respawn', brick.x / this.gfx.W);
    regen.left -= 1;
    regen.nextAt = this.time + REGEN_INTERVAL;
    regen.waitingSince = null;
    if (regen.left <= 0) this.regen = null;
  }

  /** Whether any ball is inside, or within its own diameter of, a brick's cell. */
  ballNear(brick) {
    for (const ball of this.balls) {
      const reach = ball.height;
      if (Math.abs(ball.x - brick.x) < brick.w2 + reach && Math.abs(ball.y - brick.y) < brick.h2 + reach) return true;
    }
    return false;
  }

  // --- Safety net -------------------------------------------------------------------------------------------

  /**
   * Where the top of the net rests: a small gap under the hero bat, but never off the bottom of the screen. On a
   * phone the bats are lifted and the net floats in the space below them; on a desktop the bat sits almost on
   * the bottom edge, so the net lies flush against it, along the very bottom.
   */
  netRestY() {
    const bat = this.bats[0];
    return Math.min(bat.y + bat.height * (1 + NET_GAP), this.gfx.H - this.netThickness());
  }

  /** How thick the net is drawn, in playfield pixels. */
  netThickness() {
    return Math.max(2, this.bats[0].height * NET_THICKNESS);
  }

  /**
   * A safety net brick: send the net up from below the screen, or if it's already about, keep it for another
   * spell (and call it back if it had started to leave).
   */
  raiseNet() {
    if (this.net) {
      this.net.holdUntil = Math.max(this.net.holdUntil, this.time) + NET_HOLD;
      this.net.leaving = false;
    } else {
      this.net = { y: this.gfx.H + this.netThickness(), holdUntil: this.time + NET_TRAVEL + NET_HOLD, leaving: false };
    }
    this.sfx.play('bonus', this.bats[0].x / this.gfx.W);
  }

  /** Float the net in, hold it, then float it out and forget it. */
  animateNet(dt) {
    const net = this.net;
    if (!net) return;
    const rest = this.netRestY();
    const gone = this.gfx.H + this.netThickness();
    if (!net.leaving && this.time >= net.holdUntil) net.leaving = true;
    const target = net.leaving ? gone : rest;
    const step = ((gone - rest) / NET_TRAVEL) * dt;
    net.y += Math.max(-step, Math.min(step, target - net.y));
    if (net.leaving && net.y >= gone) this.net = null;
  }

  /**
   * The net as a floor for a ball: the y its top is at, or null when there's no net on screen or the ball is
   * already below it (one that had dropped past before the net came up falls as usual).
   *
   * @param {object} ball
   * @returns {number|null}
   */
  netFloor(ball) {
    if (!this.net || this.net.y >= this.gfx.H) return null;
    return ball.y + ball.h2 <= this.net.y + 1 ? this.net.y : null;
  }

  /**
   * Draw the net as a force field: a deep blue bar with a bright top edge, a glow spreading well above it, the
   * whole thing pulsing, and a shimmer sweeping along its length. It has to read as something alive even along
   * the very bottom of a desktop screen, where a plain bar looks like part of the desktop.
   */
  drawNet(ctx) {
    const net = this.net;
    if (!net) return;
    const W = this.gfx.W;
    const thick = this.netThickness();
    const pulse = 0.6 + 0.4 * Math.sin((2 * Math.PI * this.time) / NET_PULSE);
    const [r, g, b] = COLOURS.net;
    // Glow: mostly above the bar, where there's room for it to be seen
    const glow = ctx.createLinearGradient(0, net.y - thick * 3, 0, net.y + thick * 2);
    glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    glow.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${(0.55 * pulse).toFixed(3)})`);
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, net.y - thick * 3, W, thick * 5);
    // The bar itself: bright at the top edge, deep blue below
    const body = ctx.createLinearGradient(0, net.y, 0, net.y + thick);
    body.addColorStop(0, `rgba(230, 250, 255, ${(0.7 + 0.3 * pulse).toFixed(3)})`);
    body.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, ${(0.75 + 0.25 * pulse).toFixed(3)})`);
    body.addColorStop(1, `rgba(16, 64, 200, ${(0.8 + 0.2 * pulse).toFixed(3)})`);
    ctx.fillStyle = body;
    ctx.fillRect(0, net.y, W, thick);
    // A shimmer sweeping left to right, once every couple of pulses
    const band = W * 0.18;
    const sweep = ((this.time / (NET_PULSE * 2)) % 1) * (W + band) - band;
    const shimmer = ctx.createLinearGradient(sweep, 0, sweep + band, 0);
    shimmer.addColorStop(0, 'rgba(255, 255, 255, 0)');
    shimmer.addColorStop(0.5, 'rgba(255, 255, 255, 0.55)');
    shimmer.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = shimmer;
    ctx.fillRect(Math.max(0, sweep), net.y, Math.min(band, W - sweep), thick);
  }

  // --- Blackout ---------------------------------------------------------------------------------------------

  /**
   * Step the blackout alpha. Negative values darken (drawn as |alpha|, capped at 255) down past -255 for the
   * hold, then flip to 255 and clear to 0. The phase is decided from the sign before stepping.
   */
  static nextAlpha(alpha, dt) {
    if (alpha === null) return null;
    if (alpha < 0) {
      const darkest = -(255 + BLACKOUT_RATE * BLACKOUT_HOLD);
      alpha -= BLACKOUT_RATE * dt;
      return alpha <= darkest ? 255 : alpha;
    }
    alpha -= BLACKOUT_RATE * dt;
    return alpha < 0.5 ? null : alpha;
  }

  /** Advance the blackout and trail fades (presentation-time effects; the blackout holds while paused). */
  advanceEffects(dt) {
    if (!this.paused) this.darkAlpha = Game.nextAlpha(this.darkAlpha, dt);
    this.gfx.fadeTrails(dt, TRAIL_FADE_GAME);
  }

  // --- Drawing ----------------------------------------------------------------------------------------------

  /**
   * Draw the whole playfield.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @returns {boolean} True if every destructible brick is gone (level complete).
   */
  /**
   * Draw the frame. Under the haze of a red lens brick the playfield (backdrop, bricks, balls and bats) is drawn
   * to a layer and composited through the blur and vignette, and the HUD goes on top of that, crisp; otherwise
   * everything is drawn straight to the canvas in the same order.
   *
   * @returns {boolean} True if no destroyable bricks remain, and no regenerator is about to bring any back
   *   (the level is complete).
   */
  draw(ctx) {
    const gfx = this.gfx;
    const field = this.haze > 0 ? gfx.layerContext() : ctx;
    field.drawImage(gfx.background, 0, 0);
    gfx.drawTrails(field);

    let remaining = 0;
    for (const brick of this.bricks) if (brick.draw(field)) remaining++;
    for (const laser of this.lasers) laser.draw(field);
    for (const ball of this.balls) ball.draw(field);
    for (const bat of this.bats) bat.draw(field);
    this.drawNet(field);
    if (this.haze > 0) gfx.drawHazed(ctx, this.haze);

    // The lives sit a sixteenth of the width in, but never off the left edge: two digits (a run of extra-life
    // bricks, or the debug cheat) are wider than that on a 4:3 playfield
    const livesText = String(this.lives);
    const livesPx = Math.round(300 * 0.72 * gfx.scale);   // The font size `text()` makes of size 300
    const livesX = Math.max(gfx.W / 16, livesText.length * livesPx * 0.3 + livesPx * 0.1);
    gfx.text(ctx, livesText, { x: livesX, y: gfx.H * 0.9, size: 300, colour: COLOURS.lives, alpha: 164 / 255 });
    gfx.text(ctx, String(this.level), { x: gfx.W * 0.95, y: gfx.H * 0.9, size: 300, colour: COLOURS.level, alpha: 164 / 255 });

    this.drawBlackout(ctx);
    return remaining === 0 && !this.regen;
  }

  /** The black hole overlay, if active. */
  drawBlackout(ctx) {
    if (!this.darkAlpha) return;
    const a = Math.min(255, Math.abs(Math.trunc(this.darkAlpha))) / 255;
    if (a <= 0) return;
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(0, 0, this.gfx.W, this.gfx.H);
  }
}
