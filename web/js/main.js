// Entry point: loads the assets, wires up input, and runs the scenes (intro, splash, game) on requestAnimationFrame.
//
// Controls: mouse moves the bat, left click serves or kicks, Space pauses, M toggles music, F toggles fullscreen,
// L captures the mouse (pointer lock; Esc releases it and pauses), Q returns to the intro, and on the intro O (or
// the Options link) opens the Options page (music, fullscreen, mouse capture, help, credits), and H and C go
// straight to Help and Credits. On a touch screen the ball (intro) or the bat (play) sits under the finger, a tap
// serves or kicks, and a two-finger tap pauses and opens the Options page (music, fullscreen, help, quit), which
// stands in for the keys.
//
// A mobile device (a phone or tablet: touch, no mouse, one screen) is detected at start-up, and there the prompts
// say "tap", the mouse is never captured, the bats sit higher and (in landscape) wider so a fingertip
// doesn't hide them, and the Help page
// describes the gestures rather than the keys. ?mobile=1 or ?mobile=0 overrides the detection, for testing.
//
// ?debug=1 enables the cheats (99 lives, or ?lives=N for a given number, D clears the level, left-click destroys
// the brick under the pointer, a digit key jumps to that level (0 and - go on to 10 and 11), P saves a
// screenshot, X on the intro sets up a busy level for one). ?music=0 starts silent, ?sensitivity=1.5 scales
// mouse movement, ?volume=0.3 sets the music volume.

import { AudioSystem, Music, Sfx } from './audio.js';
import { loadAudioSet, loadImages } from './assets.js';
import { Certificate } from './certificate.js';
import {
  COLOURS, LEVEL_DEFS, MAX_BALLS, MAX_FRAME_DT, MUSIC_ENDING_DELAY, MUSIC_FILES, MUSIC_INTRO_FADE_IN, NUM_BRICK_TYPES, RANDOM_BRICK_TYPES, SOUND_NAMES,
  SPLASH_BRICK_TIME, SPLASH_MAX_TIME, SPLASH_TIME,
} from './config.js';
import { Game } from './game.js';
import { Graphics } from './graphics.js';
import { drawBallGuide, drawBrickIntros } from './guide.js';
import { Input } from './input.js';
import { Intro } from './intro.js';
import { closeModal, modalOpen, openCamera, openModal, openOptions, renderOptions, setMobile } from './ui.js';

const params = new URLSearchParams(window.location.search);
const DEBUG = params.get('debug') === '1';
// ?lives=N, in debug mode only, starts each game with that many lives instead of the debug default
const DEBUG_LIVES = DEBUG && /^[1-9]\d*$/.test(params.get('lives') || '') ? parseInt(params.get('lives'), 10) : null;
const SENSITIVITY = parseFloat(params.get('sensitivity') || '1') || 1;
// Music on or off is remembered between visits; ?music=0 still starts a visit with it off
const MUSIC_KEY = 'breakout-music';
const MUSIC_ON = params.has('music') ? params.get('music') !== '0' : readSetting(MUSIC_KEY) !== 'off';
const MUSIC_VOLUME = params.has('volume') ? parseFloat(params.get('volume')) : null;
// Whether the mouse is captured in play (the Options page, desktop only): on unless turned off, remembered
// between visits
const CAPTURE_KEY = 'breakout-capture';
// Whether the bat is steered by rolling the phone (the Options page, phones only), remembered likewise
const TILT_KEY = 'breakout-tilt';
let captureMouse = readSetting(CAPTURE_KEY) !== 'off';
let lockAnnounced = false;   // Whether this game has captured the mouse yet (the prompt says how to get it back until then)
let levelHold = null;        // Seconds a level has been waiting for the click that starts it, or null once going

/**
 * Is this a mobile device: a phone or tablet whose only pointer is a finger?
 *
 * The media query asks whether the device's primary pointer is coarse (a finger). A touch laptop has a mouse or
 * trackpad too, so it reports a fine pointer and keeps the desktop behaviour (its touch screen still works).
 * The query deliberately doesn't also ask whether the pointer can hover, which would be the textbook way to
 * spot a phone: Samsung touchscreens tell Android they can hover, so on every Samsung phone `(hover: none)` is
 * false and that test would say "desktop". The user-agent fallback covers browsers without the query, and
 * any that get the query wrong. ?mobile=1 / ?mobile=0 forces the answer, which is handy for trying the mobile
 * layout on a desktop.
 */
/** A saved setting, or null where storage is unavailable (private windows, blocked site data). */
function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) { /* no storage: the setting lasts for this visit only */ }
}

