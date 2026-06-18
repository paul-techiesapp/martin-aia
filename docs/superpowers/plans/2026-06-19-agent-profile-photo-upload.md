# Agent Profile Photo Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent upload, change, and remove their own profile photo in the agent portal, with read-only display in the admin agent list.

**Architecture:** A nullable `photo_url` column on `agents`, a public `agent-photos` Supabase Storage bucket (writes locked to each user's own folder via storage RLS), and a `SECURITY DEFINER` RPC `set_my_agent_photo(p_url)` that writes only the caller's `photo_url`. The agent portal uploads to storage, then calls the RPC. A shared `Avatar` component renders the photo (with an initials fallback) in the agent portal header + Account page and the admin agent list. The agent portal's header and Account page read the live photo through one shared TanStack Query (`useMyAgentPhoto`) so both refresh together after an upload — `useAuth` is deliberately left untouched.

**Tech Stack:** React 18, TypeScript, Vite, TanStack Query, Tailwind, shadcn/ui (Radix), Supabase (Postgres 15 + Storage + RLS), pnpm workspaces, lucide-react icons.

## Global Constraints

- **Monorepo:** pnpm workspaces. Shared code lives in `packages/shared-ui` (`@agent-system/shared-ui`) and `packages/shared-types` (`@agent-system/shared-types`).
- **Single Supabase client:** always import `supabase` from `@agent-system/shared-ui` (apps re-export it via `../lib/supabase`). NEVER call `createClient` locally.
- **Accepted image types:** `image/jpeg`, `image/png`, `image/webp`. **Max size:** 2 MB (`2 * 1024 * 1024`). Validate client-side before upload.
- **RLS-safe writes:** agents have NO table UPDATE policy and share the `authenticated` role with admins. Persist `photo_url` ONLY through the `set_my_agent_photo` RPC. Do not add a broad UPDATE policy or column GRANT.
- **`cn` import inside `packages/shared-ui/src/components/ui/*`:** `import { cn } from "../../lib/utils"`.
- **No automated test runner exists** (`pnpm -r test` is an empty passthrough). Verification gates per task are: `pnpm -r typecheck`, `pnpm lint`, the relevant `pnpm --filter <app> build`, plus the manual check described in the task. The user runs the dev servers and local Supabase in separate tabs — when a step needs the backend reset or an app reload, state it explicitly and let the user perform it.
- **Branch:** all work commits onto `feat/agent-profile-photo` (already created and checked out).
- **Out of scope:** public registration pages, PDF invitation card, admins setting agent photos.

---

### Task 1: Database migration — column, bucket, storage RLS, RPC

**Files:**
- Create: `supabase/migrations/20260619000001_agent_profile_photo.sql`

**Interfaces:**
- Produces:
  - `agents.photo_url` — `TEXT NULL` column.
  - Storage bucket id `agent-photos` (public).
  - RPC `set_my_agent_photo(p_url text) RETURNS void` — updates `photo_url` for `auth.uid()`'s agent row; raises on a URL outside the `agent-photos` bucket; `NULL` clears.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260619000001_agent_profile_photo.sql` with exactly:

```sql
-- Agent profile photo: column, public storage bucket, owner-scoped RLS, and a
-- SECURITY DEFINER RPC so agents can set ONLY their own photo_url (agents have
-- no table UPDATE policy and share the authenticated role with admins).

-- 1. Column
ALTER TABLE agents ADD COLUMN photo_url TEXT;

-- 2. Public bucket for agent photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('agent-photos', 'agent-photos', true);

-- 3. Storage RLS
-- Public read (bucket is public; URLs are only surfaced in authenticated portals).
CREATE POLICY "Public read access for agent photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'agent-photos');

-- Each agent may write only inside a folder named after their auth uid.
CREATE POLICY "Agents manage own photo"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'agent-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'agent-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins may manage all agent photos.
CREATE POLICY "Admins manage all agent photos"
  ON storage.objects FOR ALL
  USING (bucket_id = 'agent-photos' AND is_admin())
  WITH CHECK (bucket_id = 'agent-photos' AND is_admin());

-- 4. RPC: set the calling agent's photo_url (NULL clears it).
CREATE OR REPLACE FUNCTION set_my_agent_photo(p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reject anything that is not a public URL for THIS project's agent-photos
  -- bucket inside the caller's own uid folder. An unanchored LIKE '%...%' would
  -- accept e.g. https://evil.com/storage/v1/object/public/agent-photos/x, which
  -- would then load in an admin's browser via <img src>. Anchor the host to
  -- localhost / *.supabase.co and pin the path to auth.uid() so only our own
  -- storage origin and the caller's own folder pass. NULL clears the photo.
  IF p_url IS NOT NULL
     AND (
       p_url ~ '[[:space:]@]'   -- block CR/LF and userinfo host-spoofing
       OR p_url !~ (
         '^https?://(localhost|127\.0\.0\.1|[a-z0-9-]+\.supabase\.co)(:[0-9]+)?'
         || '/storage/v1/object/public/agent-photos/' || auth.uid()::text || '/[^/]+$'
       )
     ) THEN
    RAISE EXCEPTION 'Invalid photo URL';
  END IF;

  UPDATE agents
     SET photo_url = p_url,
         updated_at = now()
   WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION set_my_agent_photo(text) TO authenticated;
```

- [ ] **Step 2: Apply the migration locally**

This needs the local Supabase stack. Ask the user to run it (they manage the backend tab):

Run: `npx supabase db reset`
Expected: migrations apply cleanly through `20260619000001_agent_profile_photo.sql` with no error, seed re-runs.

- [ ] **Step 3: Verify schema, bucket, and RPC exist**

Run (psql against local DB on port 54322):
```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "\d agents" -c "select id,public from storage.buckets where id='agent-photos';" -c "select proname from pg_proc where proname='set_my_agent_photo';"
```
Expected: `photo_url | text` appears in the `agents` description; one `agent-photos | t` bucket row; one `set_my_agent_photo` proc row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619000001_agent_profile_photo.sql
git commit -m "feat(db): agent photo_url column, agent-photos bucket, set_my_agent_photo RPC"
```

---

### Task 2: Add `photo_url` to the shared Agent type

**Files:**
- Modify: `packages/shared-types/src/database.ts` (the `Agent` interface, ends at line 128)

**Interfaces:**
- Produces: `Agent.photo_url: string | null` (inherited by `AgentWithTier`).

- [ ] **Step 1: Add the field**

In `packages/shared-types/src/database.ts`, inside `export interface Agent { ... }`, add `photo_url` immediately after the `status` line:

```ts
  status: AgentStatus;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -r typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/database.ts
git commit -m "feat(types): add photo_url to Agent"
```

---

### Task 3: Shared `Avatar` component

**Files:**
- Create: `packages/shared-ui/src/components/ui/avatar.tsx`
- Modify: `packages/shared-ui/src/index.ts` (add export near the other UI exports, e.g. after the `Badge` export on line 77)

**Interfaces:**
- Produces: `Avatar` React component.
  - Props: `{ src?: string | null; name?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }`.
  - Renders a rounded `<img>` (`object-cover`) when `src` is truthy and the image loads; otherwise up-to-two-letter initials from `name` on a muted circle; falls back to initials if the image errors.

- [ ] **Step 1: Create the component**

Create `packages/shared-ui/src/components/ui/avatar.tsx` with exactly:

```tsx
import { useEffect, useState } from "react"
import { cn } from "../../lib/utils"

function initialsFrom(name?: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0][0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : ""
  return (first + last).toUpperCase()
}

const SIZE_CLASSES = {
  sm: "size-8 text-xs",
  md: "size-12 text-sm",
  lg: "size-20 text-xl",
} as const

export interface AvatarProps {
  src?: string | null
  name?: string | null
  size?: keyof typeof SIZE_CLASSES
  className?: string
}

export function Avatar({ src, name, size = "md", className }: AvatarProps) {
  const [errored, setErrored] = useState(false)

  // Reset the error flag whenever the source changes (e.g. after a re-upload),
  // so a previously-broken URL doesn't keep us stuck on initials.
  useEffect(() => setErrored(false), [src])

  const showImage = !!src && !errored

  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src as string}
          alt={name ?? "Profile photo"}
          className="size-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        initialsFrom(name)
      )}
    </span>
  )
}
```

- [ ] **Step 2: Export it**

In `packages/shared-ui/src/index.ts`, add after the `Badge` export line (line 77):

```ts
export { Avatar } from './components/ui/avatar';
export type { AvatarProps } from './components/ui/avatar';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-ui/src/components/ui/avatar.tsx packages/shared-ui/src/index.ts
git commit -m "feat(ui): shared Avatar component with initials fallback"
```

---

### Task 4: Agent-portal photo hooks (`useMyAgentPhoto`, upload, remove)

**Files:**
- Create: `apps/agent-portal/src/hooks/useAgentPhoto.ts`

**Interfaces:**
- Consumes: `supabase` from `../lib/supabase`; the `set_my_agent_photo` RPC (Task 1).
- Produces:
  - `useMyAgentPhoto(userId: string | undefined)` → TanStack query, `data: string | null` (the photo URL). `queryKey: ['my-agent-photo', userId]`, disabled when `userId` is falsy.
  - `useUploadAgentPhoto()` → mutation, `mutateAsync(file: File) => Promise<string>` (returns the cache-busted URL). Validates type/size, replaces the user's folder contents, uploads, calls the RPC, invalidates `['my-agent-photo']`.
  - `useRemoveAgentPhoto()` → mutation, `mutateAsync() => Promise<void>`. Deletes the user's folder contents, calls the RPC with `null`, invalidates `['my-agent-photo']`.

- [ ] **Step 1: Create the hook file**

Create `apps/agent-portal/src/hooks/useAgentPhoto.ts` with exactly:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const BUCKET = 'agent-photos';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/** Live source of the signed-in agent's own photo URL, shared across components. */
export function useMyAgentPhoto(userId: string | undefined) {
  return useQuery({
    queryKey: ['my-agent-photo', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('photo_url')
        .eq('user_id', userId as string)
        .single();
      if (error) throw error;
      return (data?.photo_url as string | null) ?? null;
    },
  });
}

async function clearFolder(userId: string) {
  const { data: existing } = await supabase.storage.from(BUCKET).list(userId);
  if (existing && existing.length > 0) {
    await supabase.storage
      .from(BUCKET)
      .remove(existing.map((f) => `${userId}/${f.name}`));
  }
}

export function useUploadAgentPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error('Please choose a JPG, PNG, or WebP image.');
      }
      if (file.size > MAX_BYTES) {
        throw new Error('Image must be 2 MB or smaller.');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You are not signed in.');

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      await clearFolder(user.id); // remove any prior photo (covers ext changes)

      const path = `${user.id}/profile.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = `${urlData.publicUrl}?v=${Date.now()}`; // cache-bust on re-upload

      const { error: rpcErr } = await supabase.rpc('set_my_agent_photo', { p_url: url });
      if (rpcErr) throw rpcErr;

      return url;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-agent-photo'] });
    },
  });
}

