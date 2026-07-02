# Partnership Feedback Round 3 — Design

Date: 2026-07-02
Branch: `feat/merchant-partnership`
Status: Approved by Paul (chat), pending spec review

Round 3 feedback (6 items) on the merchant gift-partner subsystem. Applies to staging
(Supabase `lyjdlietzmmejrxjvwgp`) first; prod on explicit go.

## Item 1 — Agent-proposed partnership: full info + agreement upload + master admin approval

Current: agent "Propose Partner" dialog (`apps/agent-portal/src/pages/MyEnquiries.tsx:366-413`)
collects only a merchant name; inserts `merchants` row with `status='pending'`. Admin approves
via `approve_merchant()` RPC from `MerchantList.tsx`. No document upload exists.

### Storage
- New **private** bucket `merchant-agreements` (10 MB limit; `application/pdf`, `image/jpeg`, `image/png`),
  modeled on `enquiry-attachments` (`20260629000030_enquiry_attachments.sql`).
- Object path convention: `<agent_id>/<uuid>-<filename>`.
- Policies: authenticated agents INSERT under their own `get_agent_id()` prefix; agents SELECT own
  prefix; admins SELECT all. No public access; reads via signed URLs.

### Schema
New nullable columns on `merchants`:
- `agreement_path text` — storage path of uploaded signed agreement
- `contact_person text`
- `contact_phone text`

### Agent portal
- Extract propose dialog into `apps/agent-portal/src/components/ProposePartnerDialog.tsx`.
- Fields: merchant name (required), contact person, contact phone, first branch
  (name required, address, phone), signed agreement file (required).
- **Decision:** agent-uploaded merchant logo is out of scope for round 3 (agents cannot write
  `company-assets`; admins can set the logo later). The dialog uploads only the agreement.
- Flow: upload agreement → insert merchant (`status='pending'`, contact fields, `agreement_path`)
  → insert first branch (`status='pending'`, `created_by_agent_id`).
- Money terms (`merchant_share_pct`) are NOT collected from agents.

### Admin portal
- `MerchantDetail.tsx`: show proposed contact person/phone; "View agreement" button generating a
  signed URL for `agreement_path`; allow setting `merchant_share_pct` before approving.
- `MerchantList.tsx` pending flow unchanged (Approve button → `approve_merchant`).

## Item 2 — Unit viewers see group/unit enquiries

Current gap: `enquiries`/`enquiry_vehicles` RLS only allows `agent_id = get_agent_id()`
(`20260627000002_merchant_enquiries.sql:61-68`). Unit viewers (`is_unit_viewer()`) were extended
to registrations/rewards/attendance in round 2 but not enquiries.

- New migration: SELECT policies on `enquiries` and `enquiry_vehicles` for unit viewers:
  `agent_id IN (SELECT unit_member_ids())` (vehicles via parent enquiry), OR-combined with
  existing own-enquiry policies.
- Storage: extend `enquiry-attachments` read policy so unit viewers can generate signed URLs for
  unit members' enquiry attachments.
- Agent portal `MyEnquiries.tsx`: for unit viewers, fetch unit-wide enquiries; add an "Agent"
  column and agent filter (mirror the round-2 Team Report pattern). Non-viewers see no change.

## Item 3 — Hierarchy naming: Unit Manager > Unit Admin > Agents

Current model (round 2): top-level agent (`parent_agent_id IS NULL`) called "Unit Admin";
sub-agent flagged `agents.is_unit_manager` called "Unit Manager". Feedback reverses the terms.

- **UI-only relabel; no schema change.** DB column stays `is_unit_manager` (renaming would touch
  RLS functions for no functional gain).
- Top-level agent = **Unit Manager** (head of unit).
- `is_unit_manager` flag = **Unit Admin** (deputy designated by admin; same unit-wide view).
- Update: AgentForm toggle label/description (`apps/admin-portal/src/pages/agents/AgentForm.tsx:300`),
  any badges/labels in admin + agent portals, comments in `useAllAgents.ts`/`useReports.ts`,
  and shared-types JSDoc. Permissions unchanged.

## Item 4 — A-Z logo on gold application form

Operational (no code):
- Upload `A-Z LOGO.png` to the public `company-assets` bucket (staging), set
  `system_settings.form_branding.logo_url` to its public URL. All public forms (item 5) then show it.
- Repeat on prod at go-live.

## Item 5 — Header/footer on all public forms

Current: only `Enquiry.tsx` renders `form_branding` (logo header + footer text).

- New shared pieces in public-pages: `useFormBranding` hook (already exists for enquiry —
  reuse/move to a shared location) + a small `BrandedHeader`/`BrandedFooter` (or single
  `FormChrome`) component.
- Apply to Registration, Check-in, Check-out pages: logo resolution
  `form_branding.logo_url → default Logo`; footer `form_branding.footer_text → default`.
  Enquiry keeps its extra `enquiry_form.header_logo_url` fallback layer.

## Item 6 — Additional gold-reward T&Cs

Current: `system_settings.enquiry_form.tnc_body` holds PDPA consent text only; admin-editable;
rendered with mandatory checkbox on `Enquiry.tsx:582-601`.

- Migration appends the 6 bilingual gold-reward clauses to BOTH the column default and the stored
  value (idempotent: only append when a marker string, e.g. "Gold Reward Terms", is absent):
  1. Renewal of car insurance required for offer
  2. Gold reward = 10% of Gross Premium
  3. Gold-only redemption, strictly not transferable for cash
  4. Redeemable only at appointed Gold Partners
  5. Must redeem within 3 months of issuance
  6. Worked example (RM10,000 premium → RM1,000 gold reward)
- Chinese + English exactly as provided in feedback. Remains admin-editable via Settings.

## Rollout

1. Migrations committed to repo + applied to staging via MCP `apply_migration`.
2. Frontend changes on `feat/merchant-partnership`; typecheck + build (no test runner/eslint).
3. Staging asset/setting updates (A-Z logo, verify tnc_body).
4. Prod: apply migrations + logo + settings only on explicit go.

## Out of scope

- Agent-uploaded merchant logos.
- True 3-level unit permissions (Unit Admin seeing only own sub-tree).
- Editing/re-uploading agreements after proposal (admin can be asked later).
