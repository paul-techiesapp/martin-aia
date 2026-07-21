import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { VehicleStatus, type RegistrationStatus } from '@agent-system/shared-types';
import { useEnquiries } from './useEnquiries';
import { useSystemSettings } from './useSystemSettings';

/** Resolve the slot ids that belong to a campaign (for server-side filtering). */
async function slotIdsForCampaign(campaignId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('slots')
    .select('id')
    .eq('campaign_id', campaignId);
  if (error) throw error;
  return (data ?? []).map((s) => s.id as string);
}

/**
 * Resolve the inclusive lower bound (ISO) for a Date Range selection, or null
 * for "all time". Computed in local time (the app targets Asia/Singapore) and
 * converted to UTC for comparison against `created_at` (a TIMESTAMPTZ).
 */
function dateRangeStart(range: string): string | null {
  const now = new Date();
  let start: Date;
  switch (range) {
    case 'week': {
      const day = now.getDay(); // 0 = Sunday … 6 = Saturday
      const backToMonday = day === 0 ? -6 : 1 - day;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + backToMonday);
      break;
    }
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'quarter':
      start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      break;
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      return null; // unknown range → no lower bound
  }
  return start.toISOString();
}

export interface AttendeeRow {
  id: string;
  name: string | null;
  nric: string | null;
  phone: string | null;
  status: RegistrationStatus;
  agentName: string | null;
  unitName: string | null;
  registeredAt: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
}

interface RawRegistration {
  id: string;
  invitee_name: string | null;
  invitee_nric: string | null;
  invitee_phone: string | null;
  status: RegistrationStatus;
  created_at: string;
  registered_at: string | null;
  agent_id: string;
  agent: { name: string; unit_name: string; parent_agent_id: string | null } | null;
  attendance: {
    checkin_time: string | null;
    checkout_time: string | null;
    is_full_attendance: boolean;
    reward: { amount: number; status: string } | null;
  } | null;
  slot: { start_at: string; campaign: { id: string; name: string } | null } | null;
}

/**
 * Fetch registrations with their attendance, reward, slot, and agent embedded.
 * Optionally scope to a campaign (via its slots) and to registrations created on
 * or after `fromISO` — the shared backbone for every report below.
 */
async function fetchRegistrations(
  campaignId: string,
  fromISO?: string | null,
): Promise<RawRegistration[]> {
  let query = supabase
    .from('registrations')
    .select(`
      id, invitee_name, invitee_nric, invitee_phone, status, created_at, registered_at, agent_id,
      agent:agents(name, unit_name, parent_agent_id),
      attendance:attendance(checkin_time, checkout_time, is_full_attendance, reward:rewards(amount, status)),
      slot:slots(start_at, campaign:campaigns(id, name))
    `)
    .order('created_at', { ascending: false });

  if (campaignId !== 'all') {
    const slotIds = await slotIdsForCampaign(campaignId);
    if (slotIds.length === 0) return [];
    query = query.in('slot_id', slotIds);
  }

  if (fromISO) {
    query = query.gte('created_at', fromISO);
  }

  const { data, error } = await query;
  if (error) throw error;
  // attendance is embedded across a reverse FK (attendance.registration_id), so
  // PostgREST may return it as a one-element array OR a single object depending
  // on its one-to-one detection. Normalize to a single object | null — and do the
  // same for the reward embedded one level deeper under attendance.
  return (data ?? []).map((r: any) => {
    const attendance = Array.isArray(r.attendance) ? r.attendance[0] ?? null : r.attendance ?? null;
    const reward = attendance
      ? Array.isArray(attendance.reward)
        ? attendance.reward[0] ?? null
        : attendance.reward ?? null
      : null;
    return {
      ...r,
      attendance: attendance ? { ...attendance, reward } : null,
      slot: Array.isArray(r.slot) ? r.slot[0] ?? null : r.slot ?? null,
      agent: Array.isArray(r.agent) ? r.agent[0] ?? null : r.agent ?? null,
    };
  }) as RawRegistration[];
}

