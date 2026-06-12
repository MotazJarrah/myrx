-- T165: hourly cron that invokes the trial-reminders edge function
-- (7-day + 2-day FullRX trial reminder emails via SendGrid).
--
-- Auth: the function requires the service-role key. The key is NOT
-- inlined here — it's read at call time from Vault (secret name
-- 'service_role_key'). Until that secret is created (one-time, via the
-- dashboard SQL editor: select vault.create_secret('<key>',
-- 'service_role_key');), the COALESCE sends a placeholder Bearer token,
-- the edge function 401s, and the job is a harmless no-op.

CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'b2c_trial_reminders',
  '15 * * * *',  -- hourly at :15 (offset from the :00 anonymize job)
  $$
  SELECT net.http_post(
    url     := 'https://xtxzfhoxyyrlxslgzvty.supabase.co/functions/v1/trial-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'missing-vault-secret'
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
