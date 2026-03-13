import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Registration } from '@agent-system/shared-types';

export function useRegistrationsBySlot(slotId?: string) {
  return useQuery({
    queryKey: ['registrations', 'slot', slotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select('*, agent:agents(name, agent_code)')
        .eq('slot_id', slotId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as (Registration & { agent: { name: string; agent_code: string } })[];
    },
    enabled: !!slotId,
  });
}

export function useRegistrationsByAgent(agentId?: string) {
  return useQuery({
    queryKey: ['registrations', 'agent', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select('*, slot:slots(start_at, end_at, campaign:campaigns(name))')
        .eq('agent_id', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!agentId,
  });
}

export function useRegistrationStats() {
  return useQuery({
    queryKey: ['registration-stats'],
    queryFn: async () => {
      const { count: totalRegistrations, error: regError } = await supabase
        .from('registrations')
        .select('*', { count: 'exact', head: true });

      if (regError) throw regError;

      const { count: attendedCount, error: attendedError } = await supabase
        .from('registrations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'attended');

      if (attendedError) throw attendedError;

      const { count: completedCount, error: completedError } = await supabase
        .from('registrations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed');

      if (completedError) throw completedError;

      return {
        totalRegistrations: totalRegistrations || 0,
        attended: attendedCount || 0,
        completed: completedCount || 0,
      };
    },
  });
}

export function useRegistrationCountBySlot(slotId?: string) {
  return useQuery({
    queryKey: ['registration-count', slotId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('registrations')
        .select('*', { count: 'exact', head: true })
        .eq('slot_id', slotId!);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!slotId,
  });
}
