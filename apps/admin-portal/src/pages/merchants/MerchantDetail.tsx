import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
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
  DialogTrigger,
  Input,
  Label,
  Badge,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, Check, ArrowLeft, QrCode, Copy, Link2, Power } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useMerchant } from '../../hooks/useMerchants';
import {
  useMerchantBranches,
  useCreateMerchantBranch,
  useUpdateMerchantBranch,
  useDeleteMerchantBranch,
  useApproveMerchantBranch,
} from '../../hooks/useMerchantBranches';
import {
  useBranchLinks,
  useCreateBranchLink,
  useDeactivateBranchLink,
} from '../../hooks/useBranchLinks';
import { useAllAgents } from '../../hooks/useAllAgents';
import { useSystemSettings } from '../../hooks/useSystemSettings';
import { MerchantStatus, type MerchantBranch } from '@agent-system/shared-types';

const publicBaseUrl = () => import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
const enquiryUrl = (code: string) => `${publicBaseUrl()}/public/enquiry/${code}`;

const HOUSE_VALUE = '__house__';

function BranchLinksDialog({
  branch,
  open,
  onOpenChange,
}: {
  branch: MerchantBranch;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: links, isLoading } = useBranchLinks(branch.id);
  const createLink = useCreateBranchLink();
  const deactivateLink = useDeactivateBranchLink(branch.id);
  const { data: agents } = useAllAgents();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(HOUSE_VALUE);

  const handleGenerate = async () => {
    const agentId = selectedAgentId === HOUSE_VALUE ? null : selectedAgentId;
    try {
      await createLink.mutateAsync({ branchId: branch.id, agentId });
      const label = agentId
        ? (agents?.find((a) => a.id === agentId)?.name ?? 'agent')
        : 'house';
      toast({ title: 'Link created', description: `QR link tied to ${label} created.` });
    } catch (err: any) {
      toast({ title: 'Failed to create link', description: err.message, variant: 'error' });
    }
  };

  const handleCopy = async (code: string, id: string) => {
    await navigator.clipboard.writeText(enquiryUrl(code));
    setCopiedId(id);
    toast({ title: 'Link copied!', description: 'Customer enquiry link copied to clipboard.' });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const agentName = (agentId: string | null) =>
    agentId ? (agents?.find((a) => a.id === agentId)?.name ?? agentId) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Branch Links — {branch.name}</DialogTitle>
          <DialogDescription>
            Generate QR codes for the customer enquiry form. Optionally tie to an agent for commission tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Tie to agent (optional)</Label>
            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="House — no agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={HOUSE_VALUE}>House — no agent</SelectItem>
                {agents?.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name} ({agent.agent_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleGenerate} disabled={createLink.isPending}>
              <Link2 className="size-4 mr-1.5" />
              {createLink.isPending ? 'Generating...' : 'Generate link'}
            </Button>
          </div>
        </div>

        <div className="space-y-3 max-h-[50vh] overflow-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading links...</p>
          ) : (links?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No links yet. Generate the first link above.</p>
          ) : (
            links?.map((link) => {
              const tied = agentName(link.agent_id);
              return (
                <div key={link.id} className="flex items-center gap-3 rounded-md border p-3">
                  <div className="shrink-0 rounded bg-white p-1">
                    <QRCodeSVG value={enquiryUrl(link.link_code)} size={88} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={link.is_active ? 'active' : 'inactive'}>
                        {link.is_active ? 'active' : 'inactive'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {tied ? `Agent: ${tied}` : 'House'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={enquiryUrl(link.link_code)}>
                      {enquiryUrl(link.link_code)}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleCopy(link.link_code, link.id)}>
                        {copiedId === link.id ? (
                          <>
                            <Check className="size-4 mr-1 text-emerald-600" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="size-4 mr-1" /> Copy URL
                          </>
                        )}
                      </Button>
                      {link.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deactivateLink.mutate(link.id)}
                          disabled={deactivateLink.isPending}
                        >
                          <Power className="size-4 mr-1 text-destructive" /> Deactivate
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MerchantDetail() {
  const { merchantId } = useParams({ strict: false }) as { merchantId: string };
  const { data: merchant } = useMerchant(merchantId);
  const { data: settings } = useSystemSettings();
  const { data: branches, isLoading, error } = useMerchantBranches(merchantId);
  const createBranch = useCreateMerchantBranch();
  const updateBranch = useUpdateMerchantBranch();
  const deleteBranch = useDeleteMerchantBranch(merchantId);
  const approveBranch = useApproveMerchantBranch(merchantId);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantBranch | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [linksBranch, setLinksBranch] = useState<MerchantBranch | null>(null);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '' });

  const handleOpenDialog = (branch?: MerchantBranch) => {
    if (branch) {
      setEditing(branch);
      setFormData({ name: branch.name, address: branch.address ?? '', phone: branch.phone ?? '' });
    } else {
      setEditing(null);
      setFormData({ name: '', address: '', phone: '' });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      address: formData.address.trim() === '' ? null : formData.address.trim(),
      phone: formData.phone.trim() === '' ? null : formData.phone.trim(),
    };
    try {
      if (editing) {
        await updateBranch.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createBranch.mutateAsync({ merchant_id: merchantId, ...payload });
      }
      setIsDialogOpen(false);
    } catch (err) {
      console.error('Failed to save branch:', err);
    }
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteBranch.mutate(deleteId);
      setDeleteId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link to="/merchants" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 mr-1" />
          Back to Partnerships
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{merchant?.name ?? 'Partnership'}</h1>
        <p className="text-sm text-muted-foreground capitalize">{merchant?.status}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Partnership Details</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div>
            Customer gift:{' '}
            <span className="text-foreground">
              {settings?.customer_gift_rate_pct ?? 10}% of the car-insurance renewal premium
            </span>
          </div>
          <div className="text-xs">
            The gift value (and the merchant payable) is calculated from each renewal premium at confirmation.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Branches</CardTitle>
            <CardDescription>{branches?.length ?? 0} branches</CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="size-4 mr-1.5" />
                New Branch
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Branch' : 'Create Branch'}</DialogTitle>
                <DialogDescription>An outlet where customers can be referred.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Branch Name</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Poh Kong — Sunway Pyramid"
                  />
                </div>
                <div>
                  <Label>Address (optional)</Label>
                  <Input
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Phone (optional)</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={createBranch.isPending || updateBranch.isPending}>
                  {createBranch.isPending || updateBranch.isPending ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-destructive text-sm">Error loading branches: {error.message}</p>
          ) : isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : branches?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No branches yet. Add the first outlet.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches?.map((branch) => (
                    <TableRow key={branch.id}>
                      <TableCell className="font-medium">{branch.name}</TableCell>
                      <TableCell className="text-muted-foreground">{branch.phone ?? '—'}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{branch.status}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLinksBranch(branch)}
                            aria-label="Manage branch QR links"
                          >
                            <QrCode className="size-4" />
                          </Button>
                          {branch.status === MerchantStatus.PENDING && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => approveBranch.mutate(branch.id)}
                              disabled={approveBranch.isPending}
                              aria-label="Approve branch"
                            >
                              <Check className="size-4 text-emerald-600" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(branch)} aria-label="Edit branch">
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteId(branch.id)}
                            disabled={deleteBranch.isPending}
                            aria-label="Delete branch"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {linksBranch && (
        <BranchLinksDialog
          branch={linksBranch}
          open={!!linksBranch}
          onOpenChange={(o) => !o && setLinksBranch(null)}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting a branch also deletes its links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
