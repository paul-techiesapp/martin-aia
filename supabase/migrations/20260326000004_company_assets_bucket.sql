-- Create company-assets bucket (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-assets', 'company-assets', true);

-- Admin can upload/update/delete
CREATE POLICY "Admins can manage company assets"
  ON storage.objects FOR ALL
  USING (bucket_id = 'company-assets' AND is_admin())
  WITH CHECK (bucket_id = 'company-assets' AND is_admin());

-- Anyone can read (public bucket)
CREATE POLICY "Public read access for company assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-assets');
