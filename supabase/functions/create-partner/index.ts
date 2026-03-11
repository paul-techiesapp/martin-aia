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
    const { name, email, phone, nric, password } = await req.json();

    // Validate required fields
    if (!name || !email || !phone || !password) {
      return new Response(
        JSON.stringify({ error: "name, email, phone, and password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate password length
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get caller's auth token to identify the agent
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller is an agent
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get agent_id from the agents table
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", caller.id)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Only agents can create partners" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create auth user
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

    // Insert partner record
    const { data: partner, error: partnerError } = await supabase
      .from("partners")
      .insert({
        agent_id: agent.id,
        user_id: newUser.user.id,
        name,
        email,
        phone,
        nric: nric || null,
      })
      .select()
      .single();

    if (partnerError) {
      // Cleanup: delete orphaned auth user
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return new Response(
        JSON.stringify({ error: partnerError.message || "Failed to create partner record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, partner }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-partner error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
