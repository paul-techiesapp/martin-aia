# Event Duplication Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to duplicate an event (campaign + slots) with date shifting from the event list page.

**Architecture:** A new `useDuplicateCampaign` mutation hook fetches the source campaign and its slots, computes a date offset from the new start date, inserts a new campaign, then batch-inserts date-shifted slots. The UI adds a "Duplicate Event" menu item in CampaignList's dropdown that opens a dialog for new name + dates.

**Tech Stack:** React, TanStack Query, Supabase client, date-fns, shadcn/ui (Dialog, Input, DatePicker)

---

## Chunk 1: Hook + UI

### Task 1: Add `useDuplicateCampaign` hook

**Files:**
- Modify: `apps/admin-portal/src/hooks/useCampaigns.ts` (append after line 117)

- [ ] **Step 1: Add the hook**

Add this code at the end of `apps/admin-portal/src/hooks/useCampaigns.ts`, before the final newline. The existing imports on line 1-3 already cover everything needed (`useQuery`, `useMutation`, `useQueryClient`, `supabase`, `Campaign`). The `Slot` type needs to be added to the import.

First, update the import on line 3:

```typescript
// Change this line:
import type { Campaign, CampaignStatus } from '@agent-system/shared-types';
// To:
import { CampaignStatus } from '@agent-system/shared-types';
import type { Campaign, Slot } from '@agent-system/shared-types';
```

Note: `CampaignStatus` moves from a type-only import to a value import because we use `CampaignStatus.DRAFT` in the hook.

Then append this hook after `useUpdateCampaignStatus`:

```typescript
export function useDuplicateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sourceId,
      newName,
      newStartDate,
      newEndDate,
    }: {
      sourceId: string;
      newName: string;
      newStartDate: string;
      newEndDate: string;
    }) => {
      // 1. Fetch source campaign
      const { data: source, error: sourceError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', sourceId)
        .single();

      if (sourceError || !source) throw sourceError || new Error('Campaign not found');

      // 2. Fetch source slots
      const { data: sourceSlots, error: slotsError } = await supabase
        .from('slots')
        .select('*')
        .eq('campaign_id', sourceId)
        .order('start_at', { ascending: true });

      if (slotsError) throw slotsError;

      // 3. Calculate date offset (local midnight to avoid UTC parsing issues)
      const offset =
        new Date(newStartDate + 'T00:00:00').getTime() -
        new Date(source.start_date + 'T00:00:00').getTime();

      // 4. Insert new campaign
      const { data: newCampaign, error: insertError } = await supabase
        .from('campaigns')
        .insert({
          name: newName,
          venue: source.venue,
          invitation_type: source.invitation_type,
          start_date: newStartDate,
          end_date: newEndDate,
          status: CampaignStatus.DRAFT,
        })
        .select()
        .single();

      if (insertError || !newCampaign) throw insertError || new Error('Failed to create campaign');

      // 5. Shift and insert slots
      if (sourceSlots && sourceSlots.length > 0) {
        const newSlots = sourceSlots.map((slot: Slot) => ({
          campaign_id: newCampaign.id,
          start_at: new Date(new Date(slot.start_at).getTime() + offset).toISOString(),
          end_at: new Date(new Date(slot.end_at).getTime() + offset).toISOString(),
          checkin_window_minutes: slot.checkin_window_minutes,
          checkout_window_minutes: slot.checkout_window_minutes,
          is_active: slot.is_active,
        }));

        const { error: slotsInsertError } = await supabase
          .from('slots')
          .insert(newSlots);

        if (slotsInsertError) throw slotsInsertError;
      }

      return { campaign: newCampaign as Campaign, slotCount: sourceSlots?.length ?? 0 };
    },
    onSuccess: ({ campaign }) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaign.id] });
    },
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/admin-portal && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/admin-portal/src/hooks/useCampaigns.ts
git commit -m "feat(admin): add useDuplicateCampaign hook"
```

---

### Task 2: Add Duplicate Event UI to CampaignList

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignList.tsx`

- [ ] **Step 1: Update imports**

In `apps/admin-portal/src/pages/campaigns/CampaignList.tsx`:

Add `Dialog`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogTitle`, `Input`, `Label`, `DatePicker`, `useToast` to the shared-ui import block (lines 3-32). The full import becomes:

```typescript
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  getStatusVariant,
  TableSkeleton,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  DatePicker,
  useToast,
} from '@agent-system/shared-ui';
```

Update the lucide-react import (line 33) to add `Copy` and `Loader2`:

```typescript
import { Plus, Edit, Trash2, Eye, Play, Pause, MoreHorizontal, Copy, Loader2 } from 'lucide-react';
```

Update the useCampaigns import (line 34) to add `useDuplicateCampaign`:

