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
import { DollarSign, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { InvitationStatus } from '@agent-system/shared-types';
import { supabase } from '../lib/supabase';

export function Rewards() {
  const { agent } = useAuth();
  const { data: invitations, isLoading: invitationsLoading } = useMyInvitations(agent?.id);

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

  // Calculate from completed invitations as fallback
  const completedInvitations = invitations?.filter(i => i.status === InvitationStatus.COMPLETED) ?? [];
  const rewardAmount = agent?.tier?.reward_amount ?? 0;

  // Use database rewards if available, otherwise calculate from invitations
  const totalEarned = rewardsData?.total || (completedInvitations.length * rewardAmount);
  const pendingRewards = rewardsData?.pending || (completedInvitations.length * rewardAmount);
  const confirmedRewards = rewardsData?.confirmed || 0;

  const isLoading = invitationsLoading || rewardsLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Rewards</h1>
        <p className="text-slate-500 mt-1">Track your earnings from successful attendance</p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Total Earned"
          value={`$${totalEarned.toFixed(2)}`}
          icon={DollarSign}
          iconColor="emerald"
          description={`${completedInvitations.length} completed attendances`}
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={`$${pendingRewards.toFixed(2)}`}
          icon={Clock}
          iconColor="amber"
          description="Awaiting confirmation"
          loading={isLoading}
        />
        <StatCard
          title="Confirmed"
          value={`$${confirmedRewards.toFixed(2)}`}
          icon={CheckCircle}
          iconColor="sky"
          description="Ready for payout"
          loading={isLoading}
        />
        <StatCard
          title="Rate"
          value={`$${rewardAmount.toFixed(2)}`}
          icon={TrendingUp}
          iconColor="violet"
          description={`Per attendance (${agent?.tier?.name || 'N/A'})`}
          loading={isLoading}
        />
      </StatCardGrid>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Reward History</CardTitle>
          <CardDescription>
            Your completed attendances and earned rewards
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : completedInvitations.length === 0 ? (
            <p className="text-slate-500">
              No completed attendances yet. Rewards are earned when your invitees complete full attendance (check-in and check-out).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Campaign</TableHead>
                  <TableHead>Invitee</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {completedInvitations.map((invitation) => (
                  <TableRow key={invitation.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-medium">
                      {invitation.slot?.campaign?.name ?? '-'}
                    </TableCell>
                    <TableCell className="text-slate-600">{invitation.invitee_name}</TableCell>
                    <TableCell className="capitalize text-slate-600">
                      {invitation.capacity_type.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600">
                      ${rewardAmount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="pending">Pending</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">How Rewards Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 text-sm font-bold flex-shrink-0">1</div>
            <div>
              <p className="font-medium text-slate-900">Invite New Members</p>
              <p className="text-sm text-slate-500">Generate invitation links and share them with potential attendees.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 text-sm font-bold flex-shrink-0">2</div>
            <div>
              <p className="font-medium text-slate-900">They Register & Attend</p>
              <p className="text-sm text-slate-500">Invitees register via your link and attend the event with full check-in and check-out.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-sm font-bold flex-shrink-0">3</div>
            <div>
              <p className="font-medium text-slate-900">Earn Rewards</p>
              <p className="text-sm text-slate-500">For each successful full attendance, you earn ${rewardAmount.toFixed(2)} based on your tier.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