/** Per-attendee report for an event (Request #2). */
export function useEventAttendees(campaignId: string) {
  return useQuery({
    queryKey: ['event-attendees', campaignId],
    queryFn: async (): Promise<AttendeeRow[]> => {
      const rows = await fetchRegistrations(campaignId);
      return rows.map((r) => ({
        id: r.id,
        name: r.invitee_name,
        nric: r.invitee_nric,
        phone: r.invitee_phone,
        status: r.status,
        agentName: r.agent?.name ?? null,
        unitName: r.agent?.unit_name ?? null,
        registeredAt: r.registered_at ?? r.created_at,
        checkinTime: r.attendance?.checkin_time ?? null,
        checkoutTime: r.attendance?.checkout_time ?? null,
      }));
    },
  });
}

export interface TeamAttendee {
  registrationId: string;
  name: string | null;
  phone: string | null;
  unitName: string | null;
  agentName: string | null;
  registeredAt: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  attended: boolean;
}

export interface TeamPerformance {
  teamId: string;
  teamName: string;
  totalRegistrations: number;
  totalAttendees: number;
  attendees: TeamAttendee[];
}

/**
 * Attendance grouped by team (Request #3). A "team" is a Unit Admin (an agent
 * with no parent) plus their sub-agents; the team root is `parent_agent_id ?? id`.
 * "Attended" means the registrant has an attendance row (they checked in).
 */
export function useTeamPerformance(campaignId: string) {
  return useQuery({
    queryKey: ['team-performance', campaignId],
    queryFn: async (): Promise<TeamPerformance[]> => {
      // Team map: every agent → its team root + the root's unit name.
      const { data: agents, error: agentsError } = await supabase
        .from('agents')
        .select('id, name, unit_name, parent_agent_id');
      if (agentsError) throw agentsError;

      const agentById = new Map<string, { name: string; unit_name: string; parent_agent_id: string | null }>();
      for (const a of agents ?? []) {
        agentById.set(a.id as string, {
          name: a.name as string,
          unit_name: a.unit_name as string,
          parent_agent_id: (a.parent_agent_id as string | null) ?? null,
        });
      }

      const rootOf = (agentId: string): string => {
        const a = agentById.get(agentId);
        return a?.parent_agent_id ?? agentId;
      };

      const rows = await fetchRegistrations(campaignId);

      const teams = new Map<string, TeamPerformance>();
      for (const r of rows) {
        const teamId = rootOf(r.agent_id);
        const root = agentById.get(teamId);
        const teamName = root?.unit_name || r.agent?.unit_name || 'Unassigned';
        let team = teams.get(teamId);
        if (!team) {
          team = { teamId, teamName, totalRegistrations: 0, totalAttendees: 0, attendees: [] };
          teams.set(teamId, team);
        }
        const attended = !!r.attendance?.checkin_time;
        team.totalRegistrations += 1;
        if (attended) team.totalAttendees += 1;
        team.attendees.push({
          registrationId: r.id,
          name: r.invitee_name,
          phone: r.invitee_phone,
          unitName: r.agent?.unit_name ?? teamName,
          agentName: r.agent?.name ?? null,
          registeredAt: r.registered_at ?? r.created_at,
          checkinTime: r.attendance?.checkin_time ?? null,
          checkoutTime: r.attendance?.checkout_time ?? null,
          attended,
        });
      }

      return Array.from(teams.values()).sort(
        (a, b) => b.totalRegistrations - a.totalRegistrations
      );
    },
  });
}

const REGISTERED_STATUSES = ['registered', 'attended', 'completed'];
const ATTENDED_STATUSES = ['attended', 'completed'];

export interface ReportStats {
  totalCampaigns: number;
  activeCampaigns: number;
  totalAgents: number;
  totalInvitations: number;
  registeredInvitations: number;
  conversionRate: number;
  totalAttendance: number;
  fullAttendance: number;
  attendanceRate: number;
  totalRewardsAmount: number;
  pendingRewardsAmount: number;
}

