import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { partner_id } = await req.json();

    if (!partner_id) {
      return new Response(
        JSON.stringify({ error: "partner_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is the parent agent
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get agent_id
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", caller.id)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Only agents can deactivate partners" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify partner belongs to this agent
    const { data: partner, error: partnerError } = await supabase
      .from("partners")
      .select("id, user_id, agent_id")
      .eq("id", partner_id)
      .single();

    if (partnerError || !partner) {
      return new Response(
        JSON.stringify({ error: "Partner not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (partner.agent_id !== agent.id) {
      return new Response(
        JSON.stringify({ error: "You can only deactivate your own partners" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Ban the auth user first (prevents new requests)
    await supabase.auth.admin.updateUserById(partner.user_id, {
      ban_duration: "876000h",
    });

    // Step 2: Atomically update status and deactivate agent links via RPC
    const { data: releasedCount, error: rpcError } = await supabase
      .rpc("deactivate_partner_and_release", { partner_uuid: partner_id });

    if (rpcError) {
      console.error("deactivate RPC error:", rpcError);
      return new Response(
        JSON.stringify({ error: "Failed to deactivate partner" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, released_links: releasedCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("deactivate-partner error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
