import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import jsPDF from "https://esm.sh/jspdf@2.5.2";
import QRCode from "https://esm.sh/qrcode@1.5.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Default values (used when system_settings row is missing)
// ---------------------------------------------------------------------------

const DEFAULT_BRANDING = {
  companyName: "RACC Agency",
  logoUrl: null as string | null,
  logoWidth: 20,
};

const DEFAULT_TEMPLATE = {
  panelColor: "#0f172a",
  panelTextColor: "#ffffff",
  accentColor: "#daa520",
  fontFamily: "helvetica",
  titleFontSize: 14,
  bodyFontSize: 9,
  subtitle: "Event Invitation",
  instructionText: "Present this card at the event for check-in",
  visibleElements: [
    "logo",
    "subtitle",
    "date",
    "campaign",
    "venue",
    "qr",
    "invitee",
    "instruction",
    "reference",
  ],
  qrColor: "#0f172a",
  qrSize: 25,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

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

function formatShortTime(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

// ---------------------------------------------------------------------------
// QR code generation (data URL)
// ---------------------------------------------------------------------------

async function generateQrDataUrl(
  text: string,
  color: string
): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 200,
    margin: 1,
    color: { dark: color, light: "#ffffff" },
  });
}

// ---------------------------------------------------------------------------
// PDF generation — mirrors pdfGenerator.ts drawInvitationCard
// ---------------------------------------------------------------------------

interface CardData {
  inviteeName: string;
  campaignName: string;
  venue: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  uniqueToken: string;
  registrationId: string;
}

interface CardTemplate {
  panelColor: string;
  panelTextColor: string;
  accentColor: string;
  fontFamily: string;
  titleFontSize: number;
  bodyFontSize: number;
  subtitle: string;
  instructionText: string;
  visibleElements: string[];
  qrColor: string;
  qrSize: number;
}

interface CompanyBranding {
  companyName: string;
  logoUrl: string | null;
  logoWidth: number;
}

