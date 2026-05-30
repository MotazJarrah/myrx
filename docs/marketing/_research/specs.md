# Platform Spec Sheets — Current 2026

Authoritative reference for profile photos, banners, bios, post formats, and vertical video dimensions across nine major social platforms. Values reflect platform documentation and 2026-current third-party guides (Hootsuite May 2026, Sprout Social, Buffer, Later, Postfa.st March/April 2026).

All pixel dimensions are ready for Pillow ingestion: `Image.new('RGB', (width, height))`.

---

## 1. Instagram

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Profile picture (upload) | 1080 x 1080 | 1:1 | JPG, PNG | — | Center circle | Displays 110x110 mobile / 320x320 stored. Circular crop. |
| Feed post — square | 1080 x 1080 | 1:1 | JPG, PNG | 30 MB | Full | Legacy default. |
| Feed post — portrait | 1080 x 1350 | 4:5 | JPG, PNG | 30 MB | Full | **Best performer 2026.** |
| Feed post — tall | 1080 x 1440 | 3:4 | JPG, PNG | 30 MB | Full | Matches new 3:4 grid preview (Jan 2026 change). |
| Feed post — landscape | 1080 x 566 | 1.91:1 | JPG, PNG | 30 MB | Full | Lowest engagement. |
| Stories | 1080 x 1920 | 9:16 | JPG, PNG, MP4 | 30 MB image / 4 GB video | Center, keep ~250 px top/bottom clear for UI overlays | UI elements overlay top + bottom strips. |
| Reels | 1080 x 1920 | 9:16 | MP4, MOV | 4 GB | Center; bottom ~250 px reserved for caption + icons | Max 90 sec or 3 min depending on entry. |
| Bio character limit | 150 chars | — | — | — | — | Emojis count as 2. Spaces + line breaks count. |
| Link in bio | 1 link | — | — | — | — | Native single link; users add third-party (Linktree, Stan) for multi-link. |
| Username | 30 chars | — | — | — | — | — |

---

## 2. TikTok

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Profile picture (upload) | 720 x 720 | 1:1 | JPG, PNG | 10 MB | Center circle | Displays 200x200 circular. |
| Video (standard) | 1080 x 1920 | 9:16 | MP4, MOV | 287 MB mobile / 4 GB desktop | Center; ~150 px top + ~480 px bottom reserved for UI (caption, icons, profile) | Other ratios get black bars. |
| Video cover / thumbnail | 1080 x 1920 | 9:16 | JPG, PNG | — | Match full vertical frame | — |
| Photo Mode carousel | 1080 x 1920 | 9:16 | JPG, PNG | — | Center | Up to 35 photos per post. |
| Bio character limit | 80 chars | — | — | — | — | — |
| Link in bio | 1 link | — | — | — | — | Available on Business accounts only. Personal accounts: no clickable bio link. |
| Username | 24 chars | — | — | — | — | — |
| **No banner/cover** | — | — | — | — | — | TikTok profiles have no header banner — profile photo + bio only. |

---

## 3. YouTube

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Profile picture (upload) | 800 x 800 | 1:1 | JPG, PNG, GIF | 4 MB | Center circle | Displays circular. |
| Channel banner (channel art) | 2560 x 1440 | 16:9 | JPG, PNG | 6 MB | **1546 x 423 center** (TV-safe) | Mobile shows 1546x423 / Desktop 2560x423 / TV full 2560x1440. |
| Video thumbnail | 1280 x 720 | 16:9 | JPG, PNG, GIF | 2 MB | Center, leave bottom-right clear (duration badge) | Required for custom thumbnails. |
| Standard video (horizontal) | 1920 x 1080 | 16:9 | MP4, MOV | 256 GB | Full | 1080p baseline; 4K supported. |
| Shorts (vertical) | 1080 x 1920 | 9:16 | MP4 | — | Center; ~250 px top + ~440 px bottom reserved for caption + UI | Max 3 min (raised Oct 2024). |
| Channel description | 1,000 chars | — | — | — | — | Visible on About tab. |
| Channel name | 100 chars | — | — | — | — | — |

