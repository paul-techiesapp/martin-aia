-- ============================================================
-- Merchant Partnership — customer enquiries (header + vehicles)
-- ============================================================

CREATE TABLE enquiries (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_link_id            UUID NOT NULL REFERENCES branch_links(id),
  merchant_branch_id        UUID NOT NULL REFERENCES merchant_branches(id),
  agent_id                  UUID REFERENCES agents(id) ON DELETE SET NULL,
  customer_name             TEXT NOT NULL,
  customer_nric             TEXT NOT NULL,
  customer_nric_normalized  TEXT NOT NULL,
  customer_phone            TEXT NOT NULL,
  customer_phone_normalized TEXT NOT NULL,
  customer_email            TEXT,
  status                    enquiry_status NOT NULL DEFAULT 'open',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_enquiries_branch ON enquiries(merchant_branch_id);
CREATE INDEX idx_enquiries_agent ON enquiries(agent_id);
CREATE INDEX idx_enquiries_status ON enquiries(status);
CREATE TRIGGER enquiries_updated_at
  BEFORE UPDATE ON enquiries FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE enquiry_vehicles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id             UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  merchant_branch_id     UUID NOT NULL REFERENCES merchant_branches(id),
  car_plate              TEXT NOT NULL,
  car_plate_normalized   TEXT NOT NULL,
  insurance_expiry_date  DATE NOT NULL,
  insurance_product_id   UUID NOT NULL REFERENCES insurance_products(id),
  status                 vehicle_status NOT NULL DEFAULT 'submitted',
  external_quotation_ref TEXT,
  quoted_at              TIMESTAMPTZ,
  quoted_by              UUID,
  renewed_at             TIMESTAMPTZ,
  renewed_by             UUID,
  lost_at                TIMESTAMPTZ,
  lost_reason            TEXT,
  reminder_sent_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_enquiry_vehicles_enquiry ON enquiry_vehicles(enquiry_id);
CREATE INDEX idx_enquiry_vehicles_status ON enquiry_vehicles(status);
CREATE INDEX idx_enquiry_vehicles_expiry ON enquiry_vehicles(insurance_expiry_date);
-- Block the exact same car (per branch) being submitted twice
CREATE UNIQUE INDEX uq_enquiry_vehicle_dedup
  ON enquiry_vehicles(merchant_branch_id, car_plate_normalized, insurance_expiry_date);
CREATE TRIGGER enquiry_vehicles_updated_at
  BEFORE UPDATE ON enquiry_vehicles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS (NO anon policies — Phase 2 public writes go through a SECURITY DEFINER RPC)
ALTER TABLE enquiries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to enquiries"
  ON enquiries FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own enquiries"
  ON enquiries FOR SELECT TO authenticated USING (agent_id = get_agent_id());

CREATE POLICY "Admin full access to enquiry_vehicles"
  ON enquiry_vehicles FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own enquiry_vehicles"
  ON enquiry_vehicles FOR SELECT TO authenticated
  USING (enquiry_id IN (SELECT id FROM enquiries WHERE agent_id = get_agent_id()));
