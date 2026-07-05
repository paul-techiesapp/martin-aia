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
    const { name, email, phone, nric, agent_code, password } = await req.json();

    if (!name || !email || !phone || !agent_code || !password) {
      return new Response(
        JSON.stringify({ error: "name, email, phone, agent_code, and password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
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

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, unit_name, parent_agent_id, is_unit_manager")
      .eq("user_id", caller.id)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Only agents can create sub-agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Unit root (parent_agent_id null) or a deputy flagged is_unit_manager.
    if (agent.parent_agent_id !== null && agent.is_unit_manager !== true) {
      return new Response(
        JSON.stringify({ error: "Only unit managers or unit admins can create sub-agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // New sub-agents always hang off the UNIT ROOT (a deputy's own parent),
    // keeping the unit tree flat regardless of who created them.
    const unitRootId = agent.parent_agent_id ?? agent.id;

    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      const status = createError.message?.includes("already") ? 409 : 400;
      return new Response(
        JSON.stringify({ error: createError.message || "Failed to create user" }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: subAgent, error: insertError } = await supabase
      .from("agents")
      .insert({
        user_id: newUser.user.id,
        name,
        email,
        phone,
        nric: nric || null,
        agent_code,
        unit_name: agent.unit_name,
        parent_agent_id: unitRootId,
      })
      .select()
      .single();

    if (insertError) {
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return new Response(
        JSON.stringify({ error: insertError.message || "Failed to create sub-agent record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, agent: subAgent }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-sub-agent error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
