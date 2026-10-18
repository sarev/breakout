// Entry point: loads the assets, wires up input, and runs the scenes (intro, splash, game) on requestAnimationFrame.
//
// Controls: mouse moves the bat, left click serves or kicks, Space pauses, M toggles music, F toggles fullscreen,
// L captures the mouse (pointer lock; Esc releases it and pauses), Q returns to the intro, and on the intro H and
// C (or the on-screen links) open the Help and Credits pages. On a touch screen the ball (intro) or the bat
// (play) sits under the finger, a tap serves or kicks, and a two-finger tap pauses and opens the Options page (music,
// fullscreen, help, quit), which stands in for the keys.
//
// A mobile device (a phone or tablet: touch, no mouse, one screen) is detected at start-up, and there the prompts
// say "tap", the mouse is never captured, the bats sit higher and (in landscape) wider so a fingertip
// doesn't hide them, and the Help page
// describes the gestures rather than the keys. ?mobile=1 or ?mobile=0 overrides the detection, for testing.
//
// ?debug=1 enables the cheats (D clears the level, left-click destroys the brick under the pointer). ?music=0
// starts silent, ?sensitivity=1.5 scales mouse movement, ?volume=0.3 sets the music volume.

import { AudioSystem, Music, Sfx } from './audio.js';
import { loadAudioSet, loadImages } from './assets.js';
import { Certificate } from './certificate.js';
import { COLOURS, MAX_FRAME_DT, MUSIC_FILES, NUM_BRICK_TYPES, SOUND_NAMES } from './config.js';
import { Game } from './game.js';
import { Graphics } from './graphics.js';
import { Input } from './input.js';
import { Intro } from './intro.js';
import { closeModal, modalOpen, openCamera, openModal, openOptions, renderOptions, setMobile } from './ui.js';

const params = new URLSearchParams(window.location.search);
const DEBUG = params.get('debug') === '1';
const SENSITIVITY = parseFloat(params.get('sensitivity') || '1') || 1;
// Music on or off is remembered between visits; ?music=0 still starts a visit with it off
const MUSIC_KEY = 'breakout-music';
const MUSIC_ON = params.has('music') ? params.get('music') !== '0' : readSetting(MUSIC_KEY) !== 'off';
const MUSIC_VOLUME = params.has('volume') ? parseFloat(params.get('volume')) : null;

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
// display rate: the gate always renders at IDLE_FPS, and the intro drops to it once there has been no input for
// IDLE_AFTER seconds and the balls have all but stopped (or while a Help / Credits page is open). Any input, or
// the balls being set moving again, brings the full rate straight back. The splash and the game always run at
// full rate, and the browser stops the loop altogether while the tab is hidden.
const IDLE_FPS = 12;
const IDLE_AFTER = 5;
const IDLE_SPEED = 60;      // Total ball speed (px/s at the reference scale) below which the intro counts as settled

const canvas = document.getElementById('game');

