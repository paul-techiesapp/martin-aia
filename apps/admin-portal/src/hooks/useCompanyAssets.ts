import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useUploadLogo() {
  return useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop();
      const fileName = `logo.${ext}`;
      await supabase.storage.from('company-assets').remove([fileName]);
      const { error } = await supabase.storage
        .from('company-assets')
        .upload(fileName, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage
        .from('company-assets')
        .getPublicUrl(fileName);
      return urlData.publicUrl;
    },
  });
}

export function useDeleteLogo() {
  return useMutation({
    mutationFn: async (fileName: string) => {
      const { error } = await supabase.storage
        .from('company-assets')
        .remove([fileName]);
      if (error) throw error;
    },
  });
}

/**
 * Uploads an admin-supplied form image (e.g. enquiry-form header/footer banner)
 * to the public `company-assets` bucket under `form-images/{key}-{timestamp}.{ext}`.
 * Mirrors useUploadLogo but supports multiple named images instead of one fixed logo.
 */
export function useUploadFormImage() {
  return useMutation({
    mutationFn: async ({ file, key }: { file: File; key: string }) => {
      const ext = file.name.split('.').pop();
      const fileName = `form-images/${key}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('company-assets')
        .upload(fileName, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage
        .from('company-assets')
        .getPublicUrl(fileName);
      return urlData.publicUrl;
    },
  });
}
