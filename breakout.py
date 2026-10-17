#!/usr/bin/env python3
#
# Copyright (c) 2025, 7th software Ltd.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations
import argparse
import cv2
import math
import os
import pygame
import sys
import time
import traceback
import numpy as np
from random import random, randint, uniform
from typing import Any, Iterable, Optional, Sequence


# ---------------------------------------------------------------------------------------------------------------------
# Time base
#
# All movement in the game is expressed in *pixels per second* (scaled for the current window - see
# `Graphics.scale_ratio`) and integrated using the real time that elapsed between frames. The game therefore plays at
# the same speed whatever frame rate the machine actually manages, rather than slowing down when a frame is late.
#
# Physics runs in fixed-size sub-steps so that fast-moving objects can't skip straight over thin obstacles
# ("tunnelling"). Each rendered frame's elapsed time is divided into enough equal sub-steps that no single step is
# longer than 1 / PHYSICS_HZ seconds; at the maximum ball speed that keeps per-step movement well under a ball radius.
#
# Anything that is timed (power-ups, bonus bat expiry, the "boring" timer, the blackout fade) runs off `Game.time`,
# a clock that only advances while the game is being simulated, so pausing really does pause everything.
# ---------------------------------------------------------------------------------------------------------------------

# Physics sub-step rate (steps per second). 240 Hz is four sub-steps per frame at 60 fps.
PHYSICS_HZ = 240

# Longest frame time we are prepared to simulate in one go (seconds). Anything longer - a stall, a splash screen, a
# debugger pause - is clamped so objects don't teleport across the screen when things get going again.
MAX_FRAME_DT = 1.0 / 20.0

# Frame rate caps for the game and the intro. These only limit how often we *render*; they no longer have any effect
# on how fast anything moves.
GAME_FPS = 60
INTRO_FPS = 120


def frame_time(milliseconds: int) -> float:
    """
    Convert the value returned by `pygame.time.Clock.tick()` into a frame time in seconds, clamped to MAX_FRAME_DT.

    Args:
        milliseconds: Time since the previous tick, as reported by pygame.

    Returns:
        float: Seconds to simulate for this frame.
    """

    return min(milliseconds / 1000.0, MAX_FRAME_DT)


def substeps(dt: float) -> tuple[int, float]:
    """
    Split a frame time into equal fixed-rate physics sub-steps.

    Args:
        dt: Frame time in seconds.

    Returns:
        tuple[int, float]: Number of sub-steps to run, and the length of each one in seconds.
    """

    n = max(1, math.ceil(dt * PHYSICS_HZ))
    return n, dt / n


class MonitorSelector():
    """
    Widget that cycles through available monitors and draws a selectable UI element for choosing the target display.

    The widget is disabled if a monitor was explicitly chosen by the user or if the system only has a single monitor.
    """

    def __init__(self, choice: int | None, x: int = 0, y: int = 0):
        """Initialise the selector.

        Args:
            choice: Explicit monitor index to use, or `None` to enable the widget and allow interactive
                selection. The index is modulo the number of detected displays.
            x: Logical X position of the widget before scaling.
            y: Logical Y position of the widget before scaling.

        Raises:
            RuntimeError: If no monitors are detected, which implies a headless environment.
        """

        self.raw_x, self.raw_y = x, y
        self.x, self.y = 0, 0
        self.width, self.height = 0, 0

        # This widget is disabled if the user has manually selected a monitor
        self.enabled = choice is None

        # How many monitors does this device have?
        self.monitors = pygame.display.get_num_displays()
        if self.monitors == 0:
            # No monitors found!
            raise RuntimeError("Breakout cannot run on a headless system")
        elif self.monitors == 1:
            # Disable this widget if there's only one monitor
            self.enabled = False

        # Ensure the selected monitor index is in range
        self.monitor = 0 if choice is None else choice % self.monitors

        # Make a note of the logical dimensions of all of the monitors
        self.desktops = pygame.display.get_desktop_sizes()

    def reposition(self, gfx: object, image: pygame.Surface) -> None:
        """Update on-screen position and size based on the current scale.

        Computes the scaled top-left position and stores the image size for hit testing and drawing.

        Args:
            gfx: Object that provides a `scale_ratio` attribute used to scale the logical coordinates to device pixels.
            image: The surface that represents this widget when rendered.

        Notes:
            Does nothing when the widget is disabled.
        """

        if self.enabled:
            self.width, self.height = image.get_size()
            self.x, self.y = int(self.raw_x * gfx.scale_ratio), int(self.raw_y * gfx.scale_ratio)
            # print(f"repositioned ({self.x},{self.y}) as [{self.width}x{self.height}]")

    def draw(self, surface: pygame.Surface, image: pygame.Surface) -> None:
        """Blit the widget image to the given surface at the current position.

        Args:
            surface: Target surface to draw onto.
            image: Image to blit when drawing this widget.

        Notes:
            Does nothing when the widget is disabled.
        """

        if self.enabled:
            surface.blit(image, (self.x, self.y))

    def _bbox(self) -> pygame.Rect | None:
        """Return the current widget bounding rectangle for hit testing.

        Returns:
            A `pygame.Rect` covering the last known position and size when the widget is enabled.
            Returns `None` when disabled.
        """

        return pygame.Rect(self.x, self.y, self.width, self.height) if self.enabled else None

    def is_over(self, x: int, y: int) -> bool:
        """Report whether a point lies over the widget.

        Args:
            x: X coordinate in the same space used for drawing.
            y: Y coordinate in the same space used for drawing.

        Returns:
            `True` if the point is inside the widget's bounding box and the widget is enabled. `False` otherwise.
        """

        # print(f"({x},{y}) is_over {self._bbox()}")
        return self._bbox().collidepoint(x, y) if self.enabled else False

    def select(self, game: object) -> None:
        """Advance to the next monitor and play a click sound.

        Increments the current monitor index modulo the number of displays, then plays the configured
        click sound via the provided game object.

        Args:
            game: Game context that supplies `play_stereo_sound` and a `click_sound` attribute.

        Notes:
            Does nothing when the widget is disabled.
        """

        if self.enabled:
            self.monitor = (self.monitor + 1) % self.monitors
            game.play_stereo_sound(game.click_sound)


class Text():
    def __init__(
        self,
        gfx: Any,
        game: Any,
        text: str = "",
        colour: tuple[int, int, int] | None = None,
        x: float = 0,
        y: float = 0,
        size: int = 300,
        alpha: int = 164,
        bold: bool = False,
        italic: bool = False,
    ) -> None:
        """
        Create a drawable text label.

        Args:
            gfx: Graphics context.
            game: Game context.
            text: The text to display. If "lives" or "level", the content and default position are derived from
                  the game context.
            colour: RGB colour as a 3-tuple. If not provided, defaults to `Graphics.colours['white']`.
            x: X coordinate for the text origin. Ignored when `text` is "lives" or "level".
            y: Y coordinate for the text origin. Ignored when `text` is "lives" or "level".
            size: Base font size (gets multiplied by `gfx.scale_ratio`).
            alpha: Text opacity in the range 0..255.
            bold: Whether to render the text in bold.
            italic: Whether to render the text in italic.
        """

        self.gfx = gfx
        self.game = game
        self.text = text
        self.bold = bold
        self.italic = italic
        self.alpha = alpha
        self.size = int(size * self.gfx.scale_ratio)

        if colour is None:
            self.colour = Graphics.colours['white']
        else:
            self.colour = colour

        if self.text == "lives":
            self.x = gfx.window_width // 16
            self.y = gfx.window_height * 0.9
        elif self.text == "level":
            self.x = gfx.window_width * 0.95
            self.y = gfx.window_height * 0.9
        else:
            self.x = x
            self.y = y

        self.bbox = None

    def draw(self, surface: Any | None = None) -> None:
        """
        Render the text to a surface and update `self.bbox`.

        Args:
            surface: Target surface to draw on. If not provided, defaults to `self.gfx.screen`.

        Behaviour:
            - If `self.text` is "lives", renders the current number of lives remaining.
            - If `self.text` is "level", renders the current level number.
            - Otherwise renders `self.text`.
            - Stores the returned bounding rectangle from the renderer in `self.bbox`.
        """

        if surface is None:
            surface = self.gfx.screen

        if self.text == "lives":
            text = str(self.game.lives)
        elif self.text == "level":
            text = str(self.game.level)
        else:
            text = self.text

        self.bbox = self.gfx.text_at(
            surface,
            text,
            self.colour,
            self.x,
            self.y,
            font_size=self.size,
            alpha=self.alpha,
            bold=self.bold,
            italic=self.italic
        )

    def undraw(self, surface: Any | None = None) -> None:
        """
        Erase the previously drawn text by blitting the background over its last bounding box.

        Args:
            surface: Target surface to restore on. If not provided, defaults to `self.gfx.screen`.

        Behaviour:
            - If `self.bbox` is not set, this is a no-op.
            - Uses `self.gfx.background` as the source for the restore blit.
        """

        if surface is None:
            surface = self.gfx.screen

        bbox = self.bbox
        if bbox is not None:
            surface.blit(self.gfx.background, (bbox.x, bbox.y), bbox)

    def move(self, x: float, y: float) -> None:
        """
        Move the text label to a new position.

        Args:
            x: New X coordinate.
            y: New Y coordinate.

        Notes:
            The new position takes effect on the next `draw()`.
        """

        self.x = x
        self.y = y

    def restyle(
        self,
        colour: tuple[int, int, int] | None = None,
        size: int | None = None,
        alpha: int | None = None,
        bold: bool | None = None,
        italic: bool | None = None,
    ) -> None:
        """
        Update one or more style attributes of the text label.

        Args:
            colour: New RGB colour. If None, leaves existing colour unchanged.
            size: New font size. If None, leaves existing size unchanged.
            alpha: New opacity 0..255. If None, leaves existing alpha unchanged.
            bold: New bold flag. If None, leaves unchanged.
            italic: New italic flag. If None, leaves unchanged.

        Notes:
            Does not redraw automatically. Call `draw()` to apply visually.
        """

        if colour is not None:
            self.colour = colour
        if size is not None:
            self.size = int(size * self.gfx.scale_ratio)
        if alpha is not None:
            self.alpha = alpha
        if bold is not None:
            self.bold = bold
        if italic is not None:
            self.italic = italic


