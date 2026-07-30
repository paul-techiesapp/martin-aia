import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '@agent-system/shared-ui';
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

// Paged: both queries aggregate across every agent tied to this partner (not
// one agent's own rows), the same unbounded-aggregation shape as
// usePartnerLinks in useAgentLinks.ts.
export function usePartnerRegistrationStats(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['partner-registration-stats', partnerId],
    queryFn: async () => {
      // First get partner's link IDs
      const links = await fetchAllRows<{ id: string }>(
        (from, to) =>
          supabase
            .from('agent_links')
            .select('id')
            .eq('partner_id', partnerId!)
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: { id: string }[] | null;
            error: { message: string } | null;
          }>,
        { label: 'agent partner-registration-stats links' },
      );

      const stats: RegistrationStats = {
        registered: 0,
        attended: 0,
        completed: 0,
        total: 0,
      };

      if (links.length === 0) return stats;

      const linkIds = links.map((l) => l.id);
      const registrations = await fetchAllRows<{ status: RegistrationStatus }>(
        (from, to) =>
          supabase
            .from('registrations')
            .select('status')
            .in('agent_link_id', linkIds)
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: { status: RegistrationStatus }[] | null;
            error: { message: string } | null;
          }>,
        { label: 'agent partner-registration-stats registrations' },
      );

      stats.total = registrations.length;
      registrations.forEach((r) => {
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

// Unit Admins (parent agents) roll up reporting across their whole unit: their
// own registrations plus every sub-agent's. The matching RLS policy
// ("Unit admins read unit registrations") grants the parent SELECT on sub-agent
// rows, so this .in(agent_id, [...]) query returns the full unit.
export function useUnitRegistrationStats(unitAgentId: string | undefined) {
  return useQuery({
    queryKey: ['unit-registration-stats', unitAgentId],
    queryFn: async () => {
      // Not paged: a unit's sub-agent roster is an org-hierarchy list, not a
      // customer-transaction table — realistically far below 1000 rows.
      const { data: subs, error: subsError } = await supabase
        .from('agents')
        .select('id')
        .eq('parent_agent_id', unitAgentId!);

      if (subsError) throw subsError;

      const agentIds = [unitAgentId!, ...(subs?.map((s) => s.id) ?? [])];

      // Paged: this is the same unit-wide aggregation shape flagged for
      // useMyEnquiries(unitWide=true) — a large unit's registrations are not
      // bounded below 1000 the way one agent's own rows are.
      const data = await fetchAllRows<{ status: RegistrationStatus }>(
        (from, to) =>
          supabase
            .from('registrations')
            .select('status')
            .in('agent_id', agentIds)
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: { status: RegistrationStatus }[] | null;
            error: { message: string } | null;
          }>,
        { label: 'agent unit-registration-stats' },
      );

      const stats: RegistrationStats = {
        registered: 0,
        attended: 0,
        completed: 0,
        total: data.length,
      };

      data.forEach((r) => {
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
    enabled: !!unitAgentId,
  });
}
