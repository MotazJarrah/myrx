# Mission, Vision, Revenue & Product Principles (Locked)

Standalone reference consolidating MyRX's mission, vision, revenue model, product-scope principles, and the locked training vocabulary. This is a project CONTRACT doc — content is preserved verbatim from `CLAUDE.md`; keep it in sync when the source changes.

---

## Training vocabulary (locked terms — use these names in all UI copy and discussion)

The training-system feature uses three short terms agreed with the user. Always use these exact terms going forward — don't invent synonyms in code, copy, or discussion.

- **adp zone** (adaptation zone) — which adaptation a tile/exercise targets. Three values: **strength** (1-5 reps), **hypertrophy** (6-12 reps), **endurance** (13+ reps). Tile rep count maps to an adp zone via these boundaries.
- **rep range** (repetition range) — the specific rep count prescribed for a working set. For tile interactions, the rep range equals the tile's K value (e.g., tapping 6RM → rep range = 6).
- **eff curve** (effort curve) — the rep-max projection formula used by the system. Currently Epley/Brzycki/Lombardi averaged. Translates 1RM → projected weight at any rep count, OR a logged (weight × reps) → projected 1RM. The eff curve is what produces tile values on the rep-max grid.

These three terms work together: the **eff curve** computes weights for any **rep range**, and the **rep range** determines which **adp zone** the prescription falls in. UI copy can use friendlier phrasing where it improves clarity (e.g., "Build Strength" as a header is fine), but internal naming, comments, and analysis discussion must use the three locked terms.

---

## Mission, vision, and revenue model

### Mission
MyRX helps every person progress **one step at a time** across every domain that matters in their fitness — strength, cardio, mobility, body composition, nutrition, recovery, and the habits that hold it all together. Every screen, every card, every chart answers one question for the user: **"What's my next step here?"**

### Vision
One product, two audiences:
- **Coaches** who want a complete admin platform to run their entire client roster.
- **Self-coached individuals** who want a coach-quality next-step experience even without a human coach.

Both audiences use the same client-facing app. The coach version is the admin overlay on top of it; the self-coached version is the client UI minus the coach. **There is one product, not two.**

### Revenue model (two streams)

**Stream A — Coach subscription (B2B2C).** Coaches pay a monthly subscription for the admin portal. Their clients get the full client app at NO cost as long as the coach's subscription is active. The coach gets every client's data, chat, suggestion threads, progress dashboards, and the ability to message and program for the whole roster. This is the differentiator vs. Strong / Hevy / Strava — none of those sell a coach overlay.

**Stream B — App Store / Google Play tier (B2C direct).** Free download with a limited free tier. Full features unlocked by a recurring **monthly subscription** (annual option = 17% off; the old one-time/lifetime model is retired, locked 2026-06-06). No coach involved — the app itself plays the coaching role through the "next step" framing built into every domain.

### Why so many domains? (the question that nearly tripped us up)
A coach helps clients with strength, cardio, mobility, body composition, nutrition, recovery, AND the habits that hold the whole program together — not just one of those. The B2B2C arm means the app must support what a coach actually does day-to-day, or the coach can't deliver their full service through MyRX. **Breadth is table stakes for the coach segment, not bloat.**

**Backed by May 2026 market research:** every successful B2B2C coaching platform on the market is multi-domain. Trainerize (#1, tens of thousands of coaches) covers strength, cardio, nutrition, macros, meal plans, habits, sleep, water, mindfulness, body weight, and wearable sync — they identify *five pillars of healthy living* (activity, nutrition macros, nutrition portions, mindfulness, sleep). TrueCoach, MyPTHub, Virtuagym, Exercise.com sit in the same range. **Shipping without sleep / water / habits would put MyRX BEHIND the segment standard, not ahead of it.**

For the B2C arm, multi-domain works at scale (MyFitnessPal, Peloton, Apple Fitness+ all dominate via breadth) but niche specialists charge more per user (Whoop $30/mo, Strava $12/mo) because they go deeper. **The depth is the lever for B2C competitiveness, not the breadth.**

### Product principle (the scope decider)
Two tiers of domain treatment, and the goal is to promote every domain from tier 2 to tier 1 over time:

1. **Coaching surface** — answers "what's my next step here?" the way the Strength detail page does today. Clear target value, specific prescription (sets / reps / weight / time / distance), rest / recovery cue, and a "why this matters" explanation. Coaching surfaces are competitive moats for both arms — they justify the B2C paid tier AND they make the coach's job easier in the B2B2C arm.

2. **Tracking surface** — logs data, surfaces trends, but doesn't prescribe a next step. Habit checkboxes, water intake, sleep duration, body weight trend. Still valuable for both arms — Trainerize's habit checkboxes are tracking surfaces with light coaching — but doesn't drive a B2C subscription on its own.

Promote in order of decision energy: training prescription comes first (strength + cardio), recovery / habits / hydration come last.

### Where each domain stands today
- **Strength** — coaching surface. Done.
- **Cardio** — coaching surface. Done (pace / rate-anchored zones across all Group-A activities + Air Bike, Rucking, StairMill, Swimming, Concept2 ergs).
- **Mobility** — ❌ **REMOVED (June 2026).** The legacy ROM-tracking feature was deleted everywhere: the mobile page (`mobile/app/(app)/mobility.tsx`), the mobile + web `ROMVisualizer`, the dashboard ROM feed/PR logic, and the web admin surfaces (`AdminMobilityDetail`, `AdminClientMobility`, the `rom_records` queries in AdminOverview/AdminFeed/AdminDashboard/AdminUserActivity/AdminUserDetail, the `/admin/.../effort/mobility/` route, the Navbar item, `MOBILITY_MOVEMENTS`). RETAINED: the `rom_records` DB table (historical data; no UI reads it) and the `delete-user`/export edge functions that clean it. Remaining incidental mentions are legal-doc prose and the UNRELATED cardio "Mobility" crawl-movement subtype (crab walk / bear crawl) — both intentionally kept.
- **Bodyweight** — tracking surface (weight + goal). **Coaching-surface promotion CLOSED (June 2026)** — stays a logging/tracking surface by design (user call; ledger T041).
- **Calories / Nutrition** — tracking surface (food log, macros, daily target, plan wizard + timeline). **Coaching-surface promotion CLOSED (June 2026)** — stays a logging surface by design (user call; ledger T042).
- **Sleep** — ✅ **coaching surface, built** (`mobile/app/(app)/sleep.tsx`). Does next-step guidance, not just tracking (ledger T043).
- **Hydration (Water)** — ✅ **coaching surface, built + redesigned** (`mobile/app/(app)/hydration.tsx`; mascot + fluid counting + fast picker; ledger T001 / T016 / T044 / T052-T062).
- **Habits** — not built. TBD whether first-party or Apple Health / Google Fit integration.

### Roadmap order (updated June 2026)
The coaching-surface roadmap is effectively complete — every surface getting a coaching layer has one:
1. ✅ Strength — coaching surface (done).
2. ✅ Cardio — coaching surface (done).
3. ✅ Sleep — coaching surface (done).
4. ✅ Hydration — coaching surface (done).
5. Bodyweight — coaching promotion CLOSED; stays a tracking surface (user call, ledger T041).
6. Calories — coaching promotion CLOSED; stays a logging surface (user call, ledger T042).
7. ~~Mobility~~ — removed entirely (June 2026).

Remaining open product work (see `docs/TASK_PIPELINE.xlsx`): finalize the Connect page + sync logic (T047), admin↔coach client-view parity (T015), wire the food-library filter rules into the SYNC scripts (T048), and the iOS launch checklist (T046 — deferred until the app is Android-complete).
