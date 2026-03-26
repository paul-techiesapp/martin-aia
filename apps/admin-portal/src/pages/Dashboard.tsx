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
import { CalendarDays, Users, UserCheck, ClipboardList, Banknote, ChevronRight } from 'lucide-react';
import { useCampaigns } from '../hooks/useCampaigns';
import { useRegistrationStats } from '../hooks/useRegistrations';
import { CampaignStatus } from '@agent-system/shared-types';
import { supabase } from '../lib/supabase';

export function Dashboard() {
  const { data: campaigns, isLoading: campaignsLoading } = useCampaigns();

  const { data: registrationStats, isLoading: registrationStatsLoading } = useRegistrationStats();

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

  const isLoading = campaignsLoading || agentsLoading || attendanceLoading || rewardsLoading || registrationStatsLoading;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your recruitment operations</p>
      </div>

      <StatCardGrid columns={5}>
        <StatCard
          title="Active Events"
          value={activeCampaigns}
          subtitle="Currently running"
          icon={CalendarDays}
          iconColor="text-sky-600"
          iconBgColor="bg-sky-100"
          loading={isLoading}
        />
        <StatCard
          title="Total Units"
          value={agentCount ?? 0}
          subtitle="Registered units"
          icon={Users}
          iconColor="text-emerald-600"
          iconBgColor="bg-emerald-100"
          loading={isLoading}
        />
        <StatCard
          title="Registrations"
          value={registrationStats?.totalRegistrations ?? 0}
          subtitle={`${registrationStats?.completed ?? 0} completed`}
          icon={ClipboardList}
          iconColor="text-indigo-600"
          iconBgColor="bg-indigo-100"
          loading={isLoading}
        />
        <StatCard
          title="Today's Attendance"
          value={todayAttendance ?? 0}
          subtitle="Checked in today"
          icon={UserCheck}
          iconColor="text-violet-600"
          iconBgColor="bg-violet-100"
          loading={isLoading}
        />
        <StatCard
          title="Pending Rewards"
          value={pendingRewardsCount ?? 0}
          subtitle="Awaiting processing"
          icon={Banknote}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={isLoading}
        />
      </StatCardGrid>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest check-ins and registrations</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No recent activity to display.</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Frequently used tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to="/campaigns/new"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-indigo-50 transition-all duration-200 group cursor-pointer"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-indigo-700">Create New Event</span>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/agents/new"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-indigo-50 transition-all duration-200 group cursor-pointer"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-indigo-700">Add New Unit</span>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/reports"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-indigo-50 transition-all duration-200 group cursor-pointer"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-indigo-700">View Reports</span>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
