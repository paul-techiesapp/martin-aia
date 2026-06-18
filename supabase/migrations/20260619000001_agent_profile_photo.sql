-- Agent profile photo: column, public storage bucket, owner-scoped RLS, and a
-- SECURITY DEFINER RPC so agents can set ONLY their own photo_url (agents have
-- no table UPDATE policy and share the authenticated role with admins).

-- 1. Column
ALTER TABLE agents ADD COLUMN photo_url TEXT;

-- 2. Public bucket for agent photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('agent-photos', 'agent-photos', true);

-- 3. Storage RLS
-- Public read (bucket is public; URLs are only surfaced in authenticated portals).
CREATE POLICY "Public read access for agent photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'agent-photos');

-- Each agent may write only inside a folder named after their auth uid.
CREATE POLICY "Agents manage own photo"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'agent-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'agent-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins may manage all agent photos.
CREATE POLICY "Admins manage all agent photos"
  ON storage.objects FOR ALL
  USING (bucket_id = 'agent-photos' AND is_admin())
  WITH CHECK (bucket_id = 'agent-photos' AND is_admin());

-- 4. RPC: set the calling agent's photo_url (NULL clears it).
CREATE OR REPLACE FUNCTION set_my_agent_photo(p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reject anything that is not a public URL for THIS project's agent-photos
  -- bucket inside the caller's own uid folder. An unanchored LIKE '%...%' would
  -- accept e.g. https://evil.com/storage/v1/object/public/agent-photos/x, which
  -- would then load in an admin's browser via <img src>. Anchor the host to
  -- localhost / *.supabase.co and pin the path to auth.uid() so only our own
  -- storage origin and the caller's own folder pass. NULL clears the photo.
  IF p_url IS NOT NULL
     AND p_url !~ (
       '^https?://(localhost|127\.0\.0\.1|[a-z0-9-]+\.supabase\.co)(:[0-9]+)?'
       || '/storage/v1/object/public/agent-photos/' || auth.uid()::text || '/'
     ) THEN
    RAISE EXCEPTION 'Invalid photo URL';
  END IF;

  UPDATE agents
     SET photo_url = p_url,
         updated_at = now()
   WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION set_my_agent_photo(text) TO authenticated;
