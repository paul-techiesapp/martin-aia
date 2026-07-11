import { useState } from 'react';
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
} from '@agent-system/shared-ui';
import { Users, UserCheck, UserPlus, Trash2, Tag } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  useMyPartners,
  usePartnerClaimCounts,
  useCreatePartner,
  useDeactivatePartner,
} from '../hooks/usePartners';
import { useMyTierRequests, useRequestTier, useAvailableTiers } from '../hooks/useSubAgents';
import { TierRequestStatus } from '@agent-system/shared-types';

export function Partners() {
  const { agent, role, isUnitViewer } = useAuth();
  const { toast } = useToast();

  // Role guard: admin + unit managers (deputy) can access this page
  if (role && !isUnitViewer) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>This page is only available to agents.</p>
      </div>
    );
  }

  const { data: partners, isLoading } = useMyPartners(agent?.id);
  const { data: claimCounts } = usePartnerClaimCounts(agent?.id);
  const { data: tierRequests } = useMyTierRequests(agent?.id);
  const { data: tiers } = useAvailableTiers();
  const createPartner = useCreatePartner();
  const deactivatePartner = useDeactivatePartner();
  const requestTier = useRequestTier();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isTierOpen, setIsTierOpen] = useState(false);
  const [tierTargetId, setTierTargetId] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState('');
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', nric: '', password: '' });

  const activeCount = partners?.filter(p => p.status === 'active').length ?? 0;
  const totalCount = partners?.length ?? 0;

  const getTierRequestForPartner = (partnerId: string) => {
    return tierRequests?.find(r => r.partner_id === partnerId && r.status === TierRequestStatus.PENDING);
  };

  const getLastRejectedRequestForPartner = (partnerId: string) => {
    return tierRequests?.find(r => r.partner_id === partnerId && r.status === TierRequestStatus.REJECTED);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createPartner.mutateAsync({
        name: form.name,
        email: form.email,
        phone: form.phone,
        nric: form.nric || undefined,
        password: form.password,
      });
      toast({ title: 'Partner created', description: `${form.name} can now log in with their email and password.` });
      setIsAddOpen(false);
      setForm({ name: '', email: '', phone: '', nric: '', password: '' });
    } catch (err: any) {
      toast({ title: 'Failed to create partner', description: err.message, variant: 'error' });
    }
  };

  const handleRequestTier = async () => {
    if (!tierTargetId || !selectedTierId) return;
    try {
      await requestTier.mutateAsync({ partner_id: tierTargetId, tier_id: selectedTierId });
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
      await deactivatePartner.mutateAsync(deactivateId);
      toast({ title: 'Partner deleted', description: "The partner was permanently removed and their links released. Their email can now be reused." });
      setDeactivateId(null);
    } catch (err: any) {
      toast({ title: 'Failed to delete', description: err.message, variant: 'error' });
    }
  };

  const openTierDialog = (partnerId: string) => {
    setTierTargetId(partnerId);
    setSelectedTierId('');
    setIsTierOpen(true);
  };

  const renderTierStatus = (p: { id: string; tier: any | null }) => {
    if (p.tier) {
      const pendingChange = getTierRequestForPartner(p.id);
      if (pendingChange) {
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">{p.tier.name}</span>
            <Badge variant="warning" className="text-xs">Change Pending</Badge>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm">{p.tier.name}</span>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-6 px-2" onClick={() => openTierDialog(p.id)}>
            Change
          </Button>
        </div>
      );
    }

    const pendingReq = getTierRequestForPartner(p.id);
    if (pendingReq) {
      return <Badge variant="warning">Pending Approval</Badge>;
    }

    const rejectedReq = getLastRejectedRequestForPartner(p.id);
    if (rejectedReq) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="error">Rejected</Badge>
          <Button variant="ghost" size="sm" onClick={() => openTierDialog(p.id)}>
            Retry
          </Button>
        </div>
      );
    }

    return (
      <Button variant="outline" size="sm" onClick={() => openTierDialog(p.id)}>
        <Tag className="size-3.5 mr-1" />
        Request Tier
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Event Partners</h1>
          <p className="text-sm text-muted-foreground">
            Recruitment partners for events — insurance partnership merchants are managed under Partnership → My Partners
          </p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}>
          <UserPlus className="size-4 mr-1.5" />
          Add Partner
        </Button>
      </div>

      <StatCardGrid columns={2}>
        <StatCard title="Total Partners" value={totalCount} icon={Users} iconColor="sky" description="All time" loading={isLoading} />
        <StatCard title="Active Partners" value={activeCount} icon={UserCheck} iconColor="emerald" description="Currently active" loading={isLoading} />
      </StatCardGrid>

      <Card>
        <CardHeader>
          <CardTitle>All Partners</CardTitle>
          <CardDescription>{totalCount} partners total</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={7} />
          ) : partners?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No partners yet. Click "Add Partner" to get started.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Claimed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners?.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.email}</TableCell>
                    <TableCell className="text-muted-foreground">{p.phone}</TableCell>
                    <TableCell>{renderTierStatus({ id: p.id, tier: p.tier })}</TableCell>
                    <TableCell className="text-muted-foreground">{claimCounts?.[p.id] ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'active' ? 'success' : 'inactive'}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === 'active' && (
                        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDeactivateId(p.id)}>
                          <Trash2 className="size-4 mr-1" />
                          Delete
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Partner Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Partner</DialogTitle>
            <DialogDescription>Create a new partner account. They will use these credentials to log in.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <Label htmlFor="partner-name">Name</Label>
              <Input id="partner-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="partner-email">Email</Label>
              <Input id="partner-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="partner-phone">Phone</Label>
              <Input id="partner-phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="partner-nric">NRIC (optional)</Label>
              <Input id="partner-nric" value={form.nric} onChange={e => setForm(f => ({ ...f, nric: e.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="partner-password">Temporary Password</Label>
              <Input id="partner-password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={6} className="mt-1.5" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createPartner.isPending}>{createPartner.isPending ? 'Creating...' : 'Create Partner'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Request Tier Dialog */}
      <Dialog open={isTierOpen} onOpenChange={setIsTierOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request Tier Assignment</DialogTitle>
            <DialogDescription>Select a tier to request for this partner. An admin will review and approve or reject.</DialogDescription>
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
              <Button type="button" variant="outline" onClick={() => setIsTierOpen(false)}>Cancel</Button>
              <Button onClick={handleRequestTier} disabled={!selectedTierId || requestTier.isPending}>
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
            <AlertDialogTitle>Delete Partner?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes the partner and releases their links and claims. Their login is removed so the same email can be reused. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className="bg-red-600 hover:bg-red-700">
              {deactivatePartner.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
