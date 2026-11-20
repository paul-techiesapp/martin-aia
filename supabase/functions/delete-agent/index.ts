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
// Units are RECURSIVE trees (a unit = the whole tree under its top-most root),
// so both the unit-scope check and the descendant sweep walk the hierarchy
// instead of assuming a single parent level.
const MAX_DEPTH = 50;

// deno-lint-ignore no-explicit-any
async function topRootOf(supabase: any, agentId: string): Promise<string> {
  let current = agentId;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const { data, error } = await supabase
      .from("agents")
      .select("parent_agent_id")
      .eq("id", current)
      .single();
    if (error) throw new Error(`Failed to resolve unit: ${error.message}`);
    if (!data?.parent_agent_id) return current;
    current = data.parent_agent_id;
  }
  return current;
}

// deno-lint-ignore no-explicit-any
async function descendantsOf(
  supabase: any,
  agentId: string
): Promise<{ id: string; user_id: string; is_unit_manager: boolean }[]> {
  const out: { id: string; user_id: string; is_unit_manager: boolean }[] = [];
  let frontier = [agentId];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const { data, error } = await supabase
      .from("agents")
      .select("id, user_id, is_unit_manager")
      .in("parent_agent_id", frontier);
    // Never continue with a partial list: a missed level would leave orphaned
    // logins, and the permission checks below must see the whole subtree.
    if (error) throw new Error(`Failed to load agents under target: ${error.message}`);
    const children = (data ?? []) as { id: string; user_id: string; is_unit_manager: boolean }[];
    out.push(...children);
    frontier = children.map((c) => c.id);
  }
  return out;
}

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
      const unitRootId = await topRootOf(supabase, unitCaller.id);
      if (target.parent_agent_id === null) {
        return new Response(
          JSON.stringify({ error: "The Unit Manager can only be deleted by the master admin" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (target.id === unitCaller.id || (await topRootOf(supabase, target.id)) !== unitRootId) {
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

    // Every agent below the target (recursive). Their auth users must be
    // removed too, otherwise the parent_agent_id cascade would delete their
    // agents rows but leave orphaned logins that keep the email reserved.
    const subAgents = await descendantsOf(supabase, target.id);

    // The sweep deletes the whole subtree, so unit callers' permissions must
    // hold for EVERY agent in it, not just the target.
    if (unitCaller) {
      if (subAgents.some((a) => a.id === unitCaller!.id)) {
        return new Response(
          JSON.stringify({ error: "You cannot delete an agent you report to" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const callerIsRoot = unitCaller.parent_agent_id === null;
      if (!callerIsRoot && subAgents.some((a) => a.is_unit_manager)) {
        return new Response(
          JSON.stringify({
            error: "This agent has Unit Admins under them. Only the Unit Manager can delete them.",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

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
