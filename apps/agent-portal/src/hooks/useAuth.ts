import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { AgentWithTier } from '@agent-system/shared-types';

interface AuthState {
  user: User | null;
  session: Session | null;
  agent: AgentWithTier | null;
  isLoading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    agent: null,
    isLoading: true,
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(prev => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        fetchAgent(session.user.id);
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(prev => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        fetchAgent(session.user.id);
      } else {
        setState(prev => ({ ...prev, agent: null, isLoading: false }));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchAgent = async (userId: string) => {
    const { data, error } = await supabase
      .from('agents')
      .select(`
        *,
        tier:tiers(*)
      `)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error fetching agent:', error);
      setState(prev => ({ ...prev, agent: null, isLoading: false }));
    } else {
      setState(prev => ({ ...prev, agent: data as AgentWithTier, isLoading: false }));
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setState({ user: null, session: null, agent: null, isLoading: false });
  };

  return {
    ...state,
    signIn,
    signOut,
  };
}
