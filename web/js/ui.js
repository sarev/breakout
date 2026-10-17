// The Help and Credits modals: plain HTML laid over the canvas, with the game blurred behind them.
//
// These are ordinary DOM so the text scrolls and wraps properly at any size; the canvas keeps animating
// underneath and the overlay's backdrop-filter blurs it. While a modal is open the overlay swallows pointer
// events, and main.js ignores keys other than Escape. A click anywhere (or Escape) closes it.

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
];

const HELP = `
<h2>How to play</h2>
<p>Clear every destroyable brick without losing all your lives. You lose a life each time the blue hero ball
falls off the bottom. Red bonus balls are free: lose as many as you like.</p>

<h3>Controls</h3>
<table class="keys">
<tr><td>Mouse</td><td>Moves the bat. Where the ball lands on the bat sets its angle: the centre sends it straight up, the ends send it off sideways.</td></tr>
<tr><td>Click</td><td>Launches the ball when it's sitting on the bat (flick the bat sideways as you click to aim it). Otherwise, speeds all the balls up a little.</td></tr>
<tr><td>Touch</td><td>A finger moves the ball on this screen and drags the bat in play. Tap to launch or speed up, two-finger tap to pause.</td></tr>
<tr><td>Space</td><td>Pause and resume</td></tr>
<tr><td>M</td><td>Music on or off</td></tr>
<tr><td>F</td><td>Fullscreen</td></tr>
<tr><td>L</td><td>Capture the mouse so it can't leave the page (Esc or L releases it)</td></tr>
<tr><td>Q</td><td>Back to this screen</td></tr>
</table>

<h3>Bricks</h3>
<table class="bricks">
${BRICKS.map(([img, name, text]) => `<tr><td><img src="sprites/${img}" alt="${name}"></td><td>${name}</td><td>${text}</td></tr>`).join('')}
</table>
<p>Different bricks take different numbers of hits. The ball gets quicker the further through a level you are,
and quicker still on later levels; losing a ball resets the pace. If nothing has been destroyed for a while, a
bonus ball is thrown in.</p>
`;

const CREDITS = `
<h2>Credits</h2>
<p>Breakout is &copy; 2025 7th software Ltd. A modern take on the classic brick-breaker, with a nod to Arkanoid,
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

const PAGES = { help: HELP, credits: CREDITS };

let overlay = null;
let body = null;
let onClose = null;

function ensure() {
  if (overlay) return;
  overlay = document.getElementById('modal');
  body = document.getElementById('modal-body');
  overlay.addEventListener('click', (e) => {
    // A click anywhere closes the modal, except on a link, which is allowed to do its job
    if (e.target.closest('a')) return;
    closeModal();
  });
}

/**
 * Open a modal page.
 *
 * @param {'help'|'credits'} kind
 * @param {Function} [closed] Called when it's dismissed.
 */
export function openModal(kind, closed = null) {
  ensure();
  body.innerHTML = PAGES[kind] || '';
  onClose = closed;
  overlay.hidden = false;
  overlay.querySelector('.panel').scrollTop = 0;
}

export function closeModal() {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  const cb = onClose;
  onClose = null;
  if (cb) cb();
}

export function modalOpen() {
  return !!overlay && !overlay.hidden;
}
