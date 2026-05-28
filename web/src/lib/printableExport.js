/**
 * printableExport — shared utilities for opening printable HTML transcripts
 * in a new browser tab. Two flavors:
 *
 *   • openPrintableTranscript({...})       — for chat exports (uses
 *     get_chat_transcript_for_export RPC output)
 *   • openPrintableBillingExport({...})    — for billing exports (uses
 *     billing_events rows)
 *
 * Both use the same chrome: header card with metadata + legal hold
 * notice, then a flat list of rows. They auto-trigger window.print() so
 * the admin can immediately save as PDF.
 *
 * Extracted from AdminMessages.jsx (May 28 2026) so AdminArchive can
 * reuse the same code path for deleted accounts. Editing this file
 * updates both surfaces in lockstep.
 *
 * Strict copyright safety: we escape every user-controlled string via
 * the `esc` helper before injecting into HTML. Stripe IDs + amounts
 * go through the same escaping even though they're machine-generated
 * — defence in depth for the case where someone someday adds a
 * description field that an attacker can plant HTML into.
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
}

function formatTimestamp(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(undefined, {
    year:   'numeric', month: 'long', day: 'numeric',
    hour:   '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatAmount(cents, currency) {
  if (cents == null) return '—'
  const amount = cents / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${(currency || '').toUpperCase()}`
  }
}

const BASE_CSS = `
@media print { @page { margin: 0.5in; } }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Geist, system-ui, sans-serif; color: #111; max-width: 760px; margin: 24px auto; padding: 0 16px; line-height: 1.4; }
h1 { font-size: 18px; margin: 0 0 4px 0; }
.header { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 24px; background: #fafafa; }
.header dl { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; margin: 12px 0 0 0; font-size: 13px; }
.header dt { color: #666; font-weight: 600; }
.header dd { margin: 0; }
.header .legal { font-size: 11px; color: #666; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; line-height: 1.5; }
.footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #888; text-align: center; }
.empty { text-align: center; padding: 40px 16px; color: #888; font-style: italic; }
`

// ── Chat transcript ────────────────────────────────────────────────────────
//
// Caller provides: athleteName, athleteEmail, partnerName, partnerRole,
// reason, rows[]. Each row from get_chat_transcript_for_export carries:
// { sender_name, from_admin, created_at, body, deleted_at, edited_at }.
//
// Renders one stacked message block per row with sender + role pill +
// timestamp + body + optional [Deleted on X] / [Edited on X] flags.
export function openPrintableTranscript({
  athleteName, athleteEmail, partnerName, partnerRole, reason, rows,
}) {
  const win = window.open('', '_blank')
  if (!win) return  // popup blocked — caller can detect via err if needed

  const exportedAt = formatTimestamp(new Date().toISOString())

  const bodyRows = (rows || []).map(r => {
    const ts     = formatTimestamp(r.created_at)
    const sender = esc(r.sender_name)
    const role   = r.from_admin ? partnerRole : 'athlete'
    const body   = esc(r.body).replace(/\n/g, '<br/>')
    const deleted = r.deleted_at
      ? `<span class="deleted-flag">[Deleted on ${esc(formatTimestamp(r.deleted_at))}]</span>`
      : ''
    const edited = r.edited_at
      ? `<span class="edited-flag">[Edited on ${esc(formatTimestamp(r.edited_at))}]</span>`
      : ''
    return `
      <div class="msg msg-${esc(role)}">
        <div class="meta">
          <span class="sender">${sender}</span>
          <span class="role">${esc(role.toUpperCase())}</span>
          <span class="ts">${esc(ts)}</span>
          ${edited}
          ${deleted}
        </div>
        <div class="body">${body}</div>
      </div>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MyRX Conversation Transcript — ${esc(athleteName)}</title>
  <style>
    ${BASE_CSS}
    .msg { margin: 0 0 12px 0; padding: 8px 12px; border-radius: 6px; border-left: 3px solid; }
    .msg-athlete { background: #f4f6f8; border-left-color: #888; }
    .msg-coach { background: #eff6ff; border-left-color: #3b82f6; }
    .msg-admin { background: #f5f3ff; border-left-color: #8b5cf6; }
    .meta { font-size: 11px; color: #555; margin-bottom: 4px; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
    .meta .sender { font-weight: 700; color: #222; font-size: 12px; }
    .meta .role { font-size: 9px; letter-spacing: 0.5px; color: #777; padding: 1px 6px; background: #eee; border-radius: 3px; }
    .meta .ts { color: #888; font-variant-numeric: tabular-nums; }
    .meta .deleted-flag { color: #b91c1c; font-style: italic; }
    .meta .edited-flag { color: #b45309; font-style: italic; }
    .body { font-size: 13px; white-space: pre-wrap; word-wrap: break-word; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MyRX — Conversation Transcript</h1>
    <dl>
      <dt>Athlete</dt><dd>${esc(athleteName)} &lt;${esc(athleteEmail || '')}&gt;</dd>
      <dt>Conversation partner</dt><dd>${esc(partnerName)} (${esc(partnerRole)})</dd>
      <dt>Exported by</dt><dd>You (administrator)</dd>
      <dt>Exported on</dt><dd>${esc(exportedAt)}</dd>
      <dt>Reason</dt><dd>${esc(reason)}</dd>
      <dt>Message count</dt><dd>${(rows || []).length}</dd>
    </dl>
    <p class="legal">
      This transcript was generated from MyRX's message archive for the stated reason above.
      The export event is recorded in MyRX's audit log alongside the administrator's identity, the
      reason, the timestamp, and the conversation parties. Deleted messages are included and flagged
      so the transcript is forensically complete.
    </p>
  </div>
  ${(rows || []).length === 0
    ? '<div class="empty">No messages were found between these two parties.</div>'
    : bodyRows}
  <div class="footer">End of transcript — MyRX message archive</div>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
  win.onload = () => setTimeout(() => { try { win.print() } catch { /* swallow */ } }, 100)
}

