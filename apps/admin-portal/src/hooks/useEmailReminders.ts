import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface SendRemindersResult {
  sent: number;
  failed: number;
  message?: string;
}

export function useEmailReminders() {
  return useMutation({
    mutationFn: async (slotId: string): Promise<SendRemindersResult> => {
      const { data, error } = await supabase.functions.invoke('send-email-reminders', {
        body: { slot_id: slotId },
      });

      if (error) {
        throw new Error(error.message || 'Failed to send reminders');
      }

      return data as SendRemindersResult;
    },
  });
}
