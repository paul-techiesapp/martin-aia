-- Update card_template JSON: replace autoCardColor/manualCardColor with panelColor
UPDATE system_settings
SET card_template = card_template
  - 'autoCardColor'
  - 'manualCardColor'
  || '{"panelColor": "#0f172a"}'::jsonb;
