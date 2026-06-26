import { useState } from 'react';
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
} from '../../hooks/useMerchants';
import { MerchantStatus, type Merchant } from '@agent-system/shared-types';

export function MerchantList() {
  const { data: merchants, isLoading, error } = useMerchants();
  const createMerchant = useCreateMerchant();
  const updateMerchant = useUpdateMerchant();
  const deleteMerchant = useDeleteMerchant();
  const approveMerchant = useApproveMerchant();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    logo_url: '',
    gift_pool_amount: 0,
    merchant_share_pct: 0,
  });

  const handleOpenDialog = (merchant?: Merchant) => {
    if (merchant) {
      setEditing(merchant);
      setFormData({
        name: merchant.name,
        logo_url: merchant.logo_url ?? '',
        gift_pool_amount: merchant.gift_pool_amount,
        merchant_share_pct: merchant.merchant_share_pct,
      });
    } else {
      setEditing(null);
      setFormData({ name: '', logo_url: '', gift_pool_amount: 0, merchant_share_pct: 0 });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      logo_url: formData.logo_url.trim() === '' ? null : formData.logo_url.trim(),
      gift_pool_amount: formData.gift_pool_amount,
      merchant_share_pct: formData.merchant_share_pct,
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
          <p className="text-sm text-muted-foreground">Gift-partner merchants and their gold-gift split</p>
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
                Set the fixed gift pool and the merchant share. The customer gift is the remainder.
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
              <div>
                <Label>Gift Pool Amount (RM)</Label>
                <Input
                  type="number"
                  value={formData.gift_pool_amount}
                  onChange={(e) =>
                    setFormData({ ...formData, gift_pool_amount: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <Label>Merchant Share (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={formData.merchant_share_pct}
                  onChange={(e) =>
                    setFormData({ ...formData, merchant_share_pct: parseFloat(e.target.value) || 0 })
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Customer gift share: {Math.max(0, 100 - formData.merchant_share_pct)}% (RM
                  {((formData.gift_pool_amount * Math.max(0, 100 - formData.merchant_share_pct)) / 100).toFixed(2)})
                </p>
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

      <Card>
        <CardHeader>
          <CardTitle>All Partnerships</CardTitle>
          <CardDescription>{merchants?.length ?? 0} merchants</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : merchants?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No partnerships yet. Create your first merchant.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Pool (RM)</TableHead>
                    <TableHead className="text-right">Merchant / Customer</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {merchants?.map((merchant) => (
                    <TableRow key={merchant.id}>
                      <TableCell className="font-medium">
                        <Link to="/merchants/$merchantId" params={{ merchantId: merchant.id }} className="hover:underline">
                          {merchant.name}
                        </Link>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">{merchant.status}</TableCell>
                      <TableCell className="text-right">RM{merchant.gift_pool_amount.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {merchant.merchant_share_pct}% / {100 - merchant.merchant_share_pct}%
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {merchant.status === MerchantStatus.PENDING && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => approveMerchant.mutate(merchant.id)}
                              disabled={approveMerchant.isPending}
                              aria-label="Approve merchant"
                            >
                              <Check className="size-4 text-emerald-600" />
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
          )}
        </CardContent>
      </Card>

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
