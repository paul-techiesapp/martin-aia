-- Move invitation mode from slot-level (is_auto_card) to agent-level (is_auto_invite)
-- is_auto_invite: when true, future email integration will auto-send invitation cards
ALTER TABLE agents ADD COLUMN is_auto_invite BOOLEAN NOT NULL DEFAULT true;

-- Remove legacy slot-level auto card flag
ALTER TABLE slots DROP COLUMN is_auto_card;
