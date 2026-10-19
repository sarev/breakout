# Breakout: How It Hangs Together

This is a compact, engineer-to-engineer tour of the code. I focus on how the various pieces fit together, the design choices I made, and why they (hopefully) work well in practice.

# High-level overview

I built a modern Breakout in Pygame with a handful of spicy twists: extra bats, bonus balls, control inversion, lasers, and a blackout effect. I keep things readable with a small set of entities (classes representing objects in the game), a graphics helper class for surfaces and assets, and a single `Game` class that runs the show. Sprites and layouts are scaled to the monitor so it looks sane on laptops and TVs. It also tries to pick a single monitor on multi-monitor setups. The intro screen uses a simple OpenCV perspective warp to sell some production value (otherwise known as a cheesy spinning 3D screenshot!). The runtime adapts to different display setups and window sizes while keeping a 1080p design baseline.

## Multi‑monitor support

- The game can run on any connected display. Displays are addressed by a zero-based index.
- At startup, an interactive **Monitor Selector** is available on the intro screen. Clicking its icon cycles through available monitors and reinitialises the window on the chosen display without restarting the process.
- The selector is automatically hidden when only one display is detected or when a monitor number is supplied via the CLI.
- The window is created as a borderless full-screen surface sized to the target display. Logical coordinates are scaled from the 1080p baseline so gameplay and UI remain consistent across monitors.

## Intro “rotating card” effect (OpenCV)

The intro screen features a rotating rectangular “card” that is perspectively warped using OpenCV. The pipeline is:

1. Compute the card’s 3D orientation and project the quad into screen space.
2. Build a perspective transform that maps the source texture onto the projected quad.
3. Warp only the bounding box of the projected quad (clipped to the window), by shifting the transform so the box lands at the origin of a box-sized output image, and blit the result at the box's position. Warping a whole window-sized image that was mostly black was the most expensive part of the intro at 4K.

**Edge-on optimisation:** when the projected quad is nearly edge-on, the code skips the expensive warp step to avoid aliasing and save time. The skip decision uses a simple threshold on the quad’s projected width/area to detect the near-degenerate case. Frames that are skipped fall back to a cheaper path so the animation remains smooth and visually stable.

# Time base

Everything that moves is expressed in **pixels per second** (scaled for the window via `Graphics.scale_ratio`) and integrated using the real time that elapsed between frames, so the game plays at the same speed whatever frame rate the machine achieves. The frame-rate caps (`GAME_FPS`, `INTRO_FPS`) only limit how often we render.

