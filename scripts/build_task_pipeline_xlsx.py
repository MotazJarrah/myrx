"""
Build docs/TASK_PIPELINE.xlsx — the MyRX cross-session task ledger.

WHY THIS EXISTS
We discuss many things across many sessions and often fork mid-task. This
sheet is the single place that remembers: every task (done + pending), a
stable numeric ID to refer back to, where we left off, what's done, what's
still open, the files/commits involved, and when it was last touched.

HOW TO MAINTAIN IT (read this — the .xlsx is GENERATED, not hand-edited)
  1. Edit the TASKS list below (add a row, flip a status, update the
     "left off" / "next" text).
  2. Re-run:  python scripts/build_task_pipeline_xlsx.py
  3. Commit both this script AND docs/TASK_PIPELINE.xlsx.
New tasks get the next free T### id. NEVER reuse or renumber an id — the
whole point is a stable reference ("pick up T021").

Seeded 2026-06-03 from the current CLAUDE.md + the recent working sessions.
It is best-effort for older work (older sessions weren't fully transcribed);
treat it as the living record from here forward.

Run from repo root:
    python scripts/build_task_pipeline_xlsx.py
"""
from __future__ import annotations
import datetime as _dt
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "TASK_PIPELINE.xlsx"

# ─────────── styles ────────────────────────────────────────────────────────────
HEADER_FILL = PatternFill("solid", fgColor="111721")   # MyRX dark
HEADER_FONT = Font(bold=True, color="CAF240", size=11)  # MyRX lime
TITLE_FONT  = Font(bold=True, color="111721", size=18)
SUB_FONT    = Font(color="475569", size=10, italic=True)

STATUS_FILLS = {
    "Done":        PatternFill("solid", fgColor="DCFCE7"),  # green-100
    "In progress": PatternFill("solid", fgColor="DBEAFE"),  # blue-100
    "Pending":     PatternFill("solid", fgColor="FEF3C7"),  # amber-100
    "Deferred":    PatternFill("solid", fgColor="E0E7FF"),  # indigo-100
    "Parked":      PatternFill("solid", fgColor="F1F5F9"),  # slate-100
    "Reverted":    PatternFill("solid", fgColor="FEE2E2"),  # red-100
}
ZEBRA = PatternFill("solid", fgColor="F8FAFC")

THIN = Side(border_style="thin", color="CBD5E1")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# ─────────── columns ────────────────────────────────────────────────────────────
COLS = [
    ("ID",                 8),
    ("Task",               34),
    ("Area",               16),
    ("Surface",            14),
    ("Status",             13),
    ("Where we left off / what we did", 70),
    ("What's still open / next",        46),
    ("Key files & commits",             40),
    ("Last touched",       14),
]

