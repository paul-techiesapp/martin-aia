-- Display tokens for public venue QR display URLs
CREATE TABLE display_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_display_tokens_slot ON display_tokens(slot_id);
CREATE INDEX idx_display_tokens_token ON display_tokens(token);

-- RLS
ALTER TABLE display_tokens ENABLE ROW LEVEL SECURITY;

-- Admin: full access (matches existing pattern using is_admin() helper)
CREATE POLICY "Admin full access to display_tokens" ON display_tokens
  FOR ALL TO authenticated USING (is_admin());

-- Public (anon): read only to validate token on display page
CREATE POLICY "Public can read display_tokens" ON display_tokens
  FOR SELECT TO anon USING (true);
