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
  ScrollArea,
  Checkbox,
  Logo,
} from '@agent-system/shared-ui';
import { DEFAULT_ENQUIRY_FORM } from '@agent-system/shared-types';
import { Car, Plus, Trash2, CheckCircle, Paperclip, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toMalaysianE164 } from '../lib/phone';
import { useEnquiryFormSettings } from '../hooks/useEnquiryFormSettings';
import { useFormBranding } from '../hooks/useFormBranding';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const enquirySchema = z.object({
  customer_name: z.string().min(2, 'Name must be at least 2 characters'),
  customer_nric: z.string().min(6, 'NRIC / MyKad is required'),
  customer_phone: z.string().min(8, 'Phone number must be at least 8 characters'),
  customer_email: z.string().email('A valid email is required'),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms & Conditions' }),
  }),
  vehicles: z
    .array(
      z.object({
        car_plate: z.string().min(1, 'Car plate is required'),
        insurance_expiry_date: z.string().min(1, 'Expiry date is required'),
        road_tax_renewal: z.enum(['yes', 'no'], {
          errorMap: () => ({ message: 'Select Yes or No for Road Tax' }),
        }),
      }),
    )
    .min(1, 'Add at least one vehicle'),
});

type EnquiryFormData = z.infer<typeof enquirySchema>;

// A fresh vehicle row. road_tax_renewal starts unselected (undefined at runtime);
// the cast keeps it assignable to the required enum field for RHF append/defaults.
const blankVehicle = (): EnquiryFormData['vehicles'][number] => ({
  car_plate: '',
  insurance_expiry_date: '',
  road_tax_renewal: undefined as unknown as 'yes' | 'no',
});

interface EnquiryContext {
  kind: 'agent' | 'branch';
  agent_name: string | null;
  merchant_name: string | null;
  merchant_logo_url: string | null;
  branch_name: string | null;
}

type Attachment = {
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
};

type SubmitPhase = 'uploading' | 'submitting' | null;

