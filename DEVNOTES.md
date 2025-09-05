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
3. Render the warped texture into the frame.

**Edge-on optimisation:** when the projected quad is nearly edge-on, the code skips the expensive warp step to avoid aliasing and save time. The skip decision uses a simple threshold on the quad’s projected width/area to detect the near-degenerate case. Frames that are skipped fall back to a cheaper path so the animation remains smooth and visually stable.

# Runtime configuration & CLI

The game exposes a small set of command‑line flags to control display placement and render scale. These options are also reflected in runtime behaviour on the intro screen.

## Flags

- `--monitor, -m <index>`  
  Zero‑based display index to use. `0` selects the primary display. Supplying this disables the interactive Monitor Selector on the intro screen. Example: `-m 1` starts on the second display.

- `--resize, -r <ratio>`  
  Down‑scale ratio applied to the window resolution and the derived sprite/text scaling. Must be `>= 1.0`. Example: `-r 2` renders at 50% of the native desktop resolution (width and height each divided by 2) while preserving aspect.

### Notes

- Logical layout is designed for a 1080p baseline and then scaled using the active window height.  
- The window is created borderless and full‑screen on the target display.  
- When `-m` is omitted and multiple displays exist, the intro screen shows a small monitor icon. Clicking it cycles through the available displays and re‑initialises the window on the chosen one, without restarting the process.

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
    sprites_path = os.path.join(base_path, "sprites")
    sounds_path  = os.path.join(base_path, "sounds")
