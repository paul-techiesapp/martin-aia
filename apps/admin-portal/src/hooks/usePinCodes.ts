import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { PinCode } from '@agent-system/shared-types';

export function usePinCodes(slotId?: string) {
  return useQuery({
    queryKey: ['pin-codes', slotId],
    queryFn: async () => {
      let query = supabase
        .from('pin_codes')
        .select('*')
        .order('code', { ascending: true });

      if (slotId) {
        query = query.eq('slot_id', slotId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as PinCode[];
    },
  });
}

export function useGeneratePinCodes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ slotId, count }: { slotId: string; count: number }) => {
      // Generate unique 6-digit PIN codes
      const pins: Omit<PinCode, 'id' | 'created_at' | 'updated_at'>[] = [];
      const existingCodes = new Set<string>();

      for (let i = 0; i < count; i++) {
        let code: string;
        do {
          code = Math.floor(100000 + Math.random() * 900000).toString();
        } while (existingCodes.has(code));
        existingCodes.add(code);

        pins.push({
          slot_id: slotId,
          code,
          linked_nric: null,
          is_used: false,
        });
      }

      const { data, error } = await supabase
        .from('pin_codes')
        .insert(pins)
        .select();

      if (error) throw error;
      return data as PinCode[];
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pin-codes', variables.slotId] });
    },
  });
}

export function useDeletePinCodes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ slotId, onlyUnused }: { slotId: string; onlyUnused?: boolean }) => {
      let query = supabase
        .from('pin_codes')
        .delete()
        .eq('slot_id', slotId);

      if (onlyUnused) {
        query = query.eq('is_used', false);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pin-codes', variables.slotId] });
    },
  });
}
