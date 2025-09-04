# Breakout: How It Hangs Together

This is a compact, engineer-to-engineer tour of the code. I focus on how the various pieces fit together, the design choices I made, and why they (hopefully) work well in practice.

---

## 1. Overview

I built a modern Breakout in Pygame with a handful of spicy twists: extra bats, bonus balls, control inversion, lasers, and a blackout effect. I keep things readable with a small set of entities (classes representing objects in the game), a graphics helper class for surfaces and assets, and a single `Game` class that runs the show. Sprites and layouts are scaled to the monitor so it looks sane on laptops and TVs. It also tries to pick a single monitor on multi-monitor setups. The intro screen uses a simple OpenCV perspective warp to sell some production value (otherwise known as a cheesy spinning 3D screenshot!).

---

## 2. Text objects

I keep text as a simple `Text` object with three jobs: render the textual label, remember its most recent bounding box, and erase the text by restoring the background under that box. If you pass in the magic strings `"lives"` or `"level"`, it auto-positions bottom-left or bottom-right and pulls the respective value from the game state. I can restyle text in place (colour, alpha, size, bold, italic) which is something I use for menu hover highlights and the pulsing title colour on the intro screen.

**Why this way:** a single protocol (`draw`, `undraw`) means I can batch text with all other entities and erase cheaply with one blit from the pre-darkened background.

---

## 3. Brick objects

A `Brick` knows its sprite, position, and its number of remaining lives. Class methods expose globally agreed brick dimensions so placement, collision, and rendering stay in sync after per-level scaling. On draws, live bricks blit their image (if required); destroyed bricks run a short “explosion”, which is just a brightly-coloured filled circle that shrinks over time. The `hit(x)` method decrements the brick's lives and pans a stereo sound based on impact `x` coordinate. Indestructible bricks use a sentinel life value (representing infinity) and short-circuit the state changes. 'Fire' bricks cascade by recursively forwarding destruction to neighbours (potentially to other Fire bricks); laser, invert, extra-bat, extra-ball, extra-life, and blackout effects are all triggered when a corresponding brick is destroyed.

**Why this way:** bricks own their own state and visuals, which keeps the main loop simple, and makes it trivial to add new brick types or balance brick lives and effects. Bricks are only plotted once per level - at the start. After that, we don't need to touch them until they are destroyed.

---

## 4. Bat objects

Bats are horizontal paddles driven by the cached mouse `x` coordinate. Each frame `move(mouse_x)` updates the horizontal position and records `vx` (horizontal speed and direction) from the delta. That gives the potential for momentum-aware interactions if I want them. A bat can be 'inverted' by swapping to a precomputed flipped image (which has a yellow hue) when the control-inversion power-up is active. Extra bats come from an off-screen pool, run on a 10‑second timer, and fade during their final two seconds so you get a clear visual cue before expiry.

---

## 5. Laser objects

Lasers are the simplest entity: a sprite, a bounding box, and a constant upward velocity. A class attribute holds speed so I can tune it globally. While the laser power-up is active, each live bat emits laser bolts on a staggered frame cadence; laser bolts delete on impact with the first brick they hit and call the brick’s `hit(x)` to apply damage and sounds. Destroying another laser brick while the power-up is already active will extend the active window rather than stacking projectiles.

**Why this way:** thin projectiles and a fixed cadence slide into the main loop with minimal branching and end up precise enough without per‑pixel collision tests (so long as the bolts aren't moving vertically too fast each frame, which they aren't!).

---

# 6. Ball objects

