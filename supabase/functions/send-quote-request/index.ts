// supabase/functions/send-quote-request/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Edge Functions run in UTC. insurance_expiry_date is a DATE column; anchor it
// to Asia/Singapore midnight so the formatted calendar day never drifts.
const EVENT_TIME_ZONE = 'Asia/Singapore';

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function formatExpiryDate(dateOnly: string | null): string {
  if (!dateOnly) return '—';
  const date = new Date(`${dateOnly}T00:00:00+08:00`);
  return date.toLocaleDateString('en-SG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: EVENT_TIME_ZONE,
  });
}

interface QuoteEmailData {
  agentName: string;
  agentCode: string;
  unitName: string;
  unitAdmin: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerNric: string;
  carPlate: string;
  insuranceExpiry: string;
  roadTax: string;
  partner: string;
}

function row(label: string, value: string): string {
  return `<tr><td style="color: #64748b; padding: 4px 12px 4px 0; white-space: nowrap;">${esc(label)}</td><td style="color: #334155;">${esc(value)}</td></tr>`;
}

function buildQuoteRequestHtml(d: QuoteEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #334155;">
  <div style="background: #f8fafc; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
    <h2 style="margin: 0 0 24px 0; color: #0f172a;">Quote requested</h2>
    <p style="margin: 0 0 20px 0;">The agent has requested a quote. Please prepare and send the quotation.</p>

    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 16px 0;">
      <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Agent &amp; Unit</p>
      <table style="width: 100%; font-size: 14px;">
        ${row('Agent', d.agentName)}
        ${row('Agent Code', d.agentCode)}
        ${row('Unit', d.unitName)}
        ${row('Unit Admin', d.unitAdmin)}
      </table>
    </div>

    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 16px 0;">
      <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Customer</p>
      <table style="width: 100%; font-size: 14px;">
        ${row('Name', d.customerName)}
        ${row('Phone', d.customerPhone)}
        ${row('Email', d.customerEmail)}
        ${row('NRIC', d.customerNric)}
      </table>
    </div>

    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 20px 0;">
      <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Vehicle</p>
      <table style="width: 100%; font-size: 14px;">
        ${row('Car Plate', d.carPlate)}
        ${row('Insurance Expiry', d.insuranceExpiry)}
        ${row('Road Tax', d.roadTax)}
        ${row('Partner', d.partner)}
      </table>
    </div>

    <p style="margin: 0; font-size: 13px; color: #94a3b8;">Log in to the RACC portal to manage this enquiry.</p>
  </div>
</body>
</html>`;
}

async function sendResendEmail(
  resendApiKey: string,
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; content: string }[],
): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'RACC Partnership <enquiries@raccagency.com>',
        to,
        subject,
        html,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Auth: accept EITHER a valid user JWT (forwarded by functions.invoke) OR
    // the service-role bearer token. Reject anything else.
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();

    let authorized = false;
    let isServiceRole = false;
    let callerUserId: string | null = null;
    let callerIsAdmin = false;
    if (serviceKey && token === serviceKey) {
      authorized = true;
      isServiceRole = true;
    } else if (token && supabaseUrl && anonKey) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (user && !authErr) {
        authorized = true;
        callerUserId = user.id;
        // Admin role lives in app_metadata (not spoofable user_metadata).
        callerIsAdmin = (user.app_metadata as { role?: string } | null)?.role === 'admin';
      }
    }

    if (!authorized) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const payload = await req.json().catch(() => ({}));
    const enquiryId: string | undefined = payload.enquiry_id;
    const vehicleId: string | undefined = payload.vehicle_id;

    if (!enquiryId || !vehicleId) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'enquiry_id and vehicle_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Service-role client: read data bypassing RLS.
    const supabase = createClient(supabaseUrl, serviceKey);

    // Load the enquiry + tied agent.
    const { data: enquiry, error: eErr } = await supabase
      .from('enquiries')
      .select(`
        agent_id,
        customer_name,
        customer_nric,
        customer_phone,
        customer_email,
        agent:agents(name, agent_code, unit_name, parent_agent_id)
      `)
      .eq('id', enquiryId)
      .single();

    if (eErr || !enquiry) {
      console.error(`Enquiry ${enquiryId} not found:`, eErr);
      return new Response(
        JSON.stringify({ error: 'not_found', message: `Enquiry ${enquiryId} not found` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const agent = (enquiry as any).agent as {
      name: string | null;
      agent_code: string | null;
      unit_name: string | null;
      parent_agent_id: string | null;
    } | null;

    // Authorization (object-level): a non-service, non-admin caller may act on
    // an enquiry tied to their OWN agent record, OR — as a unit viewer (Unit
    // Manager / Unit Admin) — on any enquiry belonging to an agent sharing
    // their unit root. Prevents an authenticated agent from triggering
    // emails / stamping vehicles on enquiries outside their own unit.
    if (!isServiceRole && !callerIsAdmin) {
      let authorizedForEnquiry = false;
      if (callerUserId && enquiry.agent_id) {
        const { data: callerAgent } = await supabase
          .from('agents')
          .select('id, parent_agent_id, is_unit_manager')
          .eq('user_id', callerUserId)
          .maybeSingle();
        if (callerAgent) {
          if (callerAgent.id === enquiry.agent_id) {
            authorizedForEnquiry = true;
          } else if (callerAgent.parent_agent_id === null || callerAgent.is_unit_manager) {
            const callerUnitRoot = callerAgent.parent_agent_id ?? callerAgent.id;
            const enquiryUnitRoot = agent?.parent_agent_id ?? enquiry.agent_id;
            authorizedForEnquiry = callerUnitRoot === enquiryUnitRoot;
          }
        }
      }
      if (!authorizedForEnquiry) {
        return new Response(
          JSON.stringify({ error: 'forbidden', message: 'You do not own this enquiry' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Load the specific vehicle — must belong to this enquiry.
    const { data: vehicle, error: vErr } = await supabase
      .from('enquiry_vehicles')
      .select('car_plate, insurance_expiry_date, road_tax_renewal, quote_requested_at, merchant_id')
      .eq('id', vehicleId)
      .eq('enquiry_id', enquiryId)
      .single();

    if (vErr || !vehicle) {
      console.error(`Vehicle ${vehicleId} not found for enquiry ${enquiryId}:`, vErr);
      return new Response(
        JSON.stringify({ error: 'not_found', message: `Vehicle ${vehicleId} not found for this enquiry` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Idempotency: if already requested, do not send a duplicate email.
    if (vehicle.quote_requested_at) {
      return new Response(
        JSON.stringify({ ok: true, alreadyRequested: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Resolve the "Unit Admin" (parent agent) name when applicable.
    let unitAdmin = '—';
    if (agent?.parent_agent_id) {
      const { data: parent, error: pErr } = await supabase
        .from('agents')
        .select('name')
        .eq('id', agent.parent_agent_id)
        .single();
      if (pErr) {
        console.error(`Parent agent ${agent.parent_agent_id} lookup failed:`, pErr);
      } else if (parent?.name) {
        unitAdmin = parent.name;
      }
    }

    // Resolve the assigned partner (merchant) name when the vehicle has one.
    let partner = '—';
    if (vehicle.merchant_id) {
      const { data: merchant, error: mErr } = await supabase
        .from('merchants')
        .select('name')
        .eq('id', vehicle.merchant_id)
        .single();
      if (mErr) {
        console.error(`Merchant ${vehicle.merchant_id} lookup failed:`, mErr);
      } else if (merchant?.name) {
        partner = merchant.name;
      }
    }

    // Resolve recipient: system_settings.admin_notification_email.
    const { data: settings, error: sErr } = await supabase
      .from('system_settings')
      .select('admin_notification_email')
      .limit(1)
      .maybeSingle();

    if (sErr) {
      console.error('Failed to load system_settings:', sErr);
    }

    const adminEmail = settings?.admin_notification_email?.trim() || '';

    // Graceful skip: no admin recipient configured.
    if (!adminEmail) {
      console.warn(`send-quote-request: no admin email configured — skipping for enquiry ${enquiryId}`);
      return new Response(
        JSON.stringify({ skipped: true, reason: 'no admin email configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    // Graceful skip: no Resend key.
    if (!resendApiKey) {
      console.warn(`send-quote-request: RESEND_API_KEY unset — skipping for enquiry ${enquiryId}`);
      return new Response(
        JSON.stringify({ skipped: true, reason: 'no resend key' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const customerName = enquiry.customer_name ?? 'Customer';
    const carPlate = vehicle.car_plate ?? '—';

    const emailData: QuoteEmailData = {
      agentName: agent?.name ?? 'House',
      agentCode: agent?.agent_code ?? '—',
      unitName: agent?.unit_name ?? '—',
      unitAdmin,
      customerName,
      customerPhone: enquiry.customer_phone ?? '—',
      customerEmail: enquiry.customer_email ?? '—',
      customerNric: enquiry.customer_nric ?? '—',
      carPlate,
      insuranceExpiry: formatExpiryDate(vehicle.insurance_expiry_date),
      roadTax: vehicle.road_tax_renewal ? 'Yes' : 'No',
      partner,
    };

    // Atomically CLAIM the request slot before sending so concurrent or repeat
    // invocations cannot double-email: only the call that flips NULL -> now() sends.
    const { data: claimed, error: claimErr } = await supabase
      .from('enquiry_vehicles')
      .update({ quote_requested_at: new Date().toISOString() })
      .eq('id', vehicleId)
      .is('quote_requested_at', null)
      .select('id')
      .maybeSingle();

    if (claimErr) {
      console.error(`Failed to claim quote request for vehicle ${vehicleId}:`, claimErr);
      return new Response(
        JSON.stringify({ ok: false, error: 'claim_failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!claimed) {
      // Another invocation claimed it first — do not send a duplicate.
      return new Response(
        JSON.stringify({ ok: true, alreadyRequested: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Attach the customer's uploaded documents so admin can prepare the quote.
    // Best-effort: downloaded only after the claim succeeds (so a failed claim
    // doesn't waste downloads), and a download failure never blocks the email.
    const { data: atts } = await supabase
      .from('enquiry_attachments')
      .select('storage_path, file_name, content_type')
      .eq('enquiry_vehicle_id', vehicleId);

    const MAX_TOTAL = 15 * 1024 * 1024;
    let total = 0;
    const attachments: { filename: string; content: string }[] = [];
    for (const a of atts ?? []) {
      const { data: blob, error } = await supabase.storage.from('enquiry-attachments').download(a.storage_path);
      if (error || !blob) { console.error(`attachment download failed: ${a.storage_path}`, error); continue; }
      const buf = new Uint8Array(await blob.arrayBuffer());
      if (total + buf.byteLength > MAX_TOTAL) { console.warn(`skipping ${a.file_name}: attachment budget exceeded`); continue; }
      total += buf.byteLength;
      // Chunked base64 to avoid call-stack limits on large files.
      let binary = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      attachments.push({ filename: a.file_name, content: btoa(binary) });
    }

    const sent = await sendResendEmail(
      resendApiKey,
      adminEmail,
      `Quote requested — ${customerName} / ${carPlate}`,
      buildQuoteRequestHtml(emailData),
      attachments,
    );

    if (!sent) {
      // Roll the claim back so the agent can retry.
      await supabase
        .from('enquiry_vehicles')
        .update({ quote_requested_at: null })
        .eq('id', vehicleId);
      return new Response(
        JSON.stringify({ ok: false, error: 'email_send_failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('send-quote-request error:', err);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
