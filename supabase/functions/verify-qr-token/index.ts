import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALIDITY_WINDOW_SECONDS = 90;

async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { slot_id, mode, ts, sig } = await req.json();

    if (!slot_id || !mode || !ts || !sig) {
      return new Response(
        JSON.stringify({ valid: false, error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const secret = Deno.env.get("QR_HMAC_SECRET");
    if (!secret) {
      return new Response(
        JSON.stringify({ valid: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify HMAC
    const message = `${slot_id}:${mode}:${ts}`;
    const expectedSig = await hmacSign(secret, message);

    if (sig !== expectedSig) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid QR code" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify timestamp within window
    const now = Math.floor(Date.now() / 1000);
    const tokenTime = parseInt(ts, 10);
    const age = now - tokenTime;

    if (age > VALIDITY_WINDOW_SECONDS || age < -10) {
      return new Response(
        JSON.stringify({ valid: false, error: "QR code expired. Please scan the current code at the venue." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ valid: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ valid: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
