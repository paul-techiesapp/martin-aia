-- Add checkout configuration to campaigns
ALTER TABLE campaigns
  ADD COLUMN checkout_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Add checkout rating to attendance
ALTER TABLE attendance
  ADD COLUMN checkout_rating SMALLINT CHECK (checkout_rating >= 1 AND checkout_rating <= 5);