/**
 * Overview summary cards/tables, scoped to the selected Event and Date Range.
 * Campaign counts reflect the event selection; everything invitation/attendance/
 * reward-related is derived from the in-scope registrations so all numbers agree.
 */
export function useReportStats(campaignId: string, dateRange: string) {
  return useQuery({
    queryKey: ['report-stats', campaignId, dateRange],
    queryFn: async (): Promise<ReportStats> => {
      const fromISO = dateRangeStart(dateRange);

      // Campaign + agent counts (campaign counts narrow to the selected event).
      let campaignCountQ = supabase.from('campaigns').select('*', { count: 'exact', head: true });
      let activeCampaignQ = supabase
        .from('campaigns')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      if (campaignId !== 'all') {
        campaignCountQ = campaignCountQ.eq('id', campaignId);
        activeCampaignQ = activeCampaignQ.eq('id', campaignId);
      }

      const [campaignsRes, activeRes, agentsRes, rows] = await Promise.all([
        campaignCountQ,
        activeCampaignQ,
        supabase.from('agents').select('*', { count: 'exact', head: true }),
        fetchRegistrations(campaignId, fromISO),
      ]);

      const totalInvitations = rows.length;
      const registeredInvitations = rows.filter((r) => REGISTERED_STATUSES.includes(r.status)).length;
      const totalAttendance = rows.filter((r) => !!r.attendance?.checkin_time).length;
      const fullAttendance = rows.filter((r) => !!r.attendance?.is_full_attendance).length;

      let totalRewardsAmount = 0;
      let pendingRewardsAmount = 0;
      for (const r of rows) {
        const reward = r.attendance?.reward;
        if (!reward) continue;
        const amt = Number(reward.amount) || 0;
        totalRewardsAmount += amt;
        if (reward.status === 'pending') pendingRewardsAmount += amt;
      }

      return {
        totalCampaigns: campaignsRes.count ?? 0,
        activeCampaigns: activeRes.count ?? 0,
        totalAgents: agentsRes.count ?? 0,
        totalInvitations,
        registeredInvitations,
        conversionRate: totalInvitations
          ? Math.round((registeredInvitations / totalInvitations) * 100)
          : 0,
        totalAttendance,
        fullAttendance,
        attendanceRate: totalAttendance ? Math.round((fullAttendance / totalAttendance) * 100) : 0,
        totalRewardsAmount,
        pendingRewardsAmount,
      };
    },
  });
}

export interface FunnelPoint {
  name: string;
  sent: number;
  registered: number;
  attended: number;
}

/**
 * Invitation funnel for the trailing 4 months, scoped to the selected Event.
 * (The chart is a fixed rolling-month trend, so the Date Range selector — which
 * governs the aggregate cards — intentionally does not reshape its buckets.)
 */
export function useFunnelData(campaignId: string) {
  return useQuery({
    queryKey: ['funnel', campaignId],
    queryFn: async (): Promise<FunnelPoint[]> => {
      const slotIds = campaignId !== 'all' ? await slotIdsForCampaign(campaignId) : null;
      const now = new Date();
      const points: FunnelPoint[] = [];

      for (let i = 3; i >= 0; i--) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const label = monthStart.toLocaleString('en-SG', { month: 'short' });

        if (slotIds && slotIds.length === 0) {
          points.push({ name: label, sent: 0, registered: 0, attended: 0 });
          continue;
        }

        const base = () => {
          let q = supabase
            .from('registrations')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', monthStart.toISOString())
            .lt('created_at', nextMonthStart.toISOString());
          if (slotIds) q = q.in('slot_id', slotIds);
          return q;
        };

        const [sentRes, registeredRes, attendedRes] = await Promise.all([
          base(),
          base().in('status', REGISTERED_STATUSES),
          base().in('status', ATTENDED_STATUSES),
        ]);

        points.push({
          name: label,
          sent: sentRes.count ?? 0,
          registered: registeredRes.count ?? 0,
          attended: attendedRes.count ?? 0,
        });
      }

      return points;
    },
  });
}

