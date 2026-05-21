/**
 * Sync admin handlers
 *
 * POST /admin/sync         → trigger GitHub Actions workflow (returns 202)
 * GET  /admin/sync/status  → read sync_state from D1 (returns status object)
 *
 * Both routes require Bearer FOOD_ADMIN_KEY.
 * GitHub dispatch requires env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW_REF
 */

const WORKFLOW_FILE = 'sync-food-library.yml'

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
    },
  })
}

function requireAuth(request, env) {
  const header   = request.headers.get('Authorization') ?? ''
  const expected = env.FOOD_ADMIN_KEY
  if (!expected) return json({ error: 'Server misconfigured' }, 500)
  if (!header.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
  const token = header.slice(7)
  if (token.length !== expected.length) return json({ error: 'Unauthorized' }, 401)
  let diff = 0
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return json({ error: 'Unauthorized' }, 401)
  return null
}

/** Read the full sync_state table into a plain object { key: value } */
async function readSyncState(db) {
  const { results } = await db.prepare(
    `SELECT key, value, updated_at FROM sync_state`
  ).all()
  const state = {}
  for (const row of results ?? []) {
    state[row.key] = row.value
    state[`${row.key}_updated_at`] = row.updated_at
  }
  return state
}

// ── POST /admin/sync ──────────────────────────────────────────────────────────

export async function handleTriggerSync(request, env) {
  const authErr = requireAuth(request, env)
  if (authErr) return authErr

  // Check required GitHub env vars
  const owner    = env.GITHUB_OWNER
  const repo     = env.GITHUB_REPO
  const ref      = env.GITHUB_WORKFLOW_REF ?? 'main'
  const ghToken  = env.GITHUB_TOKEN

  if (!ghToken)  return json({ error: 'GITHUB_TOKEN not configured' }, 500)
  if (!owner)    return json({ error: 'GITHUB_OWNER not configured' }, 500)
  if (!repo)     return json({ error: 'GITHUB_REPO not configured' }, 500)

  // Reject if a sync is already running
  const state = await readSyncState(env.DB)
  if (state['sync_status'] === 'running') {
    return json({
      error:   'Sync already in progress',
      status:  'running',
      started: state['sync_started_at'] ?? null,
    }, 409)
  }

  // Parse optional `force` + `staged` inputs from request body.
  // `staged=true` means the sync writes changelog entries but does NOT
  // apply them to food_library — the user reviews + commits manually.
  // `staged=false` (default) means the sync auto-commits at the end.
  let force = 'false'
  let staged = 'false'
  try {
    const body = await request.json()
    if (body?.force === true  || body?.force  === 'true') force  = 'true'
    if (body?.staged === true || body?.staged === 'true') staged = 'true'
  } catch { /* no body is fine */ }

  // Block if a staged sync is awaiting review — user must commit or
  // discard before triggering another.
  if (state['sync_staged_review'] === '1') {
    return json({
      error:   'A staged sync is awaiting review. Commit or discard it before running another sync.',
      status:  'staged_review',
      run_id:  state['sync_run_id'] ?? null,
    }, 409)
  }

  // Generate a fresh run_id for this sync. Sync scripts pass this back
  // via /admin/sync/state + /admin/sync/changelog/append. Format:
  // YYYYMMDDTHHmmss + 8 random hex.
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15)
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const runId = `sync_${ts}_${rand}`

  // Pre-stamp sync_state so /admin/sync/status reflects the pending run
  // even before the GitHub workflow has spun up its first job.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sync_state SET value = ?, updated_at = datetime('now') WHERE key = 'sync_run_id'`
    ).bind(runId),
    env.DB.prepare(
      `UPDATE sync_state SET value = ?, updated_at = datetime('now') WHERE key = 'sync_mode'`
    ).bind(staged === 'true' ? 'staged' : 'commit'),
    env.DB.prepare(
      `UPDATE sync_state SET value = 'pending', updated_at = datetime('now') WHERE key = 'sync_status'`
    ),
    env.DB.prepare(
      `UPDATE sync_state SET value = '0', updated_at = datetime('now') WHERE key = 'sync_cancel_requested'`
    ),
  ])

  // Dispatch GitHub Actions workflow with run_id + mode passed through
  // as inputs. The workflow forwards them as env vars to the sync scripts.
  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`
  const ghRes = await fetch(dispatchUrl, {
    method:  'POST',
    headers: {
      Accept:         'application/vnd.github+json',
      Authorization:  `Bearer ${ghToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent':   'myrx-food-worker/1.0',
    },
    body: JSON.stringify({ ref, inputs: { force, staged, run_id: runId } }),
  })

  if (!ghRes.ok) {
    const errText = await ghRes.text().catch(() => '')
    // Revert sync_status if the dispatch failed.
    await env.DB.prepare(
      `UPDATE sync_state SET value = 'failed', updated_at = datetime('now') WHERE key = 'sync_status'`
    ).run()
    return json({
      error:   `GitHub dispatch failed: ${ghRes.status}`,
      detail:  errText,
    }, 502)
  }

  return json({ triggered: true, workflow: WORKFLOW_FILE, ref, force, staged, run_id: runId }, 202)
}

// ── GET /admin/sync/status ────────────────────────────────────────────────────

export async function handleSyncStatus(request, env) {
  const authErr = requireAuth(request, env)
  if (authErr) return authErr

  const state = await readSyncState(env.DB)

  // Parse progress JSON safely
  let progress = {}
  try { progress = JSON.parse(state['sync_progress'] ?? '{}') } catch {}

  return json({
    status:                state['sync_status']             ?? 'unknown',
    run_id:                state['sync_run_id']             || null,
    mode:                  state['sync_mode']               || null,
    staged_review_pending: state['sync_staged_review']      === '1',
    last_committed_run_id: state['last_committed_run_id']   || null,
    cancel_requested:      state['sync_cancel_requested']   === '1',
    started_at:            state['sync_started_at']         ?? null,
    completed_at:          state['sync_completed_at']       ?? null,
    error:                 state['sync_error']              || null,
    progress,
    usda: {
      last_sync_date: state['usda_last_sync_date'] || null,
    },
    on: {
      last_version:  state['on_last_version']  || null,
      last_checksum: state['on_last_checksum'] || null,
    },
  })
}
