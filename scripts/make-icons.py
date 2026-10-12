#!/usr/bin/env python3
"""Generates the extension icons and the Chrome Web Store promo images (V3 palette).

Mark: a cream focus ring with a small opening at the top right, like a session
timer that is running, around a sky blue dot, on an ink rounded square. The
16 px icon closes the ring so it stays crisp at toolbar size.

Palette (extension/ui/common.css): ink #232129, cream #faf7f2, sky #4f7df0.
Orange is reserved for the coffee link and never used here.

Every image is drawn at a large scale then downscaled with LANCZOS. Small
icons use pixel aligned geometry so the ring and the dot land on whole pixels.

The promo tiles carry no localized text (the Chrome Web Store shows the same
tiles for every language): only the brand name, read from appName in
i18n/common.json, and a language neutral mock of the blocked page (digits and
bars instead of words).

Usage: python3 scripts/make-icons.py
Outputs:
  extension/assets/icon-16.png, icon-32.png, icon-48.png, icon-128.png
  store/promo-small-440x280.png, store/marquee-1400x560.png
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "extension" / "assets"
STORE = ROOT / "store"

INK = (35, 33, 41)
CREAM = (250, 247, 242)
WHITE = (255, 255, 255)
SURFACE_2 = (243, 238, 231)
SKY = (79, 125, 240)
SKY_SOFT = (232, 239, 255)

# Ring geometry as fractions of the artwork box: outer and inner radius, dot radius.
RING = {"outer": 0.34, "inner": 0.25, "dot": 0.112}
# Opening of the ring, in degrees, measured between the round caps. 0 degrees is 3 o'clock
# and angles grow clockwise (screen coordinates), so -72 sits just after 12 o'clock.
GAP_CENTER = -72
GAP_SPAN = 44

# Pixel aligned geometry for the small icons (outer radius, inner radius, dot radius in px,
# center on the middle of the canvas) and whether the ring keeps its opening.
HINTED = {
    16: {"outer": 6, "inner": 4, "dot": 2, "open": False},
    32: {"outer": 11.5, "inner": 8.25, "dot": 3.75, "open": True},
    48: {"outer": 16.5, "inner": 12, "dot": 5.5, "open": True},
}

# (path, index, variation names by weight). First choice: Nunito, bundled with the extension as
# --font-display (extension/fonts, SIL Open Font License), so the tiles match the UI.
FONT_CANDIDATES = [
    (str(ROOT / "extension" / "fonts" / "nunito-latin-wght-normal.woff2"), 0, {"semibold": "SemiBold", "bold": "Bold"}),
    ("/System/Library/Fonts/SFNSRounded.ttf", 0, {"semibold": "Semibold", "bold": "Bold"}),
    ("/System/Library/Fonts/Avenir Next.ttc", 2, None),
    ("/System/Library/Fonts/HelveticaNeue.ttc", 1, None),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0, None),
    ("C:/Windows/Fonts/segoeuib.ttf", 0, None),
]

FALLBACK_NAME = "WeDeepFocus"
# Digits only: the same in every language.
MOCK_COUNTDOWN = "42:17"

_font_cache = {}


def brand_name():
    """The extension name from its single source, appName in i18n/common.json."""
    try:
        data = json.loads((ROOT / "i18n" / "common.json").read_text(encoding="utf-8"))
        name = data["appName"]["en"].strip()
        if name:
            return name
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    print(f"warning: appName not found in i18n/common.json, using {FALLBACK_NAME!r}", file=sys.stderr)
    return FALLBACK_NAME


def display_font(size, weight="semibold"):
    """Rounded display font (semibold or bold), or the closest available fallback."""
    key = (size, weight)
    if key in _font_cache:
        return _font_cache[key]
    for path, index, variations in FONT_CANDIDATES:
        if not Path(path).exists():
            continue
        try:
            fnt = ImageFont.truetype(path, size, index=index)
            if variations:
                fnt.set_variation_by_name(variations[weight])
            _font_cache[key] = fnt
            return fnt
        except (OSError, ValueError, KeyError):
            continue
    _font_cache[key] = ImageFont.load_default(size=size)
    return _font_cache[key]


# ---------- geometry helpers ----------

def squircle_points(box, exponent=4.2, steps=1440):
    """Superellipse outline: a rounded square with continuous corners."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a, b = (x1 - x0) / 2, (y1 - y0) / 2
    points = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        points.append((cx + a * math.copysign(abs(c) ** (2 / exponent), c),
                       cy + b * math.copysign(abs(s) ** (2 / exponent), s)))
    return points


