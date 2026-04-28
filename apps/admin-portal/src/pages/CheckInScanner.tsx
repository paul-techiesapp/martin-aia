import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@agent-system/shared-ui';
import { Camera, CameraOff, CheckCircle, XCircle, RotateCcw, ScanBarcode } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { RegistrationStatus } from '@agent-system/shared-types';

interface CheckInResult {
  success: boolean;
  name: string;
  message: string;
}

type ScanMode = 'camera' | 'scanner';

const MODE_STORAGE_KEY = 'checkin-scanner-mode';

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

  const startScanner = async () => {
    if (!containerRef.current) return;

    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleScanSuccess,
        () => {}, // Ignore scan failures (no QR in frame)
      );
      setIsScanning(true);
    } catch (err) {
      console.error('Camera error:', err);
      setResult({
        success: false,
        name: '',
        message: 'Unable to access camera. Please check permissions.',
      });
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop();
    }
    setIsScanning(false);
  };

  const handleScanSuccess = async (decodedText: string) => {
    // Expect format: CHECKIN:{registrationId}
    if (!decodedText.startsWith('CHECKIN:')) {
      setResult({
        success: false,
        name: '',
        message: 'Invalid QR code. Please scan an invitation card.',
      });
      return;
    }

    // Pause scanner while processing
    await stopScanner();
    setIsProcessing(true);

    const registrationId = decodedText.replace('CHECKIN:', '');

    try {
      // 1. Look up the registration
      const { data: registration, error: regError } = await supabase
        .from('registrations')
        .select('id, invitee_name, status, slot_id')
        .eq('id', registrationId)
        .single();

      if (regError || !registration) {
        setResult({ success: false, name: '', message: 'Registration not found.' });
        setIsProcessing(false);
        return;
      }

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
        });
        setIsProcessing(false);
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
        setResult({ success: false, name: registration.invitee_name, message: 'Failed to record check-in.' });
        setIsProcessing(false);
        return;
      }

      // 4. Update registration status
      await supabase
        .from('registrations')
        .update({ status: RegistrationStatus.ATTENDED })
        .eq('id', registration.id);

      setResult({
        success: true,
        name: registration.invitee_name,
        message: `${registration.invitee_name} checked in successfully!`,
      });
    } catch {
      setResult({ success: false, name: '', message: 'An error occurred during check-in.' });
    } finally {
      setIsProcessing(false);
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
    if (mode === 'camera' && scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(() => {});
      setIsScanning(false);
    }

    setMode(next);
    setResult(null);
    setManualInput('');
    window.localStorage.setItem(MODE_STORAGE_KEY, next);
  };

  // Auto-focus the scanner input when in scanner mode and ready for input
  useEffect(() => {
    if (mode === 'scanner' && !isProcessing && !result) {
      scannerInputRef.current?.focus();
    }
  }, [mode, isProcessing, result]);

  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Check-In Scanner</h1>
        <p className="text-sm text-muted-foreground">
          Scan invitation card QR codes to check in attendees
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {mode === 'camera' ? <Camera className="size-5" /> : <ScanBarcode className="size-5" />}
            QR Scanner
          </CardTitle>
          <CardDescription>
            {mode === 'camera'
              ? 'Point the camera at the QR code on the invitation card'
              : 'Scan the QR code on the invitation card with the USB scanner'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              {!result && (
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
                      if (!isProcessing && !result) {
                        setTimeout(() => scannerInputRef.current?.focus(), 0);
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Scanner is ready — scan a card or press Enter to submit manually
                  </p>
                </form>
              )}
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
            <div className={`p-6 rounded-lg text-center space-y-3 ${
              result.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
            }`}>
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
              <div className="pt-2">
                <Button onClick={handleReset} className="gap-2">
                  <RotateCcw className="size-4" />
                  Scan Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
