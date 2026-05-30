"""
Rebuild MyRX app icon PNGs from the canonical branding source.

SOURCE-OF-TRUTH: branding/Logo/Final/Logo Icon White.png

That file is the brand-approved icon master — a 1070x1070 PNG with the
stacked "My/RX" wordmark sized to ~55% of canvas width, leaving ~25%
margin on every side. That margin is what Android's adaptive-icon system
needs: when a launcher crops the foreground PNG to a circle (showing only
the inner 61% diameter), the wordmark stays fully inside and looks
visually centered with breathing room.

Edits to the brand icon happen in branding/Logo/Final/Logo Icon White.svg
(Inkscape file). When the artwork changes, re-export the PNG to that
folder, then re-run this script.

Generates:
  - icon.png             (1024x1024, iOS + everywhere)
  - adaptive-icon.png    (1024x1024, Android adaptive icon foreground)
  - splash-icon.png      (1024x1024, splash screen)
  - favicon.png          (96x96, web favicon)

Why 1024x1024 (not the source's 1070): Expo's icon pipeline wants
exactly 1024×1024. Downscaling 1070→1024 is a benign 4% resize with
Lanczos resampling — no visible quality loss.

Run: python rebuild-icons.py
"""
from PIL import Image
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
SOURCE = os.path.join(REPO_ROOT, "branding", "Logo", "Final", "Logo Icon White.png")
BACKUP_DIR = os.path.join(HERE, "icon-source-backup")

# What to rebuild. (filename, output dimension).
TARGETS = [
    ("icon.png",          1024),
    ("adaptive-icon.png", 1024),
    ("splash-icon.png",   1024),
    ("favicon.png",       96),
]


def backup_existing():
    """Snapshot whatever's currently on disk so a previous version is
    recoverable. Idempotent — won't overwrite a prior backup."""
    if os.path.isdir(BACKUP_DIR):
        return  # already backed up by a previous run
    os.makedirs(BACKUP_DIR, exist_ok=True)
    for name, _ in TARGETS:
        src = os.path.join(HERE, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(BACKUP_DIR, name))
    print(f"  Backed up existing icons to {BACKUP_DIR}/")


def rebuild_one(name: str, size: int):
    src = Image.open(SOURCE).convert("RGBA")
    resized = src.resize((size, size), Image.LANCZOS)
    out_path = os.path.join(HERE, name)
    resized.save(out_path, "PNG", optimize=True)
    print(f"  OK {name} -- {size}x{size}")


if __name__ == "__main__":
    if not os.path.exists(SOURCE):
        raise SystemExit(
            f"SOURCE missing: {SOURCE}\n"
            f"Re-export 'Logo Icon White.svg' as PNG from Inkscape to that folder."
        )
    print(f"Source: {SOURCE}")
    print()
    backup_existing()
    for name, size in TARGETS:
        rebuild_one(name, size)
    print()
    print("Done. Next:")
    print("  1. cd mobile && npx expo prebuild --platform android")
    print("  2. npx expo run:android")
