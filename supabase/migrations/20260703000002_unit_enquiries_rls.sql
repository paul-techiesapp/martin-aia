-- ============================================================
-- Round 3 item 2: unit viewers (Unit Manager = top-level agent,
-- Unit Admin = is_unit_manager deputy) can read their whole unit's
-- enquiries. Additive OR to the existing own-enquiry policies.
-- ============================================================

DROP POLICY IF EXISTS "Unit viewers read unit enquiries" ON enquiries;
CREATE POLICY "Unit viewers read unit enquiries" ON enquiries
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT unit_member_ids()));

DROP POLICY IF EXISTS "Unit viewers read unit enquiry_vehicles" ON enquiry_vehicles;
CREATE POLICY "Unit viewers read unit enquiry_vehicles" ON enquiry_vehicles
  FOR SELECT TO authenticated
  USING (enquiry_id IN (
    SELECT e.id FROM enquiries e WHERE e.agent_id IN (SELECT unit_member_ids())
  ));

DROP POLICY IF EXISTS "Unit viewers read unit enquiry_attachments" ON enquiry_attachments;
CREATE POLICY "Unit viewers read unit enquiry_attachments" ON enquiry_attachments
  FOR SELECT TO authenticated
  USING (enquiry_id IN (
    SELECT e.id FROM enquiries e WHERE e.agent_id IN (SELECT unit_member_ids())
  ));

-- Storage: allow signed-URL reads of unit members' attachment files.
DROP POLICY IF EXISTS "enquiry-attachments unit viewer read" ON storage.objects;
CREATE POLICY "enquiry-attachments unit viewer read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'enquiry-attachments'
    AND EXISTS (
      SELECT 1 FROM enquiry_attachments ea
      JOIN enquiries e ON e.id = ea.enquiry_id
      WHERE ea.storage_path = storage.objects.name
        AND e.agent_id IN (SELECT unit_member_ids())
    )
  );
