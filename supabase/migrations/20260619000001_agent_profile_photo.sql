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
  IF p_url IS NOT NULL
     AND p_url NOT LIKE '%/storage/v1/object/public/agent-photos/%' THEN
    RAISE EXCEPTION 'Invalid photo URL';
  END IF;

  UPDATE agents
     SET photo_url = p_url,
         updated_at = now()
   WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION set_my_agent_photo(text) TO authenticated;
