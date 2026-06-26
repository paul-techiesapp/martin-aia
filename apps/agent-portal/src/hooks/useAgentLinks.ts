import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { AgentLink, CardTemplate } from '@agent-system/shared-types';

interface AgentLinkWithSlotCampaign extends AgentLink {
  slot: {
    id: string;
    start_at: string;
    end_at: string;
    campaign: {
      id: string;
      name: string;
      venue: string;
      card_template_overrides?: Partial<CardTemplate> | null;
    };
  };
  registration_count: number;
}

export function useMyLinks(agentId: string | undefined, includeInactive = false) {
  return useQuery({
    queryKey: ['my-links', agentId, includeInactive],
    queryFn: async () => {
      let query = supabase
        .from('agent_links')
        .select(`
          *,
          slot:slots(
            id,
            start_at,
            end_at,
            campaign:campaigns(id, name, venue, card_template_overrides)
          )
        `)
        .eq('agent_id', agentId!)
        .is('partner_id', null);

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      // The slot embed is nullable from the client: agents can only read active
      // slots (RLS), so a link to a deactivated slot returns slot=null. Drop those
      // so the non-null `slot` type holds and no consumer crashes on l.slot.*.
      const links = ((data ?? []) as AgentLinkWithSlotCampaign[]).filter((l) => l.slot != null);
      if (links.length > 0) {
        const linkIds = links.map((l) => l.id);
        const { data: counts, error: countError } = await supabase
          .from('registrations')
          .select('agent_link_id')
          .in('agent_link_id', linkIds);

        if (!countError && counts) {
          const countMap: Record<string, number> = {};
          counts.forEach((r) => {
            if (r.agent_link_id) {
              countMap[r.agent_link_id] = (countMap[r.agent_link_id] || 0) + 1;
            }
          });
          links.forEach((l) => {
            l.registration_count = countMap[l.id] || 0;
          });
        } else {
          links.forEach((l) => {
            l.registration_count = 0;
          });
        }
      }

      return links;
    },
    enabled: !!agentId,
  });
}

export function useCreateLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentId,
      slotId,
      partnerId,
    }: {
      agentId: string;
      slotId: string;
      partnerId?: string | null;
    }) => {
      // Upsert: check if link already exists for this agent+slot+partner combo
      const query = supabase
        .from('agent_links')
        .select('*')
        .eq('agent_id', agentId)
        .eq('slot_id', slotId)
        .eq('is_active', true);

      if (partnerId) {
        query.eq('partner_id', partnerId);
      } else {
        query.is('partner_id', null);
      }

      const { data: existing, error: findError } = await query.maybeSingle();

      if (findError) throw findError;

      // If link already exists, return it
      if (existing) {
        return existing as AgentLink;
      }

      // Create new link — link_code is auto-generated as UUID by database default
      const { data, error } = await supabase
        .from('agent_links')
        .insert({
          agent_id: agentId,
          slot_id: slotId,
          partner_id: partnerId || null,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as AgentLink;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['my-links', variables.agentId] });
      if (variables.partnerId) {
        queryClient.invalidateQueries({ queryKey: ['partner-links', variables.partnerId] });
      }
    },
  });
}

export function usePartnerLinks(partnerId: string | undefined, includeInactive = false) {
  return useQuery({
    queryKey: ['partner-links', partnerId, includeInactive],
    queryFn: async () => {
      let query = supabase
        .from('agent_links')
        .select(`
          *,
          slot:slots(
            id,
            start_at,
            end_at,
            campaign:campaigns(id, name, venue, card_template_overrides)
          )
        `)
        .eq('partner_id', partnerId!);

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      // Drop links whose slot the client can't read (deactivated slot → slot=null)
      // so the non-null `slot` type holds and consumers don't crash on l.slot.*.
      const links = ((data ?? []) as AgentLinkWithSlotCampaign[]).filter((l) => l.slot != null);
      if (links.length > 0) {
        const linkIds = links.map((l) => l.id);
        const { data: counts, error: countError } = await supabase
          .from('registrations')
          .select('agent_link_id')
          .in('agent_link_id', linkIds);

        if (!countError && counts) {
          const countMap: Record<string, number> = {};
          counts.forEach((r) => {
            if (r.agent_link_id) {
              countMap[r.agent_link_id] = (countMap[r.agent_link_id] || 0) + 1;
            }
          });
          links.forEach((l) => {
            l.registration_count = countMap[l.id] || 0;
          });
        } else {
          links.forEach((l) => {
            l.registration_count = 0;
          });
        }
      }

      return links;
    },
    enabled: !!partnerId,
  });
}

export function useLinkRegistrationCount(linkId: string | undefined) {
  return useQuery({
    queryKey: ['link-registration-count', linkId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('registrations')
        .select('*', { count: 'exact', head: true })
        .eq('agent_link_id', linkId!);

      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!linkId,
  });
}