I treat the ball as a compact state machine with clear responsibilities: draw itself (plus a glow), move with a few safety rails, and resolve collisions against bats, bricks, walls and other balls. The class keeps half-sizes `w2/h2` to avoid repeating common calculations, exposes a `bbox()` for broad-phase checks, and uses an `intro` flag to slightly soften physics on the title screen (damping movement as per friction and collisions that aren't perfectly elastic).

## Drawing and erasing

Drawing a ball requires two blits: the ball sprite into the world surface, and a round glow to the trail surface at the same coordinates so I can fade light-trails after presentation. Erasing the ball restores the background only under the old bounding box via a tiny pre-binarised alpha mask, which avoids full clears and keeps edges crisp. This is important because if I erase the whole (square) bounding box, it can end up chipping bits off bricks that the ball travels close to - because the bricks aren't plotted every frame - and that looks bad. So the ball is erased by plotting a circular cut-out of background over the top of it.

## Movement and wall interactions

`move(level)` integrates position, keeps speeds sensible for the current level and difficulty setting, and handles walls and the floor. Outside the intro I enforce a minimum speed that scales with `level + 1.5`, and I correct very shallow horizontal bounce angles so the ball doesn't get stuck bouncing from left and right.

The left, right and top walls reflect the ball's velocity, but the bottom of the screen is special: in the intro it bounces back, but during the game it causes the ball to respawn from either side with a small random velocity. For bonus balls, the number of `lives` for that ball is decremented, meaning they can only respawn a couple of times.

Wall collision and drop sounds are stereo-panned by the `x` coordinate and volume-scaled by the collision speed.

Edge cases worth noting: when `speed < min_speed` I rescale `(vx, vy)` proportionally rather than snapping to constants; in the intro screen, I apply a tiny per-frame damping to let movement energy die away.

## Bat collisions

The bat handler starts with a quick axis-aligned bounding box (AABB) overlap test. I then split the bat's shape into three regions: a left rounded end, a flat top, and a right rounded end.

In an end-cap region I run a circle-circle test against the end’s centre; if overlapping, I push the ball outward along the contact normal so that it's just touching the bat and set `(vx, vy)` to the same speed but aligned to that normal. I.e. if you imagine an invisible line projecting straight out of the curve of the bat at the point it's touching the ball (this line is called the 'normal'), the ball's direction is reflected about that line - the speed will be the same, but just _away_ from the bat rather than _toward_ it.

On the flat top of the bat, I snap the ball to sit exactly on the bat (ensuring there's no overlap) and force `vy` upwards by negating it.

After any hit I add a small random nudge to `vx` and a difficulty-scaled increase to upward speed for liveliness, then play the bat-hit sound with stereo pan and volume derived from `x` coordinate and speed.

## Brick collisions

This resolves in two phases. First, a fast axis-aligned bounding box test early-exits if there is no overlap.

If there is overlap, I classify the contact as either hitting an edge or a corner, by comparing the ball centre to the brick’s bounds. Edge contacts snap the ball to the relevant side and flip the matching velocity component, then call `brick.hit(x, volume=…)`. Corner contacts do a short circle-point resolve towards the corner and reflect velocity along the computed normal before calling `brick.hit` (similar to hitting the end of a bat). This keeps motion stable and avoids tunnelling at corners without requiring per-pixel tests.

## Ball–ball collisions

All balls are the same size, so I check centre distance against the sum of the radii. If overlapping, I separate them by half the overlap along the normal, then reverse each ball’s velocity component along that normal. This essentially results in the balls bouncing off each other in a reasonably natural way. The collision sound’s volume scales with the normal relative speed, with stereo pan from the impact's `x` coordinate. A defensive `dist != 0` avoids division by zero when balls coincide exactly.

During the intro I apply damping to the collision so it's not quite perfectly elastic.

## Bounding box API

`bbox()` returns a `pygame.Rect` at `(x − w2, y − h2, width, height)`. Every broad-phase collision path in the game starts here, which keeps the hot loop tidy and fast.

---

## 7. The Game class

The `Game` class is where the orchestration happens. This object owns:

- Entities and pools: one hero ball, a list of active balls, one hero bat, a pool of extra bats that I promote on pickups, the live bricks, and any active laser beams. I also cache a few geometry helpers such as the height of the lowest brick row and clip rectangles for cheap background restores. 
- Effects and timers: a frame counter, a global darken fade (dark_alpha), a control inversion timer, and a remaining “laser emissions” counter. A single pygame.time.Clock caps the loop. 
- Audio handles and helpers: I load all sounds up front and expose a tiny stereo helper so I can pan based on world `x` coordinate. Laser emissions and inversion ticks use it directly.

---

## 8. The Graphics class

`Graphics` hides the platform details: 

- it sizes the window to the primary monitor, 
- computes a `scale_ratio`, 
- and prepares surfaces.

I draw the world to an off‑screen `screen`, composite a per‑pixel‑alpha `trail_sfc` for ball glow, and present to the window `display`. A reusable black overlay surface provides fades and blackout.

Sprites are loaded in high resolution once, then rescaled to percentage-of-height targets (ball and glow≈4.5%, bats and lasers≈6%). Brick art is kept at high resolution and only scaled to the grid once the level layout is known - the brick sizes get smaller as the levels progress, because there are more of them!

The graphics class also holds a palette of useful RGB colours which are used by various elements of the game.

---

## 9. The intro menu screen

The title screen mixes three pieces:

1. I warp a static image onto a rotating 3‑D quad with OpenCV and blit straight to the display.
2. I spawn a swarm of balls at 60 FPS to show the physics in a safe space.
3. I use the hero ball as a mouse pointer to allow the player to start a game at a specific difficulty level.  

I drive menu selection by collision: when the hero ball overlaps a menu label’s bounding box, I restyle that label to the selected colour and make it bold, play a click sound, and remember the menu item's index. Most keypresses or any mouse click starts the game at the selected difficulty level.

Pressing 'E' or 'Esc', or closing the window will quit the game.

---

## 10. Splash screens

Between levels and at the end, I run a tiny `splash_screen(...)`: seed the darken overlay, draw a centred `Text` object, and present this for roughly three seconds, fading in from black. The splash screen honours early exit on window close, 'Q', or 'Escape' presses. On level advance, I rebuild the tiled background so the splash screen sits on fresh art for the new level, then continue to that level.

---

## 11. The main game loop

The outer loop handles structure:

- show intro
- reset state
- show a splash screen
- then run levels while lives remain

The inner loop is per‑frame:

- undraw bricks that are animating
- handle input events
- update modes
- move bats and balls
- blend the glowing trails
- draw HUD elements then the various entities in a fixed order
- darken the screen if needed
- flip the display
- and cap to 120 FPS

Clearing the last brick or running out of lives will break back out to the outer loop. If the player has completed the final level, display the "You Win" splash screen. Or, if the player has run out of lives, trigger the “Game Over” splash screen.

---

### Appendix: game drawing order

1) partial background restores 
2) trails 
3) HUD text 
4) bricks 
5) lasers 
6) balls 
7) bats 
8) optional darken overlay
9) display flip 
10) glowing trail decay