function detectMobile() {
  const forced = params.get('mobile');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  return navigator.maxTouchPoints > 0 && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
const MOBILE = detectMobile();

/** Fullscreen helpers with the WebKit-prefixed fallbacks that iOS and older browsers still need. */
const fullscreenAvailable = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
let leavingFullscreen = false;   // True while an exit we asked for is in progress (see fullscreenchange below)
function enterFullscreen() {
  const root = document.documentElement;
  try {
    const enter = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!enter) return;
    const p = enter.call(root);
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* fullscreen not permitted here; nothing to do */ }
}
function exitFullscreen() {
  try {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit) return;
    leavingFullscreen = true;
    const p = exit.call(document);
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* nothing to do */ }
}
function toggleFullscreen() {
  if (isFullscreen()) exitFullscreen(); else enterFullscreen();
}

// On a phone, fullscreen follows the orientation rather than being locked: landscape is fullscreen (that's
// where the game is playable, and the address bar would only steal height), portrait isn't (it adds nothing,
// and giving the browser back is how the player escapes without feeling trapped). A page may leave fullscreen
// whenever it likes but may only enter it from a tap, so turning to portrait drops out at once, and turning
// to landscape arms the next tap to go fullscreen. If the player backs out of fullscreen while still in
// landscape, taps leave it alone until the phone has been turned again.
const isLandscape = () => window.innerWidth > window.innerHeight;
let autoFullscreen = MOBILE;
/** Called from every tap: go fullscreen if the orientation calls for it and the player hasn't opted out. */
function fullscreenOnTap() {
  if (MOBILE && autoFullscreen && isLandscape() && !isFullscreen()) enterFullscreen();
}

const ASSET_BASE = './';    // The sprites, sounds and music folders sit beside this page, so web/ is self-contained

// Idle throttling. A page sitting on the title card or the intro shouldn't burn CPU and GPU redrawing at the
// display rate: the gate always renders at IDLE_FPS (its prompt pulses and its title's colour waves, gently
// enough for that rate), and the intro drops to it once there has been no input for IDLE_AFTER seconds and the
// balls have all but stopped (or while a Help / Credits page is open). Pages with nothing moving at all, the
// certificate and a paused game once its trails have faded and any notice has gone, drop to STILL_FPS, a
// heartbeat (a paused game was a costly picture to redraw, under the red lens's blur or the Options page's
// blurred backdrop). A click, tap or key brings the next frame forward at once (wake()), so a slow tick never
// delays an answer, and input or the balls being set moving again brings the full rate straight back. The
// splash and the game in play always run at full rate, and the browser stops the loop altogether while the
// tab is hidden.
const IDLE_FPS = 12;
const STILL_FPS = 1;
const IDLE_AFTER = 5;
const IDLE_SPEED = 60;      // Total ball speed (px/s at the reference scale) below which the intro counts as settled

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');   // The page's own loading screen, up until the first frame

