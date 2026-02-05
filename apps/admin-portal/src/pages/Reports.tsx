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
} from 'recharts';
import { Download, TrendingUp, Users, Calendar, DollarSign } from 'lucide-react';
import { useCampaigns } from '../hooks/useCampaigns';
import { supabase } from '../lib/supabase';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

export function Reports() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('month');
  const { data: campaigns } = useCampaigns();

  // Fetch real stats
  const { data: reportStats } = useQuery({
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reports & Analytics</h1>
          <p className="text-muted-foreground">Campaign performance and agent metrics</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-48">
          <Label>Campaign</Label>
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger>
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
        <div className="w-48">
          <Label>Date Range</Label>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger>
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
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invitations</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reportStats?.totalInvitations || 0}</div>
            <p className="text-xs text-muted-foreground">
              {reportStats?.activeCampaigns || 0} active campaigns
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Registration Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reportStats?.conversionRate || 0}%</div>
            <p className="text-xs text-muted-foreground">
              {reportStats?.registeredInvitations || 0} registered
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Full Attendance</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reportStats?.fullAttendance || 0}</div>
            <p className="text-xs text-muted-foreground">
              {reportStats?.attendanceRate || 0}% completion rate
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rewards Pending</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${reportStats?.pendingRewardsAmount || 0}</div>
            <p className="text-xs text-muted-foreground">{reportStats?.totalAgents || 0} agents</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Invitation Funnel</CardTitle>
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
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="sent" fill="#8884d8" name="Sent" />
                <Bar dataKey="registered" fill="#82ca9d" name="Registered" />
                <Bar dataKey="attended" fill="#ffc658" name="Attended" />
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
                  label={({ name, percent }) => attendanceData.length > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : ''}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {(attendanceData.length > 0 ? attendanceData : [{ name: 'No Data', value: 1 }]).map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Top Performing Agents</CardTitle>
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
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Invitations</TableHead>
                  <TableHead className="text-right">Attendance</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(topAgents || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No agent data available
                    </TableCell>
                  </TableRow>
                ) : (
                  topAgents?.map((agent) => (
                    <TableRow key={agent.name}>
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell className="text-right">{agent.invitations}</TableCell>
                      <TableCell className="text-right">{agent.attendance}</TableCell>
                      <TableCell className="text-right text-green-600">{agent.rate}</TableCell>
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
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Total Campaigns</TableCell>
                  <TableCell className="text-right">{reportStats?.totalCampaigns || 0}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Active Campaigns</TableCell>
                  <TableCell className="text-right">{reportStats?.activeCampaigns || 0}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Total Agents</TableCell>
                  <TableCell className="text-right">{reportStats?.totalAgents || 0}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Total Rewards</TableCell>
                  <TableCell className="text-right">${reportStats?.totalRewardsAmount || 0}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