// ── Activity feed export ───────────────────────────────────────────────────
//
// Caller provides: clientName, clientEmail, events[]. Each event row
// from get_activity_feed RPC carries: { id, user_id, event_type,
// event_data, source, caused_by, occurred_at }.
//
// Renders a flat table with one row per event in the same order the
// caller passes them (typically most-recent-first to match the on-screen
// feed). The Details column is the JSON-stringified event_data, shown
// in a monospace font for readability.
export function openPrintableActivityFeed({
  clientName, clientEmail, events,
}) {
  const win = window.open('', '_blank')
  if (!win) return

  const exportedAt = formatTimestamp(new Date().toISOString())

  const bodyRows = (events || []).map(e => {
    const ts      = formatTimestamp(e.occurred_at)
    const type    = esc(e.event_type)
    const source  = esc(e.source ?? '')
    const details = esc(JSON.stringify(e.event_data ?? {}))
    return `
      <tr>
        <td class="ts">${esc(ts)}</td>
        <td class="type">${type}</td>
        <td class="source">${source}</td>
        <td class="details">${details}</td>
      </tr>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MyRX Activity Feed — ${esc(clientName)}</title>
  <style>
    ${BASE_CSS}
    body { max-width: 960px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; table-layout: fixed; }
    thead th { text-align: left; padding: 8px 10px; background: #f4f4f4; border-bottom: 1px solid #ddd; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
    tbody td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: top; word-wrap: break-word; }
    tbody td.ts { white-space: nowrap; font-variant-numeric: tabular-nums; color: #555; font-size: 11px; width: 160px; }
    tbody td.type { font-weight: 600; color: #222; width: 200px; }
    tbody td.source { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; width: 90px; }
    tbody td.details { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 10px; color: #444; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MyRX &mdash; Activity Feed</h1>
    <dl>
      <dt>Client</dt><dd>${esc(clientName)} &lt;${esc(clientEmail || '—')}&gt;</dd>
      <dt>Exported by</dt><dd>You (administrator)</dd>
      <dt>Exported on</dt><dd>${esc(exportedAt)}</dd>
      <dt>Event count</dt><dd>${(events || []).length}</dd>
    </dl>
    <p class="legal">
      This activity feed export was generated from MyRX's per-user audit log for the stated
      client above. Every meaningful event for this account is recorded with a timestamp,
      event type, source surface, and structured event data. The export event itself is
      recorded in MyRX's audit log alongside the administrator's identity and timestamp.
    </p>
  </div>
  ${(events || []).length === 0
    ? '<div class="empty">No activity events were found for this client.</div>'
    : `<table>
        <thead>
          <tr>
            <th>When</th>
            <th>Event type</th>
            <th>Source</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>`}
  <div class="footer">End of export &mdash; MyRX activity feed</div>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
  win.onload = () => setTimeout(() => { try { win.print() } catch { /* swallow */ } }, 100)
}

// ── Billing export ─────────────────────────────────────────────────────────
//
// Caller provides: customerName, customerEmail, stripeCustomerId,
// reason, rows[]. Each row from billing_events carries:
// { type, amount_cents, currency, status, description, occurred_at,
//   stripe_invoice_id, stripe_subscription_id, stripe_charge_id }.
//
// Renders a flat table with one row per event. Currency-formatted
// amount on the right with a small color hint for paid / refunded /
// failed states. Stripe IDs link out to Stripe Dashboard for full
// receipt PII (which we don't store locally beyond what's already in
// the row).
const BILLING_TYPE_LABELS = {
  invoice_paid:           'Invoice paid',
  invoice_failed:         'Invoice failed',
  subscription_started:   'Subscription started',
  subscription_updated:   'Subscription updated',
  subscription_cancelled: 'Subscription cancelled',
  refund_issued:          'Refund issued',
  dispute_opened:         'Dispute opened',
  b2c_purchase:           'One-time purchase',
}

export function openPrintableBillingExport({
  customerName, customerEmail, stripeCustomerId, reason, rows,
}) {
  const win = window.open('', '_blank')
  if (!win) return

  const exportedAt = formatTimestamp(new Date().toISOString())

  // Compute simple running totals so the header can show net inflow.
  // Refunds are subtracted. Failed invoices contribute zero (no money
  // actually moved). Subscription lifecycle events have null amounts;
  // they don't affect totals.
  let totalCents = 0
  let currency  = 'usd'
  for (const r of (rows || [])) {
    if (r.amount_cents == null) continue
    if (r.type === 'refund_issued')    totalCents -= r.amount_cents
    else if (r.status === 'paid' || r.status === 'completed') totalCents += r.amount_cents
    if (r.currency) currency = r.currency
  }

  const bodyRows = (rows || []).map(r => {
    const label  = BILLING_TYPE_LABELS[r.type] || esc(r.type)
    const ts     = formatTimestamp(r.occurred_at)
    const status = r.status ? `<span class="status">${esc(r.status)}</span>` : ''
    const desc   = r.description ? esc(r.description) : ''
    const sign   = r.type === 'refund_issued' ? '−' : ''
    const amount = r.amount_cents != null
      ? `${sign}${esc(formatAmount(r.amount_cents, r.currency))}`
      : '—'
    const amountClass =
      r.type === 'refund_issued'                                    ? 'amount-refund' :
      (r.status === 'paid' || r.status === 'completed')             ? 'amount-paid'   :
      r.status === 'failed'                                         ? 'amount-failed' : 'amount-neutral'

    // Link to Stripe Dashboard for whichever ID this row has. Invoice
    // is the most useful → falls back to subscription, then charge.
    let dashLink = ''
    if (r.stripe_invoice_id) dashLink = `https://dashboard.stripe.com/invoices/${esc(r.stripe_invoice_id)}`
    else if (r.stripe_subscription_id) dashLink = `https://dashboard.stripe.com/subscriptions/${esc(r.stripe_subscription_id)}`
    else if (r.stripe_charge_id) dashLink = `https://dashboard.stripe.com/payments/${esc(r.stripe_charge_id)}`

    return `
      <tr>
        <td class="ts">${esc(ts)}</td>
        <td class="type">
          <div class="type-label">${label}</div>
          ${desc ? `<div class="type-desc">${desc}</div>` : ''}
        </td>
        <td>${status}</td>
        <td class="${amountClass}">${amount}</td>
        <td>${dashLink
          ? `<a href="${dashLink}" target="_blank" rel="noopener noreferrer">View in Stripe</a>`
          : '—'}</td>
      </tr>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MyRX Billing Export — ${esc(customerName)}</title>
  <style>
    ${BASE_CSS}
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    thead th { text-align: left; padding: 8px 10px; background: #f4f4f4; border-bottom: 1px solid #ddd; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
    tbody td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: top; }
    tbody td.ts { white-space: nowrap; font-variant-numeric: tabular-nums; color: #555; font-size: 11px; }
    tbody td.type .type-label { font-weight: 600; color: #222; }
    tbody td.type .type-desc { color: #666; font-size: 11px; margin-top: 2px; }
    tbody td .status { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #777; padding: 1px 6px; background: #eee; border-radius: 3px; }
    tbody td.amount-paid    { font-weight: 700; color: #059669; text-align: right; font-variant-numeric: tabular-nums; }
    tbody td.amount-refund  { font-weight: 700; color: #b91c1c; text-align: right; font-variant-numeric: tabular-nums; }
    tbody td.amount-failed  { font-weight: 700; color: #b91c1c; text-align: right; font-variant-numeric: tabular-nums; }
    tbody td.amount-neutral { color: #222; text-align: right; font-variant-numeric: tabular-nums; }
    tbody td a { color: #3b82f6; text-decoration: none; }
    tbody td a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MyRX — Billing Records Export</h1>
    <dl>
      <dt>Customer</dt><dd>${esc(customerName)} &lt;${esc(customerEmail || '—')}&gt;</dd>
      <dt>Stripe customer ID</dt><dd>${stripeCustomerId ? esc(stripeCustomerId) : '<em>not a paying customer</em>'}</dd>
      <dt>Exported by</dt><dd>You (administrator)</dd>
      <dt>Exported on</dt><dd>${esc(exportedAt)}</dd>
      <dt>Reason</dt><dd>${esc(reason)}</dd>
      <dt>Event count</dt><dd>${(rows || []).length}</dd>
      <dt>Net inflow</dt><dd>${esc(formatAmount(totalCents, currency))}</dd>
    </dl>
    <p class="legal">
      This billing record export was generated from MyRX's immutable billing_events archive
      for the stated reason above. The export event is recorded in MyRX's audit log alongside
      the administrator's identity, reason, and timestamp. Stripe Dashboard retains the full
      receipt PII (customer name, payment method, address) per Stripe's own tax-compliance
      retention; click any "View in Stripe" link for the original receipt detail.
    </p>
  </div>
  ${(rows || []).length === 0
    ? '<div class="empty">No billing events were found for this customer.</div>'
    : `<table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Event</th>
            <th>Status</th>
            <th style="text-align: right;">Amount</th>
            <th>Stripe</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>`}
  <div class="footer">End of export — MyRX billing archive</div>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
  win.onload = () => setTimeout(() => { try { win.print() } catch { /* swallow */ } }, 100)
}
