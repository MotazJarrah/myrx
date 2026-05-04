/**
 * Cloudflare D1 REST API client.
 * Uses the HTTP API so scripts can run anywhere (GitHub Actions, local)
 * without wrangler CLI.
 *
 * Docs: https://developers.cloudflare.com/api/operations/cloudflare-d1-query-database
 *
 * Note: The D1 HTTP API only exposes a single /query endpoint.
 * There is no /batch endpoint — batch() runs statements sequentially.
 */

import { withRetry } from './retry.mjs'

const D1_QUERY = (accountId, dbId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`

/**
 * @param {{ accountId: string, databaseId: string, apiToken: string }} config
 */
export function createD1Client({ accountId, databaseId, apiToken }) {
  const url = D1_QUERY(accountId, databaseId)

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
   * Execute multiple statements sequentially via the /query endpoint.
   * The D1 HTTP API has no /batch endpoint — each statement is sent
   * individually and results are collected in order.
   * @param {{ sql: string, params?: any[] }[]} statements
   */
  async function batch(statements) {
    const results = []
    for (const stmt of statements) {
      const result = await query(stmt.sql, stmt.params ?? [])
      results.push(result)
    }
    return results
  }

  return { query, batch }
}
