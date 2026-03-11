# Slot DateTime Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace recurring `day_of_week`/`start_time`/`end_time` slot model with specific `start_at`/`end_at` TIMESTAMPTZ columns.

**Architecture:** Database migration drops 3 columns and adds 2 TIMESTAMPTZ columns. All frontend and edge function code that references the old columns gets updated to use the new datetime fields. Slot phase calculation simplifies from day-of-week matching to direct datetime comparison.

**Tech Stack:** PostgreSQL (TIMESTAMPTZ), TypeScript, React, Supabase Edge Functions (Deno), date-fns

**Spec:** `docs/superpowers/specs/2026-03-11-slot-datetime-migration-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/20260311000003_slot_datetime.sql` | Create | Migration: drop old columns, add `start_at`/`end_at` |
| `packages/shared-types/src/database.ts` | Modify | Update `Slot` interface |
| `apps/admin-portal/src/hooks/useSlots.ts` | Modify | Update query ordering |
| `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx` | Modify | New slot creation UI (single + bulk) |
| `apps/admin-portal/src/pages/PinCodes.tsx` | Modify | Update slot display format |
| `apps/admin-portal/src/pages/VenueDisplay.tsx` | Modify | Update `SlotData` interface and `getPhase()` |
| `apps/admin-portal/src/pages/PdfExport.tsx` | Modify | Update slot type and display format |
| `apps/admin-portal/src/utils/pdfGenerator.ts` | Modify | Replace `formatDayOfWeek` with `formatSlotDate` |
| `apps/agent-portal/src/pages/Campaigns.tsx` | Modify | Update slot display format |
| `apps/agent-portal/src/pages/Invitations.tsx` | Modify | Update slot display format |
| `apps/public-pages/src/lib/slot-time.ts` | Modify | Rewrite phase calculation for TIMESTAMPTZ |
| `apps/public-pages/src/pages/Display.tsx` | Modify | Update `SlotData` interface and display |
| `supabase/functions/send-email-reminders/index.ts` | Modify | Replace `getNextOccurrence()` with direct `start_at` |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260311000003_slot_datetime.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Slot DateTime Migration: Replace day_of_week + start_time/end_time with start_at/end_at TIMESTAMPTZ
-- This is a breaking change. All existing slot data (test-only) is deleted.

-- 1. Delete dependent data first (CASCADE would handle this, but be explicit)
DELETE FROM rewards;
DELETE FROM attendance;
DELETE FROM pin_codes;
DELETE FROM invitations;
DELETE FROM slots;

-- 2. Drop old columns and constraints
ALTER TABLE slots
  DROP CONSTRAINT IF EXISTS valid_times,
  DROP COLUMN day_of_week,
  DROP COLUMN start_time,
  DROP COLUMN end_time;

-- 3. Add new TIMESTAMPTZ columns
ALTER TABLE slots
  ADD COLUMN start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN end_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 hours');

-- 4. Remove defaults (they were only needed for the ALTER ADD NOT NULL)
ALTER TABLE slots
  ALTER COLUMN start_at DROP DEFAULT,
  ALTER COLUMN end_at DROP DEFAULT;

-- 5. Add new constraints
ALTER TABLE slots
  ADD CONSTRAINT slots_datetime_check CHECK (end_at > start_at),
  ADD CONSTRAINT slots_unique_start UNIQUE (campaign_id, start_at);
```

- [ ] **Step 2: Verify migration syntax locally**

Run: `npx supabase db reset` (if local Supabase is running) or review the SQL manually.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260311000003_slot_datetime.sql
git commit -m "feat(db): migrate slots from day_of_week to start_at/end_at TIMESTAMPTZ"
```

---

## Task 2: Shared Types Update

**Files:**
- Modify: `packages/shared-types/src/database.ts:23-34`

- [ ] **Step 1: Update the Slot interface**

Replace lines 26-28 in the `Slot` interface:

```typescript
// OLD:
  day_of_week: number; // 0-6 (Sunday-Saturday)
  start_time: string; // HH:MM:SS
  end_time: string; // HH:MM:SS

// NEW:
  start_at: string; // ISO 8601 datetime (TIMESTAMPTZ)
  end_at: string; // ISO 8601 datetime (TIMESTAMPTZ)
```

The full updated interface should be:

