-- System-wide settings (single-row table)
CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_branding JSONB NOT NULL DEFAULT '{}',
  card_template JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with defaults
INSERT INTO system_settings (company_branding, card_template) VALUES (
  '{"companyName": "RACC Agency", "logoUrl": null, "logoWidth": 20}',
  '{"autoCardColor": "#0f172a", "manualCardColor": "#7f1d1d", "panelTextColor": "#ffffff", "accentColor": "#daa520", "fontFamily": "helvetica", "titleFontSize": 14, "bodyFontSize": 9, "subtitle": "Event Invitation", "instructionText": "Present this card at the event for check-in", "visibleElements": ["logo","subtitle","date","campaign","venue","qr","invitee","instruction","reference"], "elementOrder": ["campaign","venue","qr","invitee","instruction","reference"], "qrColor": "#0f172a", "qrSize": 25}'
);

-- RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Admin can read and write
CREATE POLICY "Admins can manage system settings"
  ON system_settings FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Agents can read (for branding in their portal)
CREATE POLICY "Authenticated users can read system settings"
  ON system_settings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Anon can read (for public pages branding)
CREATE POLICY "Anon can read system settings"
  ON system_settings FOR SELECT
  USING (true);
