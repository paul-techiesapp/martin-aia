-- Item 8 (feedback round 2): one admin-managed logo + footer shared across ALL
-- public forms (events register/checkout/display + partnership enquiry).
-- Stored on the single-row system_settings (already anon-readable). Per-form
-- titles stay built-in; only logo + footer are shared/configurable here.
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS form_branding JSONB NOT NULL DEFAULT jsonb_build_object(
    'logo_url', '',
    'footer_text', '© RACC Agency. All rights reserved.'
  );
