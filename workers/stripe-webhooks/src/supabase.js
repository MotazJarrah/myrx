// Thin Supabase REST client for the Stripe webhooks worker.
// All DB writes use the service-role key (bypasses RLS) because:
//   - coach_subscriptions has no INSERT/UPDATE policies for authenticated users
//     by design (only the webhook handler should mutate it).
//   - b2c_purchases is similar — webhook-driven only.
//   - profiles updates from webhooks (coach_subscription_status changes) bypass
//     RLS so we don't have to authenticate as the user the webhook is about.
//
// Pattern mirrors workers/oauth/src/supabase.js (proven in production).

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

  // Generic upsert helper.
  async upsert(table, row, onConflict) {
    const url = new URL(`${this.url}/rest/v1/${table}`)
    if (onConflict) url.searchParams.set('on_conflict', onConflict)
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers({
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase upsert ${table} failed: ${res.status} ${text}`)
    }
    const rows = await res.json()
    return rows[0]
  }

  // Generic insert (errors on conflict — use upsert for idempotent flows).
  async insert(table, row) {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: this._headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase insert ${table} failed: ${res.status} ${text}`)
    }
    const rows = await res.json()
    return rows[0]
  }

  // Generic update by primary key or other filter.
  // `filter` is e.g. { id: 'eq.xxx' } or { stripe_subscription_id: 'eq.sub_xxx' }.
  async update(table, filter, patch) {
    const url = new URL(`${this.url}/rest/v1/${table}`)
    for (const [k, v] of Object.entries(filter)) {
      url.searchParams.set(k, v)
    }
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this._headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase update ${table} failed: ${res.status} ${text}`)
    }
    return await res.json()
  }

  async select(table, filter, columns = '*') {
    const url = new URL(`${this.url}/rest/v1/${table}`)
    url.searchParams.set('select', columns)
    for (const [k, v] of Object.entries(filter ?? {})) {
      url.searchParams.set(k, v)
    }
    const res = await fetch(url, { headers: this._headers() })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase select ${table} failed: ${res.status} ${text}`)
    }
    return await res.json()
  }
}