async function generateInvitationPdf(
  data: CardData,
  template: CardTemplate,
  branding: CompanyBranding
): Promise<string> {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [148, 105],
  });

  const pageW = 148;
  const pageH = 105;
  const leftW = 40;

  // Always use helvetica (built-in, no custom font loading in Deno)
  const fontFamily = "helvetica";

  const slotDate = new Date(data.slotDate);
  const dayNum = slotDate.getDate().toString();
  const monthYear =
    slotDate.toLocaleString("en", { month: "short" }).toUpperCase() +
    " " +
    slotDate.getFullYear();

  // --- Page background ---
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageW, pageH, "F");

  // --- Left Panel ---
  const panelColor = hexToRgb(template.panelColor);
  doc.setFillColor(panelColor.r, panelColor.g, panelColor.b);
  doc.rect(0, 0, leftW, pageH, "F");

  // Logo loading skipped in Deno (no FileReader); treat as no logo
  const hasLogo = false;

  // Company name label (accent color)
  const accent = hexToRgb(template.accentColor);
  doc.setTextColor(accent.r, accent.g, accent.b);
  doc.setFontSize(7);
  doc.setFont(fontFamily, "bold");
  doc.text(branding.companyName.toUpperCase(), leftW / 2, hasLogo ? 18 : 12, {
    align: "center",
  });

  // Subtitle
  if (template.visibleElements.includes("subtitle")) {
    const panelText = hexToRgb(template.panelTextColor);
    doc.setTextColor(panelText.r, panelText.g, panelText.b);
    doc.setFontSize(6);
    doc.setFont(fontFamily, "normal");
    doc.text(template.subtitle, leftW / 2, hasLogo ? 24 : 18, {
      align: "center",
    });
  }

  // Date display
  if (template.visibleElements.includes("date")) {
    const panelText = hexToRgb(template.panelTextColor);
    doc.setTextColor(panelText.r, panelText.g, panelText.b);
    doc.setFontSize(22);
    doc.setFont(fontFamily, "bold");
    doc.text(dayNum, leftW / 2, 55, { align: "center" });

    doc.setFontSize(9);
    doc.setFont(fontFamily, "bold");
    doc.text(monthYear, leftW / 2, 63, { align: "center" });

    doc.setFontSize(8);
    doc.setFont(fontFamily, "normal");
    doc.text(`${data.startTime} - ${data.endTime}`, leftW / 2, 70, {
      align: "center",
    });
  }

  // --- Right Panel ---
  const rightX = leftW + 5;
  const rightW = pageW - leftW - 10;

  // Campaign name
  if (template.visibleElements.includes("campaign")) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(template.titleFontSize);
    doc.setFont(fontFamily, "bold");
    const campLines = doc.splitTextToSize(data.campaignName, rightW - 30);
    doc.text(campLines, rightX, 15);
  }
  const nameLines = doc.splitTextToSize(data.campaignName, rightW - 30);
  const nameEndY = 15 + nameLines.length * 6;

  // Venue
  if (template.visibleElements.includes("venue")) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(template.bodyFontSize);
    doc.setFont(fontFamily, "normal");
    doc.text(data.venue, rightX, nameEndY + 4);
  }

  // --- QR Code ---
  if (template.visibleElements.includes("qr")) {
    const qrX = pageW - template.qrSize - 5;
    const qrY = 5;
    try {
      const qrDataUrl = await generateQrDataUrl(
        `CHECKIN:${data.registrationId}`,
        template.qrColor
      );
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, template.qrSize, template.qrSize);
    } catch {
      doc.setDrawColor(200, 200, 200);
      doc.rect(qrX, qrY, template.qrSize, template.qrSize, "S");
      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      doc.text("QR", qrX + template.qrSize / 2, qrY + template.qrSize / 2, {
        align: "center",
      });
    }

    doc.setTextColor(148, 163, 184);
    doc.setFontSize(5);
    doc.text(
      "Scan for check-in",
      qrX + template.qrSize / 2,
      qrY + template.qrSize + 3,
      { align: "center" }
    );
  }

  // Dashed divider
  const dividerY = nameEndY + 10;
  doc.setDrawColor(226, 232, 240);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(rightX, dividerY, rightX + rightW, dividerY);
  doc.setLineDashPattern([], 0);

  // Invitee section
  if (template.visibleElements.includes("invitee")) {
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.text("INVITEE", rightX, dividerY + 7);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.setFont(fontFamily, "bold");
    doc.text(data.inviteeName, rightX, dividerY + 14);
  }

  // Instruction text
  if (template.visibleElements.includes("instruction")) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont(fontFamily, "normal");
    doc.text(template.instructionText, rightX, dividerY + 24);
  }

  // Token reference (bottom right)
  if (template.visibleElements.includes("reference")) {
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(6);
    doc.text(`Ref: ${data.uniqueToken}`, pageW - 5, pageH - 5, {
      align: "right",
    });
  }

  // Extract raw base64 (strip data URI prefix)
  const dataUri: string = doc.output("datauristring");
  const base64 = dataUri.split(",")[1];
  return base64;
}

// ---------------------------------------------------------------------------
// HTML email template
// ---------------------------------------------------------------------------

