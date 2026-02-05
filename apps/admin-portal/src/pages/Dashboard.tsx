import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@agent-system/shared-ui';
import { Calendar, Users, UserCheck, DollarSign } from 'lucide-react';
import { useCampaigns } from '../hooks/useCampaigns';
import { CampaignStatus } from '@agent-system/shared-types';
import { supabase } from '../lib/supabase';

export function Dashboard() {
  const { data: campaigns, isLoading: campaignsLoading } = useCampaigns();

  const activeCampaigns = campaigns?.filter(c => c.status === CampaignStatus.ACTIVE).length ?? 0;

  // Fetch agent count
  const { data: agentCount, isLoading: agentsLoading } = useQuery({
    queryKey: ['agent-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch today's attendance
  const { data: todayAttendance, isLoading: attendanceLoading } = useQuery({
    queryKey: ['today-attendance'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { count, error } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .gte('checkin_time', `${today}T00:00:00`)
        .lte('checkin_time', `${today}T23:59:59`);
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch pending rewards count
  const { data: pendingRewardsCount, isLoading: rewardsLoading } = useQuery({
    queryKey: ['pending-rewards-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('rewards')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw error;
      return count || 0;
    },
  });

  const isLoading = campaignsLoading || agentsLoading || attendanceLoading || rewardsLoading;

  const stats = [
    {
      name: 'Active Campaigns',
      value: activeCampaigns,
      icon: Calendar,
      description: 'Currently running',
    },
    {
      name: 'Total Agents',
      value: agentCount ?? 0,
      icon: Users,
      description: 'Registered agents',
    },
    {
      name: 'Attendance Today',
      value: todayAttendance ?? 0,
      icon: UserCheck,
      description: 'Check-ins',
    },
    {
      name: 'Pending Rewards',
      value: pendingRewardsCount ?? 0,
      icon: DollarSign,
      description: 'To be processed',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to the Agent Management System</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.name}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.name}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{isLoading ? '...' : stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest check-ins and registrations</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">No recent activity</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <a href="/campaigns/new" className="block text-sm text-primary hover:underline">
              Create New Campaign
            </a>
            <a href="/agents/new" className="block text-sm text-primary hover:underline">
              Add New Agent
            </a>
            <a href="/pin-codes" className="block text-sm text-primary hover:underline">
              Generate PIN Codes
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
