import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { SystemSettings } from '@agent-system/shared-types';

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