/** Show a line of text on an otherwise black canvas (loading and error messages). */
function message(text) {
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
  message('Loading…');

  const imageNames = {
    ball: 'ball.png', bonusBall: 'extra-ball.png', blueGlow: 'blue-glow.png', redGlow: 'red-glow.png',
    bat: 'bat.png', bonusBat: 'extra-bat.png', blueLaser: 'blue.png', greenLaser: 'green.png', intro: 'intro.png',
  };
  for (let i = 0; i < NUM_BRICK_TYPES; i++) imageNames[`brick${i}`] = `brick${i}.png`;
  for (let i = 1; i <= 6; i++) imageNames[`tile${i}`] = `tile${i}.png`;

  const audio = new AudioSystem();
  const soundNames = Object.fromEntries(SOUND_NAMES.map((n) => [n, `${n}.wav`]));
  const [images, sounds, tracks] = await Promise.all([
    loadImages(`${ASSET_BASE}sprites/`, imageNames),
    loadAudioSet(audio.ctx, `${ASSET_BASE}sounds/`, soundNames),
    loadAudioSet(audio.ctx, `${ASSET_BASE}music/`, MUSIC_FILES),
  ]);
  audio.sfx = new Sfx(audio.ctx, sounds);
  audio.music = new Music(audio.ctx, tracks, MUSIC_ON, MUSIC_VOLUME);

  const gfx = new Graphics(canvas, images, SENSITIVITY, MOBILE);
  const input = new Input(canvas, gfx, MOBILE);
  const game = new Game(gfx, audio.sfx, input, { debug: DEBUG, mobile: MOBILE });
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
   * On a phone the intro's hero ball rolls with the device's tilt rather than following a finger, and on Insane
   * the bat is steered by rolling the phone (see tilt.js). iOS wants permission for motion and orientation
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
    music.play('intro');
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

  function showSplash(text, colour, next) {
    splash = { text, colour, next, elapsed: 0 };
    game.darkAlpha = 192;
    scene = 'splash';
  }

  function startGame() {
    game.reset();
    music.play('intro');   // keeps playing under the first splash, as in the Python version
    showSplash('Level 1...', COLOURS.advance, 'level');
  }

  function startLevel() {
    game.initialiseLevel();
    music.play(...Music.levelTrack(game.level));
    game.running = true;
    scene = 'game';
    if (input.wantLock) input.requestLock();   // Only if the player opted in with L earlier
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
    music.play('intro');
    scene = 'intro';
  }

  /**
   * The game is over, won or lost: its sound, then the certificate (certificate.js), which stays up until the
   * player taps or clicks away from its boxes or presses a key. The mouse is freed so the boxes can be clicked.
   *
   * @param {boolean} won True for the last level cleared, false for the last life lost.
   */
  function showCertificate(won) {
    music.stop();
    audio.sfx.play(won ? 'win' : 'die');
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
      game.lives += 1;
      gfx.buildBackground(game.level);
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
      // On Insane, however the phone is held on resuming is level again (a pause is the way to re-level)
      if (game.tiltBat && game.steer) game.steer.level();
    }
  }

  /** L: capture or release the mouse (pointer lock). Opt-in, and announced on screen either way. */
  function toggleLock() {
    if (MOBILE || scene !== 'game' || game.paused) return;
    if (input.locked || input.wantLock) {
      input.releaseLock();
      showNotice('Mouse released');
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
    music.play('intro');
    scene = 'intro';
  }

  /**
   * The Options page (two-finger tap): the keyboard's jobs for a touch screen. In play it pauses first and
   * closing it (Resume, a tap outside the buttons, or Escape) resumes; on the intro it just offers the toggles.
   */
  /** M, or the Options page's Music button: switch the music and remember the choice for next time. */
  function toggleMusic() {
    writeSetting(MUSIC_KEY, music.toggle() ? 'on' : 'off');
  }

  function showOptions() {
    if (modalOpen()) return;
    const inGame = scene === 'game';
    if (inGame) setPaused(true);
    const state = () => ({ inGame, music: music.enabled, fullscreen: isFullscreen(), fullscreenAvailable: fullscreenAvailable() });
    const actions = {
      resume: () => closeModal(),
      music: () => toggleMusic(),
      fullscreen: () => toggleFullscreen(),
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
      // A click or tap on one of the links opens its page instead of starting a game. Otherwise the label under
      // the pointer (if any) is selected first: a quick tap can land and lift between two frames, before the
      // intro has had a chance to notice where the finger went. When the ball is rolled by tilt, the ball is
      // what chooses, wherever the finger tapped
      const p = intro.tiltActive ? { x: intro.hero.x, y: intro.hero.y } : input.playfield();
      const link = intro.linkAt(p.x, p.y);
      if (link) {
        openModal(link);
      } else {
        intro.selectAt(p.x, p.y);
        startGame();
      }
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
      if (game.serving) game.serve(); else game.kickAllBalls();
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
    if (locked) showNotice('Mouse captured. Esc or L releases it.', 5);
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
      if (key === 'h') openModal('help');
      else if (key === 'c') openModal('credits');
      else if (key !== 'escape' && key !== 'q' && !e.repeat) startGame();
    } else if (scene === 'splash') {
      if (key === 'q') quitToIntro(); else splash.elapsed = 1e9;
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
      } else if (DEBUG && key >= '1' && key <= '9' && !e.repeat) {
        // Jump straight to that level, banner first, keeping the lives as they are
        const level = parseInt(key, 10);
        if (level <= Game.maxLevel) {
          game.level = level;
          gfx.buildBackground(level);
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
    if (scene === 'gate' || scene === 'over') return IDLE_FPS;   // Both are still pages that only wait for input
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

  let frames = 0;   // Rendered frames, for the smoke test to measure the rate
  let last = performance.now();
  function frame(now) {
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
      gfx.text(ctx, 'Copyright © 2025-26, 7th software Ltd.', { x: gfx.W / 2, y: gfx.H * 0.92, size: 50, colour: COLOURS.copyright, alpha: 0.7 });
    } else if (scene === 'intro') {
      intro.update(dt);
      intro.draw(ctx);
    } else if (scene === 'splash') {
      splash.elapsed += dt;
      game.darkAlpha = Game.nextAlpha(game.darkAlpha, dt);
      ctx.drawImage(gfx.background, 0, 0);
      // The banner fades in, like the Python version's repeated low-alpha blits
      gfx.text(ctx, splash.text, {
        x: gfx.W / 2, y: gfx.H / 2, size: 300, colour: splash.colour, bold: true, italic: true,
        alpha: Math.min(0.9, splash.elapsed / 1.2),
      });
      if (MOBILE && splash.next === 'level') {
        // A phone gets the gestures under the level banner, since there's nothing else on screen to say
        // how to pause (and on Insane, that the finger no longer drives the bat)
        const lines = ['Two-finger tap for pause/options'];
        if (game.tiltBat) lines.push('Tilt device to move bat');
        lines.forEach((line, i) => gfx.text(ctx, line, {
          x: gfx.W / 2, y: gfx.H * (0.64 + 0.06 * i), size: 60, colour: COLOURS.presskey,
          alpha: Math.min(0.8, splash.elapsed / 1.2),
        }));
      }
      game.drawBlackout(ctx);
      if (splash.elapsed >= 3) leaveSplash();
    } else if (scene === 'over') {
      certificate.draw(ctx);
    } else if (scene === 'game') {
      game.update(dt);
      const complete = game.draw(ctx);
      game.advanceEffects(dt);
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
    const rate = idleRate(now);
    if (rate) {
      const spent = performance.now() - now;
      setTimeout(() => requestAnimationFrame(frame), Math.max(0, 1000 / rate - spent));
    } else {
      requestAnimationFrame(frame);
    }
  }

  // Expose the live objects for poking at from the console (and for the automated smoke test)
  window.breakout = { game, gfx, input, intro, certificate, audio, mobile: MOBILE, get scene() { return scene; }, get frames() { return frames; } };

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
