import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@agent-system/shared-ui';
import { Calendar, Users, UserCheck, DollarSign } from 'lucide-react';
import { useCampaigns } from '../hooks/useCampaigns';
import { CampaignStatus } from '@agent-system/shared-types';

export function Dashboard() {
  const { data: campaigns, isLoading } = useCampaigns();

  const activeCampaigns = campaigns?.filter(c => c.status === CampaignStatus.ACTIVE).length ?? 0;

  const stats = [
    {
      name: 'Active Campaigns',
      value: activeCampaigns,
      icon: Calendar,
      description: 'Currently running',
    },
    {
      name: 'Total Agents',
      value: '-',
      icon: Users,
      description: 'Registered agents',
    },
    {
      name: 'Attendance Today',
      value: '-',
      icon: UserCheck,
      description: 'Check-ins',
    },
    {
      name: 'Pending Rewards',
      value: '-',
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
