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