export interface TopUnit {
  name: string;
  invitations: number;
  attendance: number;
  rate: string;
}

/** Top units by invitations, scoped to the selected Event and Date Range. */
export function useTopUnits(campaignId: string, dateRange: string) {
  return useQuery({
    queryKey: ['top-units', campaignId, dateRange],
    queryFn: async (): Promise<TopUnit[]> => {
      const rows = await fetchRegistrations(campaignId, dateRangeStart(dateRange));
      const byAgent = new Map<string, { name: string; invitations: number; attendance: number }>();
      for (const r of rows) {
        let entry = byAgent.get(r.agent_id);
        if (!entry) {
          entry = { name: r.agent?.name ?? 'Unknown', invitations: 0, attendance: 0 };
          byAgent.set(r.agent_id, entry);
        }
        entry.invitations += 1;
        if (ATTENDED_STATUSES.includes(r.status)) entry.attendance += 1;
      }

      return Array.from(byAgent.values())
        .map((e) => ({
          name: e.name,
          invitations: e.invitations,
          attendance: e.attendance,
          rate: `${e.invitations ? Math.round((e.attendance / e.invitations) * 100) : 0}%`,
        }))
        .sort((a, b) => b.invitations - a.invitations)
        .slice(0, 5);
    },
  });
}

export interface PartnerPerformance {
  merchantId: string;
  merchantName: string;
  totalVehicles: number;
  submitted: number;
  quoted: number;
  renewed: number;
  lost: number;
  renewalPremiumTotal: number;
  giftTotal: number;
}

/**
 * Partner (merchant) performance summary, derived from the existing admin
 * enquiries list — no new query. Groups every live (non-removed) car by its
 * per-car merchant, counting by status and summing renewal premiums; cars
 * with no merchant assigned yet are bucketed under "No partner". `fromISO`/
 * `toISO` are plain YYYY-MM-DD day strings (matching the Attendees tab's date
 * inputs) compared against the parent enquiry's `created_at` on its Asia/
 * Singapore calendar day.
 */
export function usePartnerPerformance(fromISO?: string, toISO?: string): PartnerPerformance[] {
  const { data: enquiries } = useEnquiries();
  const { data: settings } = useSystemSettings();
  const giftRatePct = settings?.customer_gift_rate_pct ?? 10;

  return useMemo(() => {
    const inRange = (createdAt: string) => {
      const d = new Date(createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
      return (!fromISO || d >= fromISO) && (!toISO || d <= toISO);
    };

    const byMerchant = new Map<string, PartnerPerformance>();
    for (const e of enquiries ?? []) {
      if (!inRange(e.created_at)) continue;
      for (const v of e.vehicles ?? []) {
        if (v.removed_at) continue;
        const merchantId = v.merchant?.id ?? 'unassigned';
        let entry = byMerchant.get(merchantId);
        if (!entry) {
          entry = {
            merchantId,
            merchantName: v.merchant?.name ?? 'No partner',
            totalVehicles: 0,
            submitted: 0,
            quoted: 0,
            renewed: 0,
            lost: 0,
            renewalPremiumTotal: 0,
            giftTotal: 0,
          };
          byMerchant.set(merchantId, entry);
        }
        entry.totalVehicles += 1;
        switch (v.status) {
          case VehicleStatus.SUBMITTED:
            entry.submitted += 1;
            break;
          case VehicleStatus.QUOTED:
            entry.quoted += 1;
            break;
          case VehicleStatus.RENEWED:
            entry.renewed += 1;
            entry.renewalPremiumTotal += v.renewal_premium_amount ?? 0;
            break;
          case VehicleStatus.LOST:
            entry.lost += 1;
            break;
        }
      }
    }

    for (const entry of byMerchant.values()) {
      entry.giftTotal = Math.round(entry.renewalPremiumTotal * giftRatePct) / 100;
    }

    return Array.from(byMerchant.values()).sort((a, b) => b.totalVehicles - a.totalVehicles);
  }, [enquiries, fromISO, toISO, giftRatePct]);
}
