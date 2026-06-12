-- T165: replace the vault-service-key auth for the trial-reminders cron
-- with a NONCE handshake — zero human secret-handling.
--
-- How it works: each cron tick INSERTs a one-time row into cron_nonces and
-- passes its id in the request body. The edge function (service-role)
-- atomically consumes the nonce (used_at stamp, 10-minute freshness) and
-- refuses to run without one. Only something with DB write access (the
-- cron, or an operator via SQL) can mint nonces — an outsider calling the
-- function URL gets 401. This removes the vault.create_secret one-time
-- setup entirely (the previous design 401'd forever until a human pasted
-- the service key into Vault — see the now-obsolete
-- 20260609_t165_trial_reminders_cron.sql).

CREATE TABLE IF NOT EXISTS public.cron_nonces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz
);
-- RLS on, NO policies: only service-role / postgres can touch it.
ALTER TABLE public.cron_nonces ENABLE ROW LEVEL SECURITY;

-- Replace the cron job (same name → unschedule first, then re-create).
SELECT cron.unschedule('b2c_trial_reminders');
SELECT cron.schedule(
  'b2c_trial_reminders',
  '15 * * * *',  -- hourly at :15 (offset from the :00 anonymize job)
  $$
  WITH n AS (
    INSERT INTO public.cron_nonces (purpose) VALUES ('trial_reminders') RETURNING id
  )
  SELECT net.http_post(
    url     := 'https://xtxzfhoxyyrlxslgzvty.supabase.co/functions/v1/trial-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('nonce', (SELECT id FROM n))
  );
  $$
);

-- Housekeeping: old consumed/stale nonces get purged by the same hourly
-- tick's freshness check being 10 min; add a weekly cleanup job.
SELECT cron.schedule(
  'cron_nonces_cleanup',
  '0 4 * * 0',  -- Sundays 04:00
  $$ DELETE FROM public.cron_nonces WHERE created_at < now() - interval '7 days'; $$
);
