/**
 * hydrateEmails — given an array of profile-shaped objects (each with
 * an `id` uuid), fetch their emails via the get_emails_for_user_ids
 * RPC and return a new array with `email` populated on each row.
 *
 * Why this exists: the `profiles` table has NO email column — emails
 * live in `auth.users`. Direct joins from the client are blocked by
 * RLS. The RPC (SECURITY DEFINER) handles the auth.users lookup and
 * scopes the result to rows the caller is authorized to see:
 *
 *   • Admin → all
 *   • Coach → their own roster only
 *   • Self  → always their own email
 *
 * Any id the caller isn't authorized to see comes back with email=null
 * (silent — no error). The merged result preserves every other field
 * on the input row; only `email` is added/replaced.
 *
 * Usage:
 *
 *   const { data: clients } = await supabase
 *     .from('profiles')
 *     .select('id, full_name, avatar_url, ...')
 *     .eq('coach_id', user.id)
 *   const withEmails = await hydrateEmails(supabase, clients ?? [])
 *
 * Pass an empty array and you get an empty array back (no RPC roundtrip).
 */
export async function hydrateEmails(supabase, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows ?? []
  const ids = rows.map(r => r?.id).filter(Boolean)
  if (ids.length === 0) return rows

  const { data, error } = await supabase.rpc('get_emails_for_user_ids', { p_ids: ids })
  if (error) {
    // Soft-fail: caller still gets the rows back, just without emails.
    // The UI's `c.email` references fall through to fallbacks (full_name
    // / "Client" / first-letter avatar) — better than blowing up the
    // whole page.
    // eslint-disable-next-line no-console
    console.warn('[hydrateEmails] RPC failed:', error.message)
    return rows
  }
  const emailById = new Map((data ?? []).map(r => [r.id, r.email]))
  return rows.map(r => ({ ...r, email: emailById.get(r.id) ?? null }))
}