def disc(draw, cx, cy, r, fill):
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)


def round_capped_arc(draw, cx, cy, radius, width, start, end, fill):
    """Strokes an arc (degrees, clockwise) with round caps by stamping discs along it."""
    step = max(0.05, math.degrees(width / 12 / radius))
    angle = start
    while angle <= end:
        rad = math.radians(angle)
        disc(draw, cx + radius * math.cos(rad), cy + radius * math.sin(rad), width / 2, fill)
        angle += step
    rad = math.radians(end)
    disc(draw, cx + radius * math.cos(rad), cy + radius * math.sin(rad), width / 2, fill)


def draw_mark(draw, cx, cy, outer, inner, dot, opened, ring_fill=CREAM, dot_fill=SKY, hole_fill=INK):
    """The focus ring (opened or closed) and its center dot."""
    if opened:
        width = outer - inner
        radius = (outer + inner) / 2
        cap = math.degrees(width / 2 / radius)
        start = GAP_CENTER + GAP_SPAN / 2 + cap
        end = GAP_CENTER - GAP_SPAN / 2 - cap + 360
        round_capped_arc(draw, cx, cy, radius, width, start, end, ring_fill)
    else:
        disc(draw, cx, cy, outer, ring_fill)
        disc(draw, cx, cy, inner, hole_fill)
    disc(draw, cx, cy, dot, dot_fill)


def ring_geometry(size):
    """(outer, inner, dot, opened) in output pixels for an artwork box of `size` px."""
    if size in HINTED:
        g = HINTED[size]
        return g["outer"], g["inner"], g["dot"], g["open"]
    return RING["outer"] * size, RING["inner"] * size, RING["dot"] * size, True


# ---------- icons ----------

def render_tile(size, fill=INK):
    """Rounded square tile with the mark, full bleed, `size` px."""
    k = max(1, math.ceil(1024 / size))
    big = size * k
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    draw.polygon(squircle_points((0, 0, big, big)), fill=fill)
    outer, inner, dot, opened = ring_geometry(size)
    draw_mark(draw, big / 2, big / 2, outer * k, inner * k, dot * k, opened, hole_fill=fill)
    return im.resize((size, size), Image.LANCZOS)


def render_icon(size):
    """Returns an RGBA icon. 128 keeps 16 px of transparent padding (artwork 96x96)."""
    if size == 128:
        pad = 16
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        # Rendered on its own and pasted, so resampling cannot bleed into the padding.
        out.paste(render_tile(size - 2 * pad), (pad, pad))
        return out
    return render_tile(size)


# ---------- promo helpers ----------

def mix(a, b, t):
    """Color between a (t = 0) and b (t = 1)."""
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def fit_font(draw, text, size, max_width, weight="bold"):
    while size > 8:
        fnt = display_font(size, weight)
        if draw.textlength(text, font=fnt) <= max_width:
            return fnt
        size -= 1
    return display_font(size, weight)


def ink_box(draw, text, fnt):
    """Ink extents of `text` around its left baseline point: (x0, y0, x1, y1), y0 is negative."""
    return draw.textbbox((0, 0), text, font=fnt, anchor="ls")


def soft_rings(im, center, radii, color, width):
    """Concentric rings echoing the mark, slightly blurred.

    The layer is transparent `color` (not transparent black), so the blur adds no dark fringe.
    """
    layer = Image.new("RGBA", im.size, color + (0,))
    draw = ImageDraw.Draw(layer)
    cx, cy = center
    for r in radii:
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color + (255,), width=width)
    im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(width / 6)))