```typescript
import { useCampaigns, useDeleteCampaign, useUpdateCampaignStatus, useDuplicateCampaign } from '../../hooks/useCampaigns';
```

Add date-fns import after line 35:

```typescript
import { format } from 'date-fns';
```

- [ ] **Step 2: Add state and handlers**

Inside the `CampaignList` component, after the existing `const [deleteId, setDeleteId]` line (line 42), add:

```typescript
  const duplicateCampaign = useDuplicateCampaign();
  const { toast } = useToast();
  const [duplicateSource, setDuplicateSource] = useState<{ id: string; name: string } | null>(null);
  const [dupName, setDupName] = useState('');
  const [dupStartDate, setDupStartDate] = useState<Date | undefined>(undefined);
  const [dupEndDate, setDupEndDate] = useState<Date | undefined>(undefined);

  const handleOpenDuplicate = (id: string, name: string) => {
    setDuplicateSource({ id, name });
    setDupName(`${name} (Copy)`);
    setDupStartDate(undefined);
    setDupEndDate(undefined);
  };

  const handleDuplicate = async () => {
    if (!duplicateSource || !dupName.trim() || !dupStartDate || !dupEndDate) return;

    try {
      const result = await duplicateCampaign.mutateAsync({
        sourceId: duplicateSource.id,
        newName: dupName.trim(),
        newStartDate: format(dupStartDate, 'yyyy-MM-dd'),
        newEndDate: format(dupEndDate, 'yyyy-MM-dd'),
      });

      setDuplicateSource(null);
      toast({
        title: 'Event duplicated',
        description: `Created "${result.campaign.name}" with ${result.slotCount} slot${result.slotCount !== 1 ? 's' : ''}`,
      });
      navigate({ to: '/campaigns/$campaignId', params: { campaignId: result.campaign.id } });
    } catch (err) {
      toast({
        title: 'Duplication failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    }
  };
```

- [ ] **Step 3: Add dropdown menu item**

In the `<DropdownMenuContent>` block, immediately after the "Edit Event" `<DropdownMenuItem>` (after line 148), add:

```typescript
                          <DropdownMenuItem
                            onClick={() => handleOpenDuplicate(campaign.id, campaign.name)}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate Event
                          </DropdownMenuItem>
```

- [ ] **Step 4: Add duplicate dialog**

After the closing `</AlertDialog>` tag (after line 200), and before the closing `</Card>` tag, add:

```typescript
        <Dialog open={!!duplicateSource} onOpenChange={(open) => !open && setDuplicateSource(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Duplicate Event</DialogTitle>
              <DialogDescription>
                Create a copy of this event with new dates. All slots will be shifted to match the new date range.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Event Name</Label>
                <Input
                  value={dupName}
                  onChange={(e) => setDupName(e.target.value)}
                  placeholder="Enter event name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <DatePicker date={dupStartDate} onDateChange={setDupStartDate} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <DatePicker date={dupEndDate} onDateChange={setDupEndDate} />
                </div>
              </div>
              {dupStartDate && dupEndDate && dupEndDate <= dupStartDate && (
                <p className="text-sm text-red-600">End date must be after start date</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDuplicateSource(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleDuplicate}
                disabled={
                  !dupName.trim() ||
                  !dupStartDate ||
                  !dupEndDate ||
                  dupEndDate <= dupStartDate ||
                  duplicateCampaign.isPending
                }
              >
                {duplicateCampaign.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Duplicating...
                  </>
                ) : (
                  'Duplicate'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
```

- [ ] **Step 5: Verify typecheck**

Run: `cd apps/admin-portal && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignList.tsx
git commit -m "feat(admin): add Duplicate Event action to event list"
```

---

### Task 3: Final verification

- [ ] **Step 1: Typecheck all apps**

Run: `cd apps/admin-portal && npx tsc --noEmit && cd ../agent-portal && npx tsc --noEmit && cd ../public-pages && npx tsc --noEmit`
Expected: No errors from any app

- [ ] **Step 2: Search for any issues**

Run: `grep -r "useDuplicateCampaign" apps/admin-portal/src/ --include="*.ts" --include="*.tsx"`
Expected: Two matches — one in `useCampaigns.ts` (definition) and one in `CampaignList.tsx` (usage)

- [ ] **Step 3: Manual test checklist**

1. Open admin portal → Events list
2. Click the `⋯` menu on any event → verify "Duplicate Event" appears after "Edit Event"
3. Click "Duplicate Event" → dialog opens with pre-filled name
4. Enter start/end dates → verify end-before-start validation shows error
5. Enter valid dates → click "Duplicate" → verify loading spinner
6. Verify redirect to new event detail page
7. Verify toast shows correct slot count
8. Verify new event has status "draft"
9. Verify all slots were copied with shifted dates