```

- **`Game.base_path`**: Root directory for assets.  
  - When running a PyInstaller build, `sys._MEIPASS` is provided by the bootloader and points at the temporary extraction directory.  
  - When running from source, it defaults to the absolute path of the current working directory.
- **`Game.sprites_path` / `Game.sounds_path`**: Canonical subdirectories for image and audio assets. All loaders should join against these rather than hard‑coding relative paths.

### Usage guidelines

- Always construct file paths via `os.path.join(Game.sprites_path, ...)` or `os.path.join(Game.sounds_path, ...)`.  
- For non‑sprite assets that live at the root, join against `Game.base_path`. Example:
  ```python
  intro_img = os.path.join(Game.sprites_path, "intro.png")
  click_wav = os.path.join(Game.sounds_path, "click.wav")
  save_db = os.path.join(Game.base_path, "savedata.db")
  ```
- Avoid `__file__`-relative logic inside modules that may be collected differently by PyInstaller. `Game.base_path` abstracts this away.
- Keep the folder names `sprites/` and `sounds/` flat and deterministic, since PyInstaller’s data file spec packs them under the same names.

### PyInstaller notes

- When creating the executable, include data folders:
  ```bash
  pyinstaller \
      --onefile \
      --icon=icon.ico \
      --noconsole \
      --add-data "sprites;sprites" \
      --add-data "sounds;sounds" \
      breakout.py
  ```
- At runtime the `_MEIPASS` override ensures lookups work without special-casing the frozen build.

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
- **Scale ratio:** `scale_ratio = window_height / 1080`. All logical pixel measurements are multiplied by this ratio and rounded to integers for blit/rect math.  
- **Aspect handling:** the window fills the selected display with a borderless full‑screen surface. Logical coordinates are scaled uniformly, preserving aspect.  
- **Display flags:** the window is created using `pygame.NOFRAME | pygame.SCALED | pygame.FULLSCREEN` so the back buffer is scaled by the driver and there are no OS‑level window decorations.

## Core surfaces

- **`display`**: the present surface tied to the active window. Final composites are drawn here before `pygame.display.flip()`.  
- **`screen`**: off‑screen world surface used for most gameplay drawing. This allows cheap clears and post effects before presenting to `display`.  
- **`background`**: a cached, full-screen, pre‑tiled level background. Used to quickly undraw moving sprites and to reset dirty regions.  
- **`trail_sfc`**: a per‑pixel‑alpha surface for glow trails. On each displayed frame, this surface is faded towards transparent using a subtractive blend and new light blobs are added for each ball at the same time they are rendering to `screen`. 
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

- **Minimum speed floor:** if the ball slows too much, its velocity is scaled up to a threshold derived from the current difficulty and window scale. This prevents dead, drifting shots.  
- **Shallow‑angle correction:** near‑horizontal travel is nudged to include a minimum vertical component, avoiding endless skimming across the same row.  
- **Walls:** left, right and top boundaries reflect the ball; the impact sound is stereo panned by X position and volume is scaled by speed to convey energy.  
- **Bottom of screen:**  
  - **Intro:** the ball simply bounces.  
  - **Gameplay:** the ball leaves the field and is reintroduced from a random side with a small, randomised velocity. The player's lives decrement each time the 'hero' ball drops off the bottom, and a drop sound communicates the penalty.

## Collision principles

### Movement and wall interactions

The `move(level)` method integrates position, keeps speeds sensible for the current level and difficulty setting, and handles walls and the floor. Outside the intro, a minimum speed is enforced that scales with `level + 1.5`, and we correct very shallow horizontal bounce angles so the ball doesn't get stuck bouncing from left and right.

The left, right and top walls reflect the ball's velocity, but the bottom of the screen is special: in the intro it bounces back, but during the game it causes the ball to respawn from either side with a small random velocity. For bonus balls, the number of `lives` for that ball is decremented, meaning they can only respawn a couple of times.

Wall collision and drop sounds are stereo-panned by the `x` coordinate and volume-scaled by the collision speed.

Edge cases worth noting: when `speed < min_speed` we rescale `(vx, vy)` proportionally rather than snapping to constants; in the intro screen, we apply a tiny per-frame damping to let movement energy die away.

### Bat collisions

The bat handler starts with a quick axis-aligned bounding box (AABB) overlap test. We then split the bat's shape into three regions: a left rounded end, a flat top, and a right rounded end.

In an end-cap region, we run a circle-circle test against the end’s centre; if overlapping, we push the ball outward along the contact normal so that it's just touching the bat and set `(vx, vy)` to the same speed but aligned to that normal. I.e. if you imagine an invisible line projecting straight out of the curve of the bat at the point it's touching the ball (this line is called the 'normal'), the ball's direction is reflected about that line - the speed will be the same, but just _away_ from the bat rather than _toward_ it.

On the flat top of the bat, we snap the ball to sit exactly on the bat (ensuring there's no overlap) and force `vy` upwards by negating it.

After any hit we add a small random nudge to `vx` and a difficulty-scaled increase to upward speed for liveliness, then play the bat-hit sound with stereo pan and volume derived from `x` coordinate and speed.

### Brick collisions

This resolves in two phases. First, a fast axis-aligned bounding box test early-exits if there is no overlap.

If there is overlap, we classify the contact as either hitting an edge or a corner, by comparing the ball centre to the brick’s bounds. Edge contacts snap the ball to the relevant side and flip the matching velocity component, then call `brick.hit(x, volume=…)`. Corner contacts do a short circle-point resolve towards the corner and reflect velocity along the computed normal before calling `brick.hit` (similar to hitting the end of a bat). This keeps motion stable and avoids tunnelling at corners without requiring per-pixel tests.

### Ball–ball collisions

All balls are the same size, so we check centre distance against the sum of the radii. If overlapping, we separate them by half the overlap along the normal, then reverse each ball’s velocity component along that normal. This essentially results in the balls bouncing off each other in a reasonably natural way. The collision sound’s volume scales with the normal relative speed, with stereo pan from the impact's `x` coordinate. A defensive `dist != 0` avoids division by zero when balls coincide exactly.

During the intro we apply damping to the collision so it's not quite perfectly elastic.

# Bat: behaviour and expiry visuals

The bat aims to stay visually clear while keeping its physics predictable. Two visual states are worth calling out because they affect how time‑limited bats communicate their status.

## Timed bat fade (last two seconds)

When a bat effect is about to expire, the game fades the bat rather than popping it off abruptly. The fade is implemented by drawing the bat onto a temporary surface and blitting it with an alpha that tracks the time remaining during the final two seconds. The alpha ramps down smoothly to a low non-zero value, which gives the player a readable warning without altering the bat’s geometry or collisions and without it ever becoming full transparent.

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

- **Speed (class attribute):** a shared per‑bolt speed set relative to the window height at runtime, so beams feel similarly quick across resolutions.  
- **Duration (class attribute):** the number of seconds that the *laser mode* stays active once triggered.

## How lasers are triggered and emitted

- Breaking a **laser brick** starts (or extends) a timed *laser mode*. Internally a frame counter is increased by `duration × FPS`, so additional laser bricks simply add more time.  
- While laser mode is active, **each bat emits bolts periodically**. Emission is slightly staggered between bats so the beams feel rhythmic rather than simultaneous. Bolts spawn from the bat’s top and travel straight upwards.  
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

If no brick has been destroyed for a while, the game assumes the rally has gone quiet and **injects a bonus ball** automatically. The timeout is controlled by a fixed `boring_timeout`. When it triggers, a bonus ball enters from a side with a readable audio cue so it can meaningfully re‑energise play.

## Helper animation loops

- **Bats:** a tight loop follows the current mouse position to drive bat movement and **reclaims expired timed bats** back to the spare pool. This keeps active bats accurate with minimal bookkeeping.
- **Balls:** a companion loop moves every ball, resolves **bat contacts**, then **culls** balls that have exhausted their lives (the hero object is handled carefully so it cannot vanish abruptly). For balls above the lowest brick row it performs **brick checks** and triggers brick destruction effects. Finally it resolves **pairwise ball–ball collisions** so multi‑ball play remains readable and fair.

This ordering is deliberate: movement first, then bat resolution, then bricks, then inter‑ball collisions.

## Adding energy on demand

The player can left-click to call a small utility to **kick all balls** by a fixed ratio, giving an immediate speed boost. It can be used sparingly to lift the pace if things get slow.

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
