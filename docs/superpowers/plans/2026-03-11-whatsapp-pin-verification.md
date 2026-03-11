# WhatsApp PIN Verification (Checkout Only) — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-step checkout with a 2-step flow where attendees enter NRIC first, receive their PIN via WhatsApp, then enter it to complete checkout.

**Architecture:** Supabase Edge Function orchestrates PIN lookup and WhatsApp delivery with an abstracted service layer (mock until OneWaySMS credentials arrive). Rate limiting via `whatsapp_send_log` table. CheckOut.tsx rewritten to 2-step flow.

**Tech Stack:** Supabase Edge Functions (Deno 2), React 18, react-hook-form, zod, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-11-whatsapp-pin-verification-design.md`

---

## Chunk 1: Database & Edge Function

### Task 1: Create whatsapp_send_log migration

**Files:**
- Create: `supabase/migrations/20260311000002_whatsapp_send_log.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260311000002_whatsapp_send_log.sql`:

```sql
-- WhatsApp send log for rate limiting PIN delivery
CREATE TABLE whatsapp_send_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  nric TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_send_log_lookup ON whatsapp_send_log(slot_id, nric, sent_at);

-- RLS
ALTER TABLE whatsapp_send_log ENABLE ROW LEVEL SECURITY;

-- Edge Functions run with service_role key, so no RLS policy needed for them.
-- Admin can read for monitoring.
CREATE POLICY "admin_read_whatsapp_send_log" ON whatsapp_send_log
  FOR SELECT USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );
```

- [ ] **Step 2: Apply migration locally**

```bash
cd /Users/paullee/Documents/project/martin/DATA
npx supabase db reset
```

Expected: Migration applies successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260311000002_whatsapp_send_log.sql
git commit -m "feat(db): add whatsapp_send_log table for rate limiting"
```

---

### Task 2: Create send-whatsapp-pin Edge Function

**Files:**
- Create: `supabase/functions/send-whatsapp-pin/whatsapp-service.ts`
- Create: `supabase/functions/send-whatsapp-pin/index.ts`

- [ ] **Step 1: Create the Edge Function directory**

```bash
mkdir -p /Users/paullee/Documents/project/martin/DATA/supabase/functions/send-whatsapp-pin
```

- [ ] **Step 2: Create the WhatsApp service layer**

Create `supabase/functions/send-whatsapp-pin/whatsapp-service.ts`:

```typescript
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
```

- [ ] **Step 3: Create the Edge Function**

Create `supabase/functions/send-whatsapp-pin/index.ts`:

```typescript
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
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-whatsapp-pin/
git commit -m "feat(edge-fn): add send-whatsapp-pin with abstracted service layer"
```

---

## Chunk 2: Checkout Page Rewrite

### Task 3: Rewrite CheckOut.tsx to 2-step flow

**Files:**
- Modify: `apps/public-pages/src/pages/CheckOut.tsx`

This is a full rewrite. The current CheckOut.tsx (225 lines) has a single form with PIN + NRIC. The new version has two steps: NRIC entry → PIN delivery via WhatsApp → PIN entry.

- [ ] **Step 1: Rewrite CheckOut.tsx**

Replace the entire content of `apps/public-pages/src/pages/CheckOut.tsx`:

