# Account Deletion Lifecycle (Locked — updated June 12 2026)

How the two admin destructive buttons behave, the GDPR anonymization contract, and the MANDATORY rule that keeps both deletion paths complete.

## The two admin buttons (deliberately different outcomes)

Admin `/admin/user/:id` exposes two destructive actions:

**"Delete account" → anonymize (reversible 30 days, then permanent).**
- Calls `schedule_account_deletion(p_user_id)` → sets `profiles.scheduled_for_deletion_at = now() + 30 days`. (Users self-trigger the same from Settings with `null`.)
- During the grace the user can still authenticate, but every protected route renders the **reactivation gate** (`web/src/components/ReactivationGate.jsx` / `mobile/src/components/ReactivationGate.tsx`, mounted by the protected layouts when `scheduled_for_deletion_at` is non-null): name + days remaining + [Reactivate] (`cancel_scheduled_deletion()`) + [Sign out].
- At grace expiry the nightly cron `anonymize_expired_accounts` runs `anonymize_account_now(user_id)`.
- **NOT immediate** — it's a 30-day grace then a cron-driven anonymize, not an instant scrub.

**"Wipe out" → hard delete (zero trace, irreversible).**
- Admin-only, confirm word **"wipeout"**. Calls the `delete-user` edge function: cancels any Stripe sub FIRST (reads `stripe_subscription_id` before deleting the row), deletes every user-data table, deletes avatars, deletes the `profiles` row (cascades coach tables + fires `trg_wipe_account_traces` which clears `deleted_account_archive` + `messages_admin_access_log`), deletes `auth.users` LAST (cascades the rest). Leaves no archive, no anonymized shell — the account stops existing.

## `anonymize_account_now()` — what it does (one atomic txn)
1. **Archive PII** to `deleted_account_archive` (`original_email`/`_phone`/`_full_name`/`_birthdate`/`_gender`, `was_coach`/`was_admin`, `stripe_customer_id`, `anonymized_at`, `legal_hold_until = now()+10yr`).
2. **Scrub `profiles`**: `full_name='Deleted User'`, `phone`/`avatar_url`/`birthdate`/`gender`=NULL, `coach_id`=NULL, `is_self_coached=true`, `is_coach=false`, `coach_subscription_status='cancelled'`, `anonymized_at=now()`, clear the scheduled-deletion fields.
3. **Delete personal training data**: bodyweight, efforts, food_logs, calorie_logs, calorie_plans, hr_samples, step_samples, wearable_workouts, user_integrations, water_logs, sleep_sessions. (NOT `rom_records` — that table is dropped.)
4. **Scrub `coach_invites` both directions** (June 12 2026 fix): delete invites the user SENT (`coach_id = user`, which hold recipients' plaintext emails) AND invites sent TO the user (`invitee_email`/`invitee_phone` match the user's).
5. **Unlink coach's athletes** (if a coach): their `coach_id`→NULL, `is_self_coached`=true.
6. **Mark coach subs** `pending_cancel` (the Stripe intent layer picks it up).
7. **Scrub `auth.users`**: `email='deleted-<uuid>@anon.myrx.local'` (frees the original email for re-signup), `phone`=NULL, `banned_until='2099'`, and strip `email`/`phone`/`phone_verified`/`email_verified` **AND `full_name`/`name`/`first_name`/`last_name`/`display_name`** from `raw_user_meta_data` (the name keys were added June 12 2026 — they used to survive).
8. **Delete `auth.identities`** + write an `account:deleted` gravestone to `activity_events`.

**Retention contract — what survives anonymize (compliance):** `messages`, `messages_admin_access_log`, `activity_events`, `coach_subscriptions`, `billing_events`, `b2c_purchases`, `deleted_account_archive`. `billing_events` is NEVER deleted by anonymize (tax + dispute retention) — corrections are issued as NEW Stripe events, never edits/deletes of existing rows.

