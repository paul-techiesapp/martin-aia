import { useState, useEffect, useRef } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
  Button,
  Label,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  useToast,
  supabase,
} from '@agent-system/shared-ui';
import type { CompanyBranding } from '@agent-system/shared-types';
import { Upload, Trash2, Image, KeyRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSystemSettings, useUpdateCompanyBranding } from '../hooks/useSystemSettings';
import { useUploadLogo, useDeleteLogo } from '../hooks/useCompanyAssets';
import { Link } from '@tanstack/react-router';

export function Settings() {
  const { data: systemSettings, isLoading } = useSystemSettings();
  const updateBranding = useUpdateCompanyBranding();
  const uploadLogo = useUploadLogo();
  const deleteLogo = useDeleteLogo();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoWidth, setLogoWidth] = useState(20);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (systemSettings) {
      setCompanyName(systemSettings.company_branding.companyName);
      setLogoUrl(systemSettings.company_branding.logoUrl);
      setLogoWidth(systemSettings.company_branding.logoWidth);
    }
  }, [systemSettings]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PNG, JPEG, or SVG image.',
        variant: 'error',
      });
      return;
    }

    // Validate size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Logo must be under 2MB.',
        variant: 'error',
      });
      return;
    }

    setIsUploading(true);
    try {
      const url = await uploadLogo.mutateAsync(file);
      setLogoUrl(url);
      toast({ title: 'Logo uploaded', description: 'Remember to save your changes.' });
    } catch {
      toast({ title: 'Upload failed', description: 'Could not upload logo.', variant: 'error' });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    if (!logoUrl) return;
    try {
      const fileName = logoUrl.split('/').pop();
      if (fileName) await deleteLogo.mutateAsync(fileName);
      setLogoUrl(null);
      toast({ title: 'Logo removed', description: 'Remember to save your changes.' });
    } catch {
      toast({ title: 'Remove failed', description: 'Could not remove logo.', variant: 'error' });
    }
  };

  const handleSave = async () => {
    const branding: CompanyBranding = {
      companyName,
      logoUrl,
      logoWidth,
    };
    try {
      await updateBranding.mutateAsync(branding);
      toast({ title: 'Settings saved', description: 'Company branding updated successfully.' });
    } catch {
      toast({ title: 'Save failed', description: 'Could not save settings.', variant: 'error' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Company Settings</h1>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Company Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your company branding and logo for invitation cards.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company Branding</CardTitle>
          <CardDescription>
            These settings apply to all invitation cards across the system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo Upload */}
          <div className="space-y-2">
            <Label>Company Logo</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={handleFileSelect}
            />
            {logoUrl ? (
              <div className="flex items-center gap-4">
                <div className="size-20 border rounded-lg flex items-center justify-center bg-muted overflow-hidden">
                  <img
                    src={logoUrl}
                    alt="Company logo"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    <Upload className="size-4 mr-1" />
                    Replace
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveLogo}
                    disabled={deleteLogo.isPending}
                  >
                    <Trash2 className="size-4 mr-1" />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Image className="size-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {isUploading ? 'Uploading...' : 'Click to upload logo (PNG, JPEG, or SVG, max 2MB)'}
                </p>
              </div>
            )}
          </div>

          {/* Company Name */}
          <div className="space-y-2">
            <Label htmlFor="companyName">Company Name</Label>
            <Input
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Enter company name"
            />
          </div>

          {/* Logo Width */}
          <div className="space-y-2">
            <Label htmlFor="logoWidth">Logo Size on Card ({logoWidth}mm)</Label>
            <input
              id="logoWidth"
              type="range"
              min={10}
              max={40}
              value={logoWidth}
              onChange={(e) => setLogoWidth(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10mm</span>
              <span>40mm</span>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={updateBranding.isPending}>
              {updateBranding.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Link to Card Template Editor */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Card Template Editor</p>
              <p className="text-sm text-muted-foreground">
                Customize card design, colors, typography, and layout.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link to="/settings/card-template">Customize card design</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <ChangePasswordCard />
    </div>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(6, 'Please confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type PasswordForm = z.infer<typeof passwordSchema>;

function ChangePasswordCard() {
  const { toast } = useToast();
  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (data: PasswordForm) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      toast({ title: 'Could not update password', description: 'No email is linked to this account.', variant: 'error' });
      return;
    }

    // Re-verify the current password before changing it.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: data.currentPassword,
    });
    if (reauthError) {
      form.setError('currentPassword', { message: 'Current password is incorrect' });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: data.newPassword });
    if (error) {
      toast({ title: 'Could not update password', description: error.message, variant: 'error' });
      return;
    }

    toast({ title: 'Password updated', description: 'Your password has been changed successfully.' });
    form.reset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          Change Password
        </CardTitle>
        <CardDescription>Update the password for your admin account.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm New Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Updating...' : 'Update Password'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