def drop_shadow(im, box, radius, offset, blur, color):
    x0, y0, x1, y1 = box
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle((x0, y0 + offset, x1, y1 + offset), radius=radius, fill=color)
    im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def bar(draw, x0, cy, x1, thickness, fill):
    """Rounded bar standing in for a line of text, so the mock needs no translation."""
    draw.rounded_rectangle((x0, cy - thickness / 2, x1, cy + thickness / 2), radius=thickness / 2, fill=fill)


def shield(draw, cx, cy, size, fill):
    """Small solid shield glyph."""
    w, h = size, size * 1.18
    top = cy - h / 2
    pts = [(cx, top), (cx + w / 2, top + h * 0.16), (cx + w / 2, cy + h * 0.02),
           (cx, cy + h / 2), (cx - w / 2, cy + h * 0.02), (cx - w / 2, top + h * 0.16)]
    draw.polygon(pts, fill=fill)


def paste_tile(im, size, xy, shadow=True):
    """Pastes the app tile (ink squircle and mark) with a soft shadow."""
    x, y = xy
    if shadow:
        drop_shadow(im, (x + size * 0.06, y + size * 0.06, x + size * 0.94, y + size * 0.94), size * 0.22, size * 0.06, size * 0.1, (20, 30, 70, 90))
    im.alpha_composite(render_tile(size), (round(x), round(y)))


def draw_lockup(im, name, tile_size, left, center_y, gap, font_size, max_text_width):
    """App tile then the brand name on its right, both vertically centered on center_y."""
    draw = ImageDraw.Draw(im)
    fnt = fit_font(draw, name, font_size, max_text_width)
    paste_tile(im, tile_size, (left, center_y - tile_size / 2))
    x0, y0, _, y1 = ink_box(draw, name, fnt)
    # Center the cap height (ink box of the name) on the tile's center.
    baseline = center_y - (y0 + y1) / 2
    draw.text((left + tile_size + gap - x0, baseline), name, font=fnt, fill=WHITE, anchor="ls")
    return fnt


# ---------- promo images ----------

def render_promo_small(name):
    s = 2
    w, h = 440 * s, 280 * s
    im = Image.new("RGBA", (w, h), SKY + (255,))
    soft_rings(im, (w * 0.83, h * 1.02), [r * s for r in (90, 150, 210, 270, 330)], mix(SKY, WHITE, 0.09), 16 * s)
    draw = ImageDraw.Draw(im)
    tile = 96 * s
    gap = 22 * s
    fnt = fit_font(draw, name, 52 * s, w - 2 * 36 * s - tile - gap)
    text_w = draw.textlength(name, font=fnt)
    left = (w - (tile + gap + text_w)) / 2
    draw_lockup(im, name, tile, left, h / 2, gap, fnt.size, text_w + 1)
    return im.resize((440, 280), Image.LANCZOS).convert("RGB")


