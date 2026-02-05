import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatCard,
  StatCardGrid,
} from '@agent-system/shared-ui';
import { Calendar, Users, UserCheck, DollarSign, ArrowRight } from 'lucide-react';
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">Welcome to the Agent Management System</p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Active Campaigns"
          value={activeCampaigns}
          subtitle="Currently running"
          icon={Calendar}
          iconColor="text-sky-600"
          iconBgColor="bg-sky-100"
          loading={isLoading}
        />
        <StatCard
          title="Total Agents"
          value={agentCount ?? 0}
          subtitle="Registered agents"
          icon={Users}
          iconColor="text-emerald-600"
          iconBgColor="bg-emerald-100"
          loading={isLoading}
        />
        <StatCard
          title="Attendance Today"
          value={todayAttendance ?? 0}
          subtitle="Check-ins"
          icon={UserCheck}
          iconColor="text-violet-600"
          iconBgColor="bg-violet-100"
          loading={isLoading}
        />
        <StatCard
          title="Pending Rewards"
          value={pendingRewardsCount ?? 0}
          subtitle="To be processed"
          icon={DollarSign}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={isLoading}
        />
      </StatCardGrid>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <CardDescription>Latest check-ins and registrations</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-slate-500 text-sm">No recent activity</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to="/campaigns/new"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-100 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">Create New Campaign</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
            </Link>
            <Link
              to="/agents/new"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-100 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">Add New Agent</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
            </Link>
            <Link
              to="/pin-codes"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-100 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">Generate PIN Codes</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
