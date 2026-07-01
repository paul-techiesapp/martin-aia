import { useMemo, useState } from 'react';
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
  Badge,
  Button,
  StatCard,
  StatCardGrid,
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from '@agent-system/shared-ui';
import { Banknote, Clock, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { RewardStatus } from '@agent-system/shared-types';
import {
  useMerchantCommissions,
  useSetMerchantCommissionStatus,
  type AdminCommissionRow,
} from '../../hooks/useMerchantCommissions';

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

/** 'paid' === Issued/Sent. */
function statusDisplay(status: RewardStatus): { label: string; variant: 'pending' | 'paid' | 'error' } {
  switch (status) {
    case RewardStatus.PAID:
      return { label: 'Paid', variant: 'paid' };
    case RewardStatus.FAILED:
      return { label: 'Failed', variant: 'error' };
    default:
      return { label: 'Pending', variant: 'pending' };
  }
}

export function MerchantCommissionList() {
  const { toast } = useToast();
  const { data: rows, isLoading } = useMerchantCommissions();
  const setStatus = useSetMerchantCommissionStatus();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [failTarget, setFailTarget] = useState<AdminCommissionRow | null>(null);
  const [failReason, setFailReason] = useState('');

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => statusFilter === 'all' || r.status === statusFilter),
    [rows, statusFilter]
  );

  const summary = useMemo(() => {
    const all = rows ?? [];
    const sum = (xs: AdminCommissionRow[]) => xs.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const pending = all.filter((r) => r.status !== RewardStatus.PAID && r.status !== RewardStatus.FAILED);
    const paid = all.filter((r) => r.status === RewardStatus.PAID);
    const failed = all.filter((r) => r.status === RewardStatus.FAILED);
    return {
      totalAmount: sum(all),
      pendingAmount: sum(pending),
      pendingCount: pending.length,
      paidAmount: sum(paid),
      paidCount: paid.length,
      failedCount: failed.length,
    };
  }, [rows]);

  const runUpdate = async (id: string, status: RewardStatus, reason?: string) => {
    try {
      await setStatus.mutateAsync({ id, status, reason });
      const verb =
        status === RewardStatus.PAID ? 'marked as paid' : status === RewardStatus.FAILED ? 'marked as failed' : 'reset to pending';
      toast({ title: `Commission ${verb}` });
    } catch (err: any) {
      toast({ title: 'Failed to update commission', description: err.message, variant: 'error' });
    }
  };

  const confirmFail = async () => {
    if (!failTarget) return;
    await runUpdate(failTarget.id, RewardStatus.FAILED, failReason.trim() || undefined);
    setFailTarget(null);
    setFailReason('');
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agent Commissions</h1>
        <p className="text-sm text-muted-foreground">
          Partnership commissions owed to agents. Each is created automatically when an agent-sourced vehicle renewal
          is confirmed.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Total"
          value={`RM${summary.totalAmount.toFixed(2)}`}
          subtitle={`${rows?.length ?? 0} commission${(rows?.length ?? 0) === 1 ? '' : 's'}`}
          icon={Banknote}
          iconColor="text-emerald-600"
          iconBgColor="bg-emerald-100"
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={`RM${summary.pendingAmount.toFixed(2)}`}
          subtitle={`${summary.pendingCount} awaiting payout`}
          icon={Clock}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={isLoading}
        />
        <StatCard
          title="Paid"
          value={`RM${summary.paidAmount.toFixed(2)}`}
          subtitle={`${summary.paidCount} settled`}
          icon={CheckCircle2}
          iconColor="text-sky-600"
          iconBgColor="bg-sky-100"
          loading={isLoading}
        />
        <StatCard
          title="Failed"
          value={summary.failedCount}
          subtitle="Need attention"
          icon={XCircle}
          iconColor="text-red-600"
          iconBgColor="bg-red-100"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Commission Payouts</CardTitle>
            <CardDescription>Mark commissions paid or failed and track when each was settled.</CardDescription>
          </div>
          <div className="w-full sm:w-40">
            <Label className="text-sm font-medium">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value={RewardStatus.PENDING}>Pending</SelectItem>
                <SelectItem value={RewardStatus.PAID}>Paid</SelectItem>
                <SelectItem value={RewardStatus.FAILED}>Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={6} columns={5} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Unit / Agent</TableHead>
                    <TableHead>Customer / Car</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        No commissions match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => {
                      const display = statusDisplay(r.status);
                      const isPaid = r.status === RewardStatus.PAID;
                      const isFailed = r.status === RewardStatus.FAILED;
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="text-sm font-medium text-foreground">{r.agent?.unit_name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{r.agent?.name ?? ''}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-foreground">{r.vehicle?.enquiry?.customer_name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{r.vehicle?.car_plate ?? ''}</div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600">
                            RM{Number(r.amount).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={display.variant}>{display.label}</Badge>
                            {isPaid && r.paid_at && (
                              <div className="text-xs text-muted-foreground mt-1">{fmtDateTime(r.paid_at)}</div>
                            )}
                            {isFailed && r.failure_reason && (
                              <div className="text-xs text-red-600 mt-1" title={r.failure_reason}>{r.failure_reason}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {!isPaid && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                  disabled={setStatus.isPending}
                                  onClick={() => runUpdate(r.id, RewardStatus.PAID)}
                                >
                                  <CheckCircle2 className="size-4 mr-1" />
                                  Pay
                                </Button>
                              )}
                              {!isFailed && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  disabled={setStatus.isPending}
                                  onClick={() => {
                                    setFailTarget(r);
                                    setFailReason('');
                                  }}
                                >
                                  <XCircle className="size-4 mr-1" />
                                  Fail
                                </Button>
                              )}
                              {(isPaid || isFailed) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-foreground"
                                  disabled={setStatus.isPending}
                                  onClick={() => runUpdate(r.id, RewardStatus.PENDING)}
                                >
                                  <RotateCcw className="size-4 mr-1" />
                                  Reset
                                </Button>
                              )}
                            </div>
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

      <Dialog open={!!failTarget} onOpenChange={(open) => !open && setFailTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Commission as Failed</DialogTitle>
            <DialogDescription>
              Record why this commission payout failed (e.g. invalid payout details). Shown to admins on the row.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fail-reason">Reason (optional)</Label>
            <Input
              id="fail-reason"
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              placeholder="e.g. Bank account rejected"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFailTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={confirmFail} disabled={setStatus.isPending}>
              {setStatus.isPending ? 'Saving...' : 'Mark Failed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
