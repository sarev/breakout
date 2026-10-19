// The Help, Credits and Options modals: plain HTML laid over the canvas, with the game blurred behind them.
//
// These are ordinary DOM so the text scrolls and wraps properly at any size; the canvas keeps animating
// underneath and the overlay's backdrop-filter blurs it. While a modal is open the overlay swallows pointer
// events, and main.js ignores keys other than Escape. A click anywhere (or Escape) closes it, except on a link
// or an options button, which do their own jobs.
//
// The Options page exists for touch screens, where there are no keys to toggle the music or go fullscreen and no
// Q to quit: a two-finger tap opens it (pausing the game first). It works just as well with a mouse on a touch
// laptop. Its buttons call back into main.js, which owns the music, fullscreen and scene state.

const BRICKS = [
  ['sm-brick0.png', 'Blue', 'Standard; no effect'],
  ['sm-brick1.png', 'Red', 'Spawns a temporary red bonus ball'],
  ['sm-brick2.png', 'Green', 'Adds a temporary extra bat'],
  ['sm-brick3.png', 'White star', 'Grants an extra life'],
  ['sm-brick4.png', 'Black hole', 'Temporarily darkens the screen'],
  ['sm-brick5.png', 'Yellow arrows', 'Temporarily reverses the controls'],
  ['sm-brick6.png', 'Cracked fire', 'Destroys neighbouring bricks (cascade)'],
  ['sm-brick7.png', 'Metal', 'Indestructible'],
  ['sm-brick8.png', 'Warning triangle', 'Lasers for a while'],
  ['sm-brick9.png', 'Red lens', 'Blurs your view and reddens its edges for 15 seconds; each one makes it worse'],
  ['sm-brick10.png', 'Safety net', 'A glowing bar floats up under the bat for a few seconds and bounces any ball back, a little slower'],
  ['sm-brick11.png', 'Regenerator', 'Brings back some of the bricks you have already broken, one by one over a few seconds'],
];

// The controls table differs by device: a phone or tablet has no keyboard, so it gets the touch gestures only
const KEYBOARD_CONTROLS = `
<tr><td>Mouse</td><td>Moves the bat. Where the ball lands on the bat sets its angle: the centre sends it straight up, the ends send it off sideways. Swipe the bat under the ball as it bounces to give it spin, which curves its path the other way for a while and kicks it sideways when it bounces.</td></tr>
<tr><td>Click</td><td>Launches the ball when it's sitting on the bat (flick the bat sideways as you click to aim it). Otherwise, speeds all the balls up a little.</td></tr>
<tr><td>Touch</td><td>The ball on this screen, and the bat in play, sit under your finger. Tap to launch or speed up; a two-finger tap pauses and opens the options.</td></tr>
<tr><td>Space</td><td>Pause and resume</td></tr>
<tr><td>M</td><td>Music on or off</td></tr>
<tr><td>F</td><td>Fullscreen</td></tr>
<tr><td>L</td><td>Capture the mouse so it can't leave the page (Esc or L releases it)</td></tr>
<tr><td>Q</td><td>Back to this screen</td></tr>
`;

const TOUCH_CONTROLS = `
<tr><td>Touch</td><td>The bat sits under your finger: put your finger down anywhere across the screen and the bat goes there. Where the ball lands on the bat sets its angle: the centre sends it straight up, the ends send it off sideways. Swipe the bat under the ball as it bounces to give it spin, which curves its path the other way for a while and kicks it sideways when it bounces.</td></tr>
<tr><td>Tap</td><td>Launches the ball when it's sitting on the bat (flick the bat sideways as you tap to aim it). Otherwise, speeds all the balls up a little.</td></tr>
<tr><td>Two fingers</td><td>Tap with two fingers to pause and open the options: music, fullscreen, and back to this screen.</td></tr>
<tr><td>Insane</td><td>Pick Insane on the intro and the bat is steered by rolling the phone like a steering wheel instead: roughly 45° either way takes it to the edge. However you're holding the phone when a level starts, or when you resume after a pause, counts as level. Otherwise it plays as Hard.</td></tr>
`;

