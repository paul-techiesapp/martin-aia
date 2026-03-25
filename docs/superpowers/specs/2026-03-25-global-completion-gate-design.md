# Global Completion Gate — Re-Registration Support

**Date:** 2026-03-25
**Status:** Draft

## Problem

Currently, the system has no global constraint preventing a fully-completed invitee from registering again. Conversely, there is no explicit support for the intended workflow where a no-show invitee can be re-invited by the same or a different agent for a future slot.

## Business Rules

1. **Per-slot NRIC uniqueness stays** — a person cannot register twice for the same slot, even under a different agent.
2. **Cross-slot registration is allowed** — the same NRIC can register for different slots (already supported by current per-slot unique indexes).
3. **Global completion gate** — if ANY registration with a given NRIC has `status = 'completed'`, all new registrations for that NRIC are blocked system-wide.
4. **Old registrations are left as-is** — no status changes to prior incomplete registrations when a new one is created.
5. **Any agent can invite a non-completed person** — the agent relationship comes from whichever `agent_link` the customer uses to register.
6. **NULL NRIC exempt** — registrations with NULL NRIC are not subject to the global completion gate (consistent with existing per-slot uniqueness which also skips NULL via partial indexes).

## Identity Key

NRIC is the sole identifier for the global completion check. Phone, email, and name are not used for this constraint.

## Design

### Approach: Guard clause in `register_attendee()` RPC

A single check is added to the existing `register_attendee()` PostgreSQL function, **after link validation but before the capacity check**. This preserves the existing fail-fast behavior for invalid/inactive links and maintains the `FOR UPDATE` lock serialization model.

### Database Changes

**Migration: Modify `register_attendee()` function**

1. Add `v_completed_count integer;` to the `DECLARE` block.

2. Add the following check after link validation (after the `agent_links FOR UPDATE` lock) but before the capacity check:

```sql
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
```

3. Add a partial index to support the global lookup efficiently:

```sql
CREATE INDEX idx_registrations_nric_completed
  ON registrations(invitee_nric)
  WHERE status = 'completed' AND invitee_nric IS NOT NULL;
```

**Error code:** `P0005` — follows the existing convention (P0001–P0004).

### Frontend Change

**File:** `apps/public-pages/src/pages/Register.tsx`

Add handling for error code `P0005` in the existing error switch:

```typescript
case 'P0005':
  setError('This person has already completed an event and cannot register again.');
  break;
```

No other frontend changes required. The registration form, check-in, and check-out flows remain unchanged.

## What This Enables

| Scenario | Outcome |
|----------|---------|
| Customer registers for Slot A, doesn't show up | Stays `registered`. Can register for Slot B. |
| Customer registers for Slot A under Agent X, then Slot B under Agent Y | Both registrations coexist. Agent Y's link determines the relationship for Slot B. |
| Customer completes full cycle (check-in + check-out) on any slot | `status = 'completed'`. All future registrations blocked globally. |
| Agent tries to send link to a completed customer | Customer sees error P0005 when attempting to register. |

## Edge Cases

### Concurrency: checkout and registration racing

A narrow window exists where a customer could be checking out (about to become `completed`) while simultaneously registering for another slot. The completion gate uses a plain `SELECT COUNT(*)` and the checkout function locks `otp_codes`, not `registrations` by NRIC. In theory, a registration could sneak through just before the checkout commits.

**Accepted risk:** The window is extremely narrow (milliseconds), and the consequence is minor — one extra registration record that will never be used. No action needed.

### Admin status reversal

If an admin manually changes a registration's status from `completed` back to another status (e.g., via Supabase Studio), the global gate would no longer block that NRIC, re-enabling registration. This is intentionally allowed — admins have full control and may need to correct data errors.

## What Stays Unchanged

- Per-slot NRIC/phone unique indexes
- Check-in flow (NRIC/phone lookup within a slot)
- Check-out flow (OTP verification)
- Agent capacity counting (counts all registrations per agent per slot)
- Reward calculation
- Admin portal views

## Scope

- 1 migration file (modify `register_attendee()` RPC + add partial index)
- 1 frontend file (add error handling in `Register.tsx`)
