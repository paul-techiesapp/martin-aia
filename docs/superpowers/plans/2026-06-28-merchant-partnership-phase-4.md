# Merchant Partnership — Phase 4: Auto Expiry Reminders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the net-new scheduling subsystem (spec §7): enable `pg_cron` + `pg_net`, add a daily `enqueue_expiry_reminders()` RPC that fires one `net.http_post` per vehicle whose insurance expires in ~30 days, and a new `send-expiry-reminders` edge function that emails (Resend) + SMSes (OneWaySMS) the customer, notifies the tied agent, and stamps `reminder_sent_at` for once-only delivery.

**Architecture:** One additive SQL migration enables the two extensions, defines a `SECURITY DEFINER` enqueue function that reads the per-environment Supabase functions base URL + service-role key from **Supabase Vault** (so the committed SQL is identical across local/staging/prod and only the Vault secrets differ), and registers a daily `cron.schedule(...)` job. The `_shared/whatsapp-service.ts` helper gains a `sendExpiryReminder()` method mirroring the existing `sendOtp()` OneWaySMS template call. The edge function loads the vehicle → enquiry/customer → insurance product → branch → merchant → tied agent, formats dates in `Asia/Singapore`, sends the three notifications, and stamps `reminder_sent_at`. Missing secrets (e.g. staging) make each channel a logged no-op — the function still deploys and stamps so the cron never re-fires.

**Tech Stack:** Supabase (Postgres 15 + `pg_cron` + `pg_net` + Vault), Deno edge functions, Resend (email), OneWaySMS (SMS/WhatsApp). No frontend in this phase.

## Global Constraints

- **No test framework** in this repo. There is no frontend change in Phase 4, so there is nothing to `pnpm build`. Verify the **edge function** with `deno check` (skip if Deno is unavailable locally — it is validated on deploy). **Never add vitest/jest/any test runner.**
- **DB verification uses migration-up, NOT reset.** Run `npx supabase start` once, then apply with `npx supabase migration up` (NOT `npx supabase db reset`). Run SQL assertions through the running container because **local `psql` is NOT installed**:
  `docker exec supabase_db_DATA psql -U postgres -d postgres -tAc "<SQL>"`.
- **Migration filenames:** `supabase/migrations/YYYYMMDDNNNNNN_name.sql`, strictly increasing after the latest existing (`20260627000003`). This phase uses the Phase-4 band `20260628000020`. Production is applied later via MCP `apply_migration` (NOT `db push`), per repo convention, with `pg_cron`/`pg_net` enabled at that point.
- **Reuse existing DB helpers — do NOT redefine:** `update_updated_at()`, `is_admin()` (reads `app_metadata.role`), `get_agent_id()`. (Phase 4 adds no RLS — the new function is `SECURITY DEFINER` and is invoked only by `pg_cron`/`pg_net` with the service role.)
- **Extension schemas are fixed by the extensions themselves:** `pg_cron` is `relocatable=false` and always owns the `cron` schema; `pg_net` exposes its API in the `net` schema. Call sites are therefore always `cron.schedule(...)` and `net.http_post(...)` regardless of the `WITH SCHEMA` target. On Supabase-hosted projects both are usually pre-enabled (Dashboard → Database → Extensions), so the `CREATE EXTENSION IF NOT EXISTS` lines are idempotent no-ops there.
- **Env-specific values live in Vault, not in the migration.** The committed migration never contains a project URL or service-role key. Each environment gets its own `vault.create_secret('<url>', 'project_url')` + `vault.create_secret('<service_role_key>', 'service_role_key')` run once at apply time (clearly marked below). **Never commit a service-role key.**
- **Edge function secrets** (`RESEND_API_KEY`, `ONEWAYSMS_*`, `WHATSAPP_PROVIDER`, and the new `ONEWAYSMS_EXPIRY_TEMPLATE_ID`) may be **unset in staging** — the function deploys and no-ops each missing channel; it still stamps `reminder_sent_at`.
- **Timezone:** Edge Functions run in UTC. All customer-facing date formatting must pass `timeZone: 'Asia/Singapore'` (the `en-SG` locale sets style, NOT timezone), matching `send-email-reminders/index.ts`.
- **Idempotency / once-only:** the `enquiry_vehicles.reminder_sent_at` flag (stamped by the edge function) plus the exact-day match (`insurance_expiry_date = CURRENT_DATE + 30`) and the daily cadence guarantee a single reminder per vehicle. A 2-car customer can receive two reminders on different dates by design.
- **Supabase client (edge):** `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` — service role, mirroring `send-checkout-otp/index.ts`. No admin-JWT check; instead the function rejects callers whose bearer token ≠ the service-role key (machine-to-machine only).
- **Git:** work on branch `feat/merchant-partnership`; one commit per task; never commit to `main`.

