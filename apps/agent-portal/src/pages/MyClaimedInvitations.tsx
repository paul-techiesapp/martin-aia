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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agent-system/shared-ui';
import { Copy, Check, Send, UserCheck, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyClaimedInvitations } from '../hooks/usePartnerInvitations';
import { InvitationStatus } from '@agent-system/shared-types';

export function MyClaimedInvitations() {
  const { partner, role } = useAuth();

  // Role guard: only partners can access this page
  if (role && role !== 'partner') {
    return (
      <div className="p-6 text-center text-slate-500">
        <p>This page is only available to partners.</p>
      </div>
    );
  }
  const { data: invitations, isLoading } = useMyClaimedInvitations(partner?.id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (token: string, id: string) => {
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const link = `${publicPagesUrl}/public/register/${token}`;
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
        <h1 className="text-3xl font-bold text-slate-900">My Claimed Invitations</h1>
        <p className="text-slate-500 mt-1">Track invitations you've claimed and shared</p>
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
          <CardTitle className="text-lg">All Claimed Invitations</CardTitle>
          <CardDescription>
            {invitations?.length ?? 0} total claimed invitations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : invitations?.length === 0 ? (
            <p className="text-slate-500">No claimed invitations yet. Browse available invitations to claim some.</p>
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Event</TableHead>
                    <TableHead>Slot</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Invitee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations?.map((inv) => (
                    <TableRow key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-medium">
                        {inv.slot?.campaign?.name ?? '-'}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {inv.slot
                          ? format(parseISO(inv.slot.start_at), 'd MMM yyyy, HH:mm')
                          : '-'}
                      </TableCell>
                      <TableCell className="capitalize text-slate-600">
                        {inv.capacity_type.replace('_', ' ')}
                      </TableCell>
                      <TableCell>
                        {inv.invitee_name || (
                          <span className="text-slate-400">Not registered</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(inv.status)}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.status === InvitationStatus.PENDING && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleCopy(inv.unique_token, inv.id)}
                              >
                                {copiedId === inv.id ? (
                                  <Check className="h-4 w-4 text-emerald-600" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {copiedId === inv.id ? 'Link copied!' : 'Copy invitation link'}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
