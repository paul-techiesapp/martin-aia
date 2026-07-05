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
      .select("id, parent_agent_id, is_unit_manager")
      .eq("user_id", caller.id)
      .single();

    // Unit root (parent_agent_id null) or a deputy flagged is_unit_manager.
    if (
      agentError ||
      !callerAgent ||
      (callerAgent.parent_agent_id !== null && callerAgent.is_unit_manager !== true)
    ) {
      return new Response(
        JSON.stringify({ error: "Only unit managers or unit admins can deactivate sub-agents" }),
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

    // The unit root (parent_agent_id null) can never be removed — this was
    // implicit before (a root could never match target.parent === caller.id)
    // and must stay explicit now that deputies can call this function.
    if (targetAgent.parent_agent_id === null) {
      return new Response(
        JSON.stringify({ error: "You cannot deactivate the unit manager" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Callers cannot remove themselves (previously impossible: only the root
    // could call this and the root was never a valid target).
    if (targetAgent.id === callerAgent.id) {
      return new Response(
        JSON.stringify({ error: "You cannot deactivate yourself" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Target must belong to the caller's unit: same unit root on both sides.
    const callerUnitRootId = callerAgent.parent_agent_id ?? callerAgent.id;
    const targetUnitRootId = targetAgent.parent_agent_id ?? targetAgent.id;
    if (targetUnitRootId !== callerUnitRootId) {
      return new Response(
        JSON.stringify({ error: "You can only deactivate sub-agents in your own unit" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Permanently delete the sub-agent. We delete the auth.users record(s) rather
    // than just flipping status, so the email/phone/nric/agent_code become reusable.
    // Deleting the auth user cascades (ON DELETE CASCADE) to remove the agents row
    // and its agent_links. The sub-agent may also own partners, whose auth users are
    // NOT cascade-removed, so we delete those too to avoid leaving them orphaned.
    const { data: subPartners } = await supabase
      .from("partners")
      .select("user_id")
      .eq("agent_id", targetAgent.id);

    const userIds = Array.from(
      new Set([targetAgent.user_id, ...(subPartners ?? []).map((p) => p.user_id)])
    );

    const errors: string[] = [];
    for (const uid of userIds) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(uid);
      if (delErr) errors.push(`${uid}: ${delErr.message}`);
    }

    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: `Failed to delete sub-agent: ${errors.join("; ")}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
