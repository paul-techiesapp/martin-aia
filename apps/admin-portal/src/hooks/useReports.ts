import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { RegistrationStatus } from '@agent-system/shared-types';

/** Resolve the slot ids that belong to a campaign (for server-side filtering). */
async function slotIdsForCampaign(campaignId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('slots')
    .select('id')
    .eq('campaign_id', campaignId);
  if (error) throw error;
  return (data ?? []).map((s) => s.id as string);
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
  attendance: { checkin_time: string | null; checkout_time: string | null } | null;
  slot: { start_at: string; campaign: { id: string; name: string } | null } | null;
}

async function fetchRegistrations(campaignId: string): Promise<RawRegistration[]> {
  let query = supabase
    .from('registrations')
    .select(`
      id, invitee_name, invitee_nric, invitee_phone, status, created_at, registered_at, agent_id,
      agent:agents(name, unit_name, parent_agent_id),
      attendance:attendance(checkin_time, checkout_time),
      slot:slots(start_at, campaign:campaigns(id, name))
    `)
    .order('created_at', { ascending: false });

  if (campaignId !== 'all') {
    const slotIds = await slotIdsForCampaign(campaignId);
    if (slotIds.length === 0) return [];
    query = query.in('slot_id', slotIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  // attendance is embedded across a reverse FK (attendance.registration_id), so
  // PostgREST may return it as a one-element array OR a single object depending
  // on its one-to-one detection. Normalize to a single object | null.
  return (data ?? []).map((r: any) => ({
    ...r,
    attendance: Array.isArray(r.attendance) ? r.attendance[0] ?? null : r.attendance ?? null,
    slot: Array.isArray(r.slot) ? r.slot[0] ?? null : r.slot ?? null,
    agent: Array.isArray(r.agent) ? r.agent[0] ?? null : r.agent ?? null,
  })) as RawRegistration[];
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
