-- Round 4 item 5: event forms (register/checkout/display) get their OWN logo,
-- separate from the partnership enquiry logo. Empty string means "use the
-- built-in RACC logo" on the event forms.
UPDATE system_settings
SET form_branding = COALESCE(form_branding, '{}'::jsonb)
  || jsonb_build_object('event_logo_url', COALESCE(form_branding->>'event_logo_url', ''));
COMMENT ON COLUMN system_settings.form_branding IS
  'Public-form branding: logo_url + footer_text apply to the partnership enquiry form; event_logo_url applies to event forms (register/checkout/display), blank = built-in RACC logo.';
