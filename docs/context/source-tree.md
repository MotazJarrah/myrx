# Source Tree & Design Patterns (Reference)

Standalone reference for MyRX's key file source tree and shared design patterns, extracted verbatim from the project CONTRACT doc (CLAUDE.md). Accuracy is critical — paths and snippets are preserved exactly as written.

---

## Source Tree (key files)

### End-user shell & components
```
src/components/Navbar.jsx          — AppShell wrapper: sidebar, mobile nav,
                                     floating chat + suggestion buttons, drawers
src/components/ChatDrawer.jsx      — Slide-up chat panel (only when chat_enabled)
src/components/SuggestionDrawer.jsx — Slide-up suggestion panel (always available)
src/components/TickerNumber.jsx    — Animated number counter
src/contexts/AuthContext.jsx       — Supabase auth + profile
src/contexts/ThemeContext.jsx      — Light/dark toggle
```

### End-user pages
```
src/pages/Dashboard.jsx      — Profile card with animated stat pills, training streak,
                               monthly PRs, member-since badge
src/pages/Strength.jsx
src/pages/Cardio.jsx
src/pages/Bodyweight.jsx
src/pages/Calories.jsx
src/pages/History.jsx
src/pages/EditProfile.jsx    — Profile tab + Settings tab (units, body stats,
                               messaging Enter preference, appearance/theme)
src/pages/Auth.jsx
src/pages/Landing.jsx
```

### Admin shell & pages
```
src/pages/admin/AdminShell.jsx      — Sidebar nav with live unread-message badge
                                      + goals-reached badge on Weight Goal Progress.
                                      All sign-out buttons styled destructive red
                                      (text-destructive hover:bg-destructive/10).
src/pages/admin/AdminOverview.jsx   — Dashboard: stats tiles, needs-attention list
src/pages/admin/AdminDashboard.jsx  — Client roster: stat tiles (TickerNumber),
                                      filter tabs, sort dropdown, rich client rows
                                      with animate-ping status dots
src/pages/admin/AdminUserDetail.jsx — Per-client detail: tabs (Profile/Efforts/
                                      Bodyweight/Calories), snapshot badges,
                                      chat_enabled toggle button
src/pages/admin/AdminProgress.jsx   — Weight goal progress cards for all clients
src/pages/admin/AdminNutrition.jsx  — 7-day calorie compliance grid
src/pages/admin/AdminFeed.jsx       — Activity feed (last 2 months, filterable)
src/pages/admin/AdminMessages.jsx   — Two tabs: Messages (split-view chat) +
                                      Suggestions (flat feed of all client suggestions)
src/pages/admin/AdminProfile.jsx    — Admin's own profile/settings
src/pages/admin/AdminMovements.jsx  — Movement library CRUD. Add form hidden behind
                                      a dashed "+ Add movement" button (addOpen state).
                                      Clicking opens form with X to close + Cancel button.
                                      Auto-closes 2s after successful save.
                                      Edit: tap any row → full edit form replaces list view.
src/pages/admin/AdminFoodLibrary.jsx — Food library CRUD for admin-managed ('myrx') foods.
                                       Search bar works on name OR UPC with progressive
                                       UPC results (3+ digits trigger prefix search).
                                       Add / Edit / Delete via manual form (FoodForm).
                                       UPC is a text input on the form — entering one
                                       classifies the row as 'branded'; leaving it blank
                                       classifies it as 'generic' (universal data_type rule).
                                       Barcode scan IS wired (verified Jun 2026 — the older
                                       "scan removed, type UPCs by hand" note was stale): a
                                       "Scan barcode" button in the Add panel, shown ONLY on
                                       touch devices via window.matchMedia('(pointer: coarse)')
                                       (phone camera — a laptop webcam isn't a useful scanning
                                       surface), which is why it appears on phone Chrome but not
                                       desktop. It opens <BarcodeScanner> (components/
                                       BarcodeScanner.jsx); on a read, handleBarcodeScan looks
                                       the UPC up in food_library first, else fetches
                                       /api/off-search (the OpenFoodFacts proxy Pages Function)
                                       and pre-fills the Add panel, running the data through
                                       foodFilters.js (enrichFood / getFilterReason).
                                       This page does NOT use lib/foodLibrary.js — that's the
                                       separate (now-unused) food-LOG search engine.
src/pages/admin/tabs/              — AdminUserProfile, AdminUserActivity,
                                      AdminUserBody, AdminUserCalories
```

### Calorie / Food logging components
```
FoodLogDrawer.jsx was deleted Jun 2026 — the web bottom-sheet food logger had
no consumers (food logging is mobile-only; the athlete-web pages were removed
earlier). Its only live content — the meal-slot DATA exports (DEFAULT_SLOTS /
ANCHOR_IDS / EXTRA_PRESETS, imported by the admin/coach MealLayoutEditor) — was
moved to src/lib/mealSlots.js. CalorieStrip.jsx was deleted earlier (May 28
2026) in the same kind of web-orphan cleanup.
```

