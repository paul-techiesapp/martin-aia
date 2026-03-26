import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  StatCard,
  StatCardGrid,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { Banknote, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useRegistrationStats } from '../hooks/useRegistrations';
import { supabase } from '../lib/supabase';
import { RegistrationStatus } from '@agent-system/shared-types';

export function Rewards() {
  const { agent } = useAuth();
  const { data: stats, isLoading: statsLoading } = useRegistrationStats(agent?.id);

  // Fetch completed registrations for the table
  const { data: completedRegistrations, isLoading: registrationsLoading } = useQuery({
    queryKey: ['completed-registrations', agent?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('registrations')
        .select(`
          *,
          slot:slots(
            *,
            campaign:campaigns(*)
          )
        `)
        .eq('agent_id', agent!.id)
        .eq('status', RegistrationStatus.COMPLETED)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!agent?.id,
  });

  // Fetch actual rewards from database
  const { data: rewardsData, isLoading: rewardsLoading } = useQuery({
    queryKey: ['agent-rewards', agent?.id],
    queryFn: async () => {
      if (!agent?.id) return { total: 0, pending: 0, confirmed: 0, paid: 0 };

      const { data: rewards } = await supabase
        .from('rewards')
        .select('amount, status')
        .eq('agent_id', agent.id);

      if (!rewards || rewards.length === 0) {
        return { total: 0, pending: 0, confirmed: 0, paid: 0 };
      }

      return {
        total: rewards.reduce((sum, r) => sum + (r.amount || 0), 0),
        pending: rewards.filter(r => r.status === 'pending').reduce((sum, r) => sum + (r.amount || 0), 0),
        confirmed: rewards.filter(r => r.status === 'confirmed').reduce((sum, r) => sum + (r.amount || 0), 0),
        paid: rewards.filter(r => r.status === 'paid').reduce((sum, r) => sum + (r.amount || 0), 0),
      };
    },
    enabled: !!agent?.id,
  });

  const rewardAmount = agent?.tier?.reward_amount ?? 0;
  const completedCount = stats?.completed ?? 0;

  // Use database rewards if available, otherwise calculate from completed registrations
  const totalEarned = rewardsData?.total || (completedCount * rewardAmount);
  const pendingRewards = rewardsData?.pending || (completedCount * rewardAmount);
  const confirmedRewards = rewardsData?.confirmed || 0;

  const isLoading = statsLoading || rewardsLoading || registrationsLoading;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Rewards</h1>
        <p className="text-muted-foreground">Track your earnings from successful attendance completions</p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Total Earned"
          value={`RM${totalEarned.toFixed(2)}`}
          icon={Banknote}
          iconColor="emerald"
          description={`${completedCount} completed attendances`}
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={`RM${pendingRewards.toFixed(2)}`}
          icon={Clock}
          iconColor="amber"
          description="Awaiting confirmation"
          loading={isLoading}
        />
        <StatCard
          title="Confirmed"
          value={`RM${confirmedRewards.toFixed(2)}`}
          icon={CheckCircle}
          iconColor="sky"
          description="Ready for payout"
          loading={isLoading}
        />
        <StatCard
          title="Rate"
          value={`RM${rewardAmount.toFixed(2)}`}
          icon={TrendingUp}
          iconColor="violet"
          description={`Per attendance (${agent?.tier?.name || 'N/A'})`}
          loading={isLoading}
        />
      </StatCardGrid>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Reward History</CardTitle>
          <CardDescription>
            Your completed attendances and earned rewards
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : !completedRegistrations || completedRegistrations.length === 0 ? (
            <p className="text-muted-foreground">
              No completed attendances yet. Rewards are earned when your invitees complete full attendance (check-in and check-out).
            </p>
          ) : (
            <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Event</TableHead>
                  <TableHead>Registrant</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {completedRegistrations.map((reg) => (
                  <TableRow key={reg.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-medium">
                      {reg.slot?.campaign?.name ?? '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{reg.invitee_name}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {reg.capacity_type.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600">
                      RM{rewardAmount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="pending">Pending</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>How Rewards Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold flex-shrink-0">1</div>
            <div>
              <p className="font-medium text-foreground">Share Your Link</p>
              <p className="text-sm text-muted-foreground">Get your shareable link and share it with potential attendees.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold flex-shrink-0">2</div>
            <div>
              <p className="font-medium text-foreground">They Register & Attend</p>
              <p className="text-sm text-muted-foreground">Invitees register via your link and attend the event with full check-in and check-out.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-sm font-bold flex-shrink-0">3</div>
            <div>
              <p className="font-medium text-foreground">Earn Rewards</p>
              <p className="text-sm text-muted-foreground">For each successful full attendance, you earn RM{rewardAmount.toFixed(2)} based on your tier.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
