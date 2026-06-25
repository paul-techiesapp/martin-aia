import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@agent-system/shared-ui';
import { Camera, CameraOff, CheckCircle, XCircle, RotateCcw, ScanBarcode } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { RegistrationStatus } from '@agent-system/shared-types';
import { useCampaigns } from '../hooks/useCampaigns';

interface AttendeeDetails {
  inviteeName: string;
  capacityType?: 'agent' | 'business_partner' | null;
  campaignName?: string | null;
  venue?: string | null;
  slotStartAt?: string | null;
  slotEndAt?: string | null;
  agentName?: string | null;
  agentCode?: string | null;
}

interface CheckInResult {
  success: boolean;
  name: string;
  message: string;
  details?: AttendeeDetails;
}

function formatCapacityType(type?: string | null): string {
  if (type === 'agent') return 'Agent';
  if (type === 'business_partner') return 'Business Partner';
  return '—';
}

function formatSlotDateTime(startAt?: string | null, endAt?: string | null): string {
  if (!startAt) return '—';
  const start = new Date(startAt);
  const datePart = start.toLocaleString('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const startTime = start.toLocaleString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!endAt) return `${datePart} · ${startTime}`;
  const endTime = new Date(endAt).toLocaleString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart} · ${startTime} – ${endTime}`;
}

type ScanMode = 'camera' | 'scanner';

const MODE_STORAGE_KEY = 'checkin-scanner-mode';
const EVENT_STORAGE_KEY = 'checkin-scanner-event';

// A registration counts toward the expected headcount unless it expired; it
// counts as checked-in once the scanner flips its status to attended/completed.
const COUNTED_STATUSES = ['registered', 'attended', 'completed'];
const CHECKED_IN_STATUSES = ['attended', 'completed'];

/** Live check-in progress (checked-in / expected) for one event's slots. */
async function fetchCheckinProgress(campaignId: string): Promise<{ checkedIn: number; total: number }> {
  const { data: slots, error: slotsError } = await supabase
    .from('slots')
    .select('id')
    .eq('campaign_id', campaignId);
  if (slotsError) throw slotsError;
  const slotIds = (slots ?? []).map((s) => s.id as string);
  if (slotIds.length === 0) return { checkedIn: 0, total: 0 };

  const [totalRes, checkedInRes] = await Promise.all([
    supabase
      .from('registrations')
      .select('*', { count: 'exact', head: true })
      .in('slot_id', slotIds)
      .in('status', COUNTED_STATUSES),
    supabase
      .from('registrations')
      .select('*', { count: 'exact', head: true })
      .in('slot_id', slotIds)
      .in('status', CHECKED_IN_STATUSES),
  ]);
  return { checkedIn: checkedInRes.count ?? 0, total: totalRes.count ?? 0 };
}

export function CheckInScanner() {
  const [mode, setMode] = useState<ScanMode>(() => {
    if (typeof window === 'undefined') return 'camera';
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'scanner' ? 'scanner' : 'camera';
  });
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  // Guards: only one start() in flight, and only one scan result handled at a time.
  // A second Html5Qrcode instance on the same element orphans the first one's
  // camera stream (nothing can stop it until the page is refreshed), so the
  // single instance in scannerRef is reused for the lifetime of the page.
  const isStartingRef = useRef(false);
  const isHandlingScanRef = useRef(false);

  // Live check-in counter, scoped to a chosen event (multiple events may run at
  // once, so the operator picks which one this station is checking in).
  const [counterCampaignId, setCounterCampaignId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(EVENT_STORAGE_KEY) ?? '';
  });
  const { data: campaigns } = useCampaigns();
  const queryClient = useQueryClient();
  const { data: progress } = useQuery({
    queryKey: ['checkin-progress', counterCampaignId],
    queryFn: () => fetchCheckinProgress(counterCampaignId),
    enabled: !!counterCampaignId,
  });

  const handleCounterEventChange = (id: string) => {
    setCounterCampaignId(id);
    window.localStorage.setItem(EVENT_STORAGE_KEY, id);
  };

  const getScanner = (): Html5Qrcode => {
    if (!scannerRef.current) {
      // Accept both 2D QR codes and 1D Code 128 barcodes — invitation cards carry both
      scannerRef.current = new Html5Qrcode('qr-reader', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
        verbose: false,
      });
    }
    return scannerRef.current;
  };

  const startScanner = async () => {
    if (!containerRef.current) return;
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    try {
      const scanner = getScanner();
      if (scanner.isScanning) {
        setIsScanning(true);
        return;
      }
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleScanSuccess,
        () => {}, // Ignore scan failures (no code in frame)
      );
      setIsScanning(true);
    } catch (err) {
      console.error('Camera error:', err);
      setResult({
        success: false,
        name: '',
        message: 'Unable to access camera. Please check permissions.',
      });
    } finally {
      isStartingRef.current = false;
    }
  };

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    if (scanner?.isScanning) {
      try {
        await scanner.stop();
      } catch (err) {
        // stop() throws if a stop is already in flight — never let that
        // propagate into scan handling, or the UI locks up until refresh.
        console.error('Failed to stop scanner:', err);
      }
    }
    setIsScanning(false);
  };

  const handleScanSuccess = async (decodedText: string) => {
    // The camera decode callback fires repeatedly while a code is in frame —
    // process only one scan at a time.
    if (isHandlingScanRef.current) return;
    isHandlingScanRef.current = true;

    try {
      // Expect format: CHECKIN:{registrationId}
      if (!decodedText.startsWith('CHECKIN:')) {
        setResult({
          success: false,
          name: '',
          message: "Invalid code — this doesn't look like an invitation card.",
        });
        return;
      }

      // Pause scanner while processing
      await stopScanner();
      setIsProcessing(true);

      const registrationId = decodedText.replace('CHECKIN:', '');
      // 1. Look up the registration with related slot, campaign, and inviting agent
      const { data: registration, error: regError } = await supabase
        .from('registrations')
        .select(
          'id, invitee_name, status, slot_id, capacity_type, ' +
            'slot:slots(start_at, end_at, campaign:campaigns(name, venue)), ' +
            'agent:agents(name, agent_code)',
        )
        .eq('id', registrationId)
        .single<{
          id: string;
          invitee_name: string;
          status: string;
          slot_id: string;
          capacity_type: 'agent' | 'business_partner' | null;
          slot: {
            start_at: string;
            end_at: string;
            campaign: { name: string; venue: string } | null;
          } | null;
          agent: { name: string; agent_code: string } | null;
        }>();

      if (regError || !registration) {
        setResult({ success: false, name: '', message: 'Registration not found.' });
        return;
      }

      const details: AttendeeDetails = {
        inviteeName: registration.invitee_name,
        capacityType: registration.capacity_type,
        campaignName: registration.slot?.campaign?.name ?? null,
        venue: registration.slot?.campaign?.venue ?? null,
        slotStartAt: registration.slot?.start_at ?? null,
        slotEndAt: registration.slot?.end_at ?? null,
        agentName: registration.agent?.name ?? null,
        agentCode: registration.agent?.agent_code ?? null,
      };

      // 2. Check if already checked in
      const { data: existingAttendance } = await supabase
        .from('attendance')
        .select('id')
        .eq('registration_id', registration.id)
        .single();

      if (existingAttendance) {
        setResult({
          success: false,
          name: registration.invitee_name,
          message: `${registration.invitee_name} has already checked in.`,
          details,
        });
        return;
      }

      // 3. Create attendance record
      const { error: attendanceError } = await supabase
        .from('attendance')
        .insert({
          registration_id: registration.id,
          checkin_time: new Date().toISOString(),
          checkout_time: null,
          is_full_attendance: false,
        });

      if (attendanceError) {
        setResult({
          success: false,
          name: registration.invitee_name,
          message: 'Failed to record check-in.',
          details,
        });
        return;
      }

      // 4. Update registration status
      await supabase
        .from('registrations')
        .update({ status: RegistrationStatus.ATTENDED })
        .eq('id', registration.id);

      // Refresh the live check-in counter for the selected event
      void queryClient.invalidateQueries({ queryKey: ['checkin-progress'] });

      setResult({
        success: true,
        name: registration.invitee_name,
        message: `${registration.invitee_name} checked in successfully!`,
        details,
      });
    } catch {
      setResult({ success: false, name: '', message: 'An error occurred during check-in.' });
    } finally {
      setIsProcessing(false);
      isHandlingScanRef.current = false;
    }
  };

  const handleReset = () => {
    setResult(null);
    setManualInput('');
    if (mode === 'camera') {
      startScanner();
    } else {
      // Refocus the scanner input on next tick so the USB scanner is ready
      setTimeout(() => scannerInputRef.current?.focus(), 0);
    }
  };

  const handleScannerSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = manualInput.trim();
    if (!value || isProcessing) return;
    setManualInput('');
    handleScanSuccess(value);
  };

  const handleModeChange = (next: string) => {
    if (next !== 'camera' && next !== 'scanner') return;
    if (next === mode) return;

    // Stop camera if leaving camera mode
    if (mode === 'camera') {
      void stopScanner();
    }

    setMode(next);
    setResult(null);
    setManualInput('');
    window.localStorage.setItem(MODE_STORAGE_KEY, next);
  };

  // Auto-focus the scanner input when in scanner mode and ready for input
  useEffect(() => {
    // In scanner mode keep the input focused even while a result is on screen,
    // so the operator can scan the next card hands-free without pressing anything.
    if (mode === 'scanner' && !isProcessing) {
      scannerInputRef.current?.focus();
    }
  }, [mode, isProcessing, result]);

  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Check-In Scanner</h1>
        <p className="text-sm text-muted-foreground">
          Scan the QR code or barcode on invitation cards to check in attendees
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {mode === 'camera' ? <Camera className="size-5" /> : <ScanBarcode className="size-5" />}
            Check-In Scanner
          </CardTitle>
          <CardDescription>
            {mode === 'camera'
              ? 'Point the camera at the QR code or barcode on the invitation card'
              : 'Scan the QR code or barcode on the invitation card with the USB scanner'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Event picker + live check-in counter (scanned / expected attendees) */}
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:w-72">
              <Label className="text-sm font-medium">Event</Label>
              <Select value={counterCampaignId} onValueChange={handleCounterEventChange}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select an event to track progress" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {counterCampaignId ? (
              <div className="text-center sm:text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Checked in</p>
                <p className="text-3xl font-semibold tabular-nums leading-tight">
                  {progress?.checkedIn ?? 0}
                  <span className="text-muted-foreground"> / {progress?.total ?? 0}</span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select an event to see live check-in progress.
              </p>
            )}
          </div>

          <Tabs value={mode} onValueChange={handleModeChange}>
            <TabsList className="grid w-full max-w-md mx-auto grid-cols-2">
              <TabsTrigger value="camera" className="gap-2">
                <Camera className="size-4" />
                Camera
              </TabsTrigger>
              <TabsTrigger value="scanner" className="gap-2">
                <ScanBarcode className="size-4" />
                USB Scanner
              </TabsTrigger>
            </TabsList>

            <TabsContent value="camera" className="space-y-4 mt-4">
              {/* Scanner viewport */}
              <div
                id="qr-reader"
                ref={containerRef}
                className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-muted"
                style={{ minHeight: isScanning ? 300 : 0 }}
              />

              {/* Controls */}
              {!isScanning && !result && (
                <div className="flex justify-center">
                  <Button onClick={startScanner} size="lg" className="gap-2">
                    <Camera className="size-5" />
                    Start Scanner
                  </Button>
                </div>
              )}

              {isScanning && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={stopScanner} className="gap-2">
                    <CameraOff className="size-5" />
                    Stop Scanner
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="scanner" className="space-y-4 mt-4">
              {/* The input stays mounted even while a result is shown, so the next
                  scan auto-advances to the next profile — no button press needed. */}
              <form onSubmit={handleScannerSubmit} className="w-full max-w-md mx-auto space-y-2">
                <Input
                  ref={scannerInputRef}
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Scan or type registration code…"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isProcessing}
                  onBlur={() => {
                    // Keep the input focused for the next scan unless we're processing
                    if (!isProcessing) {
                      setTimeout(() => scannerInputRef.current?.focus(), 0);
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground text-center">
                  {result
                    ? 'Scan the next card to check in the next attendee'
                    : 'Scanner is ready — scan a card or press Enter to submit manually'}
                </p>
              </form>
            </TabsContent>
          </Tabs>

          {/* Processing state */}
          {isProcessing && (
            <div className="text-center py-4">
              <p className="text-muted-foreground">Processing check-in...</p>
            </div>
          )}

          {/* Result display */}
          {result && !isProcessing && (
            <div className={`p-6 rounded-lg space-y-4 ${
              result.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
            }`}>
              <div className="text-center space-y-3">
                <div className="flex justify-center">
                  {result.success ? (
                    <CheckCircle className="size-12 text-emerald-500" />
                  ) : (
                    <XCircle className="size-12 text-red-500" />
                  )}
                </div>
                {result.name && (
                  <p className="text-xl font-bold">{result.name}</p>
                )}
                <p className={result.success ? 'text-emerald-700' : 'text-red-700'}>
                  {result.message}
                </p>
                <Badge variant={result.success ? 'active' : 'inactive'}>
                  {result.success ? 'Checked In' : 'Failed'}
                </Badge>
              </div>

              {/* Attendee details */}
              {result.details && (
                <div className="bg-white/70 rounded-md border border-slate-200 p-4 space-y-2 text-sm">
                  {result.details.campaignName && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Campaign</span>
                      <span className="font-medium text-slate-900 text-right">{result.details.campaignName}</span>
                    </div>
                  )}
                  {result.details.venue && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Venue</span>
                      <span className="font-medium text-slate-900 text-right">{result.details.venue}</span>
                    </div>
                  )}
                  {result.details.slotStartAt && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Slot</span>
                      <span className="font-medium text-slate-900 text-right">
                        {formatSlotDateTime(result.details.slotStartAt, result.details.slotEndAt)}
                      </span>
                    </div>
                  )}
                  {result.details.capacityType && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Type</span>
                      <span className="font-medium text-slate-900 text-right">
                        {formatCapacityType(result.details.capacityType)}
                      </span>
                    </div>
                  )}
                  {result.details.agentName && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Invited by</span>
                      <span className="font-medium text-slate-900 text-right">
                        {result.details.agentName}
                        {result.details.agentCode ? ` (${result.details.agentCode})` : ''}
                      </span>
                    </div>
                  )}
                  {result.success && (
                    <div className="flex justify-between gap-3 pt-2 border-t border-slate-200">
                      <span className="text-slate-500">Checked in at</span>
                      <span className="font-medium text-slate-900 text-right">
                        {new Date().toLocaleString('en', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false,
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Camera mode must restart the camera between scans, so it keeps
                  the button. Scanner mode auto-advances on the next scan. */}
              {mode === 'camera' && (
                <div className="flex justify-center pt-1">
                  <Button onClick={handleReset} className="gap-2">
                    <RotateCcw className="size-4" />
                    Scan Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
