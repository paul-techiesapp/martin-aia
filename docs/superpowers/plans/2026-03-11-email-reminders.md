# Email Reminders for Event Invitees — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to send event reminder emails to all registered invitees for a specific campaign slot via the Resend API.

**Architecture:** Supabase Edge Function handles email composition and batch sending via Resend. Admin portal gets a "Send Reminders" button per slot with confirmation dialog. Custom React Query mutation hook calls the Edge Function.

**Tech Stack:** Supabase Edge Functions (Deno 2), Resend API, React 18, TanStack Query, shadcn/ui Dialog

**Spec:** `docs/superpowers/specs/2026-03-11-email-reminders-design.md`

---

## Chunk 1: Implementation

### Task 1: Create send-email-reminders Edge Function

**Files:**
- Create: `supabase/functions/send-email-reminders/index.ts`

- [ ] **Step 1: Create the Edge Function directory**

```bash
mkdir -p /Users/paullee/Documents/project/martin/DATA/supabase/functions/send-email-reminders
```

- [ ] **Step 2: Write the Edge Function**

Create `supabase/functions/send-email-reminders/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getNextOccurrence(dayOfWeek: number): Date {
  const today = new Date();
  const currentDay = today.getDay();
  let daysUntil = dayOfWeek - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0) return today;
  const next = new Date(today);
  next.setDate(today.getDate() + daysUntil);
  return next;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-SG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildEmailHtml(
  inviteeName: string,
  campaignName: string,
  venue: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string
): string {
  const nextDate = getNextOccurrence(dayOfWeek);
  const formattedDate = formatDate(nextDate);

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
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Time</td><td style="color: #334155;">${startTime.slice(0, 5)} – ${endTime.slice(0, 5)}</td></tr>
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
      .select("id, day_of_week, start_time, end_time, campaign:campaigns(name, venue, end_date)")
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

    const subject = `Reminder: ${campaign.name} — ${DAYS[slot.day_of_week]} ${slot.start_time.slice(0, 5)}`;
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
          slot.day_of_week,
          slot.start_time,
          slot.end_time
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
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-email-reminders/index.ts
git commit -m "feat(edge-fn): add send-email-reminders for batch email delivery via Resend"
```

---

### Task 2: Create useEmailReminders hook

**Files:**
- Create: `apps/admin-portal/src/hooks/useEmailReminders.ts`

- [ ] **Step 1: Create the hook**

Create `apps/admin-portal/src/hooks/useEmailReminders.ts`:

```typescript
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface SendRemindersResult {
  sent: number;
  failed: number;
  message?: string;
}

export function useEmailReminders() {
  return useMutation({
    mutationFn: async (slotId: string): Promise<SendRemindersResult> => {
      const { data, error } = await supabase.functions.invoke('send-email-reminders', {
        body: { slot_id: slotId },
      });

      if (error) {
        throw new Error(error.message || 'Failed to send reminders');
      }

      return data as SendRemindersResult;
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/src/hooks/useEmailReminders.ts
git commit -m "feat(admin): add useEmailReminders mutation hook"
```

---

