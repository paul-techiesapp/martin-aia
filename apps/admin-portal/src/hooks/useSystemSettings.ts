import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { SystemSettings, CompanyBranding, CardTemplate } from '@agent-system/shared-types';

export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .single();
      if (error) throw error;
      return data as SystemSettings;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateCompanyBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (branding: CompanyBranding) => {
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id')
        .single();
      if (!existing) throw new Error('System settings not found');
      const { error } = await supabase
        .from('system_settings')
        .update({ company_branding: branding, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  });
}

export function useUpdateCardTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: CardTemplate) => {
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id')
        .single();
      if (!existing) throw new Error('System settings not found');
      const { error } = await supabase
        .from('system_settings')
        .update({ card_template: template, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  });
}