---

## File Structure

**Created:**
- `supabase/migrations/20260628000020_expiry_reminders.sql` — enable `pg_cron`/`pg_net`, `enqueue_expiry_reminders()` RPC, daily `cron.schedule`
- `supabase/functions/send-expiry-reminders/index.ts` — service-role edge function: Resend email + OneWaySMS to customer, agent email notify, stamp `reminder_sent_at`

**Modified:**
- `supabase/functions/_shared/whatsapp-service.ts` — add `sendExpiryReminder(phone, params[])` to the interface, `MockWhatsAppService`, and `OneWaySmsService`
- `supabase/config.toml` — add `[functions.send-expiry-reminders] verify_jwt = false`

---

## Task 1: Migration — enable pg_cron/pg_net, enqueue RPC, daily cron

**Files:**
- Create: `supabase/migrations/20260628000020_expiry_reminders.sql`

**Interfaces:**
- Consumes: existing table `enquiry_vehicles(id, insurance_expiry_date, reminder_sent_at, status)` (Phase 1); extensions `pg_cron` (`cron.schedule`), `pg_net` (`net.http_post`); Supabase `vault.decrypted_secrets`.
- Produces: function `public.enqueue_expiry_reminders() RETURNS integer`; cron job `expiry-reminders-daily`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260628000020_expiry_reminders.sql`:

```sql
-- ============================================================
-- Merchant Partnership — Phase 4: auto expiry reminders
-- (pg_cron + pg_net + enqueue RPC + daily schedule)
-- ============================================================

-- 1) Extensions ---------------------------------------------
-- pg_net exposes its HTTP API in the `net` schema; on Supabase it is
-- conventionally installed into the `extensions` schema (its functions are
-- still called as net.http_post). pg_cron is relocatable=false and ALWAYS
-- owns the `cron` schema, so it is created without WITH SCHEMA. Both lines are
-- idempotent no-ops on Supabase-hosted projects where the extensions are
-- already enabled via Dashboard → Database → Extensions.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2) Enqueue function ---------------------------------------
-- Reads the per-environment Supabase functions base URL + service-role key
-- from Vault (see Step 2 for the one-time, per-env secret inserts), selects
-- every vehicle whose insurance expires in exactly 30 days that has not been
-- reminded and is still open (submitted/quoted), and fires one async
-- net.http_post to the send-expiry-reminders edge function per vehicle. The
-- edge function stamps reminder_sent_at on success, so this RPC stays
-- side-effect-free on the row itself. Returns the number of vehicles enqueued.
CREATE OR REPLACE FUNCTION public.enqueue_expiry_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_url    text;
  v_service_key text;
  v_vehicle     record;
  v_count       integer := 0;
BEGIN
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_base_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'enqueue_expiry_reminders: Vault secrets project_url/service_role_key not set; skipping run';
    RETURN 0;
  END IF;

  FOR v_vehicle IN
    SELECT ev.id
      FROM public.enquiry_vehicles ev
     WHERE ev.insurance_expiry_date = (CURRENT_DATE + INTERVAL '30 days')::date
       AND ev.reminder_sent_at IS NULL
       AND ev.status IN ('submitted', 'quoted')
  LOOP
    PERFORM net.http_post(
      url     := v_base_url || '/functions/v1/send-expiry-reminders',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_service_key
                 ),
      body    := jsonb_build_object('vehicle_id', v_vehicle.id),
      timeout_milliseconds := 8000
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Lock the function down: it is invoked only by the cron job (which runs as the
-- table owner / postgres). No client role may call it.
REVOKE ALL ON FUNCTION public.enqueue_expiry_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_expiry_reminders() FROM anon, authenticated;

