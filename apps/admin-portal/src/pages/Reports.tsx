import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  StatCard,
  StatCardGrid,
  Badge,
  getStatusVariant,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  chartColors,
} from '@agent-system/shared-ui';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Download, TrendingUp, Users, CalendarDays, Banknote } from 'lucide-react';
import { useCampaigns } from '../hooks/useCampaigns';
import { useEventAttendees, useTeamPerformance } from '../hooks/useReports';
import { supabase } from '../lib/supabase';

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-SG', { dateStyle: 'medium' });
}

function fmtTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('month');
  const { data: campaigns } = useCampaigns();

  // Fetch real stats
  const { data: reportStats, isLoading: statsLoading } = useQuery({
    queryKey: ['report-stats'],
    queryFn: async () => {
      // Get campaign stats
      const { count: totalCampaigns } = await supabase
        .from('campaigns')
        .select('*', { count: 'exact', head: true });

      const { count: activeCampaigns } = await supabase
        .from('campaigns')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      // Get agent stats
      const { count: totalAgents } = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true });

      // Get invitation stats
      const { count: totalInvitations } = await supabase
        .from('registrations')
        .select('*', { count: 'exact', head: true });

      const { count: registeredInvitations } = await supabase
        .from('registrations')
        .select('*', { count: 'exact', head: true })
        .in('status', ['registered', 'attended', 'completed']);

      // Get attendance stats
      const { count: totalAttendance } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true });

      const { count: fullAttendance } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .eq('is_full_attendance', true);

      // Get rewards stats
      const { data: rewards } = await supabase
        .from('rewards')
        .select('amount, status');

      const totalRewardsAmount = rewards?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
      const pendingRewardsAmount = rewards?.filter(r => r.status === 'pending')
        .reduce((sum, r) => sum + (r.amount || 0), 0) || 0;

      return {
        totalCampaigns: totalCampaigns || 0,
        activeCampaigns: activeCampaigns || 0,
        totalAgents: totalAgents || 0,
        totalInvitations: totalInvitations || 0,
        registeredInvitations: registeredInvitations || 0,
        conversionRate: totalInvitations ? Math.round((registeredInvitations || 0) / totalInvitations * 100) : 0,
        totalAttendance: totalAttendance || 0,
        fullAttendance: fullAttendance || 0,
        attendanceRate: totalAttendance ? Math.round((fullAttendance || 0) / (totalAttendance || 1) * 100) : 0,
        totalRewardsAmount,
        pendingRewardsAmount,
      };
    },
  });

  // Fetch monthly data for chart
  const { data: monthlyData } = useQuery({
    queryKey: ['monthly-invitations'],
    queryFn: async () => {
      const months = [];
      const now = new Date();

      for (let i = 3; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const startOfMonth = date.toISOString().split('T')[0];
        const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];

        const { count: sent } = await supabase
          .from('registrations')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth);

        const { count: registered } = await supabase
          .from('registrations')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth)
          .in('status', ['registered', 'attended', 'completed']);

        const { count: attended } = await supabase
          .from('registrations')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth)
          .in('status', ['attended', 'completed']);

        months.push({
          name: `Week ${4 - i}`,
          sent: sent || 0,
          registered: registered || 0,
          attended: attended || 0,
        });
      }

      return months;
    },
  });

  // Fetch top agents
  const { data: topAgents } = useQuery({
    queryKey: ['top-agents'],
    queryFn: async () => {
      const { data: agents } = await supabase
        .from('agents')
        .select('id, name')
        .limit(5);

      if (!agents) return [];

      const agentStats = await Promise.all(agents.map(async (agent) => {
        const { count: invitations } = await supabase
          .from('registrations')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agent.id);

        const { count: attendance } = await supabase
          .from('registrations')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agent.id)
          .in('status', ['attended', 'completed']);

        const rate = invitations ? Math.round((attendance || 0) / invitations * 100) : 0;

        return {
          name: agent.name,
          invitations: invitations || 0,
          attendance: attendance || 0,
          rate: `${rate}%`,
        };
      }));

      return agentStats.sort((a, b) => b.invitations - a.invitations);
    },
  });

  // Per-attendee report (#2) and team performance (#3), scoped to the selected event
  const { data: attendees, isLoading: attendeesLoading } = useEventAttendees(selectedCampaignId);
  const { data: teams, isLoading: teamsLoading } = useTeamPerformance(selectedCampaignId);

  // Attendance breakdown for pie chart
  const attendanceData = [
    { name: 'Full Attendance', value: reportStats?.fullAttendance || 0 },
    { name: 'Partial', value: (reportStats?.totalAttendance || 0) - (reportStats?.fullAttendance || 0) },
    { name: 'No Show', value: Math.max(0, (reportStats?.registeredInvitations || 0) - (reportStats?.totalAttendance || 0)) },
  ].filter(item => item.value > 0);

  const handleExport = (type: string) => {
    if (!reportStats) return;

    const csvContent = [
      ['Metric', 'Value'],
      ['Total Events', reportStats.totalCampaigns],
      ['Active Events', reportStats.activeCampaigns],
      ['Total Units', reportStats.totalAgents],
      ['Total Invitations', reportStats.totalInvitations],
      ['Registered Invitations', reportStats.registeredInvitations],
      ['Conversion Rate', `${reportStats.conversionRate}%`],
      ['Total Attendance', reportStats.totalAttendance],
      ['Full Attendance', reportStats.fullAttendance],
      ['Attendance Rate', `${reportStats.attendanceRate}%`],
      ['Total Rewards', `RM${reportStats.totalRewardsAmount}`],
      ['Pending Rewards', `RM${reportStats.pendingRewardsAmount}`],
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reports & Analytics</h1>
          <p className="text-sm text-muted-foreground">Track event performance and agent metrics</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="w-full sm:w-48">
          <Label className="text-sm font-medium">Event</Label>
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              {campaigns?.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Label className="text-sm font-medium">Date Range</Label>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="quarter">This Quarter</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendees">Attendees</TabsTrigger>
          <TabsTrigger value="teams">Team Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-3 mt-4">
      {/* Summary Cards */}
      <StatCardGrid columns={4}>
        <StatCard
          title="Total Invitations"
          value={reportStats?.totalInvitations || 0}
          subtitle={`${reportStats?.activeCampaigns || 0} active events`}
          icon={CalendarDays}
          iconColor="text-sky-600"
          iconBgColor="bg-sky-100"
          loading={statsLoading}
        />
        <StatCard
          title="Registration Rate"
          value={`${reportStats?.conversionRate || 0}%`}
          subtitle={`${reportStats?.registeredInvitations || 0} registered`}
          icon={TrendingUp}
          iconColor="text-emerald-600"
          iconBgColor="bg-emerald-100"
          loading={statsLoading}
        />
        <StatCard
          title="Full Attendance"
          value={reportStats?.fullAttendance || 0}
          subtitle={`${reportStats?.attendanceRate || 0}% completion rate`}
          icon={Users}
          iconColor="text-violet-600"
          iconBgColor="bg-violet-100"
          loading={statsLoading}
        />
        <StatCard
          title="Rewards Pending"
          value={`RM${reportStats?.pendingRewardsAmount || 0}`}
          subtitle={`${reportStats?.totalAgents || 0} units`}
          icon={Banknote}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={statsLoading}
        />
      </StatCardGrid>

      {/* Charts */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Invitation Funnel</CardTitle>
                <CardDescription>Sent vs. registered vs. attended</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('invitations')}>
                <Download className="size-4 mr-1.5" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  }}
                />
                <Bar dataKey="sent" fill={chartColors[0]} name="Sent" radius={[4, 4, 0, 0]} />
                <Bar dataKey="registered" fill={chartColors[2]} name="Registered" radius={[4, 4, 0, 0]} />
                <Bar dataKey="attended" fill={chartColors[3]} name="Attended" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Attendance Breakdown</CardTitle>
                <CardDescription>Completion status</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={attendanceData.length > 0 ? attendanceData : [{ name: 'No Data', value: 1 }]}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ percent }) => attendanceData.length > 0 ? `${(percent * 100).toFixed(0)}%` : ''}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {(attendanceData.length > 0 ? attendanceData : [{ name: 'No Data', value: 1 }]).map((_, index) => (
                    <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Top Performing Units</CardTitle>
                <CardDescription>Ranked by attendance conversion</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('agents')}>
                <Download className="size-4 mr-1.5" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Invitations</TableHead>
                  <TableHead className="text-right">Attendance</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(topAgents || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No unit data available
                    </TableCell>
                  </TableRow>
                ) : (
                  topAgents?.map((agent) => (
                    <TableRow key={agent.name} >
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{agent.invitations}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{agent.attendance}</TableCell>
                      <TableCell className="text-right font-medium text-emerald-600">{agent.rate}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>System Summary</CardTitle>
                <CardDescription>Key metrics at a glance</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('summary')}>
                <Download className="size-4 mr-1.5" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow >
                  <TableCell className="font-medium">Total Events</TableCell>
                  <TableCell className="text-right text-muted-foreground">{reportStats?.totalCampaigns || 0}</TableCell>
                </TableRow>
                <TableRow >
                  <TableCell className="font-medium">Active Events</TableCell>
                  <TableCell className="text-right text-muted-foreground">{reportStats?.activeCampaigns || 0}</TableCell>
                </TableRow>
                <TableRow >
                  <TableCell className="font-medium">Total Units</TableCell>
                  <TableCell className="text-right text-muted-foreground">{reportStats?.totalAgents || 0}</TableCell>
                </TableRow>
                <TableRow >
                  <TableCell className="font-medium">Total Rewards</TableCell>
                  <TableCell className="text-right text-muted-foreground">RM{reportStats?.totalRewardsAmount || 0}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        {/* Attendees tab (#2): per-attendee report for the selected event */}
        <TabsContent value="attendees" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle>Event Attendee Report</CardTitle>
                <CardDescription>
                  Registrants {selectedCampaignId === 'all' ? 'across all events' : 'for the selected event'} ·{' '}
                  {attendees?.length ?? 0} total
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!attendees?.length}
                onClick={() =>
                  downloadCsv('attendees', [
                    ['Name', 'NRIC', 'Phone', 'Agent', 'Unit', 'Status', 'Registered', 'Check-in', 'Check-out'],
                    ...(attendees ?? []).map((a) => [
                      a.name ?? '',
                      a.nric ?? '',
                      a.phone ?? '',
                      a.agentName ?? '',
                      a.unitName ?? '',
                      a.status,
                      fmtDate(a.registeredAt),
                      fmtTime(a.checkinTime),
                      fmtTime(a.checkoutTime),
                    ]),
                  ])
                }
              >
                <Download className="size-4 mr-1.5" />
                Export
              </Button>
            </CardHeader>
            <CardContent>
              {attendeesLoading ? (
                <p className="text-muted-foreground text-center py-6">Loading attendees…</p>
              ) : (
                <div className="overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Name</TableHead>
                        <TableHead>NRIC</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(attendees ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                            No registrations found for this selection.
                          </TableCell>
                        </TableRow>
                      ) : (
                        attendees!.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="font-medium">{a.name ?? '—'}</TableCell>
                            <TableCell className="text-muted-foreground">{a.nric ?? '—'}</TableCell>
                            <TableCell className="text-muted-foreground">{a.phone ?? '—'}</TableCell>
                            <TableCell className="text-muted-foreground">{a.agentName ?? '—'}</TableCell>
                            <TableCell>
                              <Badge variant={getStatusVariant(a.status)} className="capitalize">
                                {a.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team Performance tab (#3): attendance grouped by team (unit) */}
        <TabsContent value="teams" className="mt-4">
          <div className="flex flex-col gap-3">
            <Card>
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle>Team Performance</CardTitle>
                  <CardDescription>
                    Registrations &amp; attendance grouped by unit · {teams?.length ?? 0} team
                    {(teams?.length ?? 0) === 1 ? '' : 's'}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!teams?.length}
                  onClick={() =>
                    downloadCsv('team-attendees', [
                      ['Team', 'Attendee', 'Contact', 'Unit', 'Agent', 'Registered', 'Check-in', 'Check-out', 'Attended'],
                      ...(teams ?? []).flatMap((t) =>
                        t.attendees.map((at) => [
                          t.teamName,
                          at.name ?? '',
                          at.phone ?? '',
                          at.unitName ?? '',
                          at.agentName ?? '',
                          fmtDate(at.registeredAt),
                          fmtTime(at.checkinTime),
                          fmtTime(at.checkoutTime),
                          at.attended ? 'Yes' : 'No',
                        ])
                      ),
                    ])
                  }
                >
                  <Download className="size-4 mr-1.5" />
                  Export
                </Button>
              </CardHeader>
              <CardContent>
                {teamsLoading ? (
                  <p className="text-muted-foreground text-center py-6">Loading teams…</p>
                ) : (
                  <div className="overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Team Name</TableHead>
                          <TableHead className="text-right">Total Registrations</TableHead>
                          <TableHead className="text-right">Total Attendees</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(teams ?? []).length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                              No team activity found for this selection.
                            </TableCell>
                          </TableRow>
                        ) : (
                          teams!.map((t) => (
                            <TableRow key={t.teamId}>
                              <TableCell className="font-medium">{t.teamName}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{t.totalRegistrations}</TableCell>
                              <TableCell className="text-right font-medium text-emerald-600">{t.totalAttendees}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Per-team attendee detail */}
            {!teamsLoading &&
              (teams ?? []).map((t) => (
                <Card key={t.teamId}>
                  <CardHeader>
                    <CardTitle className="text-base">{t.teamName}</CardTitle>
                    <CardDescription>
                      {t.totalRegistrations} registration{t.totalRegistrations === 1 ? '' : 's'} · {t.totalAttendees}{' '}
                      attended
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead>Attendee Name</TableHead>
                            <TableHead>Contact Number</TableHead>
                            <TableHead>Unit Name</TableHead>
                            <TableHead>Registration Date</TableHead>
                            <TableHead>Check-in Time</TableHead>
                            <TableHead>Check-out Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {t.attendees.map((at) => (
                            <TableRow key={at.registrationId}>
                              <TableCell className="font-medium">{at.name ?? '—'}</TableCell>
                              <TableCell className="text-muted-foreground">{at.phone ?? '—'}</TableCell>
                              <TableCell className="text-muted-foreground">{at.unitName ?? '—'}</TableCell>
                              <TableCell className="text-muted-foreground">{fmtDate(at.registeredAt)}</TableCell>
                              <TableCell className="text-muted-foreground">{fmtTime(at.checkinTime)}</TableCell>
                              <TableCell className="text-muted-foreground">{fmtTime(at.checkoutTime)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
