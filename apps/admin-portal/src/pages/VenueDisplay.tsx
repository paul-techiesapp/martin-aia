import { useState, useEffect, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';
import { format, parseISO } from 'date-fns';

interface SlotData {
  id: string;
  start_at: string;
  end_at: string;
  campaign: { name: string; venue: string };
}

const REFRESH_INTERVAL = 60;

export function VenueDisplay() {
  const { slotId } = useParams({ strict: false });
  const [slot, setSlot] = useState<SlotData | null>(null);
  const [isCheckoutActive, setIsCheckoutActive] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [error, setError] = useState<string | null>(null);

  const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || 'https://raccagency.com';

  // Fetch slot data on mount
  useEffect(() => {
    if (!slotId) return;
    supabase
      .from('slots')
      .select('id, start_at, end_at, campaign:campaigns(name, venue)')
      .eq('id', slotId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Slot not found'); return; }
        setSlot(data as unknown as SlotData);
      });
  }, [slotId]);

  // Generate signed QR URL
  const generateQr = useCallback(async () => {
    if (!slot) return;

    try {
      const { data } = await supabase.functions.invoke('generate-qr-token', {
        body: { slot_id: slot.id, mode: 'checkout' },
      });
      if (data?.url) {
        setQrUrl(`${publicPagesUrl}${data.url}`);
        setCountdown(REFRESH_INTERVAL);
        return;
      }
    } catch {
      // Edge function unavailable — fall through to static URL
    }

    setQrUrl(`${publicPagesUrl}/public/checkout?slot=${slot.id}`);
    setCountdown(REFRESH_INTERVAL);
  }, [slot, publicPagesUrl]);

  // QR refresh interval — only runs when checkout is active
  useEffect(() => {
    if (!isCheckoutActive || !slot) return;
    generateQr();
    const interval = setInterval(generateQr, REFRESH_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, [isCheckoutActive, slot, generateQr]);

  // Countdown timer — only runs when checkout is active
  useEffect(() => {
    if (!isCheckoutActive) return;
    const interval = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? REFRESH_INTERVAL : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isCheckoutActive]);

  // Clear QR when checkout stops
  useEffect(() => {
    if (!isCheckoutActive) {
      setQrUrl('');
      setCountdown(REFRESH_INTERVAL);
    }
  }, [isCheckoutActive]);

  if (error) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-red-400">{error}</p></div>;
  if (!slot) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><p className="text-slate-400">Loading...</p></div>;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-xs uppercase tracking-[3px] font-semibold" style={{ color: isCheckoutActive ? '#f59e0b' : '#64748b' }}>
        {isCheckoutActive ? 'CHECK OUT' : 'EVENT'}
      </div>
      <h1 className="text-2xl font-bold text-white mt-3">{slot.campaign.name}</h1>
      <p className="text-sm text-slate-500 mt-1">
        {slot.campaign.venue} &bull; {format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm')} – {format(parseISO(slot.end_at), 'HH:mm')}
      </p>

      {isCheckoutActive && qrUrl ? (
        <>
          <div className="mt-8 bg-white p-6 rounded-2xl">
            <QRCodeSVG value={qrUrl} size={280} />
          </div>
          <p className="text-slate-400 text-sm mt-6">Scan to check out</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full animate-pulse bg-amber-500" />
            <span className="text-sm text-slate-400">Refreshes in <strong className="text-white">{countdown}s</strong></span>
          </div>
          <button
            onClick={() => setIsCheckoutActive(false)}
            className="mt-6 px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            Stop Checkout
          </button>
        </>
      ) : (
        <button
          onClick={() => setIsCheckoutActive(true)}
          className="mt-16 px-8 py-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-lg transition-colors"
        >
          Start Checkout
        </button>
      )}
    </div>
  );
}
