import { useState, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Skeleton,
  ScrollArea,
  Checkbox,
} from '@agent-system/shared-ui';
import { Calendar, MapPin, Clock, CheckCircle, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { InvitationStatus } from '@agent-system/shared-types';
import { TERMS_AND_CONDITIONS } from '../constants/terms';
import { format, parseISO } from 'date-fns';

const registrationSchema = z.object({
  invitee_name: z.string().min(2, 'Name must be at least 2 characters'),
  invitee_nric: z.string().min(9, 'NRIC must be at least 9 characters'),
  invitee_phone: z.string().min(8, 'Phone number must be at least 8 characters'),
  invitee_email: z.string().email('Invalid email address'),
  invitee_occupation: z.string().min(2, 'Occupation is required'),
  acceptedTerms: z.boolean().refine((val) => val === true, {
    message: 'You must accept the Terms & Conditions',
  }),
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

interface InvitationDetails {
  id: string;
  status: string;
  slot: {
    start_at: string;
    end_at: string;
    campaign: {
      name: string;
      venue: string;
      invitation_type: string;
    };
  };
}

export function Register() {
  const { token } = useParams({ strict: false });
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    mode: 'onChange',
    defaultValues: {
      invitee_name: '',
      invitee_nric: '',
      invitee_phone: '',
      invitee_email: '',
      invitee_occupation: '',
      acceptedTerms: false,
    },
  });

  useEffect(() => {
    if (token) {
      fetchInvitation(token);
    }
  }, [token]);

  const fetchInvitation = async (token: string) => {
    setIsLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('invitations')
      .select(`
        id,
        status,
        slot:slots(
          start_at,
          end_at,
          campaign:campaigns(
            name,
            venue,
            invitation_type
          )
        )
      `)
      .eq('unique_token', token)
      .single();

    if (error || !data) {
      setError('Invalid or expired invitation link');
      setIsLoading(false);
      return;
    }

    if (data.status !== InvitationStatus.PENDING) {
      setError('This invitation has already been used or has expired');
      setIsLoading(false);
      return;
    }

    setInvitation(data as unknown as InvitationDetails);
    setIsLoading(false);
  };

  const onSubmit = async (formData: RegistrationFormData) => {
    if (!invitation) return;

    setIsSubmitting(true);
    setError(null);

    // Check for duplicate NRIC or phone
    const { data: existingNric } = await supabase
      .from('invitations')
      .select('id')
      .eq('invitee_nric', formData.invitee_nric)
      .neq('id', invitation.id)
      .not('invitee_nric', 'is', null)
      .limit(1);

    if (existingNric && existingNric.length > 0) {
      setError('This NRIC has already been registered for another invitation');
      setIsSubmitting(false);
      return;
    }

    const { data: existingPhone } = await supabase
      .from('invitations')
      .select('id')
      .eq('invitee_phone', formData.invitee_phone)
      .neq('id', invitation.id)
      .not('invitee_phone', 'is', null)
      .limit(1);

    if (existingPhone && existingPhone.length > 0) {
      setError('This phone number has already been registered for another invitation');
      setIsSubmitting(false);
      return;
    }

    const { acceptedTerms, ...registrationData } = formData;

    const { error: updateError } = await supabase
      .from('invitations')
      .update({
        ...registrationData,
        status: InvitationStatus.REGISTERED,
        registered_at: new Date().toISOString(),
      })
      .eq('id', invitation.id);

    if (updateError) {
      setError('Failed to complete registration. Please try again.');
      setIsSubmitting(false);
      return;
    }

    setIsSuccess(true);
    setIsSubmitting(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-lg bg-white/95 backdrop-blur-sm shadow-2xl border-0">
          <CardHeader className="text-center pt-8">
            <Skeleton className="h-12 w-12 rounded-full mx-auto mb-4" />
            <Skeleton className="h-8 w-48 mx-auto mb-2" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-8 text-center">
            <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">!</span>
            </div>
            <p className="text-red-600 font-medium">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
              <h2 className="text-2xl font-bold text-slate-900">Registration Complete!</h2>
              <p className="text-slate-500 mt-2">
                You have successfully registered for the event. Please arrive on time with your NRIC for verification.
              </p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl text-left border border-slate-100">
              <p className="font-semibold text-slate-900">{invitation?.slot.campaign.name}</p>
              <p className="text-sm text-slate-500 mt-1">
                {invitation?.slot.start_at ? format(parseISO(invitation.slot.start_at), 'EEE d MMM yyyy, HH:mm') : ''} -{' '}
                {invitation?.slot.end_at ? format(parseISO(invitation.slot.end_at), 'HH:mm') : ''}
              </p>
              <p className="text-sm text-slate-500">{invitation?.slot.campaign.venue}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
      <Card className="w-full max-w-lg bg-white/95 backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <UserPlus className="h-7 w-7 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900">Event Registration</CardTitle>
          <CardDescription className="text-slate-500">
            Complete your registration for the event
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-8">
          {/* Event Details */}
          <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-sky-100 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-sky-600" />
              </div>
              <span className="font-semibold text-slate-900">{invitation?.slot.campaign.name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 ml-10">
              <Clock className="h-4 w-4" />
              <span>
                {invitation?.slot.start_at ? format(parseISO(invitation.slot.start_at), 'EEE d MMM yyyy, HH:mm') : ''} -{' '}
                {invitation?.slot.end_at ? format(parseISO(invitation.slot.end_at), 'HH:mm') : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 ml-10">
              <MapPin className="h-4 w-4" />
              <span>{invitation?.slot.campaign.venue}</span>
            </div>
          </div>

          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="invitee_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700">Full Name (as per IC)</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invitee_nric"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700">NRIC Number</FormLabel>
                    <FormControl>
                      <Input placeholder="S1234567A" className="h-11" {...field} />
                    </FormControl>
                    <FormDescription className="text-slate-400">
                      Required for event check-in verification
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invitee_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700">Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+65 9123 4567" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invitee_email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700">Email Address</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invitee_occupation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-700">Occupation</FormLabel>
                    <FormControl>
                      <Input placeholder="Software Engineer" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Terms & Conditions */}
              <div className="border-t border-slate-200 pt-4 mt-2">
                <FormLabel className="text-slate-700">Terms & Conditions</FormLabel>
                <ScrollArea className="h-[160px] mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="space-y-3 text-xs text-slate-600 leading-relaxed pr-4">
                    {TERMS_AND_CONDITIONS.map((section, index) => (
                      <div key={index}>
                        <p className="font-semibold text-slate-700">{section.title}</p>
                        <p>{section.body}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <FormField
                  control={form.control}
                  name="acceptedTerms"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm text-slate-700 font-normal cursor-pointer">
                          I have read and agree to the Terms & Conditions
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium mt-2"
                disabled={isSubmitting || !form.formState.isValid}
              >
                {isSubmitting ? 'Registering...' : 'Complete Registration'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
