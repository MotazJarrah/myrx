# MyRX — Project Context

> ⚠️ **CANONICAL REPO LOCATION — READ FIRST, EVERY SESSION.**
> The one working location is **`C:\Users\motaz\OneDrive\Desktop\MyRX`** (the main repo, branch `main`).
> Sessions usually spawn inside a throwaway git worktree at `…\MyRX\.claude\worktrees\<name>\`. **IGNORE IT.** Do **everything** — reads, edits, Grep/Glob, builds, `wrangler` deploys, git commit/push — against the main-repo path above, using absolute paths.
> The worktree is a possibly-stale copy and has caused real bugs (e.g. Glob reporting a file "missing" because it checked the stale worktree tree; edits landing in a copy that never deploys). If the CLAUDE.md auto-loaded into context — or any file — looks stale or contradicts the codebase, **re-read it from `C:\Users\motaz\OneDrive\Desktop\MyRX\…`** before acting.
> (To stop worktrees spawning at all, disable per-session worktree isolation in the app's session settings; this rule keeps every session in the right place regardless.)

> 📂 **DOCUMENTATION STRUCTURE — WHERE NEW DOCS GO (MANDATORY).**
> This file is the **lean, always-loaded core**. Detailed/topic-specific documentation lives in **`docs/context/<topic>.md`**, indexed below. When you add substantial new documentation — a locked design spec, a new subsystem, a per-activity card spec, a scars/lessons entry, a detailed workflow:
> - **Fits an existing `docs/context/` topic?** → add it **there**, not here.
> - **New topic?** → create a **new `docs/context/<topic>.md`** file, then add **one index line** here pointing to it.
> - Put it in THIS core file **only** if it's a must-know rule every session needs immediately — and even then keep it to a few lines plus a pointer to the detail file.
> - **NEVER paste long specs / incident narratives / detailed workflows into this core file.** That is exactly what bloated it to 600KB and caused the misreads we just fixed. Keep the core lean; keep the index in sync.

This file is the lean core. Read it top-to-bottom at session start; pull the detail file you need from the index when a task calls for it.

## 📎 Index — `docs/context/` detail files

| Topic | File |
|---|---|
| Mission, vision, revenue model, product principles, training vocabulary | [mission-and-product.md](docs/context/mission-and-product.md) |
| Animation patterns (TickerNumber, AnimateRise cascade, chevron pulse, consolidated-page swipe, FadeInUp panels) | [animation-patterns.md](docs/context/animation-patterns.md) |
| PhantomWheel picker — deep implementation reference | [phantomwheel.md](docs/context/phantomwheel.md) |
| Strength detail-card specs (weighted, bodyweight, isometric, assisted, carry, olympic, ballistic, leverage, loadable) | [detail-cards-strength.md](docs/context/detail-cards-strength.md) |
| Cardio detail-card specs (pace zones, Concept2 ergs, rucking, stairmill, air bike, swimming) | [detail-cards-cardio.md](docs/context/detail-cards-cardio.md) |
| Sleep page coaching engine | [sleep-coaching.md](docs/context/sleep-coaching.md) |
| Formula attribution registry (every cited source the math leans on) | [formula-attribution.md](docs/context/formula-attribution.md) |
| UI / cross-platform mirror / admin↔coach mirror / title-case / no-placeholder rules | [ui-and-mirror-rules.md](docs/context/ui-and-mirror-rules.md) |
| Mobile dev environment (adb-over-WiFi, dev workflows, rebuild triggers, gotchas) | [mobile-dev-environment.md](docs/context/mobile-dev-environment.md) |
| Mobile platform (logo rules, auth infra, Twilio phone verify, profile-completeness gate) | [mobile-platform.md](docs/context/mobile-platform.md) |
| Mobile↔web surface map (web = coach + admin + marketing; athletes mobile-only) | [mobile-mirror.md](docs/context/mobile-mirror.md) |
| Brand system (4 colors, voice/tone, logo variants, user-facing-string voice rules) | [brand-system.md](docs/context/brand-system.md) |
| Coach platform (3-tier roles, 30-day trial, coach→athlete invite path) | [coach-platform.md](docs/context/coach-platform.md) |
| Account-deletion lifecycle (Delete=anonymize / Wipe=hard-delete + the new-table rule) | [account-deletion-lifecycle.md](docs/context/account-deletion-lifecycle.md) |
| Database schema + RPC functions | [database-schema.md](docs/context/database-schema.md) |
| Infrastructure (deploy, Cloudflare, email, secrets hygiene, Android App Links, Supabase) | [infrastructure.md](docs/context/infrastructure.md) |
| Food library architecture (D1, sync orchestrator, bulk import, THE LAW) | [food-library.md](docs/context/food-library.md) |
| Health Connect + the 7 wearable integrations | [health-connect.md](docs/context/health-connect.md) |
| iOS reflection checklist (16 items) | [ios-checklist.md](docs/context/ios-checklist.md) |
| Launch checklist + legal/consent-chain rules | [launch-and-legal.md](docs/context/launch-and-legal.md) |
| Production scars & hard-won lessons (Cloudflare/D1, Supabase, Browser/React, barcode) | [scars-and-lessons.md](docs/context/scars-and-lessons.md) |
| Source tree (key files) + design patterns (status dots, theming) | [source-tree.md](docs/context/source-tree.md) |
| Chat & suggestions, admin portal, localStorage keys, built-feature inventory | [chat-and-admin.md](docs/context/chat-and-admin.md) |
| Hydration mascot — Rive "Aquos" (in progress / blocked) | [hydration-mascot.md](docs/context/hydration-mascot.md) |

## Working Relationship
- **You are the programmer. The user is the product manager. The user is not a coder, so don't speak in code language, always use simple English terms.**
- At the start of every new session, read this file top to bottom. The user will tell you what they want to work on — don't prompt for it.
- **TASK LEDGER (MANDATORY — read every session).** `docs/TASK_PIPELINE.xlsx` is the cross-session record of EVERY task (done + pending), each with a stable numeric ID (T001, T002, …) and a "where we left off / what's next" note. Read it at session start so you know the open threads and can resume any of them when the user says "pick up T0xx". **Keep it current:** whenever a task starts, advances, finishes, or is deferred/parked/reverted, update it — edit the `TASKS` list in `scripts/build_task_pipeline_xlsx.py`, re-run `python scripts/build_task_pipeline_xlsx.py`, and commit both the script and the regenerated `.xlsx`. New tasks get the next free T### id; never reuse or renumber an id. The `.xlsx` is generated — never hand-edit it.
- **CAPTURE-FIRST (MANDATORY, locked 2026-06-03).** The pipeline is STRICTLY for DEVELOPMENT work — building, updating, fixing, a design/copy change, a schema/migration, or a product decision that changes the product. Every time the user raises a DEVELOPMENT point that needs fixing or discussion — ANY size: a bug, a design tweak, a decision to make, an idea, a "look into X" — the **FIRST** action, BEFORE writing any reply, is to log it in `docs/TASK_PIPELINE.xlsx` as a new **Pending** task. Append the row to the `TASKS` list in `scripts/build_task_pipeline_xlsx.py`, re-run `python scripts/build_task_pipeline_xlsx.py` so the sheet is immediately current, THEN answer — and state the assigned **T###** in your reply. The task stays **Pending** until the work is actually done/decided, then flip it to Done (or Deferred/Parked/Reverted). Commit the regenerated pipeline at the end of any turn that added or changed tasks so it survives across sessions. NEVER skip the capture step because an item seems "too small" — small items are exactly what gets lost. **But the pipeline is for DEVELOPMENT only — operational one-offs NEVER get a row, just DO them:** a deploy, a `commit and push`, restarting Metro / a dev server, running a build, and any verification / audit / status lookup ("check the DB", "is X still there", "did it deploy"). The test: does the request call for CHANGING the product (build / update / fix)? → capture it. Just running an operation or checking state? → no row.
- **FLAGGED / DEFERRED WORK GETS ITS OWN T### (MANDATORY, locked 2026-06-03).** If, while doing one task, you discover or flag a follow-up — a code change still pending, a cleanup, a "this should also happen later", a side-effect to revisit — it gets its **OWN new task id**. NEVER bury a live follow-up in another task's notes, and ESPECIALLY never inside a task you are marking Done/Closed — a note in a closed task is invisible and will be missed. The rule of thumb: if there is still an action outstanding, there must be an open (Pending/Deferred) row whose title is that action.
- Begin the task immediately. Do NOT ask about the next task while one is in progress.
- **Web changes deploy via `wrangler`, never via `git push`.** Read the Deployment facts below (and [infrastructure.md](docs/context/infrastructure.md)) before any git push. There is no GitHub→Cloudflare auto-deploy on this project — pushing produces zero deployment. This trap has cost real time.
- **MIRROR EVERY CHANGE ACROSS WEB AND MOBILE.** Bug fixes, design tweaks, UX changes, copy edits, font/color/spacing adjustments, new features, removed bandaids — anything that exists on both surfaces gets edited on both in the SAME turn. Full rule + examples in [ui-and-mirror-rules.md](docs/context/ui-and-mirror-rules.md). Most "but mobile doesn't match web" complaints come from one-sided edits; the cross-check is non-negotiable.
- **NUMBERED PLANS (MANDATORY).** Whenever the user asks for a plan, or whenever you propose any multi-item set of changes — every item MUST be a numbered list (1, 2, 3…). The user approves/rejects by number ("go on 1, 3, 5; skip 2, 4"). Never bullets/sub-headings/prose for items needing an approve/reject decision. Sub-items nest (1a, 1b). Open questions are numbered too.
- **PLAIN-ENGLISH PLANS (MANDATORY).** When the user asks for a plan/breakdown, write it in plain language they can read without being a coder. No code snippets, file paths mid-sentence, formulas, or unexplained library names/acronyms. Describe the visible behaviour / end-user outcome, then explain in product-manager terms. Save code/formula/path talk for the implementation turn. Separate rule from the numbered-plan rule — both apply at once.
- **ONE QUESTION AT A TIME ON COMPLEX REBUILDS (MANDATORY).** For larger rebuilds where many elements need discussion — when the user says "break it down" / "walk me through it" — present ONE numbered question at a time: (a) the decision point in plain language, (b) one or two proposals, (c) your recommendation + why. WAIT for the answer before the next. The whole-plan-up-front presentation is fine when the user explicitly asks for "the plan" / "all of it". **"break it down" ALWAYS refers to the active plan / proposal on the table** (even if the same message says "read X first"); if there's no active plan, ask "break down what specifically?" rather than guessing.
- **CLAUDE.md MISMATCH AUTO-SYNC (MANDATORY).** This doc (core + `docs/context/` files) goes stale fast. Whenever you scan a file, run a check, or read a value AND find the actual state disagrees with what the docs say — update the relevant doc immediately (the core if it's a core fact, else the matching `docs/context/` file). Timing: BEFORE acting on the mismatched info, or AFTER landing the change if the scan was triggered by the change itself. Never leave the docs describing a state that doesn't match the codebase. The docs are the contract between turns.
- **WEB-SEARCH-FIRST WHEN STUCK ON A PLATFORM BUG (MANDATORY, locked May 18 2026).** When debugging an Android/iOS/native bug whose symptom is STABLE + REPRODUCIBLE, and codebase-only diagnosis exceeds **15 minutes** with no convincing root cause — STOP and WebSearch first. Stable platform symptoms are almost always documented (developer.android.com, developer.apple.com, GitHub issues, Stack Overflow). Heuristic: if the symptom would reproduce identically on a brand-new throwaway app, web-search it.
- **VERIFY EVERY UPDATE AGAINST REAL DATA — "it shipped" ≠ "it works" (MANDATORY, locked 2026-06-08).** A green build + matching deploy hash only prove code shipped, not that it's correct. Before calling ANY update done: (1) trace the read path end-to-end — for each field the UI shows, follow it to its SOURCE (the `.select(...)`, the RPC's column list) and confirm that source returns it (`obj.field` proves nothing if the query omits `field` — it renders the default; when mobile gains a `profiles` column, extend `get_user_for_admin` + every SECURITY DEFINER RPC with a hand-written column list); (2) test with REAL, NON-DEFAULT data — a field rendering its default hides whether the real value flows; (3) for any "mirror," diff the LIVE source control-by-control; (4) observe the result (query the DB via Supabase MCP, inspect the rendered output) — don't assume. "Deployed, please verify" is NOT verification; do as much yourself as the tools allow, and name the exact thing for the user to look at when a check is impossible from here.

## Repository structure

Single repo at `C:\Users\motaz\OneDrive\Desktop\MyRX`. Everything lives under it.

```
MyRX/
├── web/         ← Web app (Vite + React + Wouter + Supabase) — Cloudflare Pages target
│   ├── src/                       source code (pages, components, contexts, lib)
│   ├── public/                    static assets served verbatim
│   ├── functions/                 Cloudflare Pages Functions (e.g. /api/off-search)
│   ├── package.json · vite.config.js · tailwind.config.js · index.html
│   └── dist/                      build output (gitignored)
│
├── mobile/      ← Mobile app (Expo SDK 54 + React Native 0.81 + Reanimated 4, new arch)
│   ├── app/                       expo-router routes ((auth) + (app) groups)
│   ├── src/                       components, contexts, lib, theme
│   ├── assets/ · app.json · babel.config.js · metro.config.js
│   └── android/                   native folder (gitignored, regen via `npx expo prebuild`)
│
├── workers/     ← Cloudflare Workers (independent deploys) — food-search (D1 USDA/ON)
├── supabase/    ← migrations/ (tracked SQL) · functions/ (edge functions)
├── branding/    ← Logo + wordmark masters
├── docs/        ← Design docs, TASK_PIPELINE.xlsx, context/ (the detail docs), testing/
├── scripts/     ← Deploy helpers + data-import tooling + build_task_pipeline_xlsx.py
├── CLAUDE.md, README.md, .gitignore, .env.local (gitignored)
└── .git, .claude, .github
```

**Path conventions used throughout the docs:**
- `src/pages/Strength.jsx` (no folder prefix) → **web** file at `web/src/pages/Strength.jsx`.
- `app/(app)/strength.tsx`, `src/components/PhantomWheel.tsx` (`app/` or `.tsx`) → **mobile** file at `mobile/...`.
- An explicit prefix (`web/`, `mobile/`, `workers/`, `supabase/`) means exactly that location from the repo root.

**Deploy is direct-upload, not Git-integrated.** `git push` is source-of-truth only; web deploys happen exclusively via `wrangler pages deploy web/dist`.

**Always commit `docs/User Stories.txt` (MANDATORY).** Whenever it shows as modified, INCLUDE it in the commit — it's the versioned backup of the product's user stories; the user wants a recoverable copy in git.

## Key facts (quick reference — details in the linked files)
- **Stack:** web = Vite + React + Wouter v3 + Tailwind v3 + Lucide + Recharts + Supabase → Cloudflare Pages. mobile = Expo SDK 54 + RN 0.81 + Reanimated 4 (new arch) + expo-router + lucide-react-native + react-native-svg. Both hit the same Supabase project **`xtxzfhoxyyrlxslgzvty`**. (→ [infrastructure.md](docs/context/infrastructure.md), [source-tree.md](docs/context/source-tree.md))
- **Live URLs (QA against these):** athletes/marketing **`https://myrxfit.com`**; coach portal **`https://coach.myrxfit.com`**. (Cloudflare alias `myrx-bwl.pages.dev` serves the same bundle.)
- **Web deploy = `wrangler`, NOT git.** From `web/`: `npm run build && npx wrangler pages deploy dist --project-name myrx --commit-dirty=true`. Auto-deploy after every web change; then verify the live `index-*.js` hash matches local `dist`. `git push` deploys nothing. (→ [infrastructure.md](docs/context/infrastructure.md))
- **What "web" is:** coach portal + admin portal + the public marketing landings (`Landing.jsx` = myrxfit.com, `ForCoaches.jsx` = coach.myrxfit.com). **Athletes are mobile-only** — the athlete web app was deleted May 27 2026 (pages archived to `docs/_archive/web-athlete-pages/`). There is NO "web freeze" and no athlete-web mirror. (→ [mobile-mirror.md](docs/context/mobile-mirror.md))
- **Mobile runtime:** never Expo Go (Reanimated 4 + new arch breaks it) — always the dev-client APK. adb-over-WiFi after the first USB build; full dev workflow in [mobile-dev-environment.md](docs/context/mobile-dev-environment.md).
- **Fonts:** Geist (sans) everywhere; numbers use `font-mono tabular-nums` (Geist Mono on web, JetBrainsMono on mobile). On Android NEVER combine a custom `fontFamily` with `fontWeight` — encode the weight in the family name. (→ [source-tree.md](docs/context/source-tree.md))
- **Account deletion:** two admin buttons — **"Delete account" = anonymize** (30-day grace → cron), **"Wipe out" = hard delete**. Any NEW user-referencing table MUST get the right `ON DELETE` FK (`CASCADE`/`SET NULL`, never `NO ACTION`) + anonymize wiring. (→ [account-deletion-lifecycle.md](docs/context/account-deletion-lifecycle.md))
- **User-facing strings** (emails, banners, errors, RPC exceptions) follow the 7 brand-voice rules + 3 formatting conventions. (→ [brand-system.md](docs/context/brand-system.md))
- **Supabase MCP** (`mcp__8dbdae5c-*`) is connected — prefer it for DB ops/migrations over raw SQL in bash.
- **Secrets** never live in tracked files (3-layer hygiene: `.gitignore` `.env*`, pre-commit hook, GitHub push protection). (→ [infrastructure.md](docs/context/infrastructure.md))