/** Show a line of text on an otherwise black canvas, in place of the loading screen (error messages). */
function message(text) {
  loading.hidden = true;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
  canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#8aa8ff';
  ctx.font = `${Math.round(canvas.height / 30)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

async function boot() {
  const imageNames = {
    ball: 'ball.webp', bonusBall: 'extra-ball.webp', blueGlow: 'blue-glow.webp', redGlow: 'red-glow.webp',
    bat: 'bat.webp', bonusBat: 'extra-bat.webp', blueLaser: 'blue.webp', greenLaser: 'green.webp', intro: 'intro.webp',
  };
  for (let i = 0; i < NUM_BRICK_TYPES; i++) imageNames[`brick${i}`] = `brick${i}.webp`;
  for (let i = 1; i <= 6; i++) imageNames[`tile${i}`] = `tile${i}.webp`;

  const audio = new AudioSystem();
  const soundNames = Object.fromEntries(SOUND_NAMES.map((n) => [n, `${n}.wav`]));

  // The loading screen's bar fills a file at a time. The files differ a lot in size, but it shows things moving
  const total = Object.keys(imageNames).length + SOUND_NAMES.length + Object.keys(MUSIC_FILES).length;
  let loaded = 0;
  const fill = document.getElementById('loading-fill');
  const progress = () => { fill.style.width = `${(100 * ++loaded) / total}%`; };

  const [images, sounds, tracks] = await Promise.all([
    loadImages(`${ASSET_BASE}sprites/`, imageNames, progress),
    loadAudioSet(audio.ctx, `${ASSET_BASE}sounds/`, soundNames, progress),
    loadAudioSet(audio.ctx, `${ASSET_BASE}music/`, MUSIC_FILES, progress),
  ]);
  audio.sfx = new Sfx(audio.ctx, sounds);
  audio.music = new Music(audio.ctx, tracks, MUSIC_ON, MUSIC_VOLUME);

  const gfx = new Graphics(canvas, images, SENSITIVITY, MOBILE);
  const input = new Input(canvas, gfx, MOBILE);
  const game = new Game(gfx, audio.sfx, input, { debug: DEBUG, mobile: MOBILE, lives: DEBUG_LIVES });
  game.tiltBat = MOBILE && readSetting(TILT_KEY) === 'on';   // Kept in step with the setting (toggleTilt())
  const intro = new Intro(gfx, game, audio.sfx, input, images.intro);
  const certificate = new Certificate(gfx, MOBILE);
  const music = audio.music;
  setMobile(MOBILE);

  // --- Scenes -----------------------------------------------------------------------------------------------
  // 'gate' -> 'intro' -> 'splash' (Level 1...) -> 'game' -> 'splash' (Level N...) -> 'game' -> ...
  //                                              '-> 'over' (the win / game-over certificate, until dismissed) -> 'intro'
  //
  // The gate is a title card that waits for the first click, tap or key. Browsers keep the audio context
  // suspended until the page has had a user gesture, and without the gate that first gesture would also be the
  // one that starts a game, so the intro would always be silent. The gate's gesture unlocks the audio and starts
  // the intro music, then the intro runs as normal.
  let scene = 'gate';
  let splash = null;   // {text, colour, next, elapsed}
  let gateElapsed = 0;
  let notice = null;   // {text, until}: a short on-screen message (mouse captured / released)

  function showNotice(text, seconds = 4) {
    notice = { text, until: performance.now() / 1000 + seconds };
  }

  /**
   * On a phone the intro's hero ball rolls with the device's tilt rather than following a finger, and with tilt
   * steering on the bat is steered by rolling the phone (see tilt.js). iOS wants permission for motion and orientation
   * readings, asked for from a user gesture (the gate's tap); Android just sends them (on a secure page). The
   * ball stays finger-driven until the first reading arrives, and so does the bat, so a device with no sensors
   * or a refused permission loses nothing.
   */
  function startTilt() {
    if (!MOBILE || !window.DeviceOrientationEvent) return;
    const screenAngle = () => {
      const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle
        : (typeof window.orientation === 'number' ? window.orientation : 0);
      return ((a % 360) + 360) % 360;
    };
    const listen = () => {
      window.addEventListener('deviceorientation', (e) => {
        if (e.beta === null || e.gamma === null) return;
        intro.onOrientation(e.beta, e.gamma, screenAngle());
      });
      // The accelerometer's reading is in the device's own frame; the steering sorts out which way round the
      // screen is for itself
      window.addEventListener('devicemotion', (e) => {
        const a = e.accelerationIncludingGravity;
        if (!a || a.x === null || !game.steer) return;
        game.steer.feed(a.x, a.y, a.z, e.timeStamp);
      });
    };
    // iOS: both permissions are asked for in the same gesture (in practice they're one prompt)
    const asks = [window.DeviceOrientationEvent, window.DeviceMotionEvent]
      .filter((cls) => cls && typeof cls.requestPermission === 'function')
      .map((cls) => cls.requestPermission());
    if (asks.length) {
      Promise.all(asks).then((results) => { if (results.every((r) => r === 'granted')) listen(); }).catch(() => {});
    } else {
      listen();
    }
  }

  function leaveGate() {
    audio.unlock();
    startTilt();
    music.play('intro', 1, MUSIC_INTRO_FADE_IN);
    scene = 'intro';
  }

  /**
   * The real cursor is hidden only while a game is actually being played (the bat stands in for it) and on the
   * intro (the hero ball does). It's visible on the gate, while paused, and on the splash screens, so a player
   * is never left hunting for an invisible pointer.
   */
  function updateCursor() {
    const hide = scene === 'intro' || (scene === 'game' && !game.paused);
    const style = hide ? 'none' : 'default';
    if (canvas.style.cursor !== style) canvas.style.cursor = style;
  }

  /**
   * Put up a banner. A level's banner introduces the kinds of brick new to this game (game.newBrickTypes()),
   * and stays up a little longer for each.
   */
  function showSplash(text, colour, next) {
    const bricks = next === 'level' ? game.newBrickTypes() : [];
    const duration = Math.min(SPLASH_MAX_TIME, SPLASH_TIME + SPLASH_BRICK_TIME * bricks.length);
    splash = { text, colour, next, elapsed: 0, bricks, duration };
    game.darkAlpha = 192;
    scene = 'splash';
  }

  function startGame() {
    // The mouse is captured only while a level is being played: each level start takes it, and the banners,
    // a pause, the certificate and the intro all give it back (never on a phone)
    input.wantLock = captureMouse && !MOBILE;
    lockAnnounced = false;
    game.reset();
    music.play('intro');   // keeps playing under the first splash, as in the Python version
    showSplash('Level 1...', COLOURS.advance, 'level');
  }

  function startLevel() {
    game.initialiseLevel();
    music.play(...Music.levelTrack(Game.stage(game.level)));
    game.running = true;
    scene = 'game';
    // A lock request needs a user gesture, and a banner can outlast the one that started the game or skipped
    // it, so a level that's to capture the mouse waits for a click (a player who leaves the ball to serve itself
    // would otherwise never give one). The bat moves meanwhile, but the clock, and with it the serve, waits
    levelHold = input.wantLock ? 0 : null;
  }

  function leaveSplash() {
    const next = splash.next;
    splash = null;
    if (next === 'level') startLevel(); else backToIntro();
  }

  /** Back to the intro after a game (the certificate being dismissed). */
  function backToIntro() {
    input.releaseLock();
    intro.relayout();
    music.play('intro', 1, MUSIC_INTRO_FADE_IN);   // The ending fades out as it comes in
    scene = 'intro';
  }

  /**
   * The game is over, won or lost: its sound, then the certificate (certificate.js), which stays up until the
   * player taps or clicks away from its boxes or presses a key. The mouse is freed so the boxes can be clicked.
   *
   * @param {boolean} won True for the last level cleared, false for the last life lost.
   */
  function showCertificate(won) {
    music.stop();   // The level's tune fades under the win or game-over sound, then the ending plays
    audio.sfx.play(won ? 'win' : 'die');
    setTimeout(() => { if (scene === 'over') music.play('ending'); }, MUSIC_ENDING_DELAY * 1000);
    input.releaseLock();
    game.clearInversion();
    notice = null;   // A notice from the last seconds of play would sit over the certificate's text
    certificate.start(game, won);
    scene = 'over';
  }

  function endOfLevel() {
    // Called when the game loop ends a level: out of lives, or all bricks gone
    if (game.lives <= 0) {
      showCertificate(false);
      return;
    }
    game.level += 1;
    if (game.level <= Game.maxLevel) {
      input.releaseLock(true);   // The banner frees the mouse, and the next level takes it back
      game.lives += 1;
      gfx.buildBackground(Game.stage(game.level));
      showSplash(`Level ${game.level}...`, COLOURS.advance, 'level');
    } else {
      game.level = Game.maxLevel;   // Not past the last level: a resize on the certificate re-lays its bricks out
      showCertificate(true);
    }
  }

  function setPaused(flag) {
    if (scene !== 'game' || game.paused === flag) return;
    game.paused = flag;
    if (flag) {
      audio.pause();
      input.releaseLock(true);   // Free the mouse while paused; remember if the player had captured it
    } else {
      audio.resume();
      if (input.wantLock) input.requestLock();
      levelHold = null;   // The click or key that resumes is the gesture a level waiting to start wanted
      // With tilt steering, however the phone is held on resuming is level again (a pause is the way to re-level)
      if (game.tiltBat && game.steer) game.steer.level();
    }
  }

  /**
   * X on the intro in debug mode: a showcase to take screenshots of (P). Hard, stage 5, straight into play with
   * the lower four rows mostly cleared (a few bricks still exploding), both regenerators fired so bricks pop
   * back in, every bonus bat out, the lasers going and a full crowd of balls. The black hole and red lens
   * bricks below the top two rows become ordinary bricks, since a ball setting one off would darken or blur
   * the shot; the ones in the top two rows stay, out of harm's way.
   */
  function showcase() {
    const level = LEVEL_DEFS.findIndex((def) => def.stage === 5) + 1;
    game.difficulty = 2;
    intro.choice = 2;
    game.reset(level);
    startLevel();
    const rows = Game.rows(level).length;
    const mix = RANDOM_BRICK_TYPES[game.difficulty];
    for (const brick of game.bricks) {
      const row = brick.row;
      if (brick.lives === 99 || row < 2) continue;
      if (brick.type === 4 || brick.type === 9) {
        brick.become(mix[Math.floor(Math.random() * mix.length)]);
      } else if (row < rows - 4) {
        continue;   // The upper rows keep their bricks
      } else if (Math.random() < 0.6) {
        brick.lives = -21;   // Long gone
      } else if (Math.random() < 0.15) {
        brick.lives = 0;     // Exploding right now
      }
    }
    game.bricksRemaining = game.countLiveBricks();
    game.serving = false;
    Object.assign(game.heroBall, { x: gfx.W / 2, y: gfx.H / 2, vx: 300 * gfx.scale, vy: -500 * gfx.scale });
    while (game.balls.length < MAX_BALLS) game.addBonusBall(99);   // Long-lived, so the crowd lasts the session
    while (game.extraBats.length) game.killBrick({ type: 2, id: 0 });
    game.killBrick({ type: 8, id: 0 });
    game.startRegeneration();
    game.startRegeneration();
  }

  /**
   * P in debug mode: save the playfield (the canvas without its letterbox bars) as a PNG, named for the level
   * and the moment, through a temporary download link as the certificate does. Silent when it works: a notice
   * would sit in the next few shots.
   */
  function saveScreenshot() {
    const shot = document.createElement('canvas');
    shot.width = gfx.W;
    shot.height = gfx.H;
    shot.getContext('2d').drawImage(canvas, gfx.offX, gfx.offY, gfx.W, gfx.H, 0, 0, gfx.W, gfx.H);
    const d = new Date();
    const two = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    const name = `breakout-level${game.level}-${stamp}.png`;
    shot.toBlob((blob) => {
      if (!blob) { showNotice('Screenshot failed'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, 'image/png');
  }

  /**
   * L: capture or release the mouse (pointer lock) for the rest of this game. Works on the level banner too,
   * where the hint suggests it with capture off, though the banner itself leaves the mouse free: there it
   * just decides whether the level takes it.
   */
  function toggleLock() {
    if (MOBILE || (scene !== 'game' && scene !== 'splash') || game.paused) return;
    if (input.locked || input.wantLock) {
      input.releaseLock();
      showNotice(scene === 'splash' ? 'The mouse stays free this game' : 'Mouse released');
    } else if (scene === 'splash') {
      input.wantLock = true;
      showNotice('The mouse will be captured in play');
    } else {
      input.requestLock();
    }
  }

  function quitToIntro() {
    music.stop(false);
    input.releaseLock();
    audio.resume();
    game.paused = false;
    game.clearInversion();
    intro.relayout();
    music.play('intro', 1, MUSIC_INTRO_FADE_IN);
    scene = 'intro';
  }

  /** M, or the Options page's Music button: switch the music and remember the choice for next time. */
  function toggleMusic() {
    writeSetting(MUSIC_KEY, music.toggle() ? 'on' : 'off');
  }

  /**
   * The Options page's mouse capture button (not offered on a phone): whether the mouse is captured in play,
   * remembered for next time. L still captures or releases it for the game in hand. Switched in play, it
   * applies when the game resumes, as the pause has let the mouse go.
   */
  function toggleCapture() {
    captureMouse = !captureMouse;
    writeSetting(CAPTURE_KEY, captureMouse ? 'on' : 'off');
    if (scene === 'game' || scene === 'splash') input.wantLock = captureMouse && !MOBILE;
  }

  /**
   * The Options page's tilt steering button (phones only, and only on the intro, so a game is played one way
   * from start to finish): whether the bat is steered by rolling the phone, at any difficulty, remembered for
   * next time.
   */
  function toggleTilt() {
    game.tiltBat = !game.tiltBat;
    writeSetting(TILT_KEY, game.tiltBat ? 'on' : 'off');
  }

  /**
   * The Options page: the keyboard's jobs for a touch screen (a two-finger tap), and the settings in one place on
   * a desktop (the intro's Options link, or O). In play it pauses first and closing it (Resume, a tap outside the
   * buttons, or Escape) resumes; on the intro it offers the toggles and the Help and Credits pages.
   */
  function showOptions() {
    if (modalOpen()) return;
    const inGame = scene === 'game';
    if (inGame) setPaused(true);
    const state = () => ({ inGame, music: music.enabled, fullscreen: isFullscreen(), fullscreenAvailable: fullscreenAvailable(),
      capture: captureMouse, captureAvailable: !MOBILE, tilt: game.tiltBat, tiltAvailable: MOBILE && !inGame });
    const actions = {
      resume: () => closeModal(),
      music: () => toggleMusic(),
      fullscreen: () => toggleFullscreen(),
      capture: () => toggleCapture(),
      tilt: () => toggleTilt(),
      // Help and Credits open over the top; closing them comes back here (still paused, in play)
      help: () => openModal('help', () => showOptions()),
      credits: () => openModal('credits', () => showOptions()),
      quit: () => { closeModal(); quitToIntro(); },
    };
    openOptions(state, actions, () => { if (inGame) setPaused(false); });
  }

  /** The primary action (left click or tap): start, skip the splash, serve, or kick. */
  function primaryAction() {
    audio.unlock();
    if (modalOpen()) return;
    if (scene === 'gate') {
      leaveGate();
    } else if (scene === 'intro') {
      // A click or tap on the Options link opens that page, and one on a difficulty starts that game; anywhere
      // else does nothing (it used to start whatever was selected, which made the menu feel optional). It's
      // the pointer that's hit-tested, not the hero ball: a quick tap can land and lift between two frames,
      // and on a phone the ball may be rolling by tilt
      const p = input.playfield();
      if (intro.linkAt(p.x, p.y)) showOptions();
      else if (intro.selectAt(p.x, p.y)) startGame();
    } else if (scene === 'splash') {
      splash.elapsed = 1e9;
    } else if (scene === 'over') {
      // The certificate's boxes, or anywhere else to leave. The raw pointer is the real cursor or finger here
      // (the lock was released on the way in), so no gain is wanted for hit-testing
      const hit = certificate.hit(input.raw.x, input.raw.y);
      if (hit === 'selfie') openCamera((photo) => certificate.setPhoto(photo));
      else if (hit === 'save') certificate.save();
      else backToIntro();
    } else if (scene === 'game') {
      if (game.paused) {
        setPaused(false);
        return;
      }
      if (levelHold !== null) {
        // The click a level waits for: it captures the mouse and sets the level going, and serves as any click does
        levelHold = null;
        if (input.wantLock) input.requestLock();
      }
      // A click or tap launches any balls stuck to the bats (the sticky bat brick), and the waiting ball; with
      // neither, it speeds the balls up
      const released = game.releaseStuck();
      if (game.serving) game.serve(); else if (!released) game.kickAllBalls();
      if (DEBUG) {
        const p = input.playfield();
        for (const brick of game.bricks) {
          const b = brick.bbox();
          if (b && !brick.expired() && p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h) {
            brick.hit(p.x, null, true);
            game.killBrick(brick);
          }
        }
      }
    }
  }

  // --- Input ------------------------------------------------------------------------------------------------
  let lastInput = performance.now();
  const noteInput = () => { lastInput = performance.now(); };
  for (const type of ['mousemove', 'mousedown', 'touchstart', 'touchmove', 'wheel']) {
    canvas.addEventListener(type, noteInput, { passive: true });
  }
  window.addEventListener('keydown', noteInput);

  input.onLockLost = () => {
    // The browser releases the lock on Esc (or when the tab loses focus): treat it as a pause
    if (scene === 'game' && !game.paused) setPaused(true);
  };
  input.onLockChange = (locked) => {
    // No notice: Click to start... has said how to get the mouse back, before it was taken
    if (locked) lockAnnounced = true;
  };
  input.onTap = () => { fullscreenOnTap(); primaryAction(); };
  game.wipe.onTired = () => showNotice('Too frantic! The bat is worn out for a moment', 2.5);
  input.onTwoFingerTap = () => {
    audio.unlock();
    fullscreenOnTap();
    if (scene === 'game' || scene === 'intro') showOptions();
  };
  // The Options page shows the fullscreen state, which can also change by other means (Esc, the F key)
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(type, () => {
      renderOptions();
      // Leaving fullscreen in landscape without us asking (the back gesture) is the player opting out
      if (!isFullscreen() && !leavingFullscreen && isLandscape()) autoFullscreen = false;
      leavingFullscreen = false;
    });
  }
  if (MOBILE) {
    // Orientation changes arrive as resizes (the viewport swaps its sides); there's no gesture to enter
    // fullscreen on, so landscape only arms the next tap, with a hint
    let landscape = isLandscape();
    window.addEventListener('resize', () => {
      const now = isLandscape();
      if (now === landscape) return;
      landscape = now;
      autoFullscreen = true;
      if (!now && isFullscreen()) exitFullscreen();
      if (now && !isFullscreen()) showNotice('Tap to go fullscreen', 3);
    });
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) primaryAction();
  });

  window.addEventListener('keydown', (e) => {
    audio.unlock();
    const key = e.key.toLowerCase();
    if (modalOpen()) {
      // The page has the keyboard: only Escape (close) is ours
      if (key === 'escape') closeModal();
      return;
    }
    if (key === 'f') {
      toggleFullscreen();
      return;
    }
    if (key === 'm') {
      toggleMusic();
      return;
    }
    if (key === 'l') {
      toggleLock();
      return;
    }
    if (scene === 'gate') {
      if (!e.repeat) leaveGate();
    } else if (scene === 'intro') {
      if (key === 'o') showOptions();
      else if (key === 'h') openModal('help');
      else if (key === 'c') openModal('credits');
      else if (key === 'x' && DEBUG) showcase();
      else if (key === 'arrowup' || key === 'arrowdown') {
        e.preventDefault();
        intro.moveChoice(key === 'arrowup' ? -1 : 1);
      } else if ((key === 'enter' || key === ' ') && !e.repeat) {
        e.preventDefault();
        startGame();   // The highlighted difficulty; any other key does nothing here
      }
    } else if (scene === 'splash') {
      if (key === 'q') quitToIntro(); else if (key !== 'l') splash.elapsed = 1e9;   // L was handled above
    } else if (scene === 'over') {
      if (key === 's') certificate.save(); else if (!e.repeat) backToIntro();
    } else if (scene === 'game') {
      if (key === ' ') {
        e.preventDefault();
        setPaused(!game.paused);
      } else if (key === 'q') {
        quitToIntro();
      } else if (key === 'd' && DEBUG) {
        for (const brick of game.bricks) brick.hit(0, null, true);
      } else if (key === 'p' && DEBUG && !e.repeat) {
        saveScreenshot();
      } else if (DEBUG && '1234567890-'.includes(key) && !e.repeat) {
        // Jump straight to that level, banner first, keeping the lives as they are: the digits are levels 1 to 9,
        // and 0 and - on along the top row of the keyboard are 10 and 11
        const level = '1234567890-'.indexOf(key) + 1;
        if (level <= Game.maxLevel) {
          game.level = level;
          gfx.buildBackground(Game.stage(level));
          showSplash(`Level ${level}...`, COLOURS.advance, 'level');
        }
      }
    }
  });

  window.addEventListener('resize', () => {
    const oldW = gfx.W;
    const oldH = gfx.H;
    if (gfx.resize()) {
      const sx = gfx.W / oldW;
      const sy = gfx.H / oldH;
      input.relayout(sx, sy);
      game.relayout(sx, sy);
      intro.relayout();
    }
  });

  // --- Main loop --------------------------------------------------------------------------------------------

  /** The frame rate to throttle to right now, or 0 for the display's full rate. */
  function idleRate(now) {
    const paused = scene === 'game' && game.paused && gfx.trailMarks.length === 0;
    if (!notice && (scene === 'over' || paused)) return STILL_FPS;   // Nothing moving: only input changes them
    if (scene === 'gate') return IDLE_FPS;
    if (scene === 'intro') {
      const settled = intro.totalSpeed() < IDLE_SPEED * gfx.scale;
      const wantIdle = modalOpen() || (settled && now - lastInput > IDLE_AFTER * 1000);
      // Tell the card to turn to face the viewer (or to resume spinning), and only throttle once it's there:
      // the turn itself runs at full rate so it looks smooth
      intro.setIdle(wantIdle);
      if (wantIdle && intro.cardSettled()) return IDLE_FPS;
    }
    return 0;
  }

  // The pending slow tick while idling, and wake(), which brings the next frame forward to now. Bound to the
  // discrete inputs (and resizes), not to mouse movement: nothing on a still page answers that.
  let idleTimer = null;
  function wake() {
    if (idleTimer === null) return;   // A frame is already on its way
    clearTimeout(idleTimer);
    idleTimer = null;
    requestAnimationFrame(frame);
  }
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown', 'touchstart', 'resize']) {
    window.addEventListener(type, wake, { passive: true, capture: true });
  }
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(type, wake);

  let frames = 0;   // Rendered frames, for the smoke test to measure the rate
  let last = performance.now();
  function frame(now) {
    const sceneAtStart = scene;
    const dt = Math.min((now - last) / 1000, MAX_FRAME_DT);
    last = now;
    frames++;

    const ctx = gfx.begin();
    if (scene === 'gate') {
      gateElapsed += dt;
      // The intro screenshot fills the playfield behind the title, scaled to cover it (cropped to the centre
      // where the shapes differ) and darkened so the text stays the point
      const img = images.intro;
      const cover = Math.max(gfx.W / img.width, gfx.H / img.height);
      const dw = img.width * cover;
      const dh = img.height * cover;
      ctx.drawImage(img, (gfx.W - dw) / 2, (gfx.H - dh) / 2, dw, dh);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, gfx.W, gfx.H);
      const wave = Math.round(64 * Math.sin((2 * Math.PI * gateElapsed) / 3));
      const title = COLOURS.title.map((c) => Math.max(0, Math.min(255, c + wave)));
      gfx.text(ctx, 'Breakout', { x: gfx.W / 2, y: gfx.H * 0.4, size: 400, colour: title, alpha: 224 / 255, bold: true, italic: true });
      // Pulse the prompt gently so it reads as waiting rather than stuck
      const pulse = 0.55 + 0.35 * Math.sin((2 * Math.PI * gateElapsed) / 1.5);
      const prompt = MOBILE ? 'Tap to begin' : 'Click, tap or press any key to begin';
      gfx.text(ctx, prompt, { x: gfx.W / 2, y: gfx.H * 0.62, size: 80, colour: COLOURS.presskey, alpha: pulse });
      // The one rule a newcomer can't guess: which ball matters
      drawBallGuide(gfx, ctx, images, gfx.H * 0.73, 0.9);
      gfx.text(ctx, 'Copyright © 2025-26, 7th software Ltd.', { x: gfx.W / 2, y: gfx.H * 0.92, size: 50, colour: COLOURS.copyright, alpha: 0.7 });
    } else if (scene === 'intro') {
      intro.update(dt);
      intro.draw(ctx);
    } else if (scene === 'splash') {
      splash.elapsed += dt;
      game.darkAlpha = Game.nextAlpha(game.darkAlpha, dt);
      ctx.drawImage(gfx.background, 0, 0);
      // The banner fades in, like the Python version's repeated low-alpha blits. With bricks to introduce it moves
      // up to make room for them, and the hints below go to the foot of the screen.
      const intros = splash.bricks.length > 0;
      gfx.text(ctx, splash.text, {
        x: gfx.W / 2, y: gfx.H * (intros ? 0.2 : 0.5), size: 300, colour: splash.colour, bold: true, italic: true,
        alpha: Math.min(0.9, splash.elapsed / 1.2),
      });
      drawBrickIntros(gfx, ctx, images, splash.bricks, splash.elapsed, gfx.H * 0.35, gfx.H * (MOBILE ? 0.84 : 0.88));
      if (!MOBILE && splash.next === 'level' && !input.wantLock && !input.locked) {
        // Without the capture, the cursor can wander off the page (onto another monitor, say) mid-game, and
        // nothing else on screen says that L prevents it
        gfx.text(ctx, "Press L to capture the mouse, so it can't stray off the page (Esc releases it)", {
          x: gfx.W / 2, y: gfx.H * (intros ? 0.94 : 0.64), size: 60, colour: COLOURS.presskey, alpha: Math.min(0.8, splash.elapsed / 1.2),
        });
      }
      if (MOBILE && splash.next === 'level') {
        // A phone gets the gestures under the level banner, since there's nothing else on screen to say
        // how to pause (and with tilt steering, that the finger no longer drives the bat)
        const lines = ['Two-finger tap for pause/options'];
        if (game.tiltBat) lines.push('Tilt device to move bat');
        lines.forEach((line, i) => gfx.text(ctx, line, {
          x: gfx.W / 2, y: gfx.H * ((intros ? 0.89 : 0.64) + 0.06 * i), size: 60, colour: COLOURS.presskey,
          alpha: Math.min(0.8, splash.elapsed / 1.2),
        }));
      }
      game.drawBlackout(ctx);
      if (splash.elapsed >= splash.duration) leaveSplash();
    } else if (scene === 'over') {
      certificate.draw(ctx);
    } else if (scene === 'game') {
      if (levelHold !== null && !game.paused) {
        // Waiting for the click that starts the level: only the bat, and the ball on it, move
        levelHold += dt;
        game.animateBats(dt);
        if (game.serving) game.holdHeroBall();
      } else {
        game.update(dt);
      }
      const complete = game.draw(ctx);
      game.advanceEffects(dt);
      if (levelHold !== null && !game.paused) {
        // Bobbing gently, and fading in, so it reads as a prompt rather than part of the level
        gfx.text(ctx, 'Click to start...', {
          x: gfx.W / 2, y: gfx.H * (0.55 + 0.012 * Math.sin(levelHold * 2.5)), size: 120, colour: COLOURS.white,
          alpha: Math.min(0.8, levelHold * 2), bold: true, italic: true,
        });
        // How to get the mouse back, until the game has first taken it
        if (!lockAnnounced) {
          gfx.text(ctx, 'The mouse is captured in play: Esc or L releases it', {
            x: gfx.W / 2, y: gfx.H * 0.64, size: 50, colour: COLOURS.presskey, alpha: Math.min(0.7, levelHold * 2),
          });
        }
      }
      if (game.paused) {
        gfx.text(ctx, 'Paused', { x: gfx.W / 2, y: gfx.H / 2, size: 200, colour: COLOURS.white, alpha: 0.7, bold: true });
        const prompt = MOBILE ? 'Tap to continue' : 'Space, click or tap to continue';
        gfx.text(ctx, prompt, { x: gfx.W / 2, y: gfx.H * 0.6, size: 60, colour: COLOURS.presskey, alpha: 0.7 });
      } else if (game.lives <= 0 || complete) {
        endOfLevel();
      }
    }
    if (notice) {
      const remaining = notice.until - now / 1000;
      if (remaining <= 0) {
        notice = null;
      } else {
        gfx.text(ctx, notice.text, { x: gfx.W / 2, y: gfx.H * 0.78, size: 60, colour: COLOURS.presskey, alpha: Math.min(0.85, remaining) });
      }
    }
    updateCursor();
    gfx.end();

    // Schedule the next frame: straight away at full rate, or after a wait when idling. requestAnimationFrame
    // still does the actual scheduling, so the browser can hold the loop while the tab is hidden.
    // A scene that changed during this frame (the game ending in the certificate, say) gets its first frame at once
    const rate = scene === sceneAtStart ? idleRate(now) : 0;
    if (rate) {
      const spent = performance.now() - now;
      idleTimer = setTimeout(() => { idleTimer = null; requestAnimationFrame(frame); }, Math.max(0, 1000 / rate - spent));
    } else {
      requestAnimationFrame(frame);
    }
  }

  // Expose the live objects for poking at from the console (and for the automated smoke test)
  window.breakout = {
    screenshot: saveScreenshot, showcase, game, gfx, input, intro, certificate, audio, mobile: MOBILE, get scene() { return scene; }, get frames() { return frames; } };

  // Away with the loading screen: the first frame (the gate) is drawn before the page is next shown
  loading.hidden = true;
  requestAnimationFrame(frame);

  // Register the (do-nothing) service worker so browsers that still require one will offer to install the page
  // as an app from its manifest. Only possible on a secure page; a plain http:// test server skips this.
  if (window.isSecureContext && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot().catch((e) => {
  console.error(e);
  message(`Something went wrong: ${e.message}. Is the page being served over HTTP from the repository root?`);
});