-- 3) Daily schedule -----------------------------------------
-- 01:00 UTC = 09:00 Asia/Singapore, every day. cron.schedule upserts by job
-- name, so re-applying this migration replaces the job rather than duplicating.
SELECT cron.schedule(
  'expiry-reminders-daily',
  '0 1 * * *',
  $cron$ SELECT public.enqueue_expiry_reminders(); $cron$
);
```

- [ ] **Step 2: (Per-environment, one-time, NOT committed) register the Vault secrets**

These two statements are the **only** env-specific values. Run them once per environment — locally via the assertion shell, on prod/staging via MCP `execute_sql` or the SQL editor. **Do not commit the service-role key.**

- **Local** (DB container reaches the local Edge Runtime through the Kong gateway at `http://kong:8000`; the anon/service keys are the fixed local-dev keys printed by `npx supabase status`):
  ```sql
  SELECT vault.create_secret('http://kong:8000', 'project_url');
  SELECT vault.create_secret('<LOCAL_SERVICE_ROLE_KEY from `npx supabase status`>', 'service_role_key');
  ```
- **Production** (BOP Website project `mjtdsevynrtcmafsnxsj`):
  ```sql
  SELECT vault.create_secret('https://mjtdsevynrtcmafsnxsj.supabase.co', 'project_url');
  SELECT vault.create_secret('<PROD_SERVICE_ROLE_KEY>', 'service_role_key');
  ```
  > **FILL-AT-APPLY-TIME:** `project_url` = the project's functions origin (`https://<project-ref>.supabase.co`), `service_role_key` = that project's service-role key. To rotate later: `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='project_url'), '<new-url>');` (same for `service_role_key`).

- [ ] **Step 3: Apply the migration to the running local stack**

Run (requires `npx supabase start` first):
```bash
npx supabase migration up
```
Expected: completes without error; output lists `20260628000020_expiry_reminders.sql` as applied.

> If `CREATE EXTENSION pg_cron` errors with *"pg_cron can only be loaded via shared_preload_libraries"*, the local Postgres build was started without pg_cron preloaded. The Supabase postgres image ships pg_cron in `shared_preload_libraries` by default; if a custom local build does not, either add it in `supabase/config.toml`’s db settings and `npx supabase stop && start`, or apply this migration only to staging/prod (where the extension is enabled). This does not affect the function or edge-function code below.

- [ ] **Step 4: Assert extensions, function, and cron job exist**

Run:
```bash
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net') ORDER BY extname;"
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT proname FROM pg_proc WHERE proname='enqueue_expiry_reminders';"
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT jobname, schedule FROM cron.job WHERE jobname='expiry-reminders-daily';"
```
Expected: `pg_cron` and `pg_net` listed; `enqueue_expiry_reminders` listed; `expiry-reminders-daily|0 1 * * *`.

- [ ] **Step 5: Smoke-test the function runs cleanly**

Run:
```bash
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT public.enqueue_expiry_reminders();"
```
Expected: returns `0` on a fresh DB (no eligible vehicles, and the Vault-secrets guard logs a WARNING and returns 0 if Step 2 was skipped) — proving the function compiles and executes without raising.

- [ ] **Step 6: (Optional) verify the eligibility query with a fixture**

