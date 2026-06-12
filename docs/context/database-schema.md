# Database Schema — Key Tables (Reference)

Key Supabase tables + RPC functions (project `xtxzfhoxyyrlxslgzvty`). **`profiles` has NO `email` column — email lives on `auth.users`.**

## `profiles`
Extends `auth.users`. Key columns:
- `id` (uuid, PK = auth user id), `auth_user_id` (uuid, mirrors id)
- `full_name`, `phone`, `birthdate`, `gender`, `avatar_url`
- **`email` is NOT a column on `profiles`** — it lives on `auth.users`. End-user reads get it from the auth session (`user.email`); the admin mirror gets it via `get_user_for_admin` (which hydrates email from `auth.users`). This is why AdminUserDetail's realtime merge does `setProfile(prev => ({ ...prev, ...payload.new }))` — the realtime `profiles` row carries no email, so the spread keeps the RPC-hydrated `prev.email`.
- `weight_unit` ('lb'|'kg'), `height_unit` ('imperial'|'metric'), `distance_unit` ('mi'|'km'), `fluid_unit` ('oz'|'mL'), `swim_unit` ('yd'|'m'), `date_format` ('mdy'|'dmy') — the last three are NOT in `upsert_profile`; written via a direct `profiles` update batch
- `body_fat_band` ('lean'|'average'|'high'), `meal_slots_default` (jsonb), `current_weight`, `current_height`
- `share_online_status` (bool, default true), `share_last_seen` (bool, default true) — chat privacy ACLs
- `phone_verified_at`, `biometric_disabled_at` — admin remote-security actions
- `is_superuser` (bool) — admin flag
- `admin_chat_enabled` (bool) — gates ADMIN↔client chat per client. **`chat_enabled` was DROPPED in chat v3 (May 30 2026)** — coach↔client chat is unconditional now (the `coach_id` link itself is the permission). Any code writing `chat_enabled` errors with undefined-column.
- **Coach columns:** `is_coach`, `is_self_coached`, `coach_id` (uuid → profiles = the athlete's coach), `coach_bio`, `coach_specialties` (array), `coach_subscription_status`, `coach_subscription_tier`, `coach_trial_ends_at`, `coach_stripe_customer_id`, `macros_managed_by_coach`, `previously_had_coach`, `coach_change_acknowledged_at`, `coach_lost_banner_dismissed_at`
- **Deletion-lifecycle columns:** `scheduled_for_deletion_at`, `scheduled_for_deletion_by`, `anonymized_at`, `anonymized_by`
- `created_at`
- **Settings realtime (T111, locked Jun 2026):** changes to any settings column reflect LIVE on every open settings surface, both directions. Web + mobile AuthContext subscribe to the user's OWN row (`profile-self-${id}`); AdminUserDetail subscribes to the viewed CLIENT's row. Tab components carry a diff-based `useEffect([profile])` that re-derives ONLY externally-changed fields (vs a `useRef` snapshot) so toggles flip without clobbering in-progress local edits.

## Core data tables
- **`efforts`** — `id`, `user_id`, `label`, `type` ('strength'|'cardio'), `value`, `created_at`
- **`bodyweight`** — `id`, `user_id`, `weight`, `unit`, `created_at`
- **`calorie_logs`** (legacy) — `id`, `user_id`, `log_date` (date), `calories`. Kept for historical data; admin "Manual Logs" tab still reads it.
- **`food_logs`** — per-item food log (replaces calorie_logs for new intake). `id`, `user_id` (FK → auth.users), `log_date`, `meal_slot` ('breakfast'|'lunch'|'dinner'|'snacks'), `food_name`, `brand_name`, `fdc_id`, `portion_label`, `portion_qty`, `portion_g`, `calories`, `protein_g`, `fat_g`, `carbs_g`, `created_at`. Index `(user_id, log_date)`. RLS: users own rows.
- **`calorie_plans`** — `user_id`, `starting_weight_kg`, `goal_weight_kg`, `goal_reached` (bool), + plan params
- **`messages`** — `id`, `user_id` (always the CLIENT's id), `from_admin` (bool), `body`, `is_suggestion` (bool), `read` (bool), `created_at`. RLS: clients see/insert own rows; superusers bypass.
- **`food_library`** — admin/USDA/ON foods. `id`, `source` ('myrx'|'usda'|'on'), `source_id`, `name`, `brand`, `kcal`/`protein_g`/`fat_g`/`carbs_g` (per 100g), `serving_g`, `serving_label`, `servings_per_container`, `upc` (indexed), `data_type`, audit cols. RLS: admins write, all authenticated SELECT. (Full architecture → `docs/context/food-library.md`.)
- ⚠ **`rom_records` was DROPPED** (migration `20260603d_drop_rom_records.sql`) — mobility ROM tracking was removed. Any reference to it is stale.

## Newer tables (deletion / billing / wearables / events)
Mapped during the June 12 2026 account-deletion audit. Brief purposes (full FK/delete-rule contract → `docs/context/account-deletion-lifecycle.md`):
- **`deleted_account_archive`** — PII archive written by `anonymize_account_now()` (`original_email`/`_phone`/`_full_name`/`_birthdate`/`_gender`, `was_coach`, `legal_hold_until` ~10 yr, `anonymized_at`). GDPR-retention. Cleared on hard wipe via the `trg_wipe_account_traces` trigger.
- **`coach_subscriptions`** — `coach_id`, `stripe_subscription_id`, `status`, `pause_pending_at`/`resume_pending_at`/`cancel_pending_at` (the Stripe lifecycle intent layer). Retained on anonymize (tax). CASCADE from profiles.
- **`coach_invites`** — `coach_id`, `invitee_email`, `invitee_phone`, `accepted_by`, `coach_message`. CASCADE from profiles; scrubbed both directions on anonymize.
- **`credential_history`** — `profile_id`, `email`, `phone` — credential-change history (re-signup detection). CASCADE from profiles.
- **`billing_events`** — `user_id` (SET NULL) — immutable Stripe billing history (invoices/charges/refunds/disputes). NEVER deleted by anonymize (tax); explicitly deleted by hard wipe.
- **`billing_admin_access_log`** — `admin_id`, `target_id` — audit of admin billing access. (June 12 2026: both → `ON DELETE CASCADE`.)
- **`activity_events`** — `user_id`, `caused_by` (SET NULL), `event_type`, `event_data` — per-user audit feed; mirrors `billing_events` via the `billing_events_to_activity_events_trg` trigger (`event_type = 'billing:' || type`).
- **`user_activity_events`** — `user_id`, `actor_id` — admin activity log. (June 12 2026: `actor_id` → `SET NULL`.)
- **`b2c_purchases`** — `user_id` (CASCADE from profiles) — athlete B2C purchases.
- **`user_b2c_tier`** — a **VIEW** over `profiles` + `b2c_purchases` computing `effective_tier` ('free'|'corerx'|'fullrx'). NOT a table — self-resolves on profile delete.
- **Wearable / health** (Health Connect Phase 1): `hr_samples`, `sleep_sessions`, `sleep_stages`, `step_samples`, `water_logs`, `wearable_workouts`, `user_integrations` — all `user_id` → auth.users CASCADE.

## RPC functions
- `get_users_for_admin()` — all client profiles. Columns (verified Jun 9 2026): id, full_name, email, gender, birthdate, current_weight, weight_unit, current_height, height_unit, created_at, has_plan, avatar_url, deactivated_at, is_self_coached, last_seen_at, share_online_status, share_last_seen, scheduled_for_deletion_at, anonymized_at. (Hydrates `email` from auth.users; does NOT return `is_superuser`.) **When mobile adds a new `profiles` column that a web admin/coach surface reads, this RPC's hand-written column list MUST be extended or the web silently shows defaults.**
- `get_user_for_admin(p_user_id uuid)` — single client profile.
- `upsert_profile(...)` — upsert own profile.
- `get_coach_info()` — SECURITY DEFINER; returns `{ full_name, avatar_url, last_seen_at, share_online_status }` of the caller's linked coach (via `profiles.coach_id`), falling back to the superuser when no coach. NULL when neither. **v2 locked May 26 2026.** When changing return shape, `DROP FUNCTION` first.
- `schedule_account_deletion(p_user_id)` / `cancel_scheduled_deletion()` / `anonymize_account_now(p_user_id)` — the deletion lifecycle RPCs (→ `docs/context/account-deletion-lifecycle.md`).

**Gotchas:** RPC return-type changes need `DROP FUNCTION` first (can't alter return type). SECURITY DEFINER functions need `SET search_path = public`. Realtime channels: always `supabase.removeChannel()` in cleanup; use specific event types (`INSERT`/`UPDATE`) not `'*'`.
