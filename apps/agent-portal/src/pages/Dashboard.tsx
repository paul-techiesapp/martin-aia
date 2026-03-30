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
import { CalendarDays, Award, ChevronRight, Users, UserCheck, CheckCircle, UserCog } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useRegistrationStats, usePartnerRegistrationStats } from '../hooks/useRegistrations';
import { useActiveCampaigns } from '../hooks/useCampaigns';
import { useMyPartners } from '../hooks/usePartners';
import { useMySubAgents } from '../hooks/useSubAgents';

function AgentDashboard() {
  const { agent, role } = useAuth();
  const { data: stats, isLoading: statsLoading } = useRegistrationStats(agent?.id);
  const { data: campaigns, isLoading: campaignsLoading } = useActiveCampaigns();
  const { data: partners, isLoading: partnersLoading } = useMyPartners(agent?.id);
  const { data: subAgents, isLoading: subAgentsLoading } = useMySubAgents(role === 'agent_admin' ? agent?.id : undefined);

  const activeCampaigns = campaigns?.length ?? 0;
  const activePartners = partners?.filter(p => p.status === 'active').length ?? 0;
  const activeSubAgents = subAgents?.filter(a => a.status === 'active').length ?? 0;

  const isLoading = statsLoading || campaignsLoading || partnersLoading || subAgentsLoading;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
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
        {role === 'agent_admin' ? (
          <>
            <StatCard
              title="Active Agents"
              value={activeSubAgents}
              icon={UserCog}
              iconColor="indigo"
              description="In your unit"
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
          </>
        ) : (
          <>
            <StatCard
              title="Completed"
              value={stats?.completed ?? 0}
              icon={Award}
              iconColor="emerald"
              description={`RM${((stats?.completed ?? 0) * (agent?.tier?.reward_amount ?? 0)).toFixed(2)}`}
              loading={isLoading}
            />
            <StatCard
              title="Full Attendance"
              value={stats?.completed ?? 0}
              icon={CheckCircle}
              iconColor="violet"
              description="Completed events"
              loading={isLoading}
            />
          </>
        )}
      </StatCardGrid>

      <div className="grid gap-3 md:grid-cols-2">
        {role === 'agent_admin' ? (
          <Card>
            <CardHeader>
              <CardTitle>Your Unit</CardTitle>
              <CardDescription>Unit overview</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Unit Name</span>
                  <span className="font-semibold text-foreground">{agent?.unit_name}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground">Agent Code</span>
                  <span className="font-semibold text-foreground">{agent?.agent_code}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Total Members</span>
                  <span className="font-semibold text-foreground">{(activeSubAgents) + activePartners + 1}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Your Tier</CardTitle>
              <CardDescription>Current reward structure</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : agent?.tier ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-muted-foreground">Tier Name</span>
                    <span className="font-semibold text-foreground">{agent.tier.name}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">Reward per Attendance</span>
                    <span className="font-semibold text-emerald-600">RM{agent.tier.reward_amount.toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No tier assigned. Contact your unit administrator.</p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to="/campaigns"
              className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted transition-all duration-200 group cursor-pointer"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-foreground">Browse Active Events</span>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/my-links"
              className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted transition-all duration-200 group cursor-pointer"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-foreground">View My Links</span>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
            </Link>
            {role === 'agent_admin' && (
              <>
                <Link
                  to="/my-agents"
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted transition-all duration-200 group cursor-pointer"
                >
                  <span className="text-sm font-medium text-foreground group-hover:text-foreground">Manage Agents</span>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
                </Link>
                <Link
                  to="/partners"
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted transition-all duration-200 group cursor-pointer"
                >
                  <span className="text-sm font-medium text-foreground group-hover:text-foreground">Manage Partners</span>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
                </Link>
              </>
            )}
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
        <p className="text-sm text-muted-foreground">
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

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common tasks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link
            to="/partner-links"
            className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted transition-colors group"
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
