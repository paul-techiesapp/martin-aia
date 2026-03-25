# Check-In / Check-Out Flow Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the attendance cycle to admin-only check-in via QR scanner, dual-identifier customer checkout with OTP, and manual checkout QR activation.

**Architecture:** Minimal surgery approach — modify 5 existing files, delete 1 file, zero database migrations. Backend changes are limited to two Supabase Edge Functions. Frontend changes span the public-pages checkout form and admin-portal venue display.

**Tech Stack:** React 18, TypeScript, TanStack Router, Supabase Edge Functions (Deno), zod validation, QR code signing (HMAC)

**Spec:** `docs/superpowers/specs/2026-03-25-checkin-checkout-flow-redesign.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Delete | `apps/public-pages/src/pages/CheckIn.tsx` | Public self-check-in page (being removed) |
| Modify | `apps/public-pages/src/router.tsx` | Remove checkin route + import |
| Modify | `apps/admin-portal/src/pages/VenueDisplay.tsx` | Replace phase logic with manual checkout toggle |
| Modify | `supabase/functions/send-checkout-otp/index.ts` | Accept dual identifiers (nric + email/phone) |
| Modify | `supabase/functions/verify-checkout-otp/index.ts` | Accept dual identifiers (nric + email/phone) |
| Modify | `apps/public-pages/src/pages/CheckOut.tsx` | Dual-identifier form (NRIC always + email or phone) |

---

### Task 1: Remove Public CheckIn Page and Route

**Files:**
- Delete: `apps/public-pages/src/pages/CheckIn.tsx`
- Modify: `apps/public-pages/src/router.tsx:1-70`

- [ ] **Step 1: Remove CheckIn import from router**

In `apps/public-pages/src/router.tsx`, delete line 8:
```typescript
import { CheckIn } from './pages/CheckIn';
```

- [ ] **Step 2: Remove checkinRoute definition from router**

In `apps/public-pages/src/router.tsx`, delete lines 22-26:
```typescript
const checkinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/checkin',
  component: CheckIn,
});
```

- [ ] **Step 3: Remove checkinRoute from route tree**

In `apps/public-pages/src/router.tsx`, remove `checkinRoute,` from the `addChildren` array (line 58). The array should become:
```typescript
const routeTree = rootRoute.addChildren([
  indexRoute,
  registerRoute,
  checkoutRoute,
  displayRoute,
]);
```

- [ ] **Step 4: Delete CheckIn.tsx**

```bash
rm apps/public-pages/src/pages/CheckIn.tsx
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm --filter public-pages exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -A apps/public-pages/src/pages/CheckIn.tsx apps/public-pages/src/router.tsx
git commit -m "refactor: remove public self-check-in page

Check-in is now admin-only via QR scanner. The public CheckIn page
and /public/checkin route are no longer needed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Simplify VenueDisplay with Manual Checkout Toggle

**Files:**
- Modify: `apps/admin-portal/src/pages/VenueDisplay.tsx:1-147`

- [ ] **Step 1: Read current VenueDisplay.tsx**

Read the full file to confirm current state before editing.

- [ ] **Step 2: Rewrite VenueDisplay.tsx**

Replace the entire file. The new version:
- Removes `SlotPhase` type, `getPhase()`, `getQrMode()`, all phase intervals
- Adds `isCheckoutActive` boolean state
- Shows event info always (campaign name, venue, time)
- Shows "Start Checkout" / "Stop Checkout" button
- QR generation only happens when checkout is active
- Keeps QR signing via `generate-qr-token` with 60s refresh
- Keeps static URL fallback

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';
import { format, parseISO } from 'date-fns';

interface SlotData {
  id: string;
  start_at: string;
  end_at: string;
  campaign: { name: string; venue: string };
}

const REFRESH_INTERVAL = 60;

