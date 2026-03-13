# Shareable Links & WhatsApp OTP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invitation token + PIN code system with shareable agent links + WhatsApp OTP checkout, implementing the full shareable links redesign with OneWaySMS WBA API integration.

**Architecture:** Single Supabase migration transforms the schema (invitations → registrations, new agent_links + otp_codes tables, drop pin_codes). Two new Edge Functions handle OTP send/verify via OneWaySMS WhatsApp API. All three portals (admin, agent, public) get updated UI. Coordinated big-bang deployment.

**Tech Stack:** Supabase (PostgreSQL, Edge Functions/Deno), React 18, Vite 5, TypeScript, TanStack Router/Query, shadcn/ui, OneWaySMS WBA API

**Specs:**
- Primary: `docs/superpowers/specs/2026-03-13-whatsapp-otp-integration-design.md`
- Parent: `docs/superpowers/specs/2026-03-11-shareable-links-redesign.md`

---

## File Structure

### Database
- **Create:** `supabase/migrations/20260313000001_shareable_links_redesign.sql` — single migration: enums, agent_links, registrations rename, otp_codes, attendance changes, drops, RLS, RPCs

### Edge Functions
- **Create:** `supabase/functions/_shared/whatsapp-service.ts` — WhatsApp provider abstraction (mock + OneWaySMS WBA)
- **Create:** `supabase/functions/_shared/phone-utils.ts` — phone normalization + masking
- **Create:** `supabase/functions/send-checkout-otp/index.ts` — OTP generation + WhatsApp delivery
- **Create:** `supabase/functions/verify-checkout-otp/index.ts` — OTP verification + checkout via `checkout_with_otp` RPC
- **Delete:** `supabase/functions/send-whatsapp-pin/` — replaced by send-checkout-otp
- **Modify:** `supabase/functions/deactivate-partner/index.ts` — deactivate agent_links instead of releasing invitations
- **Modify:** `supabase/functions/send-email-reminders/index.ts` — query `registrations` instead of `invitations`

> **Note on `_shared/` imports:** Supabase Edge Functions support importing from `_shared/` directories via relative paths (e.g., `../\_shared/whatsapp-service.ts`). This is a standard Supabase pattern. Verify imports resolve correctly after first deployment.

### Shared Types
- **Modify:** `packages/shared-types/src/enums.ts` — add RegistrationStatus, rename InvitationType → RegistrationType
- **Modify:** `packages/shared-types/src/database.ts` — Registration interface (replaces Invitation), AgentLink, OtpCode, update Attendance
- **Modify:** `packages/shared-types/src/index.ts` — re-export new types

### Public Pages
- **Rewrite:** `apps/public-pages/src/pages/Register.tsx` — lookup by link_code, call register_attendee RPC
- **Rewrite:** `apps/public-pages/src/pages/CheckIn.tsx` — QR + NRIC/Phone toggle (no PIN)
- **Rewrite:** `apps/public-pages/src/pages/CheckOut.tsx` — QR + NRIC/Phone → OTP → verify
- **Modify:** `apps/public-pages/src/router.tsx` — update route params (token → linkCode)

### Agent Portal
- **Create:** `apps/agent-portal/src/hooks/useAgentLinks.ts` — CRUD hooks for agent_links
- **Create:** `apps/agent-portal/src/hooks/useRegistrations.ts` — query registrations
- **Rewrite:** `apps/agent-portal/src/pages/Invitations.tsx` → `apps/agent-portal/src/pages/MyLinks.tsx` — shareable links per slot
- **Rewrite:** `apps/agent-portal/src/pages/AvailableInvitations.tsx` → `apps/agent-portal/src/pages/PartnerLinks.tsx` — partner link management
- **Delete:** `apps/agent-portal/src/pages/MyClaimedInvitations.tsx` — replaced by PartnerLinks
- **Modify:** `apps/agent-portal/src/pages/Dashboard.tsx` — registration stats instead of invitation stats
- **Modify:** `apps/agent-portal/src/router.tsx` — update routes
- **Modify:** `apps/agent-portal/src/components/Layout.tsx` — update nav labels
- **Delete:** `apps/agent-portal/src/hooks/useInvitations.ts` — replaced by useAgentLinks + useRegistrations
- **Delete:** `apps/agent-portal/src/hooks/usePartnerInvitations.ts` — replaced by useAgentLinks

### Admin Portal
- **Modify:** `apps/admin-portal/src/hooks/useCampaigns.ts` — update queries from invitations → registrations
- **Create:** `apps/admin-portal/src/hooks/useRegistrations.ts` — registration queries for admin
- **Modify:** `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx` — registration view per slot
- **Modify:** `apps/admin-portal/src/pages/campaigns/CampaignList.tsx` — remove PIN references
- **Delete:** PIN code management page (if exists at `/pin-codes` route)
- **Modify:** `apps/admin-portal/src/router.tsx` — remove pin-codes route
- **Modify:** `apps/admin-portal/src/pages/Dashboard.tsx` — update stats queries

---

## Chunk 1: Database Migration

### Task 1: Create the shareable links migration

**Files:**
- Create: `supabase/migrations/20260313000001_shareable_links_redesign.sql`

- [ ] **Step 1: Create migration file with new enum**

```sql
-- Migration: Shareable Links & WhatsApp OTP Redesign
-- Replaces invitation tokens + PIN codes with shareable agent links + OTP checkout

-- 1. Create new registration_status enum
CREATE TYPE registration_status AS ENUM ('registered', 'attended', 'completed', 'expired');
```

