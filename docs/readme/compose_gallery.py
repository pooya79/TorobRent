"""Assemble the README's 2×2 galleries from unmodified Playwright CLI captures.

Run from the repository root: python3 docs/readme/compose_gallery.py
Requires Pillow and DejaVu Sans (override FONT_DIR if needed).
"""

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
FONT_DIR = Path(os.environ.get("FONT_DIR", "/usr/share/fonts/truetype/dejavu"))


def font(size, bold=False):
    return ImageFont.truetype(
        str(FONT_DIR / f"DejaVuSans{'-Bold' if bold else ''}.ttf"), size
    )


def compose(filename, title, subtitle, items, dark=False):
    background = "#14211f" if dark else "#f4f0eb"
    surface = "#22332f" if dark else "#ffffff"
    ink = "#f6f5ef" if dark else "#233c37"
    muted = "#b2c8c0" if dark else "#66756f"
    accent = "#ff648f" if dark else "#d50040"
    # Two equal columns, two equal rows; preserve every screenshot's aspect ratio.
    margin, gap, width, height = 32, 24, 720, 560
    top, caption = 128, 62
    canvas = Image.new("RGB", (1528, 1460), background)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((32, 30, 39, 93), radius=3, fill=accent)
    draw.text((57, 24), title, font=font(35, True), fill=ink)
    draw.text((58, 75), subtitle, font=font(18), fill=muted)
    draw.text((1310, 37), "TOROBRENT", font=font(19, True), fill=accent)
    for index, (stem, label, description) in enumerate(items):
        x = margin + (index % 2) * (width + gap)
        y = top + (index // 2) * (height + caption + gap)
        draw.rounded_rectangle(
            (x, y, x + width, y + height + caption), radius=14, fill=surface
        )
        draw.text((x + 18, y + 15), stem[:2], font=font(22, True), fill=accent)
        draw.text((x + 64, y + 10), label, font=font(20, True), fill=ink)
        draw.text((x + 64, y + 35), description, font=font(14), fill=muted)
        shot = Image.open(ROOT / "screenshots" / f"{stem}.png").convert("RGB")
        fit = ImageOps.contain(shot, (width, height), Image.Resampling.LANCZOS)
        stage = Image.new("RGB", (width, height), shot.getpixel((0, 0)))
        stage.paste(fit, ((width - fit.width) // 2, (height - fit.height) // 2))
        canvas.paste(stage, (x, y + caption))
    draw.text(
        (32, 1424),
        "LIVE APPLICATION  /  LOCAL DEMO DATA",
        font=font(14, True),
        fill=muted,
    )
    draw.text(
        (1110, 1424),
        "Persian interface · " + ("Light + dark" if dark else "Light theme"),
        font=font(14),
        fill=muted,
    )
    canvas.save(ROOT / filename, "WEBP", quality=91, method=6)


compose(
    "discover.webp",
    "Find your next place.",
    "01—04  /  Discover, explore, inspect, compare",
    [
        ("01-home", "Start with a city", "A Persian-first rental discovery experience"),
        (
            "02-search",
            "Explore Tehran",
            "Live map tiles, clusters, filters and rental offers",
        ),
        (
            "03-property",
            "See the full picture",
            "Property photography and source-specific rental terms",
        ),
        (
            "04-estimator",
            "Compare the monthly cost",
            "An explicit assumption for comparing rent and deposit",
        ),
    ],
)
compose(
    "manage.webp",
    "From proposal to publication.",
    "05—08  /  Submit, review, communicate, curate",
    [
        (
            "05-dashboard",
            "Keep track of your listings",
            "Submission states and a dedicated owner workspace",
        ),
        (
            "06-submission",
            "Review before submitting",
            "A guided seven-step listing workflow",
        ),
        (
            "07-messages",
            "Keep the conversation together",
            "Listing inquiries in the private message center",
        ),
        (
            "08-sources",
            "Put operators in control",
            "Source review, responsibility and publication workflows",
        ),
    ],
    dark=True,
)