class Laser():
    # Vertical speed of a laser bolt (pixels per second; set from the window height at start-up)
    speed: float = 1.0

    # Duration of the laser power-up (seconds)
    duration: int = 6

    @classmethod
    def set_speed(cls, speed: float) -> None:
        """
        Set the class-wide laser speed.

        Args:
            speed: Pixels per second.
        """

        cls.speed = speed

    def __init__(self, image: pygame.Surface, gfx: object, x: int, y: int) -> None:
        """
        Create a laser projectile.

        Args:
            image: Sprite surface to blit for this laser. Its size determines the bounding box.
            gfx: Graphics context.
            x: Initial centre X position in pixels.
            y: Initial centre Y position in pixels.
        """

        self.image = image
        self.gfx = gfx
        self.x = x
        self.y = y
        self.vy = -type(self).speed
        self.width, self.height = image.get_size()
        self.w2, self.h2 = max(1, self.width // 2), max(1, self.height // 2)

    def bbox(self) -> pygame.Rect:
        """
        Compute the axis-aligned bounding box of the laser at its current position.

        Returns:
            pygame.Rect: Rectangle with top-left at (x - w2, y - h2) and size (width, height).
        """

        return pygame.Rect(self.x - self.w2, self.y - self.h2, self.width, self.height)

    def draw(self, surface: pygame.Surface | None = None) -> bool:
        """
        Draw the laser to the target surface.

        Args:
            surface: Target surface to draw on. Defaults to `self.gfx.screen` if not provided.

        Returns:
            bool: Always True. Provided for parity with other drawable objects that may fail.
        """

        if surface is None:
            surface = self.gfx.screen
        surface.blit(self.image, (self.x - self.w2, self.y - self.h2))
        return True

    def undraw(self, surface: pygame.Surface | None = None) -> None:
        """
        Erase the laser's last drawn area by restoring from the background surface.

        Args:
            surface: Target surface to restore on. Defaults to `self.gfx.screen` if not provided.
        """

        if surface is None:
            surface = self.gfx.screen
        bbox = self.bbox()
        surface.blit(self.gfx.background, (bbox.x, bbox.y), bbox)

    def move(self, dt: float) -> bool:
        """
        Advance the laser by its vertical velocity over `dt` seconds.

        Args:
            dt: Time to simulate (seconds). This is normally one physics sub-step, not a whole frame.

        Returns:
            bool: True if still on screen, otherwise False to indicate it should be culled.
        """

        self.y += self.vy * dt
        return self.y > -self.h2

    def check_brick_collision(self, brick: object) -> bool:
        """
        Test collision against a brick using a thin vertical slice around the laser's centre.

        Args:
            brick: Object exposing `bbox() -> pygame.Rect`.

        Returns:
            bool: True if the laser's thin collision rect intersects the brick's bbox, else False.
        """

        thin = max(2, self.w2 // 2)
        bbox = pygame.Rect(self.x - thin, self.y - self.h2, thin * 2, self.height)

        return bbox.colliderect(brick.bbox())


class Bat():
    # How long a bonus bat stays in play once activated (seconds of game time)
    lifetime: float = 10.0

    # During the last `fade_seconds` of its life a bonus bat is drawn progressively more transparent as a warning
    fade_seconds: float = 2.0

    def __init__(
        self,
        id: int,
        image: pygame.Surface,
        gfx: object,
        game: object,
        vx: float = 0,
        dx: float = 0,
    ) -> None:
        """
        Create a bat (paddle).

        Args:
            id: Identifier for this bat (for UI or logic).
            image: Sprite surface for the bat. Size determines its bbox.
            gfx: Graphics context.
            game: Game context. Supplies the pausable game clock (`game.time`) that bat expiry is measured against.
            vx: Initial horizontal speed in pixels per second.
            dx: Horizontal offset from the window centre in pixels.
        """

        def invert_image(image):
            # Create a new surface with the same size and alpha mode as the input
            inv_image = pygame.Surface(image.get_rect().size, pygame.SRCALPHA)

            # Fill the new surface with yellow (255, 255, 255, fully opaque)
            inv_image.fill((255, 224, 128, 255))

            # Mix the image with the yellow surface
            inv_image.blit(image, (0, 0), None, pygame.BLEND_RGB_MULT)

            # Copy the alpha channel from the original image
            inv_image.blit(image, (0, 0), None, pygame.BLEND_RGBA_MIN)

            return inv_image

        self.id = id
        self.image = image
        self.gfx = gfx
        self.game = game
        self.width, self.height = image.get_size()
        self.w2, self.h2 = max(1, self.width // 2), max(1, self.height // 2)
        self.dx = dx                                         # Horizontal delta (offset) for this bat's position (pixels)
        self.x = (gfx.window_width // 2) + dx                # Horizontal centre of bat (pixels)
        self.vx = vx                                         # Horizontal speed (pixels per second)
        self.y = gfx.window_height - int(self.height * 1.3)  # Vertical top edge of bat (pixels)
        self.inv_image = invert_image(self.image)
        self.inverted = False

        # Game time at which this bat leaves play. None means it never does (the hero bat). Bonus bats get a
        # deadline when they are activated via `reset()`.
        self.expire = None

        # Game time at which this bat next emits a laser beam. Only meaningful while laser mode is active; the
        # game sets it when laser mode starts (or when the bat joins play during laser mode).
        self.next_fire = 0.0

    def invert(self, force: bool | None = None) -> None:
        """
        Swap or set the bat's normal and inverted images, toggling the `inverted` flag if needed.

        Args:
            force:
                If None, then swap inversion state.
                If True, force inversion state to True if not already.
                If False, force inversion state to False if not already.
        """

        if force is None or force != self.inverted:
            self.image, self.inv_image = self.inv_image, self.image
            self.inverted = not self.inverted

    def restore(self) -> None:
        """
        Ensure the bat is using the normal (non-inverted) image.
        """

        self.invert(force=False)

    def bbox(self) -> pygame.Rect:
        """
        Get the current bounding box of the bat.

        The rectangle's left edge is at `x - w2`, the top edge at `y`.

        Returns:
            pygame.Rect: Axis-aligned rectangle suitable for collision checks and blitting.
        """

        return pygame.Rect(self.x - self.w2, self.y, self.width, self.height)

    def draw(self, surface: pygame.Surface | None = None) -> bool:
        """
        Draw the bat to the target surface, applying a fade if close to expiry.

        Args:
            surface: Target surface. Defaults to `self.gfx.screen` if not provided.

        Behaviour:
            - If `expire` is set and less than `fade_seconds` of game time remain, draws a temporary copy
              with alpha between ~55 and 255.

        Returns:
            bool: Always True.
        """

        if surface is None:
            surface = self.gfx.screen

        image = self.image
        if self.expire is not None:
            # Measured in game time, so a paused game doesn't eat into the bat's remaining life
            remain = max(0.0, self.expire - self.game.time)
            if remain < Bat.fade_seconds:
                # Blit the image with some transparency when the bat is about to expire: alpha ramps from 255 down
                # to 55 over the fade period, so the bat never quite disappears before it goes
                temp_surface = self.image.convert_alpha()
                temp_surface.set_alpha(55 + int(200 * remain / Bat.fade_seconds))
                image = temp_surface

        surface.blit(image, (self.x - self.w2, self.y))

        return True

    def undraw(self, surface: pygame.Surface | None = None) -> None:
        """
        Erase the bat by restoring its bounding box from the background surface.

        Args:
            surface: Target surface. Defaults to `self.gfx.screen` if not provided.
        """

        if surface is None:
            surface = self.gfx.screen
        surface.blit(self.gfx.background, (self.x - self.w2, self.y), self.bbox())

    def move(self, x: float, dt: float) -> None:
        """
        Reposition the bat horizontally relative to an input x (for example, mouse x).

        Side effects:
            - Updates `vx` to the bat's horizontal speed in pixels per second (the distance it just jumped divided
              by the frame time). Not used for collisions yet, but available for giving the ball some "english".
            - Updates `x` relative to the new centre position.

        Args:
            x: Input horizontal position in pixels.
            dt: Time since the bat was last moved (seconds). Zero is allowed and simply yields `vx == 0`.
        """

        x += self.dx
        self.vx = (x - self.x) / dt if dt > 0 else 0.0
        self.x = x

    def reset(self, x: float) -> None:
        """
        Activate a bonus bat: give it a fresh lifetime (measured in game time) and move it to a new x.

        Args:
            x: New horizontal input position in pixels (pre-offset).
        """

        self.expire = self.game.time + Bat.lifetime
        self.move(x, 0.0)

    def expired(self) -> bool:
        """
        Check whether the bat's lifetime has elapsed.

        Returns:
            bool: True if expiry is set and the game clock is past `expire`, otherwise False.
        """

        if self.expire is None:
            return False
        else:
            return self.game.time > self.expire


class Brick():
    size = None
    half = None

    @classmethod
    def set_dimensions(cls, width: int, height: int) -> None:
        """
        Set the class-wide brick dimensions.

        Args:
            width: Brick width in pixels.
            height: Brick height in pixels.
        """

        Brick.size = (width, height)
        Brick.half = (width // 2, height // 2)

    @classmethod
    def width(cls) -> int:
        """
        Get the configured brick width.

        Returns:
            int: Width in pixels.

        Notes:
            Requires `set_dimensions(...)` to have been called.
        """

        return Brick.size[0]

    @classmethod
    def height(cls) -> int:
        """
        Get the configured brick height.

        Returns:
            int: Height in pixels.

        Notes:
            Requires `set_dimensions(...)` to have been called.
        """

        return Brick.size[1]

    @classmethod
    def w2(cls) -> int:
        """
        Get half of the configured brick width.

        Returns:
            int: Half-width in pixels (floored).

        Notes:
            Requires `set_dimensions(...)` to have been called.
        """

        return Brick.half[0]

    @classmethod
    def h2(cls) -> int:
        """
        Get half of the configured brick height.

        Returns:
            int: Half-height in pixels (floored).

        Notes:
            Requires `set_dimensions(...)` to have been called.
        """

        return Brick.half[1]

    def __init__(
        self,
        id: int,
        gfx: object,
        game: object,
        x: int,
        y: int,
        brick_type: int
    ) -> None:
        """
        Create a brick.

        Args:
            id: Identifier for this brick.
            gfx: Graphics context.
            game: Game context.
            x: Horizontal centre position in pixels.
            y: Vertical centre position in pixels.
            brick_type: Brick kind index used to pick image, sound, colour, and lives.
        """

        self.id = id
        self.type = brick_type
        self.gfx = gfx
        self.game = game
        self.image = self.gfx.brick_images[self.type]
        self.width, self.height = self.image.get_size()
        self.w2, self.h2 = max(1, self.width // 2), max(1, self.height // 2)
        self.x = x  # Horizontal centre of ball (pixels)
        self.y = y  # Vertical centre of ball (pixels)

        # Number of times this brick can be hit by a ball before being destroyed
        lives = [
            1,      # Lt. blue (do nothing)
            3,      # Red (extra ball)
            2,      # Green (extra bat)
            2,      # White (extra life)
            4,      # Black (fade to black)
            3,      # Yellow (reverse controls)
            2,      # Fire (destroy neighbours)
            99,     # Metal (indestructible)
            3       # Dk. Blue (lasers)
        ]
        self.lives = lives[self.type]

        # Set the explosion sound
        self.sound = self.game.explode_sounds[self.type]

        # Set the explosion colour for this block
        self.colour = list(Graphics.colours.values())[self.type]

        # Randomly apply horizontal or vertical flip to the brick
        rnd = randint(0, 3) if self.type < 7 else 0
        self.image = pygame.transform.flip(self.image, (rnd & 1) == 1, (rnd & 2) == 1)

    def bbox(self, internal: bool = False) -> pygame.Rect:
        """
        Compute the brick's bounding box.

        Args:
            internal: If True, always return the real rect even when the brick is destroyed.
                      If False and the brick is destroyed, returns an empty off-screen rect.

        Returns:
            pygame.Rect: Rectangle with top-left at (x - w2, y - h2) and size (width, height).
        """

        if internal or self.lives > 0:
            return pygame.Rect(self.x - self.w2, self.y - self.h2, self.width, self.height)
        else:
            return pygame.Rect(-1, -1, 0, 0)

    def expired(self) -> bool:
        """
        Determine whether the brick should be removed from play.

        Returns:
            bool: True if the destruction animation has run past its limit (`lives < -20`) or the brick is
                  indestructible (`lives == 99`), else False.
        """

        return self.lives < -20 or self.lives == 99

    def draw(self, surface: pygame.Surface | None = None, force: bool = False) -> bool:
        """
        Draw the brick or its destruction animation.

        Normally, we only plot bricks during the level setup (using force=True). During gameplay, we don't need to
        keep plotting bricks over themselves!

        If the brick is in the process of being destroyed (lives < 1 and lives >= -20) then we plot a filled circle
        in the position of the brick and decrement the lives. Once lives is < -20 then nothing is plotted.

        Args:
            surface: Target surface to draw on. Defaults to `self.gfx.screen`.
            force: If True, blit the image even if it would otherwise be skipped.

        Returns:
            bool: False if the brick is immortal or has been destroyed, else True.
        """

        if surface is None:
            surface = self.gfx.screen

        # Is this brick being forcibly drawn?
        if force:
            surface.blit(self.image, (self.x - self.w2, self.y - self.h2))
        elif self.lives < 1 and self.lives >= -20:
            # The brick is in its destruction animation - a shrinking filled circle
            radius = self.h2
            if self.lives != 0:
                radius = int((radius / 20) * (20 + self.lives))
            pygame.draw.circle(self.gfx.screen, self.colour, (self.x, self.y), radius)
            self.lives -= 1

        return not self.expired()

    def undraw(self, surface: pygame.Surface | None = None) -> None:
        """
        Erase the brick's area when in the destruction animation.

        Args:
            surface: Target surface. Defaults to `self.gfx.screen`.

        Notes:
            No-op if the brick is still alive (`lives >= 1`).
        """

        if surface is None:
            surface = self.gfx.screen
        if self.lives < 1:
            surface.blit(self.gfx.background, (self.x - self.w2, self.y - self.h2), self.bbox(internal=True))

    def hit(self, x: int, volume: float | None = None, kill: bool = False) -> None:
        """
        Apply a hit at horizontal position `x`.

        Args:
            x: Impact x position in pixels, used for stereo panning.
            volume: Optional volume scalar for hit sounds. Ignored for destruction sound.
            kill: If True, force the brick's lives to zero regardless of current value.

        Behaviour:
            - Ignores hits while exploding or expired (`lives < 0`).
            - Indestructible bricks (`lives == 99`) play their sound and do not change state.
            - Otherwise decrements `lives` (or sets to zero if `kill`), then plays either the standard hit sound
              or the destruction sound.
        """

        # Defend against accidental calls to brick that's exploding or expired
        if self.lives < 0:
            return

        if self.lives == 99:
            pan = x / self.gfx.window_width
            Game.play_stereo_sound(self.sound, stereo=pan, volume=volume)
            return

        # If we're not exploding...
        if self.lives > 0:
            if kill:
                # A forced kill takes lives to zero
                self.lives = 0
            else:
                # Otherwise, a hit just knocks a life off
                self.lives -= 1

        # Do we play a hit sound, or our destruction sound?
        pan = x / self.gfx.window_width
        if self.lives > 0:
            # Standard brick hit
            Game.play_stereo_sound(self.game.brick_hit_sound, stereo=pan, volume=volume)
        else:
            # Destruction sound (volume not dependent upon impact speed)
            Game.play_stereo_sound(self.sound, stereo=pan)


class Ball():
    # Aiming off the flat top of the bat: a ball landing at the very end of the bat leaves at this many degrees
    # from straight up (towards that end); one landing dead centre goes straight up. A touch of random jitter is
    # added so that a rally can't settle into an exactly repeating loop.
    max_bat_angle: float = 60.0
    bat_angle_jitter: float = 2.0

    def __init__(
        self,
        image: pygame.Surface,
        glow: pygame.Surface,
        gfx: object,
        game: object,
        x: float,
        y: float,
        vx: float = 0,
        vy: float = 0,
        lives: int | None = 2,
        intro: bool = False,
        serve_on_drop: bool = False,
    ) -> None:
        """
        Create a ball.

        Args:
            image: Sprite surface for the ball.
            gfx: Graphics context.
            game: Game context.
            x: Initial horizontal centre position in pixels.
            y: Initial vertical centre position in pixels.
            vx: Initial horizontal velocity in pixels per second.
            vy: Initial vertical velocity in pixels per second.
            lives: Number of allowed drops before removal; None means the ball is immortal.
            intro: If True, apply damping to bounces and velocities during intro animation.
            serve_on_drop: If True (the hero ball), falling off the bottom hands the ball back to the game to be
                           served from the bat. If False (bonus balls), it re-enters from a side by itself.
        """

        def generate_mask_image(image):
            """Pre-binarise the alpha channel of the image."""

            # Copy the ball image (along with its alpha channel)
            mask_image = image.copy()

            # Create a new surface with the same dimensions and alpha mode
            white = pygame.Surface(image.get_size(), flags=pygame.SRCALPHA)

            # Fill with white (fully opaque)
            white.fill((255, 255, 255, 255))

            # Blend the white surface with the original surface, preserving alpha
            # mask_image.blit(white, (0, 0), None, pygame.BLEND_RGB_MULT)
            mask_image.blit(white, (0, 0), None, pygame.BLEND_RGB_ADD)

            # Get the alpha channel as a 2D array
            alpha_array = pygame.surfarray.pixels_alpha(mask_image)

            # Binarise the alpha channel: values > 0 become 255, others remain 0
            binarised_alpha = np.where(alpha_array > 0, 255, 0).astype(np.uint8)

            # Update the surface's alpha channel with the binarised alpha
            pygame.surfarray.pixels_alpha(mask_image)[:, :] = binarised_alpha

            # Clean up
            del alpha_array

            return mask_image

        self.image = image
        self.glow = glow
        self.gfx = gfx
        self.game = game
        self.mask_image = generate_mask_image(image)
        self.width, self.height = image.get_size()
        self.w2, self.h2 = max(1, self.width // 2), max(1, self.height // 2)
        self.x = x              # Horizontal centre of ball (pixels)
        self.y = y              # Vertical centre of ball (pixels)
        self.vx = vx            # Horizontal speed (pixels per second)
        self.vy = vy            # Vertical speed (pixels per second)
        self.lives = lives      # Number of times this ball can fall (None means immortal)
        self.intro = intro
        self.serve_on_drop = serve_on_drop

        # Set by `move()` when the ball falls off the bottom; the game reads and clears it (see `Game.animate_balls`)
        self.dropped = False

    def bbox(self) -> pygame.Rect:
        """
        Compute the ball's axis-aligned bounding box at its current position.

        Returns:
            pygame.Rect: Rectangle with top-left at (x - w2, y - h2) and size (width, height).
        """

        return pygame.Rect(self.x - self.w2, self.y - self.h2, self.width, self.height)

    def draw(self, surface: pygame.Surface | None = None) -> bool:
        """
        Draw the ball at its current position.

        Args:
            surface: Target surface to draw on. Defaults to `self.gfx.screen`.

        Returns:
            bool: Always True. Included for parity with other drawable objects.
        """

        if surface is None:
            surface = self.gfx.screen
        # pygame.draw.rect(surface, (255,255,255), self.bbox())

        # Plot the ball
        pos = (self.x - self.w2, self.y - self.h2)
        surface.blit(self.image, pos)

        # Plot a glow into the trail surface
        self.gfx.trail_sfc.blit(self.glow, pos)

        return True

    def undraw(self, surface: pygame.Surface | None = None) -> None:
        """
        Erase the ball by composing a pre-binarised alpha mask with the background.

        Args:
            surface: Target surface to restore on. Defaults to `self.gfx.screen`.

        Behaviour:
            - Copies `self.mask_image`, blits background pixels into it using `BLEND_RGBA_MIN`, then blits the result
              back to the target surface at the ball's bbox.
        """

        if surface is None:
            surface = self.gfx.screen
        # Get the bounding box of the ball
        bbox = self.bbox()

        # Copy the (all white) binarised mask image
        temp = self.mask_image.copy()

        # Blit the background pixels directly onto the pre-binarised alpha surface
        temp.blit(self.gfx.background, (0, 0), bbox, pygame.BLEND_RGBA_MIN)

        # Blit the pre-binarised alpha surface onto the screen
        surface.blit(temp, (bbox.x, bbox.y))

    def kick(self, amount: float) -> None:
        """
        Give this ball a kick of extra speed without changing its direction.

        Args:
            amount: Speed to add, in pixels per second. The next `move()` clamps the result to the level's ceiling,
                    so repeated kicks can't run away.
        """

        speed = math.hypot(self.vx, self.vy)
        if speed > 0:
            factor = (speed + amount) / speed
            self.vx *= factor
            self.vy *= factor

    def move(self, dt: float, level: int = 1) -> None:
        """
        Integrate position over `dt` seconds, enforce speed limits, handle wall and floor interactions.

        Args:
            dt: Time to simulate (seconds). This is normally one physics sub-step, not a whole frame.
            level: Current level, used to look up the minimum ball speed.

        Behaviour:
            - Clamps the speed to the level's [minimum, maximum] range when not in intro.
            - Updates `(x, y)` by `(vx, vy) * dt` and applies gentle damping to velocities in intro.
            - Reflects off left, right, and top walls; plays a wall-hit sound.
            - If below the bottom:
                * In intro: reflect and continue.
                * Otherwise: re-enter from a side at the minimum speed, decrement `lives` if not None, and play drop sound.
        """

        def clamp_speed(min_speed: float, max_speed: float) -> None:
            """Keep the ball's speed within [min_speed, max_speed] (pixels per second) without changing its direction."""

            speed = math.hypot(self.vx, self.vy)
            if speed == 0:
                # A stationary ball would never come back, so send it straight up at the minimum speed
                self.vx, self.vy = 0.0, -min_speed
            elif speed < min_speed:
                factor = min_speed / speed
                self.vx *= factor
                self.vy *= factor
            elif speed > max_speed:
                factor = max_speed / speed
                self.vx *= factor
                self.vy *= factor

        def adjust_direction(angle_threshold=0.35):
            """Adjust very horizontal motion to be more vertical."""

            if self.vx != 0 and abs(self.vy / self.vx) < angle_threshold:
                sign = -1.0 if self.vy < 0 else +1.0
                self.vy = sign * abs(self.vx) * angle_threshold

        def play_wall_hit_sound():
            """Play wall collision sound, with stereo pan and speed-scaled volume."""

            vol = self.game.velocity_to_volume(self.vx, self.vy)
            pan = self.x / self.gfx.window_width
            Game.play_stereo_sound(self.game.wall_hit_sound, pan, volume=vol)

        # Smallest vertical speed we'll tolerate after a side-wall bounce, so a ball can't skate along a wall for ever
        min_vertical = 60.0 * self.gfx.scale_ratio

        # When we're not in the intro, we don't allow balls to go too slowly (or dangerously fast)
        if not self.intro:
            min_speed = self.game.min_ball_speed(level)
            clamp_speed(min_speed, self.game.max_ball_speed(level))

        # Integrate the velocity over this step
        self.x += self.vx * dt
        self.y += self.vy * dt
        if self.intro:
            # Intro balls gradually lose energy, like a fidget toy. `intro_damping` is the fraction of speed
            # retained per second, so raising it to the power `dt` gives the right amount for any step length.
            retain = Game.intro_damping ** dt
            self.vx *= retain
            self.vy *= retain

        # In the intro, bounces aren't perfectly elastic
        damp = 0.7 if self.intro else 1.0

        # Check if a collision with the walls happens
        if self.x < self.w2:
            # Ball hit left wall
            self.x = self.w2
            self.vx = -self.vx * damp
            if self.vy == 0:
                self.vy = min_vertical
            adjust_direction()
            play_wall_hit_sound()

        elif self.x > self.gfx.window_width - self.w2:
            # Ball hit right wall
            self.x = self.gfx.window_width - self.w2
            self.vx = -self.vx * damp
            if self.vy == 0:
                self.vy = min_vertical
            adjust_direction()
            play_wall_hit_sound()

        if self.y < self.h2:
            # Ball hit top wall
            self.y = self.h2
            self.vy = -self.vy * damp
            play_wall_hit_sound()

        elif self.y > self.gfx.window_height - self.h2:
            if self.intro:
                # Keep bouncing
                self.y = self.gfx.window_height - self.h2
                self.vy = -self.vy * damp
                play_wall_hit_sound()
            else:
                # Ball fell off the bottom of the window
                if self.lives is not None and self.lives > 0:
                    self.lives -= 1

                # Play the sound for the ball falling off the bottom of the screen, panned to where it went
                pan = self.x / self.gfx.window_width
                Game.play_stereo_sound(self.game.drop_sound, stereo=pan)

                # Tell the game (it hands the hero ball back to the bat to be served, see `Game.animate_balls`)
                self.dropped = True

                if self.serve_on_drop:
                    # The hero ball: stop dead where it is; the game will pick it up and put it on the bat
                    self.vx, self.vy = 0.0, 0.0
                else:
                    # A bonus ball: re-animate it coming in from one side, heading up and inwards at a random
                    # angle, at the level's minimum speed
                    angle = math.radians(uniform(20, 70))  # Measured from straight up
                    vx = math.sin(angle) * min_speed
                    vy = -math.cos(angle) * min_speed
                    if randint(0, 1) == 0:
                        # Left edge, heading right
                        self.x = 0
                        self.vx = vx
                    else:
                        # Right edge, heading left
                        self.x = self.gfx.window_width - 1
                        self.vx = -vx
                    self.y = self.gfx.window_height * 0.8
                    self.vy = vy

    def check_bat_collision(self, bat: Bat) -> bool:
        """
        Resolve collision with a bat (paddle), including rounded ends and flat top.

        Args:
            bat: Bat object exposing `bbox() -> pygame.Rect` and fields `x`, `y`, `w2`, `h2`.

        Behaviour:
            - Early-exits if AABB test fails.
            - Handles left and right rounded ends with circle collision and positional correction, reflecting
              velocity along the contact normal.
            - Otherwise treats the top as flat: sets `y` to sit on the bat and sends the ball off at an angle
              chosen by where it landed (centre = straight up, ends = `max_bat_angle` sideways), so the player
              can aim.
            - Adds a difficulty-dependent bit of speed (capped at the level's ceiling) and plays a hit sound.

        Returns:
            bool: True if a collision occurred and was handled, else False.
        """

        # Exit if the bat's bounding box isn't touching the ball's bounding box
        if not self.bbox().colliderect(bat.bbox()):
            return False

        # Detect which part of the bat the ball may have collided...
        bat_left, bat_right = bat.x - bat.w2, bat.x + bat.w2

        # Left rounded end - may not actually be touching yet...
        if self.x < bat_left + bat.h2:
            collision_x = bat_left + bat.h2
            collision_y = bat.y + bat.h2
            distance = math.hypot(self.x - collision_x, self.y - collision_y)
            if distance < bat.h2 + self.h2:
                # Adjust ball position to edge of collision
                overlap = bat.h2 + self.h2 - distance
                dx = self.x - collision_x
                dy = self.y - collision_y
                normal_angle = math.atan2(dy, dx)
                self.x += math.cos(normal_angle) * overlap
                self.y += math.sin(normal_angle) * overlap
                # Reflect velocity based on angle of collision
                speed = math.hypot(self.vx, self.vy)
                self.vx = speed * math.cos(normal_angle)
                self.vy = speed * math.sin(normal_angle)
            else:
                # No collision (yet)
                return False

        # Right rounded end - may not actually be touching yet...
        elif self.x > bat_right - bat.h2:
            collision_x = bat_right - bat.h2
            collision_y = bat.y + bat.h2
            distance = math.hypot(self.x - collision_x, self.y - collision_y)
            if distance < bat.h2 + self.h2:
                # Adjust ball position to edge of collision
                overlap = bat.h2 + self.h2 - distance
                dx = self.x - collision_x
                dy = self.y - collision_y
                normal_angle = math.atan2(dy, dx)
                self.x += math.cos(normal_angle) * overlap
                self.y += math.sin(normal_angle) * overlap
                # Reflect velocity based on angle of collision
                speed = math.hypot(self.vx, self.vy)
                self.vx = speed * math.cos(normal_angle)
                self.vy = speed * math.sin(normal_angle)
            else:
                # No collision (yet)
                return False

        # Flat top of the bat: the player aims by where on the bat the ball lands
        else:
            self.y = bat.y - self.h2  # Adjust position to be touching the top of the bat

            # -1.0 at the left end of the bat, 0.0 at the centre, +1.0 at the right end
            offset = max(-1.0, min(1.0, (self.x - bat.x) / bat.w2))

            # Outgoing angle from straight up, positive = heading right, with a little jitter
            jitter = (random() * 2 - 1) * Ball.bat_angle_jitter
            angle = math.radians(offset * Ball.max_bat_angle + jitter)

            # Same speed as before, new direction
            speed = math.hypot(self.vx, self.vy)
            self.vx = speed * math.sin(angle)
            self.vy = -speed * math.cos(angle)

        # There was a collision - play the sound effect for ball and bat colliding
        vol = self.game.velocity_to_volume(self.vx, self.vy)
        pan = self.x / self.gfx.window_width
        Game.play_stereo_sound(self.game.bat_hit_sound, stereo=pan, volume=vol)

        # Every bat hit adds a little speed - a fixed fraction of the level's target speed, bigger on harder
        # difficulties - so a long rally gets steadily livelier. `move()` caps the result at the level's ceiling.
        gain = Game.bat_hit_speed_gain[self.game.difficulty] * self.game.target_ball_speed(self.game.level)
        self.kick(gain)

        return True

    def check_brick_collision(self, brick: Brick) -> bool:
        """
        Resolve collision with a brick, including edges and corners.

        Args:
            brick: Brick object exposing `bbox() -> pygame.Rect` and fields `x`, `y`, `w2`, `h2`, plus
                   `hit(x, volume=..., kill=False)`.

        Behaviour:
            - Early-exits if AABB test fails.
            - Determines which side or corner was contacted, snaps position to the contact,
              reflects the appropriate velocity component, and calls `brick.hit(...)`.
            - For corner contacts, performs circle-point resolution and reflects along the normal.

        Returns:
            bool: True if a collision occurred and was handled, else False.
        """

        # Exit if the brick's bounding box isn't touching the ball's bounding box
        if not self.bbox().colliderect(brick.bbox()):
            return False  # No collision

        # Get the brick's corners and edges
        brick_left, brick_right = brick.x - brick.w2, brick.x + brick.w2
        brick_top, brick_bottom = brick.y - brick.h2, brick.y + brick.h2

        # Detect which part of the brick the ball may have collided with...
        if self.x < brick_left:  # Left side
            if self.y < brick_top:  # Top-left corner
                collision_x, collision_y = brick_left, brick_top
            elif self.y > brick_bottom:  # Bottom-left corner
                collision_x, collision_y = brick_left, brick_bottom
            else:  # Left edge
                self.x = brick_left - self.w2
                self.vx = -abs(self.vx)  # Reflect horizontally
                brick.hit(self.x, volume=self.game.velocity_to_volume(self.vx, self.vy))
                return True
        elif self.x > brick_right:  # Right side
            if self.y < brick_top:  # Top-right corner
                collision_x, collision_y = brick_right, brick_top
            elif self.y > brick_bottom:  # Bottom-right corner
                collision_x, collision_y = brick_right, brick_bottom
            else:  # Right edge
                self.x = brick_right + self.w2
                self.vx = abs(self.vx)  # Reflect horizontally
                brick.hit(self.x, volume=self.game.velocity_to_volume(self.vx, self.vy))
                return True
        else:  # Top or bottom edge
            if self.y < brick_top:  # Top edge
                self.y = brick_top - self.h2
                self.vy = -abs(self.vy)  # Reflect vertically
                brick.hit(self.x, volume=self.game.velocity_to_volume(self.vx, self.vy))
                return True
            else:  # Bottom edge
                self.y = brick_bottom + self.h2
                self.vy = abs(self.vy)  # Reflect vertically
                brick.hit(self.x, volume=self.game.velocity_to_volume(self.vx, self.vy))
                return True

        # Corner collision (distance check)
        distance = math.hypot(self.x - collision_x, self.y - collision_y)
        if distance < self.h2:
            # Adjust ball position to edge of collision
            overlap = self.h2 - distance
            dx = self.x - collision_x
            dy = self.y - collision_y
            normal_angle = math.atan2(dy, dx)
            self.x += math.cos(normal_angle) * overlap
            self.y += math.sin(normal_angle) * overlap

            # Reflect velocity based on angle of collision
            speed = math.hypot(self.vx, self.vy)
            self.vx = speed * math.cos(normal_angle)
            self.vy = speed * math.sin(normal_angle)
            brick.hit(self.x, volume=self.game.velocity_to_volume(self.vx, self.vy))
            return True

        # No collision
        return False

    def check_ball_collision(self, other: Ball) -> bool:
        """
        Resolve elastic collision with another ball of identical mass and size.

        Args:
            other: The other ball.

        Behaviour:
            - If centres are closer than the sum of radii, separates the balls by half the overlap along the collision normal.
            - Updates both velocity vectors by reversing their components along the normal; applies damping during intro.
            - Plays a collision sound with volume based on relative normal speed.

        Returns:
            bool: True if a collision occurred and was handled, else False.
        """

        # Calculate the distance between the centres of the balls
        dx = other.x - self.x
        dy = other.y - self.y
        dist = math.hypot(dx, dy)

        # Both balls have the same radius since they're the same size
        radius = self.w2    # or self.height / 2, assuming width == height
        sum_r = 2 * radius

        # If the distance between centres is less than the sum of radii, we have a collision
        if dist < sum_r and dist != 0:
            # Calculate the overlap
            overlap = sum_r - dist

            # Normalise the collision vector (dx, dy)
            nx = dx / dist
            ny = dy / dist

            # Move each ball away along this vector by half the overlap so that they no longer overlap.
            self.x -= (overlap / 2) * nx
            self.y -= (overlap / 2) * ny
            other.x += (overlap / 2) * nx
            other.y += (overlap / 2) * ny

            # Compute the new velocities after an elastic collision between two balls of identical mass.

            # Relative velocity
            rel_vx = self.vx - other.vx
            rel_vy = self.vy - other.vy

            # The velocity component along the collision normal (dot product of relative velocity and collision normal)
            vn = rel_vx * nx + rel_vy * ny

            # For two balls of the same mass, the velocity swap along the collision normal can be done with this formula.
            #
            # We'll update each velocity by +/- vn in the normal direction. That effectively reverses the component of
            # each velocity that is along the line of collision.
            damp = 0.7 if self.intro else 1.0
            self.vx -= vn * nx * damp
            self.vy -= vn * ny * damp
            other.vx += vn * nx * damp
            other.vy += vn * ny * damp

            # Volume follows the closing speed. `vn` is in pixels per second; dividing by 60 keeps the same
            # loudness curve the game had when velocities were in pixels per frame.
            vol = min(8.0, math.sqrt(abs(vn) / 60.0)) / 8.0
            pan = self.x / self.gfx.window_width
            Game.play_stereo_sound(self.game.ball_hit_sound, stereo=pan, volume=vol)

            return True

        # No collision
        return False


class Graphics():
    # Create a dict of handy colours. The order of the first entries is important, as these
    # colours are used for the corresponding bricks (the flash when they are destroyed)
    colours = {
        'blue': (64, 128, 255),
        'red': (255, 164, 32),
        'green': (64, 255, 128),
        'white': (255, 255, 255),
        'magenta': (224, 0, 192),
        'yellow': (255, 240, 96),
        'fire': (255, 32, 16),
        'metal': (181, 192, 201),
        'laser': (32, 32, 200),
        'black': (0, 0, 0),
        'lives': (196, 224, 255),
        'advance': (128, 255, 192),
        'level': (164, 240, 164),
        'die': (255, 164, 164),
        'win': (224, 224, 255),
        'title': (64, 104, 191),
        'copyright': (128, 168, 255),
        'rights': (128, 168, 255),
        'presskey': (64, 224, 224),
        'item': (32, 164, 32),
        'selitem': (96, 224, 96)
    }

    # The range of shapes the playfield is allowed to be, as width / height. A monitor whose shape falls inside this
    # range is used edge to edge; one outside it gets black bars (see `logical_size()`). The upper limit matters
    # most: the brick grid is sized from the playfield width, so on anything wider than 16:9 the lower rows would
    # run into the bat. Narrower shapes down to 4:3 just get a shorter brick field, which plays fine. Set both to
    # 16 / 9 for a strictly letterboxed 16:9 playfield on every monitor.
    min_playfield_aspect = 4 / 3
    max_playfield_aspect = 16 / 9

    # Height of the reference playfield that all logical sizes and speeds are designed against
    reference_height = 1080

    @staticmethod
    def logical_size(desktop_width: int, desktop_height: int, resize: float = 1.0) -> tuple[int, int]:
        """
        Work out the size of the logical playfield surface for a monitor.

        The playfield's shape is the monitor's shape clamped to [`min_playfield_aspect`, `max_playfield_aspect`],
        and its size is the largest box of that shape that fits inside the monitor's desktop (after dividing by the
        retro `resize` ratio). So a 16:9 or 16:10 monitor fills the screen, a 21:9 or 32:9 one gets bars down the
        sides, and a portrait or 5:4 one gets bars top and bottom. Everything in the game is laid out in this
        logical space, which is why the brick field can never run into the bat however the monitor is shaped.

        Args:
            desktop_width: Monitor width in pixels.
            desktop_height: Monitor height in pixels.
            resize: Down-scaling ratio (>= 1.0) for the retro look; the logical surface is this many times smaller
                    than the monitor and gets scaled back up by the display driver.

        Returns:
            tuple[int, int]: (width, height) of the logical playfield in pixels.
        """

        resize = max(resize, 1.0)
        width = desktop_width / resize
        height = desktop_height / resize
        aspect = width / height

        # Shapes within 1% of a limit count as being inside it: a 1366x768 laptop is a hair wider than 16:9 and
        # shouldn't get a one-pixel bar for its trouble
        tolerance = 0.01

        if aspect > Graphics.max_playfield_aspect * (1 + tolerance):
            # Monitor is too wide: use its full height, with bars at the sides
            height = int(height)
            width = int(round(height * Graphics.max_playfield_aspect))
        elif aspect < Graphics.min_playfield_aspect * (1 - tolerance):
            # Monitor is too narrow: use its full width, with bars top and bottom
            width = int(width)
            height = int(round(width / Graphics.min_playfield_aspect))
        else:
            # Monitor shape is acceptable as it is: use the whole thing
            width, height = int(width), int(height)

        return width, height

    def __init__(self, monitor: int, path: str, brick_types: int, resize: float = 1.0) -> None:
        """
        Initialise graphics, window surfaces, and high-resolution sprites.

        Args:
            monitor: Index of the monitor to display on (0 is primary).
            path: Assets directory containing images.
            brick_types: Number of brick variants to load.
            resize: Graphics resizing (downsampling) ratio.
        """

        print(f"Open on monitor {monitor}")
        self.desktop_width, self.desktop_height = pygame.display.get_desktop_sizes()[monitor]
        print(f"Monitor resolution {self.desktop_width}x{self.desktop_height}")

        # The logical playfield: the monitor's shape clamped to the allowed range, fitted inside the monitor.
        # `window_width` / `window_height` are the dimensions of this logical surface - they are what every
        # coordinate in the game is measured against, and (thanks to pygame.SCALED, below) they are also the space
        # mouse coordinates arrive in.
        self.window_width, self.window_height = Graphics.logical_size(self.desktop_width, self.desktop_height, resize)
        print(f"Playfield resolution {self.window_width}x{self.window_height}")
        desktop_aspect = self.desktop_width / self.desktop_height
        if desktop_aspect > Graphics.max_playfield_aspect + 0.01:
            print("Monitor is wider than 16:9 - the playfield will be letterboxed with bars at the sides")
        elif desktop_aspect < Graphics.min_playfield_aspect - 0.01:
            print("Monitor is narrower than 4:3 - the playfield will be letterboxed with bars top and bottom")

        # Make a note of the aspect ratio (used by the brick scaling arithmetic) and the scale of this playfield
        # relative to the reference 1080p implementation
        self.aspect_ratio = self.window_width / self.window_height
        self.scale_ratio = self.window_height / Graphics.reference_height
        print(f"Scale ratio {self.scale_ratio}")

        # Create the display (window) for our game. SCALED | FULLSCREEN asks the driver to stretch our logical
        # surface to fill the monitor, keeping its aspect ratio and adding black bars where the shapes differ.
        # Mouse coordinates are translated into logical space for us, including the offset of any bars.
        self.display = pygame.display.set_mode(
            (self.window_width, self.window_height),
            pygame.NOFRAME | pygame.SCALED | pygame.FULLSCREEN,
            # vsync=1,
            display=monitor
        )

        # Create a surface to do all of our rendering into
        screen_size = (self.window_width, self.window_height)
        self.screen = pygame.Surface(screen_size)

        # Create a surface for holding the background image (for undrawing objects)
        self.background = None

        # Create a black surface with the same size as the screen for darkening effects
        self.black_screen = pygame.Surface(screen_size)
        self.black_screen.fill(Graphics.colours['black'])

        # Create a transparent surface for plotting glowing trails into
        self.trail_sfc = pygame.Surface(screen_size, pygame.SRCALPHA)
        # self.trail_sfc.set_alpha(None)      # ensure per-pixel alpha, not per-surface alpha
        self.trail_sfc.fill((0, 0, 0, 0))   # make fully transparent

        # Fractional trail fade carried over between frames (see `fade_trails()`)
        self.trail_fade_acc = 0.0

        # Set the name of the window
        pygame.display.set_caption("Breakout")

        # Hide the mouse pointer
        pygame.mouse.set_visible(False)
        pygame.event.set_grab(True)
        self.get_mouse_pos()

        # Load all of our sprites (apart from the background tile)
        self.path = path
        self.ball_img = None
        self.bat_img = None
        self.blue_laser_img = None
        self.bonus_ball_img = None
        self.bonus_bat_img = None
        self.green_laser_img = None
        self.hires_brick_imgs = self._load_sprites(path=path, brick_types=brick_types)
        self.brick_images = None

    def _rescale_image(self, src_img: pygame.Surface, pcnt: float) -> pygame.Surface:
        """
        Rescale the supplied image so that its height is a specified percentage of the window height,
        while maintaining its aspect ratio.

        Args:
            src_img: The image to resize.
            pcnt: The window height percentage to scale to.

        Returns:
            pygame.Surface: The resized image.

        Note: use higher-quality `smoothscale()` rather than the faster `scale()` because we only do
        this once per loaded image, so quality matters more than speed.
        """

        # What size should this image be, raltice to the window dimensions?
        h_out = (self.window_height * pcnt) // 100

        # Get actual image size
        w_in, h_in = src_img.get_size()

        # Compute the scaling ratio
        ratio = h_out / h_in

        return pygame.transform.smoothscale(src_img, (int(w_in * ratio), int(h_in * ratio)))

    def _load_sprites(self, path: str, brick_types: int) -> list[pygame.Surface]:
        """
        Load and scale core sprites to monitor-appropriate sizes.

        Args:
            path: Assets directory containing images.
            brick_types: Number of brick variants to load.

        Returns:
            list[pygame.Surface]: High-resolution brick images prior to per-level scaling.

        Raises:
            SystemExit: If any image fails to load.
        """

        try:
            hires_ball_img = pygame.image.load(os.path.join(path, "ball.png"))
            hires_bonus_ball_img = pygame.image.load(os.path.join(path, "extra-ball.png"))
            hires_blue_glow_img = pygame.image.load(os.path.join(path, "blue-glow.png"))
            hires_red_glow_img = pygame.image.load(os.path.join(path, "red-glow.png"))
            hires_bat_img = pygame.image.load(os.path.join(path, "bat.png"))
            hires_bonus_bat_img = pygame.image.load(os.path.join(path, "extra-bat.png"))
            hires_blue_laser_img = pygame.image.load(os.path.join(path, "blue.png"))
            hires_green_laser_img = pygame.image.load(os.path.join(path, "green.png"))
            hires_monitors_img = pygame.image.load(os.path.join(path, "monitors.png"))

            hires_brick_imgs = []
            for brick in range(brick_types):
                image = pygame.image.load(os.path.join(path, f"brick{brick}.png"))
                hires_brick_imgs.append(image)

        except pygame.error as e:
            print(f"Error loading images: {e}")
            pygame.quit()
            sys.exit()

        # Resize various images to something more appropriate for our screen
        self.ball_img = self._rescale_image(hires_ball_img, 4.5)
        self.bonus_ball_img = self._rescale_image(hires_bonus_ball_img, 4.5)
        self.blue_glow_img = self._rescale_image(hires_blue_glow_img, 4.5)
        self.red_glow_img = self._rescale_image(hires_red_glow_img, 4.5)

        self.bat_img = self._rescale_image(hires_bat_img, 6)
        self.bonus_bat_img = self._rescale_image(hires_bonus_bat_img, 6)

        self.blue_laser_img = self._rescale_image(hires_blue_laser_img, 6)
        self.green_laser_img = self._rescale_image(hires_green_laser_img, 6)

        self.monitors_img = self._rescale_image(hires_monitors_img, 10)

        # Note: we resize the bricks at the start of each level, because different numbers of
        # brick per level mean they need to be different sizes each time.

        return hires_brick_imgs

    def scale_brick_images(self, level: int) -> list[pygame.Surface]:
        """
        Scale high-resolution brick sprites to per-level dimensions and set global brick size.

        Args:
            level: Level index used to determine the brick grid and scale.

        Returns:
            list[pygame.Surface]: Brick images resized for the current level, all the same size.
        """

        def rescale_brick(level, hires_image):
            x_scale = Game.get_num_columns(level)
            y_scale = x_scale / self.aspect_ratio
            image = pygame.transform.scale(hires_image, (int(self.window_width // x_scale), int(self.window_height // y_scale)))
            return image

        # Scale the brick images down from the full-resolution sprites
        brick_images = []
        for hires_image in self.hires_brick_imgs:
            image = rescale_brick(level, hires_image)
            brick_images.append(image)

        # Set up the dimensions (pixels) of the brick sprites
        width, height = brick_images[0].get_size()
        Brick.set_dimensions(width, height)

        return brick_images

    def get_mouse_pos(self, cache: bool = True) -> tuple[int, int]:
        """
        Query the current mouse position.

        Args:
            cache: If True, store a cached copy of the current mouse coordinates.

        Returns:
            tuple[int, int]: (x, y) in logical playfield pixels, clamped to the playfield.

        Notes:
            On a monitor that isn't 16:9 the pointer can wander into the letterbox bars, where pygame reports
            coordinates outside the playfield (negative, or beyond the width/height). We clamp so the bat and the
            intro's hero ball can never be driven off the edge of the playfield.
        """

        x, y = pygame.mouse.get_pos()
        x = max(0, min(self.window_width - 1, x))
        y = max(0, min(self.window_height - 1, y))
        if cache:
            self.mouse_x, self.mouse_y = x, y

        return x, y

    def set_mouse_pos(self, x: int, y: int, cache: bool = True) -> None:
        """
        Set the mouse position and cache it.

        Args:
            x: Target x position in pixels.
            y: Target y position in pixels.
            cache: If True, store a cached copy of the current mouse coordinates.
        """

        if cache:
            self.mouse_x, self.mouse_y = x, y

        pygame.mouse.set_pos(x, y)

    def initialise_background(self, level: int) -> None:
        """
        Create the tiled background for a level and apply a darkening overlay to help increase contrast
        with the foreground elements.

        Args:
            level: Level index used to choose the background tile image.

        Raises:
            SystemExit: If the tile image fails to load.
        """

        try:
            level = min(level, Game.get_max_level())
            tile_image = pygame.image.load(os.path.join(self.path, f"tile{level}.png"))
        except pygame.error as e:
            print(f"Error loading background tile: {e}")
            pygame.quit()
            sys.exit()

        # Ensure the tile image is scaled appropriately for the display height
        tile_image = self._rescale_image(tile_image, 100)
        tile_width, tile_height = tile_image.get_size()

        # Create a background surface with the same dimensions as the screen
        self.background = pygame.Surface((self.window_width, self.window_height))

        # Calculate the offsets to align tiles to the bottom and horizontally centre them
        y_offset = tile_height - (self.window_height % tile_height)
        x_offset = tile_width - (((self.window_width - tile_width) // 2) % tile_width)

        # Fill the background with the tiled image, starting aligned to the bottom and horizontally centred
        for x in range(-x_offset, self.window_width, tile_width):
            for y in range(-y_offset, self.window_height, tile_height):
                self.background.blit(tile_image, (x, y))

        # Apply the darkening effect to our background image
        self.darken_screen(self.background, 130)

    def fade_trails(self, dt: float, rate: float = 600.0) -> None:
        """
        Fade the glowing ball trails towards transparent.

        Args:
            dt: Time since the last fade (seconds).
            rate: Alpha units (0..255) to subtract per second. 600 is the game's rate; the intro uses a faster one.

        Notes:
            The fade is a whole-number alpha subtraction across the trail surface, so the fractional part of
            `rate * dt` is carried over to the next frame. That keeps the fade rate steady at any frame rate
            instead of rounding it away on fast machines.
        """

        self.trail_fade_acc += rate * dt
        fade = int(self.trail_fade_acc)
        if fade > 0:
            self.trail_fade_acc -= fade
            self.trail_sfc.fill((0, 0, 0, min(255, fade)), special_flags=pygame.BLEND_RGBA_SUB)  # RGB unchanged, alpha -= fade

    def darken_screen(self, screen: pygame.Surface, alpha: int | None = None) -> None:
        """
        Darken a surface by blitting a black overlay with the given opacity.

        Args:
            screen: Target surface to darken.
            alpha: Opacity 0..255. Negative values are treated as positive and values above 255 are capped.
                   If None, no change is applied.
        """

        # Set the alpha of the screen darkening gfx.black_screen and blit it to our screen
        if alpha:
            # Note: the alpha value may be negative, but we treat as positive. It might also be beyond 255, so we'll cap there.
            alpha = abs(int(alpha))
            alpha = min(255, alpha)
            self.black_screen.set_alpha(alpha)

            # Blit the gfx.black_screen onto the screen
            screen.blit(self.black_screen, (0, 0))

    def text_at(
        self,
        surface: pygame.Surface,
        text: str,
        colour: tuple[int, int, int],
        minx: int,
        miny: int,
        font_size: int = 300,
        alpha: int = 204,
        italic: bool = False,
        bold: bool = False,
    ) -> pygame.Rect:
        """
        Render text and blit it centred at (minx, miny).

        Args:
            surface: Target surface to draw on.
            text: Text to render.
            colour: RGB colour triplet.
            minx: X coordinate of the text centre in pixels.
            miny: Y coordinate of the text centre in pixels.
            font_size: Font size in pixels.
            alpha: Opacity 0..255 for the rendered text.
            italic: Whether to render in italic.
            bold: Whether to render in bold.

        Returns:
            pygame.Rect: Bounding rectangle of the rendered text on the target surface.
        """

        # Set the font up
        font = pygame.font.Font(None, font_size)
        font.set_italic(italic)
        font.set_bold(bold)

        # Render to a surface with an alpha channel and set the opacity
        text_surface = font.render(text, True, colour)
        text_surface = text_surface.convert_alpha()
        text_surface.set_alpha(alpha)

        # Get the position and draw the text
        text_rect = text_surface.get_rect(center=(minx, miny))
        surface.blit(text_surface, text_rect)

        return text_rect

    def undraw_text(self, screen: pygame.Surface, bbox: pygame.Rect) -> None:
        """
        Restore the area previously covered by text from the background.

        Args:
            screen: Target surface to restore on.
            bbox: Rectangle of the text that was rendered.
        """

        if bbox is not None:
            screen.blit(self.background, (bbox[0], bbox[1]), bbox)

    def draw_objects(self, objects: Iterable[object], surface: pygame.Surface | None = None) -> int:
        """
        Call `draw()` on each object and count successful draws.

        Args:
            objects: Iterable of objects each exposing `draw(surface: Surface | None = None) -> bool`.
            surface: Optional target surface passed to each object's draw. If None, calls `obj.draw()` with no arguments.

        Returns:
            int: Number of objects whose `draw()` returned True.
        """

        total = 0
        for obj in objects:
            if surface is None:
                if obj.draw():
                    total += 1
            else:
                if obj.draw(surface=surface):
                    total += 1

        return total

    def undraw_objects(self, objects: Iterable[object], surface: pygame.Surface | None = None) -> None:
        """
        Call `undraw()` on each object.

        Args:
            objects: Iterable of objects each exposing `undraw(surface: Surface | None = None) -> None`.
            surface: Optional target surface passed to each object's undraw. If None, calls `obj.undraw()` with no arguments.
        """

        for obj in objects:
            if surface is None:
                obj.undraw()
            else:
                obj.undraw(surface=surface)


class Game():
    # Modify file paths if running as a PyInstaller bundle
    base_path = sys._MEIPASS if hasattr(sys, '_MEIPASS') else os.path.abspath(".")

    # Relative file system paths to various game resources
    sprites_path = os.path.join(base_path, "sprites")
    sounds_path = os.path.join(base_path, "sounds")

    # There are this many varieties of bricks
    num_brick_types = 9

    # Number of seconds to keep controls inverted
    inversion_seconds = 6

    # Number of lives to start the game with
    starting_lives = 3

    # Number of seconds of no brick kills before we chuck a bonus ball in
    boring_timeout = 10

    # Laser mode emission cadence: each bat fires one beam every `laser_period` seconds, with successive bats
    # offset by `laser_stagger` seconds so the beams feel rhythmic rather than simultaneous
    laser_period = 0.5
    laser_stagger = 4.0 / 60.0

    # Rate at which the blackout (black hole brick) effect darkens and then clears, in alpha units per second
    blackout_rate = 30.0

    # Fraction of its speed an intro ball retains after one second of drifting (simulated friction)
    intro_damping = 0.887

    # ----------------------------------------------------------------------------------------------------------
    # Ball speed model
    #
    # Speeds are pixels per second at the 1080p reference resolution; they are multiplied by the window scale
    # ratio at run time (see `target_ball_speed()` and friends).
    #
    # Each difficulty has a base *target* speed: the speed the hero ball is served at. The target grows gently
    # and geometrically with the level (8% per level, so level 6 is about 1.47x level 1). Around the target sit a
    # floor - balls are never allowed to dawdle below it, which is what used to make the end of a level drag -
    # and a ceiling, the fastest the game ever lets a ball go. Bat hits and the player's click "kick" add speed
    # in fixed fractions of the target, so the pace climbs steadily through a rally but can never run away.
    # Losing the hero ball resets it to the target on the next serve.
    # ----------------------------------------------------------------------------------------------------------
    base_ball_speed = (480.0, 560.0, 640.0)   # Target speed on level 1 for easy, medium, hard
    level_speed_ramp = 1.08                    # Target multiplier per level above the first
    min_speed_fraction = 0.75                  # Floor, as a fraction of the target
    max_speed_fraction = 1.6                   # Ceiling, as a fraction of the target
    bat_hit_speed_gain = (0.01, 0.02, 0.03)    # Speed added per bat hit (easy, medium, hard), fraction of target
    kick_speed_gain = 0.15                     # Speed added per left click, fraction of target

    # The target rises as the level empties out. A full brick field leaves only a narrow gap above the bat, so the
    # player needs the ball to be slower there; once most bricks are gone the ball has the whole playfield to cross
    # and a slow one makes hunting the last few bricks a chore. The boost scales with the fraction of destructible
    # bricks cleared: with the last brick standing the target is (1 + endgame_speed_boost) times the base. Because
    # the floor and ceiling are fractions of the target, a ball already in play is eased along as the field clears.
    endgame_speed_boost = 0.35

    # Never have more than this many balls in play at once (bonus balls are refused beyond it)
    max_balls = 6

    # Serving: at the start of a level, and after the hero ball is lost, it sits on the bat until the player
    # clicks or `serve_timeout` seconds pass. It launches at the target speed within `serve_angle` degrees of
    # straight up.
    serve_timeout = 3.0
    serve_angle = 20.0

    # The following tables define which brick types go where in each level
    #
    # 0 - Light blue (do nothing), or Red (extra ball), or Green (extra bat)
    # 3 - White (extra life)
    # 4 - Black (fade to black)
    # 5 - Yellow (reverse controls)
    # 6 - Fire (destroy neighbours)
    # 7 - Metal (indestructible)
    # 8 - Dark blue (lasers)
    #
    level_defs = [
        [
            # Level 1
            [7, 0, 0, 0, 4, 0, 0, 0, 0, 7],
            # [5, 5, 5, 5, 5, 3, 5, 5, 8, 5]
            # [8, 8, 8, 8, 8, 3, 8, 8, 8, 8]
            [0, 0, 0, 0, 0, 3, 0, 0, 8, 0]
        ],
        [
            # Level 2
            [0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 4, 0, 0, 6, 0, 0, 0],
            [7, 0, 0, 0, 0, 7, 7, 0, 0, 3, 0, 7]
        ],
        [
            # Level 3
            [0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0],
            [0, 7, 0, 6, 0, 8, 0, 3, 0, 0, 0, 0, 7, 5],
            [0, 0, 7, 6, 0, 0, 4, 0, 0, 0, 6, 7, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 7, 8, 0, 0, 0, 0, 3]
        ],
        [
            # Level 4
            [0, 6, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 6, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0],
            [8, 0, 0, 4, 0, 5, 0, 0, 0, 0, 5, 0, 6, 0, 0, 0],
            [0, 0, 0, 0, 0, 7, 0, 3, 6, 0, 7, 0, 0, 0, 0, 0],
            [5, 0, 0, 0, 0, 0, 7, 7, 7, 7, 0, 0, 0, 4, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8]
        ],
        [
            # Level 5
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 6, 0, 0, 0, 0, 0, 5, 7, 0, 0, 4, 0, 0, 0, 0, 6, 0],
            [0, 0, 0, 0, 6, 0, 0, 8, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 4, 0, 0, 6, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0],
            [0, 0, 0, 0, 7, 0, 0, 0, 0, 4, 7, 0, 6, 0, 0, 7, 0, 0, 0, 0],
            [3, 0, 5, 7, 0, 0, 0, 0, 7, 7, 0, 6, 0, 0, 0, 0, 7, 4, 0, 0],
            [0, 7, 7, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 5],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ],
        [
            # Level 6
            [7, 0, 0, 0, 0, 0, 5, 0, 0, 4, 0, 0, 4, 0, 0, 5, 0, 0, 0, 0, 0, 7],
            [0, 0, 7, 0, 6, 0, 0, 0, 0, 0, 8, 3, 0, 0, 0, 0, 0, 6, 0, 7, 0, 0],
            [0, 4, 0, 0, 0, 6, 0, 0, 5, 0, 0, 0, 5, 0, 0, 6, 0, 0, 0, 4, 0, 0],
            [0, 0, 0, 0, 0, 0, 7, 7, 7, 6, 0, 0, 6, 7, 7, 7, 0, 0, 0, 0, 0, 0],
            [0, 0, 4, 0, 0, 0, 7, 0, 0, 4, 0, 8, 4, 0, 0, 7, 0, 0, 0, 4, 0, 0],
            [0, 6, 0, 0, 7, 0, 0, 0, 6, 0, 7, 0, 0, 6, 0, 0, 7, 0, 0, 0, 6, 0],
            [5, 0, 0, 7, 0, 0, 0, 8, 0, 0, 6, 0, 0, 0, 8, 0, 0, 7, 0, 0, 0, 5],
            [0, 0, 0, 0, 0, 7, 0, 3, 6, 0, 7, 0, 6, 3, 0, 7, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 5, 0, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 5, 0, 0, 0],
            [7, 0, 0, 0, 0, 6, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 6, 0, 0, 0, 7]
        ]
    ]

    @classmethod
    def get_max_level(cls) -> int:
        """
        Return the number of defined levels.

        Returns:
            int: Count of level definitions in `level_defs`.
        """

        return len(cls.level_defs)

    @classmethod
    def get_level_def(cls, level: int) -> list[list[int]]:
        """
        Get the brick layout definition for a 1-indexed level.

        Args:
            level: Level number starting at 1.

        Returns:
            list[list[int]]: Rows of brick type indices.

        Raises:
            IndexError: If `level` is out of range.
        """

        return cls.level_defs[level - 1]

    @classmethod
    def get_num_rows(cls, level: int) -> int:
        """
        Get the number of brick rows for a level.

        Args:
            level: Level number starting at 1.

        Returns:
            int: Number of rows.
        """

        return len(cls.get_level_def(level))

    @classmethod
    def get_num_columns(cls, level: int) -> int:
        """
        Get the number of brick columns for a level.

        Args:
            level: Level number starting at 1.

        Returns:
            int: Number of columns (from the first row).
        """

        rows = cls.get_level_def(level)
        return len(rows[0])

    @classmethod
    def play_stereo_sound(cls, sound: pygame.mixer.Sound, stereo: float = 0.5, volume: float | None = None) -> None:
        """
        Play a sound with optional master volume and stereo panning.

        Args:
            sound: The sound to play.
            stereo: Pan position. Commonly 0.0 is left, 1.0 is right.
            volume: Optional overall volume 0.0..1.0 applied before panning.

        Notes:
            The panning calculation derives left/right volumes from `stereo`.
        """

        # Optionally set the volume
        if volume is not None:
            volume = max(0.0, min(1.0, volume))
            sound.set_volume(volume)

        # Play the sound
        channel = sound.play()
        if channel is not None:
            # Calculate the stereo position (0.0 for left, 1.0 for right) ralative to the window width
            stereo = max(0.0, min(1.0, stereo))

            # Set the left and right volumes based on the stereo position
            left_vol = max(0.0, 1.0 - stereo)
            right_vol = max(0.0, stereo)
            channel.set_volume(left_vol, right_vol)

    @classmethod
    def get_next_alpha(cls, alpha: float | None, dt: float) -> float | None:
        """
        Step a fade alpha toward darkness or light, with a wrap at -300 -> 255.

        Args:
            alpha: Current alpha. Negative values continue decreasing toward -300 (getting darker; the drawing code
                   uses the absolute value, capped at 255). Non-negative values step down toward 0 (getting lighter).
                   None halts fading.
            dt: Time to advance the fade by (seconds). The fade moves `blackout_rate` alpha units per second.

        Returns:
            float | None: Next alpha, 255 once the -300 point is reached, or None when the fade completes.
        """

        # While -ve, we're getting darker, while +ve, we're getting lighter
        #
        # Run all the way down to -300 (which holds the screen fully black for a while, since the drawn alpha is
        # capped at 255), then fade straight back from 255 to 0.
        if alpha is None:
            return None

        alpha -= Game.blackout_rate * dt
        if alpha <= -300:
            return 255.0
        if 0 <= alpha < 0.5:
            return None
        return alpha

    def __init__(self, monitor: int | None = 0, resize: float = 1.0, debug: bool = False) -> None:
        """
        Set up graphics, audio, game state, and initial objects.

        Args:
            monitor: Index of the monitor to display on (0 is primary).
            resize: Graphics resizing (downsampling) ratio.
            debug: Enable the developer cheats (see `game_loop()`).

        Side effects:
            - Creates `Graphics` and loads sprites and sounds.
            - Creates hero bat and ball.
            - Sets default difficulty, lives, and level, then calls `reset()`.
        """

        # Initialise the main window and other graphical elements
        self.gfx = Graphics(
            monitor=monitor if monitor is not None else 0,
            path=Game.sprites_path,
            brick_types=Game.num_brick_types,
            resize=resize
        )

        # Developer cheats are only wired up when this is set (via --debug on the command line)
        self.debug = debug

        # Game objects
        self.bats = []
        self.extra_bats = []
        self.balls = []
        self.bricks_total = 0        # Destructible bricks the current level started with
        self.bricks_remaining = 0    # ...and how many are still standing (recounted every frame)
        self.bricks = []
        self.lasers = []
        self.hero_ball = None

        # Load all of our sound effects
        self.ball_hit_sound = None
        self.bat_hit_sound = None
        self.brick_hit_sound = None
        self.click_sound = None
        self.die_sound = None
        self.drop_sound = None
        self.explode_sounds = None
        self.laser_sounds = None
        self.restore_sound = None
        self.tick_sound = None
        self.wall_hit_sound = None
        self.win_sound = None
        self._load_sounds(path=Game.sounds_path, brick_types=Game.num_brick_types)

        # Laser bolts cross the full window height in a little over half a second (this was `height // 32` pixels
        # per frame at 60 fps)
        Laser.set_speed(self.gfx.window_height * 1.875)

        # The game clock: seconds of *simulated* time. It only advances inside `update()`, so it stands still while
        # the game is paused or a splash screen is showing. Every gameplay timer is measured against it.
        self.time = 0.0

        # How long the most recently rendered frame took (seconds); this is what the next `update()` simulates
        self.frame_dt = 1.0 / GAME_FPS

        # Create bat instances
        hero_bat = Bat(0, self.gfx.bat_img, self.gfx, self)
        self.bats = [hero_bat]
        self.extra_bats = []
        offset = [0, -1, 1, -2, 2, -3, 3]
        for idx in range(1, 7):
            dx = offset[idx] * hero_bat.width
            bat = Bat(idx, self.gfx.bonus_bat_img, self.gfx, self, dx=dx)
            self.extra_bats.append(bat)

        # Initialise other important variables required in the game loops
        self.running = True
        self.paused = False
        self.dark_alpha = 0
        self.inversion_remaining = 0.0   # Seconds of control inversion left (0 = not inverted)
        self.laser_remaining = 0.0       # Seconds of laser mode left (0 = lasers off)
        self.boring_deadline = 0.0       # Game time at which we add a bonus ball if nothing has been destroyed
        self.serving = False             # True while the hero ball is sitting on the bat waiting to be served
        self.serve_deadline = 0.0        # Game time at which a waiting hero ball serves itself
        self.clock = pygame.time.Clock()
        self.lowest_brick = 0

        self.bottom_edge = 0
        self.bottom_clip = None
        self.right_edge = 0
        self.right_clip = None

        # Create the hero ball. Unlike bonus balls it doesn't re-enter from the side when lost: it comes back to
        # the bat to be served.
        self.hero_ball = Ball(
            self.gfx.ball_img,
            self.gfx.blue_glow_img,
            self.gfx,
            self,
            0,
            0,
            serve_on_drop=True
        )

        # Other useful globals
        self._level = None
        self._difficulty = 0
        self._frame = 0
        self.reset()

        # Create the text overlay objects (lives remaining and current level)
        self.lives_text = Text(self.gfx, self, text="lives", colour=Graphics.colours['lives'])
        self.level_text = Text(self.gfx, self, text="level", colour=Graphics.colours['level'])

    @property
    def frame(self) -> int:
        """Current frame counter."""

        return self._frame

    @frame.setter
    def frame(self, value: int):
        self._frame = int(value)

    @property
    def difficulty(self) -> int:
        """Current difficulty."""

        return self._difficulty

    @difficulty.setter
    def difficulty(self, value: int):
        self._difficulty = int(value)

    @property
    def lives(self) -> int | None:
        """Current player lives remaining."""

        return self.hero_ball.lives

    @lives.setter
    def lives(self, value: int):
        self.hero_ball.lives = int(value)

    @property
    def level(self) -> int | None:
        """Current level."""

        return self._level

    @level.setter
    def level(self, value: int):
        self._level = int(value)

    @property
    def inverted(self) -> bool:
        """True while the player's controls are reversed."""

        return self.inversion_remaining > 0

    def get_fps(self) -> int:
        """
        Get the current frame rate.

        Returns:
            int: Smoothed frames per second over recent frames (as an integer).

        Notes:
            For display and debugging only. Nothing in the game is timed by this value any more: timers run off
            `self.time` and motion off `frame_dt`.
        """
        return int(self.clock.get_fps())

    def cleared_fraction(self) -> float:
        """
        How much of the current level's destructible brick field has been cleared.

        Returns:
            float: 0.0 with every brick still standing, 1.0 when none remain. Uses the per-frame count kept by
                   `update()`, so it's cheap to call from inside the physics loop.
        """

        if self.bricks_total <= 0:
            return 0.0
        return 1.0 - (self.bricks_remaining / self.bricks_total)

    def count_live_bricks(self) -> int:
        """
        Count the destructible bricks still standing on the current level.

        Returns:
            int: Bricks with lives left that aren't the indestructible metal kind.
        """

        return sum(1 for brick in self.bricks if 0 < brick.lives < 99)

    def target_ball_speed(self, level: int) -> float:
        """
        The speed the hero ball is served at on a given level, for the current difficulty and how far through
        the level the player is (see `endgame_speed_boost`).

        Args:
            level: Level number starting at 1.

        Returns:
            float: Speed in pixels per second, scaled for this window.
        """

        base = Game.base_ball_speed[self.difficulty]
        boost = 1.0 + Game.endgame_speed_boost * self.cleared_fraction()
        return base * (Game.level_speed_ramp ** (level - 1)) * boost * self.gfx.scale_ratio

    def min_ball_speed(self, level: int) -> float:
        """
        The slowest a ball is allowed to travel on a given level.

        Args:
            level: Level number starting at 1.

        Returns:
            float: Speed in pixels per second, scaled for this window.
        """

        return Game.min_speed_fraction * self.target_ball_speed(level)

    def max_ball_speed(self, level: int) -> float:
        """
        The fastest a ball is allowed to travel on a given level.

        Args:
            level: Level number starting at 1.

        Returns:
            float: Speed in pixels per second, scaled for this window.
        """

        return Game.max_speed_fraction * self.target_ball_speed(level)

    def start_serve(self) -> None:
        """
        Put the hero ball on the bat, ready to be served.

        The ball rides along with the bat (see `hold_hero_ball()`) until the player clicks or `serve_timeout`
        seconds of game time pass, at which point `serve()` launches it. The rest of the game - bonus balls,
        lasers, power-up timers - carries on as normal in the meantime.
        """

        self.serving = True
        self.serve_deadline = self.time + Game.serve_timeout
        self.hero_ball.vx, self.hero_ball.vy = 0.0, 0.0
        self.hold_hero_ball()

    def hold_hero_ball(self) -> None:
        """Keep the waiting hero ball sitting centrally on top of the hero bat."""

        bat = self.bats[0]
        self.hero_ball.x = bat.x
        self.hero_ball.y = bat.y - self.hero_ball.h2 - 1

    def serve(self) -> None:
        """
        Launch the waiting hero ball from the bat at the level's target speed, close to straight up.

        Does nothing if the ball isn't waiting to be served.
        """

        if not self.serving:
            return

        self.serving = False
        angle = math.radians(uniform(-Game.serve_angle, Game.serve_angle))
        speed = self.target_ball_speed(self.level)
        self.hero_ball.vx = speed * math.sin(angle)
        self.hero_ball.vy = -speed * math.cos(angle)

        pan = self.hero_ball.x / self.gfx.window_width
        Game.play_stereo_sound(self.bat_hit_sound, stereo=pan, volume=0.5)

    def reset(self, level: int = 1) -> None:
        """
        Reset level, lives, background, and centre the bat/mouse.

        Args:
            level: Level to reset to (defaults to 1).

        Behaviour:
            - Sets `self.level` (defaults to 1).
            - Sets hero ball lives based on `starting_lives` and difficulty bonus.
            - Rebuilds the background for the level.
            - Centres the hero bat and mouse horizontally.
        """

        self.level = level
        self.paused = False

        # Set the hero ball lives to the starting value
        bonus_lives = 2 - self.difficulty
        self.lives = Game.starting_lives + bonus_lives
        self.balls = [self.hero_ball]

        # Initialise the background surface for this level
        self.gfx.initialise_background(self.level)

        # Ensure the hero bat and mouse cursor are horizontally centred, cache mouse position
        middle = self.gfx.window_width // 2
        self.bats[0].x = middle
        self.gfx.set_mouse_pos(middle, self.gfx.window_height - 1)  # Bottom row of the playfield (y = height would be outside it)

    def level_up(self) -> None:
        """
        Advance to the next level.
        """

        self.level += 1

    def initialise_level(self) -> int:
        """
        Prepare a level: draw background, build bricks, and position the hero ball.

        Behaviour:
            - Blits the background to the screen.
            - Scales per-level brick sprites and creates brick objects.
            - Computes the y coordinate below the lowest brick with padding.
            - Centres and positions the hero ball above the bat with initial velocity.
            - Resets darkening and inversion effects, clears extra balls and lasers.
        """

        # Blit (draw) the background onto the screen (essentially clear the screen)
        # self.gfx.screen.blit(self.gfx.background, (0, 0))

        # Initialise the bricks (and draw them)
        self.gfx.brick_images = self.gfx.scale_brick_images(self.level)
        self.create_bricks()

        # Reset the mouse position (and cache it), centre the hero bat on it, and put the hero ball on the bat
        # ready to serve
        middle = self.gfx.window_width // 2
        self.gfx.set_mouse_pos(middle, self.gfx.window_height - 1)  # Bottom row of the playfield (y = height would be outside it)
        self.bats[0].x = middle
        self.start_serve()

        # Start at frame zero and give the player the full "boring" timeout before a bonus ball appears
        self.frame = 0
        self.boring_deadline = self.time + Game.boring_timeout

        # We're not darkening the screen at the moment
        self.dark_alpha = None

        # We're not inverted
        self.inversion_remaining = 0.0
        for bat in self.bats + self.extra_bats:
            bat.restore()

        # Move any active extra bats back into the pool (leave only the hero bat)
        while len(self.bats) > 1:
            self.extra_bats.append(self.bats.pop())

        # Delete all balls except the hero ball
        del self.balls[1:]

        # Create an empty list of laser beams, and switch laser mode off
        self.lasers = []
        self.laser_remaining = 0.0

    def _load_sounds(self, path: str, brick_types: int) -> None:
        """
        Load all game sound effects.

        Args:
            path: Directory containing the audio files.
            brick_types: Number of brick variants to load explosion sounds for.

        Raises:
            SystemExit: If any sound fails to load.
        """

        try:
            self.ball_hit_sound = pygame.mixer.Sound(os.path.join(path, "ball-hit.wav"))
            self.bat_hit_sound = pygame.mixer.Sound(os.path.join(path, "bat-hit.wav"))
            self.brick_hit_sound = pygame.mixer.Sound(os.path.join(path, "brick-hit.wav"))
            self.click_sound = pygame.mixer.Sound(os.path.join(path, "click.wav"))
            self.die_sound = pygame.mixer.Sound(os.path.join(path, "die.wav"))
            self.drop_sound = pygame.mixer.Sound(os.path.join(path, "drop.wav"))
            self.tick_sound = pygame.mixer.Sound(os.path.join(path, "tick.wav"))
            self.restore_sound = pygame.mixer.Sound(os.path.join(path, "restore.wav"))
            self.wall_hit_sound = pygame.mixer.Sound(os.path.join(path, "wall-hit.wav"))
            self.win_sound = pygame.mixer.Sound(os.path.join(path, "win.wav"))
            self.bonus_sound = pygame.mixer.Sound(os.path.join(path, "bonus.wav"))

            # Each brick has its own sound for when it's destroyed
            self.explode_sounds = []
            for brick in range(brick_types):
                sound = pygame.mixer.Sound(os.path.join(path, f"explode{brick}.wav"))
                self.explode_sounds.append(sound)

            # We have multiple laser sounds, for a bit of variety
            self.laser_sounds = []
            for laser in range(3):
                sound = pygame.mixer.Sound(os.path.join(path, f"laser{laser}.wav"))
                self.laser_sounds.append(sound)

        except pygame.error as e:
            print(f"Error loading sounds: {e}")
            pygame.quit()
            sys.exit()

    def velocity_to_volume(self, vx: float, vy: float) -> float:
        """
        Map a 2D velocity vector to a scalar volume in [0.0, 1.0].

        Args:
            vx: Horizontal velocity in pixels per second.
            vy: Vertical velocity in pixels per second.

        Returns:
            float: Volume proportional to speed, capped at 1.0 using a scale factor
                   derived from `gfx.scale_ratio`.
        """

        # Given a velocity, calculate the sound volume, in the range 0.0 - 1.0. Full volume is reached at
        # 3000 px/s at the reference resolution (the old 50 px/frame at 60 fps).
        vn = vx * vx + vy * vy
        factor = 3000.0 * self.gfx.scale_ratio
        return min(factor, math.sqrt(vn)) / factor

    def create_bricks(self) -> None:
        """
        Build the brick grid for the current level and draw initial bricks.

        Behaviour:
            - Chooses brick types per `level_defs` with difficulty-based substitutions.
            - Creates `Brick` instances at grid positions and draws them.
            - Updates `self.bricks` with the new list.
        """

        # List of brick objects for this level
        self.bricks = []

        # Get the layout of the brick rows for this level
        level_rows = Game.get_level_def(self.level)

        # Calculate some important bounding boxes and coordinates for redrawing things
        self.bottom_edge = Brick.height() * len(level_rows)
        self.right_edge = Brick.width() * len(level_rows[0])
        self.lowest_brick = self.bottom_edge + self.hero_ball.height
        self.bottom_clip = pygame.Rect(0, self.bottom_edge, self.gfx.window_width, self.gfx.window_height - self.bottom_edge)
        if self.right_edge < self.gfx.window_width:
            self.right_clip = pygame.Rect(self.right_edge, 0, self.gfx.window_width - self.right_edge, self.bottom_edge)
        else:
            self.right_clip = None

        # Depending on the game mode, we can have different mixes of blue, green, and red bricks
        if self.difficulty == 0:
            rnd_types = [0, 0, 1, 1, 2, 2, 2, 2, 2, 2]
        elif self.difficulty == 1:
            rnd_types = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2]
        else:
            rnd_types = [0, 0, 0, 0, 0, 1, 1, 1, 2, 2]

        # Create and position all of the bricks, from the top row down
        id = 0
        for yn, row in enumerate(level_rows):
            y = Brick.h2() + yn * Brick.height()
            for xn, brick_type in enumerate(row):
                x = Brick.w2() + xn * Brick.width()
                if brick_type == 0:
                    rnd = randint(0, 9)
                    brick_type = rnd_types[rnd]
                elif self.difficulty == 0 and brick_type in [7, 4]:
                    # Easy level has no indestructible or black hole bricks
                    brick_type = 0
                elif self.difficulty == 1 and brick_type == 4:
                    # Medium level has no black hole bricks
                    brick_type = 0
                elif self.difficulty < 2 and brick_type == 5:
                    # Easy and medium levels have extra life bricks instead of reverse bricks
                    brick_type = 3

                brick = Brick(id, self.gfx, self, x, y, brick_type=brick_type)
                self.bricks.append(brick)
                brick.draw(force=True)
                id += 1

        # Remember how big the destructible field is, so the speed model can tell how far through the level we are
        self.bricks_total = self.count_live_bricks()
        self.bricks_remaining = self.bricks_total

    def _brick_cascade(self, cascade: list[int]) -> None:
        """
        Destroy a list of bricks and trigger any cascade effects recursively.

        Args:
            cascade: Brick indices to destroy (may include duplicates/out-of-range).

        Notes:
            Filters invalid or indestructible bricks internally before processing.
        """

        def tidy_cascade(cascade, num_bricks):
            # Remove duplicates and out-of-range brick indices
            cascade = [n for n in list(set(cascade)) if n >= 0 and n < num_bricks]

            # Remove bricks that have been destroyed or are indestructible
            return [n for n in cascade if self.bricks[n].lives > 0 and self.bricks[n].lives < 99]

        cascade = tidy_cascade(cascade, len(self.bricks))

        # Iterate through all the cascade blocks, killing them
        for idx in cascade:
            brick = self.bricks[idx]
            brick.hit(brick.x + brick.w2, kill=True)
            # Recurse (which might include destroying other cascading bricks)
            self.kill_a_brick(brick)

    def _add_bonus_ball(self, lives: int | None = 2) -> int | None:
        """
        Introduce a bonus ball from either the bottom-left or bottom-right of the screen.

        Args:
            lives: Number of lives to give the bonus ball.

        Returns:
            int | None: The x coordinate of the ball that was added, or None if the ball limit (`max_balls`) has
                        been reached and no ball was added.
        """

        # Don't let the screen fill up with balls (levels with lots of metal bricks can keep the "boring" timer
        # firing for a long time)
        if len(self.balls) >= Game.max_balls:
            return None

        if randint(0, 1) == 0:
            # Appear from left
            x = 0
        else:
            # Appear from right
            x = self.gfx.window_width - 1

        # Bonus balls appear from the sides at a random angle - never quite straight up or straight across. They
        # move at between 60% and 100% of the level's target speed (the floor will lift the slow ones a little).
        angle = uniform(5, 85)
        speed = self.target_ball_speed(self.level) * uniform(0.6, 1.0)
        vx = math.sin(math.radians(angle)) * speed
        vy = -math.cos(math.radians(angle)) * speed

        bonus_ball = Ball(
            image=self.gfx.bonus_ball_img,
            glow=self.gfx.red_glow_img,
            gfx=self.gfx,
            game=self,
            x=x,
            y=self.gfx.window_height * 0.8,
            vx=-vx if x else vx,    # Reverse x component if ball is on the right
            vy=vy,
            lives=lives
        )
        self.balls.append(bonus_ball)

        return x

    def kill_a_brick(self, brick: Brick) -> None:
        """
        Handle bonuses/effects when a brick reaches zero lives.

        Args:
            brick: The brick that was destroyed.

        Behaviour:
            - Type 0: Nothing special.
            - Type 1: Spawn a temporary bonus ball entering from a side.
            - Type 2: Activate an extra bat if available.
            - Type 3: Grant an extra life.
            - Type 4: Start a screen darkening effect.
            - Type 5: Start temporary control inversion with bat inversion.
            - Type 6: Trigger a local cascade destroying neighbours.
            - Type 7: Indestructible.
            - Type 8: Extend laser firing duration.
        """

        # Red bricks add some temporary balls
        if brick.type == 1:
            self._add_bonus_ball()

        # Green bricks add a new bat
        elif brick.type == 2:
            if len(self.extra_bats):
                self.extra_bats.sort(key=lambda obj: obj.id)
                bat = self.extra_bats.pop(0)
                bat.reset(self.gfx.mouse_x)
                # If lasers are already firing, slot the new bat into the emission rhythm behind the others
                bat.next_fire = self.time + len(self.bats) * Game.laser_stagger
                self.bats.append(bat)

        # White bricks give an extra life
        elif brick.type == 3:
            self.hero_ball.lives += 1

        # Black hole bricks cause a screen darkening effect
        elif brick.type == 4:
            self.dark_alpha = -1.0

        # Yellow bricks temporarily reverse the player controls
        elif brick.type == 5:
            # If we're about to enter inversion mode...
            if not self.inverted:
                # Reflect the mouse pointer to the opposite side of the screen
                x, y = self.gfx.get_mouse_pos(cache=False)
                self.gfx.set_mouse_pos(self.gfx.window_width - x, y)

            # Another yellow brick while already inverted restarts the clock rather than stacking
            self.inversion_remaining = float(Game.inversion_seconds)

            for bat in self.bats + self.extra_bats:
                bat.invert(force=True)

        # Fire bricks kill all bricks around them
        elif brick.type == 6:
            # Brick ids run left to right along each row, so work in (row, column) terms and only include
            # neighbours that really are adjacent. (Doing this with plain id +/- 1 arithmetic wrapped around the
            # row ends: a fire brick in the left column used to take out the right-hand end of the row above.)
            cols = Game.get_num_columns(self.level)
            row, col = divmod(brick.id, cols)
            cascade = []
            for r in (row - 1, row, row + 1):
                for c in (col - 1, col, col + 1):
                    if r >= 0 and 0 <= c < cols:
                        cascade.append(r * cols + c)

            # Run the cascade (the fire brick's own id is in the list, but it's already dead so it's filtered out)
            self._brick_cascade(cascade)

        # Metal bricks are immortal!
        elif brick.type == 7:
            return

        # Laser bricks start (or extend) the laser shooting duration
        elif brick.type == 8:
            if self.laser_remaining <= 0:
                # Laser mode is just starting: schedule each bat's first beam, slightly staggered
                for idx, bat in enumerate(self.bats):
                    bat.next_fire = self.time + idx * Game.laser_stagger
            self.laser_remaining += Laser.duration

        # Something was destroyed, so the player isn't bored: push the bonus-ball deadline back
        self.boring_deadline = self.time + Game.boring_timeout

    def draw_all_objects(self) -> bool:
        """
        Draw HUD and all active objects.

        Returns:
            bool: True if all destroyable bricks are gone (level cleared), else False.
        """

        # Redraw the parts of the background that brick undrawing won't touch
        self.gfx.screen.blit(self.gfx.background, (0, self.bottom_edge), self.bottom_clip)
        if self.right_clip:
            self.gfx.screen.blit(self.gfx.background, (self.right_edge, 0), self.right_clip)

        # Blend the glowing trails over the background
        self.gfx.screen.blit(self.gfx.trail_sfc, (0, 0))

        # Draw all of the HUD and objects in a sensible order. Bricks are drawn exactly once: each draw of an
        # exploding brick advances its animation, so drawing them twice ran the explosions at double speed.
        self.lives_text.draw()
        self.level_text.draw()
        bricks_remaining = self.gfx.draw_objects(self.bricks)
        self.gfx.draw_objects(self.lasers)
        self.gfx.draw_objects(self.balls)
        self.gfx.draw_objects(self.bats)

        return bricks_remaining == 0

    def undraw_all_objects(self) -> None:
        """
        Restore background over all animated objects and HUD elements.
        """

        # Note: we don't undraw most objects (any more) because the glowing trails code now means
        # we're blitting the background (below the bricks) on every frame, so only the area where the
        # bricks live needs to be undrawn.

        # self.gfx.undraw_objects(self.balls)
        # self.gfx.undraw_objects(self.bats)
        self.gfx.undraw_objects(self.bricks)
        # self.gfx.undraw_objects(self.lasers)
        # self.lives_text.undraw()
        # self.level_text.undraw()

    def display(self, fps: int = GAME_FPS) -> float:
        """
        Present the latest frame, wait for the next frame slot, and measure how long the frame took.

        Args:
            fps: Maximum frame rate (a render cap only; it has no effect on game speed).

        Returns:
            float: The measured frame time in seconds (clamped to MAX_FRAME_DT). This is also stored in
                   `self.frame_dt` and is what the next `update()` should simulate.
        """

        self.gfx.display.blit(self.gfx.screen, (0, 0))
        self.gfx.darken_screen(self.gfx.display, self.dark_alpha)
        pygame.display.flip()

        # Cap the frame rate and find out how long this frame really took
        dt = frame_time(self.clock.tick(fps))
        self.frame_dt = dt
        self.frame += 1

        # Advance the blackout fade. It's a gameplay hazard, so it holds still while the game is paused.
        if not self.paused:
            self.dark_alpha = Game.get_next_alpha(self.dark_alpha, dt)

        # The glowing trails are purely cosmetic, so they keep fading even while paused
        self.gfx.fade_trails(dt)

        return dt

    def update(self, dt: float) -> None:
        """
        Advance the whole simulation by `dt` seconds. Does nothing while the game is paused.

        Args:
            dt: Frame time to simulate (seconds), normally `self.frame_dt` from the previous `display()`.

        Behaviour:
            - Advances the game clock (`self.time`).
            - Runs the once-per-frame bookkeeping: timed effects and bat positions. The bat simply follows the
              mouse, so there's nothing to be gained from sub-stepping it.
            - Integrates everything that moves under its own steam (balls, lasers) in fixed physics sub-steps,
              resolving collisions after every step so fast objects can't tunnel through thin ones.
            - Finally checks whether play has gone stale.
        """

        if self.paused:
            return

        self.time += dt

        # Keep the brick count fresh for the speed model. Counting once per frame here (rather than on every kill)
        # also covers bricks removed by cascades and by the debug cheats.
        self.bricks_remaining = self.count_live_bricks()

        self.check_inversion_mode(dt)
        self.check_lasers_mode(dt)
        self.animate_bats(dt)

        # A hero ball waiting to be served rides along on the bat, and serves itself if the player dawdles
        if self.serving:
            self.hold_hero_ball()
            if self.time >= self.serve_deadline:
                self.serve()

        n, h = substeps(dt)
        for _ in range(n):
            self.move_lasers(h)
            self.animate_balls(h)

        self.check_boring()

    def check_inversion_mode(self, dt: float) -> None:
        """
        Update the temporary control inversion effect and play tick/restore sounds.

        Args:
            dt: Time to advance by (seconds).

        Behaviour:
            - Plays a tick sound as each whole second of inversion passes (including one as it starts), and the
              restore sound instead when one second remains.
            - Counts `inversion_remaining` down; when it reaches 0, restores bats and flips the mouse position to
              avoid a lateral jump.
        """

        if self.inversion_remaining > 0:
            before = self.inversion_remaining
            after = max(0.0, before - dt)
            self.inversion_remaining = after

            # Did this step cross a whole-second boundary (6 -> 5, 5 -> 4, ... 1 -> 0)?
            if math.floor(before) != math.floor(after) and after > 0:
                pan = self.gfx.mouse_x / self.gfx.window_width
                if math.floor(after) == 0:
                    # Play this only one second before restoration
                    Game.play_stereo_sound(self.restore_sound, stereo=pan)
                else:
                    # Play each second during inversion mode
                    Game.play_stereo_sound(self.tick_sound, stereo=pan)

            # If we're exiting inversion mode...
            if after == 0:
                # Restore all of the bats
                for bat in self.bats + self.extra_bats:
                    bat.restore()

                # Reflect the mouse pointer to the opposite side of the screen
                x, y = self.gfx.get_mouse_pos(cache=False)
                self.gfx.set_mouse_pos(self.gfx.window_width - x, y)

    def move_lasers(self, dt: float) -> None:
        """
        Advance active laser beams by one physics step and resolve their brick collisions.

        Args:
            dt: Time to simulate (seconds); normally one physics sub-step.

        Behaviour:
            - Moves beams and removes those that have left the screen.
            - A beam that hits a brick damages it (triggering kill effects if it's destroyed) and is removed.
        """

        alive = []

        for laser in self.lasers:
            if laser.move(dt):
                # Has this beam collided with an alive brick?
                for brick in self.bricks:
                    if not brick.expired() or brick.lives == 99:
                        if laser.check_brick_collision(brick):
                            brick.hit(laser.x)
                            if brick.lives == 0:
                                self.kill_a_brick(brick)
                            laser = None
                            break

                # If the beam is still going, add it to the 'alive' list
                if laser is not None:
                    alive.append(laser)

        # Update our list of alive laser beams
        self.lasers = alive

    def check_lasers_mode(self, dt: float) -> None:
        """
        Emit new laser beams while laser mode is active, and count the mode down.

        Args:
            dt: Time to advance by (seconds).

        Behaviour:
            - While `laser_remaining > 0`, each active bat fires whenever the game clock passes its `next_fire`
              time, then reschedules itself `laser_period` later. Bats are staggered when the mode starts (see
              `kill_a_brick`), which gives the rhythmic feel.
            - Plays a (randomly chosen) laser sound per emission.
        """

        if self.laser_remaining > 0:
            # Count the mode down first, so a beam scheduled for the very end of the mode doesn't sneak out on a
            # floating-point residue after the time is really up
            self.laser_remaining = max(0.0, self.laser_remaining - dt)
            if self.laser_remaining < 1e-6:
                self.laser_remaining = 0.0
                return

            for idx, bat in enumerate(self.bats):
                if self.time >= bat.next_fire:
                    image = self.gfx.blue_laser_img if idx == 0 else self.gfx.green_laser_img
                    laser = Laser(image, self.gfx, bat.x, bat.y + bat.h2)
                    self.lasers.append(laser)
                    rnd = randint(0, 2)
                    pan = bat.x / self.gfx.window_width
                    Game.play_stereo_sound(self.laser_sounds[rnd], stereo=pan)

                    # Schedule the next beam. If we've fallen behind (a very long frame) don't try to catch up
                    # with a burst of beams - just carry on from now.
                    bat.next_fire = max(bat.next_fire + Game.laser_period, self.time)

    def check_boring(self) -> None:
        """
        If gameplay looks stale - a brick hasn't been killed for a while - then add a bonus
        ball into play, and give it more lives than the normal bonus balls.
        """

        if self.time > self.boring_deadline:
            self.boring_deadline = self.time + Game.boring_timeout
            x = self._add_bonus_ball(lives=3)
            if x is not None:
                pan = x / self.gfx.window_width
                Game.play_stereo_sound(self.bonus_sound, stereo=pan)

    def animate_bats(self, dt: float) -> None:
        """
        Move bats to the current mouse x position and recycle expired bonus bats.

        Args:
            dt: Frame time (seconds), used to work out each bat's speed.
        """

        lost = []
        for bat in self.bats:
            bat.move(self.gfx.mouse_x, dt)
            if bat.expired():
                lost.append(bat)

        # Remove any expired bats
        for bat in lost:
            self.bats.remove(bat)
            self.extra_bats.append(bat)

    def animate_balls(self, dt: float) -> None:
        """
        Advance balls by one physics step, resolve collisions with bats/bricks/other balls, and cull lost ones.

        Args:
            dt: Time to simulate (seconds); normally one physics sub-step.

        Behaviour:
            - Calls `move()` on each ball with current level (a hero ball waiting to be served is left alone).
            - If the hero ball just fell off the bottom and has lives left, puts it back on the bat to be served.
            - Checks bat collisions for each ball.
            - Deletes balls whose lives drop below 1 (except the hero ball object itself).
            - For balls above `self.lowest_brick`, checks brick collisions and triggers brick effects.
            - Resolves pairwise ball-ball collisions.
        """

        # Move the ball(s) and check for collisions with the bat(s)
        lost = []

        for ball in self.balls:
            # A hero ball sitting on the bat waiting to be served doesn't move or collide (see `hold_hero_ball()`)
            if self.serving and ball is self.hero_ball:
                continue

            # Move the ball
            ball.move(dt, self.level)

            # Did it just fall off the bottom? If it's the hero ball (and the game isn't over) it goes back on
            # the bat for another serve; bonus balls have already re-entered from a side by themselves.
            if ball.dropped:
                ball.dropped = False
                if ball.serve_on_drop and ball.lives > 0:
                    self.start_serve()
                    continue

            # See if it hit a bat
            for bat in self.bats:
                ball.check_bat_collision(bat)

            # If the ball is dead, add to the list for deletion
            if ball.lives < 1:
                lost.append(ball)

            # If the ball is in the bricks area, see if it has hit one
            if ball.y < self.lowest_brick:
                for brick in self.bricks:
                    # Did we hit (and destroy) a brick?
                    if ball.check_brick_collision(brick):
                        if brick.lives == 0:
                            self.kill_a_brick(brick)
                        break

        # If a ball falls too many times, it gets deleted
        for ball in lost:
            self.balls.remove(ball)
            if ball != self.hero_ball:
                del ball

        # Handle balls colliding with each other (a hero ball waiting on the bat is out of play)
        for i in range(len(self.balls)):
            for j in range(i + 1, len(self.balls)):
                a, b = self.balls[i], self.balls[j]
                if self.serving and (a is self.hero_ball or b is self.hero_ball):
                    continue
                a.check_ball_collision(b)

    def kick_all_balls(self) -> None:
        """
        Give all of the balls a kick of extra speed: `kick_speed_gain` of the level's target speed each. Repeated
        kicks top out at the level's ceiling rather than compounding.
        """

        amount = Game.kick_speed_gain * self.target_ball_speed(self.level)
        for ball in self.balls:
            ball.kick(amount)


def intro(gfx: Graphics, game: Game, widget: MonitorSelector, image_path: str) -> bool:
    """
    Run the animated intro scene with a rotating, perspective-warped image card, a swarm of bouncing intro
    balls, and a difficulty menu.

    Args:
        gfx: Graphics context.
        game: Game context.
        widget: The monitor selection widget (for multi-head systems).
        image_path: Path to an image that will be warped onto a rotating 3D rectangle.

    Behaviour:
        - Loads the image with OpenCV, sets up 3D rotation and perspective projection, and warps the image
          each frame to `gfx.display`.
        - Spawns 15 `Ball` instances in intro mode and animates them at 60 FPS.
        - Renders title and menu text. The currently selected menu item is highlighted, and selection changes
          play a click sound.
        - The mouse controls the hero intro ball and also drives menu selection.
        - Exits the loop on any key press or mouse click, or returns early on quit.

    Returns:
        str | None:
            None: the user quit from the intro (for example window close, Q, or Esc),
            "start": the intro completed and the game should continue.
            "monitor": the monitor selection widget has been clicked.
    """

    # Load the image using OpenCV (which returns None rather than raising if the file can't be read)
    image_cv = cv2.imread(image_path)
    if image_cv is None:
        print(f"Error loading intro image: {image_path}")
        pygame.quit()
        sys.exit()
    image_height, image_width = image_cv.shape[:2]

    # Convert from BGR to RGB
    image_cv = cv2.cvtColor(image_cv, cv2.COLOR_BGR2RGB)

    # Rotation angles
    pitch, yaw, roll = 0.0, 0.0, 0.0

    # Perspective projection parameters
    fov = 900.0

    # Define the 3D vertices of a rectangle (centred at origin)
    rectangle_width = gfx.window_width * 0.4
    rectangle_height = rectangle_width * (image_height / image_width)
    vertices = [
        [-rectangle_width / 2, rectangle_height / 2, 0.0],
        [rectangle_width / 2, rectangle_height / 2, 0.0],
        [rectangle_width / 2, -rectangle_height / 2, 0.0],
        [-rectangle_width / 2, -rectangle_height / 2, 0.0],
    ]

    def rotate_vertex(vertex, pitch, yaw, roll):
        """Apply 3D rotation to a vertex."""

        x, y, z = vertex
        y, z = y * math.cos(pitch) - z * math.sin(pitch), y * math.sin(pitch) + z * math.cos(pitch)
        x, z = x * math.cos(yaw) + z * math.sin(yaw), -x * math.sin(yaw) + z * math.cos(yaw)
        x, y = x * math.cos(roll) - y * math.sin(roll), x * math.sin(roll) + y * math.cos(roll)

        return [x, y, z]

    def project_to_2d(vertex):
        """Convert a 3D vertex into 2D screen coordinates."""

        x, y, z = vertex
        z += fov  # Move the object forward to avoid division by zero
        scale = fov / z
        screen_x = int(gfx.window_width * 0.5 + x * scale)
        screen_y = int(gfx.window_height * 0.5 - y * scale)
        return (screen_x, screen_y)

    def is_edge_on(vertices):
        """Detect if the face is edge-on by checking the dot product of the normal vector and the view direction."""

        # Calculate normal vector using cross product of two edges
        edge1 = [vertices[1][i] - vertices[0][i] for i in range(3)]
        edge2 = [vertices[2][i] - vertices[0][i] for i in range(3)]
        normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0],
        ]

        # Normalise the normal vector
        normal_length = math.sqrt(sum(n ** 2 for n in normal))
        if normal_length == 0:
            return True  # Degenerate face
        normal = [n / normal_length for n in normal]

        # View direction (assuming the viewer is looking along the -z axis)
        view_dir = [0, 0, -1]

        # Dot product between normal and view direction
        dot = sum(normal[i] * view_dir[i] for i in range(3))

        # If the dot product is near zero, the face is edge-on
        return abs(dot) < 0.01  # Threshold for edge-on detection

    def warp_image(image, src_pts, dst_pts):
        """Warp the image to fit the destination points."""

        matrix = cv2.getPerspectiveTransform(np.float32(src_pts), np.float32(dst_pts))
        warped = cv2.warpPerspective(image, matrix, (gfx.window_width, gfx.window_height))
        return warped

    # Rotation rates for the card, in degrees per second (the old per-frame increments at 120 fps)
    pitch_rate = 20.0
    yaw_rate = 40.0
    roll_rate = 10.0

    intro_balls = []
    for idx in range(15):
        intro_ball = Ball(
            gfx.ball_img if idx == 0 else gfx.bonus_ball_img,
            gfx.blue_glow_img if idx == 0 else gfx.red_glow_img,
            gfx,
            game,
            randint(0, gfx.window_width - 1),
            randint(0, gfx.window_height - 1),
            # Starting velocities of up to 600 px/s at the reference resolution
            vx=randint(-5, 5) * 120.0 * gfx.scale_ratio,
            vy=randint(-5, 5) * 120.0 * gfx.scale_ratio,
            lives=1,
            intro=True
        )
        intro_balls.append(intro_ball)

    intro_hero_ball = intro_balls[0]
    gfx.get_mouse_pos()

    # Create menu text for the game modes
    #
    # 0 - easy
    # 1 - medium
    # 2 - hard
    #
    x = gfx.window_width // 2
    menu = []
    menu.append(Text(gfx, game, "Easy", Graphics.colours['item'], x, gfx.window_height * 0.7, size=100, alpha=224))
    menu.append(Text(gfx, game, "Medium", Graphics.colours['item'], x, gfx.window_height * 0.8, size=100, alpha=224))
    menu.append(Text(gfx, game, "Hard", Graphics.colours['item'], x, gfx.window_height * 0.9, size=100, alpha=224))

    # Select the default item
    difficulty = game.difficulty
    menu[difficulty].restyle(colour=Graphics.colours['selitem'], bold=True)

    # Plot the menu text to initialise the bounding boxes
    for text in menu:
        text.draw(surface=gfx.display)

    # Create some other text objects
    messages = []
    messages.append(Text(gfx, game, "Breakout", Graphics.colours['title'], x, gfx.window_height * 0.2, size=400, alpha=224, italic=True, bold=True))
    messages.append(Text(gfx, game, "Copyright © 2025, 7th software Ltd.", Graphics.colours['copyright'], x, gfx.window_height * 0.35, size=80, alpha=200))
    messages.append(Text(gfx, game, "All rights reserved.", Graphics.colours['rights'], x, gfx.window_height * 0.41, size=80, alpha=200))
    messages.append(Text(gfx, game, "Click or press any key to continue", Graphics.colours['presskey'], x, gfx.window_height * 0.46, size=60, alpha=200))
    title = messages[0]

    # Main intro loop. `dt` is the time the previous frame took (a sensible guess for the first one) and `elapsed`
    # is how long the intro has been running, which drives the pulsing title colour.
    more = True
    dt = 1.0 / INTRO_FPS
    elapsed = 0.0
    while more:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return None

            # Check for any keypress
            elif event.type == pygame.KEYUP:
                if event.key == pygame.K_q:
                    return None
                elif event.key == pygame.K_ESCAPE:
                    return None
                else:
                    more = False

            # Check for mouse button click
            elif event.type == pygame.MOUSEBUTTONUP:
                # Read mouse position without affecting cached coordinates
                x, y = gfx.get_mouse_pos(cache=False)
                if widget.is_over(x, y):
                    widget.select(game)
                    return "monitor"

                more = False

        # Move all of the balls (in physics sub-steps, same as the game, so a slow machine doesn't let them tunnel)
        n, h = substeps(dt)
        for ball in intro_balls:
            if ball != intro_hero_ball:
                for _ in range(n):
                    ball.move(h)
            if ball.lives < 1:
                ball.lives = 1

        # Control the hero ball with the mouse. Its velocity (pixels per second) is how far the mouse moved this
        # frame divided by the frame time, so flicking it into the other balls gives a frame-rate independent shove.
        x, y = gfx.get_mouse_pos(cache=False)
        intro_hero_ball.x, intro_hero_ball.y = x, y
        if dt > 0:
            intro_hero_ball.vx, intro_hero_ball.vy = (x - gfx.mouse_x) / dt, (y - gfx.mouse_y) / dt
        gfx.mouse_x, gfx.mouse_y = x, y

        # Handle balls colliding with each other
        for i in range(len(intro_balls)):
            for j in range(i + 1, len(intro_balls)):
                intro_balls[i].check_ball_collision(intro_balls[j])

        # Rotate the card by this frame's worth of each rate
        pitch += math.radians(pitch_rate) * dt
        yaw += math.radians(yaw_rate) * dt
        roll += math.radians(roll_rate) * dt

        # Rotate and project vertices from 3D to 2D
        transformed_vertices = [rotate_vertex(v, pitch, yaw, roll) for v in vertices]
        projected_vertices = [project_to_2d(v) for v in transformed_vertices]

        # Skip blit if the image is edge-on (or very close to edge-on)
        if is_edge_on(transformed_vertices):
            # Just fill the screen with black
            gfx.display.fill(Graphics.colours['black'])
        else:
            # Prepare source and destination points for warping
            src_pts = [[0, 0], [image_width - 1, 0], [image_width - 1, image_height - 1], [0, image_height - 1]]
            dst_pts = [list(projected_vertices[i]) for i in range(4)]

            # Warp the image
            warped_image = warp_image(image_cv.copy(), src_pts, dst_pts)

            # Convert OpenCV image to Pygame surface
            warped_surface = pygame.image.frombuffer(warped_image.tobytes(), warped_image.shape[1::-1], "RGB")

            # Blit the warped surface onto the screen
            gfx.display.blit(warped_surface, (0, 0))

        # Check for the mouse being over a different menu item than the one that is currently selected
        for idx, text in enumerate(menu):
            if difficulty != idx and text.bbox.collidepoint((int(intro_hero_ball.x), int(intro_hero_ball.y))):
                menu[difficulty].restyle(colour=Graphics.colours['item'], bold=False)
                text.restyle(colour=Graphics.colours['selitem'], bold=True)
                Game.play_stereo_sound(game.click_sound)
                difficulty = idx

                # Set the game difficulty based upon the selected menu item
                game.difficulty = difficulty
                break

        # Pulse the colour of the title text, one full cycle every three seconds
        wave = int(64 * math.sin(2 * math.pi * elapsed / 3.0))
        red = Graphics.colours['title'][0] + wave
        grn = Graphics.colours['title'][1] + wave
        blu = Graphics.colours['title'][2] + wave
        title.restyle(colour=(red, grn, blu))

        # Draw the menu text
        for text in menu:
            text.draw(surface=gfx.display)

        # Draw the other text
        for text in messages:
            text.draw(surface=gfx.display)

        # Draw the monitor selection widget (if it is enabled)
        widget.draw(surface=gfx.display, image=gfx.monitors_img)

        # Draw the glowing ball trails
        gfx.display.blit(gfx.trail_sfc, (0, 0))

        # Draw all of the balls
        gfx.draw_objects(intro_balls, gfx.display)

        # Update the display
        pygame.display.flip()

        # Cap the frame rate and measure how long this frame took: that's what the next iteration simulates
        dt = frame_time(game.clock.tick(INTRO_FPS))
        elapsed += dt

        # Fade the glowing trails. The intro fades them twice as fast as the game does.
        gfx.fade_trails(dt, rate=1200.0)

    return "start"


def splash_screen(
    gfx: Graphics,
    game: Game,
    text: str | None,
    colour: tuple[int, int, int] | None = None,
) -> bool:
    """
    Show a short fade-in splash screen with centred text and handle early exit.

    Args:
        gfx: Graphics context with `screen`, `display`, window dimensions, and `darken_screen(...)`.
        game: Game context providing `clock` and `dark_alpha`. Uses `Game.get_next_alpha(...)` to step the fade.
        text: Message to display. If None, the splash is skipped and the function returns False.
        colour: RGB text colour. Defaults to `Graphics.colours['white']` when `text` is provided.

    Returns:
        bool: True if the user quits (window close, Q, or Escape). False if the splash completes, is skipped, or the
              user continues via any other key or a mouse click.

    Behaviour:
        Runs for about three seconds, drawing `Text(...)` each frame, blitting `screen` to `display`, applying a
        black overlay via `darken_screen(...)`, flipping the display, and capping to GAME_FPS. The game clock does
        not advance during a splash, so power-up timers are untouched by it.
    """

    if text is None:
        return False

    game.dark_alpha = 192
    if colour is None:
        colour = Graphics.colours['white']

    # Stick in a game loop for a few seconds while the splash screen text fades in
    x = gfx.window_width // 2
    y = gfx.window_height // 2
    banner = Text(gfx, game, text, colour, x, y, alpha=2, bold=True, italic=True)

    finish = time.time() + 3  # The splash screen will last a few seconds
    while time.time() < finish:
        # Handle any events that are waiting - the user may still want to quit
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return True
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_q:
                    return True
                elif event.key == pygame.K_ESCAPE:
                    return True
                else:
                    return False
            elif event.type == pygame.MOUSEBUTTONDOWN:
                return False

        # Output the splash text
        banner.draw()

        # Flip the gfx.display after applying the darkening effect (which fades in real time here)
        game.display(fps=GAME_FPS)

    # Return False if the user didn't quit
    return False


def game_loop(game: object, gfx: object):
    # Reset to the starting level state
    game.reset()

    # Show a splash screen for the first level (user may quit here)
    splash = f"Level {game.level}..."
    splash_col = Graphics.colours['advance']
    gfx.screen.blit(gfx.background, (0, 0))
    quit = splash_screen(gfx, game, splash, splash_col)
    if quit:
        return False

    # Main loops: outer loop progresses levels; inner loop runs a single level
    while game.running and game.level <= Game.get_max_level() and game.lives > 0:
        # Prepare this level
        game.initialise_level()

        while game.running:
            # Restore background over previously drawn objects
            game.undraw_all_objects()

            # Handle pending events
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    return True

                elif event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_q:
                        return True
                    elif event.key == pygame.K_ESCAPE:
                        return True
                    elif event.key == pygame.K_SPACE:
                        game.paused = not game.paused
                        if game.paused:
                            # Show the mouse pointer and allow it to move outside the pygame window
                            pygame.mouse.set_visible(True)
                            pygame.event.set_grab(False)
                        else:
                            # Hide the mouse pointer, put it back where it was when we paused, lock it within the pygame window
                            pygame.mouse.set_visible(False)
                            gfx.set_mouse_pos(gfx.mouse_x, gfx.mouse_y, cache=False)
                            pygame.event.set_grab(True)

                    # Debug cheat (--debug only): D destroys every brick, which skips the level
                    elif event.key == pygame.K_d and game.debug:
                        for brick in game.bricks:
                            brick.hit(x=0, kill=True)

                elif event.type == pygame.MOUSEMOTION:
                    # Update cached mouse position; apply inversion if active
                    if not game.paused:
                        gfx.get_mouse_pos()
                        if game.inverted:
                            gfx.mouse_x = gfx.window_width - gfx.mouse_x

                elif event.type == pygame.MOUSEBUTTONDOWN and not game.paused:
                    if event.button == 1:
                        if game.serving:
                            # Left click: launch the waiting hero ball from the bat
                            game.serve()
                        else:
                            # Left click: give all of the balls a bit of a speed kick
                            game.kick_all_balls()

                        # Debug cheat (--debug only): a left click also destroys the brick under the pointer.
                        # Right-click first to make the pointer visible so you can see what you're aiming at.
                        if game.debug:
                            x, y = gfx.get_mouse_pos(cache=False)
                            for brick in game.bricks:
                                if not brick.expired() and brick.bbox().collidepoint((x, y)):
                                    brick.hit(x, kill=True)
                                    game.kill_a_brick(brick)

                    elif event.button == 3 and game.debug:
                        # Debug cheat (--debug only): right click shows the pointer for picking out a brick
                        pygame.mouse.set_visible(True)

                elif event.type == pygame.MOUSEBUTTONUP and not game.paused:
                    if event.button == 1 and game.debug:
                        # Debug cheat (--debug only): hide the pointer again once the brick has been clicked
                        pygame.mouse.set_visible(False)

            # Simulate the time the previous frame took (nothing happens while paused, and the game clock that all
            # the power-up timers run off stands still too)
            game.update(game.frame_dt)

            # Stop if no lives remain
            if game.lives <= 0:
                game.running = False

            # Draw everything; report completion if all destroyable bricks are gone
            complete = game.draw_all_objects()
            if complete:
                # All bricks disintegrated
                break

            # Present the frame, optionally blending with black, and measure the frame time for the next update
            game.display(fps=GAME_FPS)

        # Left the inner loop due to one of:
        # - Out of lives, or
        # - Level cleared, or
        # - Quit requested
        if game.lives == 0:
            # Out of lives
            Game.play_stereo_sound(game.die_sound)
            splash = "Game Over!"
            splash_col = Graphics.colours['die']
            # Resume the running state so the main loop continues
            game.running = True

        elif game.running:
            # Level cleared
            game.level_up()
            if game.level <= Game.get_max_level():
                # Award a bonus life and show next level splash
                game.lives += 1
                splash = f"Level {game.level}..."
                splash_col = Graphics.colours['advance']
            else:
                # Final level completed: play win sound and show win splash
                Game.play_stereo_sound(game.win_sound)
                splash = "YOU WIN!"
                splash_col = Graphics.colours['win']
        else:
            # Quitting
            splash = None
            splash_col = None

        # If advancing to the next level, refresh the background
        if game.running:
            gfx.initialise_background(game.level)
            gfx.screen.blit(gfx.background, (0, 0))

        # Optionally show a splash; quit if the user exits during it
        if splash_screen(gfx, game, splash, splash_col):
            return True

    return False


def menu_loop(args: argparse.Namespace) -> int:
    # Create the initial Game and get a reference to the Graphics object
    game = Game(monitor=args.monitor, resize=args.resize, debug=args.debug)
    gfx = game.gfx

    # Initialise a monitor selection widget. Its position is given in reference (1080p) coordinates; `reposition()`
    # scales it for the current playfield.
    widget = MonitorSelector(choice=args.monitor, x=12, y=12)
    widget.reposition(gfx=gfx, image=gfx.monitors_img)

    # Don't check `game.running` here - because the `game` object itself can end up deleted and recreated, which could leave
    # the loop looking at a deleted object (if python decides to cache things)
    while True:
        # The intro screen loop - iterate while the user is selecting a monitor
        while True:
            # Run the intro (user may quit here)
            option = intro(gfx, game, widget, os.path.join(Game.base_path, "sprites", "intro.png"))
            # print(f"option is '{option}'")

            if option is None:
                # User has quit
                return 0
            elif option == "monitor":
                # Quit and reinitialise the pygame display, so that out window can reopen on a different monitor
                pygame.display.quit()
                pygame.display.init()

                # Make a note of the game difficulty setting, so we can preserve it
                difficulty = game.difficulty

                # Mark our Game and Graphics objects for garbage collection
                del gfx
                del game

                # Create new Game and Graphics objects, having selected a different monitor
                game = Game(monitor=widget.monitor, resize=args.resize, debug=args.debug)
                gfx = game.gfx

                # The new monitor may be a different size, so re-scale the widget's position and hit box for it
                widget.reposition(gfx=gfx, image=gfx.monitors_img)

                # Restore the selected difficulty
                game.difficulty = difficulty
            else:
                # Ready to start the game
                break

        # Run the main game loop
        if game_loop(game, gfx):
            # `game_loop()` returns `True` if we've quit
            break

        if not game.running:
            break

    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Breakout. A different spin on the classic retro brick-breaker game."
    )
    parser.add_argument("--resize", "-r", type=float, default=1.0,
                        help="Ratio for down-sizing the graphics for a more retro feel. Default: 1.0")
    parser.add_argument("--monitor", "-m", type=int,
                        help="Index of the monitor to display on (0 is primary).")
    parser.add_argument("--debug", action="store_true",
                        help="Enable developer cheats: D destroys every brick; right-click shows the pointer and "
                             "left-click destroys the brick under it.")
    args = parser.parse_args()

    # Initialise pygame
    pygame.init()

    # Run the outer game loop
    try:
        # Make sure a monitor chosen on the command line actually exists, rather than crashing with an IndexError
        # deep inside the display set-up
        if args.monitor is not None:
            count = pygame.display.get_num_displays()
            if not 0 <= args.monitor < count:
                print(f"Monitor {args.monitor} does not exist: this system has {count} display(s), "
                      f"numbered 0 to {count - 1}", file=sys.stderr)
                return 2

        rc = menu_loop(args)
    except KeyboardInterrupt:
        print("\nInterrupted")
        return 130
    except Exception:
        # Print the full traceback like the default handler
        traceback.print_exc()
        return 1
    finally:
        pygame.quit()

    return rc


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
