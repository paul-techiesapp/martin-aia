import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
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
  useToast,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, Check } from 'lucide-react';
import {
  useMerchants,
  useCreateMerchant,
  useUpdateMerchant,
  useDeleteMerchant,
  useApproveMerchant,
  type MerchantWithCreator,
} from '../../hooks/useMerchants';
import { MerchantStatus, type Merchant } from '@agent-system/shared-types';
import { useSystemSettings } from '../../hooks/useSystemSettings';

const statusVariant = (status: MerchantStatus) =>
  status === MerchantStatus.PENDING
    ? 'warning'
    : status === MerchantStatus.ACTIVE
    ? 'active'
    : 'inactive';

export function MerchantList() {
  const { data: merchants, isLoading, error } = useMerchants();
  const { data: settings } = useSystemSettings();
  const giftRate = settings?.customer_gift_rate_pct ?? 10;
  const createMerchant = useCreateMerchant();
  const updateMerchant = useUpdateMerchant();
  const deleteMerchant = useDeleteMerchant();
  const approveMerchant = useApproveMerchant();
  const { toast } = useToast();

  const handleApprove = async (id: string) => {
    try {
      await approveMerchant.mutateAsync(id);
      toast({ title: 'Partnership approved', description: 'The merchant is now active.' });
    } catch (err: any) {
      toast({ title: 'Approve failed', description: err.message, variant: 'error' });
    }
  };

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    logo_url: '',
  });

  const handleOpenDialog = (merchant?: Merchant) => {
    if (merchant) {
      setEditing(merchant);
      setFormData({
        name: merchant.name,
        logo_url: merchant.logo_url ?? '',
      });
    } else {
      setEditing(null);
      setFormData({ name: '', logo_url: '' });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      logo_url: formData.logo_url.trim() === '' ? null : formData.logo_url.trim(),
    };
    try {
      if (editing) {
        await updateMerchant.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createMerchant.mutateAsync(payload);
      }
      setIsDialogOpen(false);
    } catch (err) {
      console.error('Failed to save merchant:', err);
    }
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMerchant.mutate(deleteId);
      setDeleteId(null);
    }
  };

  // Round 10 item 1: masters in one section, unit-proposed partnerships
  // grouped per unit. Agent deletes are true deletes here, so a unit-proposed
  // partnership can lose its creator — those fall back to the House bucket
  // rather than vanishing from the page.
  const grouped = useMemo(() => {
    const list = merchants ?? [];
    const masters = list.filter((m) => m.is_master);
    const house = list.filter((m) => !m.is_master && !m.created_by);
    const byUnit = new Map<string, MerchantWithCreator[]>();
    for (const m of list) {
      if (m.is_master || !m.created_by) continue;
      const unit = m.created_by.unit_name || m.created_by.name;
      const bucket = byUnit.get(unit);
      if (bucket) bucket.push(m);
      else byUnit.set(unit, [m]);
    }
    const units = Array.from(byUnit.entries()).sort(([a], [b]) => a.localeCompare(b));
    return { masters, house, units };
  }, [merchants]);

  // Shared table for every section. The Unit column answers "which unit
  // uploaded this partnership request" (Round 10 item 2) — masters proposed
  // by an agent show their unit too.
  const merchantSection = (title: string, description: string, rows: MerchantWithCreator[]) => {
    if (rows.length === 0) return null;
    return (
      <Card key={title}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {rows.length} {rows.length === 1 ? 'merchant' : 'merchants'} · {description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((merchant) => (
                  <TableRow key={merchant.id}>
                    <TableCell className="font-medium">
                      <Link to="/merchants/$merchantId" params={{ merchantId: merchant.id }} className="hover:underline">
                        {merchant.name}
                      </Link>
                      {merchant.is_master && <Badge className="ml-2">Master</Badge>}
                    </TableCell>
                    <TableCell>
                      {merchant.created_by ? (
                        <div>
                          <div className="text-sm font-medium">{merchant.created_by.unit_name}</div>
                          <div className="text-xs text-muted-foreground">{merchant.created_by.name}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(merchant.status)} className="capitalize">
                        {merchant.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {merchant.status === MerchantStatus.PENDING && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleApprove(merchant.id)}
                            disabled={approveMerchant.isPending}
                            aria-label="Approve merchant"
                          >
                            <Check className="size-4 mr-1 text-emerald-600" />
                            Approve
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(merchant)} aria-label="Edit merchant">
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(merchant.id)}
                          disabled={deleteMerchant.isPending}
                          aria-label="Delete merchant"
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
        </CardContent>
      </Card>
    );
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading merchants: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Partnerships</h1>
          <p className="text-sm text-muted-foreground">
            Gift-partner merchants. Customers receive a gold gift worth {giftRate}% of their car-insurance renewal.
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="size-4 mr-1.5" />
              New Partnership
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Partnership' : 'Create Partnership'}</DialogTitle>
              <DialogDescription>
                Customers who renew their car insurance receive a gold gift worth {giftRate}% of the renewal
                premium. The gift rate is configured in Settings.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Merchant Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Poh Kong"
                />
              </div>
              <div>
                <Label>Logo URL (optional)</Label>
                <Input
                  value={formData.logo_url}
                  onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMerchant.isPending || updateMerchant.isPending}>
                {createMerchant.isPending || updateMerchant.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle>All Partnerships</CardTitle>
          </CardHeader>
          <CardContent>
            <TableSkeleton rows={5} columns={4} />
          </CardContent>
        </Card>
      ) : merchants?.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">No partnerships yet. Create your first merchant.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {merchantSection(
            'Master Partners',
            "Appear in every agent's Assign-partner list.",
            grouped.masters,
          )}
          {grouped.units.map(([unit, rows]) =>
            merchantSection(`Unit Partnership — ${unit}`, `Proposed by agents in ${unit}.`, rows),
          )}
          {merchantSection(
            'House Partnerships',
            'Created by admin (not tied to a unit).',
            grouped.house,
          )}
        </>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Partnership</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting a merchant also deletes its branches and links. This cannot be undone.
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
