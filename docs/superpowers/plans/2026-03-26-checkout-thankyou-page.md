# Post-Checkout Thank You Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable post-checkout thank you page with YouTube video embed, star rating, and Facebook follow button — all admin-manageable per campaign.

**Architecture:** JSONB column on campaigns table stores toggle+URL config. Edge functions return config on checkout success. Public-pages renders enabled sections. Rating stored on attendance table.

**Tech Stack:** React 18, Supabase Edge Functions (Deno), PostgreSQL, TanStack Query, Tailwind CSS, shadcn/ui, Zod

**Spec:** `docs/superpowers/specs/2026-03-25-checkout-thankyou-page-design.md`

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260326000001_checkout_config.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add checkout configuration to campaigns
ALTER TABLE campaigns
  ADD COLUMN checkout_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Add checkout rating to attendance
ALTER TABLE attendance
  ADD COLUMN checkout_rating SMALLINT CHECK (checkout_rating >= 1 AND checkout_rating <= 5);
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db reset`
Expected: Database resets and all migrations apply successfully, including the new one.

- [ ] **Step 3: Verify columns exist**

Run: `npx supabase db reset` should complete without errors. Optionally verify in Supabase Studio at http://localhost:54323 that `campaigns` has `checkout_config` (jsonb) and `attendance` has `checkout_rating` (smallint).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260326000001_checkout_config.sql
git commit -m "feat: add checkout_config and checkout_rating columns"
```

---

### Task 2: Shared Types

**Files:**
- Modify: `packages/shared-types/src/database.ts`

- [ ] **Step 1: Add CheckoutConfig interface**

Add after the imports (after line 10 in `database.ts`):

```typescript
export interface CheckoutConfig {
  fb_enabled: boolean;
  fb_url: string;
  video_enabled: boolean;
  video_url: string;
  rating_enabled: boolean;
}
```

- [ ] **Step 2: Extend Campaign interface**

Add `checkout_config` to the `Campaign` interface (after `updated_at`):

```typescript
checkout_config: CheckoutConfig;
```

- [ ] **Step 3: Extend Attendance interface**

Add `checkout_rating` to the `Attendance` interface (after `is_full_attendance`):