export function VenueDisplay() {
  const { slotId } = useParams({ strict: false });
  const [slot, setSlot] = useState<SlotData | null>(null);
  const [isCheckoutActive, setIsCheckoutActive] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [error, setError] = useState<string | null>(null);

  const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || 'https://martin-public-pages.onrender.com';

  // Fetch slot data on mount
  useEffect(() => {
    if (!slotId) return;
    supabase
      .from('slots')
      .select('id, start_at, end_at, campaign:campaigns(name, venue)')
      .eq('id', slotId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Slot not found'); return; }
        setSlot(data as unknown as SlotData);
      });
  }, [slotId]);

  // Generate signed QR URL
  const generateQr = useCallback(async () => {
    if (!slot) return;

    try {
      const { data } = await supabase.functions.invoke('generate-qr-token', {
        body: { slot_id: slot.id, mode: 'checkout' },
      });
      if (data?.url) {
        setQrUrl(`${publicPagesUrl}${data.url}`);
        setCountdown(REFRESH_INTERVAL);
        return;
      }
    } catch {
      // Edge function unavailable — fall through to static URL
    }

    setQrUrl(`${publicPagesUrl}/public/checkout?slot=${slot.id}`);
    setCountdown(REFRESH_INTERVAL);
  }, [slot, publicPagesUrl]);

  // QR refresh interval — only runs when checkout is active
  useEffect(() => {
    if (!isCheckoutActive || !slot) return;
    generateQr();
    const interval = setInterval(generateQr, REFRESH_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, [isCheckoutActive, slot, generateQr]);

  // Countdown timer — only runs when checkout is active
  useEffect(() => {
    if (!isCheckoutActive) return;
    const interval = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? REFRESH_INTERVAL : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isCheckoutActive]);

  // Clear QR when checkout stops
  useEffect(() => {
    if (!isCheckoutActive) {
      setQrUrl('');
      setCountdown(REFRESH_INTERVAL);
    }
  }, [isCheckoutActive]);

  if (error) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-red-400">{error}</p></div>;
  if (!slot) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-slate-400">Loading...</p></div>;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-xs uppercase tracking-[3px] font-semibold" style={{ color: isCheckoutActive ? '#f59e0b' : '#64748b' }}>
        {isCheckoutActive ? 'CHECK OUT' : 'EVENT'}
      </div>
      <h1 className="text-2xl font-bold text-white mt-3">{slot.campaign.name}</h1>
      <p className="text-sm text-slate-500 mt-1">
        {slot.campaign.venue} &bull; {format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm')} – {format(parseISO(slot.end_at), 'HH:mm')}
      </p>

      {isCheckoutActive && qrUrl ? (
        <>
          <div className="mt-8 bg-white p-6 rounded-2xl">
            <QRCodeSVG value={qrUrl} size={280} />
          </div>
          <p className="text-slate-400 text-sm mt-6">Scan to check out</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full animate-pulse bg-amber-500" />
            <span className="text-sm text-slate-400">Refreshes in <strong className="text-white">{countdown}s</strong></span>
          </div>
          <button
            onClick={() => setIsCheckoutActive(false)}
            className="mt-6 px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            Stop Checkout
          </button>
        </>
      ) : (
        <button
          onClick={() => setIsCheckoutActive(true)}
          className="mt-16 px-8 py-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-lg transition-colors"
        >
          Start Checkout
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter admin-portal exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Manual verification**

Run `pnpm dev:admin`, navigate to a venue display page for an existing slot. Verify:
- Event info (name, venue, time) shows on load
- "Start Checkout" button visible
- Clicking it shows the QR code
- Countdown timer ticks
- "Stop Checkout" hides the QR

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/pages/VenueDisplay.tsx
git commit -m "refactor: replace VenueDisplay phase logic with manual checkout toggle

Remove all phase-based timing (getPhase, getQrMode, phase intervals).
Admin now manually clicks Start/Stop Checkout to show/hide the QR.
QR signing and 60s refresh interval preserved.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Update send-checkout-otp for Dual Identifiers

**Files:**
- Modify: `supabase/functions/send-checkout-otp/index.ts:22-46`

- [ ] **Step 1: Read current send-checkout-otp**

Read the full file to confirm current state.

- [ ] **Step 2: Update request parsing (line 22)**

Replace the destructuring and validation:

Old (lines 22-28):
```typescript
    const { slot_id, identifier } = await req.json();
    if (!slot_id || !identifier) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'slot_id and identifier are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
```

New:
```typescript
    const { slot_id, nric, identifier } = await req.json();
    if (!slot_id || !nric || !identifier) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'slot_id, nric, and identifier (email or phone) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
```

- [ ] **Step 3: Replace registration lookup (lines 30-46)**

Old (lines 30-46):
```typescript
    // 1. Look up registration by NRIC first, then phone
    let { data: registration } = await supabase
      .from('registrations')
      .select('id, status, invitee_phone, invitee_nric')
      .eq('slot_id', slot_id)
      .eq('invitee_nric', identifier)
      .single();

    if (!registration) {
      const result = await supabase
        .from('registrations')
        .select('id, status, invitee_phone, invitee_nric')
        .eq('slot_id', slot_id)
        .eq('invitee_phone', identifier)
        .single();
      registration = result.data;
    }
```

New:
```typescript
    // 1. Look up registration by NRIC
    const { data: registration } = await supabase
      .from('registrations')
      .select('id, status, invitee_phone, invitee_email')
      .eq('slot_id', slot_id)
      .eq('invitee_nric', nric)
      .single();
```

- [ ] **Step 4: Add identifier cross-check after the `registration_not_found` check (after line 53)**

Insert immediately after the `registration_not_found` response block:

```typescript
    // 1b. Cross-check second identifier (email or phone)
    const emailMatch = registration.invitee_email && registration.invitee_email.toLowerCase() === identifier.toLowerCase();
    const phoneMatch = registration.invitee_phone && registration.invitee_phone === identifier;
    if (!emailMatch && !phoneMatch) {
      return new Response(
        JSON.stringify({ error: 'identifier_mismatch', message: 'The email/phone does not match the registration for this NRIC.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
```

- [ ] **Step 5: Verify the file is syntactically valid**

```bash
cd supabase/functions/send-checkout-otp && deno check index.ts 2>&1 || echo "Deno check not available — review manually"
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-checkout-otp/index.ts
git commit -m "feat: update send-checkout-otp for dual-identifier checkout

Accept nric (required) + identifier (email or phone). Primary lookup
by NRIC, then cross-check second identifier matches registration.
New error: identifier_mismatch when email/phone doesn't match.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Update verify-checkout-otp for Dual Identifiers

**Files:**
- Modify: `supabase/functions/verify-checkout-otp/index.ts:20-51`

- [ ] **Step 1: Read current verify-checkout-otp**

Read the full file to confirm current state.

- [ ] **Step 2: Update request parsing (line 20)**

Old:
```typescript
    const { slot_id, identifier, code } = await req.json();
    if (!slot_id || !identifier || !code) {
```

New:
```typescript
    const { slot_id, nric, identifier, code } = await req.json();
    if (!slot_id || !nric || !identifier || !code) {
```

- [ ] **Step 3: Replace registration lookup (lines 28-44)**

Old (lines 28-44):
```typescript
    // 1. Look up registration
    let { data: registration } = await supabase
      .from('registrations')
      .select('id, status')
      .eq('slot_id', slot_id)
      .eq('invitee_nric', identifier)
      .single();

    if (!registration) {
      const result = await supabase
        .from('registrations')
        .select('id, status')
        .eq('slot_id', slot_id)
        .eq('invitee_phone', identifier)
        .single();
      registration = result.data;
    }
```

New:
```typescript
    // 1. Look up registration by NRIC
    const { data: registration } = await supabase
      .from('registrations')
      .select('id, status, invitee_email, invitee_phone')
      .eq('slot_id', slot_id)
      .eq('invitee_nric', nric)
      .single();
```

- [ ] **Step 4: Add identifier cross-check after registration_not_found check (after line 51)**

Insert immediately after the `registration_not_found` response block:

```typescript
    // 1b. Cross-check second identifier
    const emailMatch = registration.invitee_email && registration.invitee_email.toLowerCase() === identifier.toLowerCase();
    const phoneMatch = registration.invitee_phone && registration.invitee_phone === identifier;
    if (!emailMatch && !phoneMatch) {
      return new Response(
        JSON.stringify({ error: 'identifier_mismatch', message: 'The email/phone does not match the registration for this NRIC.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/verify-checkout-otp/index.ts
git commit -m "feat: update verify-checkout-otp for dual-identifier checkout

Accept nric + identifier + code. Primary lookup by NRIC, cross-check
second identifier. Mirrors send-checkout-otp validation logic.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Update CheckOut.tsx for Dual-Identifier Form

**Files:**
- Modify: `apps/public-pages/src/pages/CheckOut.tsx:1-547`

This is the largest change. The form structure changes from one identifier field to two (NRIC always + email/phone tabs).

- [ ] **Step 1: Read current CheckOut.tsx**

Read the full file to confirm current state.

- [ ] **Step 2: Replace zod schemas (lines 28-43)**

Old:
```typescript
// Step 1: Identifier schema
const identifierNricSchema = z.object({
  identifier: z.string().min(9, 'NRIC must be at least 9 characters'),
});

const identifierPhoneSchema = z.object({
  identifier: z.string().min(8, 'Phone number must be at least 8 characters'),
});

// Step 2: OTP schema
const otpSchema = z.object({
  otp_code: z.string().length(6, 'OTP must be 6 digits'),
});

type IdentifierFormData = z.infer<typeof identifierNricSchema>;
type OtpFormData = z.infer<typeof otpSchema>;
```

New:
```typescript
// Step 1: Dual identifier schema — NRIC always required + email or phone
const emailIdentifierSchema = z.object({
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
  identifier: z.string().email('Please enter a valid email address'),
});

const phoneIdentifierSchema = z.object({
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
  identifier: z.string().min(8, 'Phone number must be at least 8 characters'),
});

// Step 2: OTP schema
const otpSchema = z.object({
  otp_code: z.string().length(6, 'OTP must be 6 digits'),
});

type IdentifierFormData = z.infer<typeof emailIdentifierSchema>;
type OtpFormData = z.infer<typeof otpSchema>;
```

- [ ] **Step 3: Update state and form initialization (lines 50, 142-145)**

Change `identifyBy` initial state and tab values from `'nric' | 'phone'` to `'email' | 'phone'`:

Old (line 50):
```typescript
  const [identifyBy, setIdentifyBy] = useState<'nric' | 'phone'>('nric');
```

New:
```typescript
  const [identifyBy, setIdentifyBy] = useState<'email' | 'phone'>('email');
```

Old form initialization (lines 142-145):
```typescript
  const identifierForm = useForm<IdentifierFormData>({
    resolver: zodResolver(identifyBy === 'nric' ? identifierNricSchema : identifierPhoneSchema),
    defaultValues: { identifier: '' },
  });
```

New:
```typescript
  const identifierForm = useForm<IdentifierFormData>({
    resolver: zodResolver(identifyBy === 'email' ? emailIdentifierSchema : phoneIdentifierSchema),
    defaultValues: { nric: '', identifier: '' },
  });
```

- [ ] **Step 4: Update form reset on tab switch (lines 153-156)**

Old:
```typescript
  useEffect(() => {
    identifierForm.reset({ identifier: '' });
    setError(null);
  }, [identifyBy]);
```

New:
```typescript
  useEffect(() => {
    const currentNric = identifierForm.getValues('nric');
    identifierForm.reset({ nric: currentNric, identifier: '' });
    setError(null);
  }, [identifyBy]);
```

- [ ] **Step 5: Update handleSendOtp request body (lines 163-175)**

Old:
```typescript
      const response = await fetch(`${supabaseUrl}/functions/v1/send-checkout-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          slot_id: slotId,
          identifier: formData.identifier,
        }),
      });
```

New:
```typescript
      const response = await fetch(`${supabaseUrl}/functions/v1/send-checkout-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          slot_id: slotId,
          nric: formData.nric,
          identifier: formData.identifier,
        }),
      });
```

- [ ] **Step 6: Add identifier_mismatch error handler in handleSendOtp**

In `handleSendOtp`, after the `} else if (data.error === 'registration_not_found') {` block, add a new else-if:

```typescript
        } else if (data.error === 'identifier_mismatch') {
          setError('The email/phone does not match the registration for this NRIC.');
```

- [ ] **Step 7: Update handleResendOtp request body (lines 224-234)**

Old:
```typescript
        body: JSON.stringify({
          slot_id: slotId,
          identifier,
        }),
```

New:
```typescript
        body: JSON.stringify({
          slot_id: slotId,
          nric: identifierForm.getValues('nric'),
          identifier,
        }),
```

- [ ] **Step 8: Update handleVerifyOtp request body (lines 270-282)**

Old:
```typescript
        body: JSON.stringify({
          slot_id: slotId,
          identifier,
          code: formData.otp_code,
        }),
```

New:
```typescript
        body: JSON.stringify({
          slot_id: slotId,
          nric: identifierForm.getValues('nric'),
          identifier,
          code: formData.otp_code,
        }),
```

- [ ] **Step 9: Add identifier_mismatch error handler in handleVerifyOtp**

In `handleVerifyOtp`, after the `} else if (data.error === 'invalid_otp') { ... return; }` block, add a new else-if:

```typescript
        } else if (data.error === 'identifier_mismatch') {
          setError('The email/phone does not match the registration for this NRIC.');
          setIsSubmitting(false);
          return;
```

- [ ] **Step 10: Update Step 1 form UI — header description (line 374-376)**

Old:
```typescript
          <CardDescription className="text-slate-500">
            {step === 1
              ? `Enter your ${identifyBy === 'nric' ? 'NRIC' : 'phone number'} to receive an OTP via WhatsApp`
```

New:
```typescript
          <CardDescription className="text-slate-500">
            {step === 1
              ? 'Enter your NRIC and email or phone to receive an OTP'
```

- [ ] **Step 11: Update Step 1 form UI — add NRIC field + change tabs**

Replace the Step 1 form body (the section inside `{step === 1 ? ( ... ) : ( ... )}`).

The NRIC field goes above the tabs. Tabs change to "Email" / "Phone". The second identifier field renders below the tabs.

Old tabs (lines 407-415):
```typescript
              <Tabs
                value={identifyBy}
                onValueChange={(val) => setIdentifyBy(val as 'nric' | 'phone')}
                className="mb-4"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="nric">Identify by NRIC</TabsTrigger>
                  <TabsTrigger value="phone">Identify by Phone</TabsTrigger>
                </TabsList>
              </Tabs>
```

New — add NRIC field before tabs, change tab values:
```typescript
              {/* NRIC — always required */}
              <FormField
                control={identifierForm.control}
                name="nric"
                render={({ field }) => (
                  <FormItem className="mb-4">
                    <FormLabel className="text-slate-700">NRIC Number</FormLabel>
                    <FormControl>
                      <Input placeholder="S1234567A" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Second identifier toggle */}
              <Tabs
                value={identifyBy}
                onValueChange={(val) => setIdentifyBy(val as 'email' | 'phone')}
                className="mb-4"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="email">Email</TabsTrigger>
                  <TabsTrigger value="phone">Phone</TabsTrigger>
                </TabsList>
              </Tabs>
```

- [ ] **Step 12: Update second identifier field label and placeholder**

Old (lines 420-435):
```typescript
                  <FormField
                    control={identifierForm.control}
                    name="identifier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700">
                          {identifyBy === 'nric' ? 'NRIC Number' : 'Phone Number'}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={identifyBy === 'nric' ? 'S1234567A' : '+65 9123 4567'}
                            className="h-11"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
```

New:
```typescript
                  <FormField
                    control={identifierForm.control}
                    name="identifier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700">
                          {identifyBy === 'email' ? 'Email Address' : 'Phone Number'}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={identifyBy === 'email' ? 'john@example.com' : '+65 9123 4567'}
                            className="h-11"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
```

- [ ] **Step 13: Update helper text (line 440-442)**

Old:
```typescript
                  <p className="text-xs text-slate-500">
                    An OTP will be sent to the WhatsApp number you registered with.
                  </p>
```

New:
```typescript
                  <p className="text-xs text-slate-500">
                    OTP will be sent via WhatsApp to your registered phone number.
                  </p>
```

- [ ] **Step 14: Verify TypeScript compiles**

```bash
pnpm --filter public-pages exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 15: Manual verification**

Run `pnpm dev:public`, navigate to `/public/checkout?slot={testSlotId}`. Verify:
- NRIC field always visible at top
- Email/Phone tabs below NRIC
- Switching tabs preserves NRIC value, clears second field
- Both fields required for submission
- Correct placeholders and labels

- [ ] **Step 16: Commit**

```bash
git add apps/public-pages/src/pages/CheckOut.tsx
git commit -m "feat: update checkout form for dual-identifier verification

NRIC is now always required. Tabs switch between email/phone as the
second identifier. Both fields sent to edge functions. New error
handler for identifier_mismatch.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Deploy Edge Functions and End-to-End Verification

- [ ] **Step 1: Deploy updated edge functions**

```bash
npx supabase@2.80.0 functions deploy send-checkout-otp --project-ref wictbtiulqmzzneyoelv
npx supabase@2.80.0 functions deploy verify-checkout-otp --project-ref wictbtiulqmzzneyoelv
```
Expected: Both deploy successfully.

- [ ] **Step 2: Full typecheck across workspace**

```bash
pnpm -r typecheck
```
Expected: No errors across all packages.

- [ ] **Step 3: Lint check**

```bash
pnpm lint
```
Expected: No new errors.

- [ ] **Step 4: End-to-end manual test**

Test the full cycle against production Supabase:
1. Open admin portal → Check-In Scanner → scan a test invitation card QR
2. Verify attendance record created, registration status = `attended`
3. Open admin portal → Campaign → Slot → Venue Display → click "Start Checkout"
4. Verify QR appears, refreshes on 60s interval
5. Scan checkout QR on phone → enter NRIC + email → receive OTP
6. Enter OTP → verify checkout success
7. Verify attendance has `checkout_time` set and `is_full_attendance = true`
8. Verify registration status = `completed`
9. Test error case: correct NRIC but wrong email → verify `identifier_mismatch` error
10. Verify `/public/checkin` returns 404

- [ ] **Step 5: Final commit (if any fixes needed)**

Only if adjustments were needed during E2E testing.
