import { useState } from 'react';
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
import { CheckCircle, LogIn } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { InvitationStatus } from '@agent-system/shared-types';

const checkinSchema = z.object({
  pin_code: z.string().length(6, 'PIN code must be 6 digits'),
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
});

type CheckinFormData = z.infer<typeof checkinSchema>;

export function CheckIn() {
  const search = useSearch({ strict: false }) as { slot?: string };
  const slotId = search.slot;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState<string>('');

  const form = useForm<CheckinFormData>({
    resolver: zodResolver(checkinSchema),
    defaultValues: {
      pin_code: '',
      nric: '',
    },
  });

  const onSubmit = async (formData: CheckinFormData) => {
    setIsSubmitting(true);
    setError(null);

    // 1. Find the PIN code
    const { data: pinCode, error: pinError } = await supabase
      .from('pin_codes')
      .select('id, slot_id, linked_nric, is_used')
      .eq('code', formData.pin_code)
      .eq('slot_id', slotId)
      .single();

    if (pinError || !pinCode) {
      setError('Invalid PIN code for this slot');
      setIsSubmitting(false);
      return;
    }

    // 2. Check if PIN is already used by someone else
    if (pinCode.is_used && pinCode.linked_nric !== formData.nric) {
      setError('This PIN code has already been used by another attendee');
      setIsSubmitting(false);
      return;
    }

    // 3. Find the invitation with this NRIC for this slot
    const { data: invitation, error: invError } = await supabase
      .from('invitations')
      .select('id, invitee_name, status')
      .eq('invitee_nric', formData.nric)
      .eq('slot_id', slotId)
      .eq('status', InvitationStatus.REGISTERED)
      .single();

    if (invError || !invitation) {
      setError('No registered invitation found for this NRIC. Please ensure you have registered first.');
      setIsSubmitting(false);
      return;
    }

    // 4. Check if already checked in
    const { data: existingAttendance } = await supabase
      .from('attendance')
      .select('id')
      .eq('invitation_id', invitation.id)
      .single();

    if (existingAttendance) {
      setError('You have already checked in for this slot');
      setIsSubmitting(false);
      return;
    }

    // 5. Link PIN to NRIC if not already linked
    if (!pinCode.is_used) {
      await supabase
        .from('pin_codes')
        .update({ linked_nric: formData.nric, is_used: true })
        .eq('id', pinCode.id);
    }

    // 6. Create attendance record
    const { error: attendanceError } = await supabase
      .from('attendance')
      .insert({
        invitation_id: invitation.id,
        pin_code_id: pinCode.id,
        checkin_time: new Date().toISOString(),
        checkout_time: null,
        is_full_attendance: false,
      });

    if (attendanceError) {
      setError('Failed to record check-in. Please try again.');
      setIsSubmitting(false);
      return;
    }

    // 7. Update invitation status
    await supabase
      .from('invitations')
      .update({ status: InvitationStatus.ATTENDED })
      .eq('id', invitation.id);

    setAttendeeName(invitation.invitee_name);
    setIsSuccess(true);
    setIsSubmitting(false);
  };

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
              <h2 className="text-2xl font-bold text-emerald-600">Check-In Successful!</h2>
              <p className="text-xl font-semibold text-slate-900 mt-2">{attendeeName}</p>
            </div>
            <p className="text-slate-500">
              Welcome! Please remember to check out when leaving the event.
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
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <LogIn className="h-7 w-7 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900">Event Check-In</CardTitle>
          <CardDescription className="text-slate-500">
            Enter your PIN code and NRIC to check in
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-8">
          {error && (
            <div className="p-3 mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
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

              <FormField
                control={form.control}
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

              <Button
                type="submit"
                className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium mt-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Checking in...' : 'Check In'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
