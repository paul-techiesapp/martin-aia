import { useQuery } from '@tanstack/react-query';
import { useToast } from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';

export interface AttachmentRow {
  id: string;
  enquiry_vehicle_id: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

export function useEnquiryAttachments(enquiryId: string) {
  return useQuery<AttachmentRow[]>({
    queryKey: ['enquiry-attachments', enquiryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiry_attachments')
        .select('id, enquiry_vehicle_id, storage_path, file_name, content_type, size_bytes')
        .eq('enquiry_id', enquiryId)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as AttachmentRow[];
    },
    enabled: !!enquiryId,
  });
}

export function useViewAttachment() {
  const { toast } = useToast();
  return async (storagePath: string) => {
    const { data, error } = await supabase.storage
      .from('enquiry-attachments')
      .createSignedUrl(storagePath, 60);
    if (error || !data?.signedUrl) {
      toast({ title: 'Could not open file', description: error?.message, variant: 'error' });
      return;
    }
    window.open(data.signedUrl, '_blank');
  };
}
