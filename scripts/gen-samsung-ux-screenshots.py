"""Combine the 4 Samsung UX screenshot JPGs into a single PDF.

Order tells the narrative Samsung's reviewer wants to see:
  1. Connect tab        - entry point, integration row in MyRX
  2. HC consent dialog  - provider's native consent UI, per-data-type
  3. Cardio index       - data captured from connected sources
  4. Running detail     - MyRX turns data into a personalized prescription

Output: docs/integrations/samsung-ux-screenshots.pdf
"""

import os
from PIL import Image


SRC_DIR = r"C:\Users\motaz\OneDrive\Desktop\MyRX\photos"
OUT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "docs", "integrations",
                 "samsung-ux-screenshots.pdf")
)
os.makedirs(os.path.dirname(OUT), exist_ok=True)


# Order matters — this is the narrative for Samsung's reviewer.
ORDERED_FILES = [
    "Connect tab.jpg",
    "HC consent dialog.jpg",
    "Cardio index.jpg",
    "Running detail page.jpg",
]


def build():
    pages = []
    for name in ORDERED_FILES:
        path = os.path.join(SRC_DIR, name)
        if not os.path.exists(path):
            raise FileNotFoundError(f"missing: {path}")
        img = Image.open(path)
        # Ensure RGB (JPG is RGB, but be defensive in case of any with alpha).
        if img.mode != "RGB":
            img = img.convert("RGB")
        pages.append(img)
        print(f"  loaded {name}  ({img.width}x{img.height})")

    first = pages[0]
    rest = pages[1:]

    first.save(
        OUT,
        format="PDF",
        save_all=True,
        append_images=rest,
        resolution=144.0,  # decent print quality without bloating file size
    )
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
