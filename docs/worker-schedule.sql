-- Administrator setup. First store the same random worker credential in
-- Vercel production SYNC_WORKER_SECRET and Supabase Vault under the name
-- datoko_sync_worker_secret. Never put the credential in this file.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS datoko_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA datoko_private FROM PUBLIC, anon, authenticated, datoko_app;

-- Send the Vault credential directly over HTTPS. Request headers are never
-- persisted in a shared HTTP request queue. Only the cron administrator can
-- invoke this helper; it does not elevate its caller's privileges.
CREATE OR REPLACE FUNCTION datoko_private.sync_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tick$
DECLARE
  credential text;
  response extensions.http_response;
  result jsonb;
BEGIN
  SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets
  WHERE name = 'datoko_sync_worker_secret';
  IF credential IS NULL OR length(credential) < 32 THEN
    RAISE EXCEPTION 'Datoko worker credential is not configured';
  END IF;
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '280000');
  PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '10000');
  SELECT * INTO response FROM extensions.http((
    'POST', 'https://datoko.vercel.app/api/internal/sync',
    ARRAY[extensions.http_header('Authorization', 'Bearer ' || credential)],
    'application/json', '{}'
  )::extensions.http_request);
  PERFORM extensions.http_reset_curlopt();
  IF response.status NOT IN (200, 202) THEN
    RAISE EXCEPTION 'Datoko worker returned HTTP %', response.status;
  END IF;
  result := response.content::jsonb;
  IF coalesce((result->>'failed')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'Datoko worker reported a failed sync job; inspect sync_runs';
  END IF;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  PERFORM extensions.http_reset_curlopt();
  RAISE;
END;
$tick$;
REVOKE ALL ON FUNCTION datoko_private.sync_tick() FROM PUBLIC, anon, authenticated, datoko_app;

SELECT cron.schedule(
  'datoko-sync-worker',
  '* * * * *',
  'SELECT datoko_private.sync_tick();'
);

-- Inspect cron.job_run_details and public.sync_runs. To run a batch manually:
-- SELECT datoko_private.sync_tick();
-- A busy result means another batch holds the worker lock.
