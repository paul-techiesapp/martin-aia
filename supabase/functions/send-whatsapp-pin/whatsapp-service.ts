export interface WhatsAppService {
  sendMessage(phone: string, message: string): Promise<{ success: boolean }>;
}

export class MockWhatsAppService implements WhatsAppService {
  async sendMessage(phone: string, message: string): Promise<{ success: boolean }> {
    console.log(`[MockWhatsApp] To: ${phone}`);
    console.log(`[MockWhatsApp] Message: ${message}`);
    return { success: true };
  }
}

export class OneWaySmsService implements WhatsAppService {
  private apiKey: string;
  private apiSecret: string;
  private senderId: string;

  constructor(apiKey: string, apiSecret: string, senderId?: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.senderId = senderId || "";
  }

  async sendMessage(phone: string, message: string): Promise<{ success: boolean }> {
    // OneWaySMS API integration — to be completed when credentials arrive
    const url = "https://gateway.onewaysms.com/api/v2/send";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        senderId: this.senderId,
        recipient: phone,
        message,
        messageType: "whatsapp",
      }),
    });

    if (!response.ok) {
      console.error(`[OneWaySMS] Failed: ${response.status}`);
      return { success: false };
    }

    return { success: true };
  }
}

export function createWhatsAppService(): WhatsAppService {
  const provider = Deno.env.get("WHATSAPP_PROVIDER") || "mock";

  if (provider === "onewaysms") {
    const apiKey = Deno.env.get("ONEWAYSMS_API_KEY") || "";
    const apiSecret = Deno.env.get("ONEWAYSMS_API_SECRET") || "";
    const senderId = Deno.env.get("ONEWAYSMS_SENDER_ID");
    return new OneWaySmsService(apiKey, apiSecret, senderId);
  }

  return new MockWhatsAppService();
}
