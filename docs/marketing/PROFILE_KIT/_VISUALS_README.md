# Channel visuals — placeholder kit

Sized-to-spec PNG stand-ins for launch day across the 4 Tier 1 channels: LinkedIn, Instagram, YouTube, X. Re-generate at any time with the script.

## What's in the kit

12 PNGs total, 3 per channel:

| Channel | Profile picture | Banner / cover | First-post image |
|---|---|---|---|
| LinkedIn (personal) | 400 x 400 | 1584 x 396 | 1200 x 627 |
| Instagram | 1080 x 1080 | 1080 x 1920 (Story template, see note) | 1080 x 1350 |
| YouTube | 800 x 800 | 2560 x 1440 | 1280 x 720 |
| X | 400 x 400 | 1500 x 500 | 1200 x 675 |

All files live under `docs/marketing/PROFILE_KIT/<channel>/` next to the matching `bio.txt`, `link_in_bio.txt`, `first_post_caption.txt`, and channel README.

## Status — these are PLACEHOLDERS

Serviceable for launch-day stand-ins. The wordmark is rendered from a system sans-serif (Arial Bold on Windows, DejaVu Sans Bold on Linux) — close to the Geist look but not the real wordmark. Treat the kit as a working baseline, not the final art.

## Re-generating the kit

```
python scripts/marketing/generate_visuals.py
```

The script regenerates all 12 PNGs in-place. No CLI flags — edit `CHANNELS` at the bottom of `scripts/marketing/generate_visuals.py` to change sizes, statements, or safe zones.

## Brand palette + typography (LOCKED — from CLAUDE.md)

| Token | Hex |
|---|---|
| DARK | `#131A17` |
| SURFACE | `#191F1C` |
| LIME | `#CAF240` |
| FG | `#F4F3EF` |

Typography target: Geist (sans) for everything, Geist Mono for numbers. Lucide for icons. Tagline locked as "Performance Lab." with the trailing period.

## What to upgrade for final assets

Each item below moves the kit from "placeholder" to "ship-quality":

1. **Real Geist wordmark.** Drop the actual Geist font into `assets/fonts/` and update `FONT_CANDIDATES` in the script to load it first. The wordmark sits at ~40% canvas width on profile pictures.
2. **Photography or illustration layer.** Banners and first-post visuals are currently flat-color cards. Final art benefits from athlete photography, screen captures of the next-step UI, or vector illustration of the coaching loop (algorithm picks → coach oversees → athlete trains).
3. **Motion variants for Reels and Shorts.** Generate matching 9:16 video at 1080 x 1920 / MP4 / H.264 — same color palette, same statement, but with the wordmark animating in and the statement type-on. The script doesn't cover motion; treat it as a separate Premiere or After Effects pass.
4. **Per-channel statement A/B variants.** The current statements come from the brief. Once analytics land, swap in winners.
5. **Dark-mode profile contrast pass.** The LinkedIn 400 x 400 profile photo renders small on mobile (110 x 110 effective). The LIME wordmark holds up at that size in the placeholder, but a tighter custom mark — initials or a glyph — reads better than a four-character wordmark.

## Per-channel notes

### Instagram banner is a Story template, not a profile banner

Instagram profiles do not have header banners — profile photo and bio only. The `banner.png` in `instagram/` is a 1080 x 1920 Story-ready template using the same brand chrome, so the kit's "banner" slot stays consistent across channels. Use it as the day-one Story background; replace with day-of content thereafter.

### YouTube thumbnail readability

YouTube thumbnails get judged at phone-size first. The script bumps the first-post statement font scale to 1.4 on YouTube so the text reads at the typical mobile preview size (~210 x 118 pixels in a YouTube list view). When swapping in real thumbnails:

- Keep the headline statement to under 5 words for mobile legibility.
- High contrast wins — LIME on DARK is on-brand and high-contrast.
- Leave the bottom-right ~120 x 60 px clear so the duration badge doesn't overlay text.
- Center text within the 1546 x 423 TV-safe zone for channel banners so it survives the desktop / mobile crops.

### LinkedIn safe zones

The personal-banner safe zone avoids the bottom-left 568 x 264 area where the profile photo overlays. The script positions the wordmark + tagline block inside the right-of-center safe zone so neither gets clipped behind the avatar at any viewport.

### X safe zones

The X banner avoids two overlays: the bottom-left ~220 x 220 (profile photo) and the bottom-right ~200 x 100 (Follow button on mobile). The wordmark block is centered within the surviving area.

## Voice rules applied to in-image text

All in-image statements pass the seven-rule check from CLAUDE.md:

- LinkedIn: "Coach picks the parameters. The algorithm picks the next step." — names the operating model directly, no marketing hedge.
- Instagram: "We don't write workouts. We oversee progressions." — positions against the loud-RP and ops-Trainerize voices.
- YouTube: "Performance is a series of next steps." — restates the next-step thesis as the channel's editorial frame.
- X: "Algorithm picks the next weight. Coach picks the why." — fits the platform's terse cadence.

No banned phrases. No exclamation points. Brand mid-sentence on every in-image line.

## Script reference

`scripts/marketing/generate_visuals.py` — single file, ~300 lines, no external dependencies beyond Pillow 11.2.1 (confirmed working as of 2026-05-29). Re-run any time the spec changes.
