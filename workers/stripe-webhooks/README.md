# MyRX Stripe Webhooks Worker

Cloudflare Worker that receives Stripe webhook events and mirrors them into
Supabase. Built for the Coach Platform v1 billing model per CLAUDE.md Locks
18-20.

## Endpoints

- `POST /stripe-webhooks/coach-subs` — coach subscription lifecycle.
  Handles `customer.subscription.created/updated/deleted`, `invoice.paid`,
  `invoice.payment_failed`. Writes to `coach_subscriptions` +
  `profiles.coach_subscription_*`.
- `POST /stripe-webhooks/b2c-purchases` — B2C one-time purchases via Stripe
  Checkout web. Handles `checkout.session.completed` (`mode=payment`).
  Writes to `b2c_purchases`.

Mounted at `myrxfit.com/stripe-webhooks/*` (catches before Cloudflare Pages).

## Setup (one-time per environment)

### 1. Install wrangler dependencies (workspace root)

```bash
# From repo root
npm install --save-dev wrangler
```

### 2. Configure secrets (TEST mode)

```bash
cd workers/stripe-webhooks

# Supabase service role key (bypasses RLS for DB writes)
# Get from: Supabase dashboard → Settings → API → service_role secret
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Stripe TEST mode secret key
# Get from: https://dashboard.stripe.com/test/apikeys → Secret key
wrangler secret put STRIPE_SECRET_KEY_TEST

# Stripe TEST webhook signing secret
# Set AFTER deploying once + registering the endpoint URL in Stripe:
# https://dashboard.stripe.com/test/webhooks → Add endpoint → use the deployed
# worker URL + the events listed under "Stripe webhook events to register" below.
# Stripe shows the whsec_... after creating the endpoint.
wrangler secret put STRIPE_WEBHOOK_SECRET_TEST
```

### 3. Deploy

```bash
wrangler deploy
```

The deployed URL will be something like
`https://myrx-stripe-webhooks.<account>.workers.dev` initially, but the route
in `wrangler.toml` also catches `myrxfit.com/stripe-webhooks/*` so once the
custom domain hits, you can use either URL.

### 4. Register the webhook endpoints in Stripe

Go to https://dashboard.stripe.com/test/webhooks → **Add endpoint** (do this
TWICE — once for each of our two endpoints):

**Endpoint 1: Coach subscriptions**
- URL: `https://myrxfit.com/stripe-webhooks/coach-subs`
- Events to listen for:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- Click "Add endpoint", then on the endpoint detail page reveal the **Signing
  secret** (starts with `whsec_...`). Set this as `STRIPE_WEBHOOK_SECRET_TEST`.

**Endpoint 2: B2C purchases**
- URL: `https://myrxfit.com/stripe-webhooks/b2c-purchases`
- Events to listen for:
  - `checkout.session.completed`
- **Important**: Stripe only lets you have ONE signing secret per endpoint.
  Both our endpoints share the SAME `STRIPE_WEBHOOK_SECRET_TEST` env var — so
  configure BOTH endpoints to use the SAME signing secret. To do that, after
  creating the second endpoint, replace its auto-generated signing secret by
  manually using the first endpoint's secret (or accept two separate secrets
  and split `STRIPE_WEBHOOK_SECRET_TEST` into `_COACH_SUBS` and `_B2C` vars,
  updating `src/index.js::webhookSecret()` to pick by route).

Alternatively (simpler): create a SINGLE endpoint at `/stripe-webhooks/all`
that handles all events and routes internally by event type. The current
two-endpoint split is for clarity but trades the ergonomics of one signing
secret for two.

### 5. Test

In the Stripe dashboard → Webhooks → your endpoint → **Send test webhook**.
Pick `customer.subscription.created` and click Send. Tail the worker logs:

```bash
wrangler tail myrx-stripe-webhooks
```

You should see `[coach-subs] customer.subscription.created ok: ...`.
If you see signature errors, verify the signing secret matches what's in
Stripe's dashboard.

## Production / live-mode switch

At launch (per CLAUDE.md launch checklist item 7-13):

1. Switch Stripe to live mode in the dashboard
2. Get live mode API keys + create a new webhook endpoint pointing to the
   production worker URL
3. Set the live secrets:
   ```bash
   wrangler secret put STRIPE_SECRET_KEY_LIVE
   wrangler secret put STRIPE_WEBHOOK_SECRET_LIVE
   ```
4. Update `wrangler.toml` `[vars] STRIPE_MODE = "live"` (or set as a secret
   so it can be toggled without a redeploy)
5. Redeploy: `wrangler deploy`

The worker code is mode-agnostic — `src/stripe.js::StripeRest` picks the
right key based on `env.STRIPE_MODE`.

## Architecture notes

- **Signature verification is done in `src/verify.js`** using Web Crypto
  (`crypto.subtle.importKey` + `sign`). The official Stripe Node SDK uses
  Node's `crypto` module which doesn't work in Workers — this is a Workers-
  native port of `stripe.webhooks.constructEvent`.
- **Tolerance**: 5 minutes for replay-window check (matches the Stripe SDK
  default).
- **Multiple signatures**: Stripe rotates signing secrets without
  invalidating in-flight requests — the `Stripe-Signature` header may
  contain multiple `v1=...` entries; ANY match is valid.
- **Idempotency**: writes use upsert with `on_conflict=stripe_subscription_id`
  (or `channel,channel_receipt_id` for B2C) so Stripe's at-least-once
  delivery doesn't create duplicates.
- **Retry behaviour**: handler errors return 500 → Stripe retries with
  exponential backoff up to 3 days. Transient DB failures auto-heal.
