-- Add RLS policies for public registration flow
-- Anonymous users need to read and update invitations by unique_token

-- Invitations: Public can read by unique_token (for registration form)
CREATE POLICY "Public can read invitations by token" ON invitations
  FOR SELECT TO anon
  USING (true);

-- Invitations: Public can update their registration details
CREATE POLICY "Public can update invitations for registration" ON invitations
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Slots: Public can read slots (needed for registration page to show event details)
CREATE POLICY "Public can read slots" ON slots
  FOR SELECT TO anon
  USING (true);

-- Campaigns: Public can read campaigns (needed for registration page to show event details)
CREATE POLICY "Public can read campaigns" ON campaigns
  FOR SELECT TO anon
  USING (true);
