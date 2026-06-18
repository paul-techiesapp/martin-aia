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

// Best-effort cleanup of objects in the user's folder, optionally keeping one
// file. This is cleanup only: the agents.photo_url row is the source of truth
// for what renders, so a storage-cleanup failure must NOT fail the surrounding
// operation — we swallow errors here and leave at most a harmless orphan file.
async function removeFolderObjects(userId: string, keepName?: string) {
  const { data: existing, error: listError } = await supabase.storage.from(BUCKET).list(userId);
  if (listError || !existing) return;
  const toRemove = existing
    .filter((f) => f.name !== keepName)
    .map((f) => `${userId}/${f.name}`);
  if (toRemove.length > 0) {
    await supabase.storage.from(BUCKET).remove(toRemove);
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

      // Sanitize to [a-z0-9] only: filenames are browser-provided and could carry
      // whitespace/'@'/odd chars that the set_my_agent_photo URL guard rejects.
      const ext = ((file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
      const fileName = `profile.${ext}`;
      const path = `${user.id}/${fileName}`;

      // Upload BEFORE deleting anything. The new object must exist, and the DB
      // must point at it, before the old one is removed — otherwise a failed
      // upload or RPC would leave photo_url referencing a deleted object (a
      // broken <img> until the initials fallback). upsert overwrites a same-name
      // file in place, so a same-extension re-upload is already atomic here.
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = `${urlData.publicUrl}?v=${Date.now()}`; // cache-bust on re-upload

      const { error: rpcErr } = await supabase.rpc('set_my_agent_photo', { p_url: url });
      if (rpcErr) throw rpcErr;

      // DB now points at the new object; best-effort remove any stale file left
      // from a previous extension (e.g. profile.png after switching to profile.jpg).
      await removeFolderObjects(user.id, fileName);

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

      // Clear the DB first so the avatar reverts to initials immediately; then
      // best-effort delete the storage object. Cleanup failure must not surface
      // as an error once the photo is already logically removed.
      const { error } = await supabase.rpc('set_my_agent_photo', { p_url: null });
      if (error) throw error;

      await removeFolderObjects(user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-agent-photo'] });
    },
  });
}
