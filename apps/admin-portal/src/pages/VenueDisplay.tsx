import { useState, useEffect, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';
import { format, parseISO } from 'date-fns';

type SlotPhase = "waiting" | "checkin" | "in-progress" | "checkout" | "ended";

interface SlotData {
  id: string;
  start_at: string;
  end_at: string;
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  campaign: { name: string; venue: string };
}

const REFRESH_INTERVAL = 60;

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

function getQrMode(phase: SlotPhase): 'checkin' | 'checkout' | null {
  if (phase === 'checkin' || phase === 'in-progress') return 'checkin';
  if (phase === 'checkout') return 'checkout';
  return null;
}

export function VenueDisplay() {
  const { slotId } = useParams({ strict: false });
  const [slot, setSlot] = useState<SlotData | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [phase, setPhase] = useState<SlotPhase>('waiting');
  const [error, setError] = useState<string | null>(null);

  const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || 'https://martin-public-pages.onrender.com';

  useEffect(() => {
    if (!slotId) return;
    supabase
      .from('slots')
      .select('id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')
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

    const mode = getQrMode(p);
    if (!mode) { setQrUrl(''); return; }

    // Try edge function for signed QR URLs
    try {
      const { data } = await supabase.functions.invoke('generate-qr-token', {
        body: { slot_id: slot.id, mode },
      });
      if (data?.url) {
        setQrUrl(`${publicPagesUrl}${data.url}`);
        setCountdown(REFRESH_INTERVAL);
        return;
      }
    } catch {
      // Edge function unavailable — fall through to static URL
    }

    // Fallback: static URL without HMAC signing
    const path = mode === 'checkin' ? '/public/checkin' : '/public/checkout';
    setQrUrl(`${publicPagesUrl}${path}?slot=${slot.id}`);
    setCountdown(REFRESH_INTERVAL);
  }, [slot, publicPagesUrl]);

  useEffect(() => { if (!slot) return; generateQr(); const i = setInterval(generateQr, REFRESH_INTERVAL * 1000); return () => clearInterval(i); }, [slot, generateQr]);

  useEffect(() => {
    const mode = getQrMode(phase);
    if (!mode) return;
    const i = setInterval(() => setCountdown(p => p <= 1 ? REFRESH_INTERVAL : p - 1), 1000);
    return () => clearInterval(i);
  }, [phase]);

  useEffect(() => {
    if (!slot) return;
    const i = setInterval(() => {
      const p = getPhase(slot);
      if (p !== phase) { setPhase(p); generateQr(); }
    }, 30000);
    return () => clearInterval(i);
  }, [slot, phase, generateQr]);

  if (error) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-red-400">{error}</p></div>;
  if (!slot) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-slate-400">Loading...</p></div>;

  const mode = getQrMode(phase);
  const isActive = !!mode;
  const color = mode === 'checkin' ? '#22c55e' : mode === 'checkout' ? '#f59e0b' : '#64748b';
  const labels: Record<SlotPhase, string> = {
    waiting: 'EVENT STARTS SOON',
    checkin: 'CHECK IN',
    'in-progress': 'CHECK IN',
    checkout: 'CHECK OUT',
    ended: 'EVENT ENDED',
  };
  const scanLabel = mode === 'checkin' ? 'check in' : 'check out';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-xs uppercase tracking-[3px] font-semibold" style={{ color: isActive ? color : '#64748b' }}>
        {labels[phase]}
      </div>
      <h1 className="text-2xl font-bold text-white mt-3">{slot.campaign.name}</h1>
      <p className="text-sm text-slate-500 mt-1">
        {slot.campaign.venue} &bull; {format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm')} – {format(parseISO(slot.end_at), 'HH:mm')}
      </p>
      {isActive && qrUrl ? (
        <>
          <div className="mt-8 bg-white p-6 rounded-2xl">
            <QRCodeSVG value={qrUrl} size={280} />
          </div>
          <p className="text-slate-400 text-sm mt-6">Scan to {scanLabel}</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />
            <span className="text-sm text-slate-400">Refreshes in <strong className="text-white">{countdown}s</strong></span>
          </div>
        </>
      ) : (
        <div className="mt-16">
          <p className="text-slate-500 text-lg">{labels[phase]}</p>
        </div>
      )}
    </div>
  );
}
