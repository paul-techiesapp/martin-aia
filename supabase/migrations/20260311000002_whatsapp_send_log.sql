-- WhatsApp send log for rate limiting PIN delivery
CREATE TABLE whatsapp_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  nric TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_send_log_lookup ON whatsapp_send_log(slot_id, nric, sent_at);

-- RLS
ALTER TABLE whatsapp_send_log ENABLE ROW LEVEL SECURITY;

-- Edge Functions run with service_role key, so no RLS policy needed for them.
-- Admin can read for monitoring.
CREATE POLICY "admin_read_whatsapp_send_log" ON whatsapp_send_log
  FOR SELECT TO authenticated USING (is_admin());