### Lib
```
src/lib/supabase.js         — Supabase client
src/lib/calorieFormulas.js  — calcFullPlan, toKg, etc.
src/lib/cache.js            — dataCache (simple in-memory cache for admin feed)
(src/lib/foodLibrary.js was deleted Jun 2026 — it was the food-LOG search engine
 for the deleted FoodLogDrawer; nothing on web imported it. The admin Food Library
 page's barcode scanner uses BarcodeScanner.jsx + /api/off-search + foodFilters.js,
 NOT this. Restore from git if a future food feature needs the USDA/D1 worker search.)
```

> Web dead-code cleanup batch (Jun 2026) — knip-driven + build-verified. Removed:
>   • Dead files: App.css, lib/planPresets.js (BodyCompPicker carries its own bands
>     since the T110 rewrite), lib/profile.js (the web athlete ProtectedLayout that
>     gated on isProfileComplete is gone — mobile src/lib/profile.ts is the live
>     copy now), components/FoodLogDrawer.jsx (its only live content, the meal-slot
>     data exports, moved to lib/mealSlots.js), lib/foodLibrary.js (the food-LOG
>     search engine — only the dead FoodLogDrawer used it; the admin Food Library
>     scanner uses BarcodeScanner + /api/off-search + foodFilters, a separate path).
>   • EditProfile.jsx: the unrouted SettingsTab + default export + their private
>     helpers (UnitCard/TabBtn/heightToDisplay) + orphaned imports. Only the live
>     ProfileTab named export remains (imported by AccountSettings).
>   • ~18 unused lib exports deleted + ~8 used-only-internally symbols un-exported
>     across authErrors / calorieFormulas / chartTooltipScope / cookieConsent /
>     countries / foodFilters / formulas / imageUtils / movements / serverError.
>   • package.json: dropped unused deps clsx, tslib, sharp; added the
>     previously-unlisted libphonenumber-js (used by ProfileTab's phone field).
>   • KEPT despite knip flagging them (NOT dead — do not remove): functions/api/
>     off-search.js + public/sw.js (runtime-invoked, never imported);
>     src/hooks/useIsPhone.js (locked May 27 2026 as the REQUIRED route-gate hook —
>     unused now but mandated going forward).

> Web-orphan cleanup batch (May 28 2026) deleted these formerly-mentioned web
> files. None are referenced by the live app anymore:
>   • pages/AboutMyRX, pages/admin/AdminSettings,
>     pages/admin/tabs/AdminUserPlan, pages/coach/Portal
>   • components/CalorieStrip, LoadingScreen, MessageActions, NumericInput,
>     PhantomWheel, PlanWizardSheet, Skeleton
>   • lib/usda, lib/opennutrition, lib/projections, lib/signupResume, lib/effortTags
> All replacements live elsewhere — MacroPlanEditor replaces AdminUserPlan,
> foodLibrary replaces usda+opennutrition, formulas replaces projections, the
> mobile copies of PhantomWheel + MessageActions + effortTags are the live
> versions (web copies were never wired up).

---

## Design Patterns

### Theming
- Dark mode default (`:root`), light mode = `.light` on `<html>`
- Use Tailwind design tokens: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`
- Never hardcode dark colors

### Status dots (AdminDashboard)
`animate-ping` expanding-ring pattern (NOT `animate-pulse`):
```jsx
<span className="relative flex h-3 w-3">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
    style={{ backgroundColor: color, animationDuration: '1s' }} />
  <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-card"
    style={{ backgroundColor: color }} />
</span>
```
- 🟢 Green (active ≤7d): `animationDuration: '1s'`
- 🟡 Amber (semi-active): `animationDuration: '2s'`
- 🔴 Red (inactive): `animationDuration: '0.75s'`
- ⚫ Grey (new account, no activity yet): static dot, no animation

### Account-age-aware inactivity logic
```js
function computeStatus(lastActive, accountAgeDays) {
  if (lastActive) {
    const daysSince = (Date.now() - new Date(lastActive)) / 86_400_000
    if (daysSince <= 7) return 'green'
    if (accountAgeDays < 7) return 'new'
    return daysSince <= Math.min(14, accountAgeDays) ? 'amber' : 'red'
  }
  return accountAgeDays < 7 ? 'new' : 'red'
}
```
New accounts (<7 days) are never flagged as inactive in AdminOverview needs-attention either.

### Animated number tiles
Use `<TickerNumber value={n} />` for any count/stat display that should animate on mount.
