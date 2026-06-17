import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Logo,
} from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';

export function ResetPassword() {
  const navigate = useNavigate();
  // Arriving from the email link, Supabase puts a recovery token in the URL hash.
  // Seed `ready` from the hash to avoid a flash, then confirm via the auth session.
  const [ready, setReady] = useState(
    () => typeof window !== 'undefined' && /access_token|type=recovery/.test(window.location.hash)
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    await supabase.auth.signOut();
    setDone(true);
    setTimeout(() => navigate({ to: '/login' }), 1800);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pb-2">
          <Logo size="lg" showText={false} className="mx-auto mb-4" />
          <CardTitle className="text-2xl font-bold text-foreground">Set a new password</CardTitle>
          <CardDescription className="text-muted-foreground">Choose a new password for your account.</CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {done ? (
            <div className="p-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
              Password updated. Redirecting you to sign in...
            </div>
          ) : !ready ? (
            <div className="space-y-4">
              <div className="p-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
                Open this page from the password reset link in your email. If you came here directly or the link
                expired, request a new one.
              </div>
              <Button asChild variant="outline" className="w-full h-11">
                <Link to="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">{error}</div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="h-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-foreground">Confirm New Password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="h-11"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full h-11 font-medium" disabled={isLoading}>
                {isLoading ? 'Updating...' : 'Update password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
