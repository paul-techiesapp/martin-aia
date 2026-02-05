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
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agent-system/shared-ui';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { useTiers, useCreateTier, useUpdateTier, useDeleteTier } from '../../hooks/useTiers';
import { RoleType, type Tier } from '@agent-system/shared-types';

export function TierList() {
  const { data: tiers, isLoading, error } = useTiers();
  const createTier = useCreateTier();
  const updateTier = useUpdateTier();
  const deleteTier = useDeleteTier();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<Tier | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    role_type: RoleType.AGENT,
    reward_amount: 0,
    invitation_limit_per_slot: 5,
  });

  const handleOpenDialog = (tier?: Tier) => {
    if (tier) {
      setEditingTier(tier);
      setFormData({
        name: tier.name,
        role_type: tier.role_type,
        reward_amount: tier.reward_amount,
        invitation_limit_per_slot: tier.invitation_limit_per_slot,
      });
    } else {
      setEditingTier(null);
      setFormData({
        name: '',
        role_type: RoleType.AGENT,
        reward_amount: 0,
        invitation_limit_per_slot: 5,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editingTier) {
        await updateTier.mutateAsync({ id: editingTier.id, ...formData });
      } else {
        await createTier.mutateAsync(formData);
      }
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Failed to save tier:', error);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this tier?')) {
      deleteTier.mutate(id);
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-destructive">Error loading tiers: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tiers</h1>
          <p className="text-muted-foreground">Configure reward tiers and invitation limits</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              New Tier
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTier ? 'Edit Tier' : 'Create Tier'}</DialogTitle>
              <DialogDescription>
                Configure the tier settings
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Tier Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Gold Agent"
                />
              </div>
              <div>
                <Label>Role Type</Label>
                <Select
                  value={formData.role_type}
                  onValueChange={(v) => setFormData({ ...formData, role_type: v as RoleType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={RoleType.AGENT}>Agent</SelectItem>
                    <SelectItem value={RoleType.BUSINESS_PARTNER}>Business Partner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reward Amount ($)</Label>
                <Input
                  type="number"
                  value={formData.reward_amount}
                  onChange={(e) => setFormData({ ...formData, reward_amount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label>Invitation Limit per Slot</Label>
                <Input
                  type="number"
                  value={formData.invitation_limit_per_slot}
                  onChange={(e) => setFormData({ ...formData, invitation_limit_per_slot: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={createTier.isPending || updateTier.isPending}>
                {createTier.isPending || updateTier.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Tiers</CardTitle>
          <CardDescription>
            {tiers?.length ?? 0} configured tiers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading tiers...</p>
          ) : tiers?.length === 0 ? (
            <p className="text-muted-foreground">No tiers configured yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role Type</TableHead>
                  <TableHead>Reward Amount</TableHead>
                  <TableHead>Invitation Limit</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers?.map((tier) => (
                  <TableRow key={tier.id}>
                    <TableCell className="font-medium">{tier.name}</TableCell>
                    <TableCell className="capitalize">{tier.role_type.replace('_', ' ')}</TableCell>
                    <TableCell>${tier.reward_amount.toFixed(2)}</TableCell>
                    <TableCell>{tier.invitation_limit_per_slot} per slot</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(tier)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(tier.id)}
                          disabled={deleteTier.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
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