```typescript
export interface Slot {
  id: string;
  campaign_id: string;
  start_at: string; // ISO 8601 datetime (TIMESTAMPTZ)
  end_at: string; // ISO 8601 datetime (TIMESTAMPTZ)
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Run typecheck to identify all downstream breakages**

Run: `pnpm -r typecheck`

Expected: TypeScript errors in all files referencing `day_of_week`, `start_time`, `end_time` on `Slot`. This confirms all touch points.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/database.ts
git commit -m "feat(types): update Slot interface to start_at/end_at TIMESTAMPTZ"
```

---

## Task 3: Admin Portal — useSlots Hook

**Files:**
- Modify: `apps/admin-portal/src/hooks/useSlots.ts:13-14`

- [ ] **Step 1: Update the ordering query**

In `useSlots()`, replace the two `.order()` calls:

```typescript
// OLD (lines 13-14):
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });

// NEW:
        .order('start_at', { ascending: true });
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/src/hooks/useSlots.ts
git commit -m "fix(admin): update slot ordering to use start_at"
```

---

## Task 4: Admin Portal — CampaignDetail Slot Creation UI

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx`

**Note:** This file is ~443 lines. Use string search/replace rather than line numbers. All "OLD" blocks are exact matches from the current file.

This is the largest change. The slot creation dialog needs a date picker + time inputs replacing the day-of-week dropdown, plus a new bulk generation feature.

- [ ] **Step 1: Update imports and constants**

Remove the `DAYS_OF_WEEK` constant. Add `format, parseISO, eachDayOfInterval, getDay` from `date-fns`:

```typescript
import { format, parseISO, eachDayOfInterval, getDay } from 'date-fns';
import { ArrowLeft, Plus, Trash2, Power, PowerOff, Mail, CalendarPlus } from 'lucide-react';
```

Also add `DatePicker` and `Checkbox` to the shared-ui import:

```typescript
import {
  // ... existing imports ...
  DatePicker,
  Checkbox,
} from '@agent-system/shared-ui';
```

- [ ] **Step 2: Update slot creation state**

Replace the `newSlot` state (lines 59-65):

```typescript
// OLD:
const [newSlot, setNewSlot] = useState({
  day_of_week: 1,
  start_time: '10:00',
  end_time: '13:00',
  checkin_window_minutes: 30,
  checkout_window_minutes: 30,
});

// NEW:
const [newSlot, setNewSlot] = useState({
  date: undefined as Date | undefined,
  start_time: '10:00',
  end_time: '13:00',
  checkin_window_minutes: 30,
  checkout_window_minutes: 30,
});
```

Add bulk generation state after the existing state declarations:

```typescript
const [isBulkMode, setIsBulkMode] = useState(false);
const [bulkDayOfWeek, setBulkDayOfWeek] = useState(1);
const [bulkStartTime, setBulkStartTime] = useState('10:00');
const [bulkEndTime, setBulkEndTime] = useState('13:00');
const [bulkCheckinWindow, setBulkCheckinWindow] = useState(30);
const [bulkCheckoutWindow, setBulkCheckoutWindow] = useState(30);
const [bulkPreview, setBulkPreview] = useState<Date[]>([]);
const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
```

- [ ] **Step 3: Update handleAddSlot to combine date + time into TIMESTAMPTZ**

```typescript
const handleAddSlot = async () => {
  if (!campaignId || !newSlot.date) return;
  const dateStr = format(newSlot.date, 'yyyy-MM-dd');
  await createSlot.mutateAsync({
    campaign_id: campaignId,
    start_at: `${dateStr}T${newSlot.start_time}:00`,
    end_at: `${dateStr}T${newSlot.end_time}:00`,
    checkin_window_minutes: newSlot.checkin_window_minutes,
    checkout_window_minutes: newSlot.checkout_window_minutes,
    is_active: true,
  });
  setIsAddSlotOpen(false);
  setNewSlot({
    date: undefined,
    start_time: '10:00',
    end_time: '13:00',
    checkin_window_minutes: 30,
    checkout_window_minutes: 30,
  });
};
```

- [ ] **Step 4: Add bulk generation handlers**

```typescript
const handleGenerateBulkPreview = () => {
  if (!campaign) return;
  const start = parseISO(campaign.start_date);
  const end = parseISO(campaign.end_date);
  const allDays = eachDayOfInterval({ start, end });
  const matching = allDays.filter((d) => getDay(d) === bulkDayOfWeek);
  setBulkPreview(matching);
  setBulkSelected(new Set(matching.map((d) => format(d, 'yyyy-MM-dd'))));
};

