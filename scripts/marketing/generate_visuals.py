"""
MyRX channel visual generator — placeholder assets for launch day.

Generates profile pictures, banners, and first-post images for the 4 Tier 1
channels: LinkedIn, Instagram, YouTube, X.

Brand palette (LOCKED):
    DARK    = "#131A17"
    SURFACE = "#191F1C"
    LIME    = "#CAF240"
    FG      = "#F4F3EF"

Typography target: Geist + Geist Mono. Falls back to system sans-serif when
Geist isn't on disk. Re-run any time as a stand-in until proper Geist
wordmarks and final art land.

Outputs into: docs/marketing/PROFILE_KIT/<channel>/

Voice rules apply to all in-image text.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------------------
# Brand constants
# ---------------------------------------------------------------------------

DARK = "#131A17"
SURFACE = "#191F1C"
LIME = "#CAF240"
FG = "#F4F3EF"

ROOT = Path(__file__).resolve().parents[2]
OUT_ROOT = ROOT / "docs" / "marketing" / "PROFILE_KIT"


# ---------------------------------------------------------------------------
# Font helpers
# ---------------------------------------------------------------------------

FONT_CANDIDATES = (
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def load_font(size: int) -> ImageFont.ImageFont:
    """Return the first available font at the requested size."""
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    """Return (width, height) of text rendered with `font`."""
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    return right - left, bottom - top


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    center_xy: tuple[int, int],
    font: ImageFont.ImageFont,
    fill: str,
) -> None:
    """Draw text centered at center_xy."""
    w, h = text_size(draw, text, font)
    cx, cy = center_xy
    draw.text((cx - w // 2, cy - h // 2), text, fill=fill, font=font)


def wrap_to_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    """Greedy word-wrap to keep each line under max_width."""
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        trial = " ".join(current + [word])
        w, _ = text_size(draw, trial, font)
        if w <= max_width:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines


def draw_wrapped_centered(
    draw: ImageDraw.ImageDraw,
    text: str,
    box: tuple[int, int, int, int],
    font: ImageFont.ImageFont,
    fill: str,
    line_spacing: int = 12,
) -> None:
    """Draw wrapped, vertically + horizontally centered text inside box (l, t, r, b)."""
    l, t, r, b = box
    max_w = r - l
    lines = wrap_to_width(draw, text, font, max_w)
    line_heights = [text_size(draw, ln, font)[1] for ln in lines]
    total_h = sum(line_heights) + line_spacing * max(0, len(lines) - 1)
    start_y = t + (b - t - total_h) // 2
    cx = (l + r) // 2
    y = start_y
    for ln, lh in zip(lines, line_heights):
        w, _ = text_size(draw, ln, font)
        draw.text((cx - w // 2, y), ln, fill=fill, font=font)
        y += lh + line_spacing


# ---------------------------------------------------------------------------
# Asset builders
# ---------------------------------------------------------------------------

def make_profile_picture(size: tuple[int, int], out_path: Path) -> None:
    """Square profile picture — DARK bg, centered LIME 'MyRX' wordmark at ~40% width."""
    w, h = size
    img = Image.new("RGB", size, DARK)
    draw = ImageDraw.Draw(img)

    # Target wordmark ~40% of canvas width
    target_w = int(w * 0.40)
    # Binary-search font size to hit target width
    font_size = max(12, h // 6)
    font = load_font(font_size)
    while True:
        tw, _ = text_size(draw, "MyRX", font)
        if tw >= target_w or font_size > h:
            break
        font_size += 4
        font = load_font(font_size)
    # Step back one if overshot
    while font_size > 12:
        tw, _ = text_size(draw, "MyRX", font)
        if tw <= target_w:
            break
        font_size -= 2
        font = load_font(font_size)

    draw_centered_text(draw, "MyRX", (w // 2, h // 2), font, LIME)
    img.save(out_path, "PNG")


def make_banner(
    size: tuple[int, int],
    out_path: Path,
    safe_zone: tuple[int, int, int, int] | None = None,
    tagline: str = "Performance Lab.",
) -> None:
    """
    Channel banner — DARK bg, LIME 'MyRX' wordmark + FG tagline, thin LIME accent line.

    safe_zone (l, t, r, b) positions the wordmark inside the mobile-safe area.
    When None, centers in the full canvas.
    """
    w, h = size
    img = Image.new("RGB", size, DARK)
    draw = ImageDraw.Draw(img)

    if safe_zone is None:
        safe_zone = (0, 0, w, h)
    sl, st, sr, sb = safe_zone
    sw = sr - sl
    sh = sb - st

    # Wordmark — bold, large, fits in safe zone width
    wordmark_font_size = max(48, sh // 3)
    wordmark_font = load_font(wordmark_font_size)
    # Cap so wordmark fits horizontally
    while True:
        tw, _ = text_size(draw, "MyRX", wordmark_font)
        if tw <= int(sw * 0.55) or wordmark_font_size <= 24:
            break
        wordmark_font_size -= 4
        wordmark_font = load_font(wordmark_font_size)

    # Tagline — smaller, sits below wordmark
    tagline_font_size = max(16, wordmark_font_size // 4)
    tagline_font = load_font(tagline_font_size)
    while True:
        tw, _ = text_size(draw, tagline, tagline_font)
        if tw <= int(sw * 0.55) or tagline_font_size <= 12:
            break
        tagline_font_size -= 2
        tagline_font = load_font(tagline_font_size)

    # Stack vertically in safe zone
    wm_w, wm_h = text_size(draw, "MyRX", wordmark_font)
    tg_w, tg_h = text_size(draw, tagline, tagline_font)
    gap = max(8, wm_h // 6)
    block_h = wm_h + gap + tg_h
    block_top = st + (sh - block_h) // 2
    cx = sl + sw // 2

    draw.text((cx - wm_w // 2, block_top), "MyRX", fill=LIME, font=wordmark_font)
    draw.text(
        (cx - tg_w // 2, block_top + wm_h + gap),
        tagline,
        fill=FG,
        font=tagline_font,
    )

    # Thin LIME accent line — sits 1.5x gap below the tagline, ~30% of safe zone width
    line_y = block_top + wm_h + gap + tg_h + max(6, gap // 2)
    line_w = int(sw * 0.30)
    line_l = cx - line_w // 2
    line_r = cx + line_w // 2
    if line_y < sb - 4:
        draw.rectangle((line_l, line_y, line_r, line_y + 2), fill=LIME)

    img.save(out_path, "PNG")


def make_first_post_image(
    size: tuple[int, int],
    statement: str,
    out_path: Path,
    statement_font_scale: float = 1.0,
) -> None:
    """
    First-post visual — DARK bg, SURFACE card centered, FG statement, lime accent.

    statement_font_scale lets channel callers nudge the size up (YouTube thumbnail
    needs bigger text for mobile readability).
    """
    w, h = size
    img = Image.new("RGB", size, DARK)
    draw = ImageDraw.Draw(img)

    # Card geometry — leave generous breathing room around the edges
    margin_x = int(w * 0.08)
    margin_y = int(h * 0.10)
    card_l, card_t = margin_x, margin_y
    card_r, card_b = w - margin_x, h - margin_y
    draw.rectangle((card_l, card_t, card_r, card_b), fill=SURFACE)

    # LIME accent — short bar at top-left of card
    accent_l = card_l + int((card_r - card_l) * 0.06)
    accent_t = card_t + int((card_b - card_t) * 0.10)
    accent_w = int((card_r - card_l) * 0.10)
    draw.rectangle((accent_l, accent_t, accent_l + accent_w, accent_t + 4), fill=LIME)

    # Statement — wrapped, centered inside the card body
    base_font_size = max(28, int(min(w, h) * 0.05 * statement_font_scale))
    statement_font = load_font(base_font_size)
    # Reserve space for attribution at bottom
    attr_zone_h = int((card_b - card_t) * 0.18)
    statement_box = (
        card_l + int((card_r - card_l) * 0.10),
        card_t + int((card_b - card_t) * 0.20),
        card_r - int((card_r - card_l) * 0.10),
        card_b - attr_zone_h,
    )
    # Auto-shrink if too tall
    while base_font_size > 16:
        lines = wrap_to_width(
            draw, statement, statement_font, statement_box[2] - statement_box[0]
        )
        line_h = text_size(draw, "Ay", statement_font)[1]
        total_h = len(lines) * line_h + (len(lines) - 1) * 12
        if total_h <= statement_box[3] - statement_box[1]:
            break
        base_font_size -= 2
        statement_font = load_font(base_font_size)

    draw_wrapped_centered(draw, statement, statement_box, statement_font, FG)

    # Attribution — bottom-right corner of card
    attr_font_size = max(14, base_font_size // 3)
    attr_font = load_font(attr_font_size)
    attr_text = "MyRX — Performance Lab."
    aw, ah = text_size(draw, attr_text, attr_font)
    attr_x = card_r - int((card_r - card_l) * 0.06) - aw
    attr_y = card_b - int((card_b - card_t) * 0.10) - ah
    draw.text((attr_x, attr_y), attr_text, fill=FG, font=attr_font)

    img.save(out_path, "PNG")


# ---------------------------------------------------------------------------
# Channel manifests
# ---------------------------------------------------------------------------

# Each channel: profile_size, banner_size, banner_safe_zone, first_post_size,
# statement, statement_scale
CHANNELS = {
    "linkedin": {
        "profile_size": (400, 400),
        "banner_size": (1584, 396),
        # Avoid bottom-left 568x264 (profile photo overlay)
        "banner_safe_zone": (640, 60, 1564, 336),
        "first_post_size": (1200, 627),
        "statement": "Coach picks the parameters. The algorithm picks the next step.",
        "statement_scale": 1.0,
    },
    "instagram": {
        "profile_size": (1080, 1080),
        # Instagram has no profile banner; ship a 1080x1920 Story template instead.
        "banner_size": (1080, 1920),
        # Center column, ~250 px clear top + bottom for UI overlays
        "banner_safe_zone": (80, 280, 1000, 1660),
        "first_post_size": (1080, 1350),
        "statement": "We don't write workouts. We oversee progressions.",
        "statement_scale": 1.0,
    },
    "youtube": {
        "profile_size": (800, 800),
        "banner_size": (2560, 1440),
        # TV-safe center 1546x423
        "banner_safe_zone": (507, 508, 2053, 931),
        "first_post_size": (1280, 720),
        "statement": "Performance is a series of next steps.",
        # YouTube thumbnails need to read on a phone — bump statement size.
        "statement_scale": 1.4,
    },
    "x": {
        "profile_size": (400, 400),
        "banner_size": (1500, 500),
        # Avoid bottom-left ~220x220 (profile overlay) and bottom-right ~200x100 (Follow)
        "banner_safe_zone": (260, 40, 1280, 380),
        "first_post_size": (1200, 675),
        "statement": "Algorithm picks the next weight. Coach picks the why.",
        "statement_scale": 1.0,
    },
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def generate() -> list[tuple[str, str, tuple[int, int]]]:
    """
    Generate all 12 PNGs (4 channels × 3 assets). Returns list of
    (channel, asset_name, dimensions) tuples for reporting.
    """
    results: list[tuple[str, str, tuple[int, int]]] = []

    for channel, cfg in CHANNELS.items():
        ch_dir = OUT_ROOT / channel
        ch_dir.mkdir(parents=True, exist_ok=True)

        # Profile picture
        pp_path = ch_dir / "profile_picture.png"
        make_profile_picture(cfg["profile_size"], pp_path)
        results.append((channel, "profile_picture.png", cfg["profile_size"]))

        # Banner
        bn_path = ch_dir / "banner.png"
        make_banner(
            cfg["banner_size"],
            bn_path,
            safe_zone=cfg["banner_safe_zone"],
        )
        results.append((channel, "banner.png", cfg["banner_size"]))

        # First post
        fp_path = ch_dir / "first_post_image.png"
        make_first_post_image(
            cfg["first_post_size"],
            cfg["statement"],
            fp_path,
            statement_font_scale=cfg["statement_scale"],
        )
        results.append((channel, "first_post_image.png", cfg["first_post_size"]))

    return results


if __name__ == "__main__":
    results = generate()
    print(f"Generated {len(results)} PNGs:")
    for channel, asset, (w, h) in results:
        print(f"  {channel:10s} {asset:24s} {w}x{h}")
