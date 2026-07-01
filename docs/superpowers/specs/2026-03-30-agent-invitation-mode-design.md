# Agent-Level Invitation Mode Design

**Date:** 2026-03-30
**Status:** Approved

## Summary

Move invitation mode control from admin-managed (per-slot `is_auto_card`) to agent-managed (per-agent `is_auto_invite`). The setting determines whether invitations will auto-send email (future integration). Only Agent Admin accounts can toggle this setting. Card download on MyLinks becomes always available.

## Requirements

| Requirement | Decision |
|---|---|
| Setting scope | Per-agent (profile-level preference) |
| Who can change | Agent Admin only (not sub-agents, not partners) |
| Default value | `true` (auto) |
| Old `is_auto_card` on slots | Remove entirely |
| Purpose | Determines if invitation auto-sends email (future) |
| Card download button | Always visible (no longer gated) |

## Database Changes

### Migration

1. **Add** `is_auto_invite BOOLEAN NOT NULL DEFAULT true` to `agents` table
2. **Drop** `is_auto_card` column from `slots` table

### RLS

No new policies needed — existing agent RLS already controls access to the `agents` table.

## Type Changes (`packages/shared-types/src/database.ts`)

- Add `is_auto_invite: boolean` to `Agent` interface
- Remove `is_auto_card: boolean` from `Slot` interface
- Remove `autoCardColor` and `manualCardColor` from `CardTemplate` interface (no longer two card modes)

## Admin Portal Cleanup

### `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx`
- Remove Auto/Manual toggle checkbox in single slot creation form
- Remove Auto/Manual toggle checkbox in bulk slot creation form
- Remove Auto/Manual badge display in slot list
- Remove Auto/Manual toggle button in slot actions

### `apps/admin-portal/src/hooks/useSlots.ts`
- No structural changes needed (just won't send `is_auto_card` anymore)

## Agent Portal Changes

### Cleanup: `apps/agent-portal/src/pages/MyLinks.tsx`
- Remove conditional check on `slot?.is_auto_card` for download button
- Card download button is always visible

### Cleanup: `apps/agent-portal/src/hooks/useAgentLinks.ts`
- Remove `is_auto_card` from slot select query (no longer exists)

### New UI: `apps/agent-portal/src/pages/MyAgents.tsx`
- Add "Auto Invite" toggle at the top of the page (Agent Admin only)
- Toggle label: "Auto Invite"
- Toggle description: "Automatically send invitation cards via email when invitations are created"
- Calls `supabase.from('agents').update({ is_auto_invite })` for the current agent
- Hidden from sub-agent and partner accounts (role-gated)

## Data Flow

### Before (admin-driven)
```
Admin sets is_auto_card on Slot → Agent portal reads slot.is_auto_card → Shows/hides download button
```

### After (agent-driven)
```
Agent Admin sets is_auto_invite on their Agent profile → Future email integration reads agent.is_auto_invite → Auto-sends or skips email
Agent portal card download → Always available
```

### Current behavior of `is_auto_invite`
Stored preference only — no functional email integration yet. The toggle exists and the value persists for future use.

### Immediate effect
Removal of admin-controlled gating on card downloads and the slot-level toggle UI.
