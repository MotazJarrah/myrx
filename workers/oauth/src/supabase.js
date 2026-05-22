// Thin Supabase REST client for the OAuth worker.
// All DB writes use the service-role key, which bypasses RLS — this is the only
// way the worker can write to user_integrations (no INSERT/UPDATE policies exist
// for authenticated users by design).

export class SupabaseRest {
  constructor(env) {
    this.url = env.SUPABASE_URL
    this.serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!this.url) throw new Error('SUPABASE_URL not set')
    if (!this.serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  }

  _headers(extra = {}) {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  // Upsert by (user_id, platform). The unique constraint on those two columns
  // makes Prefer: resolution=merge-duplicates safe — re-connect overwrites the
  // existing row, no duplicates pile up.
  async upsertIntegration(row) {
    const res = await fetch(
      `${this.url}/rest/v1/user_integrations?on_conflict=user_id,platform`,
      {
        method: 'POST',
        headers: this._headers({
          Prefer: 'resolution=merge-duplicates,return=representation',
        }),
        body: JSON.stringify(row),
      },
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase upsert failed: ${res.status} ${text}`)
    }
    const rows = await res.json()
    return rows[0]
  }

  async getIntegration(userId, platform) {
    const url = new URL(`${this.url}/rest/v1/user_integrations`)
    url.searchParams.set('user_id', `eq.${userId}`)
    url.searchParams.set('platform', `eq.${platform}`)
    url.searchParams.set('select', '*')
    url.searchParams.set('limit', '1')
    const res = await fetch(url, { headers: this._headers() })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase select failed: ${res.status} ${text}`)
    }
    const rows = await res.json()
    return rows[0] ?? null
  }

  async deleteIntegration(userId, platform) {
    const url = new URL(`${this.url}/rest/v1/user_integrations`)
    url.searchParams.set('user_id', `eq.${userId}`)
    url.searchParams.set('platform', `eq.${platform}`)
    const res = await fetch(url, { method: 'DELETE', headers: this._headers() })
    if (!res.ok && res.status !== 404) {
      const text = await res.text()
      throw new Error(`Supabase delete failed: ${res.status} ${text}`)
    }
  }

  // Verify a user-provided JWT against Supabase Auth. Returns the user object
  // ({ id, email, ... }) on success or null if the token is invalid/expired.
  async getUserFromJwt(jwt) {
    if (!jwt) return null
    const res = await fetch(`${this.url}/auth/v1/user`, {
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${jwt}`,
      },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id ? user : null
  }
}
