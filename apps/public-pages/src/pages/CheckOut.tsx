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
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-green-600">Check-Out Successful!</h2>
            <p className="text-lg font-medium">{attendeeName}</p>
            <p className="text-muted-foreground">
              Thank you for attending! Your full attendance has been recorded.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center mx-auto mb-4">
            <LogOut className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Event Check-Out</CardTitle>
          <CardDescription>
            Enter your PIN code and NRIC to check out
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-3 mb-4 text-sm text-destructive bg-destructive/10 rounded-md">
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
                    <FormLabel>PIN Code</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="123456"
                        maxLength={6}
                        className="text-center text-2xl tracking-widest font-mono"
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
                    <FormLabel>NRIC Number</FormLabel>
                    <FormControl>
                      <Input placeholder="S1234567A" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Checking out...' : 'Check Out'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
