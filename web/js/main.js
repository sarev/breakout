// Entry point: loads the assets, wires up input, and runs the scenes (intro, splash, game) on requestAnimationFrame.
//
// Controls: mouse moves the bat, left click serves or kicks, Space pauses, M toggles music, F toggles fullscreen,
// L captures the mouse (pointer lock; Esc releases it and pauses), Q returns to the intro, and on the intro H and
// C (or the on-screen links) open the Help and Credits pages. On a touch screen the ball (intro) or the bat
// (play) sits under the finger, a tap serves or kicks, and a two-finger tap pauses and opens the Options page (music,
// fullscreen, help, quit), which stands in for the keys.
//
// A mobile device (a phone or tablet: touch, no mouse, one screen) is detected at start-up, and there the prompts
// say "tap", the mouse is never captured, the bats sit higher and (in landscape) twice as wide so a fingertip
// doesn't hide them, and the Help page
// describes the gestures rather than the keys. ?mobile=1 or ?mobile=0 overrides the detection, for testing.
//
// ?debug=1 enables the cheats (D clears the level, left-click destroys the brick under the pointer). ?music=0
// starts silent, ?sensitivity=1.5 scales mouse movement, ?volume=0.3 sets the music volume.

import { AudioSystem, Music, Sfx } from './audio.js';
import { loadAudioSet, loadImages } from './assets.js';
import { COLOURS, MAX_FRAME_DT, MUSIC_FILES, SOUND_NAMES } from './config.js';
import { Game } from './game.js';
import { Graphics } from './graphics.js';
import { Input } from './input.js';
import { Intro } from './intro.js';
import { closeModal, modalOpen, openModal, openOptions, renderOptions, setMobile } from './ui.js';

const params = new URLSearchParams(window.location.search);
const DEBUG = params.get('debug') === '1';
const SENSITIVITY = parseFloat(params.get('sensitivity') || '1') || 1;
const MUSIC_ON = params.get('music') !== '0';
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
function toggleFullscreen() {
  const doc = document;
  const root = doc.documentElement;
  try {
    if (isFullscreen()) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) { const p = exit.call(doc); if (p && p.catch) p.catch(() => {}); }
    } else {
      const enter = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!enter) return;
      const p = enter.call(root);
      if (p && p.then) {
        // On a phone, fullscreen is the moment to ask for landscape: the playfield is tiny in portrait. The
        // request is refused on desktops and some browsers, and that's fine.
        p.then(() => {
          if (MOBILE && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }).catch(() => {});
      }
    }
  } catch (e) { /* fullscreen not permitted here; nothing to do */ }
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
  for (let i = 0; i < 9; i++) imageNames[`brick${i}`] = `brick${i}.png`;
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
  const music = audio.music;
  setMobile(MOBILE);

  // --- Scenes -----------------------------------------------------------------------------------------------
  // 'gate' -> 'intro' -> 'splash' (Level 1...) -> 'game' -> 'splash' (Level N... / Game Over! / YOU WIN!) -> ...
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

  function leaveGate() {
    audio.unlock();
    // On a phone the first tap is also the moment to fill the screen and turn to landscape: when the page is
    // opened in the browser rather than from an installed home-screen icon, nothing else will. Both requests
    // need a user gesture, which this is.
    if (MOBILE && !isFullscreen()) toggleFullscreen();
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
    if (next === 'level') {
      startLevel();
    } else {
      // Back to the intro
      input.releaseLock();
      intro.relayout();
      music.play('intro');
      scene = 'intro';
    }
  }

  function endOfLevel() {
    // Called when the game loop ends a level: out of lives, or all bricks gone
    if (game.lives <= 0) {
      music.stop();
      audio.sfx.play('die');
      showSplash('Game Over!', COLOURS.die, 'intro');
      return;
    }
    game.level += 1;
    if (game.level <= Game.maxLevel) {
      game.lives += 1;
      gfx.buildBackground(game.level);
      showSplash(`Level ${game.level}...`, COLOURS.advance, 'level');
    } else {
      music.stop();
      audio.sfx.play('win');
      showSplash('YOU WIN!', COLOURS.win, 'intro');
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
    intro.relayout();
    music.play('intro');
    scene = 'intro';
  }

  /**
   * The Options page (two-finger tap): the keyboard's jobs for a touch screen. In play it pauses first and
   * closing it (Resume, a tap outside the buttons, or Escape) resumes; on the intro it just offers the toggles.
   */
  function showOptions() {
    if (modalOpen()) return;
    const inGame = scene === 'game';
    if (inGame) setPaused(true);
    const state = () => ({ inGame, music: music.enabled, fullscreen: isFullscreen(), fullscreenAvailable: fullscreenAvailable() });
    const actions = {
      resume: () => closeModal(),
      music: () => music.toggle(),
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
      // intro has had a chance to notice where the finger went
      const p = input.playfield();
      const link = intro.linkAt(p.x, p.y);
      if (link) {
        openModal(link);
      } else {
        intro.selectAt(p.x, p.y);
        startGame();
      }
    } else if (scene === 'splash') {
      splash.elapsed = 1e9;
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
  input.onTap = () => primaryAction();
  game.wipe.onTired = () => showNotice('Too frantic! The bat is worn out for a moment', 2.5);
  input.onTwoFingerTap = () => {
    audio.unlock();
    if (scene === 'game' || scene === 'intro') showOptions();
  };
  // The Options page shows the fullscreen state, which can also change by other means (Esc, the F key)
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(type, renderOptions);

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
      music.toggle();
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
    } else if (scene === 'game') {
      if (key === ' ') {
        e.preventDefault();
        setPaused(!game.paused);
      } else if (key === 'q') {
        quitToIntro();
      } else if (key === 'd' && DEBUG) {
        for (const brick of game.bricks) brick.hit(0, null, true);
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

  let frames = 0;   // Rendered frames, for the smoke test to measure the rate
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, MAX_FRAME_DT);
    last = now;
    frames++;

    const ctx = gfx.begin();
    if (scene === 'gate') {
      gateElapsed += dt;
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
      game.drawBlackout(ctx);
      if (splash.elapsed >= 3) leaveSplash();
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
  window.breakout = { game, gfx, input, intro, audio, mobile: MOBILE, get scene() { return scene; }, get frames() { return frames; } };

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
