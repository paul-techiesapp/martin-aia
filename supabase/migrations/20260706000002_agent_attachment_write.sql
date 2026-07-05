-- Round 4 item 4: agents can amend files on their customers' enquiries —
-- upload new + delete old. Unit viewers get the same on unit members' rows
-- (item 10b). Public-form inserts still go through submit_enquiry (definer).
DROP POLICY IF EXISTS "Agent writes own enquiry_attachments" ON enquiry_attachments;
CREATE POLICY "Agent writes own enquiry_attachments"
  ON enquiry_attachments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM enquiries e
    WHERE e.id = enquiry_attachments.enquiry_id
      AND (e.agent_id = get_agent_id() OR e.agent_id IN (SELECT unit_member_ids()))
  ));

DROP POLICY IF EXISTS "Agent deletes own enquiry_attachments" ON enquiry_attachments;
CREATE POLICY "Agent deletes own enquiry_attachments"
  ON enquiry_attachments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM enquiries e
    WHERE e.id = enquiry_attachments.enquiry_id
      AND (e.agent_id = get_agent_id() OR e.agent_id IN (SELECT unit_member_ids()))
  ));

-- Storage: agents may remove objects backing attachments they may delete.
-- (INSERT to the bucket is already open to authenticated at 20260629000030.)
DROP POLICY IF EXISTS "enquiry-attachments agent delete own" ON storage.objects;
CREATE POLICY "enquiry-attachments agent delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'enquiry-attachments'
    AND EXISTS (
      SELECT 1 FROM enquiry_attachments ea
      JOIN enquiries e ON e.id = ea.enquiry_id
      WHERE ea.storage_path = storage.objects.name
        AND (e.agent_id = get_agent_id() OR e.agent_id IN (SELECT unit_member_ids()))
    )
  );

-- Unit viewers must also be able to READ unit attachments' objects (View button)
-- — already granted by 20260703000002_unit_enquiries_rls.sql.
