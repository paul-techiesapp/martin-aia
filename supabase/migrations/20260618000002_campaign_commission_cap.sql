-- Optional per-campaign commission cap: only the first N invitees to COMPLETE
-- (check out) earn a reward for their agent. NULL = no cap (every completion
-- earns commission, the prior behaviour). Independent of max_headcount, which
-- caps registrations rather than commissions.
-- Spec: docs/superpowers/specs/2026-06-18-campaign-commission-cap-design.md

ALTER TABLE campaigns ADD COLUMN commission_cap INTEGER NULL;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_commission_cap_check
  CHECK (commission_cap IS NULL OR commission_cap > 0);

-- Replace the reward trigger function to honour the cap. The trigger itself
-- (trg_create_reward_on_completion) is unchanged and keeps pointing at this
-- function by name, so it does not need to be recreated.
CREATE OR REPLACE FUNCTION create_reward_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_amount numeric;
  v_campaign_id uuid;
  v_commission_cap integer;
  v_granted_count integer;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT id INTO v_attendance_id FROM attendance WHERE registration_id = NEW.id;
    IF v_attendance_id IS NULL THEN
      RETURN NEW;  -- no attendance row to attach the reward to
    END IF;

    SELECT t.reward_amount INTO v_amount
    FROM agents a
    JOIN tiers t ON t.id = a.tier_id
    WHERE a.id = NEW.agent_id;

    IF v_amount IS NULL THEN
      RETURN NEW;  -- agent has no tier / reward rate
    END IF;

    -- Resolve the campaign for this registration and lock it so concurrent
    -- checkouts cannot both slip past the Xth commission slot.
    SELECT c.id, c.commission_cap INTO v_campaign_id, v_commission_cap
    FROM slots s
    JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.id = NEW.slot_id
    FOR UPDATE OF c;

    -- Commission budget cap: only the first N completed invitees in the campaign
    -- earn a reward. NULL = no cap.
    IF v_commission_cap IS NOT NULL THEN
      SELECT COUNT(*) INTO v_granted_count
      FROM rewards rw
      JOIN attendance att ON att.id = rw.attendance_id
      JOIN registrations r ON r.id = att.registration_id
      JOIN slots s ON s.id = r.slot_id
      WHERE s.campaign_id = v_campaign_id;

      IF v_granted_count >= v_commission_cap THEN
        RETURN NEW;  -- commission budget exhausted; completion still succeeds
      END IF;
    END IF;

    INSERT INTO rewards (agent_id, attendance_id, amount, capacity_type, status)
    VALUES (NEW.agent_id, v_attendance_id, v_amount, NEW.capacity_type, 'pending')
    ON CONFLICT (attendance_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
