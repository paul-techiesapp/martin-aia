// supabase/functions/create-merchant-user/index.ts
// Admin-only: create or revoke a Master Partner (merchant) portal login.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Verify caller identity via anon-key client, then check admin role.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authError } = await userClient.auth.getUser();

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Admin role lives in app_metadata (not spoofable user_metadata).
    const isAdmin = (caller.app_metadata as { role?: string } | null)?.role === 'admin';
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Only admins can manage merchant portal access' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const payload = await req.json().catch(() => ({}));
    const action: string | undefined = payload.action;
    const merchantId: string | undefined = payload.merchant_id;

    if (!merchantId) {
      return new Response(
        JSON.stringify({ error: 'merchant_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'create') {
      const { email, password } = payload;

      if (!email || !password) {
        return new Response(
          JSON.stringify({ error: 'email and password are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (password.length < 6) {
        return new Response(
          JSON.stringify({ error: 'Password must be at least 6 characters' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: merchant, error: merchantError } = await supabase
        .from('merchants')
        .select('id, user_id')
        .eq('id', merchantId)
        .single();

      if (merchantError || !merchant) {
        return new Response(
          JSON.stringify({ error: 'Merchant not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (merchant.user_id) {
        return new Response(
          JSON.stringify({ error: 'This merchant already has portal access' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Create auth user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: 'merchant' },
      });

      if (createError) {
        const status = createError.message?.includes('already') ? 409 : 400;
        return new Response(
          JSON.stringify({ error: createError.message || 'Failed to create user' }),
          { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Link the new auth user to the merchant record.
      const { data: updatedMerchant, error: updateError } = await supabase
        .from('merchants')
        .update({ user_id: newUser.user.id, portal_email: email })
        .eq('id', merchantId)
        .select()
        .single();

      if (updateError) {
        // Cleanup: delete orphaned auth user.
        await supabase.auth.admin.deleteUser(newUser.user.id);
        return new Response(
          JSON.stringify({ error: updateError.message || 'Failed to link merchant portal user' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, merchant: updatedMerchant }),
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'revoke') {
      const { data: merchant, error: merchantError } = await supabase
        .from('merchants')
        .select('id, user_id')
        .eq('id', merchantId)
        .single();

      if (merchantError || !merchant) {
        return new Response(
          JSON.stringify({ error: 'Merchant not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (!merchant.user_id) {
        return new Response(
          JSON.stringify({ error: 'This merchant has no portal access to revoke' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { error: deleteError } = await supabase.auth.admin.deleteUser(merchant.user_id);
      if (deleteError) {
        return new Response(
          JSON.stringify({ error: deleteError.message || 'Failed to delete portal user' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: updatedMerchant, error: updateError } = await supabase
        .from('merchants')
        .update({ user_id: null, portal_email: null })
        .eq('id', merchantId)
        .select()
        .single();

      if (updateError) {
        return new Response(
          JSON.stringify({ error: updateError.message || 'Failed to update merchant record' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, merchant: updatedMerchant }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('create-merchant-user error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
