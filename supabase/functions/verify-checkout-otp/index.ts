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

    const { slot_id, nric, identifier, code } = await req.json();
    if (!slot_id || !nric || !identifier || !code) {
      return new Response(
        JSON.stringify({ error: 'missing_fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Look up registration by NRIC
    const { data: registration } = await supabase
      .from('registrations')
      .select('id, status, invitee_email, invitee_phone')
      .eq('slot_id', slot_id)
      .eq('invitee_nric', nric)
      .single();

    if (!registration) {
      return new Response(
        JSON.stringify({ error: 'registration_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1b. Cross-check second identifier
    const emailMatch = registration.invitee_email && registration.invitee_email.toLowerCase() === identifier.toLowerCase();
    const phoneMatch = registration.invitee_phone && registration.invitee_phone === identifier;
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

    // Fetch attendance_id for rating submission
    const { data: updatedAttendance } = await supabase
      .from('attendance')
      .select('id')
      .eq('registration_id', registration.id)
      .single();

    // Fetch checkout_config from campaign via slot
    const { data: slotData } = await supabase
      .from('slots')
      .select('campaign_id, campaigns(checkout_config)')
      .eq('id', slot_id)
      .single();

    const checkout_config = slotData?.campaigns?.checkout_config ?? {};

    return new Response(
      JSON.stringify({
        success: true,
        attendance_id: updatedAttendance?.id ?? null,
        checkout_config,
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