- [ ] **Step 2: Add agent_links table**

```sql
-- 2. Create agent_links table
CREATE TABLE agent_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slot_id     uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  partner_id  uuid REFERENCES partners(id) ON DELETE SET NULL,
  link_code   uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Partial unique indexes: one link per agent per slot, one per partner per slot
CREATE UNIQUE INDEX agent_links_unique_agent_slot
  ON agent_links(agent_id, slot_id) WHERE partner_id IS NULL;
CREATE UNIQUE INDEX agent_links_unique_partner_slot
  ON agent_links(agent_id, slot_id, partner_id) WHERE partner_id IS NOT NULL;

CREATE TRIGGER set_agent_links_updated_at
  BEFORE UPDATE ON agent_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

- [ ] **Step 3: Modify attendance — drop pin_code_id**

```sql
-- 3. Drop pin_code_id from attendance (must happen before pin_codes drop)
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_pin_code_id_fkey;
ALTER TABLE attendance DROP COLUMN IF EXISTS pin_code_id;
```

- [ ] **Step 4: Rename invitations → registrations with schema changes**

```sql
-- 4a. Data migration: convert 'pending' invitations to 'expired'
-- (old one-time tokens no longer valid in link-based model)
UPDATE invitations SET status = 'expired' WHERE status = 'pending';

-- 4b. Rename invitations → registrations
ALTER TABLE invitations RENAME TO registrations;

-- Drop old columns
ALTER TABLE registrations DROP COLUMN IF EXISTS unique_token;
ALTER TABLE registrations DROP COLUMN IF EXISTS claimed_by_partner_id;

-- Add new column
ALTER TABLE registrations ADD COLUMN agent_link_id uuid REFERENCES agent_links(id);

-- Switch status column to new enum (safe now: no 'pending' values remain)
ALTER TABLE registrations
  ALTER COLUMN status TYPE registration_status
  USING status::text::registration_status;

-- Drop old global unique indexes and create per-slot indexes
DROP INDEX IF EXISTS idx_invitations_unique_token;
DROP INDEX IF EXISTS invitations_unique_nric;
DROP INDEX IF EXISTS invitations_unique_phone;

CREATE UNIQUE INDEX registrations_unique_nric_per_slot
  ON registrations(slot_id, invitee_nric) WHERE invitee_nric IS NOT NULL;
CREATE UNIQUE INDEX registrations_unique_phone_per_slot
  ON registrations(slot_id, invitee_phone) WHERE invitee_phone IS NOT NULL;

-- Rename constraints, indexes, triggers for consistency
ALTER INDEX IF EXISTS invitations_pkey RENAME TO registrations_pkey;
ALTER TRIGGER invitations_updated_at ON registrations RENAME TO registrations_updated_at;
```

- [ ] **Step 5: Create otp_codes table (after registrations exists)**

```sql
-- 5. Create otp_codes table
CREATE TABLE otp_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  slot_id         uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  code            text NOT NULL,
  expires_at      timestamptz NOT NULL,
  is_used         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_codes_verification
  ON otp_codes(registration_id, code, is_used, expires_at);
CREATE INDEX idx_otp_codes_rate_limit
  ON otp_codes(phone, slot_id, created_at);
```

- [ ] **Step 6: Update attendance FK**

```sql
-- 6. Rename invitation_id → registration_id in attendance
ALTER TABLE attendance RENAME COLUMN invitation_id TO registration_id;
ALTER TABLE attendance RENAME CONSTRAINT attendance_invitation_id_fkey TO attendance_registration_id_fkey;
ALTER TABLE attendance RENAME CONSTRAINT attendance_invitation_id_key TO attendance_registration_id_key;
ALTER INDEX IF EXISTS idx_attendance_invitation RENAME TO idx_attendance_registration;
```

- [ ] **Step 7: Drop obsolete tables and enums**

```sql
-- 7. Drop pin_codes table
DROP TABLE IF EXISTS pin_codes;

-- 8. Drop whatsapp_send_log table
DROP TABLE IF EXISTS whatsapp_send_log;

-- 9. Rename campaigns.invitation_type → registration_type
ALTER TABLE campaigns RENAME COLUMN invitation_type TO registration_type;

-- 10. Drop old enum (after all references removed)
-- Note: invitation_status enum may still be referenced; drop after column type change
DROP TYPE IF EXISTS invitation_status;
```

- [ ] **Step 8: Create RLS policies**

```sql
-- 11. RLS for agent_links
ALTER TABLE agent_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to agent_links"
  ON agent_links FOR ALL TO authenticated
  USING (is_admin());

CREATE POLICY "Agents manage own links"
  ON agent_links FOR ALL TO authenticated
  USING (agent_id = get_agent_id())
  WITH CHECK (agent_id = get_agent_id());

CREATE POLICY "Partners manage own links"
  ON agent_links FOR ALL TO authenticated
  USING (partner_id = get_partner_id() AND agent_id = get_partner_agent_id())
  WITH CHECK (partner_id = get_partner_id() AND agent_id = get_partner_agent_id());

CREATE POLICY "Anon read active links"
  ON agent_links FOR SELECT TO anon
  USING (is_active = true);

-- RLS for otp_codes: no direct access, Edge Functions use service role
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- Update registrations RLS (drop old invitation policies, create new)
DROP POLICY IF EXISTS "Agents manage own invitations" ON registrations;
DROP POLICY IF EXISTS "Admin full access to invitations" ON registrations;
DROP POLICY IF EXISTS "Public can read invitations by token" ON registrations;
DROP POLICY IF EXISTS "Public can update invitations by token" ON registrations;

