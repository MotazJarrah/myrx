# Instagram profile kit — @teammyrx

The brand-led account. Athletes are the primary B2C audience; coaches
researching the product after seeing the founder on LinkedIn are
secondary. The voice runs the seven rules without exception.

## Account format

Brand-led. The platform is the protagonist; the founder appears in
some Reels and Stories but isn't the face on the grid. This mirrors
the Trainerize playbook — the product sells the experience, the
founder appears as the credibility layer.

The handle `@teammyrx` is the primary. `@myrxfit` is unavailable
(RxFit competitor holds it on IG, LinkedIn, Pinterest). `@myrxapp` is
the fallback if `@teammyrx` is ever lost.

## Assets

### Profile picture
- **File**: `profile_picture.png`
- **Dimensions**: 1080 × 1080 px (1:1)
- **Format**: PNG (preserves the lime against dark for crisp circle crop)
- **Displays**: 110 × 110 mobile, 320 × 320 stored
- **Crop**: Circular — center the wordmark or logo mark
- **Recommendation**: Use the wordmark-only no-slogan variant (logo mark
  alone reads small at 110 × 110). Background: brand DARK `#131A17`.
  Mark: brand LIME `#CAF240`.

### Banner / cover
Instagram does NOT have a profile banner. The visual identity above
the grid comes from:
- The profile picture (circular, 110 × 110 mobile).
- The bio text (150 chars).
- The link in bio.
- The first 6-9 grid posts (the "first impression" surface).

There is no `banner.png` to create for Instagram. If the brand has a
banner asset from LinkedIn or YouTube, repurpose it as a Story
highlight cover instead.

### First post image
- **File**: `first_post_image.png`
- **Dimensions**: 1080 × 1350 px (4:5 portrait)
- **Format**: PNG or JPG (PNG for type-heavy slides, JPG for photo slides)
- **Why 4:5**: Best-performing feed format in 2026. Takes the most
  vertical space on mobile feeds without tripping the 3:4 grid crop.
- **Carousel**: 6 slides total. See `first_post_caption.txt` for the
  full slide outline.

## Bio character count

- **Used**: 117 chars
- **Limit**: 150 chars (Instagram-enforced)
- **Headroom**: 33 chars (room to test emoji variants — emojis count as 2)

Current bio:
```
Performance Lab. The algorithm picks your next weight, pace, and macro. Your coach oversees. You train the next step.
```

## Hashtag strategy

Instagram capped hashtags at **5 per post or Reel** in December 2025.
Anything above 5 is ignored or de-ranked. The cap is platform-enforced.

The 4-slot formula used on every MyRX post:

1. **1 niche broad** — `#strengthcoach` OR `#hybridathlete` OR `#endurancecoach`
2. **1-2 exact-topic** — matches the specific post subject
   (`#zone2training`, `#progressiveoverload`, `#rpe9`, `#csscalculator`)
3. **1 audience** — who the post is for
   (`#femaleathlete`, `#mastersrunner`, `#tactical-fitness`)
4. **1 brand** — `#myrxfit` (always; brand tag compounds over years)

**Banned tags** (zero ranking signal in 2026, crowd out the niche
tags that DO carry signal):
- `#fyp`, `#foryou`, `#viral`
- `#fitness`, `#gym`, `#workout`
- `#fitfam`, `#fitnessmotivation`
- Any tag above ~500K posts

Sweet spot: 10K-500K posts per tag. Below 10K nobody searches; above
500K the post drowns.

## Alt text — non-negotiable

Alt text is a ranking signal in 2026, not just accessibility chrome.
Every Instagram post gets alt text that names:
- The subject (who or what is shown)
- The action (what's happening)
- The keyword (what the post is teaching)

Example:
> "Black-and-lime headline graphic explaining how the MyRX algorithm
> prescribes the next training weight from logged set data, alongside
> a coach overseeing the prescription on the platform dashboard."

Skipping alt text = depriving the algorithm of structured signal =
measurable reach drop.

## Posting cadence

3 Reels + 2 carousels per week. ~5 posts per week.

- **Reels**: Tue / Wed / Thu, 6-9 PM (post-work peak for fitness).
- **Carousels**: Paired with Reels — same week, 24-48 hours apart so
  the content series reinforces.
- **Stories**: Daily when active. Mirror coach-facing carousel slides
  to Stories as quick reference cards.

Best times overall: weekday 6-8 AM (pre-workout planning) and 5-7 PM
(post-work). Tue / Wed strongest for the health-conscious audience.

Weekends: 8-10 AM and 4-6 PM if posting at all.

## Algorithm signals that actually move reach

In rank order — optimize for the top of the list, not the bottom:

1. **Sends per reach** — the #1 signal. Content that gets sent to a
   friend spreads to Explore. Every post should be a thing a coach
   would send to another coach, or an athlete would send to a training
   partner. The headline alone should do the explaining.
2. **Watch time** (Reels) — first 3 seconds are decisive.
3. **Likes per reach** — secondary but still weighted.
4. **Saves** — strong for carousels that read as reference material.
5. **Comments** — quality > quantity. One coach reply with a follow-up
   question beats 20 fire emojis.

## What makes the voice land on Instagram specifically

Three things, in order:

### 1. Hook in the first line
Instagram cuts captions at ~125 characters before the "more" link
appears. The primary keyword AND the contrarian framing have to land
before that cutoff. The launch caption opens with "Most fitness apps
log what you already did. MyRX picks what you do next." — 78 chars,
keyword in the first 8 words, the gap named immediately.

### 2. Carousel structure carries the 3-pillar voice natively
Slide 1 acknowledges state. Slides 2-4 explain mechanism. Slides
5-6 name the next step. The format IS the voice. Don't try to
collapse the 3 pillars into a single Reel — let the carousel do the
heavy lifting and let the Reel handle hook + tease.

### 3. Sends are the spread mechanism
Write every caption like it's about to be shared in a coach DM with no
context. The opening sentence has to stand alone as the entire
explanation of what the post is about. If it doesn't, the post won't
get sent, and sends are the only way the algorithm spreads it past
the first ring of followers.

## File checklist

Files in this directory:

- `bio.txt` — the 117-char Instagram bio
- `link_in_bio.txt` — link strategy + Linktree fallback labels
- `first_post_caption.txt` — launch carousel caption + slide outline + alt text
- `README.md` — this file
- `profile_picture.png` — TO CREATE (1080 × 1080, PNG, wordmark on DARK)
- `first_post_image.png` — TO CREATE (1080 × 1350, slide 1 of the carousel)

No banner asset needed — Instagram profiles have no header banner.

## Cross-references

- Strategy lock: `docs/marketing/CHANNEL_STRATEGY.md` § Tier 1 — Instagram
- Voice rules: `docs/marketing/VOICE_CHEAT_SHEET.md`
- Hashtag strategy detail: `docs/marketing/_research/hashtags.md`
- Spec detail: `docs/marketing/_research/specs.md` § Instagram
- Timing detail: `docs/marketing/_research/timing.md` § Instagram
