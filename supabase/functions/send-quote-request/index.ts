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
    if (serviceKey && token === serviceKey) {
      authorized = true;
    } else if (token && supabaseUrl && anonKey) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (user && !authErr) authorized = true;
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

    // Load the specific vehicle.
    const { data: vehicle, error: vErr } = await supabase
      .from('enquiry_vehicles')
      .select('car_plate, insurance_expiry_date, road_tax_renewal')
      .eq('id', vehicleId)
      .single();

    if (vErr || !vehicle) {
      console.error(`Vehicle ${vehicleId} not found:`, vErr);
      return new Response(
        JSON.stringify({ error: 'not_found', message: `Vehicle ${vehicleId} not found` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const agent = (enquiry as any).agent as {
      name: string | null;
      agent_code: string | null;
      unit_name: string | null;
      parent_agent_id: string | null;
    } | null;

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
    };

    const sent = await sendResendEmail(
      resendApiKey,
      adminEmail,
      `Quote requested — ${customerName} / ${carPlate}`,
      buildQuoteRequestHtml(emailData),
    );

    if (!sent) {
      return new Response(
        JSON.stringify({ ok: false, error: 'email_send_failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Stamp the vehicle so the agent UI can mark the quote as requested.
    const { error: uErr } = await supabase
      .from('enquiry_vehicles')
      .update({ quote_requested_at: new Date().toISOString() })
      .eq('id', vehicleId);

    if (uErr) {
      console.error(`Failed to stamp quote_requested_at for vehicle ${vehicleId}:`, uErr);
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
