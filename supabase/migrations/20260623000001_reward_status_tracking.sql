-- Reward status verification: Issued/Failed states + audit timestamp + admin RPC
--
-- Request #1 (Award Status Verification): admins need to mark a reward as
-- Issued (Sent) or Failed and see WHEN it was issued. The rewards table already
-- tracked 'pending'/'confirmed'/'paid' but had no 'failed' state, no issued
-- timestamp, and no failure reason. We:
--   * add 'failed' to the reward_status enum ('paid' continues to mean Issued/Sent)
--   * add issued_at + failure_reason columns
--   * expose an admin-only RPC that stamps issued_at server-side
--
-- ALTER TYPE ... ADD VALUE is safe inside this migration: the new 'failed' value
-- is only referenced inside the plpgsql RPC body (resolved at call time, not
-- during this migration), and no row is updated to 'failed' here.

ALTER TYPE reward_status ADD VALUE IF NOT EXISTS 'failed';

ALTER TABLE rewards ADD COLUMN IF NOT EXISTS issued_at      timestamptz;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS failure_reason text;

-- Admin-only status transition with server-authoritative issued_at.
--   'paid'   => Issued/Sent  (stamps issued_at = now())
--   'failed' => records failure_reason, clears issued_at
--   anything else (e.g. 'pending') => resets both audit fields (retry)
CREATE OR REPLACE FUNCTION set_reward_status(
  p_reward_id uuid,
  p_status    reward_status,
  p_reason    text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can change reward status' USING ERRCODE = '42501';
  END IF;

  UPDATE rewards SET
    status         = p_status,
    issued_at      = CASE WHEN p_status = 'paid'   THEN now()    ELSE NULL END,
    failure_reason = CASE WHEN p_status = 'failed' THEN p_reason ELSE NULL END,
    updated_at     = now()
  WHERE id = p_reward_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reward % not found', p_reward_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_reward_status(uuid, reward_status, text) TO authenticated;
