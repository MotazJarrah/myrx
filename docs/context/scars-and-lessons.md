# Production Scars & Hard-Won Lessons

These are the MyRX project's expensive mistakes, captured so they're never repeated — each rule below exists because something broke and cost real time. None are obvious from the docs. When unsure whether a constraint still applies, KEEP it.

## Cloudflare / D1

1. **D1 has a 30-second per-query CPU budget.** Wrangler `--file` execution can't extend it. Monolithic operations over 2M+ rows ALWAYS time out — `DELETE WHERE id NOT IN (SELECT ... GROUP BY)`, self-joins on large tables, etc. Either chunk into ≤10k-row batches OR move the cross-row logic to in-memory Node (see the food_library dedup law in `scripts/bulk_import/lib/dedup_in_memory.mjs`).

2. **`execSync` default stdout buffer is 1 MB.** Wrangler `--json` output for a 50k-row query is ~50 MB → `spawnSync ENOBUFS`. Set `maxBuffer: 256 * 1024 * 1024` on every `execSync` call that wraps wrangler, AND keep individual query chunks at ≤10k rows.

3. **Wrangler 4.x requires Node 22+.** GHA Setup-Node must specify `node-version: '22'`. Wrangler refuses to start on Node 20 with a "requires at least Node.js v22.0.0" error.

4. **Workers Free has a 100 MB request body limit.** Anything bigger (food source ZIPs are 460 MB) needs R2 multipart upload, chunked from the frontend. The worker does NOT proxy the bytes through itself — it just orchestrates the multipart upload via R2's API (`createMultipartUpload`, `resumeMultipartUpload`, `uploadPart`, `complete`).

5. **R2 incomplete multipart uploads auto-clean at 7 days.** No need to write a cleanup job — if a browser refresh interrupts an upload mid-session, the orphan chunks expire automatically. We also write a `pending.json` marker per upload so the worker can abort cleanly when the user clicks Cancel.

6. **R2 must be manually enabled in the Cloudflare dashboard once per account.** Requires accepting R2 Terms of Service. Not automatable via wrangler — `wrangler r2 bucket create` returns "Please enable R2 through the Cloudflare Dashboard. [code: 10042]" until ToS is accepted via the web UI.

7. **`wrangler d1 execute --file` bypasses D1's HTTP API rate limits.** The documented free-tier limits (100K writes/day) are enforced on the HTTP API but NOT on the CLI `--file` pathway. We pushed 2M+ rows in 13 minutes via the CLI with zero rejections. Per-row writes via worker `env.DB.prepare(...).run()` DO count against the limits. This is practical reality, not documented behaviour — if Cloudflare ever closes the loophole, bulk_import switches to a multi-day batched run or Workers Paid ($5/mo = 50M writes/day).

8. **Cloudflare Pages does NOT auto-deploy from GitHub on this project.** The Pages dashboard shows commit-message-looking deployments, but those are residue from a defunct Git connection. The only working deploy path is `wrangler pages deploy web/dist`. `git push` accomplishes nothing for the live site. Verify with:
   ```bash
   curl -s "https://myrxfit.com/" | grep -oE 'index-[^"]+\.js'
   ls web/dist/assets/index-*.js
   ```
   Hashes must match.

9. **Vite reads `.env.local` from the project root, NOT from `web/`.** Need `envDir: '..'` in `vite.config.js`. Without it, build-time env vars are empty strings and the bundle 401s every admin endpoint. This bit us once and could bite again on any new env var added.

## Supabase / Postgres

1. **Supabase RPC return type changes** require `DROP FUNCTION` first then `CREATE OR REPLACE` — you can't just alter the return type.

2. **Realtime channels**: always `supabase.removeChannel(channel)` in cleanup. Use specific event types (`INSERT`, `UPDATE`) rather than `'*'` for reliability.

3. **RLS bypass for cross-row reads**: end users can't read admin profile rows. Use `SECURITY DEFINER` RPC functions for any data clients need from the admin's profile (e.g. `get_coach_info()`). Always `SET search_path = public` on SECURITY DEFINER functions.

4. **Calorie logs use `log_date` (date-only).** When converting to timestamps use the `T00:00:00.000Z` suffix so they're always in the past.

