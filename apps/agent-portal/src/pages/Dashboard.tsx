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
import { Calendar, Award, ArrowRight, Users, UserCheck, CheckCircle } from 'lucide-react';
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
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Welcome back, {agent?.name}! Here's your overview.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Active Events"
          value={activeCampaigns}
          icon={Calendar}
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
          description={`$${((stats?.completed ?? 0) * (agent?.tier?.reward_amount ?? 0)).toFixed(2)}`}
          loading={isLoading}
        />
      </StatCardGrid>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Your Tier</CardTitle>
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
                  <span className="text-slate-500">Tier Name</span>
                  <span className="font-semibold text-slate-900">{agent.tier.name}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-500">Reward per Attendance</span>
                  <span className="font-semibold text-emerald-600">${agent.tier.reward_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-500">Invitation Limit per Slot</span>
                  <span className="font-semibold text-slate-900">{agent.tier.invitation_limit_per_slot}</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-500">No tier assigned</p>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to="/campaigns"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">Browse Active Events</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/my-links"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">View My Links</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/partners"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">Manage Partners</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
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
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">
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
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Common tasks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link
            to="/partner-links"
            className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
          >
            <span className="text-sm font-medium text-slate-700">Get & Share My Links</span>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
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
