// supabase/functions/send-enquiry-notification/index.ts
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

interface VehicleRow {
  car_plate: string;
  insurance_expiry_date: string;
}

function buildAgentNotificationHtml(
  agentName: string,
  customerName: string,
  customerPhone: string,
  customerNric: string | null,
  vehicles: VehicleRow[],
): string {
  const vehicleRows = vehicles
    .map(
      (v) => `
        <tr>
          <td style="color: #334155; padding: 6px 12px 6px 0;">${esc(v.car_plate)}</td>
          <td style="color: #334155; padding: 6px 0;">${esc(formatExpiryDate(v.insurance_expiry_date))}</td>
        </tr>`,
    )
    .join('');

  const nricRow = customerNric
    ? `<tr><td style="color: #64748b; padding: 4px 12px 4px 0;">NRIC</td><td style="color: #334155;">${esc(customerNric)}</td></tr>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #334155;">
  <div style="background: #f8fafc; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
    <h2 style="margin: 0 0 24px 0; color: #0f172a;">New insurance enquiry submitted</h2>
    <p style="margin: 0 0 16px 0;">Hi ${esc(agentName)},</p>
    <p style="margin: 0 0 20px 0;">A customer submitted an insurance enquiry through your link. Please follow up and assign it to a partnership:</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 24px 0;">
      <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Customer</p>
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Name</td><td style="color: #334155;">${esc(customerName)}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Phone</td><td style="color: #334155;">${esc(customerPhone)}</td></tr>
        ${nricRow}
      </table>
    </div>
    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 20px 0;">
      <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Vehicles</p>
      <table style="width: 100%; font-size: 14px;">
        <tr>
          <th style="text-align: left; color: #64748b; padding: 4px 12px 8px 0; font-weight: 500;">Plate</th>
          <th style="text-align: left; color: #64748b; padding: 4px 0 8px 0; font-weight: 500;">Expiry</th>
        </tr>
        ${vehicleRows}
      </table>
    </div>
    <p style="margin: 0; font-size: 13px; color: #94a3b8;">Log in to the RACC portal to assign this enquiry to a merchant partnership.</p>
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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Machine-to-machine only: invoked by pg_net with the service-role key.
    // Reject anything whose bearer token is not that key.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!serviceKey || token !== serviceKey) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const payload = await req.json().catch(() => ({}));
    const enquiryId: string | undefined = payload.enquiry_id;

    if (!enquiryId) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'enquiry_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);

    // Load the enquiry + tied agent
    const { data: enquiry, error: eErr } = await supabase
      .from('enquiries')
      .select(`
        id,
        customer_name,
        customer_nric,
        customer_phone,
        customer_email,
        agent_id,
        agent:agents(name, email)
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

    // Load vehicles for this enquiry
    const { data: vehicles, error: vErr } = await supabase
      .from('enquiry_vehicles')
      .select('car_plate, insurance_expiry_date')
      .eq('enquiry_id', enquiryId)
      .order('insurance_expiry_date', { ascending: true });

    if (vErr) {
      console.error(`Failed to load vehicles for enquiry ${enquiryId}:`, vErr);
    }

    const agent = (enquiry as any).agent as { name: string | null; email: string | null } | null;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    // Graceful degradation: no Resend key
    if (!resendApiKey) {
      console.warn(`send-enquiry-notification: RESEND_API_KEY unset — skipping email for enquiry ${enquiryId}`);
      return new Response(
        JSON.stringify({ skipped: true, reason: 'RESEND_API_KEY not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Item 6: every enquiry notifies the tied agent (when present) AND the admin
    // catch-all address, so branch/house enquiries with no tied agent still reach
    // someone. De-duplicate case-insensitively so we never double-send.
    const { data: settings } = await supabase
      .from('system_settings')
      .select('admin_notification_email')
      .limit(1)
      .maybeSingle();
    const adminEmail = settings?.admin_notification_email?.trim() || '';

    const recipients = Array.from(
      new Map(
        [agent?.email, adminEmail]
          .filter((e): e is string => !!e && e.trim() !== '')
          .map((e) => [e.trim().toLowerCase(), e.trim()]),
      ).values(),
    );

    if (recipients.length === 0) {
      const reason = enquiry.agent_id
        ? `Agent ${enquiry.agent_id} has no email and no admin_notification_email set`
        : 'No tied agent and no admin_notification_email set';
      console.warn(`send-enquiry-notification: ${reason} — skipping for enquiry ${enquiryId}`);
      return new Response(
        JSON.stringify({ skipped: true, reason }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const customerName = enquiry.customer_name ?? 'Customer';
    const customerPhone = enquiry.customer_phone ?? '—';
    const customerNric = enquiry.customer_nric ?? null;
    const agentName = agent?.name ?? 'Agent';
    const vehicleList: VehicleRow[] = (vehicles ?? []).filter(
      (v: any) => v.car_plate && v.insurance_expiry_date,
    );
    const html = buildAgentNotificationHtml(
      agentName, customerName, customerPhone, customerNric, vehicleList,
    );

    let sentCount = 0;
    for (const to of recipients) {
      const ok = await sendResendEmail(resendApiKey, to, `New enquiry from ${customerName}`, html);
      if (ok) sentCount++;
    }

    return new Response(
      JSON.stringify({
        enquiry_id: enquiryId,
        recipients,
        sent_count: sentCount,
        vehicles_included: vehicleList.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('send-enquiry-notification error:', err);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
