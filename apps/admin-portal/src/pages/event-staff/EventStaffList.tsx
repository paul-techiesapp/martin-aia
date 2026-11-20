import { useState } from 'react';
import {
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Badge,
  Checkbox,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  TableSkeleton,
  useToast,
} from '@agent-system/shared-ui';
import { Plus, CalendarCheck, KeyRound, Trash2 } from 'lucide-react';
import { CampaignStatus } from '@agent-system/shared-types';
import { useCampaigns } from '../../hooks/useCampaigns';
import {
  useEventStaffList,
  useCreateEventStaff,
  useSetEventStaffPassword,
  useDeleteEventStaff,
  useSetEventStaffAssignments,
  type EventStaffMember,
} from '../../hooks/useEventStaff';

/**
 * Organising-team logins. Each login can sign in to this portal but only sees
 * the Check-In page (scanner + check-out display) for the events assigned here.
 */
export function EventStaffList() {
  const { toast } = useToast();
  const { data: staff, isLoading, error } = useEventStaffList();
  const { data: campaigns } = useCampaigns();
  const createStaff = useCreateEventStaff();
  const setPassword = useSetEventStaffPassword();
  const deleteStaff = useDeleteEventStaff();
  const setAssignments = useSetEventStaffAssignments();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '' });
  const [createEvents, setCreateEvents] = useState<string[]>([]);

  const [assignTarget, setAssignTarget] = useState<EventStaffMember | null>(null);
  const [assignSelection, setAssignSelection] = useState<string[]>([]);

  const [passwordTarget, setPasswordTarget] = useState<EventStaffMember | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<EventStaffMember | null>(null);

  // Completed events are hidden from the picker unless already assigned.
  const assignableCampaigns = (selected: string[]) =>
    (campaigns ?? []).filter((c) => c.status !== CampaignStatus.COMPLETED || selected.includes(c.id));

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const handleCreate = async () => {
    try {
      const res = await createStaff.mutateAsync(createForm);
      if (createEvents.length > 0 && res?.user_id) {
        await setAssignments.mutateAsync({ user_id: res.user_id, campaignIds: createEvents, current: [] });
      }
      toast({
        title: 'Staff login created',
        description: `${createForm.name} can now sign in at this portal with ${createForm.email}.`,
      });
      setIsCreateOpen(false);
      setCreateForm({ name: '', email: '', password: '' });
      setCreateEvents([]);
    } catch (err: any) {
      toast({ title: 'Failed to create staff login', description: err.message, variant: 'error' });
    }
  };

  const openAssign = (member: EventStaffMember) => {
    setAssignTarget(member);
    setAssignSelection(member.assignments.map((a) => a.campaign_id));
  };

  const handleSaveAssign = async () => {
    if (!assignTarget) return;
    try {
      await setAssignments.mutateAsync({
        user_id: assignTarget.user_id,
        campaignIds: assignSelection,
        current: assignTarget.assignments.map((a) => a.campaign_id),
      });
      toast({ title: 'Events updated', description: `${assignTarget.name}'s events were saved.` });
      setAssignTarget(null);
    } catch (err: any) {
      toast({ title: 'Failed to save events', description: err.message, variant: 'error' });
    }
  };

  const handleSetPassword = async () => {
    if (!passwordTarget) return;
    try {
      await setPassword.mutateAsync({ user_id: passwordTarget.user_id, password: newPassword });
      toast({ title: 'Password updated', description: `New password set for ${passwordTarget.name}.` });
      setPasswordTarget(null);
      setNewPassword('');
    } catch (err: any) {
      toast({ title: 'Failed to update password', description: err.message, variant: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteStaff.mutateAsync(deleteTarget.user_id);
      toast({ title: 'Staff login deleted', description: `${deleteTarget.name} can no longer sign in.` });
      setDeleteTarget(null);
    } catch (err: any) {
      toast({ title: 'Failed to delete', description: err.message, variant: 'error' });
    }
  };

  const eventChecklist = (selected: string[], onToggle: (id: string) => void) => {
    const list = assignableCampaigns(selected);
    if (list.length === 0) return <p className="text-sm text-muted-foreground">No events available.</p>;
    return (
      <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
        {list.map((c) => (
          <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
            <Checkbox checked={selected.includes(c.id)} onCheckedChange={() => onToggle(c.id)} />
            <span className="flex-1">{c.name}</span>
            <Badge variant={c.status === CampaignStatus.ACTIVE ? 'active' : 'inactive'}>{c.status}</Badge>
          </label>
        ))}
      </div>
    );
  };

  const canCreate =
    createForm.name.trim() && createForm.email.trim() && createForm.password.length >= 6 && !createStaff.isPending;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Event Staff</h1>
          <p className="text-sm text-muted-foreground">
            Logins for organising teams. Each can only check people in and open the check-out
            display for the events assigned to it.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          New Staff Login
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Staff Logins</CardTitle>
          <CardDescription>{staff?.length ?? 0} staff logins</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-red-600">Error loading staff: {(error as Error).message}</p>
          ) : isLoading ? (
            <TableSkeleton rows={3} columns={4} />
          ) : !staff || staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No staff logins yet. Create one for each organising team, then assign their events.
            </p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Login Email</TableHead>
                    <TableHead>Assigned Events</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((m) => (
                    <TableRow key={m.user_id}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-muted-foreground">{m.email}</TableCell>
                      <TableCell>
                        {m.assignments.length === 0 ? (
                          <span className="text-sm text-muted-foreground">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {m.assignments.map((a) => (
                              <Badge key={a.campaign_id} variant="info">
                                {a.campaign?.name ?? 'Event'}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => openAssign(m)}>
                          <CalendarCheck className="size-4 mr-1" />
                          Events
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setPasswordTarget(m)}>
                          <KeyRound className="size-4 mr-1" />
                          Password
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleteTarget(m)}
                        >
                          <Trash2 className="size-4 mr-1" />
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Staff Login</DialogTitle>
            <DialogDescription>
              The team signs in to this portal with this email and password. They will only see
              the Check-In page for the events you tick below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Team / Staff Name</Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="e.g. Team Nicole"
              />
            </div>
            <div>
              <Label>Login Email</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Password (min 6 characters)</Label>
              <Input
                type="text"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              />
            </div>
            <div>
              <Label>Events</Label>
              <div className="mt-1">{eventChecklist(createEvents, (id) => setCreateEvents(toggle(createEvents, id)))}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!canCreate}>
              {createStaff.isPending ? 'Creating...' : 'Create Login'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign events */}
      <Dialog open={!!assignTarget} onOpenChange={(open) => !open && setAssignTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Events for {assignTarget?.name}</DialogTitle>
            <DialogDescription>
              This login can only check people in and open the check-out display for the ticked events.
            </DialogDescription>
          </DialogHeader>
          {eventChecklist(assignSelection, (id) => setAssignSelection(toggle(assignSelection, id)))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button onClick={handleSaveAssign} disabled={setAssignments.isPending}>
              {setAssignments.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog
        open={!!passwordTarget}
        onOpenChange={(open) => {
          if (!open) {
            setPasswordTarget(null);
            setNewPassword('');
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set New Password</DialogTitle>
            <DialogDescription>For {passwordTarget?.name} ({passwordTarget?.email})</DialogDescription>
          </DialogHeader>
          <div>
            <Label>New Password (min 6 characters)</Label>
            <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordTarget(null)}>Cancel</Button>
            <Button onClick={handleSetPassword} disabled={newPassword.length < 6 || setPassword.isPending}>
              {setPassword.isPending ? 'Saving...' : 'Save Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete staff login?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will no longer be able to sign in. Check-ins they already
              recorded are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
