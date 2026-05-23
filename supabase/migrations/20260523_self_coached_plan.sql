-- Self-coached vs admin-coached plan model.
--
-- Background
-- ----------
-- Until now, every user's calorie_plans row was written exclusively by
-- the admin via web/src/pages/admin/tabs/AdminUserPlan.jsx. Regular
-- users could only SELECT their own plan — they could not INSERT or
-- UPDATE it. That model worked when the only users were the admin's
-- coaching clients, but the app is heading to the Google Play store
-- where thousands of users will sign up without any coach. Those
-- users need to be able to set up + maintain their own plan.
--
-- The admin still needs to keep the existing flow for their specific
-- coaching clients (the few they actually coach). So we introduce a
-- per-user flag and an RLS policy that gates self-writes on it.
--
-- Two halves:
--   1. profiles.is_self_coached BOOLEAN — true = user owns their plan,
--      false = admin owns it (today's behaviour).
--   2. New RLS policy on calorie_plans allowing INSERT + UPDATE by the
--      owner ONLY when their is_self_coached flag is true.
--
-- Backfill rule (per May 23 2026 design discussion):
--   - The DEFAULT for new rows is `true` — new app-store signups are
--     self-coached out of the gate.
--   - Existing non-admin users (the admin's coaching clients today)
--     are backfilled to `false` to preserve today's UX exactly.
--   - The admin (is_superuser = true) gets `true` — they have no
--     upstream coach above them; they self-coach.
--
-- Conflict semantics (per Q4 in the design discussion):
--   When the admin later flips is_self_coached from true → false (i.e.
--   takes a self-coached user on as a client), the existing self-set
--   calorie_plans row is DELETED elsewhere (admin code, not here) so
--   the user lands back at the today's "Your plan is on its way"
--   placeholder. That gives the admin a clean slate to author a plan
--   from. This migration doesn't enforce that — it's an admin-portal
--   workflow that the AdminUserDetail toggle implements.

-- ── Step 1 — add the column ────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_self_coached BOOLEAN NOT NULL DEFAULT true;

-- ── Step 2 — backfill existing non-admin rows to false ────────────────
-- ALTER TABLE ... DEFAULT true filled every existing row with true.
-- For existing non-admin rows we want false so today's coached clients
-- keep their existing read-only experience.
UPDATE profiles
   SET is_self_coached = false
 WHERE is_superuser IS NOT TRUE;

-- ── Step 3 — RLS policy for self-coached writes ───────────────────────
-- Owner can INSERT + UPDATE their own row when is_self_coached = true.
-- DELETE is intentionally NOT granted to the user — only the admin can
-- delete a plan (the conflict-rule reset path).
--
-- Three existing policies (Admin full access, superusers_full,
-- users_read_own) stay untouched. This is purely additive.
CREATE POLICY "Users insert own plan when self-coached"
  ON calorie_plans FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND is_self_coached = true
    )
  );

CREATE POLICY "Users update own plan when self-coached"
  ON calorie_plans FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND is_self_coached = true
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND is_self_coached = true
    )
  );
