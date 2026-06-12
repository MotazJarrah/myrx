# Chat, Suggestions & Admin Portal (Reference)

Reference for MyRX's coach↔client chat + suggestions system, the admin (coach) portal pages, the app's LocalStorage keys, and the historical built-feature inventory. Consolidated from CLAUDE.md — this is the project contract doc, so every rule, RPC name, table/column reference, and feature entry is preserved verbatim.

## Chat & Suggestions System

### Architecture
- **`chat_enabled`** on `profiles` is the master gate. Admin toggles it per client from `AdminUserDetail`. Default: `false`.
- When `false`: client sees only the Suggestion button (amber, always visible).
- When `true`: client sees both Suggestion button (amber) and Chat button (blue).

### End-user UI (Navbar.jsx)
- **Suggestion button**: amber circle, always shown, opens `SuggestionDrawer`
- **Chat button**: blue circle, only when `chat_enabled`, opens `ChatDrawer`, shows unread badge
- Both drawers slide up from the bottom

### SuggestionDrawer
- Shows the client's OWN past suggestions (private — other clients can't see each other's)
- Entry field at bottom; Enter-to-send preference respected
- Messages inserted with `is_suggestion: true`

### ChatDrawer
- Non-suggestion messages only (`is_suggestion: false`)
- Header: coach avatar (if uploaded) + "Coach [FirstName]" label
  - Avatar + name fetched via `get_coach_info()` RPC (SECURITY DEFINER — bypasses RLS)
  - Fallback: MessageCircle icon if no avatar set
  - **Do NOT add photos to individual message bubbles** — avatar only in header
- Admin messages marked read on open
- Realtime subscription via Supabase channel

### Admin UI (AdminMessages.jsx)
- **Messages tab**: split-view (client list left, conversation right). Marks client messages read optimistically on select. Realtime via Supabase channel.
- **Suggestions tab**: flat feed of ALL client suggestions across all clients (admin can see all).
- Badge counts on each tab (unread messages, unread suggestions).
- AdminShell sidebar: Messages nav item shows unread count badge. Weight Goal Progress nav item shows green badge = count of clients with `goal_reached = true`.

### Enter-to-send preference
- LocalStorage key: `myrx_enter_to_send` (`'false'` = Enter for new line; anything else / missing = Enter sends)
- Toggled in `EditProfile` Settings tab → "Messaging" section
- Respected in ChatDrawer, SuggestionDrawer, and AdminMessages reply box

## Admin Portal Overview

### Access
Admins (`is_superuser = true`) see an "Admin Portal" button in the client nav, or are routed directly to `/admin/*`.

### AdminDashboard (`/admin/clients`)
- 6 stat tiles with TickerNumber: Total Clients, Active This Week, Needs Attention, PRs This Week, On a Streak, Nutrition On Track
- Filter tabs: All / Needs Attention / On Fire / No Plan
- Sort: Last active, Streak, Goal progress, Name A–Z
- Rich client rows: avatar, name, email, status dot (animate-ping), flag pills, stats strip, mini goal progress bar

### AdminOverview (`/admin/overview`)
- Quick stats
- Needs-attention list (account-age-aware — new accounts not flagged)
- Avatar photos displayed throughout

### AdminUserDetail (`/admin/user/:id`)
- Tabs: Profile | Efforts | Bodyweight | Calories
- Profile card: avatar, name, email, age/gender/weight/height, snapshot badges (training streak, monthly PRs, strength/cardio/mobility PRs, nutrition streak, weigh-ins)
- **Chat toggle button** in top-right of profile card: "Chat off" / "Chat on" — updates `profiles.chat_enabled`

## LocalStorage Keys

| Key | Purpose |
|-----|---------|
| `myrx_enter_to_send` | `'false'` = Enter for new line; default = Enter sends |
| `admin-user-tab-{id}` | Last active tab per user in AdminUserDetail |

## Built feature inventory (historical)

This is a historical feature inventory carried over from CLAUDE.md's "What's Been Built (complete feature list)" section.

### Core tracking
- [x] Strength logging (sets × reps × weight, 1RM estimates)
- [x] Cardio logging (distance, time, pace)
- [x] ~~Mobility / ROM tracking with ROMVisualizer~~ — REMOVED June 2026 (legacy; rom_records table retained, no UI)
- [x] Bodyweight tracking with charts
- [x] Calorie logging with daily targets
- [x] **Food logging** — USDA FoodData Central search, per-item entries in `food_logs`,
      FoodLogDrawer bottom-sheet (search → portion picker → log), TodayIntakeCard with
      segmented horizontal macro bar, CalorieStrip now sums from `food_logs`
- [x] Admin "Food Log" sub-tab on client Calories tab (grouped by date + meal slot)
- [x] Full history page

### Profile & Settings
- [x] Avatar upload / remove
- [x] Unit preferences (weight lb/kg, height ft/cm, distance mi/km) with auto-conversion
- [x] Body stats (auto-creates bodyweight log entry on weight change)
- [x] Light / dark mode toggle
- [x] Enter-to-send preference (Messaging section in Settings)
- [x] Email change flow

### Dashboard
- [x] Profile card with animated pill badges: training streak (blue), monthly PRs (amber), member-since (neutral)
- [x] TickerNumber animations on all stats

### Admin portal (complete)
- [x] AdminOverview — stats + needs-attention (account-age-aware)
- [x] AdminDashboard — full coaching roster with tiles, filters, sort, status dots
- [x] AdminProgress — weight goal progress bars per client
- [x] AdminNutrition — 7-day calorie compliance grid
- [x] AdminFeed — filterable activity feed (last 2 months)
- [x] AdminUserDetail — full client view with snapshot badges + chat toggle
- [x] AdminMessages — Messages tab (split-view) + Suggestions tab (flat feed)
- [x] Admin sidebar unread badge (messages) + goals-reached badge (progress)
- [x] AdminMovements — movement library with add-behind-button UX, swipe-delete, edit
- [x] AdminFoodLibrary — food library with name+UPC search, barcode scan, detail panel,
      progressive UPC results, scan result cards, CRUD for myrx foods

### Chat & suggestions
- [x] `messages` table with RLS
- [x] `chat_enabled` column on profiles
- [x] Suggestion button (amber, always visible)
- [x] Chat button (blue, gated by chat_enabled)
- [x] ChatDrawer with Coach [FirstName] header + coach avatar (header only, not on bubbles), realtime
- [x] `get_coach_info()` RPC (SECURITY DEFINER) — returns coach full_name + avatar_url to end users
- [x] SuggestionDrawer with own-suggestions feed, realtime
- [x] Admin chat_enabled toggle in AdminUserDetail
- [x] AdminMessages two-tab layout with badge counts, realtime
- [x] All admin sign-out buttons styled destructive red

### Infrastructure
- [x] Migrated Netlify → Cloudflare Pages (deploy via `wrangler pages deploy`, NOT git push)
- [x] Supabase MCP connected
- [x] get_users_for_admin RPC returns avatar_url
- [x] `food_logs` table + RLS + index (migration: `supabase/migrations/20260501_food_logs.sql`)