## FK completeness (June 12 2026 — migration `20260612_fix_account_deletion_completeness`)
The hard-wipe path relies on the final `auth.users` delete cascading every user-referencing table. Three columns had the wrong rule and were retrofitted:
- `billing_admin_access_log.admin_id` (was NO ACTION — **blocked** wiping an admin) + `billing_admin_access_log.target_id` (no FK — orphaned) → both `ON DELETE CASCADE`.
- `user_activity_events.actor_id` (was NO ACTION — **blocked** wiping a user who acted on others) → `ON DELETE SET NULL` (keeps the subject's event, drops the wiped actor).
- `user_b2c_tier` looked like a leak but is a **VIEW** over profiles + b2c_purchases — self-resolves when the profile row goes. No FK possible/needed.
Verified end-to-end: ran the exact `delete-user` sequence on test accounts → re-audited every user-ref column → zero traces.

## ⚠ MANDATORY — keep BOTH paths complete when adding tables (LOCKED June 12 2026)
Any NEW table with a user-referencing column (`user_id`, `coach_id`, `actor_id`, `target_id`, …) MUST at creation get the correct `ON DELETE` FK to `auth.users`/`profiles` — `CASCADE` for data the user OWNS, `SET NULL` for actor/causer refs on rows owned by OTHERS, and **never `NO ACTION`** (it orphans rows on Wipe-out AND can BLOCK the `auth.users` delete) — and be added to `anonymize_account_now()`'s delete block if it holds personal data to purge on anonymize (vs retained for compliance). After any such change, prove a Wipe-out leaves zero trace by re-running the user-reference audit (count every user-ref column for a test user_id; expect zero).

## Fresh signup with the same email after anonymize
The original email is freed (Step 7) → the person can sign up again: brand-new `auth.users` row + `user_id`, brand-new `profiles` row, zero link to the old (anonymized) data. The old anonymized shell stays under `deleted-<old-uuid>@anon.myrx.local` (banned). Industry standard (Google/Apple/Meta all allow email reuse after deletion).

## Stripe subscription pause / resume / cancel — intent layer (LOCKED May 28 2026)
Three "pending intent" timestamp columns on `coach_subscriptions` wire the deletion lifecycle to Stripe:

| Column | Set by | Cleared by | Phase-2 Stripe call |
|---|---|---|---|
| `pause_pending_at` | `schedule_account_deletion()` on coach accounts | orchestrator on success | `subscriptions.update(id, { pause_collection: { behavior: 'mark_uncollectible' } })` |
| `resume_pending_at` | `cancel_scheduled_deletion()` on coach accounts that had a pause pending / were paused | orchestrator on success | `subscriptions.update(id, { pause_collection: '' })` |
| `cancel_pending_at` | `anonymize_account_now()` on coach accounts with an active sub | orchestrator on success | `subscriptions.cancel(id)` |

`coach_subscriptions.status` allows `paused` + `pending_cancel`. **Phase 1 (shipped):** the RPCs MARK INTENT (set the timestamp, flip status, write a `billing:subscription_orchestrator_pending` activity_event) — **no Stripe API calls happen.** **Phase 2 (deferred):** a `stripe-subscription-orchestrator` (edge fn / cron) picks up rows with a `*_pending_at` set, calls the matching Stripe API, clears the column, logs to `billing_events`. Deferred because every Phase-2 call has real financial consequences; marking intent first gives a review checkpoint. The Phase-1 status flip to `pending_cancel` already protects the UI from showing an anonymized coach as actively billable.

## Activity feed + billing surface
- Trigger `billing_events_to_activity_events_trg` mirrors every `billing_events` insert into `activity_events` (`event_type = 'billing:' || type`), so the per-user Activity Feed shows invoices/refunds/changes/disputes without reading two tables.
- `<BillingView userId viewer="user"|"admin" />` is one component in three places (admin `/admin/user/:id` Billing tab; coach `/coach/profile` Billing; athlete Settings → Billing, Phase 7). Two sections: **Current** (adaptive header — coach sub tier/status/renewal, or amber "anonymized, tax records retained" banner) + **Transactions** (chronological `billing_events`, grouped by month, tone-coded icons, deep-link to Stripe). Reads `profiles` + `coach_subscriptions` + `billing_events` directly; RLS enforces access.
