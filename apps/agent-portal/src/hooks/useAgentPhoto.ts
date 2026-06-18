import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const BUCKET = 'agent-photos';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/** Live source of the signed-in agent's own photo URL, shared across components. */
export function useMyAgentPhoto(userId: string | undefined) {
  return useQuery({
    queryKey: ['my-agent-photo', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('photo_url')
        .eq('user_id', userId as string)
        .single();
      if (error) throw error;
      return (data?.photo_url as string | null) ?? null;
    },
  });
}

async function clearFolder(userId: string) {
  const { data: existing } = await supabase.storage.from(BUCKET).list(userId);
  if (existing && existing.length > 0) {
    await supabase.storage
      .from(BUCKET)
      .remove(existing.map((f) => `${userId}/${f.name}`));
  }
}

export function useUploadAgentPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error('Please choose a JPG, PNG, or WebP image.');
      }
      if (file.size > MAX_BYTES) {
        throw new Error('Image must be 2 MB or smaller.');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You are not signed in.');

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      await clearFolder(user.id); // remove any prior photo (covers ext changes)

      const path = `${user.id}/profile.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = `${urlData.publicUrl}?v=${Date.now()}`; // cache-bust on re-upload

      const { error: rpcErr } = await supabase.rpc('set_my_agent_photo', { p_url: url });
      if (rpcErr) throw rpcErr;

      return url;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-agent-photo'] });
    },
  });
}

export function useRemoveAgentPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You are not signed in.');

      await clearFolder(user.id);

      const { error } = await supabase.rpc('set_my_agent_photo', { p_url: null });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-agent-photo'] });
    },
  });
}
