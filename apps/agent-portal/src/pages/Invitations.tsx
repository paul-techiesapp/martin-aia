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
} from '@agent-system/shared-ui';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { InvitationStatus } from '@agent-system/shared-types';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const statusColors: Record<InvitationStatus, string> = {
  [InvitationStatus.PENDING]: 'bg-yellow-100 text-yellow-800',
  [InvitationStatus.REGISTERED]: 'bg-blue-100 text-blue-800',
  [InvitationStatus.ATTENDED]: 'bg-green-100 text-green-800',
  [InvitationStatus.COMPLETED]: 'bg-green-100 text-green-800',
  [InvitationStatus.EXPIRED]: 'bg-gray-100 text-gray-800',
};

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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">My Invitations</h1>
        <p className="text-muted-foreground">Track your invitation links and registrations</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
            <p className="text-xs text-muted-foreground">Awaiting registration</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Registered</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{registeredCount}</div>
            <p className="text-xs text-muted-foreground">Ready for event</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{completedCount}</div>
            <p className="text-xs text-muted-foreground">Full attendance</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Invitations</CardTitle>
          <CardDescription>
            {invitations?.length ?? 0} total invitations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading invitations...</p>
          ) : invitations?.length === 0 ? (
            <p className="text-muted-foreground">No invitations yet. Browse campaigns to create invitation links.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium">
                      {invitation.slot?.campaign?.name ?? '-'}
                    </TableCell>
                    <TableCell>
                      {invitation.slot
                        ? `${DAYS_OF_WEEK[invitation.slot.day_of_week]} ${invitation.slot.start_time.slice(0, 5)}`
                        : '-'}
                    </TableCell>
                    <TableCell className="capitalize">
                      {invitation.capacity_type.replace('_', ' ')}
                    </TableCell>
                    <TableCell>
                      {invitation.invitee_name || (
                        <span className="text-muted-foreground">Not registered</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[invitation.status]}`}>
                        {invitation.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {invitation.status === InvitationStatus.PENDING && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(invitation.unique_token, invitation.id)}
                          >
                            {copiedId === invitation.id ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {invitation.invitee_name && (
                          <Button variant="ghost" size="sm">
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
