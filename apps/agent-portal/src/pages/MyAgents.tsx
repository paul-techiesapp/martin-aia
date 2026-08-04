import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
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
  StatCard,
  StatCardGrid,
  TableSkeleton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  useToast,
  Switch,
} from '@agent-system/shared-ui';
import { Users, UserCheck, Clock, UserPlus, Trash2, Tag, Mail, Pencil, Image, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import {
  useMySubAgents,
  useMyTierRequests,
  useCreateSubAgent,
  useRequestTier,
  useUpdateSubAgent,
  useDeleteUnitAgent,
  useAvailableTiers,
  useUnitFooterImage,
  useUnitRoot,
  useSetUnitFooter,
} from '../hooks/useSubAgents';
import { TierRequestStatus } from '@agent-system/shared-types';
import type { AgentWithTier } from '@agent-system/shared-types';

export function MyAgents() {
  const { agent, role, isUnitViewer } = useAuth();
  const { toast } = useToast();

  // Role guard: admin + unit managers (deputy) can access
  if (role && !isUnitViewer) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>This page is only available to Unit Managers and Unit Admins.</p>
      </div>
    );
  }

  // The management list is the caller's whole unit resolved SERVER-SIDE
  // (recursive unit_member_ids()), minus the unit root — so the boss's row is
  // never rendered (and never deletable) here, while a manager linked under a
  // root still sees their own team. unitRootId comes from get_unit_root().
  const { data: unitRootId } = useUnitRoot(!!agent);
  const { data: subAgents, isLoading } = useMySubAgents(!!agent);
  const { data: tierRequests } = useMyTierRequests(agent?.id);
  const { data: tiers } = useAvailableTiers();
  const createSubAgent = useCreateSubAgent();
  const requestTier = useRequestTier();
  const updateSubAgent = useUpdateSubAgent();
  const deleteUnitAgent = useDeleteUnitAgent();
  const { data: footerImageUrl } = useUnitFooterImage(isUnitViewer ? unitRootId ?? undefined : undefined);
  const setUnitFooter = useSetUnitFooter();
  const [isUploadingFooter, setIsUploadingFooter] = useState(false);
  const footerFileInputRef = useRef<HTMLInputElement | null>(null);

  // Only the unit root (agent_admin) may see/change the Unit Admin flag —
  // mirrors the update-sub-agent / delete-agent edge function matrix.
  const isRoot = agent?.parent_agent_id === null;

  const [isUpdatingAutoInvite, setIsUpdatingAutoInvite] = useState(false);

  const handleToggleAutoInvite = async () => {
    if (!agent) return;
    setIsUpdatingAutoInvite(true);
    try {
      const { error } = await supabase
        .from('agents')
        .update({ is_auto_invite: !agent.is_auto_invite })
        .eq('id', agent.id);
      if (error) throw error;
      toast({ title: `Auto invite ${agent.is_auto_invite ? 'disabled' : 'enabled'}` });
      window.location.reload();
    } catch (err: any) {
      toast({ title: 'Failed to update setting', description: err.message, variant: 'error' });
    } finally {
      setIsUpdatingAutoInvite(false);
    }
  };

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isTierOpen, setIsTierOpen] = useState(false);
  const [tierTargetId, setTierTargetId] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState('');
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', nric: '', agent_code: '', password: '' });

  const [editTarget, setEditTarget] = useState<AgentWithTier | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    phone: '',
    nric: '',
    agent_code: '',
    tier_id: '',
    status: 'active' as 'active' | 'inactive',
    is_unit_manager: false,
    password: '',
  });

  // Own row renders separately at the top ("You"); for a deputy it would
  // otherwise repeat inside the roster (the deputy is a child of the root).
  // Filtering it out also removes any self-delete/self-edit button (the edge
  // functions reject self-targets anyway).
  const rosterAgents = subAgents?.filter((a) => a.id !== agent?.id);

  // Mirrors the server-side matrix in update-sub-agent / delete-agent: the
  // root can manage everyone in the roster; a deputy (Unit Admin) can only
  // manage plain Unit Agents, never the root or other deputies.
  const canManage = (a: AgentWithTier) => isRoot || !a.is_unit_manager;

  const openEditDialog = (a: AgentWithTier) => {
    setEditTarget(a);
    setEditForm({
      name: a.name,
      email: a.email,
      phone: a.phone,
      nric: a.nric ?? '',
      agent_code: a.agent_code,
      tier_id: a.tier_id ?? '',
      status: a.status as 'active' | 'inactive',
      is_unit_manager: a.is_unit_manager,
      password: '',
    });
  };

  const activeCount = subAgents?.filter(a => a.status === 'active').length ?? 0;
  const totalCount = (subAgents?.length ?? 0) + 1; // +1 for the unit root (self for the boss)
  const pendingRequests = tierRequests?.filter(r => r.status === TierRequestStatus.PENDING).length ?? 0;

  const getTierRequestForAgent = (agentId: string) => {
    return tierRequests?.find(r => r.agent_id === agentId && r.status === TierRequestStatus.PENDING);
  };

  const getLastRejectedRequest = (agentId: string) => {
    return tierRequests?.find(r => r.agent_id === agentId && r.status === TierRequestStatus.REJECTED);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSubAgent.mutateAsync({
        name: form.name,
        email: form.email,
        phone: form.phone,
        nric: form.nric || undefined,
        agent_code: form.agent_code,
        password: form.password,
      });
      toast({ title: 'Agent created', description: `${form.name} can now log in with their email and password.` });
      setIsAddOpen(false);
      setForm({ name: '', email: '', phone: '', nric: '', agent_code: '', password: '' });
    } catch (err: any) {
      toast({ title: 'Failed to create agent', description: err.message, variant: 'error' });
    }
  };

  const handleRequestTier = async () => {
    if (!tierTargetId || !selectedTierId) return;
    try {
      await requestTier.mutateAsync({ agent_id: tierTargetId, tier_id: selectedTierId });
      toast({ title: 'Tier requested', description: 'Waiting for admin approval.' });
      setIsTierOpen(false);
      setTierTargetId(null);
      setSelectedTierId('');
    } catch (err: any) {
      toast({ title: 'Failed to request tier', description: err.message, variant: 'error' });
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    try {
      await deleteUnitAgent.mutateAsync({ agent_id: deactivateId });
      toast({ title: 'Agent deleted', description: 'The agent and their partners were permanently removed. Their email and phone can now be reused.' });
      setDeactivateId(null);
    } catch (err: any) {
      // The 409 "open enquiries" guard message tells the user to reassign
      // customers first — pass it through untouched.
      toast({ title: 'Failed to delete', description: err.message, variant: 'error' });
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    try {
      await updateSubAgent.mutateAsync({
        agent_id: editTarget.id,
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        nric: editForm.nric,
        agent_code: editForm.agent_code,
        tier_id: editForm.tier_id || null,
        status: editForm.status,
        ...(isRoot ? { is_unit_manager: editForm.is_unit_manager } : {}),
        ...(editForm.password ? { password: editForm.password } : {}),
      });
      toast({ title: 'Agent updated' });
      setEditTarget(null);
    } catch (err: any) {
      toast({ title: 'Failed to update agent', description: err.message, variant: 'error' });
    }
  };

  const handleFooterFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after an error
    if (!file || !unitRootId) return;

    const allowedTypes = ['image/png', 'image/jpeg'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PNG or JPEG image.',
        variant: 'error',
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Image must be under 2MB.',
        variant: 'error',
      });
      return;
    }

    setIsUploadingFooter(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `form-images/unit-${unitRootId}-footer-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('company-assets')
        .upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('company-assets').getPublicUrl(fileName);
      await setUnitFooter.mutateAsync(urlData.publicUrl);
      toast({ title: 'Footer image updated' });
    } catch (err: any) {
      toast({ title: 'Failed to upload footer image', description: err.message, variant: 'error' });
    } finally {
      setIsUploadingFooter(false);
    }
  };

  const handleRemoveFooter = async () => {
    try {
      await setUnitFooter.mutateAsync('');
      toast({ title: 'Footer image removed' });
    } catch (err: any) {
      toast({ title: 'Failed to remove footer image', description: err.message, variant: 'error' });
    }
  };

  const openTierDialog = (agentId: string) => {
    setTierTargetId(agentId);
    setSelectedTierId('');
    setIsTierOpen(true);
  };

  const renderTierStatus = (agentRow: { id: string; tier: any | null }) => {
    if (agentRow.tier) {
      const pendingChange = getTierRequestForAgent(agentRow.id);
      if (pendingChange) {
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">{agentRow.tier.name}</span>
            <Badge variant="warning" className="text-xs">Change Pending</Badge>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm">{agentRow.tier.name}</span>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-6 px-2" onClick={() => openTierDialog(agentRow.id)}>
            Change
          </Button>
        </div>
      );
    }

    const pendingReq = getTierRequestForAgent(agentRow.id);
    if (pendingReq) {
      return <Badge variant="warning">Pending Approval</Badge>;
    }

    const rejectedReq = getLastRejectedRequest(agentRow.id);
    if (rejectedReq) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="error">Rejected</Badge>
          <Button variant="ghost" size="sm" onClick={() => openTierDialog(agentRow.id)}>
            Retry
          </Button>
        </div>
      );
    }

    return (
      <Button variant="outline" size="sm" onClick={() => openTierDialog(agentRow.id)}>
        <Tag className="size-3.5 mr-1" />
        Request Tier
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* Auto Invite Setting */}
      <Card className="mb-6">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Mail className="size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Auto Invite</p>
              <p className="text-xs text-muted-foreground">
                Automatically send invitation cards via email when invitations are created
              </p>
            </div>
          </div>
          <Switch
            checked={agent?.is_auto_invite ?? true}
            onCheckedChange={handleToggleAutoInvite}
            disabled={isUpdatingAutoInvite}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Agents</h1>
          <p className="text-sm text-muted-foreground">Manage your unit's agents and tier assignments</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}>
          <UserPlus className="size-4 mr-1.5" />
          Add Agent
        </Button>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Total Agents"
          value={totalCount}
          icon={Users}
          iconColor="sky"
          description="Including yourself"
          loading={isLoading}
        />
        <StatCard
          title="Active Agents"
          value={activeCount + 1}
          icon={UserCheck}
          iconColor="emerald"
          description="Currently active"
          loading={isLoading}
        />
        <StatCard
          title="Pending Tier Requests"
          value={pendingRequests}
          icon={Clock}
          iconColor="amber"
          description="Awaiting admin approval"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader>
          <CardTitle>All Agents</CardTitle>
          <CardDescription>{totalCount} agents in your unit</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={8} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Agent Code</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Agent Admin's own row (first, read-only) */}
                  {agent && (
                    <TableRow className="bg-muted/30">
                      <TableCell className="font-medium">
                        {agent.name}
                        <Badge variant="outline" className="ml-2 text-xs">You</Badge>
                        {isRoot ? (
                          <Badge variant="info" size="sm" className="ml-2">Unit Manager</Badge>
                        ) : agent.is_unit_manager ? (
                          <Badge variant="info" size="sm" className="ml-2">Unit Admin</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{agent.agent_code}</TableCell>
                      <TableCell className="text-muted-foreground">{agent.email}</TableCell>
                      <TableCell className="text-muted-foreground">{agent.phone}</TableCell>
                      <TableCell>{renderTierStatus({ id: agent.id, tier: agent.tier })}</TableCell>
                      <TableCell>
                        <Badge variant="success">{agent.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        —
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Sub-agent rows (own row excluded — rendered above) */}
                  {rosterAgents?.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">
                        <Link
                          to="/my-agents/$agentId/enquiries"
                          params={{ agentId: a.id }}
                          className="hover:underline"
                        >
                          {a.name}
                        </Link>
                        {a.is_unit_manager && (
                          <Badge variant="info" size="sm" className="ml-2">Unit Admin</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{a.agent_code}</TableCell>
                      <TableCell className="text-muted-foreground">{a.email}</TableCell>
                      <TableCell className="text-muted-foreground">{a.phone}</TableCell>
                      <TableCell>{renderTierStatus({ id: a.id, tier: a.tier })}</TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'active' ? 'success' : 'inactive'}>
                          {a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage(a) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(a)}
                          >
                            <Pencil className="size-4 mr-1" />
                            Edit
                          </Button>
                        )}
                        {canManage(a) && a.status === 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeactivateId(a.id)}
                          >
                            <Trash2 className="size-4 mr-1" />
                            Delete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rosterAgents?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        No sub-agents yet. Click "Add Agent" to get started.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enquiry Form Footer (round 6, item 6) — unit-wide, unit viewers only */}
      {isUnitViewer && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="size-5 text-muted-foreground" />
              Enquiry Form Footer
            </CardTitle>
            <CardDescription>
              Recommended 1600×200 (8:1). Overrides the RACC footer on your unit's enquiry
              forms; a partner-specific footer still wins.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {footerImageUrl ? (
              <div className="flex items-center gap-3">
                <img
                  src={footerImageUrl}
                  alt="Unit enquiry form footer"
                  className="h-16 max-w-full rounded border object-contain bg-muted/30"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemoveFooter}
                  disabled={setUnitFooter.isPending}
                >
                  <X className="size-4 mr-1.5" />
                  Remove
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No footer image set.</p>
            )}
            <input
              ref={footerFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFooterFileSelected}
            />
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={isUploadingFooter}
              onClick={() => footerFileInputRef.current?.click()}
            >
              {isUploadingFooter ? 'Uploading...' : footerImageUrl ? 'Replace Image' : 'Upload Image'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add Agent Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Agent</DialogTitle>
            <DialogDescription>
              Create a new agent account in your unit. They will use these credentials to log in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-email">Email</Label>
              <Input
                id="agent-email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-phone">Phone</Label>
              <Input
                id="agent-phone"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-nric">NRIC (optional)</Label>
              <Input
                id="agent-nric"
                value={form.nric}
                onChange={e => setForm(f => ({ ...f, nric: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-code">Agent Code</Label>
              <Input
                id="agent-code"
                value={form.agent_code}
                onChange={e => setForm(f => ({ ...f, agent_code: e.target.value }))}
                required
                placeholder={agent?.agent_code ? `e.g. ${agent.agent_code}-01` : 'AGT001-01'}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-password">Temporary Password</Label>
              <Input
                id="agent-password"
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                minLength={6}
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createSubAgent.isPending}>
                {createSubAgent.isPending ? 'Creating...' : 'Create Agent'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Agent Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Agent</DialogTitle>
            <DialogDescription>
              Update {editTarget?.name}'s details. Leave the password blank to keep it unchanged.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <Label htmlFor="edit-agent-name">Name</Label>
              <Input
                id="edit-agent-name"
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="edit-agent-email">Email</Label>
              <Input
                id="edit-agent-email"
                type="email"
                value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="edit-agent-phone">Phone</Label>
              <Input
                id="edit-agent-phone"
                value={editForm.phone}
                onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="edit-agent-nric">NRIC (optional)</Label>
              <Input
                id="edit-agent-nric"
                value={editForm.nric}
                onChange={e => setEditForm(f => ({ ...f, nric: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="edit-agent-code">Agent Code</Label>
              <Input
                id="edit-agent-code"
                value={editForm.agent_code}
                onChange={e => setEditForm(f => ({ ...f, agent_code: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Tier</Label>
              <Select
                onValueChange={(value) => setEditForm(f => ({ ...f, tier_id: value === 'none' ? '' : value }))}
                value={editForm.tier_id || 'none'}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select a tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No tier</SelectItem>
                  {tiers?.map((tier) => (
                    <SelectItem key={tier.id} value={tier.id}>
                      {tier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select
                onValueChange={(value) => setEditForm(f => ({ ...f, status: value as 'active' | 'inactive' }))}
                value={editForm.status}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-agent-password">New Password (optional)</Label>
              <Input
                id="edit-agent-password"
                type="password"
                value={editForm.password}
                onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                minLength={6}
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">Leave blank to keep current password.</p>
            </div>
            {isRoot && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="edit-is-unit-manager" className="text-sm font-medium">Unit Admin</Label>
                  <p className="text-xs text-muted-foreground">
                    Deputy with unit-wide view and Unit Agent management
                  </p>
                </div>
                <Switch
                  id="edit-is-unit-manager"
                  checked={editForm.is_unit_manager}
                  onCheckedChange={(checked) => setEditForm(f => ({ ...f, is_unit_manager: checked }))}
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateSubAgent.isPending}>
                {updateSubAgent.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Request Tier Dialog */}
      <Dialog open={isTierOpen} onOpenChange={setIsTierOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request Tier Assignment</DialogTitle>
            <DialogDescription>
              Select a tier to request. An admin will review and approve or reject.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Tier</Label>
              <Select onValueChange={setSelectedTierId} value={selectedTierId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select a tier" />
                </SelectTrigger>
                <SelectContent>
                  {tiers?.map((tier) => (
                    <SelectItem key={tier.id} value={tier.id}>
                      {tier.name} — RM{tier.reward_amount}/attendance
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsTierOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRequestTier}
                disabled={!selectedTierId || requestTier.isPending}
              >
                {requestTier.isPending ? 'Requesting...' : 'Request Tier'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation */}
      <AlertDialog open={!!deactivateId} onOpenChange={(open) => !open && setDeactivateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the agent, any partners they created, and their
              links. Their login is removed so the same email and phone can be reused.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteUnitAgent.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
