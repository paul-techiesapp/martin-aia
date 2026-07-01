-- Make agents.nric nullable and use partial unique index
-- Fixes: "duplicate key value violates unique constraint agents_nric_key"
-- when creating agents without NRIC (optional field)

-- Drop the existing unique constraint
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_nric_key;

-- Make nric nullable and convert empty strings to NULL
ALTER TABLE agents ALTER COLUMN nric DROP NOT NULL;
UPDATE agents SET nric = NULL WHERE nric = '';

-- Create partial unique index (only enforces uniqueness on non-null values)
CREATE UNIQUE INDEX agents_nric_unique ON agents(nric) WHERE nric IS NOT NULL;
