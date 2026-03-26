import { Link } from '@tanstack/react-router';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatCard,
  StatCardGrid,
  Skeleton,
} from '@agent-system/shared-ui';
import { CalendarDays, Award, ChevronRight, Users, UserCheck, CheckCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useRegistrationStats, usePartnerRegistrationStats } from '../hooks/useRegistrations';
import { useActiveCampaigns } from '../hooks/useCampaigns';
import { useMyPartners } from '../hooks/usePartners';

function AgentDashboard() {
  const { agent } = useAuth();
  const { data: stats, isLoading: statsLoading } = useRegistrationStats(agent?.id);
  const { data: campaigns, isLoading: campaignsLoading } = useActiveCampaigns();
  const { data: partners, isLoading: partnersLoading } = useMyPartners(agent?.id);

  const activeCampaigns = campaigns?.length ?? 0;
  const activePartners = partners?.filter(p => p.status === 'active').length ?? 0;

  const isLoading = statsLoading || campaignsLoading || partnersLoading;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {agent?.name}! Here's your performance overview.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Active Events"
          value={activeCampaigns}
          icon={CalendarDays}
          iconColor="sky"
          description="Available for links"
          loading={isLoading}
        />
        <StatCard
          title="Registered"
          value={stats?.registered ?? 0}
          icon={UserCheck}
          iconColor="amber"
          description="Signed up via your links"
          loading={isLoading}
        />
        <StatCard
          title="Active Partners"
          value={activePartners}
          icon={Users}
          iconColor="violet"
          description="Sharing your links"
          loading={isLoading}
        />
        <StatCard
          title="Completed"
          value={stats?.completed ?? 0}
          icon={Award}
          iconColor="emerald"
          description={`RM${((stats?.completed ?? 0) * (agent?.tier?.reward_amount ?? 0)).toFixed(2)}`}
          loading={isLoading}
        />
      </StatCardGrid>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Your Tier</CardTitle>
            <CardDescription>Current reward structure</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : agent?.tier ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-muted-foreground">Tier Name</span>
                  <span className="font-semibold text-foreground">{agent.tier.name}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-muted-foreground">Reward per Attendance</span>
                  <span className="font-semibold text-emerald-600">RM{agent.tier.reward_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Invitation Limit per Slot</span>
                  <span className="font-semibold text-foreground">{agent.tier.invitation_limit_per_slot}</span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No tier assigned</p>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to="/campaigns"
              className="flex items-center justify-between p-2.5 rounded-lg hover:bg-indigo-50 transition-all duration-200 group cursor-pointer"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-indigo-700">Browse Active Events</span>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/my-links"
              className="flex items-center justify-between p-2.5 rounded-lg hover:bg-indigo-50 transition-all duration-200 group cursor-pointer"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-indigo-700">View My Links</span>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/partners"
              className="flex items-center justify-between p-2.5 rounded-lg hover:bg-indigo-50 transition-all duration-200 group cursor-pointer"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-indigo-700">Manage Partners</span>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PartnerDashboard() {
  const { partner } = useAuth();
  const { data: stats, isLoading } = usePartnerRegistrationStats(partner?.id);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {partner?.name}! You're a partner under {partner?.agent?.name ?? 'your unit'}.
        </p>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Registered"
          value={stats?.registered ?? 0}
          icon={UserCheck}
          iconColor="sky"
          description="Signed up via your links"
          loading={isLoading}
        />
        <StatCard
          title="Attended"
          value={stats?.attended ?? 0}
          icon={CheckCircle}
          iconColor="violet"
          description="Checked in at event"
          loading={isLoading}
        />
        <StatCard
          title="Completed"
          value={stats?.completed ?? 0}
          icon={Award}
          iconColor="emerald"
          description="Full attendance"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common tasks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link
            to="/partner-links"
            className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
          >
            <span className="text-sm font-medium text-foreground">Get & Share My Links</span>
            <ChevronRight className="size-4 text-muted-foreground group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export function Dashboard() {
  const { role } = useAuth();
  return role === 'partner' ? <PartnerDashboard /> : <AgentDashboard />;
}
