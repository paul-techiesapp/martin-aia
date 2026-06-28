-- ============================================================
-- Merchant Partnership — Phase 4: auto expiry reminders
-- (pg_cron + pg_net + enqueue RPC + daily schedule)
-- ============================================================

-- 1) Extensions ---------------------------------------------
-- pg_net exposes its HTTP API in the `net` schema; on Supabase it is
-- conventionally installed into the `extensions` schema (its functions are
-- still called as net.http_post). pg_cron is relocatable=false and ALWAYS
-- owns the `cron` schema, so it is created without WITH SCHEMA. Both lines are
-- idempotent no-ops on Supabase-hosted projects where the extensions are
-- already enabled via Dashboard → Database → Extensions.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2) Enqueue function ---------------------------------------
-- Reads the per-environment Supabase functions base URL + service-role key
-- from Vault (see Step 2 for the one-time, per-env secret inserts), selects
-- every vehicle whose insurance expires in exactly 30 days that has not been
-- reminded and is still open (submitted/quoted), and fires one async
-- net.http_post to the send-expiry-reminders edge function per vehicle. The
-- edge function stamps reminder_sent_at on success, so this RPC stays
-- side-effect-free on the row itself. Returns the number of vehicles enqueued.
CREATE OR REPLACE FUNCTION public.enqueue_expiry_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, cron, net, vault
AS $$
DECLARE
  v_base_url    text;
  v_service_key text;
  v_vehicle     record;
  v_count       integer := 0;
BEGIN
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_base_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'enqueue_expiry_reminders: Vault secrets project_url/service_role_key not set; skipping run';
    RETURN 0;
  END IF;

  FOR v_vehicle IN
    SELECT ev.id
      FROM public.enquiry_vehicles ev
     WHERE ev.insurance_expiry_date = (CURRENT_DATE + INTERVAL '30 days')::date
       AND ev.reminder_sent_at IS NULL
       AND ev.status IN ('submitted', 'quoted')
  LOOP
    PERFORM net.http_post(
      url     := v_base_url || '/functions/v1/send-expiry-reminders',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_service_key
                 ),
      body    := jsonb_build_object('vehicle_id', v_vehicle.id),
      timeout_milliseconds := 8000
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Lock the function down: it is invoked only by the cron job (which runs as the
-- table owner / postgres). No client role may call it.
REVOKE ALL ON FUNCTION public.enqueue_expiry_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_expiry_reminders() FROM anon, authenticated;

-- 3) Daily schedule -----------------------------------------
-- 01:00 UTC = 09:00 Asia/Singapore, every day. cron.schedule upserts by job
-- name, so re-applying this migration replaces the job rather than duplicating.
SELECT cron.schedule(
  'expiry-reminders-daily',
  '0 1 * * *',
  $cron$ SELECT public.enqueue_expiry_reminders(); $cron$
);
