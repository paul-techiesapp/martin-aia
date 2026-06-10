// Re-export the single shared Supabase client. Do NOT call createClient() here:
// the shared-ui barrel already instantiates a GoTrueClient, and a second client
// on the same auth storage key (sb-<ref>-auth-token) races the single-use refresh
// token on page reload — one instance consumes it, the other gets "Invalid Refresh
// Token: Already Used" and clears the persisted session, bouncing the user to /login.
export { supabase } from '@agent-system/shared-ui';