If a full enquiry fixture exists (or you insert one), confirm the WHERE clause matches a vehicle expiring in 30 days:
```bash
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT count(*) FROM enquiry_vehicles WHERE insurance_expiry_date = (CURRENT_DATE + INTERVAL '30 days')::date AND reminder_sent_at IS NULL AND status IN ('submitted','quoted');"
```
Expected: the count of seeded due-in-30-days vehicles (0 if none seeded).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260628000020_expiry_reminders.sql
git commit -m "feat(partnership): pg_cron/pg_net + enqueue_expiry_reminders RPC and daily schedule"
```

---

## Task 2: Shared service — add `sendExpiryReminder` to whatsapp-service

**Files:**
- Modify: `supabase/functions/_shared/whatsapp-service.ts`

**Interfaces:**
- Consumes: `normalizePhone` from `./phone-utils.ts`; env `ONEWAYSMS_API_USERNAME`, `ONEWAYSMS_API_PASSWORD`, `WHATSAPP_PROVIDER`, and the new `ONEWAYSMS_EXPIRY_TEMPLATE_ID`.
- Produces: `WhatsAppService.sendExpiryReminder(phone: string, params: string[]): Promise<SendResult>`, implemented in `MockWhatsAppService` and `OneWaySmsService`.

- [ ] **Step 1: Replace the file with the extended version**

Overwrite `supabase/functions/_shared/whatsapp-service.ts` with the following. It keeps the existing `sendOtp` behavior verbatim and adds `sendExpiryReminder`, factoring the shared OneWaySMS HTTP dispatch + result parsing into a private `dispatch()` helper so both methods stay consistent.

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
  // Expiry reminder uses a separate pre-registered OneWaySMS template whose
  // ordered params are: [customerName, carPlate, expiryDate, merchantName].
  sendExpiryReminder(phone: string, params: string[]): Promise<SendResult>;
}

class MockWhatsAppService implements WhatsAppService {
  async sendOtp(phone: string, code: string): Promise<SendResult> {
    console.log(`[MOCK WhatsApp] OTP ${code} → ${phone}`);
    return { success: true, mt_id: 'mock-' + Date.now() };
  }

  async sendExpiryReminder(phone: string, params: string[]): Promise<SendResult> {
    console.log(`[MOCK WhatsApp] expiry reminder → ${phone}: ${params.join(' | ')}`);
    return { success: true, mt_id: 'mock-' + Date.now() };
  }
}

class OneWaySmsService implements WhatsAppService {
  private apiUsername: string;
  private apiPassword: string;
  private templateId: string;
  private expiryTemplateId: string;

  constructor() {
    this.apiUsername = Deno.env.get('ONEWAYSMS_API_USERNAME') || '';
    this.apiPassword = Deno.env.get('ONEWAYSMS_API_PASSWORD') || '';
    this.templateId = Deno.env.get('ONEWAYSMS_TEMPLATE_ID') || '2502';
    this.expiryTemplateId = Deno.env.get('ONEWAYSMS_EXPIRY_TEMPLATE_ID') || '';
  }

  private async dispatch(phone: string, message: string): Promise<SendResult> {
    const normalized = normalizePhone(phone);

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

  async sendOtp(phone: string, code: string): Promise<SendResult> {
    const message = `*T${this.templateId}|${code}`;
    return this.dispatch(phone, message);
  }

  async sendExpiryReminder(phone: string, params: string[]): Promise<SendResult> {
    if (!this.expiryTemplateId) {
      return {
        success: false,
        error_code: -5,
        error_message: 'Expiry SMS template not configured (ONEWAYSMS_EXPIRY_TEMPLATE_ID unset)',
      };
    }
    const message = `*T${this.expiryTemplateId}|${params.join('|')}`;
    return this.dispatch(phone, message);
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

- [ ] **Step 2: Type-check (best-effort)**

Run: `deno check supabase/functions/send-checkout-otp/index.ts`
Expected: passes (this imports the modified shared service and is unaffected by the additive change). If Deno is not installed locally, skip — the file is validated on deploy. **Do not** add a Node test runner.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/whatsapp-service.ts
git commit -m "feat(partnership): add sendExpiryReminder OneWaySMS template helper"
```

---

## Task 3: Edge function — send-expiry-reminders