---

## 4. LinkedIn — Personal Profile

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Profile picture | 400 x 400 (min) – 8000 x 8000 (max) | 1:1 | JPG, PNG, GIF (animated) | 8 MB | Center circle | Recommended: 1200 x 1200. Circular crop. |
| Profile banner | 1584 x 396 | 4:1 | JPG, PNG, GIF (animated) | 8 MB | Avoid **bottom-left 568 x 264** (covered by profile photo) | Same dimensions on mobile + desktop. |
| Headline | 220 chars | — | — | — | — | Visible everywhere your name appears. |
| About section | 2,600 chars | — | — | — | — | Only first ~300 visible desktop / ~200 mobile before "See more". |
| Featured post image | 1200 x 627 | 1.91:1 | JPG, PNG | — | Center | Link preview standard. |
| Feed post image | 1200 x 1200 | 1:1 | JPG, PNG | — | Center | 4:5 (1200 x 1500) also performs well. |
| Native video | 1920 x 1080 (landscape) / 1080 x 1920 (vertical) | 16:9 or 9:16 | MP4 | 5 GB | Center | Vertical preferred for mobile feed. |

---

## 5. LinkedIn — Company Page

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Page logo | 400 x 400 | 1:1 | PNG, JPEG | 4 MB | Center | Displayed as square (no circular crop on company pages). |
| Cover image | 1128 x 191 | ~6:1 | PNG, JPEG | 3 MB | Center, avoid bottom-left where logo overlays | Much wider/shorter than personal banner. |
| Tagline | 120 chars | — | — | — | — | Appears under company name. |
| About / Overview | 2,000 chars | — | — | — | — | — |
| Hero image (Life tab) | 1128 x 376 | 3:1 | PNG, JPEG | 2 MB | Center | — |
| Feed post image | 1200 x 627 | 1.91:1 | JPG, PNG | — | Center | Same as personal feed. |

---

## 6. X (Twitter)

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Profile picture | 400 x 400 | 1:1 | JPG, PNG, GIF | 2 MB | Center circle | Min 200 x 200. Circular crop. |
| Header / banner | 1500 x 500 | 3:1 | JPG, PNG | 5 MB | Avoid **bottom-left ~220 x 220** (profile photo overlay) and **bottom-right ~200 x 100** mobile (Follow button) | Animated GIFs no longer animate in headers (since Aug 2024). |
| Bio | 160 chars | — | — | — | — | — |
| Display name | 50 chars | — | — | — | — | — |
| Username (@) | 15 chars | — | — | — | — | — |
| Single-image post | 1600 x 900 | 16:9 | JPG, PNG, WEBP | 5 MB | Center | 1:1 (1080 x 1080) also strong. |
| Vertical-image post | 1080 x 1350 | 4:5 | JPG, PNG | 5 MB | Center | Mobile-first 2026. |
| Video post | 1920 x 1080 (16:9) / 1080 x 1920 (9:16) | 16:9 / 9:16 | MP4, MOV | 512 MB (free) / 8 GB (Premium) | Center | Up to 2:20 free / 4 hr Premium. |
| Link in bio | 1 clickable link | — | — | — | — | Native single link. |

---

## 7. Threads

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Profile picture (upload) | 1080 x 1080 | 1:1 | JPG, PNG | — | Center circle | **Synced from Instagram.** Min 320 x 320. Circular crop. |
| Bio | 150 chars | — | — | — | — | **Synced from Instagram.** Cannot set separately. |
| Username | Synced from IG (30 chars) | — | — | — | — | — |
| Post — square | 1080 x 1080 | 1:1 | JPG, PNG | — | Full | — |
| Post — portrait | 1080 x 1350 | 4:5 | JPG, PNG | — | Full | Best for feed. |
| Post — landscape | 1080 x 566 | 1.91:1 | JPG, PNG | — | Full | — |
| Video | 1080 x 1920 (9:16) or 1080 x 1080 (1:1) | 9:16 or 1:1 | MP4 | — | Center | Max 5 min. |
| Post character limit | 500 chars | — | — | — | — | — |
| Link in bio | 1 link | — | — | — | — | Single clickable link (synced from IG). |
| **No banner/cover** | — | — | — | — | — | Profile photo + bio only. |

