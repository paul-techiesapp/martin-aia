import { useEffect, useState } from 'react';
import {
  Button,
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
import { format, parseISO } from 'date-fns';
import type { Slot } from '@agent-system/shared-types';
import { useUpdateSlot } from '../../hooks/useSlots';

interface EditSlotDialogProps {
  slot: Slot | null;
  registrationCount?: number;
  minDate?: string;
  maxDate?: string;
  onClose: () => void;
}

/**
 * Edits a slot IN PLACE (same slot id). Registrations, agent links, PINs and
 * display tokens all reference slots.id, so changing the date/time here keeps
 * every existing registration valid — unlike delete + re-create, which cascades
 * and wipes them.
 */
export function EditSlotDialog({ slot, registrationCount = 0, minDate, maxDate, onClose }: EditSlotDialogProps) {
  const updateSlot = useUpdateSlot();
  const { toast } = useToast();
  const [form, setForm] = useState({
    date: undefined as Date | undefined,
    start_time: '',
    end_time: '',
    checkin_window_minutes: 30,
    checkout_window_minutes: 30,
  });

  useEffect(() => {
    if (!slot) return;
    const start = parseISO(slot.start_at);
    const end = parseISO(slot.end_at);
    setForm({
      date: start,
      start_time: format(start, 'HH:mm'),
      end_time: format(end, 'HH:mm'),
      checkin_window_minutes: slot.checkin_window_minutes,
      checkout_window_minutes: slot.checkout_window_minutes,
    });
  }, [slot]);

  const isInvalidRange = !!form.start_time && !!form.end_time && form.end_time <= form.start_time;

  const handleSave = async () => {
    if (!slot || !form.date || isInvalidRange) return;
    const dateStr = format(form.date, 'yyyy-MM-dd');
    try {
      await updateSlot.mutateAsync({
        id: slot.id,
        start_at: new Date(`${dateStr}T${form.start_time}:00`).toISOString(),
        end_at: new Date(`${dateStr}T${form.end_time}:00`).toISOString(),
        checkin_window_minutes: form.checkin_window_minutes,
        checkout_window_minutes: form.checkout_window_minutes,
      });
      toast({
        title: 'Slot updated',
        description:
          registrationCount > 0
            ? `All ${registrationCount} existing registration(s) are kept. Remember to inform attendees of the new time.`
            : 'The slot has been updated.',
      });
      onClose();
    } catch (err: any) {
      toast({ title: 'Failed to update slot', description: err.message, variant: 'error' });
    }
  };

  return (
    <Dialog open={!!slot} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Slot</DialogTitle>
          <DialogDescription>
            Change the date or time of this slot. Existing registrations stay valid —
            attendees do not need to register again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Date</Label>
            <DatePicker
              date={form.date}
              onDateChange={(d) => setForm({ ...form, date: d })}
              placeholder="Select date"
              disabled={(date) => {
                if (minDate && date < parseISO(minDate)) return true;
                if (maxDate && date > parseISO(maxDate)) return true;
                return false;
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Time</Label>
              <Input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div>
              <Label>End Time</Label>
              <Input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
          </div>
          {isInvalidRange && (
            <p className="text-sm text-red-600">End time must be after the start time.</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Check-in Window (mins)</Label>
              <Input
                type="number"
                value={form.checkin_window_minutes}
                onChange={(e) => setForm({ ...form, checkin_window_minutes: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label>Check-out Window (mins)</Label>
              <Input
                type="number"
                value={form.checkout_window_minutes}
                onChange={(e) => setForm({ ...form, checkout_window_minutes: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          {registrationCount > 0 && (
            <p className="text-sm text-muted-foreground">
              This slot has {registrationCount} registration(s). They will all be kept.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={updateSlot.isPending || !form.date || !form.start_time || !form.end_time || isInvalidRange}
          >
            {updateSlot.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
