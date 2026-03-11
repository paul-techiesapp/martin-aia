# Event Duplication Design

## Overview

Allow admins to duplicate an existing event (campaign) from the event list, creating a new event with the same structure (venue, invitation type, slots) but with a new name, new date range, and all slot times shifted by the corresponding offset.

## Motivation

Recurring events share the same structure — venue, time slots, check-in/out windows. Currently admins must manually recreate everything from scratch. Duplication saves time and reduces errors.

## Design Decisions

- **Client-side duplication** — no new database functions, edge functions, or migrations. Uses existing Supabase client inserts via a new React Query mutation hook.
- **Campaign + slots copied** — transactional data (invitations, attendance, pin codes, rewards) is not copied.
- **Date shifting** — admin provides new start/end dates. All slot `start_at`/`end_at` values are shifted by the offset between the new and original campaign start dates.
- **New name required** — admin enters a name before duplicating (pre-filled with "{Original} (Copy)").
- **Status = draft** — duplicated event always starts as draft regardless of source status.
- **No slot filtering** — all slots are copied even if shifted dates fall outside the new campaign range. Admin can delete unwanted slots after duplication.

## Data Flow

1. Admin clicks "Duplicate Event" in the CampaignList dropdown menu
2. Dialog opens with: event name (pre-filled), start date picker, end date picker
3. On confirm, the `useDuplicateCampaign` hook:
   a. Fetches the source campaign and its slots
   b. Computes offset: `newStartDate - sourceStartDate` (in milliseconds)
   c. Inserts new campaign with source's `venue`, `invitation_type`, the new name, new dates, and `status: 'draft'`
   d. For each source slot, creates a new slot with shifted `start_at`/`end_at` and copied `checkin_window_minutes`, `checkout_window_minutes`, `is_active`
   e. Batch-inserts all slots for the new campaign
4. On success, navigates to the new campaign's detail page and shows a toast

## Hook Design

### `useDuplicateCampaign` (in `apps/admin-portal/src/hooks/useCampaigns.ts`)

**Input:**
```typescript
{
  sourceId: string;
  newName: string;
  newStartDate: string;  // ISO date string (YYYY-MM-DD)
  newEndDate: string;     // ISO date string (YYYY-MM-DD)
}
```

**Process:**
1. Fetch source campaign: `supabase.from('campaigns').select('*').eq('id', sourceId).single()`
2. Fetch source slots: `supabase.from('slots').select('*').eq('campaign_id', sourceId).order('start_at')`
3. Calculate offset: `new Date(newStartDate + 'T00:00:00').getTime() - new Date(sourceCampaign.start_date + 'T00:00:00').getTime()` — append `T00:00:00` to avoid UTC midnight parsing of bare date strings
4. Insert new campaign (omit `id`, `created_at`, `updated_at`), chain `.select().single()` to get the new campaign row back (matches existing `useCreateCampaign` pattern)
5. Map source slots → new slots with shifted datetimes and new `campaign_id`
6. Batch insert slots: `supabase.from('slots').insert(newSlots)`

**Output:** New campaign data (for navigation)

**Cache invalidation:** Invalidate `['campaigns']` and `['campaigns', newCampaign.id]` query keys (matches existing mutation patterns)

## UI Design

### CampaignList Dropdown Addition

Add "Duplicate Event" menu item with `Copy` icon from lucide-react, positioned immediately after "Edit Event" and before the conditional Pause/Resume item.

### Duplicate Dialog

- **Event Name** — `<Input>` pre-filled with `"{Original Name} (Copy)"`
- **Start Date** — `<DatePicker>` (required)
- **End Date** — `<DatePicker>` (required, must be after start date)
- **Duplicate button** — loading state while mutation runs, disabled if fields incomplete
- **Validation:** end date must be after start date; name must not be empty
- **State types:** Dialog-local state holds `Date | undefined` for the date pickers (matching `DatePicker`'s `date?: Date` prop). Convert to `YYYY-MM-DD` strings via `format(date, 'yyyy-MM-dd')` from `date-fns` before calling the mutation.

## Date Shifting Logic

```
offset = new Date(newStartDate + 'T00:00:00').getTime() - new Date(sourceCampaign.start_date + 'T00:00:00').getTime()

For each source slot:
  new_start_at = new Date(new Date(slot.start_at).getTime() + offset).toISOString()
  new_end_at = new Date(new Date(slot.end_at).getTime() + offset).toISOString()
```

The `slots_unique_start` constraint (`campaign_id + start_at`) will not conflict since slots are inserted into a new campaign with a new ID.

Both `newStartDate` and `sourceCampaign.start_date` are bare date strings (`YYYY-MM-DD`). Appending `T00:00:00` ensures JavaScript parses them as local midnight (not UTC midnight), which matches the local-time semantics of slot TIMESTAMPTZ values. The offset is a whole number of days, so adding it to slot datetimes preserves timezone correctness.

## Edge Cases

- **Shifted slots outside campaign range:** Included as-is. Admin can delete unwanted slots after duplication.
- **Source has zero slots:** Campaign is duplicated with no slots. This is valid.
- **Slot insertion partially fails:** The campaign will exist with fewer slots than expected. Admin can manually add missing slots. This is acceptable for a low-frequency admin action.
- **Duplicate names:** No unique constraint on campaign names. The pre-filled "(Copy)" suffix helps distinguish.

## Files Changed

| File | Change | Scope |
|------|--------|-------|
| `apps/admin-portal/src/hooks/useCampaigns.ts` | Add `useDuplicateCampaign` hook | Small |
| `apps/admin-portal/src/pages/campaigns/CampaignList.tsx` | Add Duplicate menu item + dialog | Medium |

## What Is NOT Included

- No database migrations
- No edge functions
- No changes to shared-types
- No changes to agent-portal or public-pages
- No copying of invitations, attendance, pin codes, or rewards
