export type SlotPhase = "waiting" | "checkin" | "in-progress" | "checkout" | "ended";

interface SlotConfig {
  day_of_week: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;   // "HH:MM:SS"
  checkin_window_minutes: number;
  checkout_window_minutes: number;
}

export function getCurrentSlotPhase(slot: SlotConfig): SlotPhase {
  const now = new Date();
  const currentDay = now.getDay();

  if (currentDay !== slot.day_of_week) {
    return "waiting";
  }

  const [startH, startM] = slot.start_time.split(":").map(Number);
  const [endH, endM] = slot.end_time.split(":").map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const checkinStart = startMinutes - slot.checkin_window_minutes;
  const checkoutEnd = endMinutes + slot.checkout_window_minutes;

  if (nowMinutes < checkinStart) return "waiting";
  if (nowMinutes < startMinutes) return "checkin";
  if (nowMinutes < endMinutes) return "in-progress";
  if (nowMinutes < checkoutEnd) return "checkout";
  return "ended";
}
