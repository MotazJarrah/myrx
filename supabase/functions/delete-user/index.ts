// delete-user
//
// Hard-deletes a user from the platform — wipes EVERYTHING attached
// to that account so no orphaned PII or training data is left behind.
//
// Why "hard delete":
//
//   The admin portal exposes this function as a destructive Delete
//   button in the client roster. The user model has historically been
//   "deleteUser just removes the auth.users row" — but every business
//   table (bodyweight, efforts, calorie_logs, food_logs, hr_samples,
//   wearable_workouts, messages, profiles, …) has a user_id FK with
//   NO ON DELETE CASCADE, so the old function left a graveyard of
//   orphan rows that:
//
//     • broke the get_users_for_admin RPC (joins on profiles missed),
//     • leaked the deleted user's PII (full_name, phone, email lived
//       on in profiles.email even after auth.users vanished),
//     • kept billing alive (coach_subscriptions row still pointed at
//       a live Stripe subscription that kept charging the card on
//       file every cycle — actively harmful),
//     • broke the "they can re-sign-up with the same email" path
//       because the credential_history table still had their PII.
//
//   Per CLAUDE.md scenario (g): "if the user is deleted, we should
//   have no credentials or data for them in supabase, which means
//   they go through all steps again."
//
// Order of operations matters:
//
//   1. Verify caller is a superuser (RLS bypass requires it).
//   2. Look up active Stripe subscription on coach_subscriptions FIRST
//      — we need stripe_subscription_id BEFORE we delete the row that
//      holds it. Cancel via Stripe API so the customer's card isn't
//      billed after we wipe their account.
//   3. Delete from every business table that has user_id / coach_id
//      / profile_id columns. These tables do NOT have CASCADE FKs to
//      profiles, so they need explicit DELETEs.
//   4. Delete avatar storage objects (avatars bucket).
//   5. Delete profiles row. The CASCADE FKs on b2c_purchases,
//      coach_invites, coach_subscriptions, credential_history fire
//      here. profiles.coach_id on OTHER profiles is SET NULL (so
//      this coach's clients have their coach_id nulled out cleanly).
//   6. Delete auth.users row LAST. By the time we get here, every
//      reference is gone so the auth deletion is clean.
//
// Errors are not fatal mid-deletion. If a single table DELETE fails
// (e.g. transient network error), we log it and continue — partial
// cleanup is better than a half-deleted account. The function returns
// a per-table breakdown so the admin can see exactly what was wiped.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Stripe helpers (Deno-native, mirror coach-signup conventions) ──
const STRIPE_MODE   = Deno.env.get('STRIPE_MODE') ?? 'test'
const STRIPE_SECRET = STRIPE_MODE === 'live'
  ? Deno.env.get('STRIPE_SECRET_KEY_LIVE') ?? ''
  : Deno.env.get('STRIPE_SECRET_KEY_TEST') ?? ''
const STRIPE_API    = 'https://api.stripe.com/v1'

