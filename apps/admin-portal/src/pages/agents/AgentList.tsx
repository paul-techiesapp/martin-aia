import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Avatar,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  getStatusVariant,
  TableSkeleton,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useToast,
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, MoreHorizontal, Check, X } from 'lucide-react';
import { useAgents, useDeleteAgent } from '../../hooks/useAgents';
import {
  usePendingTierRequests,
  useApproveTierRequest,
  useRejectTierRequest,
} from '../../hooks/useTierRequests';

export function AgentList() {
  const { data: agents, isLoading, error } = useAgents();
  const deleteAgent = useDeleteAgent();
  const { data: pendingRequests, isLoading: isLoadingRequests } = usePendingTierRequests();
  const approveTierRequest = useApproveTierRequest();
  const rejectTierRequest = useRejectTierRequest();
  const { toast } = useToast();

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteAgent.mutateAsync(deleteId);
      toast({ title: 'Agent deleted', description: 'The account and its data were permanently removed. The email and phone can now be reused.' });
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: 'Failed to delete agent', description: err.message, variant: 'error' });
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      await approveTierRequest.mutateAsync(requestId);
      toast({ title: 'Tier approved', description: 'The tier has been assigned to the agent.' });
    } catch (err: any) {
      toast({ title: 'Failed to approve', description: err.message, variant: 'error' });
    }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    try {
      await rejectTierRequest.mutateAsync({ requestId: rejectId, adminNotes: rejectNotes });
      toast({ title: 'Tier request rejected' });
      setRejectId(null);
      setRejectNotes('');
    } catch (err: any) {
      toast({ title: 'Failed to reject', description: err.message, variant: 'error' });
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-red-600">Error loading units: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Units</h1>
          <p className="text-sm text-muted-foreground">Manage unit accounts and tier assignments</p>
        </div>
        <Link to="/agents/new">
          <Button>
            <Plus className="size-4 mr-1.5" />
            New Unit
          </Button>
        </Link>
      </div>

      {/* Pending Tier Requests Section */}
      {!isLoadingRequests && pendingRequests && pendingRequests.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pending Tier Requests
              <Badge variant="warning">{pendingRequests.length}</Badge>
            </CardTitle>
            <CardDescription>Review and approve or reject tier assignment requests from unit administrators</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Requested Tier</TableHead>
                    <TableHead>Reward</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map((req) => {
                    const isPartner = !!req.partner_id;
                    const name = isPartner ? req.partner?.name : req.agent?.name;
                    const code = isPartner ? '—' : req.agent?.agent_code;
                    return (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{name ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={isPartner ? 'info' : 'default'}>
                          {isPartner ? 'Partner' : 'Agent'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{code ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{req.requester?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{req.requested_tier?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        RM{req.requested_tier?.reward_amount ?? 0}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(req.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            onClick={() => handleApprove(req.id)}
                            disabled={approveTierRequest.isPending}
                          >
                            <Check className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setRejectId(req.id)}
                            disabled={rejectTierRequest.isPending}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Units Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Units</CardTitle>
          <CardDescription>
            {agents?.length ?? 0} registered units
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={7} />
          ) : agents?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No units registered yet. Add your first unit to get started.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Agent Code</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents?.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={agent.photo_url} name={agent.name} size="sm" />
                        <span>{agent.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{agent.agent_code}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.email}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.unit_name}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(agent.status)}>
                        {agent.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="size-8 p-0" aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to="/agents/$agentId/edit" params={{ agentId: agent.id }}>
                              <Pencil className="mr-2 size-4" />
                              Edit Unit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => handleDelete(agent.id)}
                            disabled={deleteAgent.isPending}
                          >
                            <Trash2 className="mr-2 size-4" />
                            Delete Unit
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Unit</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the agent, all of their sub-agents and partners,
              and the related invitations and rewards. Their logins are removed so the
              same email and phone can be reused. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Tier Request Dialog */}
      <Dialog open={!!rejectId} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Tier Request</DialogTitle>
            <DialogDescription>
              Optionally provide a reason for rejecting this tier request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reject-notes">Notes (optional)</Label>
              <Input
                id="reject-notes"
                value={rejectNotes}
                onChange={e => setRejectNotes(e.target.value)}
                placeholder="Reason for rejection..."
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectId(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleReject}
                disabled={rejectTierRequest.isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                {rejectTierRequest.isPending ? 'Rejecting...' : 'Reject'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
