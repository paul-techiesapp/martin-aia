import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { getCurrentSlotPhase, type SlotPhase } from '../lib/slot-time';
import { formatSlotTime } from '@agent-system/shared-ui';

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

const REFRESH_INTERVAL = 60;

export function Display() {
  const { slotId } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as { token?: string };
  const displayToken = search.token;

  const [slot, setSlot] = useState<SlotData | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [phase, setPhase] = useState<SlotPhase>('waiting');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Validate display token and fetch slot data
  useEffect(() => {
    async function init() {
      if (!slotId || !displayToken) {
        setError('Invalid display URL');
        setIsLoading(false);
        return;
      }

      // Validate token
      const { data: tokenData, error: tokenError } = await supabase
        .from('display_tokens')
        .select('id, expires_at')
        .eq('slot_id', slotId)
        .eq('token', displayToken)
        .single();

      if (tokenError || !tokenData) {
        setError('Invalid or expired display token');
        setIsLoading(false);
        return;
      }

      if (new Date(tokenData.expires_at) < new Date()) {
        setError('Display token has expired');
        setIsLoading(false);
        return;
      }

      // Fetch slot with campaign
      const { data: slotData, error: slotError } = await supabase
        .from('slots')
        .select('id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, campaign:campaigns(name, venue)')
        .eq('id', slotId)
        .single();

      if (slotError || !slotData) {
        setError('Slot not found');
        setIsLoading(false);
        return;
      }

      setSlot(slotData as unknown as SlotData);
      setIsLoading(false);
    }

    init();
  }, [slotId, displayToken]);

  // Generate QR token
  const generateQr = useCallback(async () => {
    if (!slot) return;

    const currentPhase = getCurrentSlotPhase(slot);
    setPhase(currentPhase);

    if (currentPhase !== 'checkin' && currentPhase !== 'checkout') {
      setQrUrl('');
      return;
    }

    const mode = currentPhase === 'checkin' ? 'checkin' : 'checkout';

    try {
      const { data, error } = await supabase.functions.invoke('generate-qr-token', {
        body: { slot_id: slot.id, mode },
      });

      if (error || !data?.url) {
        console.error('Failed to generate QR token:', error);
        return;
      }

      // Prepend the public pages base URL
      const baseUrl = window.location.origin;
      setQrUrl(`${baseUrl}${data.url}`);
    } catch (err) {
      console.error('QR generation error:', err);
    }

    setCountdown(REFRESH_INTERVAL);
  }, [slot]);

  // Refresh QR every 60 seconds
  useEffect(() => {
    if (!slot) return;

    generateQr();
    const refreshInterval = setInterval(generateQr, REFRESH_INTERVAL * 1000);

    return () => clearInterval(refreshInterval);
  }, [slot, generateQr]);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'checkin' && phase !== 'checkout') return;

    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? REFRESH_INTERVAL : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  // Update phase every 30 seconds
  useEffect(() => {
    if (!slot) return;

    const phaseCheck = setInterval(() => {
      const newPhase = getCurrentSlotPhase(slot);
      if (newPhase !== phase) {
        setPhase(newPhase);
        if (newPhase === 'checkin' || newPhase === 'checkout') {
          generateQr();
        }
      }
    }, 30000);

    return () => clearInterval(phaseCheck);
  }, [slot, phase, generateQr]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-lg">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-red-400 text-lg">{error}</p>
      </div>
    );
  }

  const isActive = phase === 'checkin' || phase === 'checkout';
  const themeColor = phase === 'checkin' ? '#22c55e' : '#f59e0b';

  const phaseLabels: Record<SlotPhase, string> = {
    waiting: 'Event Starts Soon',
    checkin: 'CHECK IN',
    'in-progress': 'Event in Progress',
    checkout: 'CHECK OUT',
    ended: 'Event Ended',
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-xs uppercase tracking-[3px] font-semibold" style={{ color: isActive ? themeColor : '#64748b' }}>
        {phaseLabels[phase]}
      </div>

      <h1 className="text-2xl font-bold text-white mt-3">{slot?.campaign.name}</h1>
      <p className="text-sm text-slate-500">
        {slot?.campaign.venue} &bull; {slot ? `${format(parseISO(slot.start_at), 'd MMM yyyy')}, ${formatSlotTime(slot.start_at)}` : ''} – {slot ? formatSlotTime(slot.end_at) : ''}
      </p>

      {isActive && qrUrl ? (
        <>
          <div className="mt-8 bg-white p-6 rounded-2xl">
            <QRCodeSVG value={qrUrl} size={280} />
          </div>

          <p className="text-slate-400 text-sm mt-6">
            Scan to {phase === 'checkin' ? 'check in' : 'check out'}
          </p>

          <div className="mt-4 inline-flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full">
            <span className="size-2 rounded-full animate-pulse" style={{ backgroundColor: themeColor }} />
            <span className="text-sm text-slate-400">
              Refreshes in <strong className="text-white">{countdown}s</strong>
            </span>
          </div>
        </>
      ) : (
        <div className="mt-16">
          <p className="text-slate-500 text-lg">{phaseLabels[phase]}</p>
        </div>
      )}
    </div>
  );
}
