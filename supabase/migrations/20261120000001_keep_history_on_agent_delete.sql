-- Keep event / reward / commission history when an agent is deleted (Nov 2026).
--
-- Before: deleting an agent (delete-agent edge fn -> auth.users delete -> agents
-- cascade) CASCADE-deleted every registration the agent brought in, and through
-- it their attendance, OTP codes and rewards. merchant_commissions.agent_id and
-- tier_requests.requested_by had NO ACTION, so an agent with commissions or who
-- had requested a tier could not be deleted at all.
--
-- After: those links become ON DELETE SET NULL, and a BEFORE DELETE trigger on
-- agents stamps the agent's name / code / unit onto the surviving rows so reports
-- can still show who brought each attendee ("Former agent").
--
-- FKs are dropped by (table, column) rather than by name because the prod name
-- for registrations.agent_id is still the legacy `invitations_agent_id_fkey`.

CREATE OR REPLACE FUNCTION pg_temp.drop_fks_on(p_table regclass, p_column text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    WHERE con.contype = 'f' AND con.conrelid = p_table AND a.attname = p_column
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table, r.conname);
  END LOOP;
END $$;

-- 1. Snapshot columns ------------------------------------------------------
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS former_agent_name text,
  ADD COLUMN IF NOT EXISTS former_agent_code text,
  ADD COLUMN IF NOT EXISTS former_agent_unit text;

ALTER TABLE public.rewards
  ADD COLUMN IF NOT EXISTS former_agent_name text,
  ADD COLUMN IF NOT EXISTS former_agent_code text,
  ADD COLUMN IF NOT EXISTS former_agent_unit text;

ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS former_agent_name text,
  ADD COLUMN IF NOT EXISTS former_agent_code text,
  ADD COLUMN IF NOT EXISTS former_agent_unit text;

-- 2. registrations.agent_id : CASCADE -> SET NULL ------------------------------
ALTER TABLE public.registrations ALTER COLUMN agent_id DROP NOT NULL;
SELECT pg_temp.drop_fks_on('public.registrations', 'agent_id');
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;

-- 3. registrations.agent_link_id : NO ACTION -> SET NULL -----------------------
-- (agent_links cascade-delete with the agent; the registration must survive)
SELECT pg_temp.drop_fks_on('public.registrations', 'agent_link_id');
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_agent_link_id_fkey
  FOREIGN KEY (agent_link_id) REFERENCES public.agent_links(id) ON DELETE SET NULL;

-- 4. rewards.agent_id : CASCADE -> SET NULL ------------------------------------
ALTER TABLE public.rewards ALTER COLUMN agent_id DROP NOT NULL;
SELECT pg_temp.drop_fks_on('public.rewards', 'agent_id');
ALTER TABLE public.rewards
  ADD CONSTRAINT rewards_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;

-- 5. merchant_commissions.agent_id : NO ACTION (blocked delete) -> SET NULL ---
ALTER TABLE public.merchant_commissions ALTER COLUMN agent_id DROP NOT NULL;
SELECT pg_temp.drop_fks_on('public.merchant_commissions', 'agent_id');
ALTER TABLE public.merchant_commissions
  ADD CONSTRAINT merchant_commissions_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;

-- 6. tier_requests.requested_by : NO ACTION (blocked delete) -> SET NULL ------
ALTER TABLE public.tier_requests ALTER COLUMN requested_by DROP NOT NULL;
SELECT pg_temp.drop_fks_on('public.tier_requests', 'requested_by');
ALTER TABLE public.tier_requests
  ADD CONSTRAINT tier_requests_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES public.agents(id) ON DELETE SET NULL;

-- 7. Stamp the deleted agent onto surviving history -----------------------------
-- BEFORE DELETE runs before the FK SET NULL actions, so agent_id still matches.
-- Fires per row, including agents removed by the parent_agent_id cascade.
CREATE OR REPLACE FUNCTION public.stamp_former_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE registrations
     SET former_agent_name = OLD.name,
         former_agent_code = OLD.agent_code,
         former_agent_unit = OLD.unit_name
   WHERE agent_id = OLD.id;

  UPDATE rewards
     SET former_agent_name = OLD.name,
         former_agent_code = OLD.agent_code,
         former_agent_unit = OLD.unit_name
   WHERE agent_id = OLD.id;

  UPDATE merchant_commissions
     SET former_agent_name = OLD.name,
         former_agent_code = OLD.agent_code,
         former_agent_unit = OLD.unit_name
   WHERE agent_id = OLD.id;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_former_agent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agents_stamp_former_agent ON public.agents;
CREATE TRIGGER agents_stamp_former_agent
  BEFORE DELETE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.stamp_former_agent();
