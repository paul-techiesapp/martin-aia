-- Slot DateTime Migration: Replace day_of_week + start_time/end_time with start_at/end_at TIMESTAMPTZ
-- This is a breaking change. All existing slot data (test-only) is deleted.

-- 1. Delete dependent data first (be explicit about cascade order)
DELETE FROM rewards;
DELETE FROM attendance;
DELETE FROM pin_codes;
DELETE FROM invitations;
DELETE FROM slots;

-- 2. Drop old columns and constraints
ALTER TABLE slots
  DROP CONSTRAINT IF EXISTS valid_times,
  DROP COLUMN day_of_week,
  DROP COLUMN start_time,
  DROP COLUMN end_time;

-- 3. Add new TIMESTAMPTZ columns (with temp defaults for NOT NULL)
ALTER TABLE slots
  ADD COLUMN start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN end_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 hours');

-- 4. Remove defaults (they were only needed for the ALTER ADD NOT NULL)
ALTER TABLE slots
  ALTER COLUMN start_at DROP DEFAULT,
  ALTER COLUMN end_at DROP DEFAULT;

-- 5. Add new constraints
ALTER TABLE slots
  ADD CONSTRAINT slots_datetime_check CHECK (end_at > start_at),
  ADD CONSTRAINT slots_unique_start UNIQUE (campaign_id, start_at);
