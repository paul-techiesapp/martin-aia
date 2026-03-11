import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createWhatsAppService } from "./whatsapp-service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  const prefix = phone.startsWith("+") ? phone.slice(0, phone.indexOf(" ") > 0 ? phone.indexOf(" ") + 1 : 3) : "+";
  return `${prefix} •••• ${last4}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { slot_id, nric } = await req.json();

    if (!slot_id || !nric) {
      return new Response(
        JSON.stringify({ error: "slot_id and nric are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Check rate limit: max 3 sends per NRIC per slot per hour
    const { count: sendCount } = await supabase
      .from("whatsapp_send_log")
      .select("id", { count: "exact", head: true })
      .eq("slot_id", slot_id)
      .eq("nric", nric)
      .gte("sent_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    if ((sendCount ?? 0) >= 3) {
      return new Response(
        JSON.stringify({ error: "Too many attempts, please wait" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Find the slot to get its campaign_id
    const { data: slot, error: slotError } = await supabase
      .from("slots")
      .select("id, campaign_id")
      .eq("id", slot_id)
      .single();

    if (slotError || !slot) {
      return new Response(
        JSON.stringify({ error: "Slot not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Find invitation by NRIC + slot_id with ATTENDED status
    const { data: invitation, error: invError } = await supabase
      .from("invitations")
      .select("id, invitee_phone")
      .eq("invitee_nric", nric)
      .eq("slot_id", slot_id)
      .eq("status", "attended")
      .single();

    if (invError || !invitation) {
      return new Response(
        JSON.stringify({ error: "No check-in record found for this NRIC" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Validate phone number exists
    if (!invitation.invitee_phone) {
      return new Response(
        JSON.stringify({ error: "No phone number registered" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Find linked PIN code
    const { data: pinCode, error: pinError } = await supabase
      .from("pin_codes")
      .select("code")
      .eq("linked_nric", nric)
      .eq("slot_id", slot_id)
      .single();

    if (pinError || !pinCode) {
      return new Response(
        JSON.stringify({ error: "No PIN linked to this NRIC" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Send WhatsApp message
    const whatsapp = createWhatsAppService();
    const message = `Your checkout PIN is: ${pinCode.code}. Enter this on the checkout page to complete your check-out.`;
    const result = await whatsapp.sendMessage(invitation.invitee_phone, message);

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: "Failed to send, please try again" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Log the send for rate limiting
    await supabase.from("whatsapp_send_log").insert({
      slot_id,
      nric,
    });

    // 8. Return success with masked phone
    return new Response(
      JSON.stringify({
        success: true,
        masked_phone: maskPhone(invitation.invitee_phone),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("send-whatsapp-pin error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
