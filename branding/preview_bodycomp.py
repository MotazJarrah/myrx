"""
preview_bodycomp.py — composite the 6 extracted silhouettes onto a
dark canvas with labels so the user can actually see and approve them
(the PNGs themselves are white-on-transparent which is invisible
against a white preview backdrop).
"""

from PIL import Image, ImageDraw, ImageFont
import os

ASSETS = r'C:\Users\motaz\OneDrive\Desktop\MyRX\mobile\assets\bodycomp'
OUT    = r'C:\Users\motaz\OneDrive\Desktop\MyRX\branding\bodycomp_preview.png'

CELLS = [
    ('male',   'high'),   ('male',   'average'),   ('male',   'lean'),
    ('female', 'high'),   ('female', 'average'),   ('female', 'lean'),
]

# Canvas — 3 cols × 2 rows, each cell 220 wide × 240 tall
COL_W, ROW_H = 220, 240
PAD = 16
W = COL_W * 3
H = ROW_H * 2 + 40  # extra header strip at top

canvas = Image.new('RGBA', (W, H), (24, 26, 33, 255))  # dark slate, matches app card bg
draw = ImageDraw.Draw(canvas)
try:
    font_label = ImageFont.truetype('arial.ttf', 14)
    font_title = ImageFont.truetype('arial.ttf', 16)
except Exception:
    font_label = ImageFont.load_default()
    font_title = ImageFont.load_default()

draw.text((PAD, 8), 'BodyComp silhouettes — extracted from bfp.jpg', font=font_title, fill='white')

for i, (gender, band) in enumerate(CELLS):
    col = i % 3
    row = i // 3
    x0 = col * COL_W
    y0 = 40 + row * ROW_H
    # Stroke a light divider so cells separate visually
    draw.rectangle([x0, y0, x0 + COL_W, y0 + ROW_H], outline=(60, 65, 80, 255), width=1)
    # Load silhouette + scale to fit cell minus padding + label space
    sil_path = os.path.join(ASSETS, f'{gender}-{band}.png')
    sil = Image.open(sil_path).convert('RGBA')
    # Available silhouette area inside cell
    avail_w = COL_W - PAD * 2
    avail_h = ROW_H - PAD * 2 - 28   # 28 = label height
    # Scale preserving aspect ratio
    sw, sh = sil.size
    scale = min(avail_w / sw, avail_h / sh)
    new_w, new_h = int(sw * scale), int(sh * scale)
    sil = sil.resize((new_w, new_h), Image.LANCZOS)
    # Center horizontally, top-align vertically with padding
    paste_x = x0 + (COL_W - new_w) // 2
    paste_y = y0 + PAD
    canvas.alpha_composite(sil, (paste_x, paste_y))
    # Label centered at the bottom of the cell
    label = f'{gender}  ·  {band.upper()}'
    bbox = draw.textbbox((0, 0), label, font=font_label)
    text_w = bbox[2] - bbox[0]
    draw.text((x0 + (COL_W - text_w) // 2, y0 + ROW_H - 24),
              label, font=font_label, fill=(220, 230, 255))

canvas.save(OUT, 'PNG')
print(f'Preview saved to {OUT}')
print(f'Canvas size: {canvas.size}')
