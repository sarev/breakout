# Breakout

A modern take on the classic brick-breaker. Clear all destroyable bricks while keeping the blue “hero” ball in play. Power-ups, lasers, inversion, and multi-ball keep things lively. It runs as a desktop game (Python and Pygame) and as a [browser version](#web-version) that plays the same game on a canvas, with touch support.

![Illustration](./web/sprites/intro.png)

## Features

- Six handcrafted levels with per-level brick layouts
- Multiple brick types with unique effects and hit points
- Bonus balls, extra bats, control inversion, laser mode, and blackout mode
- Stereo-panned sound effects and chiptune background music (toggle with **M**)
- Multi-monitor aware with dynamic resizing
- A browser version in the `web` folder, with mouse and touch controls
- Smooth intro scene with perspective-warped card and animated balls

## Requirements

- **Python**: 3.10 or newer  
- **OS**: Windows, macOS, or Linux with a working SDL2 video driver

### Python packages

Installed via `pip`:

- `pygame` – rendering, input, audio
- `opencv-python` – intro image warping
- `numpy` – array ops and masks

#### Dependencies

```txt
pygame>=2.5
opencv-python>=4.9
numpy>=1.24
```

Note: this game is also compatible with Pygame Community Edition. If you would prefer to use that, simply replace `pygame` with `pygame-ce` in the installation process.

## Installation and Setup

```bash
# 1) Create a virtual environment (recommended)
python -m venv .venv

# 2) Activate the virtual environment
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# 3) Ensure the 'pip' tool is up to date
python -m pip install -U pip

# 4) Install dependencies
pip install pygame opencv-python numpy
```

## Running the game

```bash
# 1) Activate the virtual environment (if you haven't already done so)
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# 2) Start the game
python breakout.py
```
You can also pass the `--ratio` (or `-r`) parameter to scale the graphics down by a specified amount, e.g.

```bash
python breakout.py -r 4
```
will down-scale all of the graphics by a factor of four (horizontally and vertically). Higher values give more retro vibes! If your machine struggles to play Breakout smoothly at full resolution, increasing the `-r` parameter should reduce CPU load.

## Mouse sensitivity

Pointer movement is scaled so that moving the bat from one side of the playfield to the other takes the same hand movement on any monitor, whatever its resolution. If you'd like it quicker or slower, pass `--sensitivity` (or `-s`): `-s 1.5` needs a third less movement, `-s 0.75` a third more.

## Monitor selection

If you have multiple monitors, you can pass the `--monitor` (or `-m`) parameter to specify the desired monitor number (with 0 being the primary display).

```bash
python breakout.py -m 2
```
If this parameter isn't passed and there are multiple monitors detected, you will see a monitor selection icon in the top-left of the intro screen. Clicking this will move the game to each monitor in turn.

## How to play

- **Goal**: Destroy all destroyable bricks in a level without losing all of your lives.
- **Lives**: You lose one life each time the blue hero ball falls off the bottom. Some bricks grant extra lives.
- **Levels**: Clear a level to advance.

### Controls

- **Mouse**: Move the bat horizontally. Where the ball lands on the bat sets the angle it leaves at: the centre sends it straight up, the ends send it off sideways
- **Left click**: Launch the ball when it is sitting on the bat (it launches by itself after a few seconds). Hold the bat still to send it straight up, or flick the bat sideways as you click to send it off at an angle. Otherwise, a click speeds all the balls up a little
- **Space**: Pause or resume
- **M**: Music on or off (also works on the intro screen)
- **Q / Esc**: Quit

### Music

The intro and each level have their own chiptune track, played at a volume that leaves room for the sound effects. Levels 4 to 6 bring the first three tunes back faster (and higher), old-school style. Start with it off using `--no-music`, or set the level with `--music-volume 0.25` (0 to 1). The tracks live in `web/music`; see `web/music/CREDITS.txt`.
- **Intro screen**: Move the mouse over the menu to select a difficulty, then click or press any key

### Brick types

| Brick | Type | Description |
|-------|-------|-------------|
| ![Blue](./web/sprites/sm-brick0.png) | **Blue** | Standard; no effect |
| ![Red](./web/sprites/sm-brick1.png) | **Red** | Spawns a temporary red bonus ball |
| ![Green](./web/sprites/sm-brick2.png) | **Green** | Adds a temporary extra bat |
| ![White star](./web/sprites/sm-brick3.png) | **White star** | Grants an extra life |
| ![Black hole](./web/sprites/sm-brick4.png) | **Black hole** | Temporarily darkens the screen |
| ![Yellow arrows](./web/sprites/sm-brick5.png) | **Yellow arrows** | Temporarily reverse controls |
| ![Cracked fire](./web/sprites/sm-brick6.png) | **Cracked fire** | Destroys neighbouring bricks (cascade) |
| ![Metal](./web/sprites/sm-brick7.png) | **Metal** | Indestructible |
| ![Warning triangle](./web/sprites/sm-brick8.png) | **Warning triangle** | Enables laser mode for a duration |

Different brick types require different numbers of hits to destroy. If no brick is destroyed for a while, an extra bonus ball is introduced.

## Web version

The `web` folder holds a browser version of the game: a port to plain JavaScript on the HTML canvas, with no build step. It plays the same levels with the same physics, speed model and power-ups, fills the browser tab, and works with touch as well as a mouse. The folder is self-contained — the page, the scripts, and the sprites, sounds and music (which the desktop game loads from there too) — so it can be copied as it is to any static web server.

### Running it locally

Browsers won't let a page fetch audio from a `file://` URL, so it has to be served over HTTP. Any static server will do; Python has one built in:

```bash
python -m http.server 8000 --directory web
```

then open http://localhost:8000/ in a browser.

### Publishing

Copy the `web` folder to a static web server (SFTP, S3, GitHub Pages, whatever you have). Nothing needs building, and there are no other dependencies. The folder also carries the favicon, a home-screen icon for phones, and a web app manifest, so a phone that adds the page to its home screen gets a proper icon and launches it fullscreen in landscape. That installed-app launch needs the page to be served over HTTPS (a plain `http://` test server gives a bookmark that opens in the browser instead), and Samsung Internet also wants the small service worker in `sw.js`, which caches nothing. In Samsung Internet, once the page has loaded over HTTPS a small download-style icon appears at the right-hand end of the address bar; tapping it offers "Add to apps", which installs it (the menu's "Add page to Home screen" only makes a bookmark). Android then shows a warning about the app being unsafe, because the wrapper isn't from an app store; that's Samsung's wrapper, not the page, and can be waded past. Opened in a browser on a phone, the first tap on the title card goes fullscreen and asks for landscape anyway. The folder is about 16 MB, almost all of it the music and the large sprite images.

### Controls

| Input | Action |
|-------|--------|
| **Click, tap or any key** | Dismiss the title card (browsers only allow sound after you've interacted with the page) |
| **Mouse** | Moves the ball on the intro and the bat in play |
| **Touch** | The ball on the intro, and the bat in play, sit under your finger: put it down anywhere across the screen and the bat goes there |
| **Click / tap** | Starts a game from the intro; launches the ball when it's sitting on the bat; otherwise speeds all the balls up a little |
| **Two-finger tap** | Pauses and opens the Options page: music, fullscreen, help, and quit to the menu. On the intro it offers the music and fullscreen toggles |
| **Space** | Pause or resume |
| **M** | Music on or off |
| **F** | Fullscreen on or off |
| **L** | Capture the mouse so it can't leave the page while you play (a message confirms it; **Esc** or **L** releases it, and Esc also pauses) |
| **Q** | Back to the intro |
| **H / C** | Help and Credits pages, also reachable from the links on the intro |

Moving the bat from one side of the playfield to the other takes the same hand movement on any screen, as in the desktop version, except that the mouse is never slowed down: on a screen or window narrower than 1920 pixels the cursor's full width maps to the full playfield, so the bat can always reach the sides. A finger needs no such scaling: the bat is simply wherever the finger is.

### On a phone or tablet

The page notices when it's on a touch-only device (no mouse to hover with) and adjusts itself: the prompts say "tap", the mouse is never captured, the bats sit a little higher and are drawn twice as wide in landscape so they show either side of the fingertip driving them, and the Help page describes the gestures instead of the keys. A two-finger tap is the way to get at everything the keyboard would otherwise do. It's best played in landscape; turning fullscreen on from the Options page also asks the browser to lock the orientation to landscape, where it allows that. Adding `?mobile=1` or `?mobile=0` to the address forces the mobile or desktop behaviour, which is handy for trying the touch layout on a desktop with a touch screen.

### Options

Options go on the URL, for example `http://localhost:8000/?music=0&sensitivity=1.5`:

| Option | Effect |
|--------|--------|
| `music=0` | Start with the music off |
| `volume=0.25` | Music volume, 0 to 1 (default 0.4) |
| `sensitivity=1.5` | Mouse sensitivity multiplier (default 1) |
| `mobile=1` / `mobile=0` | Force the phone-and-tablet behaviour on or off, instead of detecting it |
| `debug=1` | Developer cheats: **D** destroys every brick, and a click destroys the brick under the pointer |

### Things worth knowing

- The page opens on a title card and waits for a click, tap or key. That first interaction is what lets the browser start playing sound.
- A playfield wider than 16:9 or narrower than 4:3 is letterboxed, as on the desktop, so the brick layout stays playable. Resizing the window (or rotating a tablet) rescales the game in place.
- The page is designed to be cheap when it's not being played: the title card and a settled intro screen render at a low frame rate, and the browser stops the game entirely while the tab is hidden.
- Wiping the bat from side to side fast enough would catch everything, so a bat that's swept back and forth too often (five long, quick sweeps within two seconds while the hero ball is heading down) is worn out for a couple of seconds: it's drawn faded and can only crawl. A single desperate swipe across the playfield never triggers it.
- The mouse is **not** captured by default. If you turn capture on with **L**, Esc gives it back, and so does pausing. Capture is never offered on a phone or tablet.
- To try it on a phone, serve the folder on your network rather than just this machine (`python -m http.server 8000 --bind 0.0.0.0 --directory web`) and open `http://<this machine's address>:8000/` on the phone.

## Troubleshooting

- **No video device / SDL errors (Linux)**: Ensure you are in a graphical session and SDL2 can open a display. On headless systems set up Xvfb or Wayland appropriately.
- **OpenCV import errors**: Use `opencv-python` wheels rather than `opencv`. On some Linux distros you may need system OpenGL packages.
- **Fonts missing**: The code uses the default Pygame font; if you change it (e.g. to a system font), ensure it is installed.
- **Black bars**: on a monitor wider than 16:9 (or narrower than 4:3) the playfield is letterboxed so the brick layout stays playable. This is deliberate.
- **Windows display scaling**: the game declares itself DPI-aware so that a high-resolution monitor with Windows scaling (for example a 4K panel at 200%) is used at its native resolution rather than the scaled-down size. If you need the old behaviour, set the environment variable `SDL_WINDOWS_DPI_AWARENESS=unaware` before running.

## Debugging

Run with `--debug` to enable a few developer cheats during play: **D** destroys every brick (skipping the level), **right-click** shows the mouse pointer, and **left-click** destroys the brick under it. They are switched off in normal play.

## Credits

- Pygame community (https://www.pygame.org/contribute.html) for an excellent Python module
- The very useful sfxr (https://sfxr.me/) for sound effect generation
- Background music: "Chiptune Adventures" by Juhani Junkala (https://juhanijunkala.com/), released under CC0 via OpenGameArt (https://opengameart.org/content/4-chiptunes-adventure)
- A nod to Arkanoid, Fireball 2 (Archimedes), and other classics
- Final level background: Rosette Nebula (Dylan O'Donnell, https://deography.com/will-you-accept-this-rose-ngc2237/)
- Thanks to ChatGPT for art assistance
- Web conversion by Anthropic's Claude (https://www.anthropic.com/claude)

---

_Dedicated to Helena and Karen._
