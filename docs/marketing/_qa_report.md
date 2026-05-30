# Brand Voice QA Report — docs/marketing/

**Date:** May 29, 2026
**Scope:** Adversarial 3-pillar voice review across every .md and .txt file under `docs/marketing/`.
**Result:** PASS with 2 live-copy fixes applied. 27 files clean; 2 files edited.

---

## Files reviewed (29 total)

### Top-level (6)
- `CHANNEL_STRATEGY.md`
- `USERNAMES_RESEARCH.md`
- `VOICE_CHEAT_SHEET.md`
- `LAUNCH_PLAYBOOK.md`
- `POST_TEMPLATES.md`
- `CONTENT_CALENDAR.md`

### `_research/` (6)
- `_research/channels.md`
- `_research/usernames.md`
- `_research/specs.md`
- `_research/hashtags.md`
- `_research/competitive_voice.md`
- `_research/timing.md`

### `PROFILE_KIT/` (17)
- `PROFILE_KIT/_VISUALS_README.md`
- `PROFILE_KIT/linkedin/` — `bio.txt`, `link_in_bio.txt`, `first_post_caption.txt`, `README.md`
- `PROFILE_KIT/instagram/` — `bio.txt`, `link_in_bio.txt`, `first_post_caption.txt`, `README.md`
- `PROFILE_KIT/youtube/` — `bio.txt`, `link_in_bio.txt`, `first_post_caption.txt`, `README.md`
- `PROFILE_KIT/x/` — `bio.txt`, `link_in_bio.txt`, `first_post_caption.txt`, `README.md`

---

## Voice rules checked against every file

1. Banned-phrase sweep: `transform`, `journey`, `unlock`, `unleash`, `level up`, `crushed it`, `killed it`, `shredded`, `ripped`, `dominated`, `destroyed`, `unstoppable`, `hack`, `biohack`, `growth hack`, `shortcut`, `the secret to`, `discover the secret`, `welcome to...`, `welcome back, coach`, `ready to transform`, `start your journey`, `for your security`, `we take privacy seriously`, `consider`, `feel free to`, `you might want to`, `down the line`, `in the future`, `double-check`, `Please` before imperative, `Don't miss out`, `Last chance`, `Act now`.
2. Three-pillar test on every piece of live brand copy (bios, captions, descriptions).
3. Lowercase coach / athlete / client in body sentences.
4. Brand mid-sentence + verb-first on titles and CTAs.
5. No emojis on platform copy.
6. No exclamation points on platform copy.
7. Channel coherence — no "tap the link below" inside in-app copy etc.
8. Coach leads, doesn't pay — canonical form when subscription coverage comes up.

---

## Violations found and fixed

### Fix 1 — `POST_TEMPLATES.md` (template C2 hashtag block)

**Before:**
```
**Voice notes.** All 3 pillars. Coach role named correctly (oversight, not programming). Avoids "transformation" and "journey." No exclamation points.
**Posting time.** Sunday 7:30 PM ET.
**Hashtags.** 4 — #onlinecoach #fitnessjourney  #strengthprogress #onlinecoaching

(Note: "fitnessjourney" is a high-volume discovery hashtag, used here only for reach; the caption itself does not use the word "journey.")
```

**Issue.** The template caption is correctly clean of the word "journey" — but the hashtag block ships `#fitnessjourney` with a footnote rationalizing it as a discovery hack. The brand-voice lock bans "journey" without an exception for reach. A high-volume discovery hashtag does not override the voice rule; the audience clicking through to a MyRX post is the same audience the voice is built for. Letting one banned word slide for reach is the first crack — every future "but this one's for reach" exception widens the breach.

