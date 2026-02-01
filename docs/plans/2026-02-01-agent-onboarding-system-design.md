# Agent Onboarding & Event Attendance System

**Date:** 2026-02-01
**Status:** Approved

---

## Overview

A web-based system for managing agent recruitment events, tracking invitations, and recording attendance with reward calculations.

## Actors

| Actor | Description |
|-------|-------------|
| **Admin** | Full system control - campaigns, slots, agents, reports |
| **Agent** | Can invite new members, operates as individual or Business Partner |
| **New Member** | Receives invitation link, registers, attends event |

## Core Workflows

### Campaign Flow
1. Admin creates Campaign (name, dates, venue, invitation type)
2. Admin configures Slots (day of week, times, check-in/out windows)
3. Admin activates Campaign → Agents can participate

### Invitation Flow
1. Agent logs in → Views active campaigns
2. Agent requests X invitation links (as "Agent" or "Business Partner")
3. System validates tier limits → Generates unique one-time links
4. Agent manually shares links via WhatsApp/SMS
5. New Member clicks link → Fills registration form
6. System validates NRIC & Phone uniqueness → Saves → Link expires

### Attendance Flow
1. Admin generates & prints PIN codes for slot
2. Event day: Staff distributes PINs to attendees at arrival
3. Admin displays CHECK-IN QR → Attendees scan → Enter PIN + NRIC
4. Event runs (2-3 hours)
5. Admin displays CHECK-OUT QR → Attendees scan → Enter PIN + NRIC
6. Full attendance (in + out within windows) = Reward credited

## Features

### Admin Portal
- Campaign & slot management (CRUD, activate/pause)
- Agent account management with tier assignment
- Tier configuration (reward amounts, invitation limits)
- PIN code generation & printing
- Invitation card generation & printing
- CHECK-IN / CHECK-OUT QR display for venue
- Comprehensive reporting dashboard

### Agent Portal
- View active campaigns
- Request invitation links (specify count + capacity type)
- View invitation history & status
- Track invitees' registration & attendance
- View personal reward summary

### Public Pages (No auth)
- Registration form (via unique link)
- Check-in page (QR scan → PIN + NRIC)
- Check-out page (QR scan → PIN + NRIC)

## Data Model

### campaigns
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| name | text | Campaign name |
| start_date | date | Campaign start |
| end_date | date | Campaign end |
| venue | text | Event location |
| invitation_type | enum | business_opportunity, job_opportunity |
| status | enum | draft, active, paused, completed |

### slots
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| campaign_id | uuid | FK to campaigns |
| day_of_week | int | 0 (Sunday) - 6 (Saturday) |
| start_time | time | Slot start time |
| end_time | time | Slot end time |
| checkin_window_minutes | int | Minutes from start for check-in (default 30) |
| checkout_window_minutes | int | Minutes before end for check-out (default 30) |
| is_active | boolean | Can agents invite for this slot |

### tiers
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| name | text | e.g., "Gold Agent", "Silver Partner" |
| role_type | enum | agent, business_partner |
| reward_amount | decimal | Reward per full attendance |
| invitation_limit_per_slot | int | Max invitations per slot |

### agents
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users |
| name | text | Full name |
| email | text | Unique |
| phone | text | Unique |
| nric | text | Unique |
| agent_code | text | Unique identifier |
| unit_name | text | Team/unit |
| tier_id | uuid | FK to tiers |
| status | enum | active, inactive |

### invitations
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| agent_id | uuid | FK to agents |
| slot_id | uuid | FK to slots |
| capacity_type | enum | agent, business_partner |
| unique_token | uuid | One-time link token |
| status | enum | pending, registered, attended, completed, expired |
| invitee_name | text | As per IC |
| invitee_nric | text | Unique |
| invitee_phone | text | Unique |
| invitee_email | text | |
| invitee_occupation | text | |
| registered_at | timestamp | |

### pin_codes
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| slot_id | uuid | FK to slots |
| code | text | 6-digit PIN |
| linked_nric | text | Linked on first use |
| is_used | boolean | Default false |

### attendance
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| invitation_id | uuid | FK to invitations |
| pin_code_id | uuid | FK to pin_codes |
| checkin_time | timestamp | |
| checkout_time | timestamp | Nullable until checkout |
| is_full_attendance | boolean | Computed: both in & out within windows |

### rewards
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| agent_id | uuid | FK to agents |
| attendance_id | uuid | FK to attendance |
| amount | decimal | From tier config |
| capacity_type | enum | agent, business_partner |
| status | enum | pending, confirmed, paid |

## Reports

### Invitation Reports
- By Campaign: Total sent, registrations, conversion rate
- By Slot: Per day-of-week breakdown
- By Agent/Partner: Individual performance
- By Type: Business vs Job opportunity

### Attendance Reports
- Show Rate: Registered vs Checked-in
- Completion Rate: Checked-in vs Full attendance
- Drop-off: Checked-in but no check-out
- By Agent: Who brings committed attendees

### Reward Reports
- By Agent: Earned, pending, confirmed
- By Tier: Performance per tier level
- By Period: Weekly/monthly summaries
- Export: CSV for payroll

### Analytics
- Week-over-week trends
- Top performer leaderboard
- Conversion funnel visualization
- Slot performance analysis

## Tech Stack

| Layer | Technology |
|-------|------------|
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Backend Logic | Supabase Edge Functions |
| Frontend | React + Vite |
| UI | shadcn/ui + Tailwind CSS |
| Hosting | Vercel (frontend) + Supabase (backend) |
| PDF | react-pdf |
| Charts | Recharts |

## Project Structure

```
/apps
  /admin-portal      → Admin dashboard
  /agent-portal      → Agent/Partner portal
  /public-pages      → Registration, Check-in/out

/packages
  /shared-ui         → Shared shadcn components
  /shared-types      → TypeScript types

/supabase
  /migrations        → Database schema
  /functions         → Edge functions
```

## Security

- **Row Level Security (RLS):** Agents see only their data
- **Unique tokens:** UUID v4, one-time use
- **PIN codes:** Random 6-digit, unique per slot
- **NRIC/Phone:** Format validation + uniqueness
- **Rate limiting:** Prevent brute-force attacks

## Constraints

- NRIC must be unique across all invitations
- Phone must be unique across all invitations
- Invitation links expire after single use
- PIN codes are slot-specific and one-time use
- Check-in/out only valid within configured time windows
