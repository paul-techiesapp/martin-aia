# Auto Invitation Card Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** When a new member registers via an agent's link and that agent has `is_auto_invite = true`, automatically email the invitee an HTML invitation card with a PDF attachment.

**Architecture:** New Supabase edge function `send-invitation-email` called fire-and-forget from `Register.tsx` after successful registration. The function checks the agent's `is_auto_invite` flag, builds an HTML email body with styled invitation card, generates a PDF via jsPDF in Deno, and sends both via Resend API with attachment.

**Tech Stack:** Supabase Edge Functions (Deno), Resend API, jsPDF (via esm.sh), qrcode (via esm.sh)

---

### Task 1: Create `send-invitation-email` edge function

**Files:**
- Create: `supabase/functions/send-invitation-email/index.ts`

**What this function does:**
1. Receives `{ registration_id, link_code }` from the client
2. Fetches registration, agent (checks `is_auto_invite`), slot, campaign, system_settings
3. Builds HTML email body with styled invitation card
4. Generates PDF invitation card using jsPDF + qrcode in Deno
5. Sends via Resend API with HTML body + PDF attachment
6. Returns `{ sent: true/false }` — never throws to the caller

**Imports (Deno/esm.sh):**
- `@supabase/supabase-js@2` for database access
- `jspdf@2.5.2` for PDF generation
- `qrcode@1.5.4` for QR code generation

**Key design points:**
- No auth required (called by anon user after public registration)
- Validates registration exists in the database
- Skips silently if agent has `is_auto_invite = false` or no email provided
- PDF drawing logic mirrors `packages/shared-ui/src/utils/pdfGenerator.ts` (same layout, colors, QR code)
- Uses `doc.output("datauristring")` then strips data URI prefix for base64 content
- From address: `Invitation <invitation@aia-test.techies.app>`
- Subject: `Your Invitation: {campaign.name} — {formatted date}`
- Attachment filename: `invitation-card.pdf`

**HTML email template style:**
- Gradient header bar (dark navy to blue) with company name, date, time
- White content area with campaign name, venue, invitee name
- Note: "Please find your invitation card attached as a PDF"
- Footer: "This is an automated invitation"

**Steps:**

- [ ] **Step 1:** Create the complete edge function file at `supabase/functions/send-invitation-email/index.ts` with all the logic described above. Reference `supabase/functions/send-email-reminders/index.ts` for the Resend API pattern and `packages/shared-ui/src/utils/pdfGenerator.ts` for the PDF drawing logic.

- [ ] **Step 2:** Test locally — run `npx supabase functions serve send-invitation-email --no-verify-jwt` and verify it starts without compilation errors.

- [ ] **Step 3:** Commit the new function.

---

### Task 2: Trigger email from Register.tsx after successful registration

**Files:**
- Modify: `apps/public-pages/src/pages/Register.tsx` (the `onSubmit` function, around line 123-157)

**What changes:**
- The `register_attendee` RPC returns a UUID (`registration_id`). Currently the return value is ignored.
- Capture the return value: `const { data: registrationId, error: rpcError } = await supabase.rpc(...)`
- After `setIsSuccess(true)`, add a fire-and-forget call to the new edge function
- The call must be non-blocking and silently catch errors — registration success is not affected by email delivery

**The fire-and-forget call (add after `setIsSubmitting(false)`):**
```typescript
// Fire-and-forget: send invitation email if agent has auto-invite enabled
if (registrationId && formData.invitee_email) {
  supabase.functions.invoke('send-invitation-email', {
    body: { registration_id: registrationId, link_code: linkCode },
  }).catch(() => {
    // Best-effort — silently ignore email failures
  });
}
```

**Steps:**

- [ ] **Step 1:** Modify the `onSubmit` function in `Register.tsx` to capture `registrationId` from the RPC response and add the fire-and-forget email call.

- [ ] **Step 2:** Verify the app builds — run `pnpm --filter public-pages build` and confirm no TypeScript errors.

- [ ] **Step 3:** Commit the change.

---

### Task 3: Deploy and verify end-to-end

**Files:** No file changes — deployment and testing only.

**Steps:**

- [ ] **Step 1:** Deploy the edge function to production: `npx supabase functions deploy send-invitation-email --project-ref wictbtiulqmzzneyoelv`

- [ ] **Step 2:** Verify function is listed as ACTIVE: `npx supabase functions list --project-ref wictbtiulqmzzneyoelv`

- [ ] **Step 3:** Push frontend changes to trigger Render auto-deploy: `git push origin main`

- [ ] **Step 4:** Manual end-to-end test:
  1. Open agent portal, verify Auto Invite toggle is ON for the test agent
  2. Get an agent link for an active campaign slot
  3. Open registration link, register with a real email address
  4. Check inbox for invitation email with HTML card body + PDF attachment
  5. Open the PDF and verify it matches the standard invitation card style
