import { useState, useEffect, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';

type SlotPhase = "waiting" | "checkin" | "in-progress" | "checkout" | "ended";

interface SlotData {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  campaign: { name: string; venue: string };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REFRESH_INTERVAL = 60;

function getPhase(slot: SlotData): SlotPhase {
  const now = new Date();
  if (now.getDay() !== slot.day_of_week) return "waiting";
  const [sH, sM] = slot.start_time.split(":").map(Number);
  const [eH, eM] = slot.end_time.split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  if (mins < start - slot.checkin_window_minutes) return "waiting";
  if (mins < start) return "checkin";
  if (mins < end) return "in-progress";
  if (mins < end + slot.checkout_window_minutes) return "checkout";
  return "ended";
}

export function VenueDisplay() {
  const { slotId } = useParams({ strict: false });
  const [slot, setSlot] = useState<SlotData | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [phase, setPhase] = useState<SlotPhase>('waiting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slotId) return;
    supabase
      .from('slots')
      .select('id, day_of_week, start_time, end_time, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')
      .eq('id', slotId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Slot not found'); return; }
        setSlot(data as unknown as SlotData);
      });
  }, [slotId]);

  const generateQr = useCallback(async () => {
    if (!slot) return;
    const p = getPhase(slot);
    setPhase(p);
    if (p !== 'checkin' && p !== 'checkout') { setQrUrl(''); return; }
    const mode = p === 'checkin' ? 'checkin' : 'checkout';
    const { data } = await supabase.functions.invoke('generate-qr-token', {
      body: { slot_id: slot.id, mode },
    });
    if (data?.url) {
      const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
      setQrUrl(`${publicPagesUrl}${data.url}`);
    }
    setCountdown(REFRESH_INTERVAL);
  }, [slot]);

  useEffect(() => { if (!slot) return; generateQr(); const i = setInterval(generateQr, REFRESH_INTERVAL * 1000); return () => clearInterval(i); }, [slot, generateQr]);
  useEffect(() => { if (phase !== 'checkin' && phase !== 'checkout') return; const i = setInterval(() => setCountdown(p => p <= 1 ? REFRESH_INTERVAL : p - 1), 1000); return () => clearInterval(i); }, [phase]);
  useEffect(() => { if (!slot) return; const i = setInterval(() => { const p = getPhase(slot); if (p !== phase) { setPhase(p); generateQr(); } }, 30000); return () => clearInterval(i); }, [slot, phase, generateQr]);

  if (error) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-red-400">{error}</p></div>;
  if (!slot) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-slate-400">Loading...</p></div>;

  const isActive = phase === 'checkin' || phase === 'checkout';
  const color = phase === 'checkin' ? '#22c55e' : '#f59e0b';
  const labels: Record<SlotPhase, string> = { waiting: 'Event Starts Soon', checkin: 'CHECK IN', 'in-progress': 'Event in Progress', checkout: 'CHECK OUT', ended: 'Event Ended' };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-xs uppercase tracking-[3px] font-semibold" style={{ color: isActive ? color : '#64748b' }}>{labels[phase]}</div>
      <h1 className="text-2xl font-bold text-white mt-3">{slot.campaign.name}</h1>
      <p className="text-sm text-slate-500 mt-1">{slot.campaign.venue} &bull; {DAYS[slot.day_of_week]} {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}</p>
      {isActive && qrUrl ? (
        <>
          <div className="mt-8 bg-white p-6 rounded-2xl"><QRCodeSVG value={qrUrl} size={280} /></div>
          <p className="text-slate-400 text-sm mt-6">Scan to {phase === 'checkin' ? 'check in' : 'check out'}</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />
            <span className="text-sm text-slate-400">Refreshes in <strong className="text-white">{countdown}s</strong></span>
          </div>
        </>
      ) : (
        <div className="mt-16"><p className="text-slate-500 text-lg">{labels[phase]}</p></div>
      )}
    </div>
  );
}
