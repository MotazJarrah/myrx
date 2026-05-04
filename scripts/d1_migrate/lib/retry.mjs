/**
 * Exponential backoff retry helper.
 * Automatically retries an async function up to `retries` times,
 * doubling the delay each attempt. Never mutates its arguments.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ retries?: number, baseMs?: number, factor?: number, label?: string }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { retries = 3, baseMs = 2_000, factor = 2, label = '' } = {}) {
  let lastErr
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt > retries) break
      const delay = baseMs * Math.pow(factor, attempt - 1)
      const tag = label ? `[${label}] ` : ''
      console.warn(`${tag}Attempt ${attempt} failed: ${err.message} — retrying in ${delay}ms…`)
      await sleep(delay)
    }
  }
  throw lastErr
}
