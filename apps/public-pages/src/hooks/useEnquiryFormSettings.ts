import { useQuery } from '@tanstack/react-query';
import { DEFAULT_ENQUIRY_FORM, type EnquiryFormSettings } from '@agent-system/shared-types';
import { supabase } from '../lib/supabase';

/**
 * Public (anon) read of the admin-editable enquiry-form header/footer + PDPA T&C.
 * Falls back to DEFAULT_ENQUIRY_FORM for any field the DB row leaves unset.
 */
export function useEnquiryFormSettings() {
  return useQuery({
    queryKey: ['enquiry-form-settings'],
    queryFn: async (): Promise<EnquiryFormSettings> => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('enquiry_form')
        .limit(1)
        .single();
      if (error) throw error;
      return {
        ...DEFAULT_ENQUIRY_FORM,
        ...((data?.enquiry_form as Partial<EnquiryFormSettings>) ?? {}),
      };
    },
  });
}
