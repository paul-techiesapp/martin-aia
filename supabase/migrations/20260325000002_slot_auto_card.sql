-- Add is_auto_card flag to slots table
-- true = agents can download cards from portal (auto distribution)
-- false = only admin can print cards (manual distribution)
ALTER TABLE slots ADD COLUMN is_auto_card BOOLEAN NOT NULL DEFAULT true;
