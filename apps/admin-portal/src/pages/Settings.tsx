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
import { DEFAULT_ENQUIRY_FORM, type CompanyBranding, type EnquiryFormSettings } from '@agent-system/shared-types';
import { Upload, Trash2, Image, KeyRound, FileText, Palette } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useSystemSettings,
  useUpdateCompanyBranding,
  useUpdateEnquirySettings,
  useUpdateFormBranding,
} from '../hooks/useSystemSettings';
import { useUploadLogo, useDeleteLogo, useUploadFormImage } from '../hooks/useCompanyAssets';
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

      <EnquiryFormSettingsCard />

      <FormBrandingCard />

      <ChangePasswordCard />
    </div>
  );
}

function EnquiryFormSettingsCard() {
  const { data: systemSettings } = useSystemSettings();
  const updateEnquiry = useUpdateEnquirySettings();
  const uploadFormImage = useUploadFormImage();
  const { toast } = useToast();

  const [giftRate, setGiftRate] = useState(10);
  const [adminEmail, setAdminEmail] = useState('');
  const [form, setForm] = useState<EnquiryFormSettings>(DEFAULT_ENQUIRY_FORM);
  const [uploadingImageKey, setUploadingImageKey] = useState<
    'header_image_url' | 'footer_image_url' | null
  >(null);
  const headerImageInputRef = useRef<HTMLInputElement>(null);
  const footerImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (systemSettings) {
      setGiftRate(systemSettings.customer_gift_rate_pct ?? 10);
      setAdminEmail(systemSettings.admin_notification_email ?? '');
      setForm({ ...DEFAULT_ENQUIRY_FORM, ...(systemSettings.enquiry_form ?? {}) });
    }
  }, [systemSettings]);

  const setField = (key: keyof EnquiryFormSettings, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleImageUpload = async (
    key: 'header_image_url' | 'footer_image_url',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PNG or JPEG image.',
        variant: 'error',
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Image must be under 2MB.',
        variant: 'error',
      });
      return;
    }

    setUploadingImageKey(key);
    try {
      const url = await uploadFormImage.mutateAsync({ file, key });
      setField(key, url);
      toast({ title: 'Image uploaded', description: 'Remember to save your changes.' });
    } catch {
      toast({ title: 'Upload failed', description: 'Could not upload image.', variant: 'error' });
    } finally {
      setUploadingImageKey(null);
      const ref = key === 'header_image_url' ? headerImageInputRef : footerImageInputRef;
      if (ref.current) ref.current.value = '';
    }
  };

  const handleRemoveImage = (key: 'header_image_url' | 'footer_image_url') => setField(key, '');

  const handleSave = async () => {
    try {
      await updateEnquiry.mutateAsync({
        customer_gift_rate_pct: Math.min(100, Math.max(0, giftRate)),
        admin_notification_email: adminEmail.trim() === '' ? null : adminEmail.trim(),
        enquiry_form: form,
      });
      toast({ title: 'Saved', description: 'Enquiry form & gift settings updated.' });
    } catch {
      toast({ title: 'Save failed', description: 'Could not save settings.', variant: 'error' });
    }
  };

  const textareaClass =
    'flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4" />
          Enquiry Form &amp; Gifts
        </CardTitle>
        <CardDescription>
          Configure the public car-insurance enquiry form (header, footer, T&amp;C), the standard customer
          gift rate, and where agent "Get Quote" requests are emailed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="giftRate">Customer Gift Rate (%)</Label>
            <Input
              id="giftRate"
              type="number"
              min={0}
              max={100}
              value={giftRate}
              onChange={(e) => setGiftRate(parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">Gift value = this % of each renewal premium.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adminEmail">Admin Notification Email</Label>
            <Input
              id="adminEmail"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="quotes@raccagency.com"
            />
            <p className="text-xs text-muted-foreground">Recipient for agent "Get Quote" requests. Blank disables emails.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="headerTitle">Form Header Title</Label>
          <Input id="headerTitle" value={form.header_title} onChange={(e) => setField('header_title', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="headerSubtitle">Form Header Subtitle</Label>
          <Input id="headerSubtitle" value={form.header_subtitle} onChange={(e) => setField('header_subtitle', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="headerLogo">Header Logo URL (optional)</Label>
          <Input id="headerLogo" value={form.header_logo_url} onChange={(e) => setField('header_logo_url', e.target.value)} placeholder="https://..." />
        </div>

        <div className="space-y-2">
          <Label>Header Image</Label>
          <input
            ref={headerImageInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => handleImageUpload('header_image_url', e)}
          />
          {form.header_image_url ? (
            <div className="flex items-center gap-4">
              <div className="h-16 w-40 border rounded-lg flex items-center justify-center bg-muted overflow-hidden">
                <img
                  src={form.header_image_url}
                  alt="Header"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => headerImageInputRef.current?.click()}
                  disabled={uploadingImageKey === 'header_image_url'}
                >
                  <Upload className="size-4 mr-1" />
                  Replace
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleRemoveImage('header_image_url')}>
                  <Trash2 className="size-4 mr-1" />
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => headerImageInputRef.current?.click()}
            >
              <Image className="size-6 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm text-muted-foreground">
                {uploadingImageKey === 'header_image_url' ? 'Uploading...' : 'Click to upload header image'}
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Recommended 1600×400 (header) / 1600×200 (footer), PNG or JPEG, max 2MB.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="footerText">Footer Text</Label>
          <Input id="footerText" value={form.footer_text} onChange={(e) => setField('footer_text', e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Footer Image</Label>
          <input
            ref={footerImageInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => handleImageUpload('footer_image_url', e)}
          />
          {form.footer_image_url ? (
            <div className="flex items-center gap-4">
              <div className="h-16 w-40 border rounded-lg flex items-center justify-center bg-muted overflow-hidden">
                <img
                  src={form.footer_image_url}
                  alt="Footer"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => footerImageInputRef.current?.click()}
                  disabled={uploadingImageKey === 'footer_image_url'}
                >
                  <Upload className="size-4 mr-1" />
                  Replace
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleRemoveImage('footer_image_url')}>
                  <Trash2 className="size-4 mr-1" />
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => footerImageInputRef.current?.click()}
            >
              <Image className="size-6 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm text-muted-foreground">
                {uploadingImageKey === 'footer_image_url' ? 'Uploading...' : 'Click to upload footer image'}
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Recommended 1600×400 (header) / 1600×200 (footer), PNG or JPEG, max 2MB.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dpoContact">Data Protection Officer (DPO) Contact</Label>
          <Input id="dpoContact" value={form.dpo_contact} onChange={(e) => setField('dpo_contact', e.target.value)} placeholder="dpo@raccagency.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tncBody">Terms &amp; Conditions (PDPA) Body</Label>
          <textarea
            id="tncBody"
            className={textareaClass}
            value={form.tnc_body}
            onChange={(e) => setField('tnc_body', e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateEnquiry.isPending}>
            {updateEnquiry.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FormBrandingCard() {
  const { data: systemSettings } = useSystemSettings();
  const updateFormBranding = useUpdateFormBranding();
  const { toast } = useToast();

  const [logoUrl, setLogoUrl] = useState('');
  const [footerText, setFooterText] = useState('');
  const [eventLogoUrl, setEventLogoUrl] = useState('');

  useEffect(() => {
    if (systemSettings) {
      setLogoUrl(systemSettings.form_branding?.logo_url ?? '');
      setFooterText(systemSettings.form_branding?.footer_text ?? '');
      setEventLogoUrl(systemSettings.form_branding?.event_logo_url ?? '');
    }
  }, [systemSettings]);

  const handleSave = async () => {
    try {
      await updateFormBranding.mutateAsync({
        logo_url: logoUrl.trim(),
        footer_text: footerText.trim(),
        event_logo_url: eventLogoUrl.trim(),
      });
      toast({ title: 'Saved', description: 'Form branding updated.' });
    } catch {
      toast({ title: 'Save failed', description: 'Could not save settings.', variant: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4" />
          Form Branding
        </CardTitle>
        <CardDescription>
          Logo and footer shown on public-facing forms.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 max-w-2xl">
        <div className="space-y-2">
          <Label htmlFor="formBrandingLogo">Partnership Form Logo URL</Label>
          <Input
            id="formBrandingLogo"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
          />
          <p className="text-xs text-muted-foreground">Shown on the merchant partnership enquiry form.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="formBrandingEventLogo">Event Forms Logo URL</Label>
          <Input
            id="formBrandingEventLogo"
            value={eventLogoUrl}
            onChange={(e) => setEventLogoUrl(e.target.value)}
            placeholder="https://..."
          />
          <p className="text-xs text-muted-foreground">
            Shown on event registration, check-out, and display screens. Leave blank to use the built-in RACC logo.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="formBrandingFooter">Footer Text</Label>
          <Input
            id="formBrandingFooter"
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateFormBranding.isPending}>
            {updateFormBranding.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
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
