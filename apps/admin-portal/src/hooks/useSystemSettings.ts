import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { SystemSettings, CompanyBranding, CardTemplate, EnquiryFormSettings } from '@agent-system/shared-types';

/** Branding shown on public-facing forms (logo + footer). Stored in system_settings.form_branding. */
export interface FormBranding {
  logo_url: string;
  footer_text: string;
  /** Logo for event forms (register/checkout/display), separate from the
   * partnership enquiry logo_url; blank = built-in RACC logo. */
  event_logo_url: string;
}

/** SystemSettings plus the form_branding column (not yet in the shared type). */
export type SystemSettingsWithFormBranding = SystemSettings & {
  form_branding: FormBranding | null;
};

export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .single();
      if (error) throw error;
      return data as SystemSettingsWithFormBranding;
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

/**
 * Updates the enquiry-form settings, admin notification email, and/or the
 * customer gift rate. Pass only the fields you want to change.
 */
export function useUpdateEnquirySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      enquiry_form?: EnquiryFormSettings;
      admin_notification_email?: string | null;
      customer_gift_rate_pct?: number;
    }) => {
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id')
        .single();
      if (!existing) throw new Error('System settings not found');
      const { error } = await supabase
        .from('system_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  });
}

/**
 * Saves the public form branding (logo + footer) to system_settings.form_branding.
 */
export function useUpdateFormBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (form_branding: FormBranding) => {
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id')
        .single();
      if (!existing) throw new Error('System settings not found');
      const { error } = await supabase
        .from('system_settings')
        .update({ form_branding, updated_at: new Date().toISOString() })
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
