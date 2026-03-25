# Global Completion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent invitees who have completed the full event cycle (check-in + check-out) from registering again, while allowing re-registration for incomplete invitees across any slot/agent.

**Architecture:** Add a global NRIC completion check to the existing `register_attendee()` PostgreSQL RPC function, plus a supporting partial index. Handle the new error code in the public registration page.

**Tech Stack:** PostgreSQL (Supabase migration), React/TypeScript (public-pages app)

**Spec:** `docs/superpowers/specs/2026-03-25-global-completion-gate-design.md`

---

### Task 1: Create migration for global completion gate

**Files:**
- Create: `supabase/migrations/20260325000001_global_completion_gate.sql`

The migration does two things:
1. Adds a partial index for efficient NRIC completion lookups
2. Replaces `register_attendee()` with the completion gate added after link validation (line 210) but before capacity check (line 216)

- [ ] **Step 1: Create the migration file**

```sql
-- Global completion gate: prevent completed invitees from re-registering
-- Spec: docs/superpowers/specs/2026-03-25-global-completion-gate-design.md

-- 1. Partial index for efficient global NRIC completion lookup
CREATE INDEX idx_registrations_nric_completed
  ON registrations(invitee_nric)
  WHERE status = 'completed' AND invitee_nric IS NOT NULL;

-- 2. Replace register_attendee() with global completion gate
CREATE OR REPLACE FUNCTION register_attendee(
  p_link_code uuid,
  p_name text,
  p_nric text,
  p_phone text,
  p_email text DEFAULT NULL,
  p_occupation text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_link agent_links%ROWTYPE;
  v_tier tiers%ROWTYPE;
  v_agent agents%ROWTYPE;
  v_count integer;
  v_completed_count integer;
  v_capacity_type capacity_type;
  v_registration_id uuid;
BEGIN
  -- Look up agent_link with row lock (serializes concurrent registrations per link)
  SELECT * INTO v_link FROM agent_links WHERE link_code = p_link_code AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE = 'P0001';
  END IF;

  -- Global completion gate: block registration if NRIC already completed an event
  IF p_nric IS NOT NULL THEN
    SELECT COUNT(*) INTO v_completed_count
    FROM registrations
    WHERE invitee_nric = p_nric AND status = 'completed';

    IF v_completed_count > 0 THEN
      RAISE EXCEPTION 'Invitee has already completed an event'
        USING ERRCODE = 'P0005';
    END IF;
  END IF;

  -- Get agent's tier for capacity limit
  SELECT a.* INTO v_agent FROM agents a WHERE a.id = v_link.agent_id;
  SELECT t.* INTO v_tier FROM tiers t WHERE t.id = v_agent.tier_id;

  -- Capacity check (lock held on agent_link prevents concurrent over-registration)
  SELECT COUNT(*) INTO v_count
  FROM registrations
  WHERE agent_id = v_link.agent_id AND slot_id = v_link.slot_id;

  IF v_count >= v_tier.invitation_limit_per_slot THEN
    RAISE EXCEPTION 'Registration full' USING ERRCODE = 'P0002';
  END IF;

  -- Determine capacity type
  IF v_link.partner_id IS NULL THEN
    v_capacity_type := 'agent';
  ELSE
    v_capacity_type := 'business_partner';
  END IF;

  -- Check NRIC duplicate per slot
  IF p_nric IS NOT NULL THEN
    PERFORM 1 FROM registrations WHERE slot_id = v_link.slot_id AND invitee_nric = p_nric;
    IF FOUND THEN
      RAISE EXCEPTION 'NRIC already registered for this slot' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Check phone duplicate per slot
  IF p_phone IS NOT NULL THEN
    PERFORM 1 FROM registrations WHERE slot_id = v_link.slot_id AND invitee_phone = p_phone;
    IF FOUND THEN
      RAISE EXCEPTION 'Phone already registered for this slot' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- Insert registration
  INSERT INTO registrations (
    agent_link_id, agent_id, slot_id, capacity_type, status,
    invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation,
    registered_at
  ) VALUES (
    v_link.id, v_link.agent_id, v_link.slot_id, v_capacity_type, 'registered',
    p_name, p_nric, p_phone, p_email, p_occupation,
    now()
  ) RETURNING id INTO v_registration_id;

  RETURN v_registration_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Verify migration applies cleanly to local Supabase**

Run: `npx supabase db reset`
Expected: All migrations apply without errors, database resets successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260325000001_global_completion_gate.sql
git commit -m "feat(db): add global completion gate to register_attendee RPC

Block registration when invitee NRIC already has a completed event.
Adds partial index on registrations(invitee_nric) WHERE status='completed'.
New error code P0005 for completed invitees."
```

---

### Task 2: Handle P0005 error in registration page

**Files:**
- Modify: `apps/public-pages/src/pages/Register.tsx:147-148` (add `else if` before the generic fallback)

- [ ] **Step 1: Add P0005 error handling**

In `apps/public-pages/src/pages/Register.tsx`, add the following `else if` block between the P0004 check (line 147) and the generic `else` fallback (line 148):

```typescript
      } else if (rpcError.code === 'P0005') {
        setError('This person has already completed an event and cannot register again.');
```

The resulting block should read (lines 140–150):
```typescript
      if (rpcError.code === 'P0001') {
        setError('This registration link is no longer active');
      } else if (rpcError.code === 'P0002') {
        setError('Sorry, this event slot is full. No more registrations are available.');
      } else if (rpcError.code === 'P0003') {
        setError('This NRIC has already been registered for this event slot');
      } else if (rpcError.code === 'P0004') {
        setError('This phone number has already been registered for this event slot');
      } else if (rpcError.code === 'P0005') {
        setError('This person has already completed an event and cannot register again.');
      } else {
        setError('Failed to complete registration. Please try again.');
      }
```

- [ ] **Step 2: Verify the app builds**

Run: `pnpm --filter public-pages build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/public-pages/src/pages/Register.tsx
git commit -m "feat(public): handle P0005 global completion gate error

Show user-friendly message when a completed invitee tries to register again."
```

---

### Task 3: Deploy migration to production Supabase

**Files:** None (deployment only)

- [ ] **Step 1: Push migration to production**

Run: `npx supabase db push --project-ref wictbtiulqmzzneyoelv`
Expected: Migration applies successfully. The `register_attendee()` function is updated and the partial index is created.

- [ ] **Step 2: Verify function exists with new error code**

Run via Supabase SQL Editor or CLI:
```sql
SELECT prosrc FROM pg_proc WHERE proname = 'register_attendee';
```
Expected: Function source contains `P0005` and `v_completed_count`.

- [ ] **Step 3: Verify index exists**

```sql
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_registrations_nric_completed';
```
Expected: One row returned.

---

### Task 4: Push frontend and verify end-to-end

- [ ] **Step 1: Push to main branch**

```bash
git push origin main
```
Expected: Auto-deploy triggers for all three Render static sites.

- [ ] **Step 2: Verify end-to-end on production**

Test scenario:
1. Find or create a registration with `status = 'completed'` in the database
2. Use a valid agent link to try registering with the same NRIC
3. Expected: Registration form shows error "This person has already completed an event and cannot register again."
4. Try registering with a different NRIC that has no completed record
5. Expected: Registration succeeds normally.
