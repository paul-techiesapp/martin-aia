-- Add tier_id to partners table
ALTER TABLE partners
  ADD COLUMN tier_id UUID REFERENCES tiers(id);

-- Extend tier_requests to support partners
ALTER TABLE tier_requests
  ALTER COLUMN agent_id DROP NOT NULL,
  ADD COLUMN partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  ADD CONSTRAINT tier_requests_target_check
    CHECK (
      (agent_id IS NOT NULL AND partner_id IS NULL) OR
      (agent_id IS NULL AND partner_id IS NOT NULL)
    );

CREATE INDEX idx_tier_requests_partner ON tier_requests(partner_id);