def draw_browser_mock(im, box, s):
    """A browser window showing the blocked page: timer, progress, one goal, the ink button."""
    x0, y0, x1, y1 = box
    drop_shadow(im, box, 26 * s, 22 * s, 28 * s, (16, 32, 90, 110))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle(box, radius=26 * s, fill=CREAM)

    # Window chrome: three dots and an address bar.
    chrome_h = 58 * s
    draw.rounded_rectangle((x0, y0, x1, y0 + chrome_h + 26 * s), radius=26 * s, fill=WHITE)
    draw.rectangle((x0, y0 + chrome_h, x1, y0 + chrome_h + 26 * s), fill=CREAM)
    draw.line((x0, y0 + chrome_h, x1, y0 + chrome_h), fill=mix(CREAM, INK, 0.08), width=2 * s)
    for i in range(3):
        disc(draw, x0 + (30 + i * 22) * s, y0 + chrome_h / 2, 6 * s, mix(WHITE, INK, 0.14))
    address = (x0 + 110 * s, y0 + 15 * s, x1 - 40 * s, y0 + chrome_h - 15 * s)
    draw.rounded_rectangle(address, radius=(address[3] - address[1]) / 2, fill=SURFACE_2)
    bar(draw, address[0] + 22 * s, (address[1] + address[3]) / 2, address[0] + 170 * s, 9 * s, mix(SURFACE_2, INK, 0.2))

    cx = (x0 + x1) / 2
    top = y0 + chrome_h

    # Site chip: shield and a bar where "<site> is blocked" would be.
    chip = (cx - 104 * s, top + 28 * s, cx + 104 * s, top + 64 * s)
    chip_cy = (chip[1] + chip[3]) / 2
    draw.rounded_rectangle(chip, radius=18 * s, fill=WHITE, outline=mix(CREAM, INK, 0.1), width=s)
    shield(draw, chip[0] + 26 * s, chip_cy, 14 * s, SKY)
    bar(draw, chip[0] + 46 * s, chip_cy, chip[2] - 22 * s, 10 * s, mix(WHITE, INK, 0.2))

    # Big rounded timer, its label and the progress bar.
    draw.text((cx, top + 136 * s), MOCK_COUNTDOWN, font=display_font(104 * s, "bold"), fill=INK, anchor="mm")
    bar(draw, cx - 84 * s, top + 196 * s, cx + 84 * s, 11 * s, mix(CREAM, INK, 0.18))
    track = (cx - 170 * s, top + 222 * s, cx + 170 * s, top + 230 * s)
    draw.rounded_rectangle(track, radius=4 * s, fill=mix(CREAM, INK, 0.08))
    draw.rounded_rectangle((track[0], track[1], track[0] + (track[2] - track[0]) * 0.36, track[3]), radius=4 * s, fill=SKY)

    # One goal card: target bubble and a bar for the goal.
    card = (x0 + 48 * s, top + 256 * s, x1 - 48 * s, top + 330 * s)
    drop_shadow(im, card, 20 * s, 6 * s, 10 * s, (35, 33, 41, 30))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle(card, radius=20 * s, fill=WHITE, outline=mix(WHITE, INK, 0.08), width=s)
    bcx, bcy = card[0] + 44 * s, (card[1] + card[3]) / 2
    disc(draw, bcx, bcy, 21 * s, SKY_SOFT)
    disc(draw, bcx, bcy, 10 * s, SKY)
    disc(draw, bcx, bcy, 6.5 * s, SKY_SOFT)
    disc(draw, bcx, bcy, 3.5 * s, SKY)
    bar(draw, card[0] + 82 * s, bcy - 9 * s, card[2] - 90 * s, 11 * s, mix(WHITE, INK, 0.3))
    bar(draw, card[0] + 82 * s, bcy + 12 * s, card[0] + 250 * s, 9 * s, mix(WHITE, INK, 0.14))

    # Ink pill button ("Back to work") and the discreet text button under it.
    button = (cx - 118 * s, top + 352 * s, cx + 118 * s, top + 400 * s)
    draw.rounded_rectangle(button, radius=24 * s, fill=INK)
    bar(draw, cx - 58 * s, (button[1] + button[3]) / 2, cx + 58 * s, 10 * s, mix(INK, CREAM, 0.85))
    bar(draw, cx - 50 * s, top + 428 * s, cx + 50 * s, 9 * s, mix(CREAM, INK, 0.22))


def render_marquee(name):
    s = 2
    w, h = 1400 * s, 560 * s
    im = Image.new("RGBA", (w, h), SKY + (255,))
    soft_rings(im, (1030 * s, 330 * s), [r * s for r in (330, 430, 530, 630)], mix(SKY, WHITE, 0.08), 26 * s)
    left = 110 * s
    draw_lockup(im, name, 128 * s, left, h / 2, 34 * s, 86 * s, 470 * s)
    # The window runs off the bottom edge on purpose: it reads as a page, not a widget.
    draw_browser_mock(im, (760 * s, 64 * s, 1300 * s, 640 * s), s)
    return im.resize((1400, 560), Image.LANCZOS).convert("RGB")


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    STORE.mkdir(parents=True, exist_ok=True)
    written = []
    for size in (16, 32, 48, 128):
        path = ASSETS / f"icon-{size}.png"
        render_icon(size).save(path, optimize=True)
        written.append(path)
    name = brand_name()
    for filename, render in (("promo-small-440x280.png", render_promo_small), ("marquee-1400x560.png", render_marquee)):
        path = STORE / filename
        render(name).save(path, optimize=True)
        written.append(path)
    for path in written:
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