function help(mobile) {
  return `
<h2>How to play</h2>
<p>Clear every destroyable brick without losing all your lives. You lose a life each time the blue hero ball
falls off the bottom. Red bonus balls are free: lose as many as you like.</p>

<h3>Controls</h3>
<table class="keys">
${mobile ? TOUCH_CONTROLS : KEYBOARD_CONTROLS}
</table>

<h3>Bricks</h3>
<table class="bricks">
${BRICKS.map(([img, name, text]) => `<tr><td><img src="sprites/${img}" alt="${name}"></td><td>${name}</td><td>${text}</td></tr>`).join('')}
</table>
<p>Different bricks take different numbers of hits. The ball gets quicker the further through a level you are,
and quicker still on later levels; losing a ball resets the pace. If nothing has been destroyed for a while, a
bonus ball is thrown in.</p>
<p>Don't just wipe the bat from side to side to catch everything: a bat that's swept back and forth too
often gets worn out, and for a few seconds it can't keep up.</p>
`;
}

const CREDITS = `
<h2>Credits</h2>
<p>Breakout is &copy; 2025-26 7th software Ltd. A modern take on the classic brick-breaker, with a nod to Arkanoid,
Fireball 2 on the Archimedes, and the other classics.</p>
<ul>
<li>Sound effects made with <a href="https://sfxr.me/" target="_blank" rel="noopener">sfxr</a></li>
<li>Music: &ldquo;Chiptune Adventures&rdquo; by <a href="https://juhanijunkala.com/" target="_blank" rel="noopener">Juhani Junkala</a>,
released under CC0 via <a href="https://opengameart.org/content/4-chiptunes-adventure" target="_blank" rel="noopener">OpenGameArt</a></li>
<li>Final level background: the Rosette Nebula, by <a href="https://deography.com/will-you-accept-this-rose-ngc2237/" target="_blank" rel="noopener">Dylan O'Donnell</a></li>
<li>Thanks to ChatGPT for art assistance</li>
<li>Web conversion by <a href="https://www.anthropic.com/claude" target="_blank" rel="noopener">Anthropic's Claude</a></li>
<li>The desktop version is built on the <a href="https://www.pygame.org/" target="_blank" rel="noopener">Pygame</a> community's excellent work</li>
</ul>
<p class="dedication">Dedicated to Helena and Karen.</p>
`;

let mobile = false;
let overlay = null;
let body = null;
let onClose = null;
let options = null;   // {getState, actions} while the Options page is showing
let camera = null;    // {overlay, video, stream, onPhoto} while the selfie camera is showing

/** Tell the pages which device they're on (affects the Help controls table). */
export function setMobile(flag) {
  mobile = flag;
}

function ensure() {
  if (overlay) return;
  overlay = document.getElementById('modal');
  body = document.getElementById('modal-body');
  overlay.addEventListener('click', (e) => {
    // A link is allowed to do its job; an options button runs its action; a click anywhere else closes the page
    if (e.target.closest('a')) return;
    const button = e.target.closest('button[data-action]');
    if (button && options) {
      const action = options.actions[button.dataset.action];
      if (action) action();
      if (options) renderOptions();   // The action may have closed the page
      return;
    }
    closeModal();
  });
}

function show(html, closed) {
  ensure();
  body.innerHTML = html;
  onClose = closed;
  overlay.hidden = false;
  overlay.querySelector('.panel').scrollTop = 0;
}

/**
 * Open a modal page.
 *
 * @param {'help'|'credits'} kind
 * @param {Function} [closed] Called when it's dismissed.
 */
export function openModal(kind, closed = null) {
  options = null;
  show(kind === 'help' ? help(mobile) : kind === 'credits' ? CREDITS : '', closed);
}

/**
 * Open the Options page.
 *
 * @param {Function} getState Returns {inGame, music, fullscreen, fullscreenAvailable}; read afresh on each render
 *                            so the buttons always show the current state.
 * @param {Object<string, Function>} actions Handlers keyed by button: resume, music, fullscreen, help, credits, quit.
 * @param {Function} [closed] Called when it's dismissed (by any means).
 */
