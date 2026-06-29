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
import { Plus, Pencil, Trash2, Check, ArrowLeft } from 'lucide-react';
import { useMerchant } from '../../hooks/useMerchants';
import {
  useMerchantBranches,
  useCreateMerchantBranch,
  useUpdateMerchantBranch,
  useDeleteMerchantBranch,
  useApproveMerchantBranch,
} from '../../hooks/useMerchantBranches';
import { MerchantStatus, type MerchantBranch } from '@agent-system/shared-types';

export function MerchantDetail() {
  const { merchantId } = useParams({ strict: false }) as { merchantId: string };
  const { data: merchant } = useMerchant(merchantId);
  const { data: branches, isLoading, error } = useMerchantBranches(merchantId);
  const createBranch = useCreateMerchantBranch();
  const updateBranch = useUpdateMerchantBranch();
  const deleteBranch = useDeleteMerchantBranch(merchantId);
  const approveBranch = useApproveMerchantBranch(merchantId);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantBranch | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
            Gift pool: <span className="text-foreground">RM{merchant?.gift_pool_amount?.toFixed(2) ?? '0.00'}</span>
          </div>
          <div>
            Split:{' '}
            <span className="text-foreground">
              {merchant?.merchant_share_pct ?? 0}% merchant / {100 - (merchant?.merchant_share_pct ?? 0)}% customer
            </span>
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

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the branch. This cannot be undone.
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