export function useRemoveAgentPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You are not signed in.');

      await clearFolder(user.id);

      const { error } = await supabase.rpc('set_my_agent_photo', { p_url: null });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-agent-photo'] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -r typecheck`
Expected: PASS. (`supabase.rpc('set_my_agent_photo', ...)` is accepted because the client is untyped — the project casts query results manually.)

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/hooks/useAgentPhoto.ts
git commit -m "feat(agent): photo query + upload/remove mutation hooks"
```

---

### Task 5: Agent-portal Account page — Profile Photo card

**Files:**
- Modify: `apps/agent-portal/src/pages/Account.tsx`

**Interfaces:**
- Consumes: `useMyAgentPhoto`, `useUploadAgentPhoto`, `useRemoveAgentPhoto` (Task 4); `Avatar` (Task 3); existing `useAuth().user` / `.agent` and `useToast`.

- [ ] **Step 1: Add imports**

In `apps/agent-portal/src/pages/Account.tsx`:

Change the React import (currently `import { useForm } from 'react-hook-form';` is the first line — add a React import for `useRef` at the very top of the file):

```ts
import { useRef } from 'react';
```

Add `Avatar` to the `@agent-system/shared-ui` import list (it already imports `Card`, `Button`, `useToast`, `supabase`, etc.) — add `Avatar,` to that destructured import.

Add `Camera` to the lucide import (currently `import { KeyRound } from 'lucide-react';`):

```ts
import { KeyRound, Camera } from 'lucide-react';
```

Add the hook import below the existing `useAuth` import:

```ts
import { useMyAgentPhoto, useUploadAgentPhoto, useRemoveAgentPhoto } from '../hooks/useAgentPhoto';
```

- [ ] **Step 2: Add photo state + handlers inside the `Account` component**

Immediately after the existing `const form = useForm<PasswordForm>({ ... });` block, add:

```tsx
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: photoUrl } = useMyAgentPhoto(user?.id);
  const uploadPhoto = useUploadAgentPhoto();
  const removePhoto = useRemoveAgentPhoto();
  const photoBusy = uploadPhoto.isPending || removePhoto.isPending;

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the user re-pick the same file later
    if (!file) return;
    try {
      await uploadPhoto.mutateAsync(file);
      toast({ title: 'Photo updated', description: 'Your profile photo has been saved.' });
    } catch (err) {
      toast({
        title: 'Could not upload photo',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    }
  };

  const handlePhotoRemove = async () => {
    try {
      await removePhoto.mutateAsync();
      toast({ title: 'Photo removed' });
    } catch (err) {
      toast({
        title: 'Could not remove photo',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    }
  };
```

- [ ] **Step 3: Render the Profile Photo card**

In the returned JSX, insert this card between the "Account Details" `Card` and the "Change Password" `Card` (i.e. right after the closing `</Card>` of Account Details). Gate on `agent` so partners — who have no `agents` row — don't see it:

```tsx
      {agent && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="size-4" />
              Profile Photo
            </CardTitle>
            <CardDescription>
              Upload a photo so your team can recognize you. JPG, PNG, or WebP up to 2 MB.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar src={photoUrl} name={agent.name} size="lg" />
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoBusy}
                >
                  {uploadPhoto.isPending ? 'Uploading…' : photoUrl ? 'Change Photo' : 'Upload Photo'}
                </Button>
                {photoUrl && (
                  <Button type="button" variant="outline" onClick={handlePhotoRemove} disabled={photoBusy}>
                    {removePhoto.isPending ? 'Removing…' : 'Remove'}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `pnpm -r typecheck && pnpm lint && pnpm --filter agent-portal build`
Expected: all PASS.

- [ ] **Step 5: Manual verification** (ask the user; their agent-portal dev tab is at http://localhost:3001)

Log in as `agent@test.com`, open **Account**:
- Upload a JPG ≤ 2 MB → toast "Photo updated", the large avatar shows the image.
- Pick a 3 MB file or a `.pdf` → toast error ("2 MB or smaller" / "JPG, PNG, or WebP"), no change.
- Click **Change Photo**, pick a different image → avatar updates immediately (no stale image).
- Click **Remove** → avatar reverts to initials.

- [ ] **Step 6: Commit**

```bash
git add apps/agent-portal/src/pages/Account.tsx
git commit -m "feat(agent): profile photo upload card on Account page"
```

---

### Task 6: Agent-portal header avatar

**Files:**
- Modify: `apps/agent-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `useMyAgentPhoto` (Task 4); `Avatar` (Task 3); existing `useAuth()`.

- [ ] **Step 1: Add imports**

In `apps/agent-portal/src/components/Layout.tsx`:

Add `Avatar` to the `@agent-system/shared-ui` import (line 3 currently: `import { cn, Button, Sheet, SheetContent, SheetTrigger, Logo } from '@agent-system/shared-ui';`) → add `Avatar,`.

Add the hook import after the `useAuth` import (line 5):

```ts
import { useMyAgentPhoto } from '../hooks/useAgentPhoto';
```

- [ ] **Step 2: Read user + photo in the component**

Change the `useAuth()` destructure (line 33) to also pull `user`:

```tsx
  const { agent, partner, role, isLoading, session, signOut, user } = useAuth();
```

Add, just below that line:

```tsx
  const { data: photoUrl } = useMyAgentPhoto(user?.id);
```

- [ ] **Step 3: Render the avatar in the header**

In the header's left cluster (the `<div className="flex items-center gap-4">` at line 118), add the avatar right before the `{displayName && (` block. Hide it for partners (no `agents` row):

```tsx
              {role !== 'partner' && <Avatar src={photoUrl} name={displayName} size="sm" />}
              {displayName && (
```

(The `{displayName && (` line and everything after it stays unchanged.)

- [ ] **Step 4: Typecheck, lint, build**

Run: `pnpm -r typecheck && pnpm lint && pnpm --filter agent-portal build`
Expected: all PASS.

- [ ] **Step 5: Manual verification** (user, http://localhost:3001)

As `agent@test.com` with a photo set: the small avatar appears next to "Welcome, …" and updates immediately after upload/remove on the Account page (same shared query). As a partner login: no avatar in the header.

- [ ] **Step 6: Commit**

```bash
git add apps/agent-portal/src/components/Layout.tsx
git commit -m "feat(agent): show profile photo in portal header"
```

---

### Task 7: Admin-portal agent list avatar

**Files:**
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 3); existing `useAgents()` data (already selects `*`, so `photo_url` is present — no query change).

- [ ] **Step 1: Add the Avatar import**

In `apps/admin-portal/src/pages/agents/AgentList.tsx`, add `Avatar,` to the `@agent-system/shared-ui` destructured import (the block ending at line 41, e.g. right after `Button,` on line 4).

- [ ] **Step 2: Render the avatar in the Name cell**

Replace the "All Units" table Name cell (line 232):

```tsx
                    <TableCell className="font-medium">{agent.name}</TableCell>
```

with:

```tsx
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={agent.photo_url} name={agent.name} size="sm" />
                        <span>{agent.name}</span>
                      </div>
                    </TableCell>
```

(The table keeps 7 columns, so the `TableSkeleton rows={5} columns={7}` on line 212 is unchanged.)

- [ ] **Step 3: Typecheck, lint, build**

Run: `pnpm -r typecheck && pnpm lint && pnpm --filter admin-portal build`
Expected: all PASS.

- [ ] **Step 4: Manual verification** (user, admin portal at http://localhost:3000)

Open **Units**: agents who set a photo show it beside their name; agents without one show initials. (Set a photo via the agent portal first to confirm it appears here after refresh.)

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/pages/agents/AgentList.tsx
git commit -m "feat(admin): show agent profile photo in unit list"
```

---

## Final verification (after all tasks)

- [ ] Run the full gate once more: `pnpm -r typecheck && pnpm lint && pnpm build`
- [ ] End-to-end manual pass (user): upload in agent portal → appears in agent header + Account + admin Units list; re-upload replaces with no stale cache; remove reverts everywhere to initials; oversized/non-image rejected.
- [ ] **Production note (do NOT auto-run):** the migration must be applied to the production Supabase project (`mjtdsevynrtcmafsnxsj`) when deploying. Storage RLS and the bucket are created by the same migration. Flag this to the user at merge time — do not push to prod without their go-ahead.

## Self-Review (completed by plan author)

- **Spec coverage:** column + bucket + storage RLS + RPC (Task 1); `photo_url` type (Task 2); Avatar (Task 3); upload/remove/live-query hook with 2 MB + JPG/PNG/WebP validation and `?v=` cache-bust (Task 4); Account upload/remove UI + error toasts (Task 5); header avatar (Task 6); admin list avatar (Task 7); manual test matrix (per-task + final). All spec sections mapped.
- **Cross-component refresh:** header (Task 6) and Account (Task 5) both consume `useMyAgentPhoto`; mutations invalidate `['my-agent-photo']` — matches spec; `useAuth` untouched.
- **Type/name consistency:** `set_my_agent_photo`/`p_url`, bucket `agent-photos`, queryKey `['my-agent-photo']`, and `Avatar` prop names are identical across Tasks 1, 4, 5, 6, 7.
- **Security:** writes only via RPC (own row, `photo_url` only) + folder-scoped storage RLS; URL guard in RPC. No broad UPDATE policy or column GRANT (would break admin AgentForm).
