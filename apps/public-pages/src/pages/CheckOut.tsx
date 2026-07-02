import { useState, useEffect, useRef, useCallback } from 'react';
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
  Tabs,
  TabsList,
  TabsTrigger,
  Logo,
} from '@agent-system/shared-ui';
import { CheckCircle, MessageSquare, ArrowRight, Star } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toMalaysianE164 } from '../lib/phone';
import { useFormBranding } from '../hooks/useFormBranding';

// Step 1: Dual identifier schema — NRIC always required + email or phone
const emailIdentifierSchema = z.object({
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
  identifier: z.string().email('Please enter a valid email address'),
});

const phoneIdentifierSchema = z.object({
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
  identifier: z.string().min(8, 'Phone number must be at least 8 characters'),
});

// Step 2: OTP schema
const otpSchema = z.object({
  otp_code: z.string().length(6, 'OTP must be 6 digits'),
});

type IdentifierFormData = z.infer<typeof emailIdentifierSchema>;
type OtpFormData = z.infer<typeof otpSchema>;

export function CheckOut() {
  const search = useSearch({ strict: false }) as { slot?: string; ts?: string; sig?: string };
  const slotId = search.slot;

  const { logoUrl, footerText } = useFormBranding();

  const [step, setStep] = useState<1 | 2>(1);
  const [identifyBy, setIdentifyBy] = useState<'email' | 'phone'>('email');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [sendCount, setSendCount] = useState(0);

  // Countdown timers
  const [otpExpirySeconds, setOtpExpirySeconds] = useState(0);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const otpExpiryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resendCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // QR verification states
  const [isVerifying, setIsVerifying] = useState(false);
  const [isQrValid, setIsQrValid] = useState<boolean | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  // Post-checkout content state
  const [checkoutConfig, setCheckoutConfig] = useState<{
    fb_enabled?: boolean;
    fb_url?: string;
    ig_enabled?: boolean;
    ig_url?: string;
    video_enabled?: boolean;
    video_url?: string;
    rating_enabled?: boolean;
  } | null>(null);
  const [attendanceId, setAttendanceId] = useState<string | null>(null);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);

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

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (otpExpiryRef.current) clearInterval(otpExpiryRef.current);
      if (resendCooldownRef.current) clearInterval(resendCooldownRef.current);
    };
  }, []);

  const startOtpExpiryTimer = useCallback(() => {
    if (otpExpiryRef.current) clearInterval(otpExpiryRef.current);
    setOtpExpirySeconds(300); // 5 minutes
    otpExpiryRef.current = setInterval(() => {
      setOtpExpirySeconds((prev) => {
        if (prev <= 1) {
          if (otpExpiryRef.current) clearInterval(otpExpiryRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const startResendCooldown = useCallback(() => {
    if (resendCooldownRef.current) clearInterval(resendCooldownRef.current);
    setResendCooldownSeconds(60);
    resendCooldownRef.current = setInterval(() => {
      setResendCooldownSeconds((prev) => {
        if (prev <= 1) {
          if (resendCooldownRef.current) clearInterval(resendCooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const identifierForm = useForm<IdentifierFormData>({
    resolver: zodResolver(identifyBy === 'email' ? emailIdentifierSchema : phoneIdentifierSchema),
    defaultValues: { nric: '', identifier: '' },
  });

  const otpForm = useForm<OtpFormData>({
    resolver: zodResolver(otpSchema),
    defaultValues: { otp_code: '' },
  });

  // Reset form when switching identifier type
  useEffect(() => {
    const currentNric = identifierForm.getValues('nric');
    identifierForm.reset({ nric: currentNric, identifier: '' });
    setError(null);
  }, [identifyBy]);

  // Step 1: Send OTP
  const handleSendOtp = async (formData: IdentifierFormData) => {
    setIsSending(true);
    setError(null);

    // For phone identifiers the user types only the local part; prepend +60 so
    // the value matches what was stored at registration (and what OneWaySMS needs).
    const submittedIdentifier =
      identifyBy === 'phone' ? toMalaysianE164(formData.identifier) : formData.identifier;

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/send-checkout-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          slot_id: slotId,
          nric: formData.nric,
          identifier: submittedIdentifier,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'rate_limit_exceeded') {
          setError('Too many OTP requests. Please wait before trying again.');
        } else if (data.error === 'cooldown_active') {
          setError('Please wait before requesting another OTP.');
          if (data.retry_after) {
            setResendCooldownSeconds(data.retry_after);
            startResendCooldown();
          }
        } else if (data.error === 'identifier_mismatch') {
          setError('The email/phone does not match the registration for this NRIC.');
        } else if (data.error === 'registration_not_found') {
          setError('No checked-in attendee found. Please check in first.');
        } else if (data.error === 'not_checked_in') {
          setError('You have not checked in yet. Please check in first.');
        } else if (data.error === 'already_checked_out') {
          setAttendeeName('');
          setCheckoutConfig(data.checkout_config ?? null);
          setAttendanceId(data.attendance_id ?? null);
          setIsSuccess(true);
          setIsSending(false);
          return;
        } else {
          setError(data.message || 'Failed to send OTP. Please try again.');
        }
        setIsSending(false);
        return;
      }

      setIdentifier(submittedIdentifier);
      setMaskedPhone(data.masked_phone);
      setSendCount((prev) => prev + 1);
      startOtpExpiryTimer();
      startResendCooldown();
      setStep(2);
    } catch {
      setError('Failed to connect to server. Please try again.');
    }
    setIsSending(false);
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (sendCount >= 3 || resendCooldownSeconds > 0) return;
    setIsSending(true);
    setError(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/send-checkout-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          slot_id: slotId,
          nric: identifierForm.getValues('nric'),
          identifier,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'cooldown_active') {
          setError('Please wait before requesting another OTP.');
          if (data.retry_after) {
            setResendCooldownSeconds(data.retry_after);
          }
        } else if (data.error === 'rate_limit_exceeded') {
          setError('Maximum OTP attempts reached. Please try again later.');
        } else {
          setError(data.message || 'Failed to resend OTP.');
        }
        setIsSending(false);
        return;
      }

      setSendCount((prev) => prev + 1);
      setMaskedPhone(data.masked_phone);
      startOtpExpiryTimer();
      startResendCooldown();
      setError(null);
    } catch {
      setError('Failed to connect to server.');
    }
    setIsSending(false);
  };

  // Step 2: Verify OTP and complete checkout
  const handleVerifyOtp = async (formData: OtpFormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/verify-checkout-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          slot_id: slotId,
          nric: identifierForm.getValues('nric'),
          identifier,
          code: formData.otp_code,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'invalid_otp') {
          setError('Invalid or expired OTP. Please try again.');
          setIsSubmitting(false);
          return;
        } else if (data.error === 'identifier_mismatch') {
          setError('The email/phone does not match the registration for this NRIC.');
          setIsSubmitting(false);
          return;
        } else if (data.error === 'already_checked_out') {
          setCheckoutConfig(data.checkout_config ?? null);
          setAttendanceId(data.attendance_id ?? null);
          setIsSuccess(true);
          setIsSubmitting(false);
          return;
        } else if (data.error === 'rate_limit_exceeded') {
          setError('Too many attempts. Please request a new OTP.');
          setIsSubmitting(false);
          return;
        } else {
          setError(data.message || 'Failed to verify OTP. Please try again.');
          setIsSubmitting(false);
          return;
        }
      }

      setCheckoutConfig(data.checkout_config ?? null);
      setAttendanceId(data.attendance_id ?? null);
      setIsSuccess(true);
      setIsSubmitting(false);
    } catch {
      setError('Failed to connect to server. Please try again.');
      setIsSubmitting(false);
    }
  };

  // Submit star rating
  const handleSubmitRating = async (rating: number) => {
    if (!attendanceId || ratingSubmitted) return;
    setSelectedRating(rating);
    setIsSubmittingRating(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/submit-checkout-rating`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ attendance_id: attendanceId, rating }),
      });

      if (response.ok) {
        setRatingSubmitted(true);
      }
    } catch {
      // Silently fail — rating is non-critical
    }
    setIsSubmittingRating(false);
  };

  // QR verification guard screens
  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Verifying QR code...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isQrValid === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0">
          <CardContent className="p-6 text-center space-y-4">
            <p className="text-red-600 font-medium">{qrError}</p>
            <p className="text-muted-foreground text-sm">Please scan the current QR code at the venue.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success screen with configurable post-checkout content
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-0">
            {/* Success Header — always shown */}
            <div className="p-8 text-center border-b">
              <div className="flex justify-center mb-4">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="h-12 object-contain" />
                ) : (
                  <Logo size="lg" showText={false} />
                )}
              </div>
              <div className="size-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="size-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-semibold text-emerald-600">Check-Out Successful!</h2>
              {attendeeName && (
                <p className="text-xl font-semibold text-foreground">{attendeeName}</p>
              )}
              <p className="text-muted-foreground">
                Thank you for attending! Your full attendance has been recorded.
              </p>
            </div>

            {/* Video/Photo Embed */}
            {checkoutConfig?.video_enabled && checkoutConfig.video_url && (
              <div className="p-6 border-b">
                <div className="rounded-xl overflow-hidden bg-black aspect-video">
                  <iframe
                    src={checkoutConfig.video_url.replace('watch?v=', 'embed/')}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Event video"
                  />
                </div>
              </div>
            )}

            {/* Star Rating */}
            {checkoutConfig?.rating_enabled && attendanceId && (
              <div className="p-6 border-b text-center">
                <p className="text-sm font-semibold text-foreground mb-3">
                  {ratingSubmitted ? 'Thank you for your feedback!' : 'How was your experience?'}
                </p>
                <div className="flex gap-2 justify-center">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => !ratingSubmitted && handleSubmitRating(star)}
                      disabled={ratingSubmitted || isSubmittingRating}
                      className="transition-transform hover:scale-110 disabled:cursor-default"
                    >
                      <Star
                        className={`size-9 ${
                          selectedRating && star <= selectedRating
                            ? 'fill-amber-400 text-amber-400'
                            : 'fill-none text-muted-foreground/50'
                        }`}
                      />
                    </button>
                  ))}
                </div>
                {!ratingSubmitted && (
                  <p className="text-xs text-muted-foreground mt-2">Tap a star to rate</p>
                )}
              </div>
            )}

            {/* Facebook Follow Button */}
            {checkoutConfig?.fb_enabled && checkoutConfig.fb_url && (
              <div className="p-6">
                <a
                  href={checkoutConfig.fb_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2.5 w-full bg-[#1877f2] hover:bg-[#166fe5] text-white font-semibold py-3 px-5 rounded-xl transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  Follow us on Facebook
                </a>
              </div>
            )}

            {/* Instagram Follow Button */}
            {checkoutConfig?.ig_enabled && checkoutConfig.ig_url && (
              <div className="p-6">
                <a
                  href={checkoutConfig.ig_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2.5 w-full text-white font-semibold py-3 px-5 rounded-xl transition-opacity hover:opacity-90"
                  style={{
                    background:
                      'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                  Follow us on Instagram
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
      <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-12 mx-auto mb-4 object-contain" />
          ) : (
            <Logo size="lg" showText={false} className="mx-auto mb-4" />
          )}
          <CardTitle className="text-xl font-semibold text-foreground">Event Check-Out</CardTitle>
          <CardDescription className="text-muted-foreground">
            {step === 1
              ? 'Enter your NRIC and email or phone to receive an OTP'
              : 'Enter the OTP sent to your WhatsApp'}
          </CardDescription>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= 1 ? 'text-violet-600' : 'text-muted-foreground'}`}>
              <div className={`size-6 rounded-full flex items-center justify-center text-white text-xs ${step >= 1 ? 'bg-violet-600' : 'bg-muted-foreground/30'}`}>
                {step > 1 ? <CheckCircle className="size-4" /> : '1'}
              </div>
              Identify
            </div>
            <div className="w-8 h-px bg-muted-foreground/30" />
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= 2 ? 'text-violet-600' : 'text-muted-foreground'}`}>
              <div className={`size-6 rounded-full flex items-center justify-center text-white text-xs ${step >= 2 ? 'bg-violet-600' : 'bg-muted-foreground/30'}`}>
                2
              </div>
              OTP
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-6 pb-8">
          {error && (
            <div role="alert" className="p-3 mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          {step === 1 ? (
            <>
              <Form {...identifierForm}>
                <form onSubmit={identifierForm.handleSubmit(handleSendOtp)} className="space-y-4">
                  {/* NRIC — always required */}
                  <FormField
                    control={identifierForm.control}
                    name="nric"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">NRIC / MyKad Number</FormLabel>
                        <FormControl>
                          <Input placeholder="901020-10-1234" className="h-11" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Second identifier toggle */}
                  <Tabs
                    value={identifyBy}
                    onValueChange={(val) => setIdentifyBy(val as 'email' | 'phone')}
                    className="mb-0"
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="email">Email</TabsTrigger>
                      <TabsTrigger value="phone">Phone</TabsTrigger>
                    </TabsList>
                  </Tabs>

                  <FormField
                    control={identifierForm.control}
                    name="identifier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">
                          {identifyBy === 'email' ? 'Email Address' : 'Phone Number'}
                        </FormLabel>
                        <FormControl>
                          {identifyBy === 'phone' ? (
                            <div className="relative">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                +60
                              </span>
                              <Input
                                type="tel"
                                inputMode="numeric"
                                placeholder="12-345 6789"
                                className="h-11 pl-12"
                                {...field}
                              />
                            </div>
                          ) : (
                            <Input placeholder="john@example.com" className="h-11" {...field} />
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <p className="text-xs text-muted-foreground">
                    OTP will be sent via WhatsApp to your registered phone number.
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
                        <MessageSquare className="size-4 mr-1.5" />
                        Send OTP to WhatsApp
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </>
          ) : (
            <>
              {/* WhatsApp confirmation banner */}
              <div className="p-3 mb-4 text-sm bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
                <CheckCircle className="size-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-emerald-700">OTP sent to WhatsApp</p>
                  <p className="text-emerald-600">{maskedPhone}</p>
                </div>
              </div>

              {/* OTP expiry timer */}
              {otpExpirySeconds > 0 && (
                <div className="text-center mb-4">
                  <p className="text-xs text-muted-foreground">
                    OTP expires in <span className="font-mono font-medium text-foreground">{formatTime(otpExpirySeconds)}</span>
                  </p>
                </div>
              )}
              {otpExpirySeconds === 0 && step === 2 && (
                <div className="text-center mb-4">
                  <p className="text-xs text-amber-600 font-medium">OTP has expired. Please request a new one.</p>
                </div>
              )}

              <Form {...otpForm}>
                <form onSubmit={otpForm.handleSubmit(handleVerifyOtp)} className="space-y-4">
                  <FormField
                    control={otpForm.control}
                    name="otp_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">OTP Code</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="123456"
                            maxLength={6}
                            inputMode="numeric"
                            autoFocus
                            className="text-center text-2xl tracking-widest font-mono h-14 bg-muted border"
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
                    disabled={isSubmitting || otpExpirySeconds === 0}
                  >
                    {isSubmitting ? (
                      'Verifying...'
                    ) : (
                      <>
                        <ArrowRight className="size-4 mr-1.5" />
                        Complete Check Out
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-sm text-muted-foreground"
                    disabled={isSending || sendCount >= 3 || resendCooldownSeconds > 0}
                    onClick={handleResendOtp}
                  >
                    {isSending
                      ? 'Sending...'
                      : sendCount >= 3
                        ? 'Maximum attempts reached'
                        : resendCooldownSeconds > 0
                          ? `Resend OTP in ${resendCooldownSeconds}s`
                          : `Resend OTP (${3 - sendCount} remaining)`}
                  </Button>
                </form>
              </Form>
            </>
          )}

          {footerText && (
            <p className="text-xs text-muted-foreground text-center mt-4">{footerText}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
