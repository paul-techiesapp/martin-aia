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
import { CheckCircle, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { InvitationStatus } from '@agent-system/shared-types';

const checkoutSchema = z.object({
  pin_code: z.string().length(6, 'PIN code must be 6 digits'),
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
});

type CheckoutFormData = z.infer<typeof checkoutSchema>;

export function CheckOut() {
  const search = useSearch({ strict: false }) as { slot?: string };
  const slotId = search.slot;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState<string>('');

  const form = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      pin_code: '',
      nric: '',
    },
  });

  const onSubmit = async (formData: CheckoutFormData) => {
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
    if (pinCode.linked_nric !== formData.nric) {
      setError('This PIN code is not associated with this NRIC');
      setIsSubmitting(false);
      return;
    }

    // 3. Find the invitation
    const { data: invitation, error: invError } = await supabase
      .from('invitations')
      .select('id, invitee_name, status')
      .eq('invitee_nric', formData.nric)
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
            Enter your PIN code and NRIC to check out
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
                {isSubmitting ? 'Checking out...' : 'Check Out'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
