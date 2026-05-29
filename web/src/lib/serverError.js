/**
 * Server-side error humanizer.
 *
 * Translates raw errors caught from `supabase.functions.invoke`,
 * `supabase.rpc`, plain `fetch`, or any other server call into a
 * single coach-voice user-facing string.
 *
 * The translation order is:
 *
 *   1. If the error came from a Supabase Edge Function and the function
 *      returned a JSON body of the shape `{ error: "..." }`, surface
 *      that string verbatim — edge functions in this codebase are
 *      already written in coach voice per CLAUDE.md "Voice and Coaching
 *      Philosophy" (acknowledge → biology/mechanism → next step).
 *      Anything we'd layer on top would be a regression.
 *
 *   2. Otherwise, match the raw `message` against the known generic
 *      patterns table and translate to plain English. Default fallback
 *      is a neutral "something went wrong" line.
 *
 * Hard rules for the strings we produce here:
 *   - Never include stack traces.
 *   - Never name implementation ("supabase", "edge function", HTTP
 *     codes, etc.) — the user doesn't care what's under the hood.
 *   - Acknowledge what likely happened, then give a concrete next step.
 *     For technical errors (network, server hiccup) the next step is
 *     "try again" + an honest cause. We don't force biology here — the
 *     3-pillar rule's biology arm doesn't apply to plumbing.
 *
 * Async first read of the body is required because
 * `FunctionsHttpError.context` is a Response object — pulling its JSON
 * is a one-shot await. Use `humanizeServerErrorAsync` everywhere that
 * catches an invoke/fetch error. The sync `humanizeServerError` is for
 * cases where the body has already been awaited (or there's no body —
 * raw network failures, RPC errors with `.message` only).
 *
 * MIRROR — a TS port lives at mobile/src/lib/serverError.ts so the same
 * helper can be used from mobile when wearable / edge function failures
 * surface in the app. Keep them in sync.
 */

// Default coach-voice fallbacks for the recognised generic patterns.
const GENERIC_PATTERNS = [
  {
    test: /failed to fetch|network ?request ?failed|networkerror|typeerror.*fetch/i,
    msg:  "Your connection dropped. Reconnect and try again — we kept what you typed.",
  },
  {
    test: /edge function returned a non-?2xx/i,
    msg:  "Something already happened or just changed. Refresh and try again.",
  },
  {
    test: /non-?2xx status code/i,
    msg:  "That didn't go through. Refresh and try again in a moment.",
  },
  {
    test: /timeout|timed out/i,
    msg:  "That took too long. Try again — usually a temporary slowdown.",
  },
  {
    test: /aborted|abortError/i,
    msg:  "That got cancelled. Try again.",
  },
  {
    test: /jwt expired|invalid jwt|session.*expired/i,
    msg:  "Your session expired. Sign in again and we'll pick up where you left off.",
  },
  {
    test: /rate limit|too many requests/i,
    msg:  "Too many tries in a row. Wait a minute and try again.",
  },
  {
    test: /permission denied|forbidden|not authorized|unauthorized/i,
    msg:  "You don't have permission for that. Sign out and back in if you think you should.",
  },
  {
    test: /not found/i,
    msg:  "We couldn't find that. It may have been removed since you loaded the page.",
  },
  {
    test: /duplicate key|unique constraint|conflict/i,
    msg:  "That already exists. Refresh the list to see it.",
  },
]

const DEFAULT_FALLBACK =
  "Something went wrong on our end. Try again in a moment, or refresh the page if it persists."

/**
 * Pull the structured `error` field out of an edge function failure
 * body if there is one. Returns null when:
 *   - The error isn't a FunctionsHttpError-shaped object.
 *   - The body isn't valid JSON.
 *   - The JSON has no `error` field, or `error` isn't a non-empty string.
 *
 * Supabase's FunctionsHttpError exposes the original Response on
 * `.context`. Reading `.json()` consumes the body — but the Supabase
 * client returns a fresh Error per call so we never collide with
 * downstream readers.
 */
async function readEdgeFunctionErrorBody(err) {
  const ctx = err?.context
  if (!ctx) return null
  try {
    // FunctionsHttpError.context is typically a Response-like object
    // with a .json() method. Some older paths expose .body as the
    // already-parsed payload — try both.
    if (typeof ctx.json === 'function') {
      const body = await ctx.json()
      const text = body?.error
      if (typeof text === 'string' && text.trim()) return text.trim()
    } else if (ctx.body && typeof ctx.body === 'object') {
      const text = ctx.body.error
      if (typeof text === 'string' && text.trim()) return text.trim()
    }
  } catch {
    /* swallow — fall through to generic match */
  }
  return null
}

/**
 * Match a raw error message against the generic-patterns table.
 * Returns the matched coach-voice string, or null if nothing matched.
 */
function matchGenericPattern(message) {
  if (!message) return null
  const text = String(message)
  for (const { test, msg } of GENERIC_PATTERNS) {
    if (test.test(text)) return msg
  }
  return null
}

/**
 * Async humanizer — preferred entry point for any error caught from
 * `supabase.functions.invoke`. Awaits the response body first so the
 * structured `error` field (already in coach voice) takes precedence.
 *
 * @param {unknown} err — caught error or error-like value.
 * @param {string} [fallback] — optional override for the default
 *   fallback string (rarely needed — used by callers that want a more
 *   surface-specific phrasing when nothing else matches).
 * @returns {Promise<string>}
 */
export async function humanizeServerErrorAsync(err, fallback) {
  if (!err) return fallback || ''
  // 1. Try to read the edge function's structured error body first —
  //    if present, it's already in coach voice per CLAUDE.md.
  const edgeText = await readEdgeFunctionErrorBody(err)
  if (edgeText) return edgeText
  // 2. Fall back to pattern-matching on the raw .message string.
  const matched = matchGenericPattern(err?.message)
  if (matched) return matched
  return fallback || DEFAULT_FALLBACK
}

/**
 * Sync humanizer — for use after the body has already been read OR
 * when the error has no body (RPC errors, plain network failures).
 *
 * Accepts an optional explicit `bodyError` string (the second arg) to
 * let callers that already awaited the edge function body pass it in
 * directly without re-awaiting.
 *
 * @param {unknown} err — caught error or error-like value.
 * @param {string|null} [bodyError] — explicit body.error string if
 *   already awaited.
 * @param {string} [fallback] — optional fallback override.
 * @returns {string}
 */
export function humanizeServerError(err, bodyError, fallback) {
  if (!err && !bodyError) return fallback || ''
  if (typeof bodyError === 'string' && bodyError.trim()) return bodyError.trim()
  const matched = matchGenericPattern(err?.message)
  if (matched) return matched
  return fallback || DEFAULT_FALLBACK
}

/**
 * Convenience helper for the common case: pass the raw `data` and
 * `error` you got back from `supabase.functions.invoke` and we'll do
 * the right thing.
 *
 *   const { data, error } = await supabase.functions.invoke('foo', { body })
 *   const msg = await humanizeInvokeError({ data, error })
 *   if (msg) setError(msg)
 *
 * Returns null when the call succeeded and the function body reports
 * success — caller doesn't need to set an error in that case.
 */
export async function humanizeInvokeError({ data, error }, fallback) {
  if (!error && data && data.success !== false) return null
  // If the call returned 200 but the body says { success: false, error: "..." },
  // surface the body.error directly (coach voice).
  if (!error && data && data.success === false) {
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()
    return fallback || DEFAULT_FALLBACK
  }
  // FunctionsHttpError path — await the body and pick the right string.
  return humanizeServerErrorAsync(error, fallback)
}
