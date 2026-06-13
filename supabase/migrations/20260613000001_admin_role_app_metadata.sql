-- Harden admin authorization: stop trusting user-settable metadata.
--
-- `raw_user_meta_data` (a.k.a. user_metadata) can be changed by the user themselves
-- via `supabase.auth.updateUser({ data })`, so storing the admin role there let any
-- logged-in agent self-escalate to admin and pass is_admin(). `raw_app_meta_data`
-- (app_metadata) has no user-facing write path — only the service role / admin API
-- can set it — so it is the correct place for privilege roles.

-- 1) Backfill: mirror existing admin roles into app_metadata (idempotent).
UPDATE auth.users
SET raw_app_meta_data =
      COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
WHERE raw_user_meta_data->>'role' = 'admin';

-- 2) is_admin() now reads the non-spoofable app_metadata role.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND raw_app_meta_data->>'role' = 'admin'
  );
END;
$$;
