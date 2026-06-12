# Sleep Page Coaching Engine (Locked)

Coaching logic for the mobile Sleep page — every average, target, threshold, cue, and banner is derived from the user's own logs and locked here as the project contract.

## Overview (LOCKED — May 31 2026)

The Sleep page (`mobile/app/(app)/sleep.tsx`) computes everything from the user's actual logs — no settings input required. The math has to read the same way every time, so the entire engine is locked here. Touch these only with explicit user approval.

## Inputs

- **`sessions7`** — last 7 nights of `sleep_sessions` rows. Source of every average on the page.
- **`profile.birthdate`** — drives the age-banded target duration. Only required field.
- **`profile.date_format`** — `'mdy'` or `'dmy'`, drives the Sleep Clock center date label.

No user-set bedtime, wake time, or duration target. **Do not add one** — that path was considered and rejected May 31 2026. The user explicitly said: derive everything from logs, coach toward the age-banded target, don't force input.

## Targets

- **`target_duration_hours`** = age-banded per `targetHoursForAge(birthdate)` — locked table:
  - 0-3mo: 15h · 4-11mo: 13h · 1-2y: 12h · 3-5y: 11h · 6-12y: 10h · 13-17y: 9h · 18-25y: 7.5h · 26+: 7h
  - Sources: AASM Paruthi 2016 (J Clinical Sleep Med), NSF Hirshkowitz 2015 (Sleep Health), Li et al. 2022 (Nature Aging, UK Biobank N≈500k).
- **`DEEP_TARGET_S`** = 5400 (90 min). Yu et al. 2024 — MCI vs CN have ~4.3% deep-sleep gap (≈18 min on a 7h night), so 90 min is the population center.
- **`REM_TARGET_S`** = 5400 (90 min). Same source basis.
- **Target bedtime** (computed, not stored): `avg_wake_hour - target_duration_hours`. So if user wakes at 7:30 AM and target = 7h, target_bedtime = 12:30 AM. **Never** asks the user.

## Averages (all from sessions7)

- **`avg_duration_s`** = `sum(s.duration_s) / N`. Used for Total dim + verdict banner.
- **`avg_bed_hour`** = `mean(bedtimeOffsetSeconds(s.start_at)) / 3600`. Decimal hours in local TZ. Source of truth for every bedtime-anchored cue.
- **`avg_wake_hour`** = `mean(wakeOffsetSeconds(s.end_at)) / 3600`. Same.
- **Consistency stddev** = `stdDev(bedOffsets) / 60` (minutes). Drives Schedule's consistency classifier.

## Status classifiers (LOCKED dose-response thresholds — see existing CLAUDE.md research section)

- `classifyTotal(actual, target)` → OK ≤30 min off, WARN ≤90 min, FAIL >90. Symmetric (Li U-curve).
- `classifyStage(actual, target)` → OK ≤15 min short, WARN ≤30 min, FAIL >30. Asymmetric — only short side.
- `classifyBedtime(actual, target)` → OK ≤15 min late, WARN ≤60 min, FAIL >60. Wittmann 2006 social-jetlag boundary.
- `classifyConsistency(sd)` → OK ≤30 min, WARN ≤60 min, FAIL >60. Lunsford-Avery 2018 + Windred 2024.

## CBT-I weekly micro-target (NEW — Spielman 1987 sleep restriction therapy)

- **`computeMicroTarget(avgSec, targetSec)`** returns `{ microTargetSec, deltaMin, direction, reachesTarget }`.
- Step size: **`MICRO_TARGET_STEP_SEC = 15 * 60`** (15 min). Spielman 1987 + Edinger 2021 AASM CBT-I guideline: circadian rhythm adapts to bedtime shifts in 15-min weekly increments. Larger jumps don't stick.
- **Clamping**: never overshoots the age-banded target. If avg = 6h and target = 7h, this week's target is 6h 15m, next week 6h 30m, etc. Once within ±15 min of target → direction = 'hold'.
- Surfaced in the banner as: *"This week, aim for Yh Zm (+15 min) — your circadian rhythm adapts in 15-min weekly steps."*

## Bedtime-anchored hygiene cue registry (LOCKED — every cue cites its source)

All cues use **`makeCue(id, avgBedHour, avgWakeHour)`** which computes time offsets relative to the user's actual logs. No generic clock times.

| Cue ID | Time formula | Source |
|---|---|---|
| `caffeine` | bedtime − 6h | Drake et al. 2013 (J Clin Sleep Med) — caffeine half-life |
| `alcohol` | bedtime − 3h | Roehrs & Roth 2001 — REM suppression |
| `meals` | bedtime − 3h | Park et al. 2020 — delayed deep entry |
| `screens_dim` | bedtime − 1h | Burgess 2013 — melatonin suppression |
| `screens_off` | bedtime − 30 min | Burgess 2013 — blue-light wake trigger |
| `sunlight` | wake + 30 min | Wright et al. 2013, Khalsa 2003 — strongest circadian anchor |
| `temp` | ≤67°F (not time-dependent) | Okamoto-Mizuno 2012 — thermoregulation drop triggers deep |
| `wake_anchor` | `fmtClock12(avg_wake_hour)` | Czeisler 1999 — DOMINANT zeitgeber (stronger than bedtime) |
| `rem_tail` | "last 90 min of sleep" (not time-dependent) | Carskadon & Dement — REM cycles lengthen across night |