**After:**
```
**Voice notes.** All 3 pillars. Coach role named correctly (oversight, not programming). No exclamation points.
**Posting time.** Sunday 7:30 PM ET.
**Hashtags.** 4 — #onlinecoach #strengthprogress #onlinecoaching #liftingcoach

(Note: `#fitnessjourney` was previously used in this slot as a high-volume discovery hashtag. Removed May 29 2026 — the brand-voice ban on "journey" applies to hashtags too. Discovery hacks don't override the voice lock.)
```

Replaced with `#liftingcoach` — same coach-targeted audience, no banned root word.

### Fix 2 — `PROFILE_KIT/youtube/link_in_bio.txt` (banner link #1 description)

**Before:**
```
1. myrxfit.com
   Display title: Get the app
   → The athlete-side conversion surface. Free tier covers strength,
     cardio, mobility; CoreRX and FullRX unlocks live behind one
     CTA. Mobile-first landing that detects platform and serves the
     right store link.
```

**Issue.** "Unlocks" is in the transformation-family banned list (alongside `unlock`, `level up`, `game changer`). The word appears here as a noun ("the unlocks live behind one CTA"), which is the same root semantic. Internal documentation copy still binds to the same rules — anyone reading this file is meant to absorb the voice, and a banned word inside the doc that defines the voice teaches the wrong default.

**After:**
```
1. myrxfit.com
   Display title: Get the app
   → The athlete-side conversion surface. Free tier covers strength,
     cardio, mobility; CoreRX and FullRX one-time upgrades sit
     behind one CTA. Mobile-first landing that detects platform and
     serves the right store link.
```

Replaced with "one-time upgrades" — accurate (CoreRX and FullRX are one-time purchases per the pricing lock), no banned root word.

---

## Files that hit the banned-phrase grep but are NOT violations

Every other file that lit up the banned-phrase sweep was inside one of these legitimate contexts:

1. **The banned-phrase list itself** in `VOICE_CHEAT_SHEET.md` — the doc names what's banned so writers can spot it. Naming the rule is not breaking it.
2. **Anti-pattern "Don't Write This / Write This Instead" tables** in `VOICE_CHEAT_SHEET.md` — the left column quotes banned phrasing as a foil for the rewrite. The teaching format requires showing what to avoid.
3. **Contrast examples** in `POST_TEMPLATES.md` — voice-notes blocks say "Avoids 'crushed it,' 'shredded,'" etc. as compliance notes on each template. Citing banned phrases as things avoided is exactly the rule working.
4. **Competitive voice analysis** in `_research/competitive_voice.md` — quotes Renaissance Periodization, Whoop, Strava, Noom in their actual voices to define MyRX by contrast. Quoting a competitor's banned phrasing inside an analysis is not adopting it.
5. **Negation framing inside live MyRX copy** — `CONTENT_CALENDAR.md` Day 25 closes with "The pattern is sustainability, not transformation." This is the locked move: name the wrong frame to repudiate it. Same shape as "Other brands promise transformation. MyRX names the next step." (`VOICE_CHEAT_SHEET.md` line 161).
6. **"Welcome to MyRX" inside DO-NOT lists** in `PROFILE_KIT/instagram/link_in_bio.txt`, `PROFILE_KIT/youtube/link_in_bio.txt`, `PROFILE_KIT/x/first_post_caption.txt` — the docs list banned label patterns explicitly so future copywriters skip them.
7. **The Day 5 / Friday IG carousel** in `CONTENT_CALENDAR.md` line 186 — caption preview quotes five banned phrases in a row as the subject of the post ("Five fitness app phrases MyRX will never use"). The post is ABOUT the ban; that's the on-brand move, not a violation.
8. **"Password manager installed and unlocked"** in `LAUNCH_PLAYBOOK.md` line 47 — the literal mechanical state of a 1Password / Bitwarden session. "Unlocked" here refers to the manager being open for the session, not the marketing word. Not a voice violation.
9. **"Building MyRX" / "Athlete app" / "Coach platform"** in LinkedIn bio + first-post caption — confirmed compliant with the brand-mid-sentence + verb-first rule. "Building MyRX" leads with the verb; brand sits inside the action. "Coach platform: myrxfit.com/coach" is a colon-separated label, not a title — fine.
10. **"Free as long as your coach's subscription is active"** in `POST_TEMPLATES.md` D3 and the matching block in `CONTENT_CALENDAR.md` Day 24 — this is the canonical form locked by the brand-voice rule ("the coach leads, doesn't pay"). The standalone form is allowed and explicitly noted in the template's voice notes.

