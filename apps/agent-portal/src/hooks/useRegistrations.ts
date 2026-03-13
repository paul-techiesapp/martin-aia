import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { RegistrationStatus } from '@agent-system/shared-types';
import type { Registration } from '@agent-system/shared-types';

interface RegistrationWithSlot extends Registration {
  slot: {
    id: string;
    start_at: string;
    end_at: string;
    campaign: {
      id: string;
      name: string;
    };
  };
}

export function useRegistrationsBySlot(agentId: string | undefined, slotId: string | undefined) {
  return useQuery({
    queryKey: ['registrations-by-slot', agentId, slotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select(`
          *,
          slot:slots(
            id,
            start_at,
            end_at,
            campaign:campaigns(id, name)
          )
        `)
        .eq('agent_id', agentId!)
        .eq('slot_id', slotId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as RegistrationWithSlot[];
    },
    enabled: !!agentId && !!slotId,
  });
}

export interface RegistrationStats {
  registered: number;
  attended: number;
  completed: number;
  total: number;
}

export function useRegistrationStats(agentId: string | undefined) {
  return useQuery({
    queryKey: ['registration-stats', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select('status')
        .eq('agent_id', agentId!);

      if (error) throw error;

      const stats: RegistrationStats = {
        registered: 0,
        attended: 0,
        completed: 0,
        total: data?.length ?? 0,
      };

      data?.forEach((r) => {
        switch (r.status) {
          case RegistrationStatus.REGISTERED:
            stats.registered++;
            break;
          case RegistrationStatus.ATTENDED:
            stats.attended++;
            break;
          case RegistrationStatus.COMPLETED:
            stats.completed++;
            break;
        }
      });

      return stats;
    },
    enabled: !!agentId,
  });
}

export function usePartnerRegistrationStats(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['partner-registration-stats', partnerId],
    queryFn: async () => {
      // First get partner's link IDs
      const { data: links, error: linksError } = await supabase
        .from('agent_links')
        .select('id')
        .eq('partner_id', partnerId!);

      if (linksError) throw linksError;

      const stats: RegistrationStats = {
        registered: 0,
        attended: 0,
        completed: 0,
        total: 0,
      };

      if (!links || links.length === 0) return stats;

      const linkIds = links.map((l) => l.id);
      const { data: registrations, error: regError } = await supabase
        .from('registrations')
        .select('status')
        .in('agent_link_id', linkIds);

      if (regError) throw regError;

      stats.total = registrations?.length ?? 0;
      registrations?.forEach((r) => {
        switch (r.status) {
          case RegistrationStatus.REGISTERED:
            stats.registered++;
            break;
          case RegistrationStatus.ATTENDED:
            stats.attended++;
            break;
          case RegistrationStatus.COMPLETED:
            stats.completed++;
            break;
        }
      });

      return stats;
    },
    enabled: !!partnerId,
  });
}
