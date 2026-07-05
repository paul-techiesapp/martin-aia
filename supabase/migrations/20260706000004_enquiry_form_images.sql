-- Round 4 item 6: designer-supplied photo header/footer on the public enquiry
-- form. Recommended dimensions: header 1600x400 (4:1), footer 1600x200 (8:1).
UPDATE system_settings
SET enquiry_form = COALESCE(enquiry_form, '{}'::jsonb)
  || jsonb_build_object(
       'header_image_url', COALESCE(enquiry_form->>'header_image_url', ''),
       'footer_image_url', COALESCE(enquiry_form->>'footer_image_url', ''));
