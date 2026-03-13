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
