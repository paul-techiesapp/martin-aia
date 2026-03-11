import { useState, useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@agent-system/shared-ui';
import { CheckCircle, LogOut, MessageSquare, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { InvitationStatus } from '@agent-system/shared-types';

// Step 1: NRIC schema
const nricSchema = z.object({
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
});

// Step 2: PIN schema
const pinSchema = z.object({
  pin_code: z.string().length(6, 'PIN code must be 6 digits'),
});

type NricFormData = z.infer<typeof nricSchema>;
type PinFormData = z.infer<typeof pinSchema>;

export function CheckOut() {
  const search = useSearch({ strict: false }) as { slot?: string; ts?: string; sig?: string };
  const slotId = search.slot;

  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [nric, setNric] = useState('');
  const [sendCount, setSendCount] = useState(0);

  // QR verification states (preserved from Task #4)
  const [isVerifying, setIsVerifying] = useState(false);
  const [isQrValid, setIsQrValid] = useState<boolean | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const hasQrToken = !!(search.ts && search.sig);

  useEffect(() => {
    if (!hasQrToken || !slotId) {
      setIsQrValid(true); // No QR token = legacy flow, allow
      return;
    }

    setIsVerifying(true);
    supabase.functions
      .invoke('verify-qr-token', {
        body: {
          slot_id: slotId,
          mode: 'checkout',
          ts: search.ts,
          sig: search.sig,
        },
      })
      .then(({ data, error }) => {
        if (error || !data?.valid) {
          setIsQrValid(false);
          setQrError(data?.error || 'Invalid QR code');
        } else {
          setIsQrValid(true);
        }
        setIsVerifying(false);
      });
  }, [hasQrToken, slotId]);

  const nricForm = useForm<NricFormData>({
    resolver: zodResolver(nricSchema),
    defaultValues: { nric: '' },
  });

  const pinForm = useForm<PinFormData>({
    resolver: zodResolver(pinSchema),
    defaultValues: { pin_code: '' },
  });

  // Step 1: Send PIN via WhatsApp
  const handleSendPin = async (formData: NricFormData) => {
    setIsSending(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-whatsapp-pin', {
        body: { slot_id: slotId, nric: formData.nric },
      });

      if (fnError) {
        const errorBody = typeof fnError.context === 'object' ? fnError.context : null;
        setError(errorBody?.error || fnError.message || 'Failed to send PIN. Please try again.');
        setIsSending(false);
        return;
      }

      if (!data?.success) {
        setError(data?.error || 'Failed to send PIN. Please try again.');
        setIsSending(false);
        return;
      }

      setNric(formData.nric);
      setMaskedPhone(data.masked_phone);
      setSendCount((prev) => prev + 1);
      setStep(2);
    } catch {
      setError('Failed to connect to server. Please try again.');
    }
    setIsSending(false);
  };

  // Resend PIN
  const handleResendPin = async () => {
    if (sendCount >= 3) return;
    setIsSending(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-whatsapp-pin', {
        body: { slot_id: slotId, nric },
      });

      if (fnError) {
        const errorBody = typeof fnError.context === 'object' ? fnError.context : null;
        setError(errorBody?.error || fnError.message || 'Failed to resend PIN.');
        setIsSending(false);
        return;
      }

      if (!data?.success) {
        setError(data?.error || 'Failed to resend PIN.');
        setIsSending(false);
        return;
      }

      setSendCount((prev) => prev + 1);
      setMaskedPhone(data.masked_phone);
    } catch {
      setError('Failed to connect to server.');
    }
    setIsSending(false);
  };

  // Step 2: Complete checkout with PIN
  const handleCheckout = async (formData: PinFormData) => {
    setIsSubmitting(true);
    setError(null);

    // 1. Find the PIN code
    const { data: pinCode, error: pinError } = await supabase
      .from('pin_codes')
      .select('id, slot_id, linked_nric')
      .eq('code', formData.pin_code)
      .eq('slot_id', slotId)
      .single();

    if (pinError || !pinCode) {
      setError('Invalid PIN code for this slot');
      setIsSubmitting(false);
      return;
    }

    // 2. Verify PIN is linked to this NRIC
    if (pinCode.linked_nric !== nric) {
      setError('This PIN code is not associated with this NRIC');
      setIsSubmitting(false);
      return;
    }

    // 3. Find the invitation
    const { data: invitation, error: invError } = await supabase
      .from('invitations')
      .select('id, invitee_name, status')
      .eq('invitee_nric', nric)
      .eq('slot_id', slotId)
      .eq('status', InvitationStatus.ATTENDED)
      .single();

    if (invError || !invitation) {
      setError('No check-in record found. Please check in first.');
      setIsSubmitting(false);
      return;
    }

    // 4. Find attendance record
    const { data: attendance, error: attError } = await supabase
      .from('attendance')
      .select('id, checkout_time')
      .eq('invitation_id', invitation.id)
      .single();

    if (attError || !attendance) {
      setError('No attendance record found. Please check in first.');
      setIsSubmitting(false);
      return;
    }

    if (attendance.checkout_time) {
      setError('You have already checked out');
      setIsSubmitting(false);
      return;
    }

    // 5. Update attendance record
    const { error: updateError } = await supabase
      .from('attendance')
      .update({
        checkout_time: new Date().toISOString(),
        is_full_attendance: true,
      })
      .eq('id', attendance.id);

    if (updateError) {
      setError('Failed to record check-out. Please try again.');
      setIsSubmitting(false);
      return;
    }

    // 6. Update invitation status to completed
    await supabase
      .from('invitations')
      .update({ status: InvitationStatus.COMPLETED })
      .eq('id', invitation.id);

    setAttendeeName(invitation.invitee_name);
    setIsSuccess(true);
    setIsSubmitting(false);
  };

  // QR verification guard screens
  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0">
          <CardContent className="p-10 text-center">
            <p className="text-slate-600">Verifying QR code...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isQrValid === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0">
          <CardContent className="p-10 text-center space-y-4">
            <p className="text-red-600 font-medium">{qrError}</p>
            <p className="text-slate-500 text-sm">Please scan the current QR code at the venue.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success screen
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-10 text-center space-y-6">
            <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="h-10 w-10 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-emerald-600">Check-Out Successful!</h2>
              <p className="text-xl font-semibold text-slate-900 mt-2">{attendeeName}</p>
            </div>
            <p className="text-slate-500">
              Thank you for attending! Your full attendance has been recorded.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
      <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <LogOut className="h-7 w-7 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900">Event Check-Out</CardTitle>
          <CardDescription className="text-slate-500">
            {step === 1
              ? 'Enter your NRIC to receive your PIN via WhatsApp'
              : 'Enter the PIN sent to your WhatsApp'}
          </CardDescription>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= 1 ? 'text-violet-600' : 'text-slate-400'}`}>
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-white text-xs ${step >= 1 ? 'bg-violet-600' : 'bg-slate-300'}`}>
                {step > 1 ? <CheckCircle className="h-4 w-4" /> : '1'}
              </div>
              NRIC
            </div>
            <div className="w-8 h-px bg-slate-300" />
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= 2 ? 'text-violet-600' : 'text-slate-400'}`}>
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-white text-xs ${step >= 2 ? 'bg-violet-600' : 'bg-slate-300'}`}>
                2
              </div>
              PIN
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-6 pb-8">
          {error && (
            <div className="p-3 mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          {step === 1 ? (
            <Form {...nricForm}>
              <form onSubmit={nricForm.handleSubmit(handleSendPin)} className="space-y-4">
                <FormField
                  control={nricForm.control}
                  name="nric"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-700">NRIC Number</FormLabel>
                      <FormControl>
                        <Input placeholder="S1234567A" className="h-11" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <p className="text-xs text-slate-500">
                  Your PIN code will be sent to the WhatsApp number you registered with.
                </p>

                <Button
                  type="submit"
                  className="w-full h-11 bg-violet-600 hover:bg-violet-700 text-white font-medium mt-2"
                  disabled={isSending}
                >
                  {isSending ? (
                    'Sending...'
                  ) : (
                    <>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Send PIN to WhatsApp
                    </>
                  )}
                </Button>
              </form>
            </Form>
          ) : (
            <>
              {/* WhatsApp confirmation banner */}
              <div className="p-3 mb-4 text-sm bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-emerald-700">PIN sent to WhatsApp</p>
                  <p className="text-emerald-600">{maskedPhone}</p>
                </div>
              </div>

              <Form {...pinForm}>
                <form onSubmit={pinForm.handleSubmit(handleCheckout)} className="space-y-4">
                  <FormField
                    control={pinForm.control}
                    name="pin_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700">PIN Code</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="123456"
                            maxLength={6}
                            className="text-center text-2xl tracking-widest font-mono h-14 bg-slate-50 border-slate-200"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-medium"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      'Checking out...'
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Complete Check Out
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-sm text-slate-500"
                    disabled={isSending || sendCount >= 3}
                    onClick={handleResendPin}
                  >
                    {isSending
                      ? 'Sending...'
                      : sendCount >= 3
                        ? 'Maximum attempts reached'
                        : `Resend PIN (${3 - sendCount} remaining)`}
                  </Button>
                </form>
              </Form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
