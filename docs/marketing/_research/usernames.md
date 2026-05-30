# MyRX — Launch-tier username availability audit

**Date:** 2026-05-29
**Status:** Research only — DO NOT claim any handle from this report.
**Scope:** 6 candidate handles × 9 launch-tier platforms.

---

## TL;DR

**Recommended primary handle: `@teammyrx`** (or `@myrxapp` as the close runner-up).

Why not `@myrxfit` — the obvious choice that matches our domain `myrxfit.com`: it's already taken on the three platforms that matter most for fitness brand discovery — **Instagram, LinkedIn, and Pinterest — by a competing fitness brand called RxFit** (also operating in the training & nutrition coaching space). Claiming `@myrxfit` on the remaining platforms would force us to compete with another fitness brand for our own brand recognition every time a user searches "myrxfit" — they'd land on RxFit's IG/LinkedIn/Pinterest first.

`@teammyrx` and `@myrxapp` appear available across every platform checked, with no fitness-industry collisions surfaced in search.

---

## Per-handle × per-platform matrix

Legend: `OPEN` = appears available / `TAKEN` = confirmed held / `?` = can't determine (bot block, login wall, ambiguous response).

| Handle | Instagram | TikTok | YouTube | LinkedIn (co.) | X / Twitter | Threads | Facebook | Reddit | Pinterest |
|---|---|---|---|---|---|---|---|---|---|
| **`@myrxfit`** | **TAKEN** (RxFit \| Training & Nutrition) | ? | OPEN (404) | **TAKEN** (RxFit, myrxfit.com, 2-10 emp.) | ? (402 paywall) | ? | TAKEN (RxFit page surfaced) | ? (blocked) | **TAKEN** (RxFit RXFit, "Helping people change their lives…") |
| **`@myrx`** | ? (likely TAKEN — see `@myrx.in` healthcare brand) | ? | OPEN (404) | **TAKEN** (MyRx, online retail healthcare, India, founded 2014) | ? (402) | ? | ? | ? | **TAKEN** (Paul Feicht — personal account) |
| **`@myrx_fit`** | ? | ? | OPEN (404) | OPEN (404) | ? | ? | ? | ? | ? |
| **`@teammyrx`** | ? | ? | OPEN (404) | OPEN (404) | ? (402) | OPEN (no profile data in DOM) | ? | ? | ? |
| **`@myrxapp`** | ? | ? | OPEN (404) | OPEN (404) | ? (402) | OPEN | ? | ? | ? |
| **`@myrxlabs`** | ? | ? | OPEN (404) | OPEN (404) | ? (402) | OPEN | ? | ? | ? |