---

## 8. Facebook — Business Page

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Profile picture | 2048 x 2048 (max) / 180 x 180 (min) | 1:1 | JPG, PNG | — | Center circle | Displays 176x176 desktop / 196x196 mobile. Circular crop. |
| Cover photo | 820 x 312 (desktop) / 640 x 360 (mobile) | ~16:9 | JPG, PNG | 100 KB recommended | Design at **820 x 360 safe zone**; left ~170 px covered by profile photo on desktop | Upload 1640 x 720 (2x) for retina. |
| Page bio (short) | 101 chars | — | — | — | — | New mobile bio field. |
| About / story | 50,000 chars | — | — | — | — | Full-length About tab. |
| Page name | 75 chars | — | — | — | — | — |
| Single-image post | 1200 x 630 | 1.91:1 | JPG, PNG | — | Center | Link previews use this ratio. |
| Vertical post | 1080 x 1350 | 4:5 | JPG, PNG | — | Center | Mobile feed default. |
| Stories | 1080 x 1920 | 9:16 | JPG, PNG, MP4 | — | Center, ~250 px top/bottom UI | — |
| Reels | 1080 x 1920 | 9:16 | MP4 | 4 GB | Center | Up to 90 sec. |
| Video (in-feed) | 1280 x 720 | 16:9 | MP4 | 4 GB | Center | — |

---

## 9. Reddit

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Avatar (profile picture) | 256 x 256 (safe) / 512 x 512 (sharp) | 1:1 | PNG, JPG | 500 KB | Center circle | PNG preferred (no compression artifacts). |
| Profile banner | 1920 x 384 | 5:1 | PNG, JPG | 500 KB | Center | Legacy 1000 x 300 (10:3) still supported. |
| Subreddit banner | 1920 x 384 | 5:1 | PNG, JPG | 500 KB | Center | Mobile crops top + bottom. |
| Subreddit icon | 256 x 256 | 1:1 | PNG, JPG | 500 KB | Center circle | — |
| Bio (profile description) | 200 chars | — | — | — | — | — |
| Display name | 30 chars | — | — | — | — | — |
| Post — image | 1200 x 1200 (square) or 1080 x 1350 (portrait) | 1:1 or 4:5 | PNG, JPG, GIF | 20 MB | Center | — |
| Post — video | 1080 x 1920 (vertical) / 1920 x 1080 (horizontal) | 9:16 or 16:9 | MP4, MOV | 1 GB | Center | Max 15 min. |
| Post title | 300 chars | — | — | — | — | — |
| Post body | 40,000 chars | — | — | — | — | — |
| Link in bio | 1 link via Social Links (5 total) | — | — | — | — | 5 social links allowed in profile. |

---

## 10. Pinterest

| Asset | Dimensions (px) | Aspect | Format | Max Size | Safe Zone | Notes |
|---|---|---|---|---|---|---|
| Profile picture | 165 x 165 (min) / 800 x 800 (rec) | 1:1 | JPG, PNG | 10 MB | Center circle | Circular crop. |
| Profile banner | 1200 x 600 | 2:1 | JPG, PNG | — | **Center 800 x 400** desktop / **400 x 200** mobile | Mobile scales to 600 x 300. Static only (no animation). |
| Profile name | 65 chars | — | — | — | — | Recently raised from 30. |
| Username | 30 chars | — | — | — | — | — |
| Bio | 500 chars | — | — | — | — | Recently raised from 160. |
| Standard Pin | 1000 x 1500 | 2:3 | JPG, PNG | 20 MB | Center, avoid bottom for logo overlay on Idea Pins | Best-performing Pin format. |
| Square Pin | 1000 x 1000 | 1:1 | JPG, PNG | 20 MB | Center | — |
| Long Pin | 1000 x 2100 | ~1:2.1 | JPG, PNG | 20 MB | Center | Tall infographic format. |
| Idea Pin / Video Pin | 1080 x 1920 | 9:16 | MP4, MOV | 100 MB image / 2 GB video | Center; ~270 px top + ~415 px bottom reserved for UI | Multi-page story format. |
| Board cover | 600 x 600 | 1:1 | JPG, PNG | — | Center | — |
| Link in bio | 1 website link in profile | — | — | — | — | Plus every Pin can have its own destination URL. |