---

## Gray-area calls (decisions worth noting)

1. **"#fitnessjourney" as discovery hashtag** — resolved with Fix 1 above. The voice lock wins over reach.
2. **`competitive_voice.md` lines 128, 146** — quote Strava and Noom verbatim with emojis. These are competitor voices being analyzed; the document is a research deliverable describing other brands. Kept as-is — they are not MyRX copy.
3. **`PROFILE_KIT/x/README.md` line 133** — `"We're proud to announce a major update to MyRX!" — loses.` This is a banned-pattern example showing what NOT to do, with explicit "— loses." marker. Kept.
4. **`PROFILE_KIT/linkedin/first_post_caption.txt` line 83** — quotes `"let me know what you think!"` and `"drop a comment"` inside a voice-audit block as patterns the post avoids. Kept.
5. **`Welcome to your journey` / `Crush it` / `Unlock your potential`** in `CONTENT_CALENDAR.md` Day 5 caption preview — this is the post about the brand voice ("Five fitness app phrases MyRX will never use"). Quoting banned phrases as the subject of a ban-themed post is on-strategy. Kept.
6. **`CONTENT_CALENDAR.md` line 247: "Most athletes train wrong"** — "wrong" is direct, no hedge, no banned-list hit. Kept.
7. **"transformation" in `_research/channels.md`** — describes the TikTok content category ("transformation content, transformation storytelling"). It's a descriptive market term in a research doc, not MyRX brand voice. Kept.
8. **"Performance worship family" headers in `VOICE_CHEAT_SHEET.md`** — the section taxonomy uses words like "Performance worship" as a category label. Internal taxonomy, not user-facing copy. Kept.

---

## Pass / fail count

| Category | Count |
|---|---|
| Files reviewed | 29 |
| Files clean as-is | 27 |
| Files with live-copy violations fixed | 2 |
| Banned-phrase hits that were anti-pattern examples (no fix needed) | ~85 |
| Banned-phrase hits that were live brand copy (fixed) | 2 |
| Three-pillar voice failures in live copy | 0 |
| Channel-coherence violations | 0 |
| Coach-leads-doesnt-pay violations | 0 |
| Exclamation points on live brand copy | 0 |
| Emojis on live MyRX brand copy | 0 |

**Final verdict: PASS** — the marketing folder is on-voice after the two fixes above.

---

## 200-word summary of biggest patterns fixed

The two live violations came from the same failure mode: voice rules getting bent for what looked like a pragmatic reason — reach (the `#fitnessjourney` hashtag) and brevity (`CoreRX and FullRX unlocks`). In both cases the docs had a footnote or quick gloss rationalizing the exception. That's the actual risk pattern. The brand-voice lock works only when it's absolute; the first "this one's a discovery hack" exception teaches future writers that the rules bend if the reason is good. The fixes replaced both with on-voice equivalents that lose nothing — `#liftingcoach` reaches the same coach audience as `#fitnessjourney`, and "one-time upgrades" describes the CoreRX / FullRX purchases more accurately than "unlocks" (which implies a tier-gated reveal). Everything else in the folder was already disciplined. The banned-phrase grep produced ~85 hits across `VOICE_CHEAT_SHEET.md`, `POST_TEMPLATES.md`, `_research/competitive_voice.md`, and the PROFILE_KIT READMEs — every single one was inside a banned-phrase list, an anti-pattern example, a contrast block, or a voice-audit block. Naming the rule isn't breaking it. The marketing folder ships with the voice locked.