function buildEmailHtml(
  inviteeName: string,
  campaignName: string,
  venue: string,
  startAt: string,
  endAt: string,
  companyName: string
): string {
  const formattedDate = formatDate(startAt);
  const formattedStartTime = formatTime(startAt);
  const formattedEndTime = formatTime(endAt);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #334155; background: #f8fafc;">
  <!-- Header bar -->
  <div style="background: linear-gradient(135deg, #0F172A, #0369A1); border-radius: 12px 12px 0 0; padding: 24px 32px;">
    <h1 style="margin: 0 0 4px 0; color: #DAA520; font-size: 18px;">${companyName}</h1>
    <p style="margin: 0; color: #94A3B8; font-size: 13px;">${formattedDate} &middot; ${formattedStartTime} &ndash; ${formattedEndTime}</p>
  </div>

  <!-- Content area -->
  <div style="background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
    <h2 style="margin: 0 0 8px 0; color: #0f172a; font-size: 20px;">${campaignName}</h2>
    <p style="margin: 0 0 20px 0; color: #64748b; font-size: 14px;">${venue}</p>

    <p style="margin: 0 0 4px 0; color: #64748b; font-size: 13px;">Dear</p>
    <p style="margin: 0 0 20px 0; color: #0f172a; font-size: 16px; font-weight: 600;">${inviteeName}</p>

    <p style="margin: 0 0 20px 0; color: #334155; font-size: 14px; line-height: 1.6;">
      You have been invited to the above event. Please find your invitation card attached as a PDF.
      Present it at the venue for check-in.
    </p>

    <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 0 0 20px 0;">
      <p style="margin: 0; color: #64748b; font-size: 13px;">
        &#128206; <strong>invitation-card.pdf</strong> is attached to this email.
      </p>
    </div>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
    <p style="margin: 0; color: #94a3b8; font-size: 12px; text-align: center;">
      This is an automated invitation from ${companyName}. Please do not reply to this email.
    </p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Parse request body
    const { registration_id, link_code } = await req.json();

    if (!registration_id) {
      return new Response(
        JSON.stringify({ sent: false, error: "registration_id is required" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Set up Supabase client (service role — bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Fetch registration
    const { data: registration, error: regError } = await supabase
      .from("registrations")
      .select("id, invitee_name, invitee_email, agent_id, slot_id, agent_link_id")
      .eq("id", registration_id)
      .single();

    if (regError || !registration) {
      console.error("Registration not found:", regError);
      return new Response(
        JSON.stringify({ sent: false, error: "Registration not found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!registration.invitee_email) {
      console.log("No email for registration:", registration_id);
      return new Response(
        JSON.stringify({ sent: false, error: "No email address on registration" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 4. Fetch agent — check is_auto_invite
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, is_auto_invite")
      .eq("id", registration.agent_id)
      .single();

    if (agentError || !agent) {
      console.error("Agent not found:", agentError);
      return new Response(
        JSON.stringify({ sent: false, error: "Agent not found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!agent.is_auto_invite) {
      console.log("Agent has auto-invite disabled:", agent.id);
      return new Response(
        JSON.stringify({ sent: false, error: "Auto-invite disabled for this agent" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 5. Fetch slot + campaign
    const { data: slot, error: slotError } = await supabase
      .from("slots")
      .select("id, start_at, end_at, campaign:campaigns(id, name, venue)")
      .eq("id", registration.slot_id)
      .single();

    if (slotError || !slot) {
      console.error("Slot not found:", slotError);
      return new Response(
        JSON.stringify({ sent: false, error: "Slot not found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const campaign = (slot as any).campaign;

    // 6. Fetch system_settings for branding + template
    const { data: settings } = await supabase
      .from("system_settings")
      .select("company_branding, card_template")
      .limit(1)
      .single();

    const branding: CompanyBranding = settings?.company_branding
      ? { ...DEFAULT_BRANDING, ...settings.company_branding }
      : { ...DEFAULT_BRANDING };

    const template: CardTemplate = settings?.card_template
      ? { ...DEFAULT_TEMPLATE, ...settings.card_template }
      : { ...DEFAULT_TEMPLATE };

    // 7. Resolve link_code for the reference token display
    const tokenRef = link_code
      ? String(link_code).slice(0, 8)
      : registration_id.slice(0, 8);

    // 8. Build PDF invitation card
    const startAt = slot.start_at as string;
    const endAt = slot.end_at as string;

    const cardData: CardData = {
      inviteeName: registration.invitee_name || "Guest",
      campaignName: campaign.name,
      venue: campaign.venue,
      slotDate: startAt,
      startTime: formatShortTime(startAt),
      endTime: formatShortTime(endAt),
      uniqueToken: tokenRef,
      registrationId: registration_id,
    };

    let pdfBase64: string;
    try {
      pdfBase64 = await generateInvitationPdf(cardData, template, branding);
    } catch (pdfErr) {
      console.error("PDF generation failed:", pdfErr);
      return new Response(
        JSON.stringify({ sent: false, error: "PDF generation failed" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 9. Build HTML email body
    const htmlBody = buildEmailHtml(
      registration.invitee_name || "Guest",
      campaign.name,
      campaign.venue,
      startAt,
      endAt,
      branding.companyName
    );

    // 10. Send via Resend API
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY not set");
      return new Response(
        JSON.stringify({ sent: false, error: "Email service not configured" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const subject = `Your Invitation: ${campaign.name} — ${formatDate(startAt)}`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Invitation <invitation@raccagency.com>",
        to: registration.invitee_email,
        subject,
        html: htmlBody,
        attachments: [
          {
            filename: "invitation-card.pdf",
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text();
      console.error("Resend API error:", resendResponse.status, errorBody);
      return new Response(
        JSON.stringify({ sent: false, error: "Email delivery failed" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Invitation email sent to:", registration.invitee_email);
    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-invitation-email error:", error);
    return new Response(
      JSON.stringify({ sent: false, error: "Internal server error" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
