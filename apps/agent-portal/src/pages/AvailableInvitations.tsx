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
  StatCard,
  StatCardGrid,
  TableSkeleton,
  useToast,
} from '@agent-system/shared-ui';
import { Send, CheckSquare, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useAvailableInvitations, useMyClaimedInvitations, useClaimInvitation } from '../hooks/usePartnerInvitations';

export function AvailableInvitations() {
  const { partner, role } = useAuth();

  // Role guard: only partners can access this page
  if (role && role !== 'partner') {
    return (
      <div className="p-6 text-center text-slate-500">
        <p>This page is only available to partners.</p>
      </div>
    );
  }
  const { data: available, isLoading } = useAvailableInvitations(partner?.agent_id);
  const { data: claimed } = useMyClaimedInvitations(partner?.id);
  const claimMutation = useClaimInvitation();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  // Track just-claimed invitations so we can show the copy button before query refetch
  const [justClaimed, setJustClaimed] = useState<Record<string, string>>({}); // id -> token

  const handleClaim = async (invitationId: string, token: string) => {
    if (!partner?.id) return;
    setClaimingId(invitationId);
    try {
      await claimMutation.mutateAsync({ invitationId, partnerId: partner.id });
      setJustClaimed(prev => ({ ...prev, [invitationId]: token }));
      toast({ title: 'Invitation claimed', description: 'Copy the link below to share it.' });
    } catch (err: any) {
      if (err.message === 'ALREADY_CLAIMED') {
        toast({ title: 'Already claimed', description: 'This invitation was just claimed by someone else — please select another.', variant: 'error' });
      } else {
        toast({ title: 'Failed to claim', description: err.message, variant: 'error' });
      }
    } finally {
      setClaimingId(null);
    }
  };

  const handleCopy = async (token: string, id: string) => {
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const link = `${publicPagesUrl}/public/register/${token}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Available Invitations</h1>
        <p className="text-slate-500 mt-1">Claim invitations to share with your invitees</p>
      </div>

      <StatCardGrid columns={2}>
        <StatCard
          title="Available"
          value={available?.length ?? 0}
          icon={Send}
          iconColor="amber"
          description="Unclaimed invitations"
          loading={isLoading}
        />
        <StatCard
          title="Claimed by Me"
          value={claimed?.length ?? 0}
          icon={CheckSquare}
          iconColor="emerald"
          description="My claimed invitations"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Unclaimed Invitations</CardTitle>
          <CardDescription>
            {available?.length ?? 0} invitations available to claim
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : available?.length === 0 ? (
            <p className="text-slate-500">No unclaimed invitations available right now.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Event</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {available?.map((inv) => (
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
                    <TableCell className="text-right">
                      {justClaimed[inv.id] ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(justClaimed[inv.id], inv.id)}
                        >
                          {copiedId === inv.id ? (
                            <><Check className="h-4 w-4 mr-1 text-emerald-600" /> Copied!</>
                          ) : (
                            <><Copy className="h-4 w-4 mr-1" /> Copy Link</>
                          )}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleClaim(inv.id, inv.unique_token)}
                          disabled={claimingId === inv.id}
                          className="bg-slate-900 hover:bg-slate-800"
                        >
                          {claimingId === inv.id ? 'Claiming...' : 'Claim'}
                        </Button>
                      )}
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