```typescript
checkout_rating: number | null;
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm -r typecheck`
Expected: May show errors in files that use Campaign/Attendance types — these will be resolved in later tasks. The shared-types package itself should compile.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/database.ts
git commit -m "feat: add CheckoutConfig type, extend Campaign and Attendance interfaces"
```

---

### Task 3: submit-checkout-rating Edge Function

**Files:**
- Create: `supabase/functions/submit-checkout-rating/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/submit-checkout-rating/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { attendance_id, rating } = await req.json();

    // Validate inputs
    if (!attendance_id || rating === undefined || rating === null) {
      return new Response(
        JSON.stringify({ error: 'missing_fields', message: 'attendance_id and rating are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return new Response(
        JSON.stringify({ error: 'invalid_rating', message: 'Rating must be an integer between 1 and 5' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up attendance record
    const { data: attendance, error: fetchError } = await supabase
      .from('attendance')
      .select('id, checkout_rating')
      .eq('id', attendance_id)
      .single();

    if (fetchError || !attendance) {
      return new Response(
        JSON.stringify({ error: 'attendance_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent double-submission
    if (attendance.checkout_rating !== null) {
      return new Response(
        JSON.stringify({ error: 'already_rated' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update rating
    const { error: updateError } = await supabase
      .from('attendance')
      .update({ checkout_rating: rating })
      .eq('id', attendance_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'update_failed', message: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'internal_error', message: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/submit-checkout-rating/index.ts
git commit -m "feat: add submit-checkout-rating edge function"
```

---

### Task 4: Modify verify-checkout-otp Edge Function

**Files:**
- Modify: `supabase/functions/verify-checkout-otp/index.ts`

- [ ] **Step 1: Add checkout_config fetch after successful RPC**

After the RPC call succeeds (after the `checkoutError` handling block, around line 101), add code to fetch `checkout_config` and `attendance_id`. Replace the current success response block (lines 103-111):

```typescript
    // No need for separate updates — RPC handles everything atomically:
    // - Marks OTP as used (with FOR UPDATE lock)
    // - Updates attendance: checkout_time + is_full_attendance
    // - Updates registration status to 'completed'

    // Fetch attendance_id for rating submission
    const { data: updatedAttendance } = await supabase
      .from('attendance')
      .select('id')
      .eq('registration_id', registration.id)
      .single();

    // Fetch checkout_config from campaign via slot
    const { data: slotData } = await supabase
      .from('slots')
      .select('campaign_id, campaigns(checkout_config)')
      .eq('id', slot_id)
      .single();

    const checkout_config = slotData?.campaigns?.checkout_config ?? {};

    return new Response(
      JSON.stringify({
        success: true,
        attendance_id: updatedAttendance?.id ?? null,
        checkout_config,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
```

- [ ] **Step 2: Add checkout_config to already_checked_out response**

Find the `already_checked_out` response block (around lines 75-79). Replace it with:

```typescript
    if (attendance.checkout_time) {
      // Fetch checkout_config for the thank you page
      const { data: slotData } = await supabase
        .from('slots')
        .select('campaign_id, campaigns(checkout_config)')
        .eq('id', slot_id)
        .single();

      return new Response(
        JSON.stringify({
          error: 'already_checked_out',
          attendance_id: attendance.id,
          checkout_config: slotData?.campaigns?.checkout_config ?? {},
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/verify-checkout-otp/index.ts
git commit -m "feat: return checkout_config and attendance_id from verify-checkout-otp"
```

---

### Task 5: Modify send-checkout-otp Edge Function

**Files:**
- Modify: `supabase/functions/send-checkout-otp/index.ts`

- [ ] **Step 1: Update already_checked_out response**

Find the `already_checked_out` response block (around lines 77-81 in `send-checkout-otp/index.ts`). The current attendance query at line 64 only selects `checkout_time`. Update it to also select `id`:

Change line 66 from:
```typescript
      .select('checkout_time')
```
to:
```typescript
      .select('id, checkout_time')
```

Then replace the `already_checked_out` response block:

```typescript
    if (attendance.checkout_time) {
      // Fetch checkout_config for the thank you page
      const { data: slotData } = await supabase
        .from('slots')
        .select('campaign_id, campaigns(checkout_config)')
        .eq('id', slot_id)
        .single();

      return new Response(
        JSON.stringify({
          error: 'already_checked_out',
          attendance_id: attendance.id,
          checkout_config: slotData?.campaigns?.checkout_config ?? {},
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/send-checkout-otp/index.ts
git commit -m "feat: return checkout_config and attendance_id on already_checked_out in send-checkout-otp"
```

---

### Task 6: Admin Portal — Checkout Config Card on CampaignDetail

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx`

- [ ] **Step 1: Add checkout config state and save handler**

Inside the `CampaignDetail` component function, after the existing state declarations (after line 254), add:

```typescript
  // Checkout config state
  const updateCampaign = useUpdateCampaign();
  const [checkoutConfig, setCheckoutConfig] = useState({
    fb_enabled: false,
    fb_url: '',
    video_enabled: false,
    video_url: '',
    rating_enabled: false,
  });
  const [isCheckoutConfigDirty, setIsCheckoutConfigDirty] = useState(false);
```

Add a `useEffect` to initialize from campaign data (after the state block):

```typescript
  useEffect(() => {
    if (campaign?.checkout_config && typeof campaign.checkout_config === 'object') {
      const cfg = campaign.checkout_config as Record<string, unknown>;
      setCheckoutConfig({
        fb_enabled: cfg.fb_enabled === true,
        fb_url: (cfg.fb_url as string) ?? '',
        video_enabled: cfg.video_enabled === true,
        video_url: (cfg.video_url as string) ?? '',
        rating_enabled: cfg.rating_enabled === true,
      });
    }
  }, [campaign]);
```

Add a save handler:

```typescript
  const handleSaveCheckoutConfig = async () => {
    if (!campaignId) return;
    try {
      await updateCampaign.mutateAsync({
        id: campaignId,
        checkout_config: checkoutConfig,
      } as any);
      setIsCheckoutConfigDirty(false);
      toast({ title: 'Checkout configuration saved' });
    } catch (err: any) {
      toast({ title: 'Failed to save', description: err.message, variant: 'error' });
    }
  };
```

- [ ] **Step 2: Add useUpdateCampaign import**

The `useUpdateCampaign` hook is already exported from `useCampaigns.ts`. Update the import at line 38:

From:
```typescript
import { useCampaign, useUpdateCampaignStatus } from '../../hooks/useCampaigns';
```
To:
```typescript
import { useCampaign, useUpdateCampaignStatus, useUpdateCampaign } from '../../hooks/useCampaigns';
```

Also add the `useEffect` import — update line 43:
From:
```typescript
import { useState } from 'react';
```
To:
```typescript
import { useState, useEffect } from 'react';
```

Also add `CheckoutConfig` to the shared-types import at line 42:
From:
```typescript
import { CampaignStatus } from '@agent-system/shared-types';
```
To:
```typescript
import { CampaignStatus } from '@agent-system/shared-types';
import type { CheckoutConfig } from '@agent-system/shared-types';
```

- [ ] **Step 3: Add the checkout config card JSX**

After the Event Slots Card closing tag (after line 727, before the Send Reminders dialog), add:

```tsx
      {/* Post-Checkout Content Configuration */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Post-Checkout Content</CardTitle>
          <CardDescription>
            Configure what attendees see after successful check-out
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Facebook Follow Button */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="fb_enabled"
                checked={checkoutConfig.fb_enabled}
                onCheckedChange={(checked) => {
                  setCheckoutConfig({ ...checkoutConfig, fb_enabled: checked === true });
                  setIsCheckoutConfigDirty(true);
                }}
              />
              <Label htmlFor="fb_enabled" className="font-semibold">Facebook Follow Button</Label>
            </div>
            {checkoutConfig.fb_enabled && (
              <Input
                placeholder="https://facebook.com/your-page"
                value={checkoutConfig.fb_url}
                onChange={(e) => {
                  setCheckoutConfig({ ...checkoutConfig, fb_url: e.target.value });
                  setIsCheckoutConfigDirty(true);
                }}
              />
            )}
          </div>

          {/* Video / Photo */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="video_enabled"
                checked={checkoutConfig.video_enabled}
                onCheckedChange={(checked) => {
                  setCheckoutConfig({ ...checkoutConfig, video_enabled: checked === true });
                  setIsCheckoutConfigDirty(true);
                }}
              />
              <Label htmlFor="video_enabled" className="font-semibold">Video / Photo</Label>
            </div>
            {checkoutConfig.video_enabled && (
              <Input
                placeholder="https://youtube.com/watch?v=..."
                value={checkoutConfig.video_url}
                onChange={(e) => {
                  setCheckoutConfig({ ...checkoutConfig, video_url: e.target.value });
                  setIsCheckoutConfigDirty(true);
                }}
              />
            )}
          </div>

          {/* Experience Rating */}
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="rating_enabled"
                checked={checkoutConfig.rating_enabled}
                onCheckedChange={(checked) => {
                  setCheckoutConfig({ ...checkoutConfig, rating_enabled: checked === true });
                  setIsCheckoutConfigDirty(true);
                }}
              />
              <Label htmlFor="rating_enabled" className="font-semibold">Experience Rating</Label>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              Shows a 1-5 star rating after checkout. Ratings are stored per attendance record.
            </p>
          </div>

          {/* Save Button */}
          {isCheckoutConfigDirty && (
            <Button
              onClick={handleSaveCheckoutConfig}
              disabled={updateCampaign.isPending}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {updateCampaign.isPending ? 'Saving...' : 'Save Configuration'}
            </Button>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm -r typecheck`
Expected: No TypeScript errors.

- [ ] **Step 5: Verify visually**

Run the admin portal (`pnpm dev:admin`), navigate to a campaign detail page. The "Post-Checkout Content" card should appear below the slots table with three toggleable sections and a save button that appears when changes are made.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx
git commit -m "feat: add post-checkout content configuration to campaign detail page"
```

---

### Task 7: Public Pages — Enhanced Thank You Page

**Files:**
- Modify: `apps/public-pages/src/pages/CheckOut.tsx`

- [ ] **Step 1: Add new state variables**

After the existing state declarations (around line 71), add:

```typescript
  // Post-checkout content state
  const [checkoutConfig, setCheckoutConfig] = useState<{
    fb_enabled?: boolean;
    fb_url?: string;
    video_enabled?: boolean;
    video_url?: string;
    rating_enabled?: boolean;
  } | null>(null);
  const [attendanceId, setAttendanceId] = useState<string | null>(null);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
```

- [ ] **Step 2: Add Star icon import**

Update the lucide-react import (line 25):

From:
```typescript
import { CheckCircle, MessageSquare, ArrowRight } from 'lucide-react';
```
To:
```typescript
import { CheckCircle, MessageSquare, ArrowRight, Star } from 'lucide-react';
```

- [ ] **Step 3: Add rating submission handler**

After the `handleVerifyOtp` function (after line 325), add:

```typescript
  // Submit star rating
  const handleSubmitRating = async (rating: number) => {
    if (!attendanceId || ratingSubmitted) return;
    setSelectedRating(rating);
    setIsSubmittingRating(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/submit-checkout-rating`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ attendance_id: attendanceId, rating }),
      });

      if (response.ok) {
        setRatingSubmitted(true);
      }
    } catch {
      // Silently fail — rating is non-critical
    }
    setIsSubmittingRating(false);
  };
```

- [ ] **Step 4: Update handleSendOtp to capture checkout_config on already_checked_out**

In `handleSendOtp` (around line 198-202), update the `already_checked_out` handling:

From:
```typescript
        } else if (data.error === 'already_checked_out') {
          setAttendeeName('');
          setIsSuccess(true);
          setIsSending(false);
          return;
```
To:
```typescript
        } else if (data.error === 'already_checked_out') {
          setAttendeeName('');
          setCheckoutConfig(data.checkout_config ?? null);
          setAttendanceId(data.attendance_id ?? null);
          setIsSuccess(true);
          setIsSending(false);
          return;
```

- [ ] **Step 5: Update handleVerifyOtp to capture checkout_config and attendance_id**

In `handleVerifyOtp`, update the success block (around line 319):

From:
```typescript
      setIsSuccess(true);
      setIsSubmitting(false);
```
To:
```typescript
      setCheckoutConfig(data.checkout_config ?? null);
      setAttendanceId(data.attendance_id ?? null);
      setIsSuccess(true);
      setIsSubmitting(false);
```

Also update the `already_checked_out` case in `handleVerifyOtp` (around line 304-307):

From:
```typescript
        } else if (data.error === 'already_checked_out') {
          // Treat as success
          setIsSuccess(true);
          setIsSubmitting(false);
          return;
```
To:
```typescript
        } else if (data.error === 'already_checked_out') {
          setCheckoutConfig(data.checkout_config ?? null);
          setAttendanceId(data.attendance_id ?? null);
          setIsSuccess(true);
          setIsSubmitting(false);
          return;
```

- [ ] **Step 6: Replace the success screen**

Replace the entire success screen block (lines 354-376, from `if (isSuccess) {` to its closing `}`):

```tsx
  // Success screen with configurable post-checkout content
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-0">
            {/* Success Header — always shown */}
            <div className="p-8 text-center border-b border-slate-100">
              <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-emerald-600">Check-Out Successful!</h2>
              {attendeeName && (
                <p className="text-xl font-semibold text-slate-900 mt-2">{attendeeName}</p>
              )}
              <p className="text-slate-500 mt-2">
                Thank you for attending! Your full attendance has been recorded.
              </p>
            </div>

            {/* Video/Photo Embed */}
            {checkoutConfig?.video_enabled && checkoutConfig.video_url && (
              <div className="p-6 border-b border-slate-100">
                <div className="rounded-xl overflow-hidden bg-black aspect-video">
                  <iframe
                    src={checkoutConfig.video_url.replace('watch?v=', 'embed/')}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Event video"
                  />
                </div>
              </div>
            )}

            {/* Star Rating */}
            {checkoutConfig?.rating_enabled && attendanceId && (
              <div className="p-6 border-b border-slate-100 text-center">
                <p className="text-sm font-semibold text-slate-700 mb-3">
                  {ratingSubmitted ? 'Thank you for your feedback!' : 'How was your experience?'}
                </p>
                <div className="flex gap-2 justify-center">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => !ratingSubmitted && handleSubmitRating(star)}
                      disabled={ratingSubmitted || isSubmittingRating}
                      className="transition-transform hover:scale-110 disabled:cursor-default"
                    >
                      <Star
                        className={`h-9 w-9 ${
                          selectedRating && star <= selectedRating
                            ? 'fill-amber-400 text-amber-400'
                            : 'fill-none text-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
                {!ratingSubmitted && (
                  <p className="text-xs text-slate-400 mt-2">Tap a star to rate</p>
                )}
              </div>
            )}

            {/* Facebook Follow Button */}
            {checkoutConfig?.fb_enabled && checkoutConfig.fb_url && (
              <div className="p-6">
                <a
                  href={checkoutConfig.fb_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2.5 w-full bg-[#1877f2] hover:bg-[#166fe5] text-white font-semibold py-3 px-5 rounded-xl transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  Follow us on Facebook
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
```

- [ ] **Step 7: Verify typecheck**

Run: `pnpm -r typecheck`
Expected: No TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add apps/public-pages/src/pages/CheckOut.tsx
git commit -m "feat: add configurable post-checkout thank you page with video, rating, and FB button"
```

---

### Task 8: Deploy Edge Functions and Verify

**Files:** None (deployment task)

- [ ] **Step 1: Deploy edge functions to production**

```bash
npx supabase functions deploy submit-checkout-rating --project-ref wictbtiulqmzzneyoelv
npx supabase functions deploy verify-checkout-otp --project-ref wictbtiulqmzzneyoelv
npx supabase functions deploy send-checkout-otp --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 2: Run production migration**

```bash
npx supabase db push --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 3: Push to main for auto-deploy**

```bash
git push origin main
```

Expected: Render auto-deploys admin-portal, agent-portal, and public-pages.

- [ ] **Step 4: Verify end-to-end**

1. Open admin portal → navigate to a campaign → scroll to "Post-Checkout Content" card
2. Enable all three toggles, enter FB URL and YouTube URL, save
3. Open public-pages checkout flow → complete checkout with OTP
4. Verify thank you page shows: success header, video embed, star rating, and FB button
5. Tap a star → verify rating submits and stars lock in
6. Click FB button → verify it opens in new tab
