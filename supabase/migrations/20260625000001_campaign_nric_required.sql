-- Per-event toggle: whether invitees must provide their NRIC at registration.
-- Defaults to true so existing events keep their current (mandatory) behaviour.
-- Enforcement of "mandatory" happens in the registration form; the registrations
-- table and register_attendee() already accept a NULL NRIC (the per-slot NRIC
-- unique index is partial: WHERE invitee_nric IS NOT NULL), so "optional + blank"
-- must be stored as NULL rather than an empty string.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS nric_required boolean NOT NULL DEFAULT true;