CREATE POLICY "Admin full access to registrations"
  ON registrations FOR ALL TO authenticated
  USING (is_admin());

CREATE POLICY "Agents read own registrations"
  ON registrations FOR SELECT TO authenticated
  USING (agent_id = get_agent_id());

CREATE POLICY "Anon insert via RPC"
  ON registrations FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon update for attendance flow"
  ON registrations FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Update attendance RLS policies (column renamed invitation_id → registration_id)
DROP POLICY IF EXISTS "Agents read own attendance" ON attendance;
DROP POLICY IF EXISTS "Admin full access to attendance" ON attendance;
DROP POLICY IF EXISTS "Public can insert attendance" ON attendance;
DROP POLICY IF EXISTS "Public can update attendance" ON attendance;

CREATE POLICY "Admin full access to attendance"
  ON attendance FOR ALL TO authenticated
  USING (is_admin());

CREATE POLICY "Agents read own attendance"
  ON attendance FOR SELECT TO authenticated
  USING (registration_id IN (SELECT id FROM registrations WHERE agent_id = get_agent_id()));

CREATE POLICY "Anon insert attendance"
  ON attendance FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon update attendance"
  ON attendance FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
```

- [ ] **Step 9: Create register_attendee RPC function**

```sql
-- 12. Atomic registration with capacity check
CREATE OR REPLACE FUNCTION register_attendee(
  p_link_code uuid,
  p_name text,
  p_nric text,
  p_phone text,
  p_email text DEFAULT NULL,
  p_occupation text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_link agent_links%ROWTYPE;
  v_tier tiers%ROWTYPE;
  v_agent agents%ROWTYPE;
  v_count integer;
  v_capacity_type capacity_type;
  v_registration_id uuid;
BEGIN
  -- Look up agent_link with row lock (serializes concurrent registrations per link)
  SELECT * INTO v_link FROM agent_links WHERE link_code = p_link_code AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE = 'P0001';
  END IF;

  -- Get agent's tier for capacity limit
  SELECT a.* INTO v_agent FROM agents a WHERE a.id = v_link.agent_id;
  SELECT t.* INTO v_tier FROM tiers t WHERE t.id = v_agent.tier_id;

  -- Capacity check (lock held on agent_link prevents concurrent over-registration)
  SELECT COUNT(*) INTO v_count
  FROM registrations
  WHERE agent_id = v_link.agent_id AND slot_id = v_link.slot_id;

  IF v_count >= v_tier.invitation_limit_per_slot THEN
    RAISE EXCEPTION 'Registration full' USING ERRCODE = 'P0002';
  END IF;

  -- Determine capacity type
  IF v_link.partner_id IS NULL THEN
    v_capacity_type := 'agent';
  ELSE
    v_capacity_type := 'business_partner';
  END IF;

  -- Check NRIC duplicate per slot
  IF p_nric IS NOT NULL THEN
    PERFORM 1 FROM registrations WHERE slot_id = v_link.slot_id AND invitee_nric = p_nric;
    IF FOUND THEN
      RAISE EXCEPTION 'NRIC already registered for this slot' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Check phone duplicate per slot
  IF p_phone IS NOT NULL THEN
    PERFORM 1 FROM registrations WHERE slot_id = v_link.slot_id AND invitee_phone = p_phone;
    IF FOUND THEN
      RAISE EXCEPTION 'Phone already registered for this slot' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- Insert registration
  INSERT INTO registrations (
    agent_link_id, agent_id, slot_id, capacity_type, status,
    invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation,
    registered_at
  ) VALUES (
    v_link.id, v_link.agent_id, v_link.slot_id, v_capacity_type, 'registered',
    p_name, p_nric, p_phone, p_email, p_occupation,
    now()
  ) RETURNING id INTO v_registration_id;

  RETURN v_registration_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant anon access to RPC
GRANT EXECUTE ON FUNCTION register_attendee TO anon;

-- 12b. Atomic OTP verification + checkout (prevents double-checkout race condition)
CREATE OR REPLACE FUNCTION checkout_with_otp(
  p_registration_id uuid,
  p_otp_code text
) RETURNS boolean AS $$
DECLARE
  v_otp_id uuid;
BEGIN
  -- Find and lock valid OTP (FOR UPDATE prevents concurrent use)
  SELECT id INTO v_otp_id
  FROM otp_codes
  WHERE registration_id = p_registration_id
    AND code = p_otp_code
    AND is_used = false
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired OTP' USING ERRCODE = 'P0010';
  END IF;

  -- Atomic: mark OTP used + update attendance + update registration
  UPDATE otp_codes SET is_used = true WHERE id = v_otp_id;

  UPDATE attendance
  SET checkout_time = now(), is_full_attendance = true
  WHERE registration_id = p_registration_id AND checkout_time IS NULL;

  UPDATE registrations
  SET status = 'completed', updated_at = now()
  WHERE id = p_registration_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION checkout_with_otp TO anon;
```

- [ ] **Step 10: Rewrite deactivate_partner_and_release RPC**

```sql
-- 13. Rewrite partner deactivation to deactivate links instead of releasing invitations
-- Keep parameter name 'partner_uuid' to match existing Edge Function call
CREATE OR REPLACE FUNCTION deactivate_partner_and_release(partner_uuid uuid)
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  -- Deactivate all partner's links (replaces old invitation release logic)
  UPDATE agent_links
  SET is_active = false, updated_at = now()
  WHERE partner_id = partner_uuid AND is_active = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Update partner status
  UPDATE partners
  SET status = 'inactive', updated_at = now()
  WHERE id = partner_uuid;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 11: Run migration locally**

Run: `npx supabase db reset`
Expected: Database resets and all migrations apply cleanly. Check for any FK or enum errors.

- [ ] **Step 12: Commit migration**

```bash
git add supabase/migrations/20260313000001_shareable_links_redesign.sql
git commit -m "feat: add shareable links redesign database migration

Creates agent_links, otp_codes tables. Renames invitations → registrations.
Drops pin_codes, whatsapp_send_log. Adds register_attendee RPC.
Rewrites deactivate_partner_and_release for link-based model."
```

---

## Chunk 2: Shared Types & WhatsApp Service

### Task 2: Update shared types

**Files:**
- Modify: `packages/shared-types/src/enums.ts`
- Modify: `packages/shared-types/src/database.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Update enums.ts — add RegistrationStatus, keep old for backwards compat during transition**

Add to `packages/shared-types/src/enums.ts`:

```typescript
export enum RegistrationStatus {
  REGISTERED = 'registered',
  ATTENDED = 'attended',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}
```

Remove `PENDING` from `InvitationStatus` and rename the enum:
- Replace `InvitationStatus` with `RegistrationStatus`
- Keep `InvitationType` but add `RegistrationType` as alias

- [ ] **Step 2: Update database.ts — add new interfaces**

Replace `Invitation` with `Registration` interface, add `AgentLink` and `OtpCode`:

```typescript
export interface AgentLink {
  id: string;
  agent_id: string;
  slot_id: string;
  partner_id: string | null;
  link_code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Registration {
  id: string;
  agent_link_id: string | null;
  agent_id: string;
  slot_id: string;
  capacity_type: CapacityType;
  status: RegistrationStatus;
  invitee_name: string;
  invitee_nric: string;
  invitee_phone: string;
  invitee_email: string | null;
  invitee_occupation: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OtpCode {
  id: string;
  registration_id: string;
  slot_id: string;
  phone: string;
  code: string;
  expires_at: string;
  is_used: boolean;
  created_at: string;
}
```

Update `Attendance` interface:
- Replace `invitation_id` with `registration_id`
- Remove `pin_code_id`

Update extended types:
- `RegistrationWithRelations` replaces `InvitationWithRelations`
- `AgentLinkWithRegistrations` for link + count

- [ ] **Step 3: Update index.ts re-exports**

Ensure all new types and enums are exported from `packages/shared-types/src/index.ts`.

- [ ] **Step 4: Run typecheck**

Run: `pnpm -r typecheck`
Expected: Type errors in consumer apps (expected — they still reference old types). Shared-types package itself should compile clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/
git commit -m "feat(shared-types): add Registration, AgentLink, OtpCode types

Replace Invitation with Registration. Add RegistrationStatus enum.
Update Attendance to use registration_id. Remove PinCode type."
```

### Task 3: Create WhatsApp service (shared utility)

**Files:**
- Create: `supabase/functions/_shared/whatsapp-service.ts`
- Create: `supabase/functions/_shared/phone-utils.ts`

- [ ] **Step 1: Create phone-utils.ts**

```typescript
// supabase/functions/_shared/phone-utils.ts

/**
 * Normalize phone number for OneWaySMS API.
 * Strips +, -, spaces. API requires digits only (e.g., 6591234567).
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[+\-\s]/g, '');
}

/**
 * Mask phone number for display (e.g., "+65 •••• 1234").
 */
export function maskPhone(phone: string): string {
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length < 4) return '••••';
  const countryCode = cleaned.length > 8 ? cleaned.slice(0, cleaned.length - 8) : '';
  const lastFour = cleaned.slice(-4);
  return countryCode ? `+${countryCode} •••• ${lastFour}` : `•••• ${lastFour}`;
}
```

- [ ] **Step 2: Create whatsapp-service.ts**

```typescript
// supabase/functions/_shared/whatsapp-service.ts
import { normalizePhone } from './phone-utils.ts';

export interface SendResult {
  success: boolean;
  mt_id?: string;
  error_code?: number;
  error_message?: string;
}

interface WhatsAppService {
  sendOtp(phone: string, code: string): Promise<SendResult>;
}

class MockWhatsAppService implements WhatsAppService {
  async sendOtp(phone: string, code: string): Promise<SendResult> {
    console.log(`[MOCK WhatsApp] OTP ${code} → ${phone}`);
    return { success: true, mt_id: 'mock-' + Date.now() };
  }
}

class OneWaySmsService implements WhatsAppService {
  private apiUsername: string;
  private apiPassword: string;
  private templateId: string;

  constructor() {
    this.apiUsername = Deno.env.get('ONEWAYSMS_API_USERNAME') || '';
    this.apiPassword = Deno.env.get('ONEWAYSMS_API_PASSWORD') || '';
    this.templateId = Deno.env.get('ONEWAYSMS_TEMPLATE_ID') || '2374';
  }

  async sendOtp(phone: string, code: string): Promise<SendResult> {
    const normalized = normalizePhone(phone);
    const message = `*T${this.templateId}|${code}`;

    const url = new URL('https://wba-api.onewaysms.com/api.aspx');
    url.searchParams.set('apiusername', this.apiUsername);
    url.searchParams.set('apipassword', this.apiPassword);
    url.searchParams.set('mobile', normalized);
    url.searchParams.set('message', message);

    const response = await fetch(url.toString());

    if (response.status !== 200) {
      return {
        success: false,
        error_code: response.status,
        error_message: `HTTP ${response.status}`,
      };
    }

    const body = await response.text();
    const resultCode = parseInt(body.trim(), 10);

    if (resultCode > 0) {
      return { success: true, mt_id: body.trim() };
    }

    const errorMessages: Record<number, string> = {
      [-1]: 'Invalid API credentials',
      [-2]: 'Empty mobile number',
      [-3]: 'Empty message',
      [-4]: 'Invalid flow (24h window expired)',
      [-5]: 'Invalid template',
      [-6]: 'Template parameter mismatch',
      [-7]: 'IP not whitelisted',
    };

    return {
      success: false,
      error_code: resultCode,
      error_message: errorMessages[resultCode] || `Unknown error: ${resultCode}`,
    };
  }
}

export function createWhatsAppService(): WhatsAppService {
  const provider = Deno.env.get('WHATSAPP_PROVIDER') || 'mock';
  if (provider === 'onewaysms') {
    return new OneWaySmsService();
  }
  return new MockWhatsAppService();
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat: add WhatsApp OTP service with OneWaySMS WBA integration

Shared utilities for Edge Functions: phone normalization, masking,
and WhatsApp service with mock/OneWaySMS providers."
```

---

## Chunk 3: Edge Functions

### Task 4: Create send-checkout-otp Edge Function

**Files:**
- Create: `supabase/functions/send-checkout-otp/index.ts`

- [ ] **Step 1: Create the Edge Function**

```typescript
// supabase/functions/send-checkout-otp/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createWhatsAppService } from '../_shared/whatsapp-service.ts';
import { maskPhone } from '../_shared/phone-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { slot_id, identifier } = await req.json();
    if (!slot_id || !identifier) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'slot_id and identifier are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Look up registration by NRIC first, then phone
    let { data: registration } = await supabase
      .from('registrations')
      .select('id, status, invitee_phone, invitee_nric')
      .eq('slot_id', slot_id)
      .eq('invitee_nric', identifier)
      .single();

    if (!registration) {
      const result = await supabase
        .from('registrations')
        .select('id, status, invitee_phone, invitee_nric')
        .eq('slot_id', slot_id)
        .eq('invitee_phone', identifier)
        .single();
      registration = result.data;
    }

    if (!registration) {
      return new Response(
        JSON.stringify({ error: 'registration_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Validate status
    if (registration.status !== 'attended') {
      return new Response(
        JSON.stringify({ error: 'not_checked_in' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Validate attendance (not already checked out)
    const { data: attendance } = await supabase
      .from('attendance')
      .select('checkout_time')
      .eq('registration_id', registration.id)
      .single();

    if (!attendance) {
      return new Response(
        JSON.stringify({ error: 'not_checked_in' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (attendance.checkout_time) {
      return new Response(
        JSON.stringify({ error: 'already_checked_out' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const phone = registration.invitee_phone;

    // 4. Rate limit check: max 3 per phone per slot per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: hourlyCount } = await supabase
      .from('otp_codes')
      .select('*', { count: 'exact', head: true })
      .eq('phone', phone)
      .eq('slot_id', slot_id)
      .gte('created_at', oneHourAgo);

    if ((hourlyCount ?? 0) >= 3) {
      return new Response(
        JSON.stringify({ error: 'rate_limit_exceeded', message: 'Maximum 3 OTP requests per hour' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Cooldown check: 60 seconds between sends
    const { data: lastOtp } = await supabase
      .from('otp_codes')
      .select('created_at')
      .eq('phone', phone)
      .eq('slot_id', slot_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lastOtp) {
      const elapsed = (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;
      if (elapsed < 60) {
        return new Response(
          JSON.stringify({
            error: 'cooldown_active',
            retry_after: Math.ceil(60 - elapsed),
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 6. Invalidate previous OTPs
    await supabase
      .from('otp_codes')
      .update({ expires_at: new Date().toISOString() })
      .eq('registration_id', registration.id)
      .eq('is_used', false)
      .gt('expires_at', new Date().toISOString());

    // 7. Generate 6-digit OTP
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');

    // 8. Insert OTP record
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { data: otpRecord, error: insertError } = await supabase
      .from('otp_codes')
      .insert({
        registration_id: registration.id,
        slot_id,
        phone,
        code,
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (insertError || !otpRecord) {
      return new Response(
        JSON.stringify({ error: 'internal_error', message: 'Failed to create OTP' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 9-11. Send via WhatsApp
    const whatsapp = createWhatsAppService();
    const sendResult = await whatsapp.sendOtp(phone, code);

    // 12. On failure, delete OTP record (don't count against rate limit)
    if (!sendResult.success) {
      await supabase.from('otp_codes').delete().eq('id', otpRecord.id);

      return new Response(
        JSON.stringify({
          error: 'whatsapp_send_failed',
          provider_error: sendResult.error_code,
          message: sendResult.error_message,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 13. Return success
    return new Response(
      JSON.stringify({
        success: true,
        masked_phone: maskPhone(phone),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'internal_error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/send-checkout-otp/
git commit -m "feat: add send-checkout-otp Edge Function

Generates 6-digit OTP, sends via WhatsApp (OneWaySMS WBA API),
with rate limiting (3/hr) and cooldown (60s)."
```

### Task 5: Create verify-checkout-otp Edge Function

**Files:**
- Create: `supabase/functions/verify-checkout-otp/index.ts`

- [ ] **Step 1: Create the Edge Function**

```typescript
// supabase/functions/verify-checkout-otp/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { slot_id, identifier, code } = await req.json();
    if (!slot_id || !identifier || !code) {
      return new Response(
        JSON.stringify({ error: 'missing_fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Look up registration
    let { data: registration } = await supabase
      .from('registrations')
      .select('id, status')
      .eq('slot_id', slot_id)
      .eq('invitee_nric', identifier)
      .single();

    if (!registration) {
      const result = await supabase
        .from('registrations')
        .select('id, status')
        .eq('slot_id', slot_id)
        .eq('invitee_phone', identifier)
        .single();
      registration = result.data;
    }

    if (!registration) {
      return new Response(
        JSON.stringify({ error: 'registration_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Validate status
    if (registration.status !== 'attended') {
      return new Response(
        JSON.stringify({ error: 'not_checked_in' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Validate not already checked out
    const { data: attendance } = await supabase
      .from('attendance')
      .select('id, checkout_time')
      .eq('registration_id', registration.id)
      .single();

    if (!attendance) {
      return new Response(
        JSON.stringify({ error: 'not_checked_in' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (attendance.checkout_time) {
      return new Response(
        JSON.stringify({ error: 'already_checked_out' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4-6. Atomic checkout via RPC (FOR UPDATE lock prevents double-checkout)
    const { error: checkoutError } = await supabase
      .rpc('checkout_with_otp', {
        p_registration_id: registration.id,
        p_otp_code: code,
      });

    if (checkoutError) {
      // P0010 = invalid/expired OTP (from the RPC function)
      if (checkoutError.code === 'P0010') {
        return new Response(
          JSON.stringify({ error: 'invalid_otp', message: 'Invalid or expired OTP' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ error: 'checkout_failed', message: checkoutError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No need for separate updates — RPC handles everything atomically:
    // - Marks OTP as used (with FOR UPDATE lock)
    // - Updates attendance: checkout_time + is_full_attendance
    // - Updates registration status to 'completed'

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'internal_error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/verify-checkout-otp/
git commit -m "feat: add verify-checkout-otp Edge Function

Validates OTP code, marks used, updates attendance checkout_time
and registration status to completed."
```

### Task 6: Update deactivate-partner Edge Function

**Files:**
- Modify: `supabase/functions/deactivate-partner/index.ts`

- [ ] **Step 1: Update the deactivate-partner function**

The `deactivate_partner_and_release` RPC was already rewritten in the migration (Task 1, Step 10). The Edge Function calls this RPC, so it needs minimal changes. Update the response message from "released X invitations" to "deactivated X links".

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/deactivate-partner/
git commit -m "refactor: update deactivate-partner for link-based model

RPC now deactivates agent_links instead of releasing invitations."
```

### Task 6b: Update send-email-reminders Edge Function

**Files:**
- Modify: `supabase/functions/send-email-reminders/index.ts`

- [ ] **Step 1: Update queries from invitations → registrations**

Change all `.from('invitations')` calls to `.from('registrations')`. Update status references (remove 'pending' checks). The function queries registrants for upcoming slots and sends reminders — the data shape is the same, just the table name and status enum changed.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/send-email-reminders/
git commit -m "refactor: update send-email-reminders to query registrations table"
```

### Task 7: Remove send-whatsapp-pin Edge Function

**Files:**
- Delete: `supabase/functions/send-whatsapp-pin/`

- [ ] **Step 1: Delete the old function directory**

```bash
rm -rf supabase/functions/send-whatsapp-pin
```

- [ ] **Step 2: Commit**

```bash
git add -A supabase/functions/send-whatsapp-pin/
git commit -m "chore: remove send-whatsapp-pin Edge Function

Replaced by send-checkout-otp with proper OTP generation."
```

---

## Chunk 4: Public Pages App

### Task 8: Update public-pages router

**Files:**
- Modify: `apps/public-pages/src/router.tsx`

- [ ] **Step 1: Update route parameter from $token to $linkCode**

Change the register route from `/public/register/$token` to `/public/register/$linkCode`. All other routes stay the same.

- [ ] **Step 2: Commit**

```bash
git add apps/public-pages/src/router.tsx
git commit -m "refactor(public): rename register route param token → linkCode"
```

### Task 9: Rewrite Register.tsx

**Files:**
- Rewrite: `apps/public-pages/src/pages/Register.tsx`

- [ ] **Step 1: Rewrite registration page**

Key changes from current:
- Use `linkCode` param instead of `token`
- Look up `agent_links` by `link_code` (join slot + campaign for display)
- Check `is_active`, slot timing, capacity
- On submit: call `register_attendee` RPC instead of direct update
- Same form fields: name, NRIC, phone, email, occupation
- Show campaign/slot details from agent_link lookup
- Handle error codes from RPC: P0001 (inactive), P0002 (full), P0003 (NRIC dup), P0004 (phone dup)

- [ ] **Step 2: Commit**

```bash
git add apps/public-pages/src/pages/Register.tsx
git commit -m "feat(public): rewrite Register page for shareable links

Looks up agent_links by link_code, calls register_attendee RPC
for atomic registration with capacity check."
```

### Task 10: Rewrite CheckIn.tsx

**Files:**
- Rewrite: `apps/public-pages/src/pages/CheckIn.tsx`

- [ ] **Step 1: Rewrite check-in page**

Key changes from current:
- Remove PIN field entirely
- Add toggle: "Identify by NRIC" / "Identify by Phone"
- On submit:
  - Look up `registrations` by `slot_id` + NRIC or phone, status = 'registered'
  - Create attendance record: `{ registration_id, checkin_time: now() }`
  - Update registration status to 'attended'
- Keep QR verification flow (verify-qr-token)
- Success screen shows attendee name

- [ ] **Step 2: Commit**

```bash
git add apps/public-pages/src/pages/CheckIn.tsx
git commit -m "feat(public): rewrite CheckIn for QR + NRIC/Phone identification

Removes PIN requirement. Adds NRIC/Phone toggle selector.
Creates attendance record on successful identification."
```

### Task 11: Rewrite CheckOut.tsx

**Files:**
- Rewrite: `apps/public-pages/src/pages/CheckOut.tsx`

- [ ] **Step 1: Rewrite check-out page — Step 1 (Identify)**

Two-step flow. Step 1:
- QR verification (same as check-in)
- NRIC/Phone toggle input
- On submit: call `send-checkout-otp` Edge Function
- Store `masked_phone` and `identifier` in state
- Transition to Step 2

- [ ] **Step 2: Rewrite check-out page — Step 2 (OTP Verify)**

Step 2:
- Display masked phone: "OTP sent to +65 •••• 1234"
- 6-digit numeric input (auto-focus, monospace)
- 5-minute countdown timer (from send time)
- "Resend OTP" button:
  - Disabled for 60 seconds (shows countdown timer)
  - Max 3 resends (tracked in state, enforced server-side)
  - On click: calls `send-checkout-otp` again, resets countdown
- Submit: calls `verify-checkout-otp`
- Error handling:
  - `invalid_otp` → inline error, allow retry
  - `rate_limit_exceeded` → "Too many attempts" message
  - `cooldown_active` → update resend button timer with `retry_after`
  - `already_checked_out` → show success-styled "Already checked out"
- Success screen with checkout confirmation

- [ ] **Step 3: Commit**

```bash
git add apps/public-pages/src/pages/CheckOut.tsx
git commit -m "feat(public): rewrite CheckOut with WhatsApp OTP flow

Two-step: identify by NRIC/Phone → receive OTP via WhatsApp → verify.
Includes 60s cooldown, 5min expiry timer, and resend logic."
```

---

## Chunk 5: Agent Portal

### Task 12: Create agent link hooks

**Files:**
- Create: `apps/agent-portal/src/hooks/useAgentLinks.ts`
- Create: `apps/agent-portal/src/hooks/useRegistrations.ts`

- [ ] **Step 1: Create useAgentLinks hook**

```typescript
// Key hooks:
// useMyLinks(agentId) — query agent_links for this agent, join slots + campaigns
// useCreateLink(agentId, slotId) — upsert agent_link (lazy creation)
// usePartnerLinks(partnerId) — partner's links under their agent
// useLinkRegistrationCount(linkId) — count registrations for a link
```

- [ ] **Step 2: Create useRegistrations hook**

```typescript
// Key hooks:
// useRegistrationsBySlot(agentId, slotId) — registrations for agent's slot
// useRegistrationStats(agentId) — aggregate stats (registered, attended, completed)
// usePartnerRegistrationStats(partnerId) — partner-scoped stats
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/hooks/useAgentLinks.ts apps/agent-portal/src/hooks/useRegistrations.ts
git commit -m "feat(agent): add useAgentLinks and useRegistrations hooks

Agent link CRUD + registration queries for dashboard and link pages."
```

### Task 13: Rewrite agent portal pages

**Files:**
- Create: `apps/agent-portal/src/pages/MyLinks.tsx` (replaces Invitations.tsx)
- Create: `apps/agent-portal/src/pages/PartnerLinks.tsx` (replaces AvailableInvitations.tsx)
- Modify: `apps/agent-portal/src/pages/Dashboard.tsx`
- Modify: `apps/agent-portal/src/router.tsx`
- Modify: `apps/agent-portal/src/components/Layout.tsx`
- Delete: `apps/agent-portal/src/pages/Invitations.tsx`
- Delete: `apps/agent-portal/src/pages/AvailableInvitations.tsx`
- Delete: `apps/agent-portal/src/pages/MyClaimedInvitations.tsx`
- Delete: `apps/agent-portal/src/hooks/useInvitations.ts`
- Delete: `apps/agent-portal/src/hooks/usePartnerInvitations.ts`

- [ ] **Step 1: Create MyLinks.tsx**

Agent view:
- List campaigns with available slots
- Per slot: "Get My Link" button → lazy-creates agent_link, shows URL + copy button
- Registration count: "5/10 registered" (live count vs tier limit)
- Table of registrants per slot (name, phone, status)
- Copy link button with toast confirmation

- [ ] **Step 2: Create PartnerLinks.tsx**

Partner view (replaces AvailableInvitations + MyClaimedInvitations):
- Same layout as MyLinks but scoped to partner's agent's campaigns
- "Get My Link" creates partner-scoped agent_link
- Shows partner's registration count vs shared pool limit

- [ ] **Step 3: Update Dashboard.tsx**

Replace invitation stats with registration stats:
- "Registrations" instead of "Pending Invitations"
- Stats: Registered, Attended, Completed
- Partner role: show registrations via partner's links

- [ ] **Step 4: Update router.tsx and Layout.tsx**

Routes:
- `/invitations` → `/my-links` (MyLinks)
- `/available-invitations` → `/partner-links` (PartnerLinks)
- Remove `/my-invitations` route

Nav labels:
- "Invitations" → "My Links"
- "Available Invitations" → "My Links" (partner context)
- "My Claimed Invitations" → removed

- [ ] **Step 5: Delete old files**

```bash
rm apps/agent-portal/src/pages/Invitations.tsx
rm apps/agent-portal/src/pages/AvailableInvitations.tsx
rm apps/agent-portal/src/pages/MyClaimedInvitations.tsx
rm apps/agent-portal/src/hooks/useInvitations.ts
rm apps/agent-portal/src/hooks/usePartnerInvitations.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A apps/agent-portal/
git commit -m "feat(agent): replace invitations with shareable links UI

New MyLinks and PartnerLinks pages. Dashboard shows registration stats.
Removes invitation-based pages and hooks."
```

---

## Chunk 6: Admin Portal

### Task 14: Update admin portal

**Files:**
- Create: `apps/admin-portal/src/hooks/useRegistrations.ts`
- Modify: `apps/admin-portal/src/hooks/useCampaigns.ts`
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx`
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignList.tsx`
- Modify: `apps/admin-portal/src/pages/Dashboard.tsx`
- Modify: `apps/admin-portal/src/router.tsx`

- [ ] **Step 1: Create useRegistrations hook for admin**

```typescript
// Key hooks:
// useRegistrationsBySlot(slotId) — all registrations for a slot (admin view)
// useRegistrationsByAgent(agentId) — registrations attributed to an agent
// useRegistrationStats() — global stats for admin dashboard
```

- [ ] **Step 2: Update useCampaigns.ts**

- Remove `duplicateCampaign` references to invitation counts if any
- Update queries that join invitations → join registrations
- Remove any PIN-related queries

- [ ] **Step 3: Update CampaignDetail.tsx**

- Replace "Invitations" section with "Registrations" per slot
- Show registrations table: name, NRIC, phone, status, agent/partner attribution
- Remove PIN code management section
- Registration count per slot: "5/10 registered"

- [ ] **Step 4: Update CampaignList.tsx**

- Update any invitation count displays → registration counts
- Remove PIN-related menu items or actions

- [ ] **Step 5: Update Dashboard.tsx**

- Replace invitation stats with registration stats
- Update attendance queries to use registration_id

- [ ] **Step 6: Remove PIN codes route and page**

- Remove `/pin-codes` route from router.tsx
- Delete PIN codes page if it exists

- [ ] **Step 7: Commit**

```bash
git add -A apps/admin-portal/
git commit -m "feat(admin): update portal for registration-based model

Registration hooks and views replace invitation counts.
Removes PIN code management. Updates dashboard stats."
```

---

## Chunk 7: Cleanup & Deployment

### Task 15: Final typecheck and lint

**Files:** All

- [ ] **Step 1: Run typecheck across all packages**

Run: `pnpm -r typecheck`
Expected: All packages compile cleanly. Fix any remaining type errors from the migration.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: Clean or only pre-existing warnings.

- [ ] **Step 3: Build all apps**

Run: `pnpm build`
Expected: All three portals build successfully.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type errors and lint issues from redesign"
```

### Task 16: Update seed data

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Update seed data for new schema**

- Remove seed data for `pin_codes`
- Add seed data for `agent_links` (test agent's link for test slot)
- Update any invitation seed data → registration format
- Add test `otp_codes` entry if useful for development

- [ ] **Step 2: Verify seed data**

Run: `npx supabase db reset`
Expected: Migration + seed data apply cleanly.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql
git commit -m "chore: update seed data for shareable links schema"
```

### Task 17: Deploy to production

- [ ] **Step 1: Push to main branch**

```bash
git push origin main
```

This triggers auto-deploy of all three frontends on Render.

- [ ] **Step 2: Run database migration on production Supabase**

Apply `20260313000001_shareable_links_redesign.sql` to production via Supabase dashboard or CLI:

```bash
npx supabase db push --linked
```

- [ ] **Step 3: Deploy Edge Functions to production**

```bash
npx supabase functions deploy send-checkout-otp --project-ref wictbtiulqmzzneyoelv
npx supabase functions deploy verify-checkout-otp --project-ref wictbtiulqmzzneyoelv
npx supabase functions delete send-whatsapp-pin --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 4: Set Edge Function secrets**

```bash
npx supabase secrets set ONEWAYSMS_API_USERNAME=<value> --project-ref wictbtiulqmzzneyoelv
npx supabase secrets set ONEWAYSMS_API_PASSWORD=<value> --project-ref wictbtiulqmzzneyoelv
npx supabase secrets set ONEWAYSMS_TEMPLATE_ID=2374 --project-ref wictbtiulqmzzneyoelv
npx supabase secrets set WHATSAPP_PROVIDER=onewaysms --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 5: Verify with test accounts**

1. Log in as admin@test.com → verify dashboard loads, no errors
2. Log in as agent@test.com → verify My Links page loads
3. Create a test link → copy URL → open in incognito
4. Register via link → verify registration appears
5. (At event) Scan QR → check in with NRIC → verify attended
6. (At event) Scan QR → enter NRIC → receive OTP → verify checkout

- [ ] **Step 6: Commit deployment confirmation**

```bash
git commit --allow-empty -m "deploy: shareable links + WhatsApp OTP live on production"
```
