import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface FormBranding {
  logo_url: string;
  footer_text: string;
}

/** Shared logo + footer applied across ALL public forms, admin-editable. */
const DEFAULT_FORM_BRANDING: FormBranding = {
  logo_url: '',
  footer_text: '© RACC Agency. All rights reserved.',
};

/**
 * Public (anon) read of the admin-editable shared form branding (logo + footer)
 * from `system_settings.form_branding`. Falls back to DEFAULT_FORM_BRANDING for
 * any field the DB row leaves unset. Returns convenience `{ logoUrl, footerText }`.
 */
export function useFormBranding(): { logoUrl: string; footerText: string } {
  const { data } = useQuery({
    queryKey: ['form-branding'],
    queryFn: async (): Promise<FormBranding> => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('form_branding')
        .limit(1)
        .single();
      if (error) throw error;
      return {
        ...DEFAULT_FORM_BRANDING,
        ...((data?.form_branding as Partial<FormBranding>) ?? {}),
      };
    },
  });

  return {
    logoUrl: data?.logo_url ?? DEFAULT_FORM_BRANDING.logo_url,
    footerText: data?.footer_text ?? DEFAULT_FORM_BRANDING.footer_text,
  };
}
