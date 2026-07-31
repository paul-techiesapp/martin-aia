import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Permanently deletes an agent (unit) created by an admin.
//
// Deletion is done by removing the underlying auth.users record, NOT by deleting
// the agents row directly. The FK agents.user_id -> auth.users is ON DELETE CASCADE,
// which only cascades when the auth user is removed; deleting the agents row alone
// would leave the auth user orphaned and keep its email reserved, so the same
// email/phone could never be re-used. We therefore collect every auth user under
// this unit (the agent, its sub-agents, and all of their partners) and delete each
// one, freeing email/phone/nric/agent_code for re-creation.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agent_id, force } = await req.json();

    if (!agent_id) {
      return new Response(
        JSON.stringify({ error: "agent_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await createClient(
      supabaseUrl,
      supabaseAnonKey
    ).auth.getUser(token);

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Only admins can delete agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin check uses app_metadata (set only by the service role), never the
    // user-settable user_metadata, to prevent self-escalation via auth.updateUser.
    // Non-admins may still delete agents if they are a unit root (Unit Manager)
    // or a deputy (is_unit_manager) acting within their own unit; see the
    // unit-scope check below, applied once the target agent is fetched.
    const isAdmin = caller.app_metadata?.role === "admin";
    let unitCaller: { id: string; parent_agent_id: string | null; is_unit_manager: boolean } | null = null;
    if (!isAdmin) {
      const { data: callerAgent } = await supabase
        .from("agents")
        .select("id, parent_agent_id, is_unit_manager")
        .eq("user_id", caller.id)
        .single();
      const isRoot = callerAgent?.parent_agent_id === null;
      if (!callerAgent || (!isRoot && callerAgent.is_unit_manager !== true)) {
        return new Response(
          JSON.stringify({ error: "Only admins or unit managers can delete agents" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      unitCaller = callerAgent;
      if (force) {
        return new Response(
          JSON.stringify({ error: "Only admins can force-delete" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Target agent (unit)
    const { data: target, error: targetError } = await supabase
      .from("agents")
      .select("id, user_id, parent_agent_id, is_unit_manager")
      .eq("id", agent_id)
      .single();

    if (targetError || !target) {
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Unit-scope check: unit callers (root or deputy) may only delete agents
    // within their own unit, never the unit root itself, and deputies may only
    // delete plain Unit Agents (not other Unit Admins/deputies).
    if (unitCaller) {
      const unitRootId = unitCaller.parent_agent_id ?? unitCaller.id;
      if (target.parent_agent_id === null) {
        return new Response(
          JSON.stringify({ error: "The Unit Manager can only be deleted by the master admin" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (target.parent_agent_id !== unitRootId) {
        return new Response(
          JSON.stringify({ error: "Agent is not in your unit" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const callerIsRoot = unitCaller.parent_agent_id === null;
      if (!callerIsRoot && target.is_unit_manager === true) {
        return new Response(
          JSON.stringify({ error: "Only the Unit Manager can delete a Unit Admin" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Sub-agents under this unit (agent hierarchy is a single level deep)
    const { data: subAgents } = await supabase
      .from("agents")
      .select("id, user_id")
      .eq("parent_agent_id", target.id);

    const agentIds = [target.id, ...(subAgents ?? []).map((a) => a.id)];

    // enquiries.agent_id is ON DELETE SET NULL, so deleting this unit would
    // silently orphan its customers to agent_id NULL — invisible in every agent
    // portal, with no record of the prior owner. Refuse while open work remains
    // unless the admin explicitly forces it. Spans the whole unit because
    // deleting a unit deletes its sub-agents too.
    if (!force) {
      const { data: openEnquiries, error: openError } = await supabase
        .from("enquiries")
        .select("id, enquiry_vehicles!inner(id)")
        .in("agent_id", agentIds)
        .in("enquiry_vehicles.status", ["submitted", "quoted"]);

      if (openError) {
        return new Response(
          JSON.stringify({ error: `Failed to check open enquiries: ${openError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const openCount = (openEnquiries ?? []).length;
      if (openCount > 0) {
        return new Response(
          JSON.stringify({
            error:
              `This unit still has ${openCount} open partnership enquiry(s). ` +
              `Reassign those customers to another agent first (Enquiries > Reassign agent), ` +
              `or they will be left with no agent.`,
            open_enquiry_count: openCount,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Partners belonging to the agent or any of its sub-agents
    const { data: partners } = await supabase
      .from("partners")
      .select("user_id")
      .in("agent_id", agentIds);

    // Unique set of auth users to remove. Deleting each cascades to remove its
    // agents/partners row (ON DELETE CASCADE), so no orphaned records remain.
    const userIds = Array.from(
      new Set([
        target.user_id,
        ...(subAgents ?? []).map((a) => a.user_id),
        ...(partners ?? []).map((p) => p.user_id),
      ])
    );

    const errors: string[] = [];
    for (const uid of userIds) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(uid);
      if (delErr) errors.push(`${uid}: ${delErr.message}`);
    }

    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: `Failed to fully delete agent: ${errors.join("; ")}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, deleted_users: userIds.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("delete-agent error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
