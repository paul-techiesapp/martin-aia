import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '@agent-system/shared-ui';

export interface UnitAttendee {
  registrationId: string;
  name: string | null;
  phone: string | null;
  registeredAt: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  attended: boolean;
}

export interface UnitAgentPerformance {
  agentId: string;
  agentName: string;
  totalRegistered: number;
  totalAttended: number;
  attendees: UnitAttendee[];
}

export interface TeamReportCampaignOption {
  id: string;
  name: string;
}

export interface UnitTeamReport {
  performance: UnitAgentPerformance[];
  campaignOptions: TeamReportCampaignOption[];
}

// One row per registration, normalized and unfiltered by event. Filtering by
// campaignId and grouping by agent both happen client-side (see below) so
// switching the event dropdown never re-triggers a fetch.
interface NormalizedRegistrationRow {
  registrationId: string;
  agentId: string;
  campaignId: string | null;
  campaignName: string | null;
  name: string | null;
  phone: string | null;
  registeredAt: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  attended: boolean;
}

/**
 * Team report for a Unit Admin (Request #4), grouped by agent. RLS already
 * scopes the registrations table to the unit admin's own + their sub-agents'
 * rows, so this query needs no explicit agent filter. The roster (self +
 * sub-agents) is passed in so agents with zero registrations still appear.
 * "Attended" means the registrant has an attendance row (they checked in).
 *
 * The event filter's dropdown options are derived from the registrations
 * themselves (rather than an active-campaigns lookup) so past/ended events
 * — which matter for a report — remain selectable, and so an agent caller
 * never has to query the campaigns table directly (avoiding RLS surprises).
 *
 * The query itself is unfiltered and its key excludes campaignId (matching
 * the client-side-filter idiom in BranchPerformance.tsx): campaignId is a
 * pure client-side filter over already-fetched rows, applied via useMemo, so
 * switching events is an in-memory recompute with no refetch and no
 * isLoading flip/skeleton flash.
 */
export function useUnitTeamReport(
  roster: { id: string; name: string }[],
  enabled: boolean,
  campaignId: string,
) {
  const rosterKey = roster
    .map((r) => r.id)
    .sort()
    .join(',');

  const query = useQuery({
    queryKey: ['unit-team-report', rosterKey],
    queryFn: async (): Promise<NormalizedRegistrationRow[]> => {
      // Paged: unfiltered (RLS scopes to the unit admin's own + sub-agents'
      // rows), the same unbounded unit-wide shape flagged for
      // useMyEnquiries(unitWide=true) — a large unit will cross PostgREST's
      // 1000-row page cap.
      const allRows = await fetchAllRows<any>(
        (from, to) =>
          supabase
            .from('registrations')
            .select(`
              id, invitee_name, invitee_phone, status, created_at, registered_at, agent_id,
              attendance:attendance(checkin_time, checkout_time),
              slot:slots(campaign_id, campaign:campaigns(name))
            `)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as unknown as PromiseLike<{
            data: any[] | null;
            error: { message: string } | null;
          }>,
        { label: 'agent unit-team-report' },
      );

      // slot/campaign are embedded via forward FKs so they arrive as single
      // objects, but normalize defensively in case Supabase returns an array
      // shape.
      const getSlot = (r: any) => (Array.isArray(r.slot) ? r.slot[0] ?? null : r.slot ?? null);
      const getCampaign = (slot: any) =>
        slot ? (Array.isArray(slot.campaign) ? slot.campaign[0] ?? null : slot.campaign ?? null) : null;

      return allRows.map((r): NormalizedRegistrationRow => {
        const slot = getSlot(r);
        const campaign = getCampaign(slot);
        // attendance is embedded across a reverse FK, so it may arrive as a
        // one-element array or a single object — normalize either way.
        const att = Array.isArray(r.attendance) ? r.attendance[0] ?? null : r.attendance ?? null;
        return {
          registrationId: r.id,
          agentId: r.agent_id,
          campaignId: slot?.campaign_id ?? null,
          campaignName: campaign?.name ?? null,
          name: r.invitee_name,
          phone: r.invitee_phone,
          registeredAt: r.registered_at ?? r.created_at,
          checkinTime: att?.checkin_time ?? null,
          checkoutTime: att?.checkout_time ?? null,
          attended: !!att?.checkin_time,
        };
      });
    },
    enabled,
  });

  // Derive the dropdown options from ALL fetched rows (before the campaignId
  // filter below) so selecting one event doesn't shrink the dropdown down to
  // itself. Orphan rows (no slot/campaign embed) are excluded from the
  // options and will only ever match 'all'.
  const campaignOptions = useMemo<TeamReportCampaignOption[]>(() => {
    const campaignMap = new Map<string, string>();
    for (const r of query.data ?? []) {
      if (r.campaignId && r.campaignName) {
        campaignMap.set(r.campaignId, r.campaignName);
      }
    }
    return Array.from(campaignMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data]);

  const performance = useMemo<UnitAgentPerformance[]>(() => {
    const byAgent = new Map<string, UnitAgentPerformance>();
    for (const a of roster) {
      byAgent.set(a.id, {
        agentId: a.id,
        agentName: a.name,
        totalRegistered: 0,
        totalAttended: 0,
        attendees: [],
      });
    }

    const rows = (query.data ?? []).filter(
      (r) => campaignId === 'all' || r.campaignId === campaignId,
    );

    for (const r of rows) {
      let group = byAgent.get(r.agentId);
      if (!group) {
        group = {
          agentId: r.agentId,
          agentName: 'Unknown agent',
          totalRegistered: 0,
          totalAttended: 0,
          attendees: [],
        };
        byAgent.set(r.agentId, group);
      }
      group.totalRegistered += 1;
      if (r.attended) group.totalAttended += 1;
      group.attendees.push({
        registrationId: r.registrationId,
        name: r.name,
        phone: r.phone,
        registeredAt: r.registeredAt,
        checkinTime: r.checkinTime,
        checkoutTime: r.checkoutTime,
        attended: r.attended,
      });
    }

    return Array.from(byAgent.values()).sort((a, b) => b.totalRegistered - a.totalRegistered);
  }, [query.data, campaignId, roster]);

  return { performance, campaignOptions, isLoading: query.isLoading };
}
