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
} from '@agent-system/shared-ui';
import { Calendar, MapPin, Clock, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { InvitationStatus } from '@agent-system/shared-types';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const registrationSchema = z.object({
  invitee_name: z.string().min(2, 'Name must be at least 2 characters'),
  invitee_nric: z.string().min(9, 'NRIC must be at least 9 characters'),
  invitee_phone: z.string().min(8, 'Phone number must be at least 8 characters'),
  invitee_email: z.string().email('Invalid email address'),
  invitee_occupation: z.string().min(2, 'Occupation is required'),
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

interface InvitationDetails {
  id: string;
  status: string;
  slot: {
    day_of_week: number;
    start_time: string;
    end_time: string;
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
    defaultValues: {
      invitee_name: '',
      invitee_nric: '',
      invitee_phone: '',
      invitee_email: '',
      invitee_occupation: '',
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
          day_of_week,
          start_time,
          end_time,
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

    const { error: updateError } = await supabase
      .from('invitations')
      .update({
        ...formData,
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
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">Registration Complete!</h2>
            <p className="text-muted-foreground">
              You have successfully registered for the event. Please arrive on time with your NRIC for verification.
            </p>
            <div className="bg-muted p-4 rounded-md text-left">
              <p className="font-medium">{invitation?.slot.campaign.name}</p>
              <p className="text-sm text-muted-foreground">
                {DAYS_OF_WEEK[invitation?.slot.day_of_week ?? 0]},{' '}
                {invitation?.slot.start_time.slice(0, 5)} - {invitation?.slot.end_time.slice(0, 5)}
              </p>
              <p className="text-sm text-muted-foreground">{invitation?.slot.campaign.venue}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Event Registration</CardTitle>
          <CardDescription>
            Complete your registration for the event
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Event Details */}
          <div className="bg-muted p-4 rounded-md space-y-2">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{invitation?.slot.campaign.name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                {DAYS_OF_WEEK[invitation?.slot.day_of_week ?? 0]},{' '}
                {invitation?.slot.start_time.slice(0, 5)} - {invitation?.slot.end_time.slice(0, 5)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{invitation?.slot.campaign.venue}</span>
            </div>
          </div>

          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
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
                    <FormLabel>Full Name (as per IC)</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
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
                    <FormLabel>NRIC Number</FormLabel>
                    <FormControl>
                      <Input placeholder="S1234567A" {...field} />
                    </FormControl>
                    <FormDescription>
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
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+65 9123 4567" {...field} />
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
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} />
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
                    <FormLabel>Occupation</FormLabel>
                    <FormControl>
                      <Input placeholder="Software Engineer" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Registering...' : 'Complete Registration'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