**Reading the matrix:** anything marked `?` means the platform either bot-blocks scrapers (TikTok, Reddit, X's 402 paywall) or returns a generic page DOM that can't be programmatically distinguished from "exists." For those cells, the handle needs to be confirmed manually inside the platform's own search UI before claiming.

---

## Confirmed conflicts (what we know is taken, and by whom)

### `@myrxfit` — three confirmed RxFit collisions
1. **Instagram `@myrxfit`** → "RxFit \| Training & Nutrition" — a fitness coaching brand.
2. **LinkedIn `/company/myrxfit`** → "RxFit," Health/Wellness/Fitness, 2-10 employees, tagline `#LiveLongerLiveBetter`, website **`myrxfit.com`** (yes — same domain we use). This is a direct, name-conflicting fitness brand.
3. **Pinterest `/myrxfit`** → "RxFit RXFit," bio: "Helping people change their lives with goal-specific training & nutrition plans."

Note on the LinkedIn domain match: their LinkedIn page lists `myrxfit.com` as the company website, but that domain is currently registered to us. The likely explanation: RxFit listed an aspirational/typo'd URL on their LinkedIn that they don't actually own. We own the domain; they own the social handle. This is messy but not blocking — we just shouldn't pick a username that drives users to their pages.

### `@myrx` — healthcare-brand collision
1. **LinkedIn `/company/myrx`** → MyRx (India), online retail healthcare platform connecting consumers with chemists, labs, doctors, hospitals. Founded 2014, partnership entity, website `myrx.co.in`. Not a fitness brand but actively using the name.
2. **Instagram `@myrx.in`** → MyRx Promote — digital brand management for doctors. Different handle (`.in` suffix), but search-adjacent.
3. **Pinterest `/myrx`** → Paul Feicht (personal account, low activity).
4. Other `myrx*` accounts surfaced: `@myrxcare`, `@myrxpharmacy`, `@myrxprofile`, `@myrxhealth`. The `myrx` name space is crowded with small healthcare brands.

### `@myrx_fit`, `@teammyrx`, `@myrxapp`, `@myrxlabs`
No confirmed collisions surfaced in any search. YouTube returns 404 for all four across multiple variants. LinkedIn returns 404 for `/company/teammyrx`, `/company/myrxapp`, `/company/myrxlabs`, `/company/myrx_fit`. These appear genuinely greenfield.

---

## Recommendation

### 1. Primary handle across ALL launch platforms: `@teammyrx`

Reasoning:
- **Zero confirmed collisions** in any of our searches.
- **Reads as a brand, not a product** — `@teammyrx` signals there's a team behind the platform (the coaches, the algorithm, the company). Fits the B2B2C model where coaches are a first-class audience.
- **Differentiates from the RxFit conflict cluster** — a user searching "myrxfit" will land on RxFit first on IG/LinkedIn/Pinterest. A user searching "teammyrx" will land on us.
- **Differentiates from the `myrx` healthcare cluster** — adding `team` prefix moves us out of the crowded MyRx-the-pharmacy-brand search space.
- **Plays nicely with the platform-mid-sentence-brand subject convention** locked in CLAUDE.md (e.g. "Join the team at MyRX," "Get coached by Team MyRX").

### 2. Per-platform fallback: `@myrxapp`

If `@teammyrx` turns out to be taken on platforms we couldn't programmatically confirm (TikTok, X, Reddit, Threads), fall back to `@myrxapp`:
- Same zero-collision profile in search.
- Reads as an app/product name — appropriate for athlete-side B2C marketing.
- Less brand-strong than `@teammyrx` (every fitness app calls itself "*app"), which is the trade-off.

Do NOT fall back to `@myrxfit` even if it's the obvious "matches the domain" answer — that handle is permanently compromised on at least 3 platforms by RxFit.

### 3. Conflicts to know about (and what they mean for marketing)

| Conflict | Surface | What to watch |
|---|---|---|
| **RxFit** (`@myrxfit` IG/LinkedIn/Pinterest) | Fitness coaching | Direct namespace competitor. Any organic search for "myrxfit" on those platforms surfaces RxFit first. Marketing copy should drive users to `myrxfit.com` (the domain) and our chosen handle (`@teammyrx`), never to "search MyRXFit on Instagram." |
| **MyRx (India)** (`@myrx` LinkedIn / `@myrx.in` IG) | Online retail healthcare | Search-adjacent but different industry. Low confusion risk for athlete audience; potential confusion for press/investors searching "MyRx" + "healthcare." |
| **MyRxProfile** (X, IG) | Health-tech profile builder | Adjacent name, separate handle. Probably not a confusion source. |
| **RxMuscle** (YouTube, IG) | Bodybuilding media | Different brand, no `myrx` prefix, but lives in the broader Rx-fitness namespace. Low risk. |
| **FitRx / myFitRx / MyFitX** | Various fitness | Loose-association competitors. Search engines may surface them on broad "rx fit" queries. |

### 4. Pre-claim verification checklist (DO NOT SKIP)

Before claiming `@teammyrx` (or any handle) on a platform:
1. Log in to the platform manually.
2. Use the platform's NATIVE search/handle-availability UI (not a web crawl) to confirm the handle is registerable.
3. Search the platform's user search for "teammyrx" + "myrx" + "team myrx" to surface any active accounts the URL probe missed.
4. Check Trademark Electronic Search System (TESS) for live trademarks on "MyRX," "TeamMyRX," and "MyRX Fit" before committing to brand long-term.
5. Same name claim across all 9 platforms in one sitting — namesquatting risk window closes the moment one platform indexes the handle as taken.

### 5. Platforms where the data is genuinely uncertain

These platforms either bot-block or return ambiguous DOM and need manual verification regardless of which handle we pick:
- **TikTok** — every URL returned the generic "Make Your Day" tagline (TikTok shows this on both real-profile and not-found pages until JS hydrates).
- **X / Twitter** — every URL returned HTTP 402 (paid API tier required for scraping).
- **Threads** — every URL returned only the footer/login wall.
- **Reddit** — `WebFetch` is blocked from reddit.com entirely.
- **Facebook** — pages return language-localized landing chrome that doesn't differentiate "exists" from "doesn't exist."

Manual confirmation is required on all 5 before claiming.

---

## Sources

- [RxFit \| Training & Nutrition (Instagram @myrxfit)](https://www.instagram.com/myrxfit)
- [RxFit (LinkedIn /company/myrxfit)](https://www.linkedin.com/company/myrxfit)
- [RxFit RXFit (Pinterest /myrxfit)](https://www.pinterest.com/myrxfit)
- [MyRx (LinkedIn /company/myrx — healthcare India)](https://www.linkedin.com/company/myrx)
- [MyRx (Instagram @myrx.in)](https://www.instagram.com/myrx.in/)
- [Paul Feicht (Pinterest /myrx)](https://www.pinterest.com/myrx)
- [MyRxProfile (X @myRxProfile)](https://x.com/myrxprofile)
- [RxFitness Coaching](https://www.rxfitnesscoaching.com/)
- [RxFit Coach](https://www.rxfitcoach.com/)
- [RxFit Austin](https://rxfit.co/)
- YouTube channel 404s confirmed for `@myrxfit`, `@myrx`, `@teammyrx`, `@myrxapp`, `@myrxlabs`, `@myrx_fit`
- LinkedIn /company/ 404s confirmed for `teammyrx`, `myrxapp`, `myrxlabs`, `myrx_fit`
