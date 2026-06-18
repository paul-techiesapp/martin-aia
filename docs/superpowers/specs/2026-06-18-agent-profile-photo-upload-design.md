# Agent Profile Photo Upload — Design

**Date:** 2026-06-18
**Status:** Approved (design)
**Scope:** Let an agent upload, change, and remove their own profile photo. Display it in the agent portal (header + Account page) and in the admin portal agent list. Public registration pages and the PDF invitation card are **out of scope**.

## Goal

Agents currently have no profile photo. This adds self-service photo upload in the agent portal, with read-only display in the admin portal agent list.

Non-goals:
- Showing the photo on public registration / shareable-link pages.
- Embedding the photo in the generated PDF invitation card.
- Admins uploading/changing photos on behalf of agents.

## Key Decisions

1. **Public storage bucket** `agent-photos` (mirrors the existing public `company-assets` bucket). Headshots are low-sensitivity and the URL is only surfaced inside the two authenticated portals. Write access is locked to each user's own folder via storage RLS.
2. **`SECURITY DEFINER` RPC** `set_my_agent_photo(p_url text)` for persisting the URL on the `agents` row. Rationale: agents and admins share the Postgres `authenticated` role, so a broad `FOR UPDATE` policy or a column-level `GRANT` would either expose other columns to agents or break the admin's existing `AgentForm` editing. The RPC writes only `photo_url` for the caller's own row.
3. **New shared `Avatar` component** in `shared-ui` (no Radix dependency) reused by both portals.

## Architecture & Components

### 1. Database — new migration `supabase/migrations/<ts>_agent_profile_photo.sql`

- **Column:** `ALTER TABLE agents ADD COLUMN photo_url TEXT;` (nullable, default null).
- **Bucket:**
  ```sql
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('agent-photos', 'agent-photos', true);
  ```
- **Storage RLS** on `storage.objects`:
  - Public read: `SELECT` where `bucket_id = 'agent-photos'`.
  - Owner write: `INSERT`/`UPDATE`/`DELETE` where
    `bucket_id = 'agent-photos' AND (storage.foldername(name))[1] = auth.uid()::text`.
  - Admin manage-all: `ALL` where `bucket_id = 'agent-photos' AND is_admin()`.
- **RPC:**
  ```sql
  CREATE OR REPLACE FUNCTION set_my_agent_photo(p_url text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    -- Accept only NULL (clear) or a public URL for THIS project's agent-photos
    -- bucket inside the caller's own uid folder. An unanchored LIKE '%...%'
    -- would accept an attacker host (e.g. https://evil.com/storage/v1/object/
    -- public/agent-photos/x) that then loads in an admin's browser via <img>.
    IF p_url IS NOT NULL
       AND p_url !~ (
         '^https?://(localhost|127\.0\.0\.1|[a-z0-9-]+\.supabase\.co)(:[0-9]+)?'
         || '/storage/v1/object/public/agent-photos/' || auth.uid()::text || '/'
       ) THEN
      RAISE EXCEPTION 'Invalid photo URL';
    END IF;
    UPDATE agents
       SET photo_url = p_url, updated_at = now()
     WHERE user_id = auth.uid();
  END;
  $$;
  GRANT EXECUTE ON FUNCTION set_my_agent_photo(text) TO authenticated;
  ```
  Passing `NULL` clears the photo (used by "Remove photo"). The guard anchors the host (`localhost`/`*.supabase.co`) and pins the path to `auth.uid()`'s own folder, so an agent cannot store an arbitrary external URL (which would otherwise load in an admin's browser) — defense in depth matching the storage RLS.

### 2. shared-types — `packages/shared-types/src/database.ts`

Add to the `Agent` interface:
```ts
photo_url: string | null;
```
(Flows into `AgentWithTier`, `useAuth().agent`, and admin `useAgents` automatically since those select `*`.)

### 3. shared-ui — new `Avatar` component

`packages/shared-ui/src/components/ui/avatar.tsx`, exported from `index.ts`.
- Props: `src?: string | null`, `name?: string`, `size?: 'sm' | 'md' | 'lg'` (or numeric px), `className?`.
- Renders a rounded `<img>` when `src` is present; otherwise initials derived from `name` (first letters of up to two words) on a muted background.
- Handles broken images gracefully (fall back to initials on `onError`).
- No new dependency (plain React + `cn`).

### 4. agent-portal — upload + display