# ─────────── the ledger ─────────────────────────────────────────────────────────
# (id, task, area, surface, status, left_off, next_open, files_commits, last_touched)
TASKS = [
    # ── Active / recent working sessions (most relevant for "where are we") ──
    ("T001", "Hydration mascot (pixel slime)", "Hydration", "Mobile", "Done",
     "Replaced the progress ring with HydrationPet: a pixeowl pixel slime over an animated day/night PixelScene. Pace-aware mood (compares intake vs where you should be by ~9pm), first-person rotating captions (no emojis), Cup/Bottle quick-adds, drink-hop reaction. Final idle = a hand-authored 16-frame loop using a custom off-sheet 'settle' frame (idle-extra.png).",
     "None — shipped. Hydration PAGE redesign is a separate open item (T016).",
     "mobile/src/components/HydrationPet.tsx, PixelScene.tsx; assets/pet/; commit bb7ade2",
     "2026-06-03"),

    ("T002", "Hydration water target (science-correct)", "Hydration", "Mobile", "Done",
     "Target = 35 mL/kg/day from the client's LATEST LOGGED bodyweight (not profile weight), fallback by gender. Added attribution line (National Academies / Mayo / EFSA). Fixed the earlier kg/lb inconsistency.",
     "None.",
     "mobile/app/(app)/hydration.tsx; commit bb7ade2",
     "2026-06-03"),

    ("T003", "Settings cleanup (fluid unit, invite, distance/swim)", "Settings", "Mobile", "Done",
     "Added a Fluid (oz/mL) unit toggle. Removed the 'paste an invite code' block. Merged Distance + Swim-distance into ONE toggle ('mi · yd' / 'km · m', middle-dot separator). settings.tsx is the real settings file (not profile.tsx).",
     "None.",
     "mobile/app/(app)/settings.tsx; commit bb7ade2",
     "2026-06-03"),

    ("T004", "Heart page corrections", "Heart", "Mobile", "Done",
     "Fixed resting-number inconsistency, the 'no data today' vs 'Latest HR' contradiction, 6-of-7-day padding, and the chart 'Peak 91-108' (now single value). Bucketing switched from UTC to local date; resting fallback = AVG of daily lows. Removed the 3 resting-HR tips entirely.",
     "None.",
     "mobile heart.tsx, HrRangeChart.tsx, RestingHrIndicator.tsx; commit bb7ade2",
     "2026-06-03"),

    ("T005", "Calorie plan live sync (coach edit -> athlete)", "Calories/Plan", "Backend+Mobile", "Done",
     "Coach 'Update plan' didn't refresh the athlete's Calories page in real time. Root cause: calorie_plans + bodyweight weren't in the realtime publication AND mobile had no subscription. Fixed: published both tables (REPLICA IDENTITY FULL) + added a mobile realtime subscription that re-fetches on change. Audited all coach->client flows; this was the only one missing realtime.",
     "None.",
     "mobile calories.tsx; supabase migration 20260603a; commit 88be006",
     "2026-06-03"),

    ("T006", "Goal-reached resets on new phase", "Calories/Plan", "Backend", "Done",
     "Progress bar stuck at 100% after a coach changed the goal. Fixed at the DB layer: trigger reset_goal_reached_on_phase_change clears goal_reached whenever the goal OR starting weight changes (covers every writer). Sticky 100% only persists through weight fluctuations; an explicit save/goal-change re-baselines. One-time data fix cleared the stale prod row.",
     "None.",
     "supabase migration 20260603b; commit 88be006/86b88c3",
     "2026-06-03"),

    ("T007", "Remove redundant 'Reset goal' button", "Calories/Plan", "Web", "Done",
     "After T006 made 'Update plan' clear the reached flag, the separate 'Reset goal' button in MacroPlanEditor was redundant. Removed the button, handler, state, icon import; fixed the help copy that referenced it.",
     "None.",
     "web MacroPlanEditor.jsx",
     "2026-06-03"),

    ("T008", "'Goal reached' banner persistence fix", "Calories/Plan", "Web", "Done",
     "Banner lingered after Update plan because the editor used a stale local plan copy. handleSave now reads the DB-authoritative row back (.select().single()) so the banner clears; copy no longer says 'reset'.",
     "None.",
     "web MacroPlanEditor.jsx",
     "2026-06-03"),

    ("T009", "Calorie timeline unification", "Calories/Plan", "Cross", "Done",
     "One shared timeline calc across signup wizard, Calories page, and coach view (they used to disagree — signup assumed perfect adherence, the page assumed realistic ~20/30 days). Recomp now shows an achievable timeline instead of a static slow band; wrong-direction plans show a mismatch warning; single 'monthsBest' figure everywhere. Decided items: keep 20/30 realistic; recomp shows a real number; one number across all three.",
     "None on the math. (See T014 — adding new dashboard pills is the only calorie-adjacent open item.)",
     "mobile calorieFormulas.ts, planPresets.ts, PlanWizardSheet.tsx, calories.tsx; web calorieFormulas.js, MacroPlanEditor.jsx; commit 86b88c3",
     "2026-06-03"),

    ("T010", "Hide timeline once goal reached", "Calories/Plan", "Mobile", "Done",
     "After goal reached, the Calories page wrongly showed a timeline (below goal) or 'different directions' mismatch (above goal). Now suppressed via the sticky plan.goal_reached flag (works for coached + self-coached).",
     "None.",
     "mobile calories.tsx; commit 632d9c8",
     "2026-06-03"),

    ("T011", "Dashboard BW pill fix", "Dashboard", "Cross", "Done",
     "The weight pill needed two weigh-ins across week windows, so it showed nothing after a single fresh log. Now: change since the last weigh-in, with a current-weight fallback so it shows after ANY log. Mirrored to the admin + coach client dashboards.",
     "None.",
     "mobile dashboard.tsx; web AdminUserDetail.jsx, CoachClientDetail.jsx; commit 86b88c3",
     "2026-06-03"),

    ("T012", "Remove legacy Mobility feature", "Mobility", "Cross", "Done",
     "Mobility/ROM removed everywhere. Mobile: deleted the page + ROMVisualizer, stripped ROM from the dashboard/effortTags/RadialNav/signup. Web admin: deleted AdminMobilityDetail/AdminClientMobility/ROMVisualizer, removed the route + all rom_records usage from AdminOverview/Feed/Dashboard/UserActivity/UserDetail/Navbar/movements.js + marketing copy. RETAINED: rom_records DB table (historical data, no UI) + the unrelated cardio 'Mobility' crawl subtype. Note: first removal agent ran on a stale worktree branch — caught + redone on the real checkout.",
     "Optional follow-ups: T049 (drop rom_records table) and T050 (scrub mobility from legal docs) — both deferred to your call.",
     "deletions + edits across mobile + web; commit 86b88c3",
     "2026-06-03"),

    ("T013", "Radial-nav background recolor", "Navigation", "Mobile", "Reverted",
     "Experiment: recolor the radial-nav dome from near-black to dark MyRX-green. Tried hsl(73,70,12) -> hsl(73,45,8) -> hsl(100,45,7); user disliked all. Reverted COLOR_DOME back to colors.background — RadialNav.tsx matches the committed version exactly.",
     "Radial-nav design rework is still wanted by the user but the green direction is rejected. Re-open when the user picks a new direction.",
     "mobile RadialNav.tsx (reverted)",
     "2026-06-03"),

    ("T014", "Dashboard pills covering all pages", "Dashboard", "Cross", "Pending",
     "Current pills: Strength PRs, Cardio PRs, Food streak, Lowest HR, Weekly weight. Gap pages were Sleep, Hydration, Mobility. PROPOSED + recommended: add Sleep ('avg Xh / 7 nights', indigo) and Hydration ('X days hit water goal / 14', cyan). Mobility pill DROPPED (feature removed, T012). Data confirmed available (sleep_sessions, water_logs). Whatever lands MUST mirror to admin + coach client dashboards.",
     "Awaiting user go-ahead on the two pills (Sleep avg + Hydration streak). Then implement on mobile dashboard + admin AdminUserDetail + coach CoachClientDetail.",
     "(planned) mobile dashboard.tsx; web AdminUserDetail.jsx, CoachClientDetail.jsx",
     "2026-06-03"),

    ("T015", "Admin vs Coach client-view design parity", "Coach/Admin", "Web", "Parked",
     "User noted the admin and coach portals don't present the client 'preview' identically. Both render the same MacroPlanEditor (identical), so the difference is in the surrounding wrappers (admin has Food Log/Manual Logs/Macro Plan sub-tabs; coach shows just the editor behind a 'Manage macros' gate) + different tab sets/profile cards. User dismissed the clarifying question and parked it.",
     "Re-open when the user decides which surface to match and how (whole client page vs just the macro/preview area).",
     "web admin/tabs/AdminUserCalories.jsx; coach/CoachClientDetail.jsx",
     "2026-06-03"),

    ("T016", "Hydration page redesign / update", "Hydration", "Mobile", "Pending",
     "User wants to rework the Hydration page (beyond the mascot, T001). They said they'll give the specific direction next. This is the NEXT active task after the task-ledger work.",
     "Get the specific direction from the user, then implement on mobile hydration.tsx.",
     "mobile/app/(app)/hydration.tsx",
     "2026-06-03"),

    ("T017", "Cross-session task pipeline ledger", "Infra/Docs", "Docs", "Done",
     "Built this file — docs/TASK_PIPELINE.xlsx — generated by scripts/build_task_pipeline_xlsx.py. Captures all known tasks (done + pending) with stable IDs + 'where we left off' context. CLAUDE.md points here so every session reads + maintains it.",
     "Keep it updated: edit the TASKS list in the builder script + re-run + commit, every time a task starts/advances/finishes.",
     "scripts/build_task_pipeline_xlsx.py -> docs/TASK_PIPELINE.xlsx; CLAUDE.md pointer",
     "2026-06-03"),

    # ── Completed feature surfaces (prior sessions; from CLAUDE.md locked specs) ──
    ("T018", "Strength: Weighted Standard next-target card", "Strength", "Mobile", "Done",
     "Locked spec: big-weight algorithm (eff curve from best 1RM), adp-zone pill (strength/hypertrophy/endurance) with chevron swipe, rep-max tile row, equipment-specific footers, single coaching cue. Per-zone defaults locked.",
     "Frozen/done. Don't touch finalized surfaces unless a new locked rule applies.",
     "mobile [exercise].tsx (WeightedStandardDetail); CLAUDE.md spec",
     "prior"),

    ("T019", "Strength: Bodyweight consolidated detail", "Strength", "Mobile", "Done",
     "Locked spec: 4 assist tiers (Full RX / Band / Knee / Band+Knee) as a single consolidated page, band-level sub-progression, max-attempt tiles, pill-swipe carousel (Pattern 4), 10-rep graduation rule.",
     "Frozen/done.",
     "mobile [exercise].tsx (BodyweightConsolidatedBlock); CLAUDE.md spec",
     "prior"),

    ("T020", "Strength: Isometric milestones", "Strength", "Mobile", "Done",
     "Locked spec: 12 universal milestones (10-120s), 3 phases (Stability/Durability/Mastery), 3-6-3 tile grid, fmtDuration labels, next-target hero.",
     "Frozen/done.",
     "mobile [exercise].tsx (Isometric); CLAUDE.md spec",
     "prior"),

    ("T021", "Strength: Assisted Machine detail", "Strength", "Mobile", "Done",
     "Locked spec: inverted effective-load math, bodyweight gate (30-day recency), %BW tiles, pin-snapped targets, 'Attempt unassisted' graduation cue. Shared formula dropped Brzycki >10 reps.",
     "Frozen/done.",
     "mobile [exercise].tsx (AssistedMachine); CLAUDE.md spec",
     "prior"),

    ("T022", "Strength: Carry detail (+ Sled Work consolidated)", "Strength", "Mobile", "Done",
     "Locked spec: dual-axis (weight + distance), strongman tiers, per-movement ladders, 3 adp zones (Max Load/Distance Build/Conditioning), unit locks (kg / mi), Sled Work Push|Pull consolidated page.",
     "Frozen/done.",
     "mobile [exercise].tsx (CarryDetail, SledWorkConsolidatedDetail); CLAUDE.md spec",
     "prior"),

    ("T023", "Cardio coaching surface (pace zones)", "Cardio", "Mobile", "Done",
     "Locked spec: Group A endurance activities get Endurance/Threshold/VO2 zones, a live plan-queue generator (polarized 80/20), 45-min session ceiling, amber theme, per-activity prescribed sessions.",
     "Frozen/done.",
     "mobile [activity].tsx (PaceDetail); CLAUDE.md spec",
     "prior"),

    ("T024", "Cardio: Air Bike surface", "Cardio", "Mobile", "Done",
     "Locked spec: cal/min-anchored Sprint/Threshold/Aerobic zones, watts-floor advisory (cal/min x 17.4), gender baseline cold-start, calorie-input log form.",
     "Frozen/done.",
     "mobile [activity].tsx (AirBikeDetail); CLAUDE.md spec",
     "prior"),

    ("T025", "Cardio: Rucking surface", "Cardio", "Mobile", "Done",
     "Locked spec: carry-style (load + distance, not pace) with GoRuck tier ladder, lb + mi unit locks, 3 zones, pack-weight log wheel.",
     "Frozen/done.",
     "mobile [activity].tsx (RuckingDetail); CLAUDE.md spec",
     "prior"),

    ("T026", "Cardio: StairMill surface", "Cardio", "Mobile", "Done",
     "Locked spec: floors-per-minute rate-anchored 3 zones (Allison/Honda/Boreham protocols), floors+time log form.",
     "Frozen/done.",
     "mobile [activity].tsx (StairMillDetail); CLAUDE.md spec",
     "prior"),

    ("T027", "Cardio: Swimming consolidated (4 strokes)", "Cardio", "Mobile", "Done",
     "Locked spec: Free/Back/Breast/Fly variants collapsed into one detail page (stroke-pill carousel), CSS-anchored zones via Riegel proxy, per-100m pace, leaving-interval hero, per-stroke independent fitness.",
     "Frozen/done.",
     "mobile [activity].tsx (SwimmingConsolidatedDetail); CLAUDE.md spec",
     "prior"),

    ("T028", "Cardio: Concept2 ergs (Row/Bike/Ski)", "Cardio", "Mobile", "Done",
     "Locked spec: metric distance always, per-500m split, watts via the Concept2 cubic formula, 4-row hero, shared PaceDetail branching.",
     "Frozen/done.",
     "mobile [activity].tsx (PaceDetail erg branches); CLAUDE.md spec",
     "prior"),

    ("T029", "Cardio catalog cleanup", "Cardio", "Backend+Mobile", "Done",
     "Removed recreational/terrain-confounded activities (walking, hiking, skiing, trail/hill running, MTB, niche machines) across 3 passes; consolidated duplicate variants; moved sled/sandbag carries to strength. Final list = 15 DB rows / 12 visible activities.",
     "Frozen/done.",
     "supabase movements table; mobile [activity].tsx; CLAUDE.md spec",
     "prior"),

    ("T030", "Animation pattern library (1-7)", "Design system", "Mobile", "Done",
     "Documented + locked 7 canonical motion patterns (entrance cascade, ticker number, pulsing chevron, consolidated-page swipe, inline expansion, PhantomWheel inertia, save-button feedback) with exact constants + source locations.",
     "Reference only — reuse patterns; add Pattern 8+ to CLAUDE.md if a genuinely new motion is needed.",
     "CLAUDE.md 'Animation patterns' section",
     "prior"),

    ("T031", "Mobile app port (all athlete surfaces)", "Platform", "Mobile", "Done",
     "Ported every athlete surface to Expo/React Native: dashboard, strength, cardio, bodyweight, calories, heart, hydration, sleep, history(removed), profile/settings, chat/suggestions, full signup journey.",
     "Mobile is the active surface for all new athlete work.",
     "mobile/ tree; CLAUDE.md 'Mobile Mirror'",
     "prior"),

    ("T032", "Web/Mobile role rule (athletes mobile-only)", "Platform", "Cross", "Done",
     "Locked May 27 2026: athletes have ZERO web surfaces; web = coach portal + admin portal only. Athlete web pages archived/removed; post-sign-in routing branches by role; /app download placeholder for athletes on web.",
     "Honor on every routing/signup/feature change. (CLAUDE.md frozen/mobile-mirror language reconciled to this in a later session.)",
     "web App.jsx; CLAUDE.md 'Web / Mobile role rule'",
     "prior"),

    ("T033", "Coach Platform v1 (signup + portal)", "Coach Platform", "Web", "Done",
     "Public coach signup at /coach/* + Stripe Checkout + CoachShell portal (dashboard, clients, invite, messages, briefing, adjustments, profile, client detail). Tier-aware access; coach-attached athletes get full access.",
     "Phase 1/2 shipped. Billing/IAP polish + further coach tooling ongoing.",
     "web pages/coach/*; CLAUDE.md Coach Platform sections",
     "prior"),

    ("T034", "Auth infrastructure", "Auth", "Cross", "Done",
     "Email OTP + magic-link dual model, biometric sign-in (SecureStore), Twilio Verify phone OTP (edge functions), Android App Links, profile-completeness gating, deleted-user detection.",
     "Done. Web OTP zero-tap parked pending a Twilio template approval.",
     "AuthContext, edge functions, supabase email templates",
     "prior"),

    ("T035", "Food library (D1 + search + import)", "Food Library", "Backend", "Done",
     "~470K-row Cloudflare D1 food DB (USDA + OpenNutrition + MYRX), search worker w/ UPC, one-shot bulk_import with in-memory dedup, R2-mirror sync orchestrator (GHA), admin Sync UI.",
     "Open gap: wiring the filter pipeline into the incremental SYNC scripts (bulk import already applies it). See T048.",
     "workers/food-search, scripts/bulk_import, scripts/sync; CLAUDE.md food sections",
     "prior"),

    ("T036", "Health Connect integration (Phase 1)", "Integrations", "Mobile", "Done",
     "Android read-only Health Connect: config plugins (permissions + ViewPermissionUsageActivity + queries visibility), MainActivity delegate registration, manual 'Sync now' (logs last-7-day workouts + HR). Several hard-won Android gotchas documented.",
     "Phase 1 logs to console; mapping HC records -> effort logs is next. Superseded as PRIMARY path by the direct-integration strategy (T040) since Samsung Health doesn't bridge HR/workouts to HC.",
     "mobile plugins/, lib/healthConnect.ts, settings ConnectTab; CLAUDE.md HC section",
     "prior"),

    ("T037", "Calories: food logging", "Calories", "Cross", "Done",
     "food_logs table + FoodLogDrawer (search -> portion picker -> log) + barcode scan + CalorieStrip + per-meal breakdown + admin Food Log tab.",
     "Done. Per-session calorie auto-estimation deferred to the Calories overhaul.",
     "FoodLogDrawer, calories.tsx, food_logs",
     "prior"),

    ("T038", "Chat & suggestions (realtime)", "Messaging", "Cross", "Done",
     "messages table + RLS, realtime chat + suggestions on mobile (ChatSheet/SuggestionSheet) and web (admin/coach), chat_enabled gate, coach-info RPC, v3 unconditional coach-client chat.",
     "Done.",
     "ChatSheet, SuggestionSheet, AdminMessages, CoachMessages",
     "prior"),

    ("T039", "Admin portal", "Coach/Admin", "Web", "Done",
     "Full admin portal: overview, clients roster, weight-goal progress, nutrition grid, activity feed, messages, unified Libraries (movements + foods), exports/archive, per-client detail tabs.",
     "Done. Ongoing per-feature tweaks (e.g. T011 BW mirror, T012 mobility removal).",
     "web pages/admin/*",
     "prior"),

    # ── Pending / roadmap ──
    ("T040", "Direct per-platform integrations", "Integrations", "Cross", "Pending",
     "Strategy locked May 18 2026 after Samsung Health didn't bridge HR/workouts to Health Connect: build dedicated integrations per platform. Build order: Strava -> Fitbit -> Apple HealthKit -> Samsung SDK -> Garmin -> Whoop -> Polar. Cross-cutting infra: OAuth callback worker, webhook receiver worker, user_integrations table, token-refresh cron, per-platform mappers. HC stays as a fallback.",
     "Not started. First three (Strava/Fitbit/HealthKit) have no approval delay; the rest are gated on developer-program approvals (apply in parallel). See docs/integrations/developer-program-applications.md.",
     "(planned) workers/oauth, workers/webhooks, mobile/src/lib/integrations/; CLAUDE.md integrations spec",
     "prior"),

    ("T041", "Bodyweight -> coaching surface", "Bodyweight", "Mobile", "Pending",
     "Roadmap: promote Bodyweight from a tracking surface to a coaching surface (a 'what's my next step' experience like Strength).",
     "Not started. Mission/roadmap item.",
     "(planned) mobile bodyweight.tsx",
     "prior"),

    ("T042", "Calories -> coaching surface", "Calories", "Mobile", "In progress",
     "Roadmap: Calories is being promoted to a coaching surface. The self-coached plan wizard (PlanWizardSheet) + the timeline work (T009) are part of this. Per CLAUDE.md the wizard is in active iteration (mobile-only until locked).",
     "Continue iterating the plan wizard / next-step coaching; lock when the user signs off.",
     "mobile PlanWizardSheet.tsx, calories.tsx",
     "ongoing"),

    ("T043", "Sleep -> coaching surface", "Sleep", "Mobile", "Pending",
     "Roadmap: promote Sleep to a coaching surface. Data exists (sleep_sessions, sleep_stages).",
     "Not started.",
     "(planned) mobile sleep.tsx",
     "prior"),

    ("T044", "Hydration -> coaching surface", "Hydration", "Mobile", "Pending",
     "Roadmap: promote Hydration to a coaching surface. Data exists (water_logs) + daily target computed. Related to the mascot (T001) and the upcoming page redesign (T016).",
     "Not started as a 'coaching' promotion; the page redesign (T016) may feed into this.",
     "(planned) mobile hydration.tsx",
     "prior"),

    ("T045", "Sleep / Water / Habits tracking surfaces", "Recovery/Habits", "Mobile", "Pending",
     "Roadmap (segment table-stakes for the coach arm): build Sleep / Water / Habits tracking surfaces, likely via Apple Health / Google Fit integrations rather than first-party logging.",
     "Not started. Decide first-party vs integration per surface.",
     "(planned)",
     "prior"),

    ("T046", "iOS launch checklist", "Platform/iOS", "Mobile", "Pending",
     "Pre-iOS-launch work documented in CLAUDE.md: HealthKit entitlements + Info.plist usage strings, IAP/receipt validation, Sign in with Apple (if social login), SMS autofill, edge-swipe parity, EAS iOS build profile, etc.",
     "Not started. Gated on iOS build + App Store account setup.",
     "CLAUDE.md iOS checklist; docs/launch_checklist.xlsx",
     "prior"),

    ("T047", "Health Connect Phase 2", "Integrations", "Mobile", "Deferred",
     "Background sync (WorkManager/BackgroundTasks), write-back to HC, app-launch auto-sync. HR-series storage schema is an open question (hr_samples vs extended column).",
     "Deferred until at least one direct integration (T040) is live.",
     "(planned)",
     "prior"),

    ("T048", "Wire filters into food-library SYNC scripts", "Food Library", "Backend", "Pending",
     "Known gap: the incremental sync scripts (sync_usda / sync_on) predate filters.mjs and use a legacy shouldSkip; bulk import already applies the full filter + dedup pipeline. Sync needs enrichFood + shouldKeepFood + dedup wired in.",
     "Not started.",
     "scripts/d1_migrate/sync_usda.mjs, sync_on.mjs",
     "prior"),

    ("T049", "Drop rom_records table (post-Mobility)", "Mobility", "Backend", "Deferred",
     "After T012 removed the Mobility UI, the rom_records table is orphaned (no UI reads it; delete-user/export functions still clean it). Dropping it is destructive (deletes historical ROM data) so it was intentionally left for the user to decide.",
     "User decision: keep (historical) or drop. If drop, also remove the table refs in the delete-user/export edge functions.",
     "supabase rom_records table; delete-user/admin-user-management functions",
     "2026-06-03"),

    ("T050", "Scrub Mobility from legal docs", "Mobility/Legal", "Web", "Deferred",
     "Privacy Policy / DPA / Coach Agreement still list 'mobility / range-of-motion assessments' as a collected data category. Left untouched in T012 because legal copy is sensitive (and historical rom_records data still exists).",
     "User/legal decision on whether to remove the ROM data-category language.",
     "web/src/pages/legal/{PrivacyPolicy,DataProcessingAgreement,CoachAgreement}.jsx",
     "2026-06-03"),
]

