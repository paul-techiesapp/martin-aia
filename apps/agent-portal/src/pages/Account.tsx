import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
  Button,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  useToast,
  supabase,
  Avatar,
} from '@agent-system/shared-ui';
import { KeyRound, Camera } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyAgentPhoto, useUploadAgentPhoto, useRemoveAgentPhoto } from '../hooks/useAgentPhoto';

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

export function Account() {
  const { user, role, agent, partner } = useAuth();
  const { toast } = useToast();

  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: photoUrl } = useMyAgentPhoto(user?.id);
  const uploadPhoto = useUploadAgentPhoto();
  const removePhoto = useRemoveAgentPhoto();
  const photoBusy = uploadPhoto.isPending || removePhoto.isPending;

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the user re-pick the same file later
    if (!file) return;
    try {
      await uploadPhoto.mutateAsync(file);
      toast({ title: 'Photo updated', description: 'Your profile photo has been saved.' });
    } catch (err) {
      toast({
        title: 'Could not upload photo',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    }
  };

  const handlePhotoRemove = async () => {
    try {
      await removePhoto.mutateAsync();
      toast({ title: 'Photo removed' });
    } catch (err) {
      toast({
        title: 'Could not remove photo',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    }
  };

  const displayName = role === 'partner' ? partner?.name : agent?.name;

  const onSubmit = async (data: PasswordForm) => {
    if (!user?.email) {
      toast({ title: 'Could not update password', description: 'No email is linked to this account.', variant: 'error' });
      return;
    }

    // Re-verify identity with the current password before changing it. updateUser
    // does not strictly require this for an authenticated session, but agents and
    // partners may change passwords on shared event/kiosk devices, so we confirm
    // the current password first to prevent a walk-up password change.
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
    <div className="flex flex-col gap-4 animate-fade-in max-w-xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Account</h1>
        <p className="text-sm text-muted-foreground">Manage your account security</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
          <CardDescription>
            {displayName ? `${displayName} · ` : ''}
            {user?.email}
          </CardDescription>
        </CardHeader>
      </Card>

      {agent && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="size-4" />
              Profile Photo
            </CardTitle>
            <CardDescription>
              Upload a photo so your team can recognize you. JPG, PNG, or WebP up to 2 MB.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar src={photoUrl} name={agent.name} size="lg" />
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoBusy}
                >
                  {uploadPhoto.isPending ? 'Uploading…' : photoUrl ? 'Change Photo' : 'Upload Photo'}
                </Button>
                {photoUrl && (
                  <Button type="button" variant="outline" onClick={handlePhotoRemove} disabled={photoBusy}>
                    {removePhoto.isPending ? 'Removing…' : 'Remove'}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Change Password
          </CardTitle>
          <CardDescription>Enter your current password, then choose a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
    </div>
  );
}