- **Hook `apps/agent-portal/src/hooks/useAgentPhoto.ts`:**
  - `useMyAgentPhoto()` — TanStack **query**, `queryKey: ['my-agent-photo', userId]`, selects `photo_url` from `agents` where `user_id = auth.uid()`. This is the **live display source** for the agent's own photo, shared across components via the React Query cache (see "Cross-component refresh" below).
  - `useUploadAgentPhoto()` — `mutationFn(file: File)`:
    1. Validate type (`image/jpeg|png|webp`) and size (≤ 2 MB); throw a friendly error otherwise.
    2. Derive `ext` from the file; path = `${user.id}/profile.${ext}`.
    3. Remove any existing objects in `${user.id}/` (covers prior ext change), then `upload(path, file, { upsert: true })`.
    4. `getPublicUrl(path)`, append `?v=${Date.now()}` for cache-busting.
    5. `supabase.rpc('set_my_agent_photo', { p_url: url })`.
    6. Return the URL.
  - `useRemoveAgentPhoto()` — remove the object(s) in `${user.id}/`, then `rpc('set_my_agent_photo', { p_url: null })`.
  - **Cross-component refresh:** on success, both mutations call `queryClient.invalidateQueries({ queryKey: ['my-agent-photo'] })`. Because `Account.tsx` and `Layout.tsx` both read the avatar via `useMyAgentPhoto()`, the shared query cache makes the header and Account card update together immediately — no change to the (sensitive, recently-stabilized) `useAuth` hook required.
- **`Account.tsx`:** add a "Profile Photo" `Card` above or below "Account Details":
  - Current `Avatar` (src from `useMyAgentPhoto()`, `name = agent.name` for the initials fallback), larger size.
  - **Upload / Change** button → hidden file input (`accept="image/png,image/jpeg,image/webp"`).
  - **Remove** button (only when a photo exists).
  - Inline validation message + success/error toasts (existing `useToast`).
  - Disable buttons while the mutation is pending.
- **`Layout.tsx` header:** render a small `Avatar` next to "Welcome, {displayName}" (src from `useMyAgentPhoto()`, name from the existing `displayName`).

### 5. admin-portal — read-only display

- **`AgentList.tsx`:** render a small `Avatar` in the agent name cell (`src = agent.photo_url`, `name = agent.name`). No query change (already `select('*')`).

## Data Flow

Upload: `Account.tsx` → `useUploadAgentPhoto` → Storage upload (own folder, RLS-checked) → public URL → `set_my_agent_photo` RPC (writes `agents.photo_url`) → invalidate `['my-agent-photo']` → `useMyAgentPhoto` refetches → header + Account avatar update together. Admin sees it on next `useAgents` fetch.

Remove: `Account.tsx` → `useRemoveAgentPhoto` → Storage delete + `set_my_agent_photo(null)` → invalidate `['my-agent-photo']` → avatars fall back to initials.

## Error Handling

- Wrong file type / oversized → rejected client-side with a clear message; no upload attempted.
- Storage upload error or RPC error → surfaced via toast; state unchanged.
- Broken/missing image URL at render → `Avatar` falls back to initials (`onError`).
- RPC rejects non-`agent-photos` URLs (defense in depth).

## Security Considerations

- Storage write is restricted to the user's own folder by RLS (`auth.uid()` folder prefix); one agent cannot overwrite another's photo.
- `set_my_agent_photo` only mutates `photo_url` for `auth.uid()`'s row — no path to change `tier_id`, `agent_code`, `name`, etc.
- URL guard in the RPC prevents persisting arbitrary strings as a "photo".
- Public bucket: objects are world-readable by URL, but the path contains a UUID folder and the URL is only surfaced in authenticated portals (acceptable for low-sensitivity headshots).

## Testing (manual verification matrix)

1. Upload a valid JPG/PNG/WebP → appears in agent header + Account card; appears in admin agent list after refresh.
2. Re-upload a different image → replaces immediately, no stale-cache image (verifies `?v=` busting + folder cleanup).
3. Remove photo → reverts to initials in header, Account, and admin list.
4. Oversized (> 2 MB) and non-image file → rejected with message, nothing uploaded.
5. RLS: confirm an agent cannot write to another agent's folder (path with a different uid is denied).
6. RPC scope: confirm calling `set_my_agent_photo` cannot alter any column other than `photo_url`, and only on the caller's row.
7. Initials fallback renders for an agent with no photo.

## Affected Files (summary)

- `supabase/migrations/<ts>_agent_profile_photo.sql` (new)
- `packages/shared-types/src/database.ts` (add `photo_url`)
- `packages/shared-ui/src/components/ui/avatar.tsx` (new) + `index.ts` export
- `apps/agent-portal/src/hooks/useAgentPhoto.ts` (new — `useMyAgentPhoto`, `useUploadAgentPhoto`, `useRemoveAgentPhoto`)
- `apps/agent-portal/src/pages/Account.tsx` (Profile Photo card)
- `apps/agent-portal/src/components/Layout.tsx` (header avatar)
- `apps/admin-portal/src/pages/agents/AgentList.tsx` (avatar cell)

`useAuth.ts` is intentionally **not** modified — display reads use the shared `useMyAgentPhoto` query so the fragile auth flow is untouched.
