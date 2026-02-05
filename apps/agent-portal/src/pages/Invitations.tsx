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
  Button,
  Badge,
  getStatusVariant,
  StatCard,
  StatCardGrid,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { Copy, Check, ExternalLink, Send, UserCheck, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { InvitationStatus } from '@agent-system/shared-types';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Invitations() {
  const { agent } = useAuth();
  const { data: invitations, isLoading } = useMyInvitations(agent?.id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (token: string, id: string) => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/public/register/${token}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const pendingCount = invitations?.filter(i => i.status === InvitationStatus.PENDING).length ?? 0;
  const registeredCount = invitations?.filter(i => i.status === InvitationStatus.REGISTERED).length ?? 0;
  const completedCount = invitations?.filter(i => i.status === InvitationStatus.COMPLETED).length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">My Invitations</h1>
        <p className="text-slate-500 mt-1">Track your invitation links and registrations</p>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Pending"
          value={pendingCount}
          icon={Send}
          iconColor="amber"
          description="Awaiting registration"
          loading={isLoading}
        />
        <StatCard
          title="Registered"
          value={registeredCount}
          icon={UserCheck}
          iconColor="sky"
          description="Ready for event"
          loading={isLoading}
        />
        <StatCard
          title="Completed"
          value={completedCount}
          icon={CheckCircle}
          iconColor="emerald"
          description="Full attendance"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">All Invitations</CardTitle>
          <CardDescription>
            {invitations?.length ?? 0} total invitations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : invitations?.length === 0 ? (
            <p className="text-slate-500">No invitations yet. Browse campaigns to create invitation links.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Campaign</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Invitee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations?.map((invitation) => (
                  <TableRow key={invitation.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-medium">
                      {invitation.slot?.campaign?.name ?? '-'}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {invitation.slot
                        ? `${DAYS_OF_WEEK[invitation.slot.day_of_week]} ${invitation.slot.start_time.slice(0, 5)}`
                        : '-'}
                    </TableCell>
                    <TableCell className="capitalize text-slate-600">
                      {invitation.capacity_type.replace('_', ' ')}
                    </TableCell>
                    <TableCell>
                      {invitation.invitee_name || (
                        <span className="text-slate-400">Not registered</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(invitation.status)}>
                        {invitation.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {invitation.status === InvitationStatus.PENDING && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleCopy(invitation.unique_token, invitation.id)}
                          >
                            {copiedId === invitation.id ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {invitation.invitee_name && (
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
