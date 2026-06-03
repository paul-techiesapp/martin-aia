// supabase/functions/send-checkout-otp/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createWhatsAppService } from '../_shared/whatsapp-service.ts';
import { maskPhone, phonesMatch } from '../_shared/phone-utils.ts';

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

    const { slot_id, nric, identifier } = await req.json();
    if (!slot_id || !nric || !identifier) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'slot_id, nric, and identifier (email or phone) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Look up registration by NRIC
    const { data: registration } = await supabase
      .from('registrations')
      .select('id, status, invitee_phone, invitee_email')
      .eq('slot_id', slot_id)
      .eq('invitee_nric', nric)
      .single();

    if (!registration) {
      return new Response(
        JSON.stringify({ error: 'registration_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1b. Cross-check second identifier (email or phone)
    const emailMatch = registration.invitee_email && registration.invitee_email.toLowerCase() === identifier.toLowerCase();
    const phoneMatch = phonesMatch(registration.invitee_phone, identifier);
    if (!emailMatch && !phoneMatch) {
      return new Response(
        JSON.stringify({ error: 'identifier_mismatch', message: 'The email/phone does not match the registration for this NRIC.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      // Fetch checkout_config for the thank you page
      const { data: slotData } = await supabase
        .from('slots')
        .select('campaign_id, campaigns(checkout_config)')
        .eq('id', slot_id)
        .single();

      return new Response(
        JSON.stringify({
          error: 'already_checked_out',
          attendance_id: attendance.id,
          checkout_config: slotData?.campaigns?.checkout_config ?? {},
        }),
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
    console.log(`[CHECKOUT OTP] Phone: ${phone}, Code: ${code}`);

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