5. **EVERY `profiles` upsert MUST include `auth_user_id`** (LOCKED, May 26 2026). The `profiles_active_must_have_auth` CHECK constraint requires `(deactivated_at IS NOT NULL OR auth_user_id IS NOT NULL)`. PostgreSQL evaluates CHECK constraints on the **proposed-INSERT row FIRST**, BEFORE the ON CONFLICT branch fires — even when the existing row already has `auth_user_id` set. So an upsert payload like `{ id: user.id, phone: '+1...' }` proposes an INSERT row where `auth_user_id` is NULL → CHECK fails → the entire statement errors before ON CONFLICT DO UPDATE can run.
   - **The rule**: every upsert into `profiles` (web, mobile, edge functions) MUST include `auth_user_id: <userId>` in the payload, even when you "know" the row already exists. It's a no-op for the UPDATE branch and the one thing that makes the fallback INSERT path satisfy the CHECK. Add `auth_user_id: user.id` (web) / `auth_user_id: userId` (edge functions) right after `id:` in every payload.
   - **Why it burned us**: reintroduced across mobile `sign-up.tsx` (11 upsert sites), web end-user + coach `Signup.jsx`, web `AuthContext.jsx::updateProfile`, and edge functions `init-profile-checkpoint` + `verify-phone-otp`. Most failures were silently swallowed by `try { ... } catch { /* best-effort */ }` blocks, so users walked through signup while half their fields were dropped; the `verify-phone-otp` 500 finally surfaced it. **Don't trust that "the row already exists" rescues you from the CHECK — it doesn't.**
   - **Code-review heuristic**: any line that reads `from('profiles').upsert(` MUST have `auth_user_id` in the payload object. Plain UPDATE statements (`.from('profiles').update({...}).eq('id', ...)`) are NOT affected — CHECK on UPDATE only evaluates the post-UPDATE row; only upserts trigger the proposed-INSERT pre-check.

## Browser / React

1. **bfcache eviction triggers** — when present, the page does a full reload on tab return instead of a fast snapshot restore (the "page keeps refreshing on tab switch" complaint). Avoid:
   - `Cache-Control: no-store` or `no-cache` on the document. Use `max-age=0, must-revalidate` for the same intent without killing bfcache.
   - **`self.clients.claim()` in a service worker (any version). NO EXCEPTIONS — not even "one-time recovery" rationales.** `BUILD_VERSION` bumps on every postbuild, so a new SW install + activate fires on every deploy; any `claim()` in the activate handler therefore fires per-deploy, evicting bfcache for every active tab. This rule was broken once (May 25 2026 cache-poisoning "one-time recovery" that was actually per-deploy) and reproduced the exact constant-reload symptom it was written to prevent. Permanently removed May 27 2026. The same ban applies to `self.clients.matchAll().navigate()` — same bfcache impact, plus it force-reloads every controlled tab on activate, which IS the user-visible symptom.
   - WebSocket connections open at page-hide (pre-Chrome 149). Disconnect Supabase realtime on `visibilitychange='hidden'`, reconnect on `visible`.
   - `TOKEN_REFRESHED` auth events firing while the page is hidden.

2. **`sr-only` input inside a `<label>` triggers scroll-into-view on click.** The browser focuses the (invisible) input and scrolls it into view, dragging the page down (broke the dry-run toggle). Use `<button role="switch" aria-checked={state}>` for custom toggles — no input element means no focus-scroll, and the button has native keyboard support.

3. **Route-level viewport gates must NOT use pure `useIsDesktop()` (matchMedia min-width).** That hook flips false whenever DevTools opens on a laptop (the panel narrows available width below the breakpoint). If the gate is `if (!isDesktop) <Redirect/>`, opening DevTools silently navigates the user away — and closing it doesn't bring them back (the destination route has no reverse gate). Locked May 27 2026 after a coach got dumped into `/dashboard` on opening DevTools. Use `useIsPhone()` (viewport AND `pointer:coarse`) for route gates — the touch-input filter keeps DevTools-resized laptops on the original route. `useIsDesktop()` is still fine for COMPONENT-level layout decisions (3-col vs 1-col grid), just not for redirects.

4. **Chrome popup blocker rejects the SECOND `window.open()` in a single click handler.** Only the first is treated as user-initiated (bit us on an "Open both source download pages" button). Fix: split into two separate buttons (or two `target="_blank"` anchor tags), each handling one URL.

5. **`ProtectedLayout` flickering caused full-tree unmounts.** The auth context briefly flips `profileLoading=true` even when `profile` is already loaded (any `refreshProfile()` call). If the gate is `if (loading || profileLoading) show <Skeleton/>`, every profile refresh tears down the route tree. Gate on `if (loading || (profileLoading && !profile))` instead — show the skeleton ONLY on the initial null load, never on subsequent refreshes. This was the actual root cause of the "page refresh" complaints (NOT bfcache, which was a separate, smaller issue).

