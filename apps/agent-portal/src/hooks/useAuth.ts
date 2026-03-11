import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { AgentWithTier, PartnerWithAgent } from '@agent-system/shared-types';

interface AuthState {
  user: User | null;
  session: Session | null;
  agent: AgentWithTier | null;
  partner: PartnerWithAgent | null;
  role: 'agent' | 'partner' | null;
  isLoading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    agent: null,
    partner: null,
    role: null,
    isLoading: true,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(prev => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        fetchUserRole(session.user.id);
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(prev => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        fetchUserRole(session.user.id);
      } else {
        setState(prev => ({ ...prev, agent: null, partner: null, role: null, isLoading: false }));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserRole = async (userId: string) => {
    // Try agent first
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('*, tier:tiers(*)')
      .eq('user_id', userId)
      .single();

    if (!agentError && agentData) {
      setState(prev => ({
        ...prev,
        agent: agentData as AgentWithTier,
        partner: null,
        role: 'agent',
        isLoading: false,
      }));
      return;
    }

    // Try partner
    const { data: partnerData, error: partnerError } = await supabase
      .from('partners')
      .select('*, agent:agents(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!partnerError && partnerData) {
      setState(prev => ({
        ...prev,
        agent: null,
        partner: partnerData as PartnerWithAgent,
        role: 'partner',
        isLoading: false,
      }));
      return;
    }

    // Neither agent nor partner — sign out (unauthorized)
    await supabase.auth.signOut();
    setState(prev => ({ ...prev, agent: null, partner: null, role: null, isLoading: false }));
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setState({ user: null, session: null, agent: null, partner: null, role: null, isLoading: false });
  };

  return {
    ...state,
    signIn,
    signOut,
  };
}
