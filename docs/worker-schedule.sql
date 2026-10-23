-- Administrator setup. First store the same random worker credential in
-- Vercel production SYNC_WORKER_SECRET and Supabase Vault under the name
-- datoko_sync_worker_secret. Never put the credential in this file.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Only the administrator-owned cron job needs networking. App and browser
-- roles must not inspect queued HTTP Authorization headers.
REVOKE ALL ON SCHEMA net FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'datoko-sync-worker',
  '* * * * *',
  $worker$
    SELECT net.http_post(
      url := 'https://datoko.vercel.app/api/internal/sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'datoko_sync_worker_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 280000
    );
  $worker$
);

-- Inspect status_code/content in net._http_response and run status in
-- public.sync_runs. HTTP 202 with status busy means another batch holds the
-- worker lock; the next scheduled invocation will try again.
