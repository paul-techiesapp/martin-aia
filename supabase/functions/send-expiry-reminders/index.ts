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
    <p style="margin: 0 0 16px 0;">Hi ${esc(customerName)},</p>
    <p style="margin: 0 0 20px 0;">This is a friendly reminder that your vehicle's insurance is due for renewal in about a month:</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 20px 0;">
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Vehicle</td><td style="color: #334155;">${esc(carPlate)}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Expires</td><td style="color: #334155;">${esc(expiryDateText)}</td></tr>
      </table>
    </div>
    <p style="margin: 0 0 12px 0;">Renew through <strong>${esc(merchantName)} (${esc(branchName)})</strong> with RACC and you'll qualify for a gold gift on confirmed renewal.</p>
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
    <p style="margin: 0 0 16px 0;">Hi ${esc(agentName)},</p>
    <p style="margin: 0 0 20px 0;">One of your referred customers has a car insurance renewal coming up in ~30 days. Reach out to help them renew with RACC:</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 20px 0;">
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Customer</td><td style="color: #334155;">${esc(customerName)}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Phone</td><td style="color: #334155;">${esc(customerPhone)}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Vehicle</td><td style="color: #334155;">${esc(carPlate)}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Expires</td><td style="color: #334155;">${esc(expiryDateText)}</td></tr>
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