# ─────────── build ──────────────────────────────────────────────────────────────
def main():
    wb = Workbook()
    ws = wb.active
    ws.title = "Task Pipeline"

    # Title band
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(COLS))
    t = ws.cell(row=1, column=1, value="MyRX — Task Pipeline")
    t.font = TITLE_FONT
    t.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 30

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(COLS))
    gen = _dt.date.today().isoformat()
    s = ws.cell(row=2, column=1,
                value=f"Cross-session ledger of every task (done + pending). Stable IDs — refer back with 'pick up T0xx'. "
                      f"Generated {gen} by scripts/build_task_pipeline_xlsx.py — edit that script's TASKS list + re-run to update.")
    s.font = SUB_FONT
    s.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    ws.row_dimensions[2].height = 26

    # Header
    HEAD_ROW = 3
    for ci, (name, width) in enumerate(COLS, start=1):
        c = ws.cell(row=HEAD_ROW, column=ci, value=name)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        c.border = BORDER
        ws.column_dimensions[get_column_letter(ci)].width = width
    ws.row_dimensions[HEAD_ROW].height = 26

    # Rows
    r = HEAD_ROW + 1
    for row in TASKS:
        for ci, val in enumerate(row, start=1):
            c = ws.cell(row=r, column=ci, value=val)
            c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
            c.border = BORDER
            c.font = Font(size=10, bold=(ci == 1))
            if ci % 2 == 0:
                pass
        # status colour (col 5)
        status = str(ws.cell(row=r, column=5).value or "")
        if status in STATUS_FILLS:
            ws.cell(row=r, column=5).fill = STATUS_FILLS[status]
        # subtle zebra on the long-text columns for readability
        if (r - HEAD_ROW) % 2 == 0:
            for ci in (2, 6, 7, 8):
                if ws.cell(row=r, column=ci).fill.fgColor.rgb in (None, "00000000"):
                    ws.cell(row=r, column=ci).fill = ZEBRA
        r += 1

    ws.freeze_panes = f"A{HEAD_ROW + 1}"
    ws.sheet_view.showGridLines = False

    # ── How to use sheet ──
    hw = wb.create_sheet("How to use")
    hw.column_dimensions["A"].width = 110
    lines = [
        ("MyRX — Task Pipeline · how to use", TITLE_FONT, 28),
        ("", None, 8),
        ("WHY THIS EXISTS", Font(bold=True, size=12, color="111721"), 22),
        ("We fork across many sessions and lose track of what's open / where we stopped. This is the single "
         "remembered list. Every task has a stable numeric ID (T001, T002, ...). Refer to one with "
         "\"pick up T021\" and this sheet says exactly where we left off and what's next.", Font(size=11), 60),
        ("", None, 8),
        ("STATUS VALUES", Font(bold=True, size=12, color="111721"), 22),
        ("Done — shipped (and usually deployed/committed).", Font(size=11), 18),
        ("In progress — actively being iterated.", Font(size=11), 18),
        ("Pending — agreed/known but not started.", Font(size=11), 18),
        ("Deferred — intentionally postponed (waiting on something or a user decision).", Font(size=11), 18),
        ("Parked — discussed then set aside; needs a user decision to re-open.", Font(size=11), 18),
        ("Reverted — was tried, then undone.", Font(size=11), 18),
        ("", None, 8),
        ("HOW TO UPDATE (the .xlsx is GENERATED, do not hand-edit)", Font(bold=True, size=12, color="111721"), 22),
        ("1. Edit the TASKS list in scripts/build_task_pipeline_xlsx.py (add a row / flip a status / update the "
         "'where we left off' + 'next' text).", Font(size=11), 34),
        ("2. Re-run:  python scripts/build_task_pipeline_xlsx.py", Font(size=11), 18),
        ("3. Commit BOTH the script and docs/TASK_PIPELINE.xlsx.", Font(size=11), 18),
        ("New tasks get the next free T### id. Never reuse or renumber an id.", Font(size=11), 18),
        ("", None, 8),
        ("SCOPE NOTE", Font(bold=True, size=12, color="111721"), 22),
        ("Seeded 2026-06-03 from the current CLAUDE.md + recent sessions. Older sessions weren't fully "
         "transcribed, so the 'prior' rows are best-effort reconstructions of completed features. Treat this "
         "as the authoritative living record from here forward — keep it current.", Font(size=11), 60),
    ]
    rr = 1
    for text, font, height in lines:
        c = hw.cell(row=rr, column=1, value=text)
        if font:
            c.font = font
        c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        hw.row_dimensions[rr].height = height
        rr += 1
    hw.sheet_view.showGridLines = False

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"[task-pipeline] wrote {OUT}  ({len(TASKS)} tasks)")

if __name__ == "__main__":
    main()