---

## Quick reference: vertical-video universal export

A single 9:16 master at **1080 x 1920 / MP4 / H.264** uploads cleanly to:
- Instagram Reels + Stories
- TikTok
- YouTube Shorts
- Facebook Reels + Stories
- Pinterest Idea Pins
- Threads video posts
- LinkedIn vertical video
- X vertical video

Build with the **center column (272 px – 808 px horizontally)** as the universal-safe zone for text and logos, and keep ~250 px clear at the top and ~440 px clear at the bottom to dodge UI overlays across all platforms.

---

## Sources
- [Social media image sizes for all networks — Hootsuite (May 2026)](https://blog.hootsuite.com/social-media-image-sizes-guide/)
- [Social Media Image Sizes — Sprout Social (2026)](https://sproutsocial.com/insights/social-media-image-sizes-guide/)
- [Social Media Image Sizes — Buffer (2026)](https://buffer.com/resources/social-media-image-sizes/)
- [Instagram Post Size Guide 2026 — Buffer](https://buffer.com/resources/instagram-image-size/)
- [Instagram Profile Picture March 2026 — Postfa.st](https://postfa.st/sizes/instagram/profile)
- [Instagram Character Limits 2026](https://howmanywords.app/blog/instagram-character-limits)
- [TikTok Profile Picture Size 2026 — Postfa.st](https://postfa.st/sizes/tiktok/profile)
- [TikTok Image & Video Sizes 2026](https://imageforpost.com/guides/tiktok-image-sizes-dimensions-guide-2026)
- [YouTube Banner Size 2026 — Postfa.st](https://postfa.st/sizes/youtube/banner)
- [YouTube Banner Size & Best Practices 2026 — Snappa](https://snappa.com/blog/youtube-channel-art-size/)
- [YouTube Shorts Size 2026 — vidIQ](https://vidiq.com/blog/post/youtube-shorts-vertical-video/)
- [LinkedIn Cover Photo March 2026 — Postfa.st](https://postfa.st/sizes/linkedin/cover)
- [LinkedIn Image Specifications — LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a563309/image-specifications-for-your-linkedin-pages-and-career-pages)
- [LinkedIn Character Limit 2026 — Konnector](https://konnector.ai/linkedin-character-limit/)
- [X (Twitter) Header Size March 2026 — Postfa.st](https://postfa.st/sizes/x/header)
- [X (Twitter) Image Sizes 2026 — Linearity](https://www.linearity.io/blog/x-twitter-size-guide/)
- [X (Twitter) Header Size — Snappa](https://snappa.com/blog/twitter-header-size/)
- [Threads Character Limits Guide 2026](https://typecount.com/blog/threads-character-limit)
- [Threads Image Sizes 2026](https://imageforpost.com/guides/threads-image-sizes-dimensions-guide-2026)
- [Facebook Cover Photo April 2026 — Postfa.st](https://postfa.st/sizes/facebook/cover)
- [Facebook Page Profile & Cover Dimensions — Facebook Help](https://www.facebook.com/help/125379114252045)
- [Reddit Image Sizes 2026 — SocialEz](https://www.socialez.com/blog/reddit-image-sizes/)
- [Reddit Banner Size — Snappa](https://snappa.com/blog/reddit-banner-size/)
- [Pinterest Character Limits 2026 — SocialRails](https://socialrails.com/blog/pinterest-character-limits-guide)
- [Pinterest Banner Size Guide 2026 — SocialRails](https://socialrails.com/blog/pinterest-banner-size-guide)
- [Pinterest Ad Specs — Pinterest Business Help](https://help.pinterest.com/en/business/article/pinterest-product-specs)
