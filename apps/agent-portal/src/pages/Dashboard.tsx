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
import { Calendar, Send, TrendingUp, Award, ArrowRight } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { useActiveCampaigns } from '../hooks/useCampaigns';
import { InvitationStatus } from '@agent-system/shared-types';

export function Dashboard() {
  const { agent } = useAuth();
  const { data: invitations, isLoading: invitationsLoading } = useMyInvitations(agent?.id);
  const { data: campaigns, isLoading: campaignsLoading } = useActiveCampaigns();

  const pendingInvitations = invitations?.filter(i => i.status === InvitationStatus.PENDING).length ?? 0;
  const registeredInvitations = invitations?.filter(i => i.status === InvitationStatus.REGISTERED).length ?? 0;
  const completedInvitations = invitations?.filter(i => i.status === InvitationStatus.COMPLETED).length ?? 0;
  const activeCampaigns = campaigns?.length ?? 0;

  const isLoading = invitationsLoading || campaignsLoading;

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
          title="Active Campaigns"
          value={activeCampaigns}
          icon={Calendar}
          iconColor="sky"
          description="Available for invitations"
          loading={isLoading}
        />
        <StatCard
          title="Pending Invitations"
          value={pendingInvitations}
          icon={Send}
          iconColor="amber"
          description="Awaiting registration"
          loading={isLoading}
        />
        <StatCard
          title="Registered"
          value={registeredInvitations}
          icon={TrendingUp}
          iconColor="violet"
          description="Ready for event"
          loading={isLoading}
        />
        <StatCard
          title="Rewards Earned"
          value={completedInvitations}
          icon={Award}
          iconColor="emerald"
          description={`$${(completedInvitations * (agent?.tier?.reward_amount ?? 0)).toFixed(2)}`}
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
              <span className="text-sm font-medium text-slate-700">Browse Active Campaigns</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/invitations"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">View My Invitations</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/rewards"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">Check Reward Status</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
