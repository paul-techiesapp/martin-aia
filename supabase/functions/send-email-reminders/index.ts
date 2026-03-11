import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatDate(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  return date.toLocaleDateString("en-SG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  return date.toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildEmailHtml(
  inviteeName: string,
  campaignName: string,
  venue: string,
  startAt: string,
  endAt: string
): string {
  const formattedDate = formatDate(startAt);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #334155;">
  <div style="background: #f8fafc; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
    <h2 style="margin: 0 0 24px 0; color: #0f172a;">Event Reminder</h2>
    <p style="margin: 0 0 16px 0;">Hi ${inviteeName},</p>
    <p style="margin: 0 0 20px 0;">This is a reminder for your upcoming event:</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin: 0 0 20px 0;">
      <h3 style="margin: 0 0 12px 0; color: #0f172a;">${campaignName}</h3>
      <table style="width: 100%; font-size: 14px;">
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Venue</td><td style="color: #334155;">${venue}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Date</td><td style="color: #334155;">${formattedDate}</td></tr>
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Time</td><td style="color: #334155;">${formatTime(startAt)} – ${formatTime(endAt)}</td></tr>
      </table>
    </div>
    <p style="margin: 0;">Please arrive on time. We look forward to seeing you!</p>
  </div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin role from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the caller is admin using their JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!
    ).auth.getUser(token);

    if (authError || !user || user.user_metadata?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { slot_id } = await req.json();

    if (!slot_id) {
      return new Response(
        JSON.stringify({ error: "slot_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch slot + campaign
    const { data: slot, error: slotError } = await supabase
      .from("slots")
      .select("id, start_at, end_at, campaign:campaigns(name, venue, end_date)")
      .eq("id", slot_id)
      .single();

    if (slotError || !slot) {
      return new Response(
        JSON.stringify({ error: "Slot not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const campaign = (slot as any).campaign;

    // Check if campaign has ended
    if (new Date(campaign.end_date) < new Date()) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, message: "Campaign has ended" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch registered invitees with email
    const { data: invitations, error: invError } = await supabase
      .from("invitations")
      .select("invitee_name, invitee_email")
      .eq("slot_id", slot_id)
      .eq("status", "registered")
      .not("invitee_email", "is", null);

    if (invError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch invitees" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recipients = (invitations || []).filter((i) => i.invitee_email);

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, message: "No eligible recipients" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subject = `Reminder: ${campaign.name} — ${formatDate(slot.start_at)}`;
    let sent = 0;
    let failed = 0;

    // Resend batch API supports up to 100 per call
    for (let i = 0; i < recipients.length; i += 100) {
      const batch = recipients.slice(i, i + 100);

      const emails = batch.map((r) => ({
        from: "Event Reminders <onboarding@resend.dev>",
        to: r.invitee_email,
        subject,
        html: buildEmailHtml(
          r.invitee_name || "Attendee",
          campaign.name,
          campaign.venue,
          slot.start_at,
          slot.end_at
        ),
      }));

      try {
        const response = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(emails),
        });

        if (response.ok) {
          sent += batch.length;
        } else {
          const errorBody = await response.text();
          console.error(`Resend batch error: ${errorBody}`);
          failed += batch.length;
        }
      } catch (err) {
        console.error("Resend fetch error:", err);
        failed += batch.length;
      }
    }

    return new Response(
      JSON.stringify({ sent, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("send-email-reminders error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
