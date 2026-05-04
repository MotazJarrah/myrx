/**
 * Cloudflare D1 REST API client.
 * Uses the HTTP API so scripts can run anywhere (GitHub Actions, local)
 * without wrangler CLI.
 *
 * Docs: https://developers.cloudflare.com/api/operations/cloudflare-d1-query-database
 */

import { withRetry } from './retry.mjs'

const D1_QUERY = (accountId, dbId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`

const D1_BATCH = (accountId, dbId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/batch`

/**
 * @param {{ accountId: string, databaseId: string, apiToken: string }} config
 */
export function createD1Client({ accountId, databaseId, apiToken }) {
  const url      = D1_QUERY(accountId, databaseId)
  const batchUrl = D1_BATCH(accountId, databaseId)

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiToken}`,
  }

  /**
   * Execute a single SQL statement with optional positional params.
   * @param {string} sql
   * @param {any[]} [params]
   */
  async function query(sql, params = []) {
    const res = await withRetry(async () => {
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sql, params }),
      })
      if (!r.ok) throw new Error(`D1 HTTP ${r.status}: ${await r.text()}`)
      return r.json()
    }, { label: 'D1 query', retries: 3 })

    if (!res.success) throw new Error(`D1 error: ${JSON.stringify(res.errors)}`)
    return res.result?.[0] ?? { results: [], meta: {} }
  }

  /**
   * Execute multiple statements in one request (D1 batch).
   * Automatically chunks into groups of 100 (D1 limit).
   * @param {{ sql: string, params?: any[] }[]} statements
   */
  async function batch(statements) {
    const CHUNK = 100
    const results = []
    for (let i = 0; i < statements.length; i += CHUNK) {
      const chunk = statements.slice(i, i + CHUNK)
      const res = await withRetry(async () => {
        const r = await fetch(batchUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ statements: chunk.map(s => ({ sql: s.sql, params: s.params ?? [] })) }),
        })
        if (!r.ok) throw new Error(`D1 batch HTTP ${r.status}: ${await r.text()}`)
        return r.json()
      }, { label: 'D1 batch', retries: 3 })

      if (!res.success) throw new Error(`D1 batch error: ${JSON.stringify(res.errors)}`)
      results.push(...(res.result ?? []))
    }
    return results
  }

  return { query, batch }
}
