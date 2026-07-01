-- ============================================================
-- Merchant Partnership — payout ledgers (created on renewal)
-- ============================================================

-- gifts (customer gold voucher) ----------------------------
CREATE TABLE gifts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_vehicle_id UUID NOT NULL UNIQUE REFERENCES enquiry_vehicles(id) ON DELETE CASCADE,
  merchant_id        UUID NOT NULL REFERENCES merchants(id),
  merchant_branch_id UUID NOT NULL REFERENCES merchant_branches(id),
  value_amount       NUMERIC(10,2) NOT NULL,
  voucher_code       TEXT NOT NULL UNIQUE,
  status             gift_status NOT NULL DEFAULT 'issued',
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at        TIMESTAMPTZ,
  redeemed_by        UUID,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_gifts_status ON gifts(status);
CREATE INDEX idx_gifts_merchant ON gifts(merchant_id);
CREATE TRIGGER gifts_updated_at
  BEFORE UPDATE ON gifts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- merchant_commissions (agent payout ledger) ---------------
CREATE TABLE merchant_commissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_vehicle_id UUID NOT NULL UNIQUE REFERENCES enquiry_vehicles(id) ON DELETE CASCADE,
  agent_id           UUID NOT NULL REFERENCES agents(id),
  tier_id            UUID REFERENCES tiers(id),
  amount             NUMERIC(10,2) NOT NULL,
  status             reward_status NOT NULL DEFAULT 'pending',
  paid_at            TIMESTAMPTZ,
  failure_reason     TEXT,
  set_by             UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_merchant_commissions_agent ON merchant_commissions(agent_id);
CREATE INDEX idx_merchant_commissions_status ON merchant_commissions(status);
CREATE TRIGGER merchant_commissions_updated_at
  BEFORE UPDATE ON merchant_commissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- merchant_settlements (merchant payable ledger) -----------
CREATE TABLE merchant_settlements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_vehicle_id UUID NOT NULL UNIQUE REFERENCES enquiry_vehicles(id) ON DELETE CASCADE,
  merchant_id        UUID NOT NULL REFERENCES merchants(id),
  amount             NUMERIC(10,2) NOT NULL,
  status             reward_status NOT NULL DEFAULT 'pending',
  paid_at            TIMESTAMPTZ,
  failure_reason     TEXT,
  set_by             UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_merchant_settlements_merchant ON merchant_settlements(merchant_id);
CREATE INDEX idx_merchant_settlements_status ON merchant_settlements(status);
CREATE TRIGGER merchant_settlements_updated_at
  BEFORE UPDATE ON merchant_settlements FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS ------------------------------------------------------
ALTER TABLE gifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to gifts"
  ON gifts FOR ALL TO authenticated USING (is_admin());

CREATE POLICY "Admin full access to merchant_commissions"
  ON merchant_commissions FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own commissions"
  ON merchant_commissions FOR SELECT TO authenticated USING (agent_id = get_agent_id());

CREATE POLICY "Admin full access to merchant_settlements"
  ON merchant_settlements FOR ALL TO authenticated USING (is_admin());
