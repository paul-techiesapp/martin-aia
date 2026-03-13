import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
} from '@agent-system/shared-ui';
import { Camera, CameraOff, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { RegistrationStatus } from '@agent-system/shared-types';

interface CheckInResult {
  success: boolean;
  name: string;
  message: string;
}

export function CheckInScanner() {
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    startScanner();
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Check-In Scanner</h1>
        <p className="text-muted-foreground">
          Scan invitation card QR codes to check in attendees
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            QR Scanner
          </CardTitle>
          <CardDescription>
            Point the camera at the QR code on the invitation card
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Scanner viewport */}
          <div
            id="qr-reader"
            ref={containerRef}
            className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-slate-100"
            style={{ minHeight: isScanning ? 300 : 0 }}
          />

          {/* Controls */}
          {!isScanning && !result && (
            <div className="flex justify-center">
              <Button onClick={startScanner} size="lg" className="gap-2">
                <Camera className="h-5 w-5" />
                Start Scanner
              </Button>
            </div>
          )}

          {isScanning && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={stopScanner} className="gap-2">
                <CameraOff className="h-5 w-5" />
                Stop Scanner
              </Button>
            </div>
          )}

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
                  <CheckCircle className="h-12 w-12 text-emerald-500" />
                ) : (
                  <XCircle className="h-12 w-12 text-red-500" />
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
                  <RotateCcw className="h-4 w-4" />
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
