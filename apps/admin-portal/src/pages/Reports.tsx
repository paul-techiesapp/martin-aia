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
import { Download, TrendingUp, Users, Calendar, DollarSign } from 'lucide-react';
import { useCampaigns } from '../hooks/useCampaigns';
import { supabase } from '../lib/supabase';

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
        .from('invitations')
        .select('*', { count: 'exact', head: true });

      const { count: registeredInvitations } = await supabase
        .from('invitations')
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
          .from('invitations')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth);

        const { count: registered } = await supabase
          .from('invitations')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth)
          .in('status', ['registered', 'attended', 'completed']);

        const { count: attended } = await supabase
          .from('invitations')
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
        .select('id, full_name')
        .limit(5);

      if (!agents) return [];

      const agentStats = await Promise.all(agents.map(async (agent) => {
        const { count: invitations } = await supabase
          .from('invitations')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agent.id);

        const { count: attendance } = await supabase
          .from('invitations')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agent.id)
          .in('status', ['attended', 'completed']);

        const rate = invitations ? Math.round((attendance || 0) / invitations * 100) : 0;

        return {
          name: agent.full_name,
          invitations: invitations || 0,
          attendance: attendance || 0,
          rate: `${rate}%`,
        };
      }));

      return agentStats.sort((a, b) => b.invitations - a.invitations);
    },
  });

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
      ['Total Campaigns', reportStats.totalCampaigns],
      ['Active Campaigns', reportStats.activeCampaigns],
      ['Total Agents', reportStats.totalAgents],
      ['Total Invitations', reportStats.totalInvitations],
      ['Registered Invitations', reportStats.registeredInvitations],
      ['Conversion Rate', `${reportStats.conversionRate}%`],
      ['Total Attendance', reportStats.totalAttendance],
      ['Full Attendance', reportStats.fullAttendance],
      ['Attendance Rate', `${reportStats.attendanceRate}%`],
      ['Total Rewards', `$${reportStats.totalRewardsAmount}`],
      ['Pending Rewards', `$${reportStats.pendingRewardsAmount}`],
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
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Reports & Analytics</h1>
          <p className="text-slate-500 mt-1">Campaign performance and agent metrics</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="w-full sm:w-48">
          <Label className="text-slate-600">Campaign</Label>
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns?.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Label className="text-slate-600">Date Range</Label>
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

      {/* Summary Cards */}
      <StatCardGrid columns={4}>
        <StatCard
          title="Total Invitations"
          value={reportStats?.totalInvitations || 0}
          subtitle={`${reportStats?.activeCampaigns || 0} active campaigns`}
          icon={Calendar}
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
          value={`$${reportStats?.pendingRewardsAmount || 0}`}
          subtitle={`${reportStats?.totalAgents || 0} agents`}
          icon={DollarSign}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={statsLoading}
        />
      </StatCardGrid>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Invitation Funnel</CardTitle>
                <CardDescription>Weekly conversion rates</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('invitations')}>
                <Download className="h-4 w-4 mr-2" />
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

        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Attendance Breakdown</CardTitle>
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
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Top Performing Agents</CardTitle>
                <CardDescription>By attendance rate</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('agents')}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Invitations</TableHead>
                  <TableHead className="text-right">Attendance</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(topAgents || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      No agent data available
                    </TableCell>
                  </TableRow>
                ) : (
                  topAgents?.map((agent) => (
                    <TableRow key={agent.name} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell className="text-right text-slate-600">{agent.invitations}</TableCell>
                      <TableCell className="text-right text-slate-600">{agent.attendance}</TableCell>
                      <TableCell className="text-right font-medium text-emerald-600">{agent.rate}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">System Summary</CardTitle>
                <CardDescription>Overall statistics</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('summary')}>
                <Download className="h-4 w-4 mr-2" />
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
                <TableRow className="hover:bg-slate-50/50 transition-colors">
                  <TableCell className="font-medium">Total Campaigns</TableCell>
                  <TableCell className="text-right text-slate-600">{reportStats?.totalCampaigns || 0}</TableCell>
                </TableRow>
                <TableRow className="hover:bg-slate-50/50 transition-colors">
                  <TableCell className="font-medium">Active Campaigns</TableCell>
                  <TableCell className="text-right text-slate-600">{reportStats?.activeCampaigns || 0}</TableCell>
                </TableRow>
                <TableRow className="hover:bg-slate-50/50 transition-colors">
                  <TableCell className="font-medium">Total Agents</TableCell>
                  <TableCell className="text-right text-slate-600">{reportStats?.totalAgents || 0}</TableCell>
                </TableRow>
                <TableRow className="hover:bg-slate-50/50 transition-colors">
                  <TableCell className="font-medium">Total Rewards</TableCell>
                  <TableCell className="text-right text-slate-600">${reportStats?.totalRewardsAmount || 0}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
