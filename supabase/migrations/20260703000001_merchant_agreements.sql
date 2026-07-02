-- ============================================================
-- Round 3 item 1: agent-proposed partnerships carry contact info
-- and a signed agreement uploaded to a PRIVATE bucket.
-- ============================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS agreement_path text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS contact_phone  text;

-- Private bucket for signed partnership agreements (PDF/JPG/PNG, <=10MB).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'merchant-agreements', 'merchant-agreements', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png']
)
ON CONFLICT (id) DO NOTHING;

-- UPLOAD: an authenticated agent may only write under their own <agent_id>/ prefix.
DROP POLICY IF EXISTS "merchant-agreements agent upload own" ON storage.objects;
CREATE POLICY "merchant-agreements agent upload own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'merchant-agreements'
    AND (storage.foldername(name))[1] = get_agent_id()::text
  );

-- READ: admins read all; agents read their own prefix (signed URLs).
DROP POLICY IF EXISTS "merchant-agreements admin read" ON storage.objects;
CREATE POLICY "merchant-agreements admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'merchant-agreements' AND is_admin());

DROP POLICY IF EXISTS "merchant-agreements agent read own" ON storage.objects;
CREATE POLICY "merchant-agreements agent read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'merchant-agreements'
    AND (storage.foldername(name))[1] = get_agent_id()::text
  );
