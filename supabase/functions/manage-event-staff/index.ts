import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Admin-only management of "event staff" logins (organising-team accounts that
// may only check people in for the events assigned to them).
//
// The role lives in app_metadata (service-role only, never user-settable), which
// is what the admin portal and the DB policies key off. Event assignments are
// plain rows in campaign_staff, written by the admin portal under admin RLS.
//
// Actions:
//   { action: "create", name, email, password }
//   { action: "set_password", user_id, password }
//   { action: "delete", user_id }
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body?.action as string | undefined;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await createClient(
      supabaseUrl,
      supabaseAnonKey
    ).auth.getUser(token);

    if (authError || !caller || caller.app_metadata?.role !== "admin") {
      return json({ error: "Only admins can manage event staff" }, 403);
    }

    // Only ever act on accounts that ARE event staff, so this function can never
    // be used to reset or delete an admin / agent / partner login.
    const assertStaff = async (userId: string) => {
      const { data } = await supabase.auth.admin.getUserById(userId);
      return data?.user?.app_metadata?.role === "event_staff";
    };

    if (action === "create") {
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!name || !email || !password) {
        return json({ error: "name, email and password are required" }, 400);
      }
      if (password.length < 6) {
        return json({ error: "Password must be at least 6 characters" }, 400);
      }

      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: "event_staff" },
        user_metadata: { name, role: "event_staff" },
      });
      if (createError || !created?.user) {
        const msg = createError?.message ?? "Failed to create login";
        const already = /already (been )?registered|already exists/i.test(msg);
        return json(
          { error: already ? "This email is already used by another login" : msg, field: already ? "email" : undefined },
          already ? 409 : 400
        );
      }

      const { error: insertError } = await supabase
        .from("event_staff")
        .insert({ user_id: created.user.id, name, email });
      if (insertError) {
        // Roll back the auth user so the email is not left reserved.
        await supabase.auth.admin.deleteUser(created.user.id);
        return json({ error: `Failed to save staff profile: ${insertError.message}` }, 500);
      }

      return json({ success: true, user_id: created.user.id });
    }

    if (action === "set_password") {
      const userId = String(body.user_id ?? "");
      const password = String(body.password ?? "");
      if (!userId || password.length < 6) {
        return json({ error: "user_id and a password of at least 6 characters are required" }, 400);
      }
      if (!(await assertStaff(userId))) return json({ error: "Not an event staff login" }, 404);

      const { error } = await supabase.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "delete") {
      const userId = String(body.user_id ?? "");
      if (!userId) return json({ error: "user_id is required" }, 400);
      if (!(await assertStaff(userId))) return json({ error: "Not an event staff login" }, 404);

      // event_staff + campaign_staff rows go with it via ON DELETE CASCADE.
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("manage-event-staff error:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
