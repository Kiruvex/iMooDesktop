#!/usr/bin/env python3
"""
Generate all PNG icon sizes for iMoo Desktop from app.svg.

Outputs:
  assets/icons/app.png        (512x512, for Qt window icon)
  assets/icons/app-256.png
  assets/icons/app-128.png
  assets/icons/app-64.png
  assets/icons/app-32.png
  assets/icons/app-16.png

Also generates frontend/public assets:
  frontend/public/favicon.svg        (copy of app.svg)
  frontend/public/favicon.png        (32x32)
  frontend/public/apple-touch-icon.png (180x180)
"""
from pathlib import Path
import shutil
import sys

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "assets" / "icons"
PUBLIC = ROOT / "frontend" / "public"

SVG_SRC = ICONS / "app.svg"

assert SVG_SRC.exists(), f"SVG source missing: {SVG_SRC}"
ICONS.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)


def render_png(size: int, dst: Path) -> None:
    """Render SVG to PNG at the given size with alpha."""
    cairosvg.svg2png(
        url=str(SVG_SRC),
        write_to=str(dst),
        output_width=size,
        output_height=size,
    )


def main() -> int:
    # 1) Master 512x512 icon (Qt window icon)
    render_png(512, ICONS / "app.png")
    print(f"[ok] {ICONS / 'app.png'} (512x512)")

    # 2) Multi-size variants for various UI uses
    master = Image.open(ICONS / "app.png").convert("RGBA")
    for size in (256, 128, 64, 32, 16):
        dst = ICONS / f"app-{size}.png"
        resized = master.resize((size, size), Image.LANCZOS)
        resized.save(dst, format="PNG", optimize=True)
        print(f"[ok] {dst} ({size}x{size})")

    # 3) frontend/public assets
    # 3a) favicon.svg — copy master SVG (vector favicon for modern browsers)
    fav_svg = PUBLIC / "favicon.svg"
    shutil.copyfile(SVG_SRC, fav_svg)
    print(f"[ok] {fav_svg}")

    # 3b) favicon.png — 32x32 PNG fallback for legacy browsers
    fav_png = PUBLIC / "favicon.png"
    master.resize((32, 32), Image.LANCZOS).save(fav_png, format="PNG", optimize=True)
    print(f"[ok] {fav_png} (32x32)")

    # 3c) apple-touch-icon.png — 180x180 (iOS home-screen icon).
    # iOS applies its own rounded mask; we ship a full-bleed square so the
    # squircle mask does not double-round our icon. Hence render the SVG
    # without the rounded background by rendering a flat-bg variant inline.
    # Simpler: just upscale the master (which has the squircle bg) — iOS will
    # mask it to a squircle anyway; the doubled radius is acceptable & common.
    master.resize((180, 180), Image.LANCZOS).save(
        PUBLIC / "apple-touch-icon.png", format="PNG", optimize=True
    )
    print(f"[ok] {PUBLIC / 'apple-touch-icon.png'} (180x180)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
