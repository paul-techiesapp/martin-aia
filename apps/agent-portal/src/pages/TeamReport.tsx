import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  StatCard,
  StatCardGrid,
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agent-system/shared-ui';
import { Users, UserCheck, ClipboardList } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useUnitRoster } from '../hooks/useSubAgents';
import { useUnitTeamReport } from '../hooks/useTeamReport';
import { useUnitEnquirySummary } from '../hooks/useEnquirySummary';

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-SG', { dateStyle: 'medium' });
}

function fmtTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

export function TeamReport() {
  const { agent, role, isUnitViewer } = useAuth();
  // Unit root: own id for a Unit Admin, parent id for a Unit Manager. The roster
  // is every agent in that unit, so agents with zero registrations still appear
  // (and rows always resolve to a real agent name rather than "Unknown agent").
  const unitRoot = agent?.parent_agent_id ?? agent?.id;
  const { data: unitAgents } = useUnitRoster(unitRoot);

  const roster = useMemo(
    () => (unitAgents ?? []).map((a) => ({ id: a.id, name: a.name })),
    [unitAgents],
  );

  const [campaignId, setCampaignId] = useState('all');

  // Unit admins and unit managers both get the unit-wide view.
  const enabled = isUnitViewer && !!agent?.id;
  const { performance, campaignOptions, isLoading } = useUnitTeamReport(roster, enabled, campaignId);
  const { data: enquirySummary, isLoading: enquiryLoading } = useUnitEnquirySummary(unitRoot, enabled);

  const totals = useMemo(() => {
    const rows = performance ?? [];
    return {
      agents: rows.length,
      registered: rows.reduce((s, r) => s + r.totalRegistered, 0),
      attended: rows.reduce((s, r) => s + r.totalAttended, 0),
    };
  }, [performance]);

  // Only unit viewers (admins + unit managers) may see this; guard in render.
  if (role && !isUnitViewer) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>This page is only available to unit managers and unit admins.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Team Report</h1>
          <p className="text-sm text-muted-foreground">
            Registration and attendance performance for every agent in your unit.
          </p>
        </div>
        <Select value={campaignId} onValueChange={setCampaignId}>
          <SelectTrigger className="w-48 h-9 text-sm">
            <SelectValue placeholder="All events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {campaignOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Agents"
          value={totals.agents}
          icon={Users}
          iconColor="sky"
          description="In your unit"
          loading={isLoading}
        />
        <StatCard
          title="Total Registered"
          value={totals.registered}
          icon={ClipboardList}
          iconColor="violet"
          description="Across all agents"
          loading={isLoading}
        />
        <StatCard
          title="Total Attended"
          value={totals.attended}
          icon={UserCheck}
          iconColor="emerald"
          description="Checked in to an event"
          loading={isLoading}
        />
      </StatCardGrid>

      {/* Per-agent summary */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Performance</CardTitle>
          <CardDescription>Registrations and attendance per agent</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={4} columns={3} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Agent Name</TableHead>
                    <TableHead className="text-right">Total Registered</TableHead>
                    <TableHead className="text-right">Total Attended</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(performance ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No agents in your unit yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    performance!.map((p) => (
                      <TableRow key={p.agentId}>
                        <TableCell className="font-medium">
                          {p.agentName}
                          {p.agentId === agent?.id && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              You
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{p.totalRegistered}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">{p.totalAttended}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-agent attendee detail */}
      {!isLoading &&
        (performance ?? [])
          .filter((p) => p.attendees.length > 0)
          .map((p) => (
            <Card key={p.agentId}>
              <CardHeader>
                <CardTitle className="text-base">
                  {p.agentName}
                  {p.agentId === agent?.id && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      You
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {p.totalRegistered} registration{p.totalRegistered === 1 ? '' : 's'} · {p.totalAttended} attended
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Attendee Name</TableHead>
                        <TableHead>Contact Number</TableHead>
                        <TableHead>Registration Date</TableHead>
                        <TableHead>Check-in Status</TableHead>
                        <TableHead>Check-out Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.attendees.map((at) => (
                        <TableRow key={at.registrationId}>
                          <TableCell className="font-medium">{at.name ?? '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{at.phone ?? '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{fmtDate(at.registeredAt)}</TableCell>
                          <TableCell>
                            {at.checkinTime ? (
                              <Badge variant="success" title={fmtTime(at.checkinTime)}>
                                Checked in
                              </Badge>
                            ) : (
                              <Badge variant="neutral">Not checked in</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {at.checkoutTime ? (
                              <Badge variant="success" title={fmtTime(at.checkoutTime)}>
                                Checked out
                              </Badge>
                            ) : (
                              <Badge variant="neutral">—</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}

      <Card>
        <CardHeader>
          <CardTitle>Car Enquiries by Agent</CardTitle>
          <CardDescription>
            Enquiry forms customers submitted through each agent's link ·{' '}
            {(enquirySummary ?? []).reduce((n, r) => n + r.forms_submitted, 0)} total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {enquiryLoading ? (
            <TableSkeleton rows={4} columns={6} />
          ) : (enquirySummary ?? []).length === 0 ? (
            <p className="text-muted-foreground text-center py-6">No enquiries yet for this unit.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Forms</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Cars</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Renewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(enquirySummary ?? []).map((r) => (
                    <TableRow key={r.agent_id}>
                      <TableCell className="font-medium">
                        {r.agent_name}
                        <div className="text-xs text-muted-foreground">{r.agent_code}</div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{r.forms_submitted}</TableCell>
                      <TableCell className="text-right">{r.customers}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{r.cars}</TableCell>
                      <TableCell className="text-right text-amber-600">{r.cars_open}</TableCell>
                      <TableCell className="text-right text-emerald-600">{r.cars_renewed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
