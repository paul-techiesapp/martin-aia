import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mapUniqueViolation(
  error: { code?: string; message?: string | null }
): { field: string; error: string } | null {
  if (error.code !== "23505") return null;
  const msg = error.message ?? "";
  if (msg.includes("agents_email_key")) return { field: "email", error: "This email is already in use" };
  if (msg.includes("agents_phone_key")) return { field: "phone", error: "This phone number is already in use" };
  if (msg.includes("agents_agent_code_key")) return { field: "agent_code", error: "This agent code is already in use" };
  if (msg.includes("agents_nric_unique") || msg.includes("agents_nric_key")) {
    return { field: "nric", error: "This NRIC is already in use" };
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      name,
      email,
      phone,
      nric,
      agent_code,
      unit_name,
      tier_id,
      status,
      password,
    } = await req.json();

    if (!name || !email || !phone || !agent_code || !unit_name || !tier_id || !password) {
      return new Response(
        JSON.stringify({
          error: "name, email, phone, agent_code, unit_name, tier_id, and password are required",
        }),
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

    if (authError || !caller || caller.user_metadata?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can create agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "agent" },
    });

    if (createError) {
      const alreadyExists = createError.message?.toLowerCase().includes("already");
      return new Response(
        JSON.stringify(
          alreadyExists
            ? { field: "email", error: "Email is already registered" }
            : { error: createError.message || "Failed to create user" }
        ),
        { status: alreadyExists ? 409 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: agent, error: insertError } = await supabase
      .from("agents")
      .insert({
        user_id: newUser.user.id,
        name,
        email,
        phone,
        nric: nric || null,
        agent_code,
        unit_name,
        tier_id,
        status: status ?? "active",
        parent_agent_id: null,
        is_auto_invite: true,
      })
      .select()
      .single();

    if (insertError) {
      await supabase.auth.admin.deleteUser(newUser.user.id);
      const mapped = mapUniqueViolation(insertError);
      return new Response(
        JSON.stringify(mapped ?? { error: insertError.message || "Failed to create agent record" }),
        { status: mapped ? 409 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, agent }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-agent error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
