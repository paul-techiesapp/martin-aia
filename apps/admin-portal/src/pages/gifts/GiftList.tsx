import { useMemo, useState } from 'react';
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
  Badge,
  StatCard,
  StatCardGrid,
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
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
import { Gift, Ticket, CheckCircle2 } from 'lucide-react';
import { GiftStatus } from '@agent-system/shared-types';
import { useGifts, useMarkGiftRedeemed, type AdminGiftRow } from '../../hooks/useGifts';

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

function giftBadge(status: GiftStatus): { label: string; variant: 'warning' | 'success' | 'error' | 'neutral' } {
  switch (status) {
    case GiftStatus.REDEEMED:
      return { label: 'Redeemed', variant: 'success' };
    case GiftStatus.EXPIRED:
      return { label: 'Expired', variant: 'error' };
    case GiftStatus.VOID:
      return { label: 'Void', variant: 'neutral' };
    default:
      return { label: 'Issued', variant: 'warning' };
  }
}

export function GiftList() {
  const { toast } = useToast();
  const { data: gifts, isLoading } = useGifts();
  const markRedeemed = useMarkGiftRedeemed();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [redeemTarget, setRedeemTarget] = useState<AdminGiftRow | null>(null);

  const filtered = useMemo(
    () => (gifts ?? []).filter((g) => statusFilter === 'all' || g.status === statusFilter),
    [gifts, statusFilter]
  );

  const summary = useMemo(() => {
    const all = gifts ?? [];
    const sum = (rows: AdminGiftRow[]) => rows.reduce((s, g) => s + (Number(g.value_amount) || 0), 0);
    const issued = all.filter((g) => g.status === GiftStatus.ISSUED);
    const redeemed = all.filter((g) => g.status === GiftStatus.REDEEMED);
    return {
      totalAmount: sum(all),
      issuedAmount: sum(issued),
      issuedCount: issued.length,
      redeemedCount: redeemed.length,
    };
  }, [gifts]);

  const confirmRedeem = async () => {
    if (!redeemTarget) return;
    try {
      await markRedeemed.mutateAsync(redeemTarget.id);
      toast({ title: 'Voucher marked redeemed' });
    } catch (err: any) {
      toast({ title: 'Failed to redeem voucher', description: err.message, variant: 'error' });
    }
    setRedeemTarget(null);
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gifts</h1>
        <p className="text-sm text-muted-foreground">
          Customer gold-gift vouchers. Each is created automatically when a vehicle renewal is confirmed; mark it
          redeemed once the customer claims it at the branch.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Total Gifts"
          value={`RM${summary.totalAmount.toFixed(2)}`}
          subtitle={`${gifts?.length ?? 0} voucher${(gifts?.length ?? 0) === 1 ? '' : 's'}`}
          icon={Gift}
          iconColor="text-emerald-600"
          iconBgColor="bg-emerald-100"
          loading={isLoading}
        />
        <StatCard
          title="Issued (unredeemed)"
          value={`RM${summary.issuedAmount.toFixed(2)}`}
          subtitle={`${summary.issuedCount} outstanding`}
          icon={Ticket}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={isLoading}
        />
        <StatCard
          title="Redeemed"
          value={summary.redeemedCount}
          subtitle="Claimed at branch"
          icon={CheckCircle2}
          iconColor="text-sky-600"
          iconBgColor="bg-sky-100"
          loading={isLoading}
        />
        <StatCard
          title="Total Count"
          value={gifts?.length ?? 0}
          subtitle="All vouchers"
          icon={Gift}
          iconColor="text-indigo-600"
          iconBgColor="bg-indigo-100"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Vouchers</CardTitle>
            <CardDescription>Look up a voucher code and mark it redeemed.</CardDescription>
          </div>
          <div className="w-full sm:w-40">
            <Label className="text-sm font-medium">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value={GiftStatus.ISSUED}>Issued</SelectItem>
                <SelectItem value={GiftStatus.REDEEMED}>Redeemed</SelectItem>
                <SelectItem value={GiftStatus.EXPIRED}>Expired</SelectItem>
                <SelectItem value={GiftStatus.VOID}>Void</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={6} columns={6} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Voucher Code</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Merchant / Car</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        No vouchers match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((g) => {
                      const badge = giftBadge(g.status);
                      return (
                        <TableRow key={g.id}>
                          <TableCell className="font-mono font-medium">{g.voucher_code}</TableCell>
                          <TableCell>
                            <div className="text-sm text-foreground">{g.vehicle?.enquiry?.customer_name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{g.vehicle?.enquiry?.customer_phone ?? ''}</div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {g.merchant?.name ?? '—'}
                            <div className="text-xs">{g.vehicle?.car_plate ?? ''}</div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600">
                            RM{Number(g.value_amount).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            {g.status === GiftStatus.REDEEMED && g.redeemed_at && (
                              <div className="text-xs text-muted-foreground mt-1">{fmtDateTime(g.redeemed_at)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {g.status === GiftStatus.ISSUED && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                disabled={markRedeemed.isPending}
                                onClick={() => setRedeemTarget(g)}
                              >
                                <CheckCircle2 className="size-4 mr-1" />
                                Redeem
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!redeemTarget} onOpenChange={(open) => !open && setRedeemTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Voucher Redeemed</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm the customer has claimed voucher <span className="font-mono">{redeemTarget?.voucher_code}</span>{' '}
              (RM{Number(redeemTarget?.value_amount ?? 0).toFixed(2)}). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRedeem} className="bg-emerald-600 hover:bg-emerald-700">
              Mark Redeemed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