6. **Inline-arrow `component={() => ...}` on a wouter `<Route>` causes unmount-on-every-parent-render.** Wouter renders `<props.component />` directly, and inline arrows produce a NEW function reference on every `AppRoutes` render; React's reconciler treats different function types as different components → unmounts old + mounts fresh → page state resets, effects re-fire, data refetches, UI flashes skeleton. Symptom is identical to a reload (em-dash placeholders, "Loading…" panels) even though the URL never changes and the bfcache log correctly says `(NO reload)`. Locked May 27 2026 after the coach dashboard reproduced this on every tab-switch. **Fix:** define route components as STABLE top-level functions and pass by reference — `component={CoachPortalRoute}`, not `component={() => <CoachProtectedLayout><CoachDashboard/></CoachProtectedLayout>}`. See the `Coach*Route` consts above `AppRoutes` in `web/src/App.jsx`.

7. **No visibility-change / focus refetches anywhere.** Pages load data on mount and stay static until the user explicitly navigates. The React Native "useFocusEffect" pattern does NOT translate to web — desktop users constantly alt-tab (Slack/docs is normal work behavior), and every tab return triggering a fresh fetch produces loading skeletons that feel like reloads. Ruined the coach dashboard UX until May 27 2026.
   - **Valid refetch triggers (web):** initial mount (`useEffect([])`); route change (component remount via wouter); Supabase realtime UPDATE/INSERT events (server pushes delta); explicit user action (button click, pull-to-refresh).
   - **Banned (web):** `document.addEventListener('visibilitychange', ... fetch ...)`; `window.addEventListener('focus', ... fetch ...)`; `useFocusEffect` from React Navigation (mobile-only — but if ported, it becomes a visibilitychange handler and falls under this ban).
   - The visibilitychange handlers in `web/src/contexts/AuthContext.jsx` + `web/src/main.jsx` are EXCEPTIONS — they disconnect/reconnect the Supabase realtime WebSocket for bfcache compatibility (pre-Chrome 149). They do NOT trigger fetches.

8. **Don't auto-clear server-side error state via polling.** When the admin operations panel showed a stale failure message from a previous run, the fix was to clear the in-DB error in a one-time capture (set `errorClearedRef`, push empty error to server, show in UI until the next operation starts). Hammering the worker to clear it via repeated POSTs is cheaper to write but nukes the audit trail.

## Barcode scanner

Both surfaces — the web admin food-library Scan button and the mobile FoodLogDrawer — use the same underlying patterns.

1. **1D barcode physics.** UPC/EAN/Code-128/etc. encode data in vertical bar widths; the scanner reads a horizontal line of pixels across the bars. If the barcode rotates 90° relative to the scan line, the scanner sees one solid stripe and nothing decodable. The aim frame is 4:1 (wide-to-tall) BY DESIGN — it tells the user "put a horizontally-aligned barcode here." ZXing tries rotated decodes via `TRY_HARDER`, but it's slower and less reliable than holding it right.

2. **Camera selection MUST be explicit.** Both web (`@zxing/browser`) and mobile (`expo-camera`) default to whichever camera the browser picks — on phones, usually the FRONT camera (useless). Web: `decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } })`. Use `ideal` not `exact` so desktops without a rear camera still get their available camera.

3. **Format hints save real time.** Default `BrowserMultiFormatReader` tries QR, Data Matrix, Code 128, Aztec, PDF417, UPC, EAN on every frame. For food packaging, only UPC-A, UPC-E, EAN-13, EAN-8 matter. Limiting via `DecodeHintType.POSSIBLE_FORMATS` + setting `TRY_HARDER` is faster AND more reliable on busy packaging. Also request `1280x720` video resolution — phones default to lower res on the rear camera unless asked.

4. **iOS Safari does NOT support `screen.orientation.lock`.** Even in fullscreen, even as a PWA — Apple has refused this forever. Android Chrome supports it via fullscreen + `screen.orientation.lock('portrait')`. Wrap the lock attempt in try/catch and accept silent failure — the scanner still works on iOS, just without orientation pinning. The visible "align horizontally" hint is the cross-platform fallback.

5. **OpenFoodFacts proxy fetches CAN hang.** OFF's API is slow and sometimes returns malformed JSON. Wrap the fetch in an `AbortController` with an 8s timeout. On timeout, fall through to opening the Add panel with just the UPC pre-filled — manual data entry beats an infinite spinner.

