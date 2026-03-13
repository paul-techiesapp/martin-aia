import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  getStatusVariant,
  StatCard,
  StatCardGrid,
  Skeleton,
  InvitationCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agent-system/shared-ui';
import { Copy, Check, ExternalLink, Send, UserCheck, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { InvitationStatus } from '@agent-system/shared-types';

export function Invitations() {
  const { agent } = useAuth();
  const { data: invitations, isLoading } = useMyInvitations(agent?.id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (token: string, id: string) => {
    // Use public-pages URL for registration links (not the agent portal URL)
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
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[140px] w-full rounded-xl" />
              ))}
            </div>
          ) : invitations?.length === 0 ? (
            <p className="text-slate-500">No invitations yet. Browse events to create invitation links.</p>
          ) : (
            <TooltipProvider>
              <div className="space-y-3">
                {invitations?.map((invitation) => (
                  <InvitationCard
                    key={invitation.id}
                    eventName={invitation.slot?.campaign?.name ?? 'Unknown Event'}
                    venue={invitation.slot?.campaign?.venue ?? '-'}
                    date={invitation.slot ? parseISO(invitation.slot.start_at) : new Date()}
                    startTime={invitation.slot ? format(parseISO(invitation.slot.start_at), 'HH:mm') : '-'}
                    inviteeName={invitation.invitee_name}
                    inviteeType={invitation.capacity_type}
                    status={invitation.status}
                    actions={
                      <div className="flex items-center gap-1">
                        {invitation.status === InvitationStatus.PENDING && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleCopy(invitation.unique_token, invitation.id)}
                                aria-label="Copy invitation link"
                              >
                                {copiedId === invitation.id ? (
                                  <Check className="h-4 w-4 text-emerald-600" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {copiedId === invitation.id ? 'Link copied!' : 'Copy invitation link'}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {invitation.invitee_name && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                aria-label="View invitee details"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View invitee details</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    }
                  />
                ))}
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
