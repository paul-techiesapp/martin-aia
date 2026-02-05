import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@agent-system/shared-ui';
import { Calendar, Send, Award, TrendingUp } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { useActiveCampaigns } from '../hooks/useCampaigns';
import { InvitationStatus } from '@agent-system/shared-types';

export function Dashboard() {
  const { agent } = useAuth();
  const { data: invitations } = useMyInvitations(agent?.id);
  const { data: campaigns } = useActiveCampaigns();

  const pendingInvitations = invitations?.filter(i => i.status === InvitationStatus.PENDING).length ?? 0;
  const registeredInvitations = invitations?.filter(i => i.status === InvitationStatus.REGISTERED).length ?? 0;
  const completedInvitations = invitations?.filter(i => i.status === InvitationStatus.COMPLETED).length ?? 0;
  const activeCampaigns = campaigns?.length ?? 0;

  const stats = [
    {
      name: 'Active Campaigns',
      value: activeCampaigns,
      icon: Calendar,
      description: 'Available for invitations',
      href: '/campaigns',
    },
    {
      name: 'Pending Invitations',
      value: pendingInvitations,
      icon: Send,
      description: 'Awaiting registration',
      href: '/invitations',
    },
    {
      name: 'Registered',
      value: registeredInvitations,
      icon: TrendingUp,
      description: 'Ready for event',
      href: '/invitations',
    },
    {
      name: 'Rewards Earned',
      value: completedInvitations,
      icon: Award,
      description: `$${(completedInvitations * (agent?.tier?.reward_amount ?? 0)).toFixed(2)}`,
      href: '/rewards',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {agent?.name}! Here's your overview.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <a key={stat.name} href={stat.href}>
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.name}</CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your Tier</CardTitle>
            <CardDescription>Current reward structure</CardDescription>
          </CardHeader>
          <CardContent>
            {agent?.tier ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tier Name</span>
                  <span className="font-medium">{agent.tier.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reward per Attendance</span>
                  <span className="font-medium">${agent.tier.reward_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invitation Limit per Slot</span>
                  <span className="font-medium">{agent.tier.invitation_limit_per_slot}</span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No tier assigned</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <a href="/campaigns" className="block text-sm text-primary hover:underline">
              Browse Active Campaigns
            </a>
            <a href="/invitations" className="block text-sm text-primary hover:underline">
              View My Invitations
            </a>
            <a href="/rewards" className="block text-sm text-primary hover:underline">
              Check Reward Status
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