export function openOptions(getState, actions, closed = null) {
  options = { getState, actions };
  show('', closed);
  renderOptions();
}

/** Redraw the Options page's buttons from the current state (no-op unless it's showing). */
export function renderOptions() {
  if (!options || !overlay || overlay.hidden) return;
  const s = options.getState();
  const button = (action, label) => `<button type="button" data-action="${action}">${label}</button>`;
  const rows = [];
  rows.push(button('resume', s.inGame ? 'Resume' : 'Close'));
  rows.push(button('music', `Music: ${s.music ? 'on' : 'off'}`));
  if (s.fullscreenAvailable) rows.push(button('fullscreen', `Fullscreen: ${s.fullscreen ? 'on' : 'off'}`));
  rows.push(button('help', 'Help'));
  if (s.inGame) rows.push(button('quit', 'Quit to the menu'));
  else rows.push(button('credits', 'Credits'));   // On the intro the page is also how a phone reaches Credits
  body.innerHTML = `<h2>${s.inGame ? 'Paused' : 'Options'}</h2><div class="options">${rows.join('')}</div>`;
}

export function closeModal() {
  if (camera) {   // Escape with the camera up gives up on the photo
    closeCamera();
    return;
  }
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  options = null;
  const cb = onClose;
  onClose = null;
  if (cb) cb();
}

export function modalOpen() {
  return (!!overlay && !overlay.hidden) || !!camera;
}

// --- Selfie camera (the win certificate) ------------------------------------------------------------------------

/**
 * Open the selfie camera over the page: a mirrored live preview from the front camera, with a button to take the
 * photo and one to give up. The photo is the middle square of the frame, mirrored as the preview was (so the
 * player gets what they saw), handed back as a canvas no bigger than 640 px. Nothing is kept: the stream stops
 * as soon as the photo is taken or the page is closed. A device without a camera, or a refused permission,
 * just says so and offers Cancel.
 *
 * @param {Function} onPhoto Called with the canvas when a photo is taken.
 */
export function openCamera(onPhoto) {
  if (camera) return;
  const overlay = document.getElementById('camera');
  const video = document.getElementById('camera-video');
  const note = document.getElementById('camera-note');
  const snap = overlay.querySelector('[data-camera=snap]');
  camera = { overlay, video, stream: null, onPhoto };
  if (!overlay.dataset.wired) {
    overlay.dataset.wired = '1';
    overlay.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-camera]');
      if (!button || !camera) return;
      if (button.dataset.camera === 'snap') takePhoto(); else closeCamera();
    });
  }
  const fail = (message) => { note.textContent = message; snap.hidden = true; };
  snap.hidden = false;
  note.textContent = 'Starting the camera\u2026';
  overlay.hidden = false;
  const media = navigator.mediaDevices;
  if (!media || !media.getUserMedia) {
    fail('No camera is available here');
    return;
  }
  media.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then((stream) => {
    if (!camera) {   // Cancelled while the browser was asking
      stream.getTracks().forEach((track) => track.stop());
      return undefined;
    }
    camera.stream = stream;
    video.srcObject = stream;
    note.textContent = '';
    return video.play().catch(() => {});
  }).catch((err) => fail(`The camera couldn't be started (${err && err.name ? err.name : err})`));
}

/** Take the middle square of the current frame, mirrored, and hand it over. */
function takePhoto() {
  const { video, onPhoto } = camera;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;   // No frame has arrived yet
  const size = Math.min(vw, vh);
  const out = Math.min(size, 640);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.translate(out, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, (vw - size) / 2, (vh - size) / 2, size, size, 0, 0, out, out);
  closeCamera();
  onPhoto(canvas);
}

/** Stop the camera and hide the overlay. */
function closeCamera() {
  if (!camera) return;
  const { overlay, video, stream } = camera;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  overlay.hidden = true;
  camera = null;
}

export function cameraOpen() {
  return !!camera;
}