6. **`scanError` must render at page level, not inside the panel.** If the scan flow finishes without opening a panel (timeout, lookup error, etc.), an error rendered inside the panel has nowhere to show. Bit us when scans silently completed with nothing visible.

7. **UPC match is a SEED, not a final answer.** UPC lookups too often return mislinked/stale items, or the user is eating a different variant of the same product. Mobile scan flow:
   - Look up UPC → get the matched food's name + brand.
   - `stripNameForGenericSearch(name, brand)` strips it to a generic term (drops brand, sizes, pack counts, packaging words, parens) — `"Trader Joe's Almond Butter, Creamy, 16oz Jar"` → `"almond butter creamy"`.
   - Run that as a normal FTS search; drop the user into the search-results view with the stripped query pre-populated.
   - The originally-matched UPC item is NOT shown in results — the user picks the right variant from the generic search hits.
   - Zero hits → "Not in our library" state.

   Web admin uses a different flow (the goal there is to ADD missing foods to MYRX): UPC found → open edit panel; UPC not found → fetch OFF for a starter pre-fill → open add panel.

## Known patterns & gotchas

- **Supabase MCP tool** (`mcp__8dbdae5c-*`) is available — prefer it for migrations over raw SQL in bash.
- **AdminFeed** uses `dataCache` to avoid re-fetching on every visit.
- **Avatar**: if `avatar_url` is set, show `<img>` instead of initials — applies to ALL admin list views (clients, progress, nutrition, feed, messages, UserDetail).
- **Coach avatar in ChatDrawer**: only in the drawer header, NOT on individual message bubbles. User explicitly rejected per-message photos.
- **Admin Movement Library add form**: hidden behind a dashed button (`addOpen` state). Never render the form inline without the user clicking "+ Add movement" first.
- **Food logging vs calorie_logs**: `food_logs` is the live system. `calorie_logs` is legacy — don't delete it; the admin "Manual Logs" tab still reads it. The mobile CalorieStrip component reads `food_logs` and sums calories in JS. (The web CalorieStrip copy was deleted May 28 2026 with the orphan cleanup — athlete-web pages are gone.)
- **USDA / food search**: use `web/src/lib/foodLibrary.js` (`searchFoods`, `getFoodPortions`, `calcMacros`) for all food search work. It merges custom myrx foods (Supabase) + USDA (Cloudflare Worker D1). The legacy `usda.js` + `opennutrition.js` wrappers were deleted May 28 2026 (zero remaining consumers).
- **UPC progressive search**: queries of 3+ digits trigger UPC mode in both `foodLibrary.js` (Supabase ilike prefix) and the Cloudflare Worker (SQL `LIKE digits%`). 12+ digits = exact match. Results narrow as the user types — no need to scan a complete barcode.
- **Cloudflare Worker** (`workers/food-search/`): handles the `/search` endpoint for USDA D1 food search. UPC detection — partial prefix LIKE for 3–11 digits, exact for 12+. Deploy with `npx wrangler deploy` from `workers/food-search/`.

### Food library architecture (post-2026-05-14 rebuild + second-pass cleanup)

Two-tier data flow:

- **Initial seed** = one-shot bulk import from locally-downloaded source files via `scripts/bulk_import/run.mjs` (pulls every USDA data type — branded, foundation, sr_legacy, survey_fndds, experimental, plus the rarer ones — and all of OpenNutrition). The bulk import applies the full filter pipeline at INSERT time (Tier 1-4 of `scripts/d1_migrate/lib/filters.mjs`: Rules 1-14) plus a post-import dedup pass (Tier 5: Rules 15-19).
- **Ongoing sync** = incremental refresh via the orchestrator `scripts/sync/run.mjs` (pulls source ZIPs from the R2 mirror, parses, diffs against live D1, writes). Triggered by the admin food-library Sync button (→ `POST /admin/sync` in `workers/food-search/src/sync-admin.js` → GitHub `workflow_dispatch` on `sync-food-library.yml` → `node scripts/sync/run.mjs`) AND a monthly cron (`0 3 1 * *`).
- **The production sync applies the FULL 19-rule pipeline.** It reuses the SAME loaders as the bulk import (`loadUsda` / `loadOn` → `enrichFood` + `shouldKeepFood`, Rules 1-14) and the SAME `applyDedup` (`scripts/bulk_import/lib/dedup_in_memory.mjs`, Rules 15-19), so a sync produces a byte-identical filtered/deduped result to a full rebuild (only difference: diff-based insert/update/delete instead of wipe-and-rebuild). Verified by audit 2026-06-04 (ledger T048).
- The legacy `scripts/d1_migrate/sync_usda.mjs` + `sync_on.mjs` are **dead / superseded** by the orchestrator (no workflow or `package.json` references them). Even they have since been migrated to `enrichFood` + `getFilterReason`, so the old "`shouldSkip` from `normalize.mjs`" claim is obsolete (`shouldSkip` still exists in `normalize.mjs` but has no caller in any sync path).