```tsx
import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@agent-system/shared-ui';
import { CheckCircle, LogOut, MessageSquare, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { InvitationStatus } from '@agent-system/shared-types';

// Step 1: NRIC schema
const nricSchema = z.object({
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
});

// Step 2: PIN schema
const pinSchema = z.object({
  pin_code: z.string().length(6, 'PIN code must be 6 digits'),
});

type NricFormData = z.infer<typeof nricSchema>;
type PinFormData = z.infer<typeof pinSchema>;

export function CheckOut() {
  const search = useSearch({ strict: false }) as { slot?: string };
  const slotId = search.slot;

  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [nric, setNric] = useState('');
  const [sendCount, setSendCount] = useState(0);

  const nricForm = useForm<NricFormData>({
    resolver: zodResolver(nricSchema),
    defaultValues: { nric: '' },
  });

  const pinForm = useForm<PinFormData>({
    resolver: zodResolver(pinSchema),
    defaultValues: { pin_code: '' },
  });

  // Step 1: Send PIN via WhatsApp
  const handleSendPin = async (formData: NricFormData) => {
    setIsSending(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-whatsapp-pin', {
        body: { slot_id: slotId, nric: formData.nric },
      });

      if (fnError) {
        // supabase.functions.invoke returns the response body in fnError.context when non-2xx
        const errorBody = typeof fnError.context === 'object' ? fnError.context : null;
        setError(errorBody?.error || fnError.message || 'Failed to send PIN. Please try again.');
        setIsSending(false);
        return;
      }

      if (!data?.success) {
        setError(data?.error || 'Failed to send PIN. Please try again.');
        setIsSending(false);
        return;
      }

      setNric(formData.nric);
      setMaskedPhone(data.masked_phone);
      setSendCount((prev) => prev + 1);
      setStep(2);
    } catch {
      setError('Failed to connect to server. Please try again.');
    }
    setIsSending(false);
  };

  // Resend PIN
  const handleResendPin = async () => {
    if (sendCount >= 3) return;
    setIsSending(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-whatsapp-pin', {
        body: { slot_id: slotId, nric },
      });

      if (fnError) {
        const errorBody = typeof fnError.context === 'object' ? fnError.context : null;
        setError(errorBody?.error || fnError.message || 'Failed to resend PIN.');
        setIsSending(false);
        return;
      }

      if (!data?.success) {
        setError(data?.error || 'Failed to resend PIN.');
        setIsSending(false);
        return;
      }

      setSendCount((prev) => prev + 1);
      setMaskedPhone(data.masked_phone);
    } catch {
      setError('Failed to connect to server.');
    }
    setIsSending(false);
  };

  // Step 2: Complete checkout with PIN
  const handleCheckout = async (formData: PinFormData) => {
    setIsSubmitting(true);
    setError(null);

    // 1. Find the PIN code
    const { data: pinCode, error: pinError } = await supabase
      .from('pin_codes')
      .select('id, slot_id, linked_nric')
      .eq('code', formData.pin_code)
      .eq('slot_id', slotId)
      .single();

    if (pinError || !pinCode) {
      setError('Invalid PIN code for this slot');
      setIsSubmitting(false);
      return;
    }

    // 2. Verify PIN is linked to this NRIC
    if (pinCode.linked_nric !== nric) {
      setError('This PIN code is not associated with this NRIC');
      setIsSubmitting(false);
      return;
    }

    // 3. Find the invitation
    const { data: invitation, error: invError } = await supabase
      .from('invitations')
      .select('id, invitee_name, status')
      .eq('invitee_nric', nric)
      .eq('slot_id', slotId)
      .eq('status', InvitationStatus.ATTENDED)
      .single();

    if (invError || !invitation) {
      setError('No check-in record found. Please check in first.');
      setIsSubmitting(false);
      return;
    }

    // 4. Find attendance record
    const { data: attendance, error: attError } = await supabase
      .from('attendance')
      .select('id, checkout_time')
      .eq('invitation_id', invitation.id)
      .single();

    if (attError || !attendance) {
      setError('No attendance record found. Please check in first.');
      setIsSubmitting(false);
      return;
    }

    if (attendance.checkout_time) {
      setError('You have already checked out');
      setIsSubmitting(false);
      return;
    }

    // 5. Update attendance record
    const { error: updateError } = await supabase
      .from('attendance')
      .update({
        checkout_time: new Date().toISOString(),
        is_full_attendance: true,
      })
      .eq('id', attendance.id);

    if (updateError) {
      setError('Failed to record check-out. Please try again.');
      setIsSubmitting(false);
      return;
    }

    // 6. Update invitation status to completed
    await supabase
      .from('invitations')
      .update({ status: InvitationStatus.COMPLETED })
      .eq('id', invitation.id);

    setAttendeeName(invitation.invitee_name);
    setIsSuccess(true);
    setIsSubmitting(false);
  };

  // Success screen
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-10 text-center space-y-6">
            <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="h-10 w-10 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-emerald-600">Check-Out Successful!</h2>
              <p className="text-xl font-semibold text-slate-900 mt-2">{attendeeName}</p>
            </div>
            <p className="text-slate-500">
              Thank you for attending! Your full attendance has been recorded.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
      <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <LogOut className="h-7 w-7 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900">Event Check-Out</CardTitle>
          <CardDescription className="text-slate-500">
            {step === 1
              ? 'Enter your NRIC to receive your PIN via WhatsApp'
              : 'Enter the PIN sent to your WhatsApp'}
          </CardDescription>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= 1 ? 'text-violet-600' : 'text-slate-400'}`}>
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-white text-xs ${step >= 1 ? 'bg-violet-600' : 'bg-slate-300'}`}>
                {step > 1 ? <CheckCircle className="h-4 w-4" /> : '1'}
              </div>
              NRIC
            </div>
            <div className="w-8 h-px bg-slate-300" />
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= 2 ? 'text-violet-600' : 'text-slate-400'}`}>
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-white text-xs ${step >= 2 ? 'bg-violet-600' : 'bg-slate-300'}`}>
                2
              </div>
              PIN
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-6 pb-8">
          {error && (
            <div className="p-3 mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          {step === 1 ? (
            <Form {...nricForm}>
              <form onSubmit={nricForm.handleSubmit(handleSendPin)} className="space-y-4">
                <FormField
                  control={nricForm.control}
                  name="nric"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-700">NRIC Number</FormLabel>
                      <FormControl>
                        <Input placeholder="S1234567A" className="h-11" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <p className="text-xs text-slate-500">
                  Your PIN code will be sent to the WhatsApp number you registered with.
                </p>

                <Button
                  type="submit"
                  className="w-full h-11 bg-violet-600 hover:bg-violet-700 text-white font-medium mt-2"
                  disabled={isSending}
                >
                  {isSending ? (
                    'Sending...'
                  ) : (
                    <>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Send PIN to WhatsApp
                    </>
                  )}
                </Button>
              </form>
            </Form>
          ) : (
            <>
              {/* WhatsApp confirmation banner */}
              <div className="p-3 mb-4 text-sm bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-emerald-700">PIN sent to WhatsApp</p>
                  <p className="text-emerald-600">{maskedPhone}</p>
                </div>
              </div>

              <Form {...pinForm}>
                <form onSubmit={pinForm.handleSubmit(handleCheckout)} className="space-y-4">
                  <FormField
                    control={pinForm.control}
                    name="pin_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700">PIN Code</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="123456"
                            maxLength={6}
                            className="text-center text-2xl tracking-widest font-mono h-14 bg-slate-50 border-slate-200"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-medium"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      'Checking out...'
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Complete Check Out
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-sm text-slate-500"
                    disabled={isSending || sendCount >= 3}
                    onClick={handleResendPin}
                  >
                    {isSending
                      ? 'Sending...'
                      : sendCount >= 3
                        ? 'Maximum attempts reached'
                        : `Resend PIN (${3 - sendCount} remaining)`}
                  </Button>
                </form>
              </Form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
cd /Users/paullee/Documents/project/martin/DATA
pnpm --filter public-pages build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual test**

```bash
pnpm dev:public
```

1. Navigate to a checkout page (e.g., `http://localhost:3002/public/checkout?slot={slotId}`)
2. Verify Step 1: NRIC input field with step indicator (1 of 2)
3. Verify "Send PIN to WhatsApp" button
4. Enter NRIC of an attendee who has checked in → clicks send
5. Verify transition to Step 2: green confirmation banner with masked phone
6. Verify PIN input field and "Complete Check Out" button
7. Verify "Resend PIN" button shows remaining attempts
8. Enter correct PIN → checkout completes successfully
9. Verify success screen with attendee name

- [ ] **Step 4: Commit**

```bash
git add apps/public-pages/src/pages/CheckOut.tsx
git commit -m "feat(public-pages): rewrite checkout to 2-step WhatsApp PIN flow"
```

---

### Task 4: Set environment variables and deploy

- [ ] **Step 1: Set WhatsApp provider to mock locally**

```bash
cd /Users/paullee/Documents/project/martin/DATA
echo "WHATSAPP_PROVIDER=mock" >> supabase/.env
```

- [ ] **Step 2: Set secrets in production**

```bash
npx supabase secrets set WHATSAPP_PROVIDER=mock --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 3: Deploy Edge Function to production**

```bash
npx supabase functions deploy send-whatsapp-pin --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 4: Apply migration to production**

```bash
npx supabase db push --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 5: Commit any remaining changes and push**

```bash
git add -A
git commit -m "feat: WhatsApp PIN verification - environment setup"
git push origin main
```