export function Enquiry() {
  const { linkCode } = useParams({ strict: false });
  const [context, setContext] = useState<EnquiryContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleFiles, setVehicleFiles] = useState<Record<string, File[]>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string | null>>({});

  const { data: formSettings } = useEnquiryFormSettings();
  const formBranding = useFormBranding();

  const form = useForm<EnquiryFormData>({
    resolver: zodResolver(enquirySchema),
    mode: 'onChange',
    defaultValues: {
      customer_name: '',
      customer_nric: '',
      customer_phone: '',
      customer_email: '',
      acceptedTerms: false as unknown as true,
      vehicles: [blankVehicle()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'vehicles' });

  // Covernote / Geran is mandatory: every vehicle must have at least one file.
  const allVehiclesHaveFiles =
    fields.length > 0 && fields.every((f) => (vehicleFiles[f.id]?.length ?? 0) > 0);

  useEffect(() => {
    if (linkCode) {
      resolveLink(linkCode);
    }
  }, [linkCode]);

  const resolveLink = async (code: string) => {
    setIsLoading(true);
    setError(null);

    const { data: ctx, error: ctxError } = await supabase.rpc('get_enquiry_context', { p_link_code: code });

    if (ctxError || !ctx || ctx.length === 0) {
      setError('Invalid or inactive enquiry link');
      setIsLoading(false);
      return;
    }

    setContext(ctx[0] as EnquiryContext);
    setIsLoading(false);
  };

  const handleFileChange = (fieldId: string, fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const invalid = files.find(
      (f) => !(f.type.startsWith('image/') || f.type === 'application/pdf') || f.size > MAX_FILE_SIZE,
    );
    if (invalid) {
      setFileErrors((prev) => ({ ...prev, [fieldId]: 'Only images or PDF, up to 10 MB.' }));
      return;
    }
    setFileErrors((prev) => ({ ...prev, [fieldId]: null }));
    setVehicleFiles((prev) => ({
      ...prev,
      [fieldId]: [...(prev[fieldId] ?? []), ...files],
    }));
  };

  const removeFile = (fieldId: string, idx: number) => {
    setVehicleFiles((prev) => ({
      ...prev,
      [fieldId]: (prev[fieldId] ?? []).filter((_, i) => i !== idx),
    }));
  };

  const removeVehicle = (index: number, fieldId: string) => {
    remove(index);
    setVehicleFiles((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const onSubmit = async (formData: EnquiryFormData) => {
    // Covernote / Geran is mandatory — block submit until every vehicle has a file.
    const missingFileErrors: Record<string, string | null> = {};
    let hasMissingFiles = false;
    for (const f of fields) {
      if ((vehicleFiles[f.id]?.length ?? 0) === 0) {
        missingFileErrors[f.id] = 'Please upload the Covernote / Geran for this vehicle.';
        hasMissingFiles = true;
      }
    }
    if (hasMissingFiles) {
      setFileErrors((prev) => ({ ...prev, ...missingFileErrors }));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSubmitPhase('uploading');

    const vehicleAttachments: Attachment[][] = [];

    for (let i = 0; i < fields.length; i++) {
      const fieldId = fields[i].id;
      const files = vehicleFiles[fieldId] ?? [];
      const attachments: Attachment[] = [];

      for (const file of files) {
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${crypto.randomUUID()}/${safeName}`;
        const { data, error: uploadError } = await supabase.storage
          .from('enquiry-attachments')
          .upload(path, file, { contentType: file.type, upsert: false });

        if (uploadError || !data) {
          setError(`Couldn't upload ${file.name}. Please try again.`);
          setIsSubmitting(false);
          setSubmitPhase(null);
          return;
        }

        attachments.push({
          storage_path: data.path,
          file_name: file.name,
          content_type: file.type,
          size_bytes: file.size,
        });
      }

      vehicleAttachments.push(attachments);
    }

    setSubmitPhase('submitting');

    const { error: rpcError } = await supabase.rpc('submit_enquiry', {
      p_link_code: linkCode,
      p_customer_name: formData.customer_name,
      p_customer_nric: formData.customer_nric,
      p_customer_phone: toMalaysianE164(formData.customer_phone),
      p_customer_email: formData.customer_email.trim(),
      p_vehicles: formData.vehicles.map((v, i) => ({
        car_plate: v.car_plate,
        expiry_date: v.insurance_expiry_date,
        road_tax_renewal: v.road_tax_renewal === 'yes',
        attachments: vehicleAttachments[i] ?? [],
      })),
    });

    setSubmitPhase(null);

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
    const thankYouMsg =
      context?.kind === 'branch'
        ? `Thank you. ${context.merchant_name ?? 'The merchant'}${context.branch_name ? ` (${context.branch_name})` : ''} will be in touch with your car-insurance quotation soon.`
        : 'Thank you. Your agent will be in touch with your car-insurance quotation soon.';

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-6 text-center space-y-4">
            <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="size-10 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Enquiry Received!</h2>
              <p className="text-muted-foreground">{thankYouMsg}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Header/footer + T&C copy: admin-editable Settings take priority, then any
  // branch-merchant branding, then the hardcoded defaults (used while settings load).
  const headerLogoUrl =
    formBranding.logoUrl || formSettings?.header_logo_url || context?.merchant_logo_url || null;
  const headerTitle =
    context?.kind === 'branch' && context.merchant_name
      ? `${context.merchant_name} — Gold Gift Enquiry`
      : formSettings?.header_title ?? 'Car Insurance Enquiry — Gold Gift on Renewal';
  const headerSubtitle =
    formSettings?.header_subtitle ??
    'Submit your details and our team will be in touch about your renewal and gold gift.';
  const overlayCopy =
    context?.kind === 'branch'
      ? `Renew your car insurance at ${context.merchant_name ?? 'this merchant'}${context.branch_name ? ` (${context.branch_name})` : ''} and receive a gold gift.`
      : context?.kind === 'agent'
        ? `Submitted via ${context?.agent_name ?? ''}`
        : '';
  const footerText =
    formBranding.footerText || formSettings?.footer_text || DEFAULT_ENQUIRY_FORM.footer_text;

  // T&C body with the DPO contact appended (when not already present in the body).
  const tncBody = formSettings?.tnc_body ?? DEFAULT_ENQUIRY_FORM.tnc_body;
  const dpoContact = formSettings?.dpo_contact ?? DEFAULT_ENQUIRY_FORM.dpo_contact;
  const tncText =
    dpoContact && !tncBody.includes(dpoContact)
      ? `${tncBody}\n\nData Protection Officer (DPO): ${dpoContact}`
      : tncBody;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          {headerLogoUrl ? (
            <img
              src={headerLogoUrl}
              alt={context?.merchant_name ?? 'Logo'}
              className="mx-auto mb-4 h-20 object-contain"
            />
          ) : (
            <Logo size="lg" showText={false} className="mx-auto mb-4" />
          )}
          <CardTitle className="text-xl font-semibold text-foreground">{headerTitle}</CardTitle>
          <CardDescription className="text-muted-foreground">{headerSubtitle}</CardDescription>
          {overlayCopy && (
            <p className="mt-1 text-xs text-muted-foreground">{overlayCopy}</p>
          )}
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
                    <FormLabel className="text-foreground">Email Address</FormLabel>
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
                    onClick={() => append(blankVehicle())}
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
                          onClick={() => removeVehicle(index, vField.id)}
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

                    <FormField
                      control={form.control}
                      name={`vehicles.${index}.road_tax_renewal`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Road Tax Renewal</FormLabel>
                          <FormControl>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant={field.value === 'yes' ? 'default' : 'outline'}
                                className="h-11 flex-1"
                                onClick={() => field.onChange('yes')}
                              >
                                Yes
                              </Button>
                              <Button
                                type="button"
                                variant={field.value === 'no' ? 'default' : 'outline'}
                                className="h-11 flex-1"
                                onClick={() => field.onChange('no')}
                              >
                                No
                              </Button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Per-vehicle document upload (mandatory) */}
                    <div className="space-y-2">
                      <FormLabel className="text-foreground text-sm">
                        Covernote / Geran (required)
                      </FormLabel>
                      <label className="flex items-center gap-2 cursor-pointer rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors">
                        <Paperclip className="size-4 shrink-0" />
                        <span>Choose files</span>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          multiple
                          className="sr-only"
                          onChange={(e) => handleFileChange(vField.id, e.currentTarget.files)}
                        />
                      </label>
                      {fileErrors[vField.id] && (
                        <p className="text-xs text-red-600">{fileErrors[vField.id]}</p>
                      )}
                      {(vehicleFiles[vField.id] ?? []).map((file, fi) => (
                        <div
                          key={fi}
                          className="flex items-center gap-2 rounded-md bg-background px-3 py-1.5 text-sm"
                        >
                          <span className="flex-1 truncate text-foreground">{file.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFile(vField.id, fi)}
                            aria-label={`Remove ${file.name}`}
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Terms & Conditions (PDPA) */}
              <div className="border-t pt-4 mt-2">
                <FormLabel className="text-foreground">Terms & Conditions</FormLabel>
                <ScrollArea className="h-[160px] mt-2 rounded-lg border bg-muted p-4">
                  <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line pr-4">
                    {tncText}
                  </div>
                </ScrollArea>

                <FormField
                  control={form.control}
                  name="acceptedTerms"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-3">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm text-foreground font-normal cursor-pointer">
                          I have read and agree to the Terms &amp; Conditions above
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
                disabled={isSubmitting || !form.formState.isValid || !allVehiclesHaveFiles}
              >
                {isSubmitting
                  ? submitPhase === 'uploading'
                    ? 'Uploading…'
                    : 'Submitting…'
                  : 'Submit Enquiry'}
              </Button>
            </form>
          </Form>

          {footerText && (
            <p className="text-center text-xs text-muted-foreground pt-2">{footerText}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