**`food_library` schema (current):** 19 columns.
- Identification: `source` (usda/on/myrx), `source_id` (unique within source), `source_subtype` (literal source category — e.g. 'branded_food', 'foundation_food', 'on_branded', 'on_recipe', 'admin_custom').
- Classification: `data_type` (universal — 'branded'/'generic'/'recipe'/'restaurant'/'aggregated').
- Nutrition: `kcal`/`protein_g`/`fat_g`/`carbs_g`/`fiber_g`/`sodium_mg`/`serving_g`/`serving_label`/`servings_per_container`/`upc`/`brand`/`name`.
- Audit: `imported_at`, `last_synced_at`, `source_version` (e.g. 'FoodData_Central_csv_2026-04-30', '2025.1').
- `food_category` (USDA's text category) was dropped during the post-audit cleanup.
- Schema lives in `workers/food-search/schema.sql`; migrations in `workers/food-search/migrations/` (0004 added data_type, 0005 brand-aware classifier fix, 0006 audit columns).

**`data_type` rule** (`scripts/d1_migrate/lib/normalize.mjs::dataTypeFromUpc(upc, brand)`): branded if EITHER upc OR brand is present; generic only when both are missing. The bulk import uses USDA's own `data_type` column to assign (branded_food → 'branded', everything else → derived per-type), but the Worker myrx-create path and incremental sync paths use the UPC/brand rule as single source of truth.

**`shouldSkip` UPC rule** (`scripts/d1_migrate/lib/normalize.mjs`): rejects rows without a UPC ONLY when `dataType === 'branded'`. Generics legitimately have no UPC and must pass through. If you copy this filter to a new sync path, copy the `dataType` parameter too — otherwise you'll silently re-introduce the original lettuce-disappears bug.

**Audit-then-filter workflow (status as of 2026-06-04):** the audit phase is COMPLETE and the filters apply at BOTH bulk-import time AND sync time. The 19 approved rules live in `scripts/d1_migrate/lib/filters.mjs` (Tier 1-4, Rules 1-14) and `scripts/bulk_import/lib/dedup_in_memory.mjs` (Tier 5, Rules 15-19; `scripts/bulk_import/post_import_dedup.mjs` is the SQL equivalent, used only by the manual `clean_rebuild.mjs`). Rule numbers reflect execution order, not chronological invention. There is no remaining sync-time gap — the production sync orchestrator reuses the bulk-import loaders + `applyDedup`, so all 19 rules run on every sync (verified 2026-06-04, ledger T048).

**Filter rules — rejected proposals (DO NOT re-suggest — already considered and rejected 2026-05-14):**
- **Reject single-word generic names** (`name NOT LIKE '% %' AND brand IS NULL`) — these are legitimate international cuisine names: Sosaties, Tequeños, Yakisoba, Kombu, Escargot, Cassava, Hazelnuts, Mansaf, etc. Real high-value reference data. Keep.
- **Reject the `on_generic` cohort (8,922 rows)** — sample showed quality reference data: Jollof Rice with Beef, Bebek Betutu, Bibimbap, Pacific Mackerel, Curly Fries, etc. The recipe/homestyle backbone of OpenNutrition. Keep.
- **Reject `(0% moisture)` USDA Foundation Food rows (17 rows)** — real Foundation Food science data (dried-bean nutrition under USDA's 0%-moisture analysis). Tiny count, real data. Keep.
- **Reject all-caps generic names** (8+ consecutive uppercase letters, brand IS NULL) — legitimate SR Legacy entries where USDA stored the brand IN THE NAME in all-caps (`Candies, TWIZZLERS CHERRY BITES`, `Snacks, KRAFT, CORNNUTS`). Rule 3 title-case normalises them. Keep.
- **Reject branded rows with `serving_g IS NULL` (147,711 rows)** — macro data is still correct; users can log by grams. Lacking a portion is a search-UX problem, better solved by demoting in ranking than deletion. Keep.
- **Reject "kcal differs across cross-source UPCs" (~24K UPCs)** — real data conflicts, not duplicates. Picking the wrong source would propagate wrong nutrition values. Keep both pending manual review.
