# Licences

Breakout is made of 7th software Ltd.'s own work, which is free software under the Apache License 2.0, and a few things by other people, which are theirs and come under their own terms. This page says which is which. The Apache License 2.0 in [LICENSE](LICENSE) applies only to the first group.

## 7th software Ltd.'s work: Apache License 2.0

© 2025-26 7th software Ltd. Licensed under the Apache License, Version 2.0 (see [LICENSE](LICENSE), or https://www.apache.org/licenses/LICENSE-2.0).

| What | Where |
| ---- | ----- |
| The code: the browser game, the Python game and the tools | `web/index.html`, `web/tilt.html`, `web/sw.js`, `web/manifest.json`, `web/js/`, `breakout.py`, `tools/` |
| The sprites: balls, bats, bricks, glows, lasers, the logo and the stage backdrops 1 to 5, made with the help of ChatGPT and Gemini | `images/` and `web/sprites/`, except `tile6` (below) |
| The icons | `icon.ico`, `web/favicon.ico`, `web/apple-touch-icon.png`, `web/icon-192.png`, `web/icon-512.png` |
| The sound effects, made with sfxr | `web/sounds/` |
| Screenshots of the game, and the link-preview picture | `images/intro.png`, `web/sprites/intro.webp`, `web/social.jpg` |
| The documentation | `README.md`, `DEVNOTES.md`, this file |

Anything in the repository not listed under "Other people's work" below is 7th software Ltd.'s and under the Apache License 2.0 too.

## Other people's work

These are not covered by the Apache License 2.0. Each is used under its owner's terms, which apply to any copy of it you make.

### Music: CC0 1.0

| What | Where |
| ---- | ----- |
| "4 Chiptunes (Adventure)" and "5 Chiptunes (Action)", by Juhani Junkala (https://juhanijunkala.com/) | `web/music/*.ogg` |

Released under the Creative Commons CC0 1.0 Universal public domain dedication (https://creativecommons.org/publicdomain/zero/1.0/), from OpenGameArt: https://opengameart.org/content/4-chiptunes-adventure and https://opengameart.org/content/5-chiptunes-action. [web/music/CREDITS.txt](web/music/CREDITS.txt) lists which track is which.

### Typeface: SIL Open Font Licence 1.1

| What | Where |
| ---- | ----- |
| Exo 2, by Natanael Gama (https://fonts.google.com/specimen/Exo+2) | `web/fonts/*.woff2` |

Under the SIL Open Font Licence, Version 1.1, whose full text is in [web/fonts/LICENSE.txt](web/fonts/LICENSE.txt). The font files may be used, shared and bundled with software, but not sold on their own. Text set in it, as in the game's screens and `web/social.jpg`, is not restricted by the licence.

### The last stage's backdrop: public domain

| What | Where |
| ---- | ----- |
| Photograph of the Rosette Nebula (NGC 2237), by Dylan O'Donnell (https://deography.com/will-you-accept-this-rose-ngc2237/) | `images/tile6.png`, `web/sprites/tile6.webp` |

Released into the public domain by its author: his site, "Public Domain Astrophotography", says "All the astrophotography on this site is considered public domain - use it however you want for free." It is not 7th software Ltd.'s and not part of the Apache-licensed work; it's credited with thanks.

## Tools

The sound effects were made with sfxr (https://sfxr.me/), and the Python game is built on Pygame (https://www.pygame.org/); neither is distributed here.
