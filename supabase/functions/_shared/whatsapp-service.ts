// supabase/functions/_shared/whatsapp-service.ts
import { normalizePhone } from './phone-utils.ts';

export interface SendResult {
  success: boolean;
  mt_id?: string;
  error_code?: number;
  error_message?: string;
}

interface WhatsAppService {
  sendOtp(phone: string, code: string): Promise<SendResult>;
}

class MockWhatsAppService implements WhatsAppService {
  async sendOtp(phone: string, code: string): Promise<SendResult> {
    console.log(`[MOCK WhatsApp] OTP ${code} → ${phone}`);
    return { success: true, mt_id: 'mock-' + Date.now() };
  }
}

class OneWaySmsService implements WhatsAppService {
  private apiUsername: string;
  private apiPassword: string;
  private templateId: string;

  constructor() {
    this.apiUsername = Deno.env.get('ONEWAYSMS_API_USERNAME') || '';
    this.apiPassword = Deno.env.get('ONEWAYSMS_API_PASSWORD') || '';
    this.templateId = Deno.env.get('ONEWAYSMS_TEMPLATE_ID') || '2502';
  }

  async sendOtp(phone: string, code: string): Promise<SendResult> {
    const normalized = normalizePhone(phone);
    const message = `*T${this.templateId}|${code}`;

    const url = new URL('https://wba-api.onewaysms.com/api.aspx');
    url.searchParams.set('apiusername', this.apiUsername);
    url.searchParams.set('apipassword', this.apiPassword);
    url.searchParams.set('mobile', normalized);
    url.searchParams.set('message', message);

    const response = await fetch(url.toString());

    if (response.status !== 200) {
      return {
        success: false,
        error_code: response.status,
        error_message: `HTTP ${response.status}`,
      };
    }

    const body = await response.text();
    const resultCode = parseInt(body.trim(), 10);

    if (resultCode > 0) {
      return { success: true, mt_id: body.trim() };
    }

    const errorMessages: Record<number, string> = {
      [-1]: 'Invalid API credentials',
      [-2]: 'Empty mobile number',
      [-3]: 'Empty message',
      [-4]: 'Invalid flow (24h window expired)',
      [-5]: 'Invalid template',
      [-6]: 'Template parameter mismatch',
      [-7]: 'IP not whitelisted',
    };

    return {
      success: false,
      error_code: resultCode,
      error_message: errorMessages[resultCode] || `Unknown error: ${resultCode}`,
    };
  }
}

export function createWhatsAppService(): WhatsAppService {
  const provider = Deno.env.get('WHATSAPP_PROVIDER') || 'mock';
  if (provider === 'onewaysms') {
    return new OneWaySmsService();
  }
  return new MockWhatsAppService();
}