**Files:**
- Create: `supabase/functions/send-expiry-reminders/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: request body `{ vehicle_id: string }` or `{ vehicle_ids: string[] }`; tables `enquiry_vehicles`, `enquiries`, `insurance_products`, `merchant_branches`, `merchants`, `agents`; `createWhatsAppService()` (Task 2); env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `WHATSAPP_PROVIDER`, `ONEWAYSMS_*`, `ONEWAYSMS_EXPIRY_TEMPLATE_ID`.
- Produces: per-vehicle Resend email (customer) + OneWaySMS (customer) + Resend email (tied agent); stamps `enquiry_vehicles.reminder_sent_at`; returns `{ processed, emailed, smsed, agent_notified, skipped }`.

- [ ] **Step 1: Create the edge function**

Create `supabase/functions/send-expiry-reminders/index.ts`:

```typescript
// supabase/functions/send-expiry-reminders/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createWhatsAppService } from '../_shared/whatsapp-service.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Edge Functions run in UTC. insurance_expiry_date is a DATE; anchor it to
// Asia/Singapore midnight so the formatted calendar day never drifts. en-SG
// sets the locale (style), NOT the timezone.
const EVENT_TIME_ZONE = 'Asia/Singapore';

function formatExpiryDate(dateOnly: string): string {
  const date = new Date(`${dateOnly}T00:00:00+08:00`);
  return date.toLocaleDateString('en-SG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: EVENT_TIME_ZONE,
  });
}

function buildCustomerEmailHtml(
  customerName: string,
  merchantName: string,
  branchName: string,
  carPlate: string,
  expiryDateText: string,
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #334155;">
  <div style="background: #f8fafc; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
    <h2 style="margin: 0 0 24px 0; color: #0f172a;">Your car insurance is expiring soon</h2>
    <p style="margin: 0 0 16px 0;">Hi ${customerName},</p>
    <p style="margin: 0 0 20px 0;">This is a friendly reminder that your vehicle's insurance is due for renewal in about a month:</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 20px 0;">
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Vehicle</td><td style="color: #334155;">${carPlate}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Expires</td><td style="color: #334155;">${expiryDateText}</td></tr>
      </table>
    </div>
    <p style="margin: 0 0 12px 0;">Renew through <strong>${merchantName} (${branchName})</strong> with RACC and you'll qualify for a gold gift on confirmed renewal.</p>
    <p style="margin: 0;">Reply to this email or contact your RACC agent to get your quotation.</p>
  </div>
</body>
</html>`;
}

function buildAgentEmailHtml(
  agentName: string,
  customerName: string,
  customerPhone: string,
  carPlate: string,
  expiryDateText: string,
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #334155;">
  <div style="background: #f8fafc; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
    <h2 style="margin: 0 0 24px 0; color: #0f172a;">Renewal follow-up reminder</h2>
    <p style="margin: 0 0 16px 0;">Hi ${agentName},</p>
    <p style="margin: 0 0 20px 0;">One of your referred customers has a car insurance renewal coming up in ~30 days. Reach out to help them renew with RACC:</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 20px 0;">
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Customer</td><td style="color: #334155;">${customerName}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Phone</td><td style="color: #334155;">${customerPhone}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Vehicle</td><td style="color: #334155;">${carPlate}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Expires</td><td style="color: #334155;">${expiryDateText}</td></tr>
      </table>
    </div>
  </div>
</body>
</html>`;
}

