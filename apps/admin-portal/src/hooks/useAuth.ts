import { useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAdmin: boolean;
  /** Organising-team login: may only use Check-In for its assigned events. */
  isEventStaff: boolean;
}

// Event-staff role is read from app_metadata (service-role only); the DB policies
// and admin_check_in enforce the same thing server-side.
const isStaffUser = (user: User | null) => user?.app_metadata?.role === 'event_staff';

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    isLoading: true,
    isAdmin: false,
    isEventStaff: false,
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      const isAdmin = user?.user_metadata?.role === 'admin';
      setAuthState({
        user,
        session,
        isLoading: false,
        isAdmin,
        isEventStaff: !isAdmin && isStaffUser(user),
      });
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const user = session?.user ?? null;
        const isAdmin = user?.user_metadata?.role === 'admin';
        setAuthState({
          user,
          session,
          isLoading: false,
          isAdmin,
          isEventStaff: !isAdmin && isStaffUser(user),
        });
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return {
    ...authState,
    signIn,
    signOut,
  };
}