### Task 3: Add Send Reminders button to CampaignDetail

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx`

- [ ] **Step 1: Add imports**

Add to the existing imports in `CampaignDetail.tsx`:

Add `Mail` to the lucide-react import (line 33):
```typescript
import { ArrowLeft, Plus, Trash2, Power, PowerOff, Mail } from 'lucide-react';
```

Add the hook import after line 35:
```typescript
import { useEmailReminders } from '../../hooks/useEmailReminders';
```

Add `useToast` to the shared-ui import (line 2-32). The Dialog components are already imported:
```typescript
import {
  // ... existing imports (Button, Card, Dialog, etc. are already present) ...
  useToast,
} from '@agent-system/shared-ui';
```

Add `supabase` import:
```typescript
import { supabase } from '../../lib/supabase';
```

- [ ] **Step 2: Add state and hook**

Add inside the `CampaignDetail` component, after the existing state declarations (after line 58):

```typescript
const sendReminders = useEmailReminders();
const [reminderSlot, setReminderSlot] = useState<{ id: string; label: string; count: number } | null>(null);
const { toast } = useToast();
```

- [ ] **Step 3: Add handler**

Add after `handleToggleStatus` (after line 90):

```typescript
const handleSendReminders = async () => {
  if (!reminderSlot) return;
  try {
    const result = await sendReminders.mutateAsync(reminderSlot.id);
    if (result.sent > 0) {
      toast({ title: `${result.sent} reminder${result.sent > 1 ? 's' : ''} sent` });
    } else {
      toast({ title: result.message || 'No emails sent', variant: 'destructive' });
    }
  } catch (err: any) {
    toast({ title: `Failed to send reminders`, description: err.message, variant: 'destructive' });
  }
  setReminderSlot(null);
};
```

- [ ] **Step 4: Add dialog open handler**

Query the registered invitee count when the mail button is clicked (avoids unnecessary queries on page load):

```typescript
const handleOpenReminderDialog = async (slot: { id: string; day_of_week: number; start_time: string }) => {
  const { count } = await supabase
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slot.id)
    .eq('status', 'registered')
    .not('invitee_email', 'is', null);

  setReminderSlot({
    id: slot.id,
    label: `${DAYS_OF_WEEK[slot.day_of_week]} ${slot.start_time.slice(0, 5)}`,
    count: count ?? 0,
  });
};
```

- [ ] **Step 5: Add Send Reminders button to slot table row**

In the slot table Actions column (line 329-351), add a "Send Reminders" button before the existing toggle and delete buttons:

```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-8 w-8 p-0"
  onClick={() => handleOpenReminderDialog(slot)}
  title="Send email reminders"
>
  <Mail className="h-4 w-4 text-indigo-500" />
</Button>
```

- [ ] **Step 6: Add confirmation dialog and result notification**

Add before the closing `</div>` of the component (before line 361):

```tsx
{/* Send Reminders confirmation dialog */}
<Dialog open={!!reminderSlot} onOpenChange={(open) => { if (!open) setReminderSlot(null); }}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Send Event Reminders?</DialogTitle>
      <DialogDescription>
        {reminderSlot && reminderSlot.count > 0 ? (
          <>
            This will send a reminder email to <strong>{reminderSlot.count} registered invitee{reminderSlot.count > 1 ? 's' : ''}</strong> for the <strong>{reminderSlot.label}</strong> slot.
          </>
        ) : (
          'No registered invitees with email addresses for this slot.'
        )}
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setReminderSlot(null)}>
        Cancel
      </Button>
      {reminderSlot && reminderSlot.count > 0 && (
        <Button
          onClick={handleSendReminders}
          disabled={sendReminders.isPending}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <Mail className="h-4 w-4 mr-2" />
          {sendReminders.isPending
            ? 'Sending...'
            : `Send ${reminderSlot.count} Email${reminderSlot.count > 1 ? 's' : ''}`}
        </Button>
      )}
    </DialogFooter>
  </DialogContent>
</Dialog>

```

- [ ] **Step 7: Verify the build**

```bash
cd /Users/paullee/Documents/project/martin/DATA
pnpm --filter admin-portal build
```

Expected: Build succeeds with no errors.

- [ ] **Step 8: Manual test**

```bash
pnpm dev:admin
```

1. Navigate to a campaign detail page
2. Verify each slot row has a mail icon button
3. Click the mail icon → confirmation dialog opens
4. Dialog shows count of registered invitees with emails
5. If 0 invitees, no "Send" button shown — just "Cancel"
6. If >0 invitees, click "Send N Emails" → loading state → result notification

- [ ] **Step 9: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx
git commit -m "feat(admin): add Send Reminders button per slot on CampaignDetail"
```

---

### Task 4: Set RESEND_API_KEY and deploy

- [ ] **Step 1: Set Resend API key in production**

Get the API key from https://resend.com/api-keys and set it:

```bash
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 2: Deploy Edge Function to production**

```bash
npx supabase functions deploy send-email-reminders --project-ref wictbtiulqmzzneyoelv
```

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "feat: email reminders - environment setup"
git push origin main
```
