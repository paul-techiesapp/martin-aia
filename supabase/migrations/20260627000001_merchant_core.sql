-- ============================================================
-- Merchant Partnership — core tables, enums, RLS, approve RPCs
-- ============================================================

-- Enums (all four created here; used across phases)
CREATE TYPE merchant_status AS ENUM ('pending', 'active', 'inactive');
CREATE TYPE enquiry_status  AS ENUM ('open', 'closed');
CREATE TYPE vehicle_status  AS ENUM ('submitted', 'quoted', 'renewed', 'lost');
CREATE TYPE gift_status     AS ENUM ('issued', 'redeemed', 'expired', 'void');

-- merchants -------------------------------------------------
CREATE TABLE merchants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  logo_url            TEXT,
  gift_pool_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  merchant_share_pct  NUMERIC(5,2)  NOT NULL DEFAULT 0
                        CHECK (merchant_share_pct >= 0 AND merchant_share_pct <= 100),
  status              merchant_status NOT NULL DEFAULT 'pending',
  created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_merchants_status ON merchants(status);
CREATE INDEX idx_merchants_created_by_agent ON merchants(created_by_agent_id);
CREATE TRIGGER merchants_updated_at
  BEFORE UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- merchant_branches ----------------------------------------
CREATE TABLE merchant_branches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  address             TEXT,
  phone               TEXT,
  status              merchant_status NOT NULL DEFAULT 'pending',
  created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_merchant_branches_merchant ON merchant_branches(merchant_id);
CREATE INDEX idx_merchant_branches_status ON merchant_branches(status);
CREATE TRIGGER merchant_branches_updated_at
  BEFORE UPDATE ON merchant_branches FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- insurance_products ---------------------------------------
CREATE TABLE insurance_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER insurance_products_updated_at
  BEFORE UPDATE ON insurance_products FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO insurance_products (name, sort_order) VALUES
  ('Comprehensive', 1),
  ('Third Party, Fire & Theft', 2),
  ('Third Party', 3);

-- branch_links (per-agent shareable QR; agent_id NULL = house)
CREATE TABLE branch_links (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id UUID NOT NULL REFERENCES merchant_branches(id) ON DELETE CASCADE,
  agent_id           UUID REFERENCES agents(id) ON DELETE SET NULL,
  link_code          TEXT NOT NULL UNIQUE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_branch_links_branch ON branch_links(merchant_branch_id);
CREATE INDEX idx_branch_links_agent ON branch_links(agent_id);

-- approve RPCs ---------------------------------------------
CREATE OR REPLACE FUNCTION approve_merchant(merchant_uuid UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can approve merchants'; END IF;
  UPDATE merchants
     SET status = 'active', approved_by = auth.uid(), approved_at = NOW()
   WHERE id = merchant_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION approve_merchant_branch(branch_uuid UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can approve branches'; END IF;
  UPDATE merchant_branches
     SET status = 'active', approved_by = auth.uid(), approved_at = NOW()
   WHERE id = branch_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS ------------------------------------------------------
ALTER TABLE merchants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_branches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_links       ENABLE ROW LEVEL SECURITY;

-- merchants policies
CREATE POLICY "Admin full access to merchants"
  ON merchants FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read active or own merchants"
  ON merchants FOR SELECT TO authenticated
  USING (status = 'active' OR created_by_agent_id = get_agent_id());
CREATE POLICY "Agents propose merchants"
  ON merchants FOR INSERT TO authenticated
  WITH CHECK (created_by_agent_id = get_agent_id() AND status = 'pending');

-- merchant_branches policies
CREATE POLICY "Admin full access to merchant_branches"
  ON merchant_branches FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read active or own branches"
  ON merchant_branches FOR SELECT TO authenticated
  USING (status = 'active' OR created_by_agent_id = get_agent_id());
CREATE POLICY "Agents propose branches"
  ON merchant_branches FOR INSERT TO authenticated
  WITH CHECK (created_by_agent_id = get_agent_id() AND status = 'pending');

-- insurance_products policies (anon read of active needed by the Phase 2 form)
CREATE POLICY "Admin full access to insurance_products"
  ON insurance_products FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Authenticated read active products"
  ON insurance_products FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "Anon read active products"
  ON insurance_products FOR SELECT TO anon USING (is_active);

-- branch_links policies
CREATE POLICY "Admin full access to branch_links"
  ON branch_links FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents manage own branch_links"
  ON branch_links FOR ALL TO authenticated
  USING (agent_id = get_agent_id()) WITH CHECK (agent_id = get_agent_id());