- **Frame time:** `Game.display()` presents the frame, waits for the next frame slot, and returns the measured frame time (clamped to `MAX_FRAME_DT` so a stall can't teleport objects). The next `Game.update(dt)` simulates exactly that much time.
- **Physics sub-steps:** `update()` splits each frame into equal sub-steps no longer than `1 / PHYSICS_HZ` seconds (240 Hz, so four per frame at 60 fps). Balls and lasers move and resolve collisions on every sub-step, which stops fast objects skipping straight over bricks or the bat.
- **Game clock:** `Game.time` is seconds of *simulated* time. It only advances inside `update()`, so it stands still while paused or during a splash. Every gameplay timer — bonus bat expiry, inversion, laser mode, the "boring" timer, the blackout fade — is measured against it rather than wall-clock time or frame counts.
- **Speed limits:** `Game.min_ball_speed(level)` and `Game.max_ball_speed(level)` give the clamp range in px/s for the current window; see *Speed model* below.

# Speed model

All the numbers live together at the top of `Game`, in px/s at the 1080p reference and scaled to the window at run time.

- **Target speed:** `Game.target_ball_speed(level)` is `base_ball_speed[difficulty] × level_speed_ramp^(level − 1)` — 480/560/640 px/s for easy/medium/hard on level 1, growing 8% per level, so level 6 is about 1.47× level 1. This is the speed the hero ball is served at, and what bonus balls are spawned relative to.
- **Floor and ceiling:** `min_speed_fraction` (0.75) and `max_speed_fraction` (1.6) of the target. `Ball.move()` clamps to this range every sub-step. The floor is what stops the end of a level dragging; the ceiling is what stops a long rally running away.
- **Gaining speed:** every bat hit adds `bat_hit_speed_gain[difficulty]` of the target (1/2/3%); a left click adds `kick_speed_gain` (15%) to every ball. Both are additive, so they top out at the ceiling rather than compounding.
- **Serving:** at the start of a level and whenever the hero ball is lost, `Game.start_serve()` parks it on the bat. It rides with the bat until the player clicks or `serve_timeout` seconds of game time pass, then `Game.serve()` launches it at the target speed. The player aims the serve by moving the bat as it goes: the bat's smoothed sideways speed (`Bat.vx_smooth`, times `serve_flick_gain`) is taken as the ball's sideways component against the target as the upward component, and the resulting angle, clamped to `serve_max_angle`, is applied at exactly the target speed. A still bat serves straight up give or take `serve_jitter`; a flick sends it off sideways without making it faster. Losing a ball therefore resets the pace. Bonus balls still re-enter from a side when they drop.
- **Aiming:** on the flat top of the bat the outgoing angle is set by where the ball landed, from straight up at the centre to `Ball.max_bat_angle` (60°) at either end, plus a couple of degrees of jitter so a rally can't lock into a loop. The rounded ends still reflect about the contact normal.
- **Endgame boost:** the target is multiplied by `1 + endgame_speed_boost × cleared_fraction` (up to 1.35× with one brick left). A full field leaves a narrow gap above the bat and needs a slower ball; an empty one leaves the ball a long way to travel and a slow one makes hunting the last bricks a chore. Since the floor and ceiling are fractions of the target, a ball already in play is eased along as the field clears, and every serve after a lost life comes out at the boosted speed. `Game.update()` recounts the live bricks once per frame so the boost also reflects cascades and cheats.

# Runtime configuration & CLI

The game exposes a small set of command‑line flags to control display placement and render scale. These options are also reflected in runtime behaviour on the intro screen.

## Flags

- `--monitor, -m <index>`  
  Zero‑based display index to use. `0` selects the primary display. Supplying this disables the interactive Monitor Selector on the intro screen. Example: `-m 1` starts on the second display.

- `--resize, -r <ratio>`  
  Down‑scale ratio applied to the playfield resolution and the derived sprite/text scaling. Must be `>= 1.0`. Example: `-r 2` renders at 50% of the native desktop resolution (width and height each divided by 2) while preserving aspect.

### Notes

- Logical layout is designed for a 1080p baseline and then scaled using the height of the 16:9 logical playfield (see *Graphics*).  
- The window is created borderless and full‑screen on the target display, with black bars if the display is wider than 16:9 or narrower than 4:3.  
- An out-of-range `-m` index is rejected with a message listing how many displays were found (exit code 2).  
- `main()` sets the SDL hint `SDL_WINDOWS_DPI_AWARENESS=permonitorv2` before `pygame.init()`. Without it a Windows display with scaling enabled reports its scaled-down logical size (a 3456×2160 panel at 200% looks like 1728×1080), the game renders at that size and Windows blurs it back up. With it, SDL reports native pixels and the playfield is built at the display's true resolution. The hint is ignored on other platforms, and `setdefault` means an environment override still wins.  
- When `-m` is omitted and multiple displays exist, the intro screen shows a small monitor icon. Clicking it cycles through the available displays and re‑initialises the window on the chosen one, without restarting the process.

- `--sensitivity, -s <multiplier>`  
  Mouse sensitivity on top of the automatic per-monitor gain (see *Platform & input*). Default `1.0`.

- `--debug`  
  Enables the developer cheats in `game_loop()`: **D** destroys every brick, **right-click** shows the pointer, **left-click** destroys the brick under it. Off by default so they can't be hit by accident in normal play.

## Examples

```bash
# Always open on the primary monitor at native resolution
python breakout.py -m 0 -r 1.0

# Open on monitor 2 and render at 80% of native size to reduce load
python breakout.py -m 1 -r 1.25
```

## Graceful shutdown and error handling

`main()` wraps the outer loop with defensive handlers:

- `KeyboardInterrupt` cleanly exits with code `130` and prints a short “Interrupted” message.  
- Any other unexpected exception prints a full traceback and exits with code `1`.  
- `pygame.quit()` is called in a `finally` block to ensure the video subsystem is shut down even on errors.

This keeps terminal sessions tidy and avoids leaving the window subsystem in a bad state after failures.

# Packaging & asset paths

The game resolves all asset locations through a single base directory so it runs the same from source and when bundled with PyInstaller.

## Base path resolution

```python
# breakout.py
class Game:
    # When frozen by PyInstaller, sys._MEIPASS points at the temp unpack dir.
    # Otherwise fall back to the project root (current working directory).
    base_path = sys._MEIPASS if hasattr(sys, '_MEIPASS') else os.path.abspath(".")

    # Resource roots
    assets_path  = os.path.join(base_path, "web")   # shared with the browser version
    sprites_path = os.path.join(assets_path, "sprites")
    sounds_path  = os.path.join(assets_path, "sounds")
    music_path   = os.path.join(assets_path, "music")
```

- **`Game.base_path`**: Root directory for assets.  
  - When running a PyInstaller build, `sys._MEIPASS` is provided by the bootloader and points at the temporary extraction directory.  
  - When running from source, it defaults to the absolute path of the current working directory.
- **`Game.sprites_path` / `Game.sounds_path` / `Game.music_path`**: Canonical subdirectories for image and audio assets. All loaders should join against these rather than hard‑coding relative paths. They live under `web/` so that folder is a complete, self-contained copy of the browser version that can be published to a static web server as it is; the Python game simply loads the same files from there.

### Usage guidelines

- Always construct file paths via `os.path.join(Game.sprites_path, ...)` or `os.path.join(Game.sounds_path, ...)`.  
- For non‑sprite assets that live at the root, join against `Game.base_path`. Example:
  ```python
  intro_img = os.path.join(Game.sprites_path, "intro.png")
  click_wav = os.path.join(Game.sounds_path, "click.wav")
  save_db = os.path.join(Game.base_path, "savedata.db")
  ```
- Avoid `__file__`-relative logic inside modules that may be collected differently by PyInstaller. `Game.base_path` abstracts this away.
- Keep the folder names `images/`, `web/sounds/` and `web/music/` flat and deterministic, since PyInstaller’s data file spec packs them under the same names. The sprites are the PNG masters in `images/`; `web/sprites/` holds only the browser version's WebP copies.

### PyInstaller notes

- When creating the executable, include data folders:
  ```bash
  pyinstaller \
      --onefile \
      --icon=icon.ico \
      --noconsole \
      --add-data "images;images" \
      --add-data "web/sounds;web/sounds" \
      --add-data "web/music;web/music" \
      breakout.py
  ```
- At runtime the `_MEIPASS` override ensures lookups work without special-casing the frozen build.

# Music

Background music is streamed from OGG files in `web/music/` through `pygame.mixer.music`, which is a separate channel from the sound effects, so the stereo panning and volumes of the effects are untouched and the music has its own volume (`Music.volume`, 0.4 by default, overridable with `--music-volume`).

- The `Music` class maps short track names to files (`intro`, `stage1`, `stage2`, `boss`). A missing file makes that name silent and a missing folder means no music at all, so the game runs identically without the assets.
- The intro plays `intro`; each level plays `Music.level_track(level)`, a (name, tempo) pair from `Music.level_plan`: `stage1`, `stage2`, `boss` for levels 1–3, then the same three again at 1.2×, 1.1× and 1.2× for levels 4–6 so the pace keeps rising rather than dropping back. Levels past the end of the plan cycle through it.
- A tempo other than 1.0 can't go through the streaming channel, so `_resample()` decodes the track, reads its samples at `tempo` times the normal rate with linear interpolation (faster *and* higher, as on real hardware) and keeps the result as a `Sound`. These are built once at start-up, and played looping on mixer channel 0, which is reserved so effects can't take it; the channel count is raised to 16 so the effects still have plenty. `play()`, `stop()`, `pause()` and `toggle()` drive whichever backend holds the current track.
- `play()` is a no-op if the requested track is already playing, which is what lets the music run on uninterrupted across the monitor-switch re-initialisation.
- Pausing the game pauses the music; game over and the win fade it out under the splash; **M** toggles it in the intro and during play; `--no-music` starts with it off.
- The tracks are CC0 (Juhani Junkala's "Chiptune Adventures", via OpenGameArt); `web/music/CREDITS.txt` carries the attribution.

# Web version

`web/` is a port of the game to plain JavaScript (ES modules, no build step) on the HTML canvas. The folder is self-contained — page, scripts, and the `sprites/` (WebP copies of the PNG masters in `images/`), `sounds/` and `music/` folders, the last two of which the Python game also loads from — so it can be copied as it is to a static web server. The Python game is the reference implementation; the web code mirrors its structure, and every tuning constant lives in `web/js/config.js` with the same names and values.

- **`graphics.js`**: the canvas fills the viewport at device-pixel resolution; inside it the playfield is the viewport's shape clamped to 4:3…16:9 (`playfieldSize()`), centred, with black bars where needed. `scale` is playfield height / 1080, exactly as in Python. Sprites are scaled once per viewport size into offscreen canvases; bricks per level. Text goes through one `text()` helper. The glow trails are a list of timed marks redrawn each frame with falling alpha rather than an accumulating layer, because a `destination-out` fade in an 8-bit canvas never reaches zero and leaves ghosts.
- **`entities.js`**, **`game.js`**: direct ports of the Python classes, including the time base (fixed 240 Hz sub-steps, pausable `game.time`), the speed model, aiming, serving, the cool-off, the blackout, lasers, inversion and cascades. The intro card (`intro.js`) is drawn with true perspective by projecting a 10×10 grid of the image and painting each cell as two affine-mapped, clipped triangles, since Canvas 2D has no perspective transform.
- **`input.js`**: one `raw` pointer position drives everything. By default it is the absolute cursor position, as in any canvas game. The Pointer Lock API is opt-in (**L** during play or on the level banner, which carries a hint until the player opts in, or the Options page's capture setting on a desktop, remembered in `localStorage`, which asks for the lock from the click or key that starts each game, as a lock needs a user gesture): then movement deltas accumulate into `raw`, a notice tells the player how to get out, Esc releases the lock and pauses, and a pause releases it and the resume takes it back. The cursor is hidden by script only on the intro and during unpaused play (`updateCursor()` in `main.js`), never by CSS, so it can't be left invisible after a pause. Touch feeds the same position, always absolute (the ball or bat sits under the finger; an earlier relative-drag mode left the bat where it had been when the finger lifted and went down elsewhere, which was very unhelpful), with a tap as the primary action and a two-finger tap opening the Options page (`ui.js`), which pauses the game and stands in for the keys on a device without any. On a desktop the intro's single Options link (or **O**) opens the same page, in place of the Help and Credits links it once had. The gain is applied once in `pointerToPlayfield()`, but which gain depends on what last drove the pointer (`Input.gain()`): a captured mouse uses the mouse gain (playfield width over 1920, times the sensitivity); a free mouse uses it floored at 1, because the real cursor can't go beyond the screen edge and a gain below 1 (any screen or window narrower than 1920 device pixels) would stop the bat reaching the sides; and a finger uses no gain at all, so the bat (or the intro ball) sits exactly under it (tying touch to the mouse gain had left a portrait phone unable to get the bat past half way in one swipe). The captured mouse clamps `raw` to the band where the bat is inside the playfield after the gain, so there's never a dead zone past the edge, and inversion mirrors `raw.x` about the centre at the moment it changes so the bat doesn't jump. `Game.clearInversion()` ends it at every level start and whenever a game ends (certificate or quit), since a mirrored pointer carried into the intro once sent clicks on Help to Credits.
- **Tilt**: on a phone the intro's hero ball is rolled by the device's tilt (`Intro.onOrientation()`, fed from `deviceorientation` events that `main.js` subscribes to after the gate tap, asking iOS for permission there). Level is the sensor's own zero (flat on its back), so the roll vector is simply the sines of beta and gamma turned by the screen's rotation angle, and `Intro.update()` then accelerates the hero by `TILT_ACCEL`, applies `TILT_DAMPING` as rolling friction, and moves it through `Ball.move()` so it bounces like the others. On a phone the ball (finger-driven or tilted) selects nothing; only a tap on a label starts a game, and that label is the one played (`primaryAction()` hit-tests the finger with `Intro.selectAt()`, not the ball). On a desktop the hero ball is the mouse pointer and selects a label as it moves onto one (`Intro.hovered` remembers the last frame's, so a resting pointer doesn't undo the arrow keys); a click on a label, or Enter or Space for the highlighted one, starts the game, and other clicks and keys don't. Until a reading arrives the ball stays finger-driven.
- **Tilt steering**: a phone-only setting on the Options page, offered only on the intro so a game is played one way throughout, at any difficulty, and remembered in `localStorage` (`breakout-tilt`); `main.js` keeps `game.tiltBat` in step with it, and the intro shows a reminder while it's on. (It was once a fourth difficulty, Insane, which played as Hard.) `Game.tiltSteered` records whether the roll actually steered the bat in a game, for the certificate's play mode. `tilt.js` turns `devicemotion` readings (gravity in the device frame, which `main.js` feeds to `game.steer`) into a bat position: the vector is low-pass filtered (`TILT_BAT_SMOOTHING`), the angle of "up" within the screen plane is measured from a reference snapped to the nearest right angle (taken by `TiltSteer.level()` at every level start, on resuming from a pause, and in `Game.relayout()` when the phone is turned), and the roll maps linearly from a dead zone to `TILT_BAT_FULL_PORTRAIT` / `TILT_BAT_FULL_LANDSCAPE` at the edges. Pitch only shortens the in-plane vector and yaw doesn't move gravity, so neither leaks into the steering; when the phone is nearly flat (`TILT_BAT_FLAT`) the last trustworthy roll is held. `Game.batTargetX()` uses it (mirrored while inverted) whenever tilt steering is on and a reading has arrived, so the finger still drives the bat on a phone without an accelerometer. `web/tilt.html` is the standalone page the mapping was dialled in on: it draws the bat and steers it the same way, with sliders and readouts, and is the place to try changes before copying them into `config.js`.
- **`certificate.js`**: the end-of-game screen for a win or a game over, an `'over'` scene that stays up until dismissed (`Certificate.won` picks the banner, the wording of the time line, and whether the third line is the lives left or the level died on). `Game.playSeconds` accumulates `dt` alongside the game clock (so banners and pauses don't count) and `Game.startedAt` is stamped by the first `initialiseLevel()` of a game; `Certificate.start(game)` copies them with the difficulty, the play mode (`Desktop`, or on a phone `Mobile (tilt)` if `Game.tiltSteered`, else `Mobile (touch)`) and the lives left. `draw(ctx, forExport)` renders the page over the level backdrop, and `save()` draws it again on an offscreen canvas without the controls and downloads the PNG through a temporary anchor. The selfie box opens `openCamera()` in `ui.js`: a fixed overlay with a mirrored `<video>` from `getUserMedia({video: {facingMode: 'user'}})`, whose Take button copies the middle square of the frame (mirrored, at most 640 px) to a canvas and hands it to `Certificate.setPhoto()`, stopping the stream at once. `modalOpen()` counts the camera as a modal and `closeModal()` closes it first, so Escape and the input handlers treat it like any other page. Hit-testing on the certificate uses `input.raw` (the real cursor or finger), since the mouse gain would scale a click away from the box it landed on.
- **Red lens brick (type 9, web only)**: `Game.lenses` holds the game time each lens was broken (cleared in `initialiseLevel()`), and `updateHaze()`, from `update()` and on each break, sets `Game.haze` to their sum: each lens counts 1 for the first `HAZE_SECONDS - HAZE_FADE_SECONDS`, then fades steadily to nothing over the last `HAZE_FADE_SECONDS`, and is dropped once its spell is over. While `haze` is above zero `Game.draw()` draws the playfield to an offscreen layer (`Graphics.layerContext()`) and composites it with `Graphics.drawHazed()`: a blur of `HAZE_BLUR_PER_BRICK` px per unit of haze (capped) through the context's `filter`, or a draw-down-and-up smear where the browser has no canvas filter (Safari), then a radial red vignette whose edge opacity is `HAZE_VIGNETTE_PER_BRICK` per unit (capped) and whose clear centre shrinks as it deepens, so a fading haze eases out smoothly. The HUD numbers are drawn after the composite so they stay crisp, which also moves them above the balls and bats. The layouts carry Hard's full set of lenses in their top rows (one on level 4, two on 5, three on 6, each on its own row counting down from the top); `createBricks()` keeps only the first one on any level for Medium and none for Easy, filling the rest randomly like a 0 cell.
- **Ball spin (web only)**: `Ball.angle` turns the sprite about its centre in `Ball.draw()`. `Ball.spin(dx, dy, dt)` advances it from each step of travel (called from `move()`, and by the intro for the finger-driven hero ball, which doesn't move through `move()`): the distance over the radius, as a rolling ball turns, times `BALL_SPIN_RATE`, capped at `BALL_SPIN_MAX_TURNS` a second so a fast ball isn't a blur. The sense is clockwise heading right and anticlockwise heading left, kept through near-vertical travel (`spinSense` only changes when the horizontal component is a clear fifth of the step) so it doesn't flicker. A held ball (serving) doesn't move, so it doesn't turn. **Spin from the bat**: `Ball.checkBat()` sets `Ball.english` (radians a second, clockwise) from the bat's smoothed speed, `-BAT_SPIN_PER_SWIPE` turns a second per playfield width a second, added to whatever spin is left after the bounce and capped at `BALL_SPIN_MAX` (a drop or a fresh serve clears it). `Ball.curve()`, from `move()`, turns the velocity by `english * BALL_CURVE_PER_TURN / 360` radians a second (speed unchanged), the Magnus effect's sense, and decays `english` with time constant `BALL_SPIN_FADE`, so left alone the total bend would be the starting rate times the time constant (150 degrees for a swipe of a width a second); it's the flattest-path rule below, not that total, that keeps a whipped ball rising. A bend towards the horizontal eases off over the `BALL_CURVE_EASE` degrees before `BALL_CURVE_FLATTEST` and stops there, so spin can never turn a rising ball into a falling one, and the curve dies down rather than stopping dead. Every bounce (walls, ceiling, net, brick edges and corners, the bat's top and caps) then calls `Ball.spinBounce(nx, ny)` with the surface's outward normal: the contact point's surface speed from the spin is `english * r` along the tangent, and the ball is kicked the other way by `BALL_SPIN_GRIP` of it, the speed kept and `BALL_SPIN_BOUNCE_KEEP` of the spin left. The kick is dropped if it would flip the vertical direction, or leave the path flatter than both `BALL_CURVE_FLATTEST` and the plain bounce, which matters at the side walls, whose tangent is vertical. `spin()` shows it: `english` takes over from the rolling rate, wholly above a turn a second and blending back as it fades. Strictly a spin rather than a roll (a rolling sphere seen from above shows its surface flowing, which would need a scrolling texture under a fixed shading layer), but the ball's markings sell it.
- **Safety net brick (type 10, web only)**: `Game.net` is `{y, holdUntil, leaving}` while the net is about; it holds until `holdUntil`, then for `NET_WARNING` seconds more `drawNet()` pulses the whole net's opacity between 1 and `NET_WARNING_FAINTEST` (a cosine of period `NET_WARNING_PULSE`, so it starts and ends at full) before it leaves. `raiseNet()` starts it below the screen (or extends `holdUntil` and cancels a departure), `animateNet()` moves it at a constant rate towards its rest (`netRestY()`, a `NET_GAP` under the hero bat but never off the bottom edge: it floats below a phone's lifted bats and lies flush under a desktop's) or back out, and drops it once it's gone. `Ball.move()` asks `netFloor(ball)` at the start of each step: the net's top if it's on screen and the ball is above it, in which case crossing it bounces the ball back up at `NET_SLOW` of its speed (the normal floor logic, and the dropped life, never runs); a ball already below the net falls as usual. Drawn in `drawNet()` after the bats, as a pulsing core with a gradient glow, under the haze and the HUD. Placed in the layouts about as often as the laser bricks, on every difficulty.
- **Regenerator brick (type 11, web only)**: `Game.regen` is `{left, nextAt, waitingSince}` while bricks are coming back. `startRegeneration()` queues `REGEN_FRACTION` of `bricksTotal` (at least one; another regenerator adds to the queue) and `regenerate()`, from `update()`, pops one every `REGEN_INTERVAL` seconds: a random brick whose explosion has finished (`lives < -20`) and that no ball is within its own diameter of (`ballNear()`, so a ball can't be walled in), revived by `Brick.revive()` as one of the difficulty's random fill types (`RANDOM_BRICK_TYPES`, so never another regenerator, lens or bonus), with the `respawn` sound panned to it. `Brick.born` drives a grow-in over `REGEN_POP` seconds in `Brick.draw()`. If no spot is free the pop waits, and after `REGEN_PATIENCE` seconds the rest of the queue is dropped; `Game.draw()` doesn't report the level complete while a queue is pending, so a regenerator broken last still brings bricks back rather than ending the level under them. The bricks stay in the level's list throughout (a revived brick keeps its id, so cascades and relayout still work).
- **Sprites as WebP (web only)**: the web version loads `web/sprites/*.webp`, made from the PNG masters in `images/` by `tools/make_webp.py` (Pillow; quality 95 with exact alpha, which is about a fifth of the size and looks the same; the desktop-only monitor picker is skipped). The desktop game and the README's tables use the PNGs.
- **Levels, stages and swaying rows (web only)**: each entry of `LEVEL_DEFS` is `{stage, rows}`. The stage, 1 to 6, is the original level a layout belongs to, and it picks the backdrop (`Graphics.buildBackground(stage)`), the music (`Music.levelTrack(stage)`, so a level going back over a stage carries on with the same tune) and the ball's pace (`targetBallSpeed()` ramps by `LEVEL_SPEED_RAMP` per stage, not per level), so a level can be added that revisits a stage with something new without retuning the rest. A row is a list of cells, `null` (written `_` in the layouts) for an empty one, or `{cells, sway, period}` for a row that swings sideways (a negative `sway` sets off to the left, so two rows can swing against each other), holding any bricks, metal or breakable: `Game.swayRows(t)`, from each physics sub-step (so the bricks move smoothly between frames) and after a layout or resize, puts each brick of such a row at its layout place plus `sway` cells times the sine of its phase since `Game.levelStart`, and sets `Brick.vx` to the row's speed. `Game.swayLimit()` caps `sway` so the row never comes nearer a side wall than `SWAY_WALL_GAP` cells, which leaves a ball caught between them room to escape. `Ball.checkBrick()` bounces off a brick's sides and corners as seen from the brick (`vx` relative to `Brick.vx`), so a swaying brick moving into a ball shoves it along faster than itself, and `move()`'s speed limits keep that in bounds; a still brick has `vx` 0 and bounces as it always did. Bricks carry their layout `row` and `col` (ids skip the empty cells, so they no longer map to a grid), which a resize lays them out by, and a fire brick's cascade takes whatever bricks are within one cell of it at that moment, so it catches a swaying row's bricks as they pass. A broken brick in a swaying row can be brought back by a regenerator, and comes back in its place in the row. On Easy the swaying metal becomes blue bricks, as Easy has no metal. Each of levels 2 to 6 is followed by a version of it with swaying rows (levels 3, 5, 7, 9 and 11, eleven levels in all) and more extra lives; levels 2 and 3 have the room for an inserted row, but from stage 4 on the space under the bricks is already tight, so the swaying rows replace static rows and the level is no deeper than the original (stage 6's is a row shallower). In debug mode the keys 1 to 9, 0 and - jump to levels 1 to 11.
- **Mobile devices**: `main.js` decides once at start-up whether it's on a phone or tablet, from the `(pointer: coarse)` media query, with a user-agent fallback, and `?mobile=1|0` to force it. A touch laptop has a fine primary pointer, so it stays on the desktop behaviour. It deliberately doesn't test `(hover: none)` as well: Samsung touchscreens claim they can hover, so that would have called every Samsung phone a desktop (which it did, on Steve's S23, until 2026-10-18). On mobile the prompts say "tap", `Input.requestLock()` is a no-op, the Help page shows the gestures, and `Game.batLift` (`MOBILE_BAT_LIFT`, in bat heights) raises the bats so a fingertip doesn't hide them, and in landscape (`Graphics.batWiden()`, playfield aspect at least `MOBILE_WIDE_ASPECT`) the bat sprites are built `MOBILE_BAT_WIDEN` times wider by `widenImage()`, which keeps the two end caps and stretches only the middle, so the ball's end-cap circles still match the picture; a bonus ball coming in from a side comes in clear of the bats (`Game.bonusEntryY()`) so it can't appear inside one. Fullscreen has the WebKit-prefixed fallbacks and, on mobile, follows the orientation instead of locking it: a page may leave fullscreen at any time but may only enter it from a user gesture, so a resize that turns the viewport portrait calls `exitFullscreen()` at once, while landscape arms `fullscreenOnTap()`, which every tap calls first. A `fullscreenchange` we didn't ask for while still in landscape (the back gesture) switches the automatic behaviour off until the next orientation change, so the player isn't fought.
- **`audio.js`**: effects are one-shot buffer sources with a `StereoPannerNode` and a gain (pan by x, volume by speed, as in Python), and an optional playback rate. The metal brick's clang, which the later levels and lasers hammer, plays at `METAL_HIT_VOLUME` of its volume and a random rate within `METAL_HIT_PITCH` either side of 1, so a run of them is quieter and doesn't grate. Music is a looping buffer source whose `playbackRate` is the level's tempo, so the sped-up tracks need no resampling. The `AudioContext` starts suspended and is resumed by the first click or key; pausing the game suspends it.
- **`ui.js`**: the Help and Credits pages, as HTML in an overlay (`#modal` in `index.html`) whose `backdrop-filter` blurs the still-animating canvas behind it. Opened from the intro's links (hit-tested in `intro.linkAt()`), a tap, or H / C; closed by Esc or a click anywhere (links inside still work). While open, the overlay swallows pointer events and `main.js` ignores all keys but Escape.
- **`main.js`**: scene state machine (gate → intro → splash → game → splash …, and game → over → intro after the last level or the last life) on `requestAnimationFrame` with the same frame-time clamp as Python, keyboard and mouse handling, viewport resize (everything is rescaled in place), and `window.breakout` exposing the live objects for debugging. The music on/off choice is kept in `localStorage` (`breakout-music`, written by `toggleMusic()` and read at start-up unless `?music=` is on the URL; storage failures are swallowed, so a private window just forgets). Idle throttling keeps an unattended page cheap: the gate renders at `IDLE_FPS` (12), and the intro drops to it once there has been no input for `IDLE_AFTER` seconds and the balls have settled (`Intro.totalSpeed()` below a pixel per frame), or while a modal is open — but first the card eases round to face the viewer at full rate (`Intro.setIdle()` / `cardSettled()`), because a card rotating at 12 fps looks broken; the splash and the game always run at full rate, and the browser stops the loop in a hidden tab.

- **`wipe.js`**: the anti-cheat for the windscreen-wiper, which on a phone is as easy as rubbing the screen. `WipeDetector.observe()` is fed the control position each frame (from `Game.animateBats()`) and splits it into legs (runs in one direction, with `WIPE_HYSTERESIS` of reverse travel before a turn counts). What's measured is how often the bat turns round: a turn counts if the leg it ends covered at least `WIPE_LEG_TRAVEL` of the width (the jitter of a tilt-steered bat turns round every frame but goes nowhere, so it never counts), and `WIPE_TURNS` counting turns within `WIPE_WINDOW` seconds tire the bat for `WIPE_PENALTY` seconds, during which `Game.animateBats()` lets it move no faster than `WIPE_TIRED_SPEED` widths per second, the bats draw faded, and `main.js` shows a notice. The width of the sweeps and the hero ball's direction are deliberately not part of it: the first version wanted long sweeps while the hero ball was falling, and a fast narrow wobble under a bonus ball's path (a leg far shorter than that, with the hero ball often rising) got past it entirely. One desperate swipe is one turn. The desktop version doesn't have this (a mouse mat makes wiping harder work, but it's possible).

Quirks to know: browsers release the pointer lock on Esc, so Esc is effectively "pause" when the mouse is captured; a lock request may be refused (then the bat keeps following the absolute cursor); and the audio context can't start until the user has clicked or pressed a key, which is why the page opens on a title card whose gesture starts the intro music.

# MonitorSelector widget

A small UI helper shown on the intro screen that lets the player cycle through available displays. It is hidden automatically when unnecessary.

## Purpose

- Cycle the active monitor when the user **clicks the monitor icon** on the intro screen.  
- Auto‑disables when **only one display** is detected, or when a monitor was already chosen via the CLI (`--monitor/-m`).  
- When a new monitor is selected, the game **re‑initialises the Pygame window** on that display without restarting the process.

## Notes on behaviour

- **`reposition(...)`** scales from logical to physical pixels so the icon remains aligned irrespective of window size or resize ratio.  
- **`draw(...)`** renders the icon directly to the present surface used by the intro scene.  
- **`is_over(...)`** performs a simple rect hit‑test of the mouse pointer coordinates against the icon's current position and size.  
- **`select()`** increments the monitor index (wrapping at the end), plays the click sound, and triggers a window move/re‑create on the newly selected display.

The widget is created and used by the intro menu loop.

## Reinitialisation

Re-initialisation happens in `menu_loop(...)`: after the monitor icon is clicked, the intro function returns a sentinal string value "monitor", then the calling code quits and re-inits `pygame.display` (to allow the pygame window to move monitor), deletes the Game and Graphics class instances, and creates new ones with Game(monitor=widget.monitor, resize=args.resize). This causes the game window to reopen on the next monitor. The `menu_loop` then restarts the intro screen. 

## Edge cases

- If displays change at runtime (for example the user unplugs one), things are likely to go wrong! 
- If re‑initialisation raises an exception, the `main()` function catches it and displays the exception throwback.

# Graphics

Rendering is resolution‑independent and anchored to a 1080p logical baseline. Window size and all sprite/text metrics are derived from a single scale value so visuals remain consistent across displays.

## Scaling scheme and window mode

- **Logical baseline:** 1920×1080.  
- **Logical playfield:** the game renders into a surface whose shape is the monitor's shape clamped to the range `Graphics.min_playfield_aspect` (4:3) to `Graphics.max_playfield_aspect` (16:9), sized to the largest box of that shape that fits inside the monitor (after the `-r` down-scale). See `Graphics.logical_size()`. `window_width` / `window_height` are the dimensions of this surface, not of the monitor.  
- **Scale ratio:** `scale_ratio = window_height / 1080`. All logical pixel measurements are multiplied by this ratio and rounded to integers for blit/rect math.  
- **Aspect handling:** `pygame.SCALED | pygame.FULLSCREEN` stretches the logical surface to fill the monitor while preserving its aspect ratio. Monitors between 4:3 and 16:9 (which includes 16:10) are used edge to edge; wider ones (21:9, 32:9) get black bars at the sides, and anything narrower than 4:3 gets bars top and bottom. The upper limit is what matters: the brick grid is sized from the playfield width, so on a wider playfield the lower rows would run into the bat. Mouse coordinates arrive already translated into logical space; `get_mouse_pos()` clamps them so the pointer can't drive the bat into the bars.  
- **Display flags:** the window is created using `pygame.NOFRAME | pygame.SCALED | pygame.FULLSCREEN` so the back buffer is scaled by the driver and there are no OS‑level window decorations.

## Core surfaces

- **`display`**: the present surface tied to the active window. Final composites are drawn here before `pygame.display.flip()`.  
- **`screen`**: off‑screen world surface used for most gameplay drawing. This allows cheap clears and post effects before presenting to `display`.  
- **`background`**: a cached, full-screen, pre‑tiled level background. Used to quickly undraw moving sprites and to reset dirty regions.  
- **`trail_sfc`**: a per‑pixel‑alpha surface for glow trails. On each displayed frame, this surface is faded towards transparent using a subtractive blend and new light blobs are added for each ball at the same time they are rendering to `screen`. Every blob is added through `Graphics.add_glow()`, which records its rectangle and the time; `fade_trails()` forgets blobs older than the fade lifetime (`255 / rate` seconds), groups the rest into non-overlapping boxes (one per ball's recent path, in practice), and both it and `blit_trails()` only touch those boxes. Fading and compositing the full surface every frame was the biggest single cost at 4K, and a single box around all the blobs would be nearly as bad whenever several balls are spread out. 
- **`black_screen`**: a full‑window black surface used for fades and splash transitions by adjusting its alpha and blitting over `display`.

### Typical draw order

1. Draw gameplay to **`screen`** (bricks, bat, balls, lasers, text).  
2. Composite **`background`** onto **`display`** where needed.  
3. Blend **`trail_sfc`** onto **`display`**.
4. Composite **screen** onto **`display`**.
4. If active, blend **`black_screen`** with current fade alpha onto **`display`**.
5. Flip the **`dislpay`** frame.

## Sprite sizing and resampling

- **Bricks:** sourced from **hi‑res sprites** and **rescaled per level** to match the current grid cell size. This keeps edges crisp across different window heights and avoids accumulation of scaling artefacts when levels change layout.  
- **Other sprites:** the bat, balls, power‑up icons and UI glyphs are **scaled once** at load time using a **percentage of window height** derived from `scale_ratio`. These cached surfaces are reused for the duration of the session and only regenerated when the window is re‑initialised (i.e. the monitor is changed).

### Notes

- Use integer sizes and positions after applying `scale_ratio` to avoid sub‑pixel blurs or errors from pygame.  
- When changing display, recompute `scale_ratio`, recreate size‑dependent surfaces (`screen`, `background`, `trail_sfc`, `black_screen`) and regenerate size‑derived sprites from the high-resolution originals.  
- `background` is rebuilt whenever the level changes with a different tile image per level.

# Text objects

Text in the game is designed for clarity and low-overhead updates, especially for HUD elements like lives and level. You can restyle text in place (colour, alpha, size, bold, italic) which is used for menu hover highlights and the pulsing title colour on the intro screen.


## HUD behaviour

* The `"lives"` and `"level"` labels are auto-positioned near the lower left and lower right of the screen. Their positions are derived from the current window size so they remain anchored as you change monitors or scale.
* The displayed values are pulled from game state at draw time, so they always reflect the latest counters without extra glue code.

## Styling and updates

* Size, colour, alpha, bold and italic can be adjusted at runtime through a small restyle hook. Sizes are derived from the global scale so text remains legible across resolutions.
* The intent is to treat text like a lightweight sprite that can be restyled in place, rather than scattering font objects throughout the code.

## Erasing cleanly

* When text changes or moves, it is erased by restoring the exact region from the cached background. This avoids ghosting and keeps redraws cheap, since only the affected rectangle is touched.
* The background is rebuilt when levels change, which ensures erasure remains exact even after the brick layout updates.

## How it renders

* Rendering is alpha-aware and centres text at a target point. This makes it easy to align labels visually without fiddly offsets.
* The renderer returns the bounding rectangle used for later erasure, which keeps the draw/undraw cycle self-contained.
* Fonts and renders are cached in `Graphics` (`get_font()` / `render_text()`). Glyphs are rendered once in white per (text, size, style) and tinted with a multiply blend, which gives exactly the same pixels as rendering in colour; the final coloured surfaces sit in a small most-recently-used cache. Static labels are therefore a dictionary lookup per frame, and the intro's pulsing title (a new colour every frame) costs a copy and a tint rather than a font load and a render.

## Practical tips

* For fast-changing HUD values, call undraw, update the value or style, then draw. This keeps the frame clean without a full-screen clear.
* If you add a new HUD label, prefer centre placement over left-top anchors. It reads better when scaling and localises less error in alignment.
* Keep alpha modest for HUD overlays so they sit on top of the playfield without overpowering it.

# Brick objects

A `Brick` knows its sprite, position, and its number of remaining lives. Class methods expose globally agreed brick dimensions so placement, collision, and rendering stay in sync after per-level scaling. On draws, live bricks blit their image (if required); destroyed bricks run a short “explosion”, which is just a brightly-coloured filled circle that shrinks over time.

The `hit(x)` method decrements the brick's lives and pans a stereo sound based on impact `x` coordinate. Indestructible bricks use a sentinel life value (representing infinity) and short-circuit the state changes. 'Fire' bricks cascade by recursively forwarding destruction to neighbours (potentially to other Fire bricks); laser, invert, extra-bat, extra-ball, extra-life, and blackout effects are all triggered when a corresponding brick is destroyed.

**Why this way:** bricks own their own state and visuals, which keeps the main loop simple, and makes it trivial to add new brick types or balance brick lives and effects. Bricks are only plotted once per level - at the start. After that, we don't need to touch them until they are destroyed.

## Rendering bricks

Bricks are rendered into the game **`screen`** at the start of the level, and the brick grid area isn't cleared during the gameplay. Thus, we don't need to redraw all of the bricks every frame. None of the other entities touch these pixels (bats, balls, HUD elements).

When a brick is destroyed, it enters a destruction sequence, lasting a fixed number of frames. All this does is plot the background (tiles) into **`screen`** over the brick's location and then a bright, filled circle (coloured for that brick type) which rapidly shrinks. The final frame of the animation is plain background with no circle. This gives the impression of a coloured flash, leaving an empty space where the brick once was.

# Ball: rendering, erasure, and movement safeguards

The ball is drawn and erased in a way that preserves the brick field, and its motion is gently steered to keep play fair and interesting.

## Why the ball doesn’t chew the level

The ball’s sprite has a pre‑binarised alpha mask (transparent vs opaque). When erasing, the game uses this hard mask to copy back **exactly** the covered pixels from the cached level background, then blits that over the last ball position. Only the circular footprint is restored, so bricks that were not redrawn this frame are left intact. The result is clean visuals without full‑screen clears.

## Movement rules that keep play lively

- **Speed clamp:** if the ball slows below the level's minimum its velocity is scaled up to it (preventing dead, drifting shots), and if it somehow exceeds the maximum it is scaled back down. Both limits are in pixels per second for the current window scale.  
- **Shallow‑angle correction:** near‑horizontal travel is nudged to include a minimum vertical component, avoiding endless skimming across the same row.  
- **Walls:** left, right and top boundaries reflect the ball; the impact sound is stereo panned by X position and volume is scaled by speed to convey energy.  
- **Bottom of screen:**  
  - **Intro:** the ball simply bounces.  
  - **Gameplay:** the ball leaves the field and is reintroduced from a random side, heading up and inwards at a random angle at the level's minimum speed. The player's lives decrement each time the 'hero' ball drops off the bottom, and a drop sound communicates the penalty.

## Collision principles

### Movement and wall interactions

The `move(dt, level)` method integrates position over `dt` seconds (one physics sub-step), keeps speeds within the level's limits, and handles walls and the floor. Outside the intro, the speed is clamped to `[Game.min_ball_speed(level), Game.max_ball_speed()]`, and we correct very shallow horizontal bounce angles so the ball doesn't get stuck bouncing from left and right.

The left, right and top walls reflect the ball's velocity, but the bottom of the screen is special: in the intro it bounces back, but during the game it causes the ball to respawn from either side at the minimum speed. For bonus balls, the number of `lives` for that ball is decremented, meaning they can only respawn a couple of times. A bonus ball, new or respawning, comes in at `Game.bonusEntryY()`: 0.8 of the way down, unless that is among the bricks (level 6 at 16:9 reaches 870 of 1080), when it comes in just under the bottom row instead, but never so low that it overlaps the bats. A ball that starts inside a brick is resolved as hitting its underside, so before this every bonus ball on level 6 bounced off the bottom-corner brick straight back down; that level's bottom row also keeps its metal out of the corners, so a steep launch meets something breakable.

Wall collision and drop sounds are stereo-panned by the `x` coordinate and volume-scaled by the collision speed.

Edge cases worth noting: when clamping we rescale `(vx, vy)` proportionally rather than snapping to constants; in the intro screen, we apply damping (`Game.intro_damping` is the fraction of speed retained per second, raised to the power `dt`) to let movement energy die away.

### Bat collisions

The bat handler starts with a quick axis-aligned bounding box (AABB) overlap test. We then split the bat's shape into three regions: a left rounded end, a flat top, and a right rounded end.

In an end-cap region, we run a circle-circle test against the end’s centre; if overlapping, we push the ball outward along the contact normal so that it's just touching the bat and set `(vx, vy)` to the same speed but aligned to that normal. I.e. if you imagine an invisible line projecting straight out of the curve of the bat at the point it's touching the ball (this line is called the 'normal'), the ball's direction is reflected about that line - the speed will be the same, but just _away_ from the bat rather than _toward_ it.

On the flat top of the bat, we snap the ball to sit exactly on the bat (ensuring there's no overlap) and send it off at an angle chosen by where it landed: straight up from the centre, out to `Ball.max_bat_angle` from the ends, with a touch of jitter. The speed is kept, only the direction changes, so the player can aim without the bat acting as an accelerator.

After any hit we add a difficulty-scaled slice of the level's target speed (see *Speed model*), then play the bat-hit sound with stereo pan and volume derived from `x` coordinate and speed. The speed is only added if there has been no bat contact for `Ball.bat_hit_cooldown` (0.25 s): sweeping the bat into the ball at an end cap can make the collision repeat every physics step until the ball clears, and without the cool-off each repeat added speed.

### Brick collisions

This resolves in two phases. First, a fast axis-aligned bounding box test early-exits if there is no overlap.

If there is overlap, we classify the contact as either hitting an edge or a corner, by comparing the ball centre to the brick’s bounds. Edge contacts snap the ball to the relevant side and flip the matching velocity component, then call `brick.hit(x, volume=…)`. Corner contacts do a short circle-point resolve towards the corner and reflect velocity along the computed normal before calling `brick.hit` (similar to hitting the end of a bat). This keeps motion stable and avoids tunnelling at corners without requiring per-pixel tests.

### Ball–ball collisions

All balls are the same size, so we check centre distance against the sum of the radii. If overlapping, we separate them by half the overlap along the normal, then reverse each ball’s velocity component along that normal. This essentially results in the balls bouncing off each other in a reasonably natural way. The collision sound’s volume scales with the normal relative speed, with stereo pan from the impact's `x` coordinate. A defensive `dist != 0` avoids division by zero when balls coincide exactly.

During the intro we apply damping to the collision so it's not quite perfectly elastic.

# Bat: behaviour and expiry visuals

The bat aims to stay visually clear while keeping its physics predictable. Two visual states are worth calling out because they affect how time‑limited bats communicate their status.

## Timed bat fade (last two seconds)

When a bat effect is about to expire, the game fades the bat rather than popping it off abruptly. Expiry is measured against the pausable game clock (`Game.time`), so pausing doesn't eat into a bonus bat's life. The fade is implemented by drawing the bat onto a temporary surface and blitting it with an alpha that tracks the time remaining during the final two seconds. The alpha ramps down smoothly to a low non-zero value, which gives the player a readable warning without altering the bat’s geometry or collisions and without it ever becoming full transparent.

**Why a temp surface?** It avoids re‑authoring multiple sprite variants and keeps the normal draw path intact. Only the per‑frame alpha changes, so performance is stable and artefacts are avoided.

## Inversion visual

For inverted control states the bat swaps to a pre‑tinted image, with a yellow hue (to match the colour of the brick that causes this effect). Using a prepared sprite is cheaper and more consistent than tinting per frame, and it makes the inversion state instantly recognisable. From the bat's point of view, the swap is purely visual; collision shape and response are unchanged. From the player's point of view, it means the mouse x movement suddenly reverses.

## Practical notes

- The fade only affects the draw; collisions remain solid until the timer actually expires.  
- The inversion image is pre‑tinted to avoid per‑pixel work in the main loop and to ensure colours look the same across platforms.  
- Both effects are designed to be legible against the playfield without needing extra HUD text.

# Laser

Fast, vertical laser bolts give the player short bursts of precision clearing without overwhelming the playfield.

## What a laser is

- **Speed (class attribute):** a shared per‑bolt speed in pixels per second, set relative to the window height at runtime, so beams feel similarly quick across resolutions.  
- **Duration (class attribute):** the number of seconds that the *laser mode* stays active once triggered.

## How lasers are triggered and emitted

- Breaking a **laser brick** starts (or extends) a timed *laser mode*. `Game.laser_remaining` (seconds of game time) is increased by `duration`, so additional laser bricks simply add more time.  
- While laser mode is active, **each bat emits bolts periodically**: every `Game.laser_period` seconds, with each bat's schedule offset by `Game.laser_stagger` so the beams feel rhythmic rather than simultaneous. Bolts spawn from the bat’s top and travel straight upwards.  
- A small pool of laser sound effects is used with stereo panning based on the emitting bat’s position.

## Movement and lifetime

- Lasers move straight up at the shared speed and are culled as soon as they leave the screen. They do not bounce or deflect.

## Collisions (thin slice test)

- To keep collisions both **precise and cheap**, each bolt checks bricks using a **thin vertical slice** centred on the beam rather than its full sprite rectangle. This avoids “catching” bricks that are visually just outside the beam while also reducing per‑frame overlap tests.  
- On a hit the brick reacts as if it has been hit once by a ball (including special behaviours where applicable). If the brick is destroyed, normal scoring and effects apply.

## Design notes

- Using class‑level `speed` and `duration` makes it easy to tune beam feel and the length of laser bursts without touching emit logic.  
- The staggered emission pattern keeps the screen readable and gives a satisfying cadence when multiple bats are active.  
- The thin‑slice collision model matches the visual narrowness of the beam, which helps players trust where shots will land.

# Intro menu screen

The intro acts as an attract scene and a lightweight menu, showing off the physics and letting the player choose options directly on the playfield.

## Rotating card (OpenCV) with edge‑on skip

A textured “card” rotates in 3D and is perspectively warped onto the screen using OpenCV. When the card becomes nearly edge‑on, the code **skips the warp** for that frame and falls back to a cheaper path (not plotting the card). This avoids strange artefacts and saves time without producing visual pops.

## Choosing difficulty by play

Three difficulty labels sit over the field. The **hero ball** is steered with the mouse; colliding with a label selects it. Selection is reflected immediately by restyling the chosen label and playing a short click sound. It is a small touch, but it keeps the intro interactive and consistent with the game’s physics.

## Monitor selection from the intro

A small monitor icon appears when multiple displays are available and no monitor was forced on the command line. Clicking this icon **cycles through displays**. When chosen, the intro exits to let the game re‑initialise on the new display, then returns to normal. If only one display is present, the icon is hidden.

## What’s being rendered

- The intro **spawns 15 balls**: one “hero” and a handful of background balls with light damping, simulating friction, so the scene feels lively but not too chaotic.
- The **hero ball** represents the mouse pointer and can interact with - bounce into - the other balls, like a fidget toy.
- Glow trails for the balls are drawn onto a dedicated trail surface and **blended directly with the present surface** used by the intro. The scene then flips the frame. This keeps the attract loop smooth while showing off the glow effect.

## Practical notes

- Difficulty selection is readable even at different scales because labels are centred and restyled on selection.  
- The warp skip for edge‑on frames keeps the animation clean at high frame rates.  
- The intro returns either “start” (begin the game) or “monitor” (switch display), which keeps the outer loop straightforward.

# Game class: responsibilities

`Game` owns the playfield and orchestrates updates for all entities. It maintains pools for balls, bats, bricks, lasers and transient effects, and advances them in a consistent order each frame.

## Keeping play from going stale

If no brick has been destroyed for a while, the game assumes the rally has gone quiet and **injects a bonus ball** automatically. The timeout is controlled by a fixed `boring_timeout`, measured on the game clock (so pausing doesn't count). When it triggers, a bonus ball enters from a side with a readable audio cue so it can meaningfully re‑energise play. Bonus balls (from this timer or from red bricks) are refused once `Game.max_balls` are in play, so a level full of metal bricks can't flood the screen.

## Helper animation loops

- **Bats:** a tight loop follows the current mouse position to drive bat movement and **reclaims expired timed bats** back to the spare pool. This keeps active bats accurate with minimal bookkeeping.
- **Balls:** a companion loop moves every ball, resolves **bat contacts**, then **culls** balls that have exhausted their lives (the hero object is handled carefully so it cannot vanish abruptly). For balls above the lowest brick row it performs **brick checks** and triggers brick destruction effects. Finally it resolves **pairwise ball–ball collisions** so multi‑ball play remains readable and fair.

This ordering is deliberate: movement first, then bat resolution, then bricks, then inter‑ball collisions. `Game.update(dt)` runs the bat loop once per frame and the ball (and laser) loop once per physics sub-step.

## Adding energy on demand

The player can left-click to call a small utility to **kick all balls** by a fixed fraction of the level's target speed, giving an immediate speed boost up to the level's ceiling. It can be used sparingly to lift the pace if things get slow. While the hero ball is waiting on the bat, a left click serves it instead.

## Notes

- The bonus‑ball injection timer resets on each brick kill, so it only fires during truly quiet stretches.  
- Centralising bat expiry, ball culling and collision ordering inside `Game` keeps behaviour consistent even as power‑ups layer extra objects onto the field.

# Splash screens & main loop transitions

This section describes the on‑screen transitions between major states and the simple rules that make them feel consistent.

## Level clear

When the final brick of a level is removed:

1. **Award one life** to the player.  
2. **Rebuild the background** for the next level so we have a new look and feel.  
3. **Show a coloured splash** announcing the level transition. After the splash, play resumes on the next layout.

If the cleared level was the **final level**, a short **win sound** is played and a large **“YOU WIN!”** splash is shown before returning to the intro.

## Out of lives

When the player’s lives are exhausted:

- Play the **die sound** and show a clear **“Game Over!”** splash.  
- Control returns to the intro after the splash.

## Main loop shape

The main loop alternates between three scenes:

1. **Intro** (attract scene and menu).  
2. **Gameplay** (active level).  
3. **Splash screen** (brief, blocking transitions used for level change, win, and game over).

Audio cues and bold, centred text make each transition unambiguous, and the background is always rebuilt before new play begins.

# Platform & input

A brief note on windowing and pointer handling.

## Windowing

- The game opens a **full‑screen borderless** window on the selected display.  
- Resolution is scaled from a 1080p baseline so visuals remain consistent across monitors.

## Mouse input

- The mouse cursor is **hidden** during play. In the intro, we use the hero ball as the mouse pointer. In the game, the hero bat is positioned at the mouse x coordinate and the y coordinate is ignored.
- **Mouse gain.** Windows moves the pointer in physical pixels regardless of display scaling, so on a high-resolution monitor the hand has to travel further to cross the playfield (1.8× further on a 3456-wide panel than on a 1080p one). `Graphics.pointer_to_playfield()` scales the pointer position about the centre of the playfield by `mouse_gain = physical playfield width / 1920 × sensitivity`, so crossing the playfield always takes a 1080p screen's worth of hand travel. It is applied in exactly two places — `Game.bat_target_x()` for the bat and the intro's hero ball — while the cached pointer coordinates, the inversion reflection, the pause/unpause warp and the debug hit test all stay in raw pointer space. `--sensitivity` multiplies the gain.
- During the inversion mode, the mouse x movement is reversed. Care is taken to reposition the OS mouse pointer at the start and end of this mode to stop the bat(s) from suddenly jumping sideways.
- For mouse button clicks, we primarily look for `MOUSEBUTTONDOWN` for two reasons: it allows us to react quickly to user input and it doesn't auto-repeat if the user holds the button down.
- Pressing 'Q', 'Escape', or closing the pygame window at any time (intro, game, splash) quits the game and exits the program.
- Pressing 'Space' during the game pauses the action, and resumes. Again, we look at the `KEYDOWN` event for the same reasons as `MOUSEBUTTONDOWN`.

Note: we clamp the mouse to only move within the pygame window using `pygame.event.set_grab(True)` to prevent the super annoying situation on multi-head systems when the (invisible) mouse pointer drifts off the window so the bat(s) stop moving. When the game is paused, the pointer is switched back on and movement unclamped. This allows the user to interact with the rest of their desktop if they want. The pointer is hidden and clamping reenabled when the game is unpaused. Care is taken to move the mouse pointer into the same position it was when the game was paused, to stop the bat(s) jumping sideways.

# Troubleshooting / edge cases (appendix)

A few guard rails in the code help the game fail fast on unsupported setups and stay stable in numerically awkward moments.

## Headless or missing displays

At startup the display setup is validated. If **no displays are available**, the monitor selector raises a clear runtime error and stops the program. This prevents launching into an unusable state on headless systems or misconfigured remotes.

**What you’ll see:** a short error explaining that Breakout cannot run without a display.

## Defensive maths in collisions and the intro warp

- **Ball and brick/ball collisions:** where a calculation would divide by the distance between points, the code first ensures the distance is non‑zero. Overlaps are resolved safely, and if two centres coincide the solver avoids generating NaNs by skipping the normalisation path.  
- **Perspective warp in the intro:** if the rotating card’s face becomes **edge‑on** or its computed normal degenerates to zero length, the code **skips the expensive warp** for that frame and takes a cheaper path. This avoids division by zero, prevents flicker from near‑singular transforms, and keeps the animation smooth.

These checks are intentionally simple and cheap. They keep the main loop robust without masking genuine bugs.
