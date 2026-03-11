# Feature: Email Reminders for Event Invitees

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Edge Function + admin portal UI

## Overview

Allow admins to send event reminder emails to all registered invitees for a specific campaign slot. Emails are auto-generated from campaign/slot data with personalized invitee names. Uses Resend API for email delivery.

## Requirements

- "Send Reminders" button per slot on the Campaign Detail page
- Recipients: all invitations for the slot with status `REGISTERED` and non-empty `invitee_email`
- Auto-generated email content from campaign/slot data (no custom editing)
- Confirmation dialog before sending
- Success/failure toast notification after sending
- No preview step, no individual recipient selection, no delivery tracking
- Resend API for email delivery (3,000 emails/month free tier)

## Design

### Admin UI

A **"Send Reminders" button** on each slot card in the Campaign Detail page (`CampaignDetail.tsx`):

- **Enabled:** When slot has 1+ invitations with status `REGISTERED`
- **Disabled:** When slot has 0 registered invitees (shows "No Recipients" label)
- **On click:** Opens confirmation dialog

**Confirmation dialog:**
- Text: "This will send a reminder email to **{count} registered invitees** for the **{day_of_week} {start_time}** slot."
- Two buttons: "Cancel" and "Send {count} Emails"
- On confirm: calls Edge Function, shows loading state, then success/error toast

**Success toast:** "{count} reminders sent"
**Error toast:** "Failed to send reminders: {error message}"

### Email Content

Auto-generated from campaign and slot data. Hardcoded HTML template in the Edge Function.

**Subject:** `Reminder: {campaign_name} — {day_of_week} {start_time}`

**Body template:**
```
Hi {invitee_name},

This is a reminder for your upcoming event:

{campaign_name}
Venue: {venue}
Date: {day_of_week}, {formatted_date}
Time: {start_time} – {end_time}

Please arrive on time. We look forward to seeing you!
```

The template is a simple HTML email with inline styles (no external template engine). Personalized per recipient with `invitee_name`.

### Edge Function: `send-email-reminders`

**Input:**
```typescript
{ slot_id: string }
```

**Process:**
1. Authenticate request (must be called by admin — verify JWT role)
2. Fetch slot details + parent campaign (name, venue, dates, times)
3. Query invitations for this slot where `status = 'REGISTERED'` and `invitee_email IS NOT NULL`
4. If 0 recipients, return `{ sent: 0, failed: 0, message: "No eligible recipients" }`
5. Build email HTML from template with campaign/slot data
6. Send via Resend batch API (supports up to 100 per call — loop if more)
7. Return `{ sent: number, failed: number }`

**Auth:** Edge Function verifies the calling user's JWT has admin role before proceeding.

**Error cases:**
- Not admin → 403 "Unauthorized"
- Slot not found → 404 "Slot not found"
- No eligible recipients → 200 with `sent: 0`
- Resend API failure → 500 "Email delivery failed"
- Partial failure → 200 with both `sent` and `failed` counts

### Resend Configuration

- **Provider:** Resend (https://resend.com)
- **Free tier:** 3,000 emails/month, 100 emails/day
- **API:** Single `POST /emails/batch` endpoint for bulk sends
- **Sender:** Use Resend's default testing domain initially (`onboarding@resend.dev`), configure custom domain later
- **Environment variable:** `RESEND_API_KEY` stored in Supabase Edge Function secrets

### Slot-to-Date Mapping

Slots define recurring events by `day_of_week` + `start_time` + `end_time`. The email needs a specific date for the reminder. The Edge Function calculates the **next occurrence** of the slot's day-of-week from today to include in the email. If the campaign has an `end_date` that has passed, no reminders are sent.

## Files Changed

| Area | File | Change |
|------|------|--------|
| **Edge Function** | `supabase/functions/send-email-reminders/index.ts` | New — fetches invitees, builds email, sends via Resend |
| **Admin Portal** | `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx` | Add "Send Reminders" button per slot + confirmation dialog |
| **Admin Portal** | `apps/admin-portal/src/hooks/useEmailReminders.ts` | New — mutation hook to call the Edge Function |
| **Environment** | Supabase Edge Function secrets | `RESEND_API_KEY` |

## Out of Scope

- Custom email content editing by admin
- Email preview before sending
- Delivery tracking / send logs
- Individual recipient selection (sends to all registered)
- Email templates management in admin portal
- Scheduled/automated reminders (admin manually triggers)
- Unsubscribe mechanism (can be added later if needed for compliance)
