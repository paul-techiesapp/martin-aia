import { useState, useEffect, useRef } from 'react';
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
  Logo,
  formatSlotTime,
} from '@agent-system/shared-ui';
import { CalendarDays, MapPin, Clock, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toMalaysianE164 } from '../lib/phone';
import { useFormBranding } from '../hooks/useFormBranding';
import { TERMS_AND_CONDITIONS } from '../constants/terms';
import { format, parseISO } from 'date-fns';

// NRIC is required or optional depending on the event's `nric_required` setting.
// invitee_nric stays a plain string here (always present from the controlled
// input); when required, superRefine enforces a minimum length.
const buildRegistrationSchema = (nricRequired: boolean) =>
  z
    .object({
      invitee_name: z.string().min(2, 'Name must be at least 2 characters'),
      invitee_nric: z.string(),
      invitee_phone: z.string().min(8, 'Phone number must be at least 8 characters'),
      invitee_email: z.string().email('Invalid email address'),
      invitee_occupation: z.string().min(2, 'Occupation is required'),
      acceptedTerms: z.boolean().refine((val) => val === true, {
        message: 'You must accept the Terms & Conditions',
      }),
    })
    .superRefine((data, ctx) => {
      if (nricRequired && data.invitee_nric.trim().length < 9) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['invitee_nric'],
          message: 'NRIC must be at least 9 characters',
        });
      }
    });

type RegistrationFormData = z.infer<ReturnType<typeof buildRegistrationSchema>>;

interface AgentLinkDetails {
  id: string;
  is_active: boolean;
  slot: {
    start_at: string;
    end_at: string;
    campaign: {
      name: string;
      venue: string;
      registration_type: string;
      nric_required: boolean;
    };
  };
}

