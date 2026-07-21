-- Unit viewers set their unit's enquiry-form footer image (round 6, item 6).
CREATE OR REPLACE FUNCTION set_unit_footer_image(p_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_unit_viewer() THEN
    RAISE EXCEPTION 'only unit managers can set the unit footer' USING ERRCODE = '42501';
  END IF;
  UPDATE agents
     SET form_settings = CASE
           WHEN NULLIF(trim(p_url), '') IS NULL
             THEN COALESCE(form_settings, '{}'::jsonb) - 'footer_image_url'
           ELSE COALESCE(form_settings, '{}'::jsonb)
                  || jsonb_build_object('footer_image_url', trim(p_url))
         END
   WHERE id = get_unit_root();
END;
$$;
REVOKE EXECUTE ON FUNCTION set_unit_footer_image(text) FROM anon;
GRANT EXECUTE ON FUNCTION set_unit_footer_image(text) TO authenticated;

-- Unit viewers upload their unit's enquiry-form footer image. Path-scoped to
-- their own unit root id, so no cross-unit writes; reads stay public (bucket
-- is public), all other writes remain admin-only.
CREATE POLICY "Unit viewers upload unit footer images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-assets'
    AND is_unit_viewer()
    AND name LIKE 'form-images/unit-' || get_unit_root()::text || '-%'
  );
