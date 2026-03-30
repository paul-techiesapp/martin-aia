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
    const { agent_id } = await req.json();

    if (!agent_id) {
      return new Response(
        JSON.stringify({ error: "agent_id is required" }),
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

    if (agentError || !callerAgent || callerAgent.parent_agent_id !== null) {
      return new Response(
        JSON.stringify({ error: "Only Agent Admins can deactivate sub-agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: targetAgent, error: targetError } = await supabase
      .from("agents")
      .select("id, user_id, parent_agent_id")
      .eq("id", agent_id)
      .single();

    if (targetError || !targetAgent) {
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (targetAgent.parent_agent_id !== callerAgent.id) {
      return new Response(
        JSON.stringify({ error: "You can only deactivate your own sub-agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.auth.admin.updateUserById(targetAgent.user_id, {
      ban_duration: "876000h",
    });

    const { error: updateError } = await supabase
      .from("agents")
      .update({ status: "inactive" })
      .eq("id", agent_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to deactivate sub-agent" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase
      .from("agent_links")
      .update({ is_active: false })
      .eq("agent_id", agent_id)
      .eq("is_active", true);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("deactivate-sub-agent error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