async function sendResendEmail(
  resendApiKey: string,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'RACC Partnership <reminders@raccagency.com>',
        to,
        subject,
        html,
      }),
    });
    if (!response.ok) {
      console.error(`Resend error (${to}): ${await response.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Resend fetch error (${to}):`, err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Machine-to-machine only: this function is invoked by pg_net with the
    // service-role key. Reject anything whose bearer token is not that key.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!serviceKey || token !== serviceKey) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);

    const payload = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(payload.vehicle_ids)
      ? payload.vehicle_ids
      : payload.vehicle_id
        ? [payload.vehicle_id]
        : [];

    if (ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'vehicle_id or vehicle_ids is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY'); // may be unset in staging
    const whatsapp = createWhatsAppService();

    let processed = 0;
    let emailed = 0;
    let smsed = 0;
    let agentNotified = 0;
    let skipped = 0;

    for (const vehicleId of ids) {
      const { data: vehicle, error: vErr } = await supabase
        .from('enquiry_vehicles')
        .select(`
          id,
          car_plate,
          insurance_expiry_date,
          status,
          reminder_sent_at,
          insurance_product:insurance_products(name),
          enquiry:enquiries(
            customer_name,
            customer_email,
            customer_phone,
            agent:agents(name, email)
          ),
          branch:merchant_branches(
            name,
            merchant:merchants(name)
          )
        `)
        .eq('id', vehicleId)
        .single();

      if (vErr || !vehicle) {
        console.error(`Vehicle ${vehicleId} not found:`, vErr);
        skipped++;
        continue;
      }

      // Idempotency double-check: never re-send a stamped vehicle.
      if (vehicle.reminder_sent_at) {
        skipped++;
        continue;
      }

      const enquiry = (vehicle as any).enquiry;
      const branch = (vehicle as any).branch;
      const merchant = branch?.merchant;
      const agent = enquiry?.agent;

      const customerName = enquiry?.customer_name ?? 'Customer';
      const customerEmail = enquiry?.customer_email as string | null;
      const customerPhone = enquiry?.customer_phone as string | null;
      const merchantName = merchant?.name ?? 'our partner';
      const branchName = branch?.name ?? '';
      const carPlate = vehicle.car_plate;
      const expiryDateText = formatExpiryDate(vehicle.insurance_expiry_date);

      // 1) Customer email (no-op if Resend key unset or no email on file)
      if (resendApiKey && customerEmail) {
        const ok = await sendResendEmail(
          resendApiKey,
          customerEmail,
          `Your car insurance (${carPlate}) expires soon`,
          buildCustomerEmailHtml(customerName, merchantName, branchName, carPlate, expiryDateText),
        );
        if (ok) emailed++;
      }

      // 2) Customer SMS / WhatsApp (no-op if provider=mock or template unset)
      if (customerPhone) {
        const smsResult = await whatsapp.sendExpiryReminder(customerPhone, [
          customerName,
          carPlate,
          expiryDateText,
          merchantName,
        ]);
        if (smsResult.success) {
          smsed++;
        } else {
          console.error(`SMS reminder failed (${carPlate}): ${smsResult.error_message}`);
        }
      }

      // 3) Notify the tied agent by email (untied enquiries have no agent)
      if (resendApiKey && agent?.email) {
        const ok = await sendResendEmail(
          resendApiKey,
          agent.email,
          `Renewal due soon: ${customerName} (${carPlate})`,
          buildAgentEmailHtml(
            agent.name ?? 'Agent',
            customerName,
            customerPhone ?? '—',
            carPlate,
            expiryDateText,
          ),
        );
        if (ok) agentNotified++;
      }

      // 4) Stamp reminder_sent_at so the daily cron never re-fires this vehicle.
      // Stamped unconditionally after the send attempt (exact-day match means a
      // single shot anyway; staging with no secrets still marks done).
      const { error: stampErr } = await supabase
        .from('enquiry_vehicles')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', vehicleId);
      if (stampErr) {
        console.error(`Failed to stamp reminder_sent_at (${vehicleId}):`, stampErr);
      }

      processed++;
    }

    return new Response(
      JSON.stringify({ processed, emailed, smsed, agent_notified: agentNotified, skipped }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('send-expiry-reminders error:', err);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
```

- [ ] **Step 2: Add the config.toml entry**

In `supabase/config.toml`, append after the existing `[functions.create-agent]` block:

```toml
# Invoked machine-to-machine by pg_cron/pg_net with the service-role key.
# Gateway JWT verification is disabled (the ES256 platform-verifier note above
# applies); the function verifies the caller's bearer == service-role key.
[functions.send-expiry-reminders]
verify_jwt = false
```

- [ ] **Step 3: Type-check (best-effort)**

Run: `deno check supabase/functions/send-expiry-reminders/index.ts`
Expected: passes. If Deno is unavailable locally, skip — it is validated on deploy.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-expiry-reminders/index.ts supabase/config.toml
git commit -m "feat(partnership): send-expiry-reminders edge function (email + SMS + agent notify)"
```

---

## Task 4: Deploy, secrets, and end-to-end verification

**Files:** none (deploy + ops only).

**Interfaces:**
- Consumes: the migration (Task 1), the edge function (Task 3), the Vault secrets (Task 1 Step 2).
- Produces: a deployed `send-expiry-reminders` function and a wired-up daily reminder pipeline on the target environment.

- [ ] **Step 1: Confirm the required secrets per environment**

The function deploys regardless, but each channel no-ops until its secret is set. Checklist (set via `npx supabase secrets set KEY=value` after relogin to the RACC account for prod, or the dashboard):

| Secret | Purpose | Prod status |
|--------|---------|-------------|
| `RESEND_API_KEY` | Customer + agent email | already set (Resend, raccagency.com verified) |
| `WHATSAPP_PROVIDER=onewaysms` | Enable real SMS | already set |
| `ONEWAYSMS_API_USERNAME` / `ONEWAYSMS_API_PASSWORD` | OneWaySMS auth | already set |
| `ONEWAYSMS_EXPIRY_TEMPLATE_ID` | **NEW** — the pre-registered expiry-reminder template id | **MUST be registered + set before go-live** (spec §7/§14) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Service-role client + bearer check | auto-injected by the platform |

> The expiry SMS template must be registered with OneWaySMS to accept 4 ordered params: `customerName | carPlate | expiryDate | merchantName` (matching `sendExpiryReminder([...])`). Until `ONEWAYSMS_EXPIRY_TEMPLATE_ID` is set, the SMS channel returns a clean "template not configured" no-op.

- [ ] **Step 2: Deploy the edge function**

- **Prod:** apply the migration via MCP `apply_migration` (Task 1 SQL), run the Task 1 Step 2 Vault inserts via MCP `execute_sql`, then deploy the function (MCP `deploy_edge_function` for `send-expiry-reminders`, or `npx supabase functions deploy send-expiry-reminders` after relogin to the RACC-linked project `mjtdsevynrtcmafsnxsj`).
- **Local:** `npx supabase functions serve send-expiry-reminders` (uses `verify_jwt=false` from config).

- [ ] **Step 3: End-to-end manual test**

1. Insert (or reuse) a complete fixture: an active merchant + branch + branch_link (with a tied `agent_id`) + an enquiry + one `enquiry_vehicles` row with `status='submitted'`, `reminder_sent_at IS NULL`, and `insurance_expiry_date = (CURRENT_DATE + INTERVAL '30 days')::date`, plus a real customer email/phone you control.
2. Trigger the pipeline directly (don't wait for 01:00 UTC):
   ```bash
   docker exec supabase_db_DATA psql -U postgres -d postgres -tAc "SELECT public.enqueue_expiry_reminders();"
   ```
   Expected: returns `1` (one vehicle enqueued). For local HTTP delivery, `project_url` must be `http://kong:8000` and `npx supabase functions serve` must be running.
3. Confirm once-only stamping after the function ran:
   ```bash
   docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
   "SELECT reminder_sent_at IS NOT NULL FROM enquiry_vehicles WHERE id='<fixture-vehicle-id>';"
   ```
   Expected: `t`. Re-running `enqueue_expiry_reminders()` now returns `0` (the stamped vehicle is excluded).
4. Verify the channels: customer email received (Resend), customer SMS received if `WHATSAPP_PROVIDER=onewaysms` + template set (else mock log), and the tied agent's email received.

- [ ] **Step 4: (No commit)** — deployment/ops only; no repo changes in this task.

---

## Phase 4 done — verification summary

- `npx supabase migration up` applies `20260628000020_expiry_reminders.sql` cleanly; `pg_cron` + `pg_net` enabled; `enqueue_expiry_reminders()` exists and returns `0` on an empty DB; the `expiry-reminders-daily` cron job is registered at `0 1 * * *`.
- `_shared/whatsapp-service.ts` exports `sendExpiryReminder` (Mock + OneWaySMS); `deno check` passes (or deferred to deploy).
- `send-expiry-reminders` deploys; with secrets set, a vehicle due in 30 days receives a customer email + SMS, the tied agent gets an email, and `reminder_sent_at` is stamped so the next daily run skips it.
- The only per-environment values are the two Vault secrets (`project_url`, `service_role_key`) and `ONEWAYSMS_EXPIRY_TEMPLATE_ID`; the committed migration and function are identical across local/staging/prod.

## Next phase (separate plan)

5. Agent portal — propose merchant/branch, generate branch links, my enquiries & commissions.
