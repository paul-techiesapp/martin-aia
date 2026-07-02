import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { AgentWithTier, PartnerWithAgent } from '@agent-system/shared-types';

interface AuthState {
  user: User | null;
  session: Session | null;
  agent: AgentWithTier | null;
  partner: PartnerWithAgent | null;
  role: 'agent_admin' | 'agent' | 'partner' | null;
  // True for anyone allowed to SEE the whole unit's reporting: the unit admin
  // (agent_admin) plus sub-agents flagged is_unit_manager. Managing sub-agents
  // stays restricted to agent_admin.
  isUnitViewer: boolean;
  isLoading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    agent: null,
    partner: null,
    role: null,
    isUnitViewer: false,
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
        setState(prev => ({ ...prev, agent: null, partner: null, role: null, isUnitViewer: false, isLoading: false }));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserRole = async (userId: string) => {
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('*, tier:tiers(*)')
      .eq('user_id', userId)
      .single();

    if (!agentError && agentData) {
      const agentRole = agentData.parent_agent_id === null ? 'agent_admin' : 'agent';
      // Unit admins always see the unit; sub-agents flagged is_unit_manager get
      // the same unit-wide VIEW (but not sub-agent management — see Layout).
      const isUnitViewer = agentRole === 'agent_admin' || agentData.is_unit_manager === true;
      setState(prev => ({
        ...prev,
        agent: agentData as AgentWithTier,
        partner: null,
        role: agentRole,
        isUnitViewer,
        isLoading: false,
      }));
      return;
    }

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
        isUnitViewer: false,
        isLoading: false,
      }));
      return;
    }

    // No agent or partner profile is linked to this authenticated user.
    // Do NOT sign out here: destroying a valid session causes a silent redirect
    // loop back to /login on every page load (the auth guard sees no session).
    // Leave the session intact and expose role=null so the UI can show a clear
    // "account not linked" message (handled in Layout) instead of looping.
    setState(prev => ({ ...prev, agent: null, partner: null, role: null, isLoading: false }));
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return {
    ...state,
    signIn,
    signOut,
  };
}
