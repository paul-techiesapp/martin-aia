-- Auto-populate the rewards table when a registration reaches 'completed'.
--
-- Previously nothing ever wrote to rewards, so every reward figure in the UI was
-- a client-side estimate. This adds a trigger that records a 'pending' reward
-- (amount = the owning agent's tier reward_amount) for each completed attendance,
-- plus a one-time backfill for registrations already completed.
--
-- rewards.attendance_id is NOT NULL + UNIQUE, so rewards are 1:1 with attendance.
-- A reward is attributed to the registration's agent (the link owner) at that
-- agent's tier rate, matching the existing Rewards page behaviour. Agents without
-- a tier (tier_id NULL) earn no reward row (there is no rate to apply).

CREATE OR REPLACE FUNCTION create_reward_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_amount numeric;
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

    INSERT INTO rewards (agent_id, attendance_id, amount, capacity_type, status)
    VALUES (NEW.agent_id, v_attendance_id, v_amount, NEW.capacity_type, 'pending')
    ON CONFLICT (attendance_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_reward_on_completion ON registrations;
CREATE TRIGGER trg_create_reward_on_completion
  AFTER UPDATE OF status ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION create_reward_on_completion();

-- One-time backfill for registrations already marked completed.
INSERT INTO rewards (agent_id, attendance_id, amount, capacity_type, status)
SELECT r.agent_id, att.id, t.reward_amount, r.capacity_type, 'pending'
FROM registrations r
JOIN attendance att ON att.registration_id = r.id
JOIN agents a ON a.id = r.agent_id
JOIN tiers t ON t.id = a.tier_id
WHERE r.status = 'completed'
ON CONFLICT (attendance_id) DO NOTHING;
