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
} from '@agent-system/shared-ui';
import { DollarSign, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { InvitationStatus } from '@agent-system/shared-types';

export function Rewards() {
  const { agent } = useAuth();
  const { data: invitations, isLoading } = useMyInvitations(agent?.id);

  // Calculate rewards from completed invitations
  const completedInvitations = invitations?.filter(i => i.status === InvitationStatus.COMPLETED) ?? [];
  const rewardAmount = agent?.tier?.reward_amount ?? 0;

  const totalEarned = completedInvitations.length * rewardAmount;
  const pendingRewards = completedInvitations.filter(() => true).length * rewardAmount; // Simplified - would check reward status
  const confirmedRewards = 0; // Would come from actual rewards table

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Rewards</h1>
        <p className="text-muted-foreground">Track your earnings from successful attendance</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalEarned.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              {completedInvitations.length} completed attendances
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">${pendingRewards.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Awaiting confirmation</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Confirmed</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">${confirmedRewards.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Ready for payout</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${rewardAmount.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Per attendance ({agent?.tier?.name})</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reward History</CardTitle>
          <CardDescription>
            Your completed attendances and earned rewards
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : completedInvitations.length === 0 ? (
            <p className="text-muted-foreground">
              No completed attendances yet. Rewards are earned when your invitees complete full attendance (check-in and check-out).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Invitee</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {completedInvitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium">
                      {invitation.slot?.campaign?.name ?? '-'}
                    </TableCell>
                    <TableCell>{invitation.invitee_name}</TableCell>
                    <TableCell className="capitalize">
                      {invitation.capacity_type.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${rewardAmount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Pending
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How Rewards Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">1</div>
            <div>
              <p className="font-medium text-foreground">Invite New Members</p>
              <p>Generate invitation links and share them with potential attendees.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">2</div>
            <div>
              <p className="font-medium text-foreground">They Register & Attend</p>
              <p>Invitees register via your link and attend the event with full check-in and check-out.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">3</div>
            <div>
              <p className="font-medium text-foreground">Earn Rewards</p>
              <p>For each successful full attendance, you earn ${rewardAmount.toFixed(2)} based on your tier.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