const handleBulkCreate = async () => {
  if (!campaignId) return;
  const selectedDates = Array.from(bulkSelected);
  for (const dateStr of selectedDates) {
    await createSlot.mutateAsync({
      campaign_id: campaignId,
      start_at: `${dateStr}T${bulkStartTime}:00`,
      end_at: `${dateStr}T${bulkEndTime}:00`,
      checkin_window_minutes: bulkCheckinWindow,
      checkout_window_minutes: bulkCheckoutWindow,
      is_active: true,
    });
  }
  setIsAddSlotOpen(false);
  setBulkPreview([]);
  setBulkSelected(new Set());
  setIsBulkMode(false);
};
```

- [ ] **Step 5: Update the handleOpenReminderDialog function**

Replace `handleOpenReminderDialog` (lines 99-112):

```typescript
const handleOpenReminderDialog = async (slot: { id: string; start_at: string }) => {
  const { count } = await supabase
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slot.id)
    .eq('status', 'registered')
    .not('invitee_email', 'is', null);

  setReminderSlot({
    id: slot.id,
    label: format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm'),
    count: count ?? 0,
  });
};
```

- [ ] **Step 6: Replace the Add Slot dialog content**

Replace the `<DialogContent>` inside the Add Slot dialog (lines 254-325) with the new UI supporting both single and bulk modes:

```tsx
<DialogContent className="max-w-lg">
  <DialogHeader>
    <DialogTitle>Add New Slot</DialogTitle>
    <DialogDescription>
      Create a new time slot for this event
    </DialogDescription>
  </DialogHeader>

  {/* Mode toggle */}
  <div className="flex gap-2 border-b pb-3">
    <Button
      variant={isBulkMode ? 'ghost' : 'default'}
      size="sm"
      onClick={() => { setIsBulkMode(false); setBulkPreview([]); }}
    >
      Single Slot
    </Button>
    <Button
      variant={isBulkMode ? 'default' : 'ghost'}
      size="sm"
      onClick={() => setIsBulkMode(true)}
    >
      <CalendarPlus className="h-4 w-4 mr-1" />
      Bulk Generate
    </Button>
  </div>

  {!isBulkMode ? (
    /* Single slot mode */
    <div className="space-y-4">
      <div>
        <Label>Date</Label>
        <DatePicker
          date={newSlot.date}
          onDateChange={(d) => setNewSlot({ ...newSlot, date: d })}
          placeholder="Select date"
          disabled={(date) => {
            if (!campaign) return true;
            const start = parseISO(campaign.start_date);
            const end = parseISO(campaign.end_date);
            return date < start || date > end;
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Start Time</Label>
          <Input
            type="time"
            value={newSlot.start_time}
            onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
          />
        </div>
        <div>
          <Label>End Time</Label>
          <Input
            type="time"
            value={newSlot.end_time}
            onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Check-in Window (mins)</Label>
          <Input
            type="number"
            value={newSlot.checkin_window_minutes}
            onChange={(e) => setNewSlot({ ...newSlot, checkin_window_minutes: parseInt(e.target.value) })}
          />
        </div>
        <div>
          <Label>Check-out Window (mins)</Label>
          <Input
            type="number"
            value={newSlot.checkout_window_minutes}
            onChange={(e) => setNewSlot({ ...newSlot, checkout_window_minutes: parseInt(e.target.value) })}
          />
        </div>
      </div>
    </div>
  ) : (
    /* Bulk generation mode */
    <div className="space-y-4">
      <div>
        <Label>Day of Week</Label>
        <Select
          value={bulkDayOfWeek.toString()}
          onValueChange={(v) => setBulkDayOfWeek(parseInt(v))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAYS_OF_WEEK.map((day, index) => (
              <SelectItem key={index} value={index.toString()}>
                {day}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Start Time</Label>
          <Input type="time" value={bulkStartTime} onChange={(e) => setBulkStartTime(e.target.value)} />
        </div>
        <div>
          <Label>End Time</Label>
          <Input type="time" value={bulkEndTime} onChange={(e) => setBulkEndTime(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Check-in Window (mins)</Label>
          <Input type="number" value={bulkCheckinWindow} onChange={(e) => setBulkCheckinWindow(parseInt(e.target.value))} />
        </div>
        <div>
          <Label>Check-out Window (mins)</Label>
          <Input type="number" value={bulkCheckoutWindow} onChange={(e) => setBulkCheckoutWindow(parseInt(e.target.value))} />
        </div>
      </div>

      {bulkPreview.length === 0 ? (
        <Button onClick={handleGenerateBulkPreview} className="w-full" variant="outline">
          Preview Dates
        </Button>
      ) : (
        <div className="space-y-2">
          <Label>Select dates to create ({bulkSelected.size} of {bulkPreview.length})</Label>
          <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1">
            {bulkPreview.map((date) => {
              const key = format(date, 'yyyy-MM-dd');
              return (
                <label key={key} className="flex items-center gap-2 py-1 px-2 hover:bg-slate-50 rounded text-sm">
                  <Checkbox
                    checked={bulkSelected.has(key)}
                    onCheckedChange={(checked) => {
                      const next = new Set(bulkSelected);
                      if (checked) next.add(key); else next.delete(key);
                      setBulkSelected(next);
                    }}
                  />
                  {format(date, 'EEE, d MMM yyyy')}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  )}

  <DialogFooter>
    <Button variant="outline" onClick={() => { setIsAddSlotOpen(false); setIsBulkMode(false); setBulkPreview([]); }}>
      Cancel
    </Button>
    {!isBulkMode ? (
      <Button
        onClick={handleAddSlot}
        disabled={createSlot.isPending || !newSlot.date}
        className="bg-slate-900 hover:bg-slate-800"
      >
        {createSlot.isPending ? 'Creating...' : 'Create Slot'}
      </Button>
    ) : (
      <Button
        onClick={handleBulkCreate}
        disabled={createSlot.isPending || bulkSelected.size === 0}
        className="bg-slate-900 hover:bg-slate-800"
      >
        {createSlot.isPending ? 'Creating...' : `Create ${bulkSelected.size} Slots`}
      </Button>
    )}
  </DialogFooter>
</DialogContent>
```

- [ ] **Step 7: Update the slot table display**

Replace the table header "Day" with "Date" (line 342):

```tsx
<TableHead>Date</TableHead>
```

Replace the table body cells for day and time (lines 353-358):

```tsx
// OLD:
<TableCell className="font-medium">
  {DAYS_OF_WEEK[slot.day_of_week]}
</TableCell>
<TableCell className="text-slate-600">
  {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
</TableCell>

// NEW:
<TableCell className="font-medium">
  {format(parseISO(slot.start_at), 'd MMM yyyy')}
</TableCell>
<TableCell className="text-slate-600">
  {format(parseISO(slot.start_at), 'HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
</TableCell>
```

The reminder button's `onClick` passes the `slot` object — no change needed since the `slot` object now contains `start_at` instead of `day_of_week`/`start_time`.

**Note on CheckIn.tsx / CheckOut.tsx:** These public pages do NOT reference `day_of_week`, `start_time`, or `end_time`. They only use `slot_id` from URL params. No changes needed.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx
git commit -m "feat(admin): replace day-of-week slot creation with date+time picker and bulk generation"
```

---

## Task 5: Admin Portal — PinCodes, VenueDisplay, PdfExport

**Files:**
- Modify: `apps/admin-portal/src/pages/PinCodes.tsx:159`
- Modify: `apps/admin-portal/src/pages/VenueDisplay.tsx`
- Modify: `apps/admin-portal/src/pages/PdfExport.tsx`
- Modify: `apps/admin-portal/src/utils/pdfGenerator.ts:292-297`

- [ ] **Step 1: Update PinCodes.tsx slot display**

Add import at top:

```typescript
import { format, parseISO } from 'date-fns';
```

Replace line 159:

```tsx
// OLD:
{DAYS_OF_WEEK[slot.day_of_week]} {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}

// NEW:
{format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
```

Remove the `DAYS_OF_WEEK` constant if it exists in this file.

- [ ] **Step 2: Rewrite VenueDisplay.tsx**

Update the `SlotData` interface (lines 8-16):

```typescript
interface SlotData {
  id: string;
  start_at: string;
  end_at: string;
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  campaign: { name: string; venue: string };
}
```

Remove the `DAYS` constant (line 18).

Add `import { format, parseISO } from 'date-fns';` at top.

Rewrite `getPhase()` (lines 21-34):

```typescript
function getPhase(slot: SlotData): SlotPhase {
  const now = new Date();
  const start = new Date(slot.start_at);
  const end = new Date(slot.end_at);
  const checkinOpen = new Date(start.getTime() - slot.checkin_window_minutes * 60000);
  const checkoutClose = new Date(end.getTime() + slot.checkout_window_minutes * 60000);
  if (now < checkinOpen) return "waiting";
  if (now < start) return "checkin";
  if (now < end) return "in-progress";
  if (now < checkoutClose) return "checkout";
  return "ended";
}
```

Update the Supabase query (line 48):

```typescript
// OLD:
.select('id, day_of_week, start_time, end_time, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')

// NEW:
.select('id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')
```

Update the display text (line 88):

```tsx
// OLD:
<p className="text-sm text-slate-500 mt-1">{slot.campaign.venue} &bull; {DAYS[slot.day_of_week]} {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}</p>

// NEW:
<p className="text-sm text-slate-500 mt-1">{slot.campaign.venue} &bull; {format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm')} – {format(parseISO(slot.end_at), 'HH:mm')}</p>
```

- [ ] **Step 3: Update PdfExport.tsx**

Add import: `import { format, parseISO } from 'date-fns';`

Update local `Slot` interface (lines 33-39):

```typescript
interface Slot {
  id: string;
  campaign_id: string;
  start_at: string;
  end_at: string;
}
```

Update local `Invitation` interface (lines 45-48):

```typescript
slot: {
  start_at: string;
  end_at: string;
  campaign: {
    name: string;
    venue: string;
  };
};
```

Update the Supabase query for slots (lines 88-91):

```typescript
.select('id, campaign_id, start_at, end_at')
.eq('campaign_id', selectedCampaign)
.order('start_at');
```

Update the Supabase query for invitations — find this exact `.select()` block:

```typescript
// OLD:
.select(`
  id,
  invitee_name,
  unique_token,
  slot:slots(
    day_of_week,
    start_time,
    end_time,
    campaign:campaigns(name, venue)
  )
`)

// NEW:
.select(`
  id,
  invitee_name,
  unique_token,
  slot:slots(
    start_at,
    end_at,
    campaign:campaigns(name, venue)
  )
`)
```

Update `handleGenerateInvitationCards` (lines 154-156):

```typescript
dayOfWeek: format(parseISO(inv.slot.start_at), 'EEE'),
startTime: format(parseISO(inv.slot.start_at), 'HH:mm'),
endTime: format(parseISO(inv.slot.end_at), 'HH:mm'),
```

Update `handleGeneratePinSheet` (line 176):

```typescript
const slotInfo = `${format(parseISO(selectedSlotData.start_at), 'EEE d MMM yyyy, HH:mm')} - ${format(parseISO(selectedSlotData.end_at), 'HH:mm')}`;
```

Update PDF filename (line 186):

```typescript
doc.save(`pin-sheet-${selectedCampaignData.name}-${format(parseISO(selectedSlotData.start_at), 'yyyy-MM-dd')}.pdf`);
```

Update slot display in Select dropdown (line 248):

```tsx
{format(parseISO(slot.start_at), 'EEE d MMM, HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
```

Remove the `DAYS_OF_WEEK` constant.

- [ ] **Step 4: Update pdfGenerator.ts helpers**

Replace `formatDayOfWeek` (line 292-294):

```typescript
// OLD:
export function formatDayOfWeek(dayNumber: number): string {
  return DAYS_OF_WEEK[dayNumber] || 'Unknown';
}

// NEW:
export function formatSlotDate(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  return date.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
```

Keep `formatTime` as-is — it's still useful for extracting HH:MM from time strings.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/pages/PinCodes.tsx apps/admin-portal/src/pages/VenueDisplay.tsx apps/admin-portal/src/pages/PdfExport.tsx apps/admin-portal/src/utils/pdfGenerator.ts
git commit -m "fix(admin): update PinCodes, VenueDisplay, PdfExport for start_at/end_at"
```

---

## Task 6: Agent Portal Updates

**Files:**
- Modify: `apps/agent-portal/src/pages/Campaigns.tsx:169-171, 187`
- Modify: `apps/agent-portal/src/pages/Invitations.tsx:117`

- [ ] **Step 1: Update Campaigns.tsx**

Add import: `import { format, parseISO } from 'date-fns';`

Remove the `DAYS_OF_WEEK` constant.

Replace slot display (lines 169-171):

```tsx
// OLD:
<div className="font-medium">{DAYS_OF_WEEK[slot.day_of_week]}</div>
<div className="text-sm text-slate-500">
  {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
</div>

// NEW:
<div className="font-medium">{format(parseISO(slot.start_at), 'd MMM yyyy')}</div>
<div className="text-sm text-slate-500">
  {format(parseISO(slot.start_at), 'HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
</div>
```

Replace dialog description (line 187):

```tsx
// OLD:
{selectedSlot && `${DAYS_OF_WEEK[selectedSlot.day_of_week]} ${selectedSlot.start_time.slice(0, 5)} - ${selectedSlot.end_time.slice(0, 5)}`}

// NEW:
{selectedSlot && `${format(parseISO(selectedSlot.start_at), 'd MMM yyyy, HH:mm')} - ${format(parseISO(selectedSlot.end_at), 'HH:mm')}`}
```

- [ ] **Step 2: Update Invitations.tsx**

Add import: `import { format, parseISO } from 'date-fns';`

Remove the `DAYS_OF_WEEK` constant.

Replace slot display (line 117):

```tsx
// OLD:
? `${DAYS_OF_WEEK[invitation.slot.day_of_week]} ${invitation.slot.start_time.slice(0, 5)}`

// NEW:
? `${format(parseISO(invitation.slot.start_at), 'd MMM yyyy, HH:mm')}`
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/pages/Campaigns.tsx apps/agent-portal/src/pages/Invitations.tsx
git commit -m "fix(agent): update slot display to use start_at/end_at"
```

---

## Task 7: Public Pages — slot-time.ts Rewrite

**Files:**
- Modify: `apps/public-pages/src/lib/slot-time.ts`

- [ ] **Step 1: Rewrite the slot phase calculation**

Replace the entire file contents:

```typescript
export type SlotPhase = "waiting" | "checkin" | "in-progress" | "checkout" | "ended";

interface SlotConfig {
  start_at: string; // ISO 8601 datetime
  end_at: string;   // ISO 8601 datetime
  checkin_window_minutes: number;
  checkout_window_minutes: number;
}

export function getCurrentSlotPhase(slot: SlotConfig): SlotPhase {
  const now = new Date();
  const start = new Date(slot.start_at);
  const end = new Date(slot.end_at);

  const checkinOpen = new Date(start.getTime() - slot.checkin_window_minutes * 60000);
  const checkoutClose = new Date(end.getTime() + slot.checkout_window_minutes * 60000);

  if (now < checkinOpen) return "waiting";
  if (now < start) return "checkin";
  if (now < end) return "in-progress";
  if (now < checkoutClose) return "checkout";
  return "ended";
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/public-pages/src/lib/slot-time.ts
git commit -m "feat(public): rewrite slot-time phase calculation for TIMESTAMPTZ"
```

---

## Task 8: Public Pages — Display.tsx

**Files:**
- Modify: `apps/public-pages/src/pages/Display.tsx`

- [ ] **Step 1: Update SlotData interface and imports**

Add import: `import { format, parseISO } from 'date-fns';`

Update `SlotData` interface (lines 7-18):

```typescript
interface SlotData {
  id: string;
  start_at: string;
  end_at: string;
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  campaign: {
    name: string;
    venue: string;
  };
}
```

Remove the `DAYS` constant (line 20).

- [ ] **Step 2: Update the Supabase query**

Replace the select clause (line 67):

```typescript
// OLD:
.select('id, day_of_week, start_time, end_time, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')

// NEW:
.select('id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')
```

- [ ] **Step 3: Update the display text**

Replace line 191:

```tsx
// OLD:
{slot?.campaign.venue} &bull; {DAYS[slot?.day_of_week ?? 0]} {slot?.start_time.slice(0, 5)} – {slot?.end_time.slice(0, 5)}

// NEW:
{slot?.campaign.venue} &bull; {slot ? format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm') : ''} – {slot ? format(parseISO(slot.end_at), 'HH:mm') : ''}
```

- [ ] **Step 4: Commit**

```bash
git add apps/public-pages/src/pages/Display.tsx
git commit -m "fix(public): update Display page for start_at/end_at"
```

---

## Task 9: Edge Function — send-email-reminders

**Files:**
- Modify: `supabase/functions/send-email-reminders/index.ts`

- [ ] **Step 1: Remove getNextOccurrence, update DAYS usage**

Remove `getNextOccurrence()` function (lines 11-20) and `DAYS` constant (line 9).

- [ ] **Step 2: Rewrite buildEmailHtml signature**

```typescript
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

function buildEmailHtml(
  inviteeName: string,
  campaignName: string,
  venue: string,
  startAt: string,
  endAt: string
): string {
  const formattedDate = formatDate(startAt);
  const startTime = formatTime(startAt);
  const endTime = formatTime(endAt);

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
        <tr><td style="color: #64748b; padding: 4px 12px 4px 0;">Time</td><td style="color: #334155;">${startTime} – ${endTime}</td></tr>
      </table>
    </div>
    <p style="margin: 0;">Please arrive on time. We look forward to seeing you!</p>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 3: Update the Supabase slot query**

Replace line 110:

```typescript
// OLD:
.select("id, day_of_week, start_time, end_time, campaign:campaigns(name, venue, end_date)")

// NEW:
.select("id, start_at, end_at, campaign:campaigns(name, venue, end_date)")
```

- [ ] **Step 4: Update the email subject and buildEmailHtml calls**

Replace line 164:

```typescript
// OLD:
const subject = `Reminder: ${campaign.name} — ${DAYS[slot.day_of_week]} ${slot.start_time.slice(0, 5)}`;

// NEW:
const subject = `Reminder: ${campaign.name} — ${formatDate(slot.start_at)}`;
```

Replace the `buildEmailHtml` call (lines 176-183):

```typescript
// OLD:
html: buildEmailHtml(
  r.invitee_name || "Attendee",
  campaign.name,
  campaign.venue,
  slot.day_of_week,
  slot.start_time,
  slot.end_time
),

// NEW:
html: buildEmailHtml(
  r.invitee_name || "Attendee",
  campaign.name,
  campaign.venue,
  slot.start_at,
  slot.end_at
),
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-email-reminders/index.ts
git commit -m "fix(edge-fn): update send-email-reminders for start_at/end_at"
```

---

## Task 10: Typecheck and Final Verification

- [ ] **Step 1: Run typecheck across all packages**

Run: `pnpm -r typecheck`

Expected: 0 errors. If any remain, they are references to `day_of_week`, `start_time`, or `end_time` that were missed.

- [ ] **Step 2: Search for any remaining references**

Run: `grep -r "day_of_week\|start_time\|end_time" --include="*.ts" --include="*.tsx" apps/ packages/ supabase/functions/ | grep -v node_modules | grep -v ".d.ts"`

Expected: No matches related to slot time fields (there may be unrelated matches like CSS animation `start_time` etc., which are fine).

- [ ] **Step 3: Run lint**

Run: `pnpm lint`

Fix any lint errors introduced by the changes.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve typecheck and lint errors from slot datetime migration"
```

---

## Task 11: Deploy

- [ ] **Step 1: Push migration to production**

Run: `npx supabase db push`

This applies the migration to the production database. **Warning:** This deletes all existing slot data and dependent records (invitations, attendance, pin_codes, rewards).

- [ ] **Step 2: Deploy the email reminders edge function**

Run: `npx supabase functions deploy send-email-reminders`

- [ ] **Step 3: Push frontend changes**

Run: `git push origin main`

This triggers Render auto-deploy for all three apps (admin-portal, agent-portal, public-pages).

- [ ] **Step 4: Verify deployment**

Check each app loads without errors:
- Admin Portal: https://martin-admin-portal.onrender.com
- Agent Portal: https://martin-agent-portal.onrender.com
- Public Pages: https://martin-public-pages.onrender.com

- [ ] **Step 5: Smoke test**

1. Log in as admin → Create a campaign with date range
2. Add a single slot with a specific date + time
3. Use bulk generation to create weekly slots
4. Verify slots display with correct date format
5. Check that the PDF export and email reminders work with the new format
