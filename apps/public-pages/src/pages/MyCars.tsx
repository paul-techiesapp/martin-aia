import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
  Badge,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Logo,
} from '@agent-system/shared-ui';
import { Car, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useEnquiryFormSettings } from '../hooks/useEnquiryFormSettings';
import { useFormBranding } from '../hooks/useFormBranding';

interface MyCar {
  id: string;
  car_plate: string;
  insurance_expiry_date: string;
  status: 'submitted' | 'quoted' | 'renewed' | 'lost';
  road_tax_renewal: boolean;
}

interface MyCarsContext {
  customer_name: string;
  nric_masked: string;
  vehicles: MyCar[];
}

const addCarSchema = z.object({
  car_plate: z.string().min(1, 'Car plate is required'),
  insurance_expiry_date: z.string().min(1, 'Insurance expiry date is required'),
  road_tax_renewal: z.enum(['yes', 'no']),
});
type AddCarData = z.infer<typeof addCarSchema>;

/**
 * P-codes raised by the self-serve RPCs. P0012 is deliberately identical for a
 * bad token, a revoked token, and someone else's vehicle id — the page must
 * never confirm that a token or a vehicle exists.
 */
function selfServeError(code: string | undefined, fallback: string): string {
  if (code === 'P0012') return 'This link is no longer valid.';
  if (code === 'P0013') return 'This car can no longer be removed. Please contact your agent.';
  if (code === '22023') return 'Please fill in the car plate and insurance expiry date.';
  return fallback;
}

const statusBadgeVariant = (status: MyCar['status']) => {
  switch (status) {
    case 'submitted':
      return 'pending' as const;
    case 'quoted':
      return 'info' as const;
    case 'renewed':
      return 'success' as const;
    case 'lost':
      return 'error' as const;
    default:
      return 'default' as const;
  }
};

const statusLabel = (status: MyCar['status']) => status.charAt(0).toUpperCase() + status.slice(1);

export function MyCars() {
  const { token } = useParams({ strict: false }) as { token: string };
  const { data: formSettings } = useEnquiryFormSettings();
  const formBranding = useFormBranding();

  const [context, setContext] = useState<MyCarsContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MyCar | null>(null);

  const load = async () => {
    const { data, error: rpcError } = await supabase.rpc('get_customer_cars', {
      p_token: token,
    });
    if (rpcError || !data || data.length === 0) {
      setError('This link is no longer valid.');
      setContext(null);
    } else {
      setContext(data[0] as MyCarsContext);
      setError(null);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const form = useForm<AddCarData>({
    resolver: zodResolver(addCarSchema),
    defaultValues: { car_plate: '', insurance_expiry_date: '', road_tax_renewal: 'no' },
  });

  const onAdd = async (values: AddCarData) => {
    setActionError(null);
    const { error: rpcError } = await supabase.rpc('customer_add_vehicle', {
      p_token: token,
      p_car_plate: values.car_plate,
      p_insurance_expiry_date: values.insurance_expiry_date,
      p_road_tax_renewal: values.road_tax_renewal === 'yes',
    });
    if (rpcError) {
      setActionError(selfServeError(rpcError.code, 'Could not add this car. Please try again.'));
      return;
    }
    form.reset();
    await load();
  };

  const onRemove = async () => {
    if (!removeTarget) return;
    setActionError(null);
    const { error: rpcError } = await supabase.rpc('customer_remove_vehicle', {
      p_token: token,
      p_vehicle_id: removeTarget.id,
    });
    setRemoveTarget(null);
    if (rpcError) {
      setActionError(selfServeError(rpcError.code, 'Could not remove this car. Please try again.'));
      return;
    }
    await load();
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  if (error && !context) {
    // Markup copied from Enquiry.tsx:297-310 (red-circle card, no retry, no branding).
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

  // Branding cascade copied from Enquiry.tsx:340-363. Use || not ?? — empty
  // strings must fall through (deliberate, per the Jul 11 fix).
  const headerLogoUrl = formBranding.logoUrl || formSettings?.header_logo_url || null;
  const headerTitle = formSettings?.header_title || 'My Cars';
  const footerText = formBranding.footerText || formSettings?.footer_text || '';

  const vehicles = context?.vehicles ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          {headerLogoUrl ? (
            <img
              src={headerLogoUrl}
              alt="Logo"
              className="mx-auto mb-4 h-20 object-contain"
            />
          ) : (
            <Logo size="lg" showText={false} className="mx-auto mb-4" />
          )}
          <CardTitle className="text-xl font-semibold text-foreground">{headerTitle}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {context?.customer_name} &middot; {context?.nric_masked}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-6 pb-8">
          {actionError && (
            <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border-red-200 rounded-lg">
              {actionError}
            </div>
          )}

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Your Cars</p>
            {vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground">You have no cars listed yet.</p>
            ) : (
              vehicles.map((car) => (
                <div
                  key={car.id}
                  className="rounded-lg border bg-muted p-4 flex items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2">
                    <Car className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{car.car_plate}</p>
                      <p className="text-xs text-muted-foreground">
                        Insurance expiry: {car.insurance_expiry_date}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Road tax renewal: {car.road_tax_renewal ? 'Yes' : 'No'}
                      </p>
                      <Badge variant={statusBadgeVariant(car.status)} className="mt-1">
                        {statusLabel(car.status)}
                      </Badge>
                    </div>
                  </div>
                  {(car.status === 'submitted' || car.status === 'quoted') && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoveTarget(car)}
                      aria-label="Remove car"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="border-t pt-4 mt-2">
            <p className="text-sm font-medium text-foreground">Add a Car</p>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onAdd)} className="space-y-4 mt-2">
                <FormField
                  control={form.control}
                  name="car_plate"
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
                  name="insurance_expiry_date"
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
                  name="road_tax_renewal"
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

                <Button type="submit" className="w-full h-11 font-medium" disabled={form.formState.isSubmitting}>
                  Add Car
                </Button>
              </form>
            </Form>
          </div>

          {footerText && (
            <p className="text-center text-xs text-muted-foreground pt-2">{footerText}</p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Car</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {removeTarget?.car_plate} from your list? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onRemove} className="bg-red-600 hover:bg-red-700">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