export function Register() {
  const { linkCode } = useParams({ strict: false });
  const [agentLink, setAgentLink] = useState<AgentLinkDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { eventLogoUrl, footerText } = useFormBranding();

  // Whether this event requires NRIC. Defaults to true until the link loads, so
  // the stricter rule applies while data is in flight. A ref keeps the resolver
  // reading the current value without recreating the form when the link loads.
  const nricRequired = agentLink?.slot.campaign.nric_required ?? true;
  const nricRequiredRef = useRef(nricRequired);
  nricRequiredRef.current = nricRequired;

  const form = useForm<RegistrationFormData>({
    resolver: (values, context, options) =>
      zodResolver(buildRegistrationSchema(nricRequiredRef.current))(values, context, options),
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
    if (linkCode) {
      fetchAgentLink(linkCode);
    }
  }, [linkCode]);

  const fetchAgentLink = async (code: string) => {
    setIsLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('agent_links')
      .select(`
        id,
        is_active,
        slot:slots(
          start_at,
          end_at,
          campaign:campaigns(
            name,
            venue,
            registration_type,
            nric_required
          )
        )
      `)
      .eq('link_code', code)
      .single();

    if (error || !data) {
      setError('Invalid or expired registration link');
      setIsLoading(false);
      return;
    }

    if (!data.is_active) {
      setError('This registration link is no longer active');
      setIsLoading(false);
      return;
    }

    setAgentLink(data as unknown as AgentLinkDetails);
    setIsLoading(false);
  };

  const onSubmit = async (formData: RegistrationFormData) => {
    if (!agentLink) return;

    setIsSubmitting(true);
    setError(null);

    const { data: registrationId, error: rpcError } = await supabase.rpc('register_attendee', {
      p_link_code: linkCode,
      p_name: formData.invitee_name,
      // Store NULL (not '') when blank so the partial per-slot NRIC unique index
      // ignores optional-blank registrants instead of colliding on empty strings.
      p_nric: formData.invitee_nric.trim() || null,
      p_phone: toMalaysianE164(formData.invitee_phone),
      p_email: formData.invitee_email,
      p_occupation: formData.invitee_occupation,
    });

    if (rpcError) {
      // Handle specific RPC error codes
      if (rpcError.code === 'P0001') {
        setError('This registration link is no longer active');
      } else if (rpcError.code === 'P0002') {
        setError('Sorry, this event slot is full. No more registrations are available.');
      } else if (rpcError.code === 'P0003') {
        setError('This NRIC has already been registered for this event slot');
      } else if (rpcError.code === 'P0004') {
        setError('This phone number has already been registered for this event slot');
      } else if (rpcError.code === 'P0005') {
        setError('This person has already completed an event and cannot register again.');
      } else if (rpcError.code === 'P0006') {
        setError('This invitation link is not valid for this event. Please contact the person who invited you for an updated link.');
      } else {
        setError('Failed to complete registration. Please try again.');
      }
      setIsSubmitting(false);
      return;
    }

    setIsSuccess(true);
    setIsSubmitting(false);

    // Fire-and-forget: send invitation email if agent has auto-invite enabled
    if (registrationId && formData.invitee_email) {
      supabase.functions.invoke('send-invitation-email', {
        body: { registration_id: registrationId, link_code: linkCode },
      }).catch(() => {
        // Best-effort — registration already succeeded, silently ignore email failures
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-lg bg-card backdrop-blur-sm shadow-2xl border-0">
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

  if (error && !agentLink) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-6 text-center">
            <div className="size-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
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
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-6 text-center space-y-4">
            <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="size-10 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Registration Complete!</h2>
              <p className="text-muted-foreground">
                You have successfully registered for the event. Please arrive on time with your NRIC for verification.
              </p>
            </div>
            <div className="bg-muted p-4 rounded-xl text-left border">
              <p className="font-semibold text-foreground">{agentLink?.slot.campaign.name}</p>
              <p className="text-sm text-muted-foreground">
                {agentLink?.slot.start_at ? `${format(parseISO(agentLink.slot.start_at), 'EEE d MMM yyyy')}, ${formatSlotTime(agentLink.slot.start_at)}` : ''} -{' '}
                {agentLink?.slot.end_at ? formatSlotTime(agentLink.slot.end_at) : ''}
              </p>
              <p className="text-sm text-muted-foreground">{agentLink?.slot.campaign.venue}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
      <Card className="w-full max-w-lg bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          {eventLogoUrl ? (
            <img src={eventLogoUrl} alt="" className="h-20 mx-auto mb-4 object-contain" />
          ) : (
            <Logo size="lg" showText={false} className="mx-auto mb-4" />
          )}
          <CardTitle className="text-xl font-semibold text-foreground">Event Registration</CardTitle>
          <CardDescription className="text-muted-foreground">
            Complete your registration for the event
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-6 pb-8">
          {/* Event Details */}
          <div className="bg-muted p-4 rounded-xl space-y-2 border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-sky-100 flex items-center justify-center">
                <CalendarDays className="size-4 text-sky-600" />
              </div>
              <span className="font-semibold text-foreground">{agentLink?.slot.campaign.name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground ml-10">
              <Clock className="size-4" />
              <span>
                {agentLink?.slot.start_at ? `${format(parseISO(agentLink.slot.start_at), 'EEE d MMM yyyy')}, ${formatSlotTime(agentLink.slot.start_at)}` : ''} -{' '}
                {agentLink?.slot.end_at ? formatSlotTime(agentLink.slot.end_at) : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground ml-10">
              <MapPin className="size-4" />
              <span>{agentLink?.slot.campaign.venue}</span>
            </div>
          </div>

          {error && (
            <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border-red-200 rounded-lg">
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
                    <FormLabel className="text-foreground">Full Name (as per IC)</FormLabel>
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
                    <FormLabel className="text-foreground">
                      NRIC / MyKad Number{!nricRequired && ' (optional)'}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="901020-10-1234" className="h-11" {...field} />
                    </FormControl>
                    <FormDescription className="text-muted-foreground">
                      {nricRequired
                        ? 'Required for event check-in verification'
                        : 'Optional for this event'}
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
                    <FormLabel className="text-foreground">Phone Number</FormLabel>
                    <FormControl>
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
                    <FormLabel className="text-foreground">Email Address</FormLabel>
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
                    <FormLabel className="text-foreground">Occupation</FormLabel>
                    <FormControl>
                      <Input placeholder="Software Engineer" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Terms & Conditions */}
              <div className="border-t pt-4 mt-2">
                <FormLabel className="text-foreground">Terms & Conditions</FormLabel>
                <ScrollArea className="h-[160px] mt-2 rounded-lg border bg-muted p-4">
                  <div className="space-y-3 text-xs text-muted-foreground leading-relaxed pr-4">
                    {TERMS_AND_CONDITIONS.map((section, index) => (
                      <div key={index}>
                        <p className="font-semibold text-foreground">{section.title}</p>
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
                        <FormLabel className="text-sm text-foreground font-normal cursor-pointer">
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
                className="w-full h-11 font-medium mt-2"
                disabled={isSubmitting || !form.formState.isValid}
              >
                {isSubmitting ? 'Registering...' : 'Complete Registration'}
              </Button>
            </form>
          </Form>

          {footerText && (
            <p className="text-xs text-muted-foreground text-center mt-4">{footerText}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
