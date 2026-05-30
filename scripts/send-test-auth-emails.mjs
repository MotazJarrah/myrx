/**
 * One-shot: fire Supabase Auth emails to motaz.jarrah@hotmail.com for visual QA.
 *
 * Uses publishable key (anon-equivalent) — works for the 3 public-callable templates:
 *   - Magic link / OTP   (signInWithOtp on existing user)
 *   - Reset password     (resetPasswordForEmail on existing user)
 *   - Confirm sign up    (signUp with +alias to land in same inbox)
 *
 * Invite + Change-email need admin/session auth — handled separately:
 *   - Invite: Supabase Dashboard Users tab → Invite button
 *   - Change email: live user action from Profile → Settings, OR temp signed-in session
 *
 * Run: node scripts/send-test-auth-emails.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xtxzfhoxyyrlxslgzvty.supabase.co'
const SUPABASE_KEY = 'sb_publishable_roSzL0VOILmeVZLN-mdLSQ_G5-zOpu8'
const TARGET = 'motaz.jarrah@hotmail.com'

const supa = createClient(SUPABASE_URL, SUPABASE_KEY)

const results = []

// ─── 1. Magic link / OTP (template #3) ───────────────────────────────
{
  const { error } = await supa.auth.signInWithOtp({
    email: TARGET,
    options: {
      shouldCreateUser: false,                              // existing user only
      emailRedirectTo: 'https://myrxfit.com/auth/confirm',
    },
  })
  results.push({ template: 'Magic link or OTP', to: TARGET, ok: !error, err: error?.message })
}

// ─── 2. Reset password (template #5) ─────────────────────────────────
{
  const { error } = await supa.auth.resetPasswordForEmail(TARGET, {
    redirectTo: 'https://myrxfit.com/auth/recovery',
  })
  results.push({ template: 'Reset password', to: TARGET, ok: !error, err: error?.message })
}

// ─── 3. Confirm sign up (template #1) ────────────────────────────────
// Uses +alias so it lands in same Hotmail inbox without conflicting with the
// real account. Password is throwaway — user can ignore the temp account.
const aliasEmail = TARGET.replace('@', '+confirmtest@')
{
  const { error } = await supa.auth.signUp({
    email: aliasEmail,
    password: `Temp!Test${Date.now()}`,
    options: {
      emailRedirectTo: 'https://myrxfit.com/auth/confirm',
    },
  })
  // "User already registered" if we've run this before — surface either way.
  results.push({ template: 'Confirm sign up', to: aliasEmail, ok: !error, err: error?.message })
}

console.table(results)
