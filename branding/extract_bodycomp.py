"""
extract_bodycomp.py — split bfp.jpg into 6 silhouette PNGs and convert
them to white-on-transparent so the React Native picker can recolor
via Image.tintColor (idle = muted, active = primary green).

Source layout: 707×360 image, two rows × four columns.
  Row 0 (males,   y 0–180)
  Row 1 (females, y 180–360)

We keep positions 1 (high), 2 (average), 4 (lean) from each row —
skipping position 3 (too close visually to 4 + the female #3 has a
one-piece outfit that breaks consistency).

Output: PNGs in mobile/assets/bodycomp/. Each cell tightly cropped to
the silhouette's bounding box so the picker can scale them
consistently without wasted whitespace.
"""

from PIL import Image
import os
from collections import deque

SRC = r'C:\Users\motaz\OneDrive\Desktop\MyRX\branding\bfp.jpg'
OUT = r'C:\Users\motaz\OneDrive\Desktop\MyRX\mobile\assets\bodycomp'
os.makedirs(OUT, exist_ok=True)

# Pixel boundaries based on 707×360 source. Each silhouette gets a
# full cell crop first, then we auto-tighten to the dark-pixel
# bounding box so each output is just the silhouette, no padding.
ROW_H = 180
COL_W = 707 // 4  # 176

# Upscale factor — the source PNGs are only ~150 px wide per silhouette,
# which pixelates badly when displayed at picker size. Upscale BEFORE
# the luminance→alpha conversion using LANCZOS so the smooth interpolated
# edges become semi-transparent pixels in the output, eliminating
# jaggies. 4× = ~600 px tall, plenty for a Retina-density picker tile.
UPSCALE = 4

# Which cells to extract: (gender, band, row, col_index)
CELLS = [
    ('male',   'high',    0, 0),
    ('male',   'average', 0, 1),
    ('male',   'lean',    0, 3),
    ('female', 'high',    1, 0),
    ('female', 'average', 1, 1),
    ('female', 'lean',    1, 3),
]


def extract_cell(src_img: Image.Image, row: int, col: int) -> Image.Image:
    """Crop a cell, upscale it with smooth resampling, then convert
    pixel darkness → alpha so the line's natural anti-aliasing carries
    through. Output is white-on-transparent, edges smooth instead of
    binary-jagged."""
    x0 = col * COL_W
    y0 = row * ROW_H
    x1 = x0 + COL_W
    y1 = y0 + ROW_H

    # Per-column left-margin trim: col 3 (LEAN) sits next to the skipped
    # athletic silhouette (col 2) whose right edge bleeds slightly into
    # col 3's left margin. Trim 14 px off col 3's left to clip the
    # bleed — silhouettes themselves are roughly centered in their cell
    # so we don't lose any real content. CC blob-filtering can't catch
    # this because the bleed is connected to the main silhouette via
    # the anti-aliased halo, so it all reads as one blob.
    if col == 3:
        x0 += 14

    cell = src_img.crop((x0, y0, x1, y1))

    # Upscale with LANCZOS BEFORE the luminance→alpha conversion. This
    # is the key smoothness step: enlarging the source first means the
    # interpolated edge pixels carry mid-grey values which then become
    # the semi-transparent halo around our line, instead of staircase
    # pixels at the original resolution.
    new_size = (cell.size[0] * UPSCALE, cell.size[1] * UPSCALE)
    cell = cell.resize(new_size, Image.LANCZOS).convert('RGBA')

    # Luminance-to-alpha: darker pixels = more opaque, lighter = more
    # transparent. Preserves the source line's natural anti-aliasing
    # instead of throwing it away with a hard threshold.
    #   white background (255,255,255) → alpha 0
    #   black line      (0,0,0)         → alpha 255
    #   edge anti-alias (128,128,128)   → alpha 127
    # All output pixels are the same color (white) so RN's `tintColor`
    # can recolor cleanly to the brand green on selection.
    pixels = cell.load()
    w, h = cell.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = pixels[x, y]
            # Perceptual luminance (close enough — silhouette is grayscale)
            brightness = (r + g + b) // 3
            # Invert: light bg = 0 alpha, dark line = high alpha
            alpha = 255 - brightness
            pixels[x, y] = (255, 255, 255, alpha)

    # Strip neighbour-cell bleed: drop any connected blob smaller than
    # 1% of the largest blob's size. Single stray bleed lines from the
    # adjacent skipped silhouette get filtered while multi-part real
    # silhouettes (female outlines split across body+breast+navel) stay
    # intact. See _strip_small_components for the rationale.
    cell = _strip_small_components(cell, min_fraction=0.01)

    # Tighten crop to non-transparent bounding box
    bbox = cell.getbbox()
    if bbox:
        cell = cell.crop(bbox)
    return cell


def _strip_small_components(
    img: Image.Image,
    min_fraction: float = 0.01,
    alpha_threshold: int = 8,
) -> Image.Image:
    """Find every connected blob of opaque-ish pixels (alpha > threshold)
    via 4-way BFS. Drop any blob smaller than `min_fraction × largest`
    — that's the bleed-line filter. Anything large enough to be a real
    part of the silhouette is kept.
      • Male silhouettes tend to be a single big connected outline.
      • Female silhouettes are drawn as multiple disconnected parts
        (body outline, breast curves, navel, hip-line) so a strict
        "keep largest only" would clip them. The fraction threshold
        keeps multi-part silhouettes intact while killing single
        stray bleed strokes (typically <1% of the main silhouette)."""
    pixels = img.load()
    w, h = img.size

    comp = [[0] * w for _ in range(h)]
    sizes: list[int] = [0]
    next_id = 1

    for y in range(h):
        for x in range(w):
            if comp[y][x] != 0:
                continue
            _, _, _, a = pixels[x, y]
            if a <= alpha_threshold:
                continue
            size = 0
            q: deque = deque()
            q.append((x, y))
            comp[y][x] = next_id
            while q:
                cx, cy = q.popleft()
                size += 1
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and comp[ny][nx] == 0:
                        _, _, _, na = pixels[nx, ny]
                        if na > alpha_threshold:
                            comp[ny][nx] = next_id
                            q.append((nx, ny))
            sizes.append(size)
            next_id += 1

    if next_id == 1:
        return img

    largest = max(sizes[1:])
    min_size = int(largest * min_fraction)

    for y in range(h):
        for x in range(w):
            cid = comp[y][x]
            if cid != 0 and sizes[cid] < min_size:
                pixels[x, y] = (255, 255, 255, 0)
    return img


def main():
    src = Image.open(SRC)
    for gender, band, row, col in CELLS:
        out_img = extract_cell(src, row, col)
        out_path = os.path.join(OUT, f'{gender}-{band}.png')
        out_img.save(out_path, 'PNG')
        print(f'  {out_path}  ({out_img.size[0]}×{out_img.size[1]})')


if __name__ == '__main__':
    main()
