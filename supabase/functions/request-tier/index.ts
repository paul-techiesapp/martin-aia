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
    const { agent_id, partner_id, tier_id } = await req.json();

    if ((!agent_id && !partner_id) || !tier_id) {
      return new Response(
        JSON.stringify({ error: "tier_id and one of agent_id or partner_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (agent_id && partner_id) {
      return new Response(
        JSON.stringify({ error: "Provide either agent_id or partner_id, not both" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    const { data: callerAgent, error: agentError } = await supabase
      .from("agents")
      .select("id, parent_agent_id")
      .eq("user_id", caller.id)
      .single();

    if (agentError || !callerAgent) {
      return new Response(
        JSON.stringify({ error: "Only agents can request tiers" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (callerAgent.parent_agent_id !== null) {
      return new Response(
        JSON.stringify({ error: "Only Agent Admins can request tiers" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (agent_id) {
      if (agent_id !== callerAgent.id) {
        const { data: targetAgent, error: targetError } = await supabase
          .from("agents")
          .select("id, parent_agent_id")
          .eq("id", agent_id)
          .single();

        if (targetError || !targetAgent || targetAgent.parent_agent_id !== callerAgent.id) {
          return new Response(
            JSON.stringify({ error: "You can only request tiers for your own sub-agents" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const { data: existing } = await supabase
        .from("tier_requests")
        .select("id")
        .eq("agent_id", agent_id)
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: "A pending tier request already exists for this agent" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      const { data: targetPartner, error: partnerError } = await supabase
        .from("partners")
        .select("id, agent_id")
        .eq("id", partner_id)
        .single();

      if (partnerError || !targetPartner) {
        return new Response(
          JSON.stringify({ error: "Partner not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (targetPartner.agent_id !== callerAgent.id) {
        return new Response(
          JSON.stringify({ error: "You can only request tiers for your own partners" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: existing } = await supabase
        .from("tier_requests")
        .select("id")
        .eq("partner_id", partner_id)
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: "A pending tier request already exists for this partner" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { data: tier, error: tierError } = await supabase
      .from("tiers")
      .select("id")
      .eq("id", tier_id)
      .single();

    if (tierError || !tier) {
      return new Response(
        JSON.stringify({ error: "Tier not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: request, error: insertError } = await supabase
      .from("tier_requests")
      .insert({
        agent_id: agent_id || null,
        partner_id: partner_id || null,
        requested_tier_id: tier_id,
        requested_by: callerAgent.id,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: insertError.message || "Failed to create tier request" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, request }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("request-tier error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
