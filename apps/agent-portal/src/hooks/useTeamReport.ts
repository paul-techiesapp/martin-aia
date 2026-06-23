import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

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

/**
 * Team report for a Unit Admin (Request #4), grouped by agent. RLS already
 * scopes the registrations table to the unit admin's own + their sub-agents'
 * rows, so this query needs no explicit agent filter. The roster (self +
 * sub-agents) is passed in so agents with zero registrations still appear.
 * "Attended" means the registrant has an attendance row (they checked in).
 */
export function useUnitTeamReport(roster: { id: string; name: string }[], enabled: boolean) {
  const rosterKey = roster
    .map((r) => r.id)
    .sort()
    .join(',');

  return useQuery({
    queryKey: ['unit-team-report', rosterKey],
    queryFn: async (): Promise<UnitAgentPerformance[]> => {
      const { data, error } = await supabase
        .from('registrations')
        .select(`
          id, invitee_name, invitee_phone, status, created_at, registered_at, agent_id,
          attendance:attendance(checkin_time, checkout_time)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;

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

      for (const r of (data ?? []) as any[]) {
        let group = byAgent.get(r.agent_id);
        if (!group) {
          group = {
            agentId: r.agent_id,
            agentName: 'Unknown agent',
            totalRegistered: 0,
            totalAttended: 0,
            attendees: [],
          };
          byAgent.set(r.agent_id, group);
        }
        // attendance is embedded across a reverse FK, so it may arrive as a
        // one-element array or a single object — normalize either way.
        const att = Array.isArray(r.attendance) ? r.attendance[0] ?? null : r.attendance ?? null;
        const attended = !!att?.checkin_time;
        group.totalRegistered += 1;
        if (attended) group.totalAttended += 1;
        group.attendees.push({
          registrationId: r.id,
          name: r.invitee_name,
          phone: r.invitee_phone,
          registeredAt: r.registered_at ?? r.created_at,
          checkinTime: att?.checkin_time ?? null,
          checkoutTime: att?.checkout_time ?? null,
          attended,
        });
      }

      return Array.from(byAgent.values()).sort((a, b) => b.totalRegistered - a.totalRegistered);
    },
    enabled,
  });
}
