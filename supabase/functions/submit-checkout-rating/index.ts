// supabase/functions/submit-checkout-rating/index.ts
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

    const { attendance_id, rating } = await req.json();

    // Validate inputs
    if (!attendance_id || rating === undefined || rating === null) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'attendance_id and rating are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return new Response(
        JSON.stringify({ error: 'invalid_rating', message: 'Rating must be an integer between 1 and 5' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up attendance record
    const { data: attendance, error: fetchError } = await supabase
      .from('attendance')
      .select('id, checkout_rating')
      .eq('id', attendance_id)
      .single();

    if (fetchError || !attendance) {
      return new Response(
        JSON.stringify({ error: 'attendance_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent double-submission
    if (attendance.checkout_rating !== null) {
      return new Response(
        JSON.stringify({ error: 'already_rated' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update rating
    const { error: updateError } = await supabase
      .from('attendance')
      .update({ checkout_rating: rating })
      .eq('id', attendance_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'update_failed', message: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