async function stripeCancelSubscription(subscriptionId: string): Promise<{ ok: boolean; status?: string; detail?: string }> {
  if (!STRIPE_SECRET) return { ok: false, detail: 'STRIPE_SECRET not configured' }
  try {
    const res = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
      method: 'DELETE', // Stripe REST: DELETE /v1/subscriptions/{id} cancels immediately
      headers: {
        Authorization:  `Basic ${btoa(STRIPE_SECRET + ':')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      // 404 = already cancelled / never existed; treat as ok so we
      // don't block the user-delete on Stripe-side cleanup that's
      // already done.
      if (res.status === 404) return { ok: true, status: 'not_found' }
      return { ok: false, detail: `${res.status} ${text}` }
    }
    const body = await res.json()
    return { ok: true, status: body?.status || 'cancelled' }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}

// Tables that hold user data but do NOT have an ON DELETE CASCADE
// FK back to profiles. These need explicit DELETE WHERE user_id = ?
// passes BEFORE we drop the profiles row.
//
// Order doesn't matter within this list (no inter-table FKs that
// require sequencing — hr_samples.workout_id is SET NULL, not CASCADE,
// so wearable_workouts can delete first without breaking).
const USER_DATA_TABLES: ReadonlyArray<{ table: string; column: string }> = Object.freeze([
  { table: 'bodyweight',        column: 'user_id' },
  { table: 'calorie_logs',      column: 'user_id' },
  { table: 'calorie_plans',     column: 'user_id' },
  { table: 'efforts',           column: 'user_id' },
  { table: 'food_logs',         column: 'user_id' },
  { table: 'hr_samples',        column: 'user_id' },
  { table: 'messages',          column: 'user_id' },
  { table: 'step_samples',      column: 'user_id' },
  { table: 'user_integrations', column: 'user_id' },
  { table: 'wearable_workouts', column: 'user_id' },
])

// Tables that DO cascade from profiles — for the result summary
// only. We don't issue explicit DELETEs against these; they go
// when the profiles row goes.
const CASCADE_TABLES = Object.freeze([
  'b2c_purchases',
  'coach_invites',
  'coach_subscriptions',
  'credential_history',
])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405)

  try {
    // ── Step 1: Auth + authz ──────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'unauthorized' }, 401)

    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await callerClient.auth.getUser()
    if (authErr || !user) return json({ error: 'unauthorized' }, 401)

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('is_superuser')
      .eq('id', user.id)
      .single()
    if (!callerProfile?.is_superuser) return json({ error: 'forbidden' }, 403)

    // ── Step 2: Validate target ───────────────────────────────────────
    const { user_id } = await req.json().catch(() => ({}))
    if (!user_id || typeof user_id !== 'string') {
      return json({ error: 'user_id is required' }, 400)
    }
    if (user_id === user.id) {
      return json({ error: 'cannot_delete_self' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const breakdown: Record<string, unknown> = {}

    // ── Step 3: Cancel any active Stripe subscription FIRST ───────────
    // Read coach_subscriptions BEFORE we delete it — we need the
    // stripe_subscription_id to call Stripe's cancellation endpoint.
    // Without this, the customer's card keeps getting charged after
    // we've wiped their account (their payment method is still on
    // file in Stripe, and the subscription is the trigger).
    try {
      const { data: subs } = await admin
        .from('coach_subscriptions')
        .select('stripe_subscription_id, status')
        .eq('coach_id', user_id)
      if (subs && subs.length > 0) {
        const cancellations: Array<{ sub: string; ok: boolean; status?: string; detail?: string }> = []
        for (const s of subs) {
          // Skip already-cancelled subscriptions — saves a Stripe API
          // round-trip for trivially-skippable rows.
          if (s.status === 'canceled' || s.status === 'cancelled') {
            cancellations.push({ sub: s.stripe_subscription_id, ok: true, status: 'already_cancelled' })
            continue
          }
          const r = await stripeCancelSubscription(s.stripe_subscription_id)
          cancellations.push({ sub: s.stripe_subscription_id, ...r })
        }
        breakdown.stripe_subscriptions_cancelled = cancellations
      } else {
        breakdown.stripe_subscriptions_cancelled = []
      }
    } catch (err) {
      // Don't block the user-delete on Stripe failures. The admin
      // can manually reconcile in Stripe Dashboard if anything's
      // left dangling — but the user's data still gets wiped.
      console.error('stripe cancel lookup failed:', err)
      breakdown.stripe_subscriptions_cancelled = { error: (err as Error).message }
    }

    // ── Step 4: Delete from non-cascade business tables ───────────────
    // Each table gets its own try/catch. A failure on one table
    // doesn't abort the rest — partial cleanup beats a half-deleted
    // account that has to be manually completed by an engineer.
    const tableResults: Record<string, { deleted: boolean; error?: string }> = {}
    for (const { table, column } of USER_DATA_TABLES) {
      try {
        const { error: delErr } = await admin
          .from(table)
          .delete()
          .eq(column, user_id)
        tableResults[table] = delErr
          ? { deleted: false, error: delErr.message }
          : { deleted: true }
      } catch (err) {
        tableResults[table] = { deleted: false, error: (err as Error).message }
      }
    }
    breakdown.business_tables = tableResults

    // ── Step 5: Wipe avatar storage ───────────────────────────────────
    // Avatars are uploaded with the user_id as the path prefix
    // (e.g. avatars/<user_id>.jpg, avatars/<user_id>/cropped.jpg).
    // List + delete everything under the user_id prefix.
    try {
      const { data: files } = await admin.storage
        .from('avatars')
        .list(user_id, { limit: 100 })
      // Also handle the legacy flat-file pattern (avatars/<user_id>.jpg)
      const { data: rootFiles } = await admin.storage
        .from('avatars')
        .list('', { limit: 1000, search: user_id })

      const paths: string[] = []
      if (files) {
        for (const f of files) paths.push(`${user_id}/${f.name}`)
      }
      if (rootFiles) {
        for (const f of rootFiles) {
          // Match files whose name STARTS with the user_id (e.g.
          // <user_id>.jpg, <user_id>-cropped.png). Skip the folder
          // entry itself (which has no extension).
          if (f.name.startsWith(user_id) && f.name.includes('.')) {
            paths.push(f.name)
          }
        }
      }
      if (paths.length > 0) {
        const { error: rmErr } = await admin.storage.from('avatars').remove(paths)
        breakdown.avatars_removed = rmErr
          ? { count: 0, error: rmErr.message }
          : { count: paths.length, paths }
      } else {
        breakdown.avatars_removed = { count: 0 }
      }
    } catch (err) {
      breakdown.avatars_removed = { count: 0, error: (err as Error).message }
    }

    // ── Step 6: Delete profiles row ───────────────────────────────────
    // The CASCADE FKs on b2c_purchases, coach_invites,
    // coach_subscriptions, credential_history fire here. Any OTHER
    // user whose profiles.coach_id pointed at this user gets SET NULL
    // (the FK rule on the self-reference) — so the deleted coach's
    // clients are gracefully orphaned, not hard-deleted with them.
    try {
      const { error: profileErr } = await admin
        .from('profiles')
        .delete()
        .eq('id', user_id)
      breakdown.profile_deleted = profileErr
        ? { ok: false, error: profileErr.message }
        : { ok: true, cascaded: CASCADE_TABLES }
    } catch (err) {
      breakdown.profile_deleted = { ok: false, error: (err as Error).message }
    }

    // ── Step 7: Delete auth.users row LAST ────────────────────────────
    // After profiles is gone (and all FKs to it have resolved), the
    // auth deletion can't be blocked by any orphan reference.
    const { error: authDeleteErr } = await admin.auth.admin.deleteUser(user_id)
    if (authDeleteErr) {
      breakdown.auth_deleted = { ok: false, error: authDeleteErr.message }
      // If auth deletion fails, the user can still log in even though
      // their data is gone — that's a worse state than full success
      // OR full failure. Return 500 so the admin sees the alarm.
      return json({ error: 'auth_delete_failed', breakdown }, 500)
    }
    breakdown.auth_deleted = { ok: true }

    return json({ success: true, user_id, breakdown })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