When adding a new cue, add it to the registry above + cite the published source. **Never** add a generic-time cue ("no caffeine after 2 PM" applied to all users) — that violates the page's design contract.

## Cue rotation

- **`weekParity()`** = `Math.floor(Date.now() / WEEK_MS) % 2`. Stable within a render, flips at the weekly boundary.
- Each dim has 2 cues; week 0 shows primary, week 1 shows alternate. Prevents chronically-off users from reading the same advice 7 days in a row.
- Per-dim rotation:
  - **Total** (when short): sunlight (W0) ↔ wake_anchor (W1)
  - **Deep**: temp (W0) ↔ meals (W1)
  - **REM**: alcohol (W0) ↔ rem_tail (W1)
  - **Schedule**: always wake_anchor (Czeisler-primary, no rotation — bedtime variant names a specific time instead)

## Wake-time anchor (LOCKED — coaching primary)

Czeisler 1999 + decades of subsequent chronobiology research: **wake time is the dominant circadian zeitgeber, stronger than bedtime**. Every coaching cue that needs a single high-leverage lever must lead with "hold your wake time" — not "hold your bedtime". Behavior reason: alarms are easier to enforce than falling-asleep targets. Biology reason: wake time triggers the cortisol rise that anchors the next 24h cycle.

This means:
- Schedule's consistency cue: *"Hold your alarm at HH:MM AM — wake time is your dominant circadian anchor."* (NOT "hold your bedtime".)
- Total short, bedtime late case: lead with *"Hold W as alarm anchor"* then *"pull bedtime to B"*.
- Total short, bedtime already early case: lead with *"Hold W"* or extend wake later if schedule allows.

## Verdict banner composition (LOCKED — 3 woven pieces + cascade)

The top banner is the single integrative coaching cue. Composed in `verdictText` memo as:

```
[STATE] [MICRO?] [LEVER] [CASCADE?]
```

- **STATE**: `"Sleep is averaging Xh Ym."`
- **MICRO** (only when off-target): `" This week, aim for Yh Zm (+15 min) — your circadian rhythm adapts in 15-min weekly steps."`
- **LEVER** (always, lead-dim-specific):
  - Total short + bedtime late: *"Hold W as your alarm anchor (wake time is your strongest circadian zeitgeber) and pull bedtime to B."*
  - Total short + bedtime early: *"Hold W as your wake target — or extend it later if your schedule allows. Bedtime is already on track."*
  - Total over: *"Hold W as your alarm and let bedtime drift later — oversleeping past the age-banded target signals recovery debt."*
  - Schedule lead: wake_anchor cue.
  - Deep/REM lead: corresponding rotated cue from registry.
- **CASCADE** (only when 2+ dims off): one short sentence noting which fix carries the others. Schedule fixes get "Once your wake anchor holds, total and stage time usually follow"; total fixes get "Adding total sleep typically lifts deep + REM proportionally".

Per-dim card action lines stay one-line — the integrative narrative lives only in the banner.

## Verdict color tracks the LEAD item's status (NOT off-count thresholds)

`lead` memo picks worst-status-first (FAIL > WARN). `verdict.color = statusColor(lead.status)` — banner color matches the named dim's pill color. If banner says "start with schedule" and schedule is FAIL → red stripe; if it names a WARN item → amber stripe.

## "How we compute" info pill (LOCKED — Pattern 5 inline panel)

Small `<Info>` icon in the verdict-card header. Tap → expands a `FadeInUp`/`FadeOutUp` panel with 5 labeled paragraphs explaining: target source, your averages, this week's nudge, hygiene timing math, wake-anchor reasoning. Color stripe + icon track `verdict.color`. Mirrors the existing Pattern 5 used on every other detail page (see docs/context/animation-patterns.md).

## Attribution footer (LOCKED format)

Single line under the Dimension Breakdown card:

```
AASM · NSF · Li 2022 · Belenky · Van Dongen · Wittmann · Windred · Spielman · Czeisler · Wright · Roehrs · Okamoto-Mizuno · Burgess · Drake · Park — age-banded targets, dose-response thresholds, CBT-I micro-targeting, bedtime-anchored hygiene cues
```

When adding a new source to the engine, append to the names list AND extend the descriptor at the end. Never remove an existing author — every name listed has a downstream formula or threshold depending on it.

## Tests / sanity-check rules

- Every hygiene cue in `makeCue()` must reference `avgBedHour` or `avgWakeHour` (not a hardcoded clock time). If a cue is timing-independent (temp, REM-tail), document that in the cue text.
- Every new source added to the registry must (a) be a published study with a name + year, (b) get added to the attribution footer, (c) get added to this LOCKED section's source list.
- Micro-target step stays at 15 min unless CBT-I literature changes. Don't tune by feel.
- Wake-anchor primacy is non-negotiable per Czeisler — do not flip the coaching back to bedtime-first.
