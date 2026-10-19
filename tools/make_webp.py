"""
Make WebP copies of the sprites for the web version.

The PNGs in images/ are the masters: the desktop (Pygame) version loads them, and they're what gets edited. The
web version loads a WebP copy of each from web/sprites instead, which at quality 95 is a fifth or so of the size
with no difference you can see, so a phone has far less to download. Run this after changing or adding a
sprite:

    python tools/make_webp.py              # Convert any PNG whose WebP is missing or older than it
    python tools/make_webp.py --all        # Convert every PNG, up to date or not
    python tools/make_webp.py --quality 90 # Smaller files, a little softer (default 95)
    python tools/make_webp.py --lossless   # Exact copies, only about a third smaller

Needs Pillow (pip install pillow). Transparency is kept exactly (lossless alpha) whatever the quality.
"""

import argparse
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.join(HERE, "..", "images")              # The PNG masters
SPRITES = os.path.join(HERE, "..", "web", "sprites")     # Where the web version finds the WebP copies
DESKTOP_ONLY = {"monitors.png"}                          # The monitor picker: the web version has no use for it


def main() -> int:
    parser = argparse.ArgumentParser(description="Make WebP copies of the web version's PNG sprites.")
    parser.add_argument("--all", action="store_true", help="convert every PNG, even if its WebP is up to date")
    parser.add_argument("--quality", type=int, default=95, help="lossy quality, 0 to 100 (default 95)")
    parser.add_argument("--lossless", action="store_true", help="lossless WebP (much bigger)")
    args = parser.parse_args()

    names = sorted(f for f in os.listdir(IMAGES) if f.lower().endswith(".png") and f not in DESKTOP_ONLY)
    before = after = converted = 0
    for name in names:
        png = os.path.join(IMAGES, name)
        webp = os.path.join(SPRITES, os.path.splitext(name)[0] + ".webp")
        if not args.all and os.path.exists(webp) and os.path.getmtime(webp) >= os.path.getmtime(png):
            continue
        with Image.open(png) as img:
            if args.lossless:
                img.save(webp, "WEBP", lossless=True, quality=100, method=6)
            else:
                # method 6 is the slowest, smallest encoding; alpha_quality 100 keeps the edges of the sprites exact
                img.save(webp, "WEBP", quality=args.quality, method=6, alpha_quality=100)
        old, new = os.path.getsize(png), os.path.getsize(webp)
        before += old
        after += new
        converted += 1
        print(f"{name:20} {old // 1024:6} KB -> {new // 1024:5} KB")

    if converted:
        print(f"{converted} converted: {before / 2**20:.1f} MB of PNG -> {after / 2**20:.1f} MB of WebP")
    else:
        print("Nothing to do: every WebP is up to date (--all converts them anyway)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
