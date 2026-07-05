import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

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

// Agent amends a vehicle's supporting documents (e.g. covernote/geran) after
// submission. Path is namespaced by enquiry id; RLS on enquiry_attachments
// allows insert only when the agent owns the enquiry or is a unit viewer.
export function useUploadAttachment(enquiryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ vehicleId, file }: { vehicleId: string; file: File }) => {
      if (!ALLOWED_TYPES.includes(file.type)) throw new Error('Only images or PDF files are allowed');
      if (file.size > MAX_BYTES) throw new Error('File must be 10MB or smaller');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${enquiryId}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('enquiry-attachments')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from('enquiry_attachments').insert({
        enquiry_id: enquiryId,
        enquiry_vehicle_id: vehicleId,
        storage_path: path,
        file_name: file.name,
        content_type: file.type,
        size_bytes: file.size,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['enquiry-attachments', enquiryId] }),
  });
}

export function useDeleteAttachment(enquiryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (att: { id: string; storage_path: string }) => {
      const { error } = await supabase.from('enquiry_attachments').delete().eq('id', att.id);
      if (error) throw error;
      // Best effort: DB row is the source of truth; a stray object is harmless.
      await supabase.storage.from('enquiry-attachments').remove([att.storage_path]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['enquiry-attachments', enquiryId] }),
  });
}
