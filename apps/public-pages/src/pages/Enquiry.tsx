import { useState, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { useForm, useFieldArray } from 'react-hook-form';
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
  Skeleton,
  Logo,
} from '@agent-system/shared-ui';
import { Car, Plus, Trash2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toMalaysianE164 } from '../lib/phone';

const enquirySchema = z.object({
  customer_name: z.string().min(2, 'Name must be at least 2 characters'),
  customer_nric: z.string().min(6, 'NRIC / MyKad is required'),
  customer_phone: z.string().min(8, 'Phone number must be at least 8 characters'),
  customer_email: z
    .string()
    .email('Invalid email address')
    .optional()
    .or(z.literal('')),
  vehicles: z
    .array(
      z.object({
        car_plate: z.string().min(1, 'Car plate is required'),
        insurance_expiry_date: z.string().min(1, 'Expiry date is required'),
      }),
    )
    .min(1, 'Add at least one vehicle'),
});

type EnquiryFormData = z.infer<typeof enquirySchema>;

interface BranchContext {
  merchant_name: string;
  merchant_logo_url: string | null;
  branch_name: string;
}

export function Enquiry() {
  const { linkCode } = useParams({ strict: false });
  const [context, setContext] = useState<BranchContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<EnquiryFormData>({
    resolver: zodResolver(enquirySchema),
    mode: 'onChange',
    defaultValues: {
      customer_name: '',
      customer_nric: '',
      customer_phone: '',
      customer_email: '',
      vehicles: [{ car_plate: '', insurance_expiry_date: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'vehicles' });

  useEffect(() => {
    if (linkCode) {
      resolveLink(linkCode);
    }
  }, [linkCode]);

  const resolveLink = async (code: string) => {
    setIsLoading(true);
    setError(null);

    const { data: ctx, error: ctxError } = await supabase.rpc('get_branch_link_context', { p_link_code: code });

    if (ctxError || !ctx || ctx.length === 0) {
      setError('Invalid or inactive enquiry link');
      setIsLoading(false);
      return;
    }

    setContext(ctx[0] as BranchContext);
    setIsLoading(false);
  };

  const onSubmit = async (formData: EnquiryFormData) => {
    setIsSubmitting(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('submit_enquiry', {
      p_link_code: linkCode,
      p_customer_name: formData.customer_name,
      p_customer_nric: formData.customer_nric,
      p_customer_phone: toMalaysianE164(formData.customer_phone),
      p_customer_email: formData.customer_email?.trim() || null,
      p_vehicles: formData.vehicles.map((v) => ({
        car_plate: v.car_plate,
        expiry_date: v.insurance_expiry_date,
      })),
    });

    if (rpcError) {
      if (rpcError.code === 'P0001') {
        setError('This enquiry link is no longer active.');
      } else if (rpcError.code === 'P0006') {
        setError('Please add at least one vehicle.');
      } else if (rpcError.code === 'P0007') {
        setError('One of these vehicles has already been submitted at this branch.');
      } else {
        setError('Failed to submit your enquiry. Please try again.');
      }
      setIsSubmitting(false);
      return;
    }

    setIsSuccess(true);
    setIsSubmitting(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg bg-card backdrop-blur-sm shadow-2xl border-0">
          <CardHeader className="text-center pt-8">
            <Skeleton className="h-12 w-12 rounded-full mx-auto mb-4" />
            <Skeleton className="h-8 w-48 mx-auto mb-2" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !context) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
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
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-6 text-center space-y-4">
            <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="size-10 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Enquiry Received!</h2>
              <p className="text-muted-foreground">
                Thank you. Our team will prepare your car-insurance quotation and be in touch soon.
              </p>
            </div>
            <div className="bg-muted p-4 rounded-xl text-left border">
              <p className="font-semibold text-foreground">{context?.merchant_name}</p>
              <p className="text-sm text-muted-foreground">{context?.branch_name}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          {context?.merchant_logo_url ? (
            <img
              src={context.merchant_logo_url}
              alt={context.merchant_name}
              className="mx-auto mb-4 h-12 w-auto object-contain"
            />
          ) : (
            <Logo size="lg" showText={false} className="mx-auto mb-4" />
          )}
          <CardTitle className="text-xl font-semibold text-foreground">
            {context?.merchant_name} — Gold Gift Enquiry
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Renew your car insurance with us at {context?.branch_name} and receive a gold gift.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-6 pb-8">
          {error && (
            <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="customer_name"
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
                name="customer_nric"
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

              <FormField
                control={form.control}
                name="customer_phone"
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
                name="customer_email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Email Address (optional)</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Vehicles */}
              <div className="border-t pt-4 mt-2 space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel className="text-foreground">Vehicles</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      append({ car_plate: '', insurance_expiry_date: '' })
                    }
                  >
                    <Plus className="size-4 mr-1" /> Add vehicle
                  </Button>
                </div>

                {fields.map((vField, index) => (
                  <div key={vField.id} className="rounded-lg border bg-muted p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <Car className="size-4" /> Vehicle {index + 1}
                      </span>
                      {fields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(index)}
                          aria-label="Remove vehicle"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>

                    <FormField
                      control={form.control}
                      name={`vehicles.${index}.car_plate`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Car Plate</FormLabel>
                          <FormControl>
                            <Input placeholder="WXY 1234" className="h-11" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`vehicles.${index}.insurance_expiry_date`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Insurance Expiry Date</FormLabel>
                          <FormControl>
                            <Input type="date" className="h-11" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ))}
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-medium mt-2"
                disabled={isSubmitting || !form.formState.isValid}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Enquiry'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
