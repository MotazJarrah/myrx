# MyRX — Project Context

## Working Relationship
- **You are the programmer. The user is the product manager.**
- At the start of every new session, read this file top to bottom, then ask the user what they'd like to work on.
- Begin the task immediately. Do NOT ask about the next task while one is in progress.

---

## What This Is
A React + Vite SPA — a fitness coaching platform. Clients track strength, cardio, mobility, bodyweight, and calories. Admins (coaches) manage clients, review progress, and communicate via chat/suggestions.

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS v3, Wouter v3 (routing), Lucide React (icons)
- **Auth/DB**: Supabase (project: `xtxzfhoxyyrlxslgzvty`)
- **Hosting**: Cloudflare Pages
- **Fonts**: Geist + Geist Mono (via Google Fonts)
- **Charts**: Recharts

## Live URL
https://myrx-bwl.pages.dev

## Deployment
```powershell
# From C:\Users\motaz\OneDrive\Desktop\MyRX
npm run build
npx wrangler pages deploy dist --project-name myrx
```
Env vars are already set in the shell profile. No need to set them manually.

## Cloudflare Details
- Account ID: `d42e96189bfa3cacb2aaab8231eb0097`
- Project name: `myrx`
- API Token: `cfut_0r7HbpfSYxmY62cpYEGjSWKeEyqTFprvZB0PgA8Y2de36fa9`

## Supabase
- Project ID: `xtxzfhoxyyrlxslgzvty`
- Site URL: `https://myrx-bwl.pages.dev`
- MCP server is connected — use `mcp__8dbdae5c-*` tools for DB operations

---

## Source Tree (key files)

### End-user shell & components
```
src/components/Navbar.jsx          — AppShell wrapper: sidebar, mobile nav, beta banner,
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
src/pages/Mobility.jsx       — ROM tracking
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
                                      + goals-reached badge on Weight Goal Progress
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
src/pages/admin/tabs/              — AdminUserProfile, AdminUserActivity,
                                      AdminUserBody, AdminUserCalories
```

### Lib
```
src/lib/supabase.js         — Supabase client
src/lib/calorieFormulas.js  — calcFullPlan, toKg, etc.
src/lib/cache.js            — dataCache (simple in-memory cache for admin feed)
```

---

## Database Schema (key tables)

### `profiles`
Extends `auth.users`. Key columns:
- `id` (uuid, PK = auth user id)
- `full_name`, `email`, `phone`, `birthdate`, `gender`
- `avatar_url` (text)
- `weight_unit` ('lb'|'kg'), `height_unit` ('imperial'|'metric'), `distance_unit` ('mi'|'km')
- `current_weight`, `current_height`
- `is_superuser` (bool) — admin flag
- `chat_enabled` (bool, default false) — admin-controlled per client; gates chat UI
- `created_at`

### `efforts`
- `id`, `user_id`, `label`, `type` ('strength'|'cardio'), `value`, `created_at`

### `rom_records`
- `id`, `user_id`, `movement_key`, `degrees`, `created_at`

### `bodyweight`
- `id`, `user_id`, `weight`, `unit`, `created_at`

### `calorie_logs`
- `id`, `user_id`, `log_date` (date), `calories`

### `calorie_plans`
- `user_id`, `starting_weight_kg`, `goal_weight_kg`, `goal_reached` (bool), + plan params

### `messages`
- `id` (uuid PK)
- `user_id` (uuid) — always the CLIENT's user id (never the admin's)
- `from_admin` (bool) — true = admin sent it, false = client sent it
- `body` (text)
- `is_suggestion` (bool, default false) — suggestion vs normal message
- `read` (bool, default false)
- `created_at`
- **RLS**: clients can see/insert own rows (`user_id = auth.uid()`). Superusers bypass RLS and see all.

### RPC functions
- `get_users_for_admin()` — returns all client profiles (id, full_name, email, avatar_url, weight_unit, current_weight, created_at, is_superuser, etc.)
- `get_user_for_admin(p_user_id uuid)` — single client profile
- `upsert_profile(...)` — upsert own profile

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

---

## Chat & Suggestions System

### Architecture
- **`chat_enabled`** on `profiles` is the master gate. Admin toggles it per client from `AdminUserDetail`. Default: `false`.
- When `false`: client sees only the Suggestion button (amber, always visible).
- When `true`: client sees both Suggestion button (amber) and Chat button (blue).

### End-user UI (Navbar.jsx)
- **Beta banner**: scrolling marquee at very top (dismissible, stored in `localStorage` key `myrx_beta_dismissed`)
- **Suggestion button**: amber circle, always shown, opens `SuggestionDrawer`
- **Chat button**: blue circle, only when `chat_enabled`, opens `ChatDrawer`, shows unread badge
- Both drawers slide up from the bottom

### SuggestionDrawer
- Shows the client's OWN past suggestions (private — other clients can't see each other's)
- Entry field at bottom; Enter-to-send preference respected
- Messages inserted with `is_suggestion: true`

### ChatDrawer
- Non-suggestion messages only (`is_suggestion: false`)
- Header: "Coach [FirstName]" — first name fetched from `profiles where is_superuser = true`
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

---

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

---

## LocalStorage Keys
| Key | Purpose |
|-----|---------|
| `myrx_beta_dismissed` | Beta banner dismissed flag |
| `myrx_enter_to_send` | `'false'` = Enter for new line; default = Enter sends |
| `admin-user-tab-{id}` | Last active tab per user in AdminUserDetail |

---

## Known Patterns / Gotchas
- **Supabase RPC return type changes** require `DROP FUNCTION` first then `CREATE OR REPLACE` — can't just alter the return type.
- **Realtime channels**: always `supabase.removeChannel(channel)` in cleanup. Use specific event types (`INSERT`, `UPDATE`) rather than `'*'` for reliability.
- **Calorie logs** use `log_date` (date-only). When converting to timestamps use `T00:00:00.000Z` suffix so they're always in the past.
- **Supabase MCP tool** (`mcp__8dbdae5c-*`) is available — prefer it for migrations over raw SQL in bash.
- **AdminFeed** uses `dataCache` to avoid re-fetching on every visit.
- **Avatar**: if `avatar_url` is set, show `<img>` instead of initials — applies to ALL admin list views (clients, progress, nutrition, feed, messages, UserDetail).

---

## What's Been Built (complete feature list)

### Core tracking
- [x] Strength logging (sets × reps × weight, 1RM estimates)
- [x] Cardio logging (distance, time, pace)
- [x] Mobility / ROM tracking with ROMVisualizer
- [x] Bodyweight tracking with charts
- [x] Calorie logging with daily targets
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

### Chat & suggestions
- [x] `messages` table with RLS
- [x] `chat_enabled` column on profiles
- [x] Beta banner (scrolling marquee, dismissible)
- [x] Suggestion button (amber, always visible)
- [x] Chat button (blue, gated by chat_enabled)
- [x] ChatDrawer with Coach [FirstName] header, realtime
- [x] SuggestionDrawer with own-suggestions feed, realtime
- [x] Admin chat_enabled toggle in AdminUserDetail
- [x] AdminMessages two-tab layout with badge counts, realtime

### Infrastructure
- [x] Migrated Netlify → Cloudflare Pages
- [x] Supabase MCP connected
- [x] get_users_for_admin RPC returns avatar_url
