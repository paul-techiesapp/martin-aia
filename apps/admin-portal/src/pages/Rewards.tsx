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
import { Banknote, Clock, CheckCircle2, XCircle, RotateCcw, Download } from 'lucide-react';
import { RewardStatus } from '@agent-system/shared-types';
import { useCampaigns } from '../hooks/useCampaigns';
import { useRewards, useSetRewardStatus, type AdminRewardRow } from '../hooks/useRewards';

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Display label + badge variant for a reward status. 'paid' === Issued/Sent. */
function rewardDisplay(status: RewardStatus): { label: string; variant: 'pending' | 'paid' | 'error' } {
  switch (status) {
    case RewardStatus.PAID:
      return { label: 'Issued', variant: 'paid' };
    case RewardStatus.FAILED:
      return { label: 'Failed', variant: 'error' };
    default:
      return { label: 'Pending', variant: 'pending' };
  }
}

export function Rewards() {
  const { toast } = useToast();
  const { data: campaigns } = useCampaigns();
  const { data: rewards, isLoading } = useRewards();
  const setStatus = useSetRewardStatus();

  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Failure-reason dialog
  const [failTarget, setFailTarget] = useState<AdminRewardRow | null>(null);
  const [failReason, setFailReason] = useState('');

  const filtered = useMemo(() => {
    return (rewards ?? []).filter((r) => {
      const campaignId = r.attendance?.registration?.slot?.campaign?.id;
      const matchesCampaign = campaignFilter === 'all' || campaignId === campaignFilter;
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      return matchesCampaign && matchesStatus;
    });
  }, [rewards, campaignFilter, statusFilter]);

  const summary = useMemo(() => {
    const all = rewards ?? [];
    const sum = (rows: AdminRewardRow[]) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const pending = all.filter((r) => r.status !== RewardStatus.PAID && r.status !== RewardStatus.FAILED);
    const issued = all.filter((r) => r.status === RewardStatus.PAID);
    const failed = all.filter((r) => r.status === RewardStatus.FAILED);
    return {
      totalAmount: sum(all),
      pendingAmount: sum(pending),
      pendingCount: pending.length,
      issuedAmount: sum(issued),
      issuedCount: issued.length,
      failedCount: failed.length,
    };
  }, [rewards]);

  const runUpdate = async (id: string, status: RewardStatus, reason?: string) => {
    try {
      await setStatus.mutateAsync({ id, status, reason });
      const verb =
        status === RewardStatus.PAID ? 'marked as issued' : status === RewardStatus.FAILED ? 'marked as failed' : 'reset to pending';
      toast({ title: `Reward ${verb}` });
    } catch (err: any) {
      toast({ title: 'Failed to update reward', description: err.message, variant: 'error' });
    }
  };

  const confirmFail = async () => {
    if (!failTarget) return;
    await runUpdate(failTarget.id, RewardStatus.FAILED, failReason.trim() || undefined);
    setFailTarget(null);
    setFailReason('');
  };

  const handleExport = () => {
    const rows = [
      ['Event', 'Unit', 'Agent', 'Registrant', 'Phone', 'NRIC', 'Amount (RM)', 'Status', 'Issued At', 'Failure Reason'],
      ...filtered.map((r) => {
        const reg = r.attendance?.registration;
        return [
          reg?.slot?.campaign?.name ?? '',
          r.agent?.unit_name ?? '',
          r.agent?.name ?? '',
          reg?.invitee_name ?? '',
          reg?.invitee_phone ?? '',
          reg?.invitee_nric ?? '',
          Number(r.amount).toFixed(2),
          rewardDisplay(r.status).label,
          r.issued_at ? fmtDateTime(r.issued_at) : '',
          r.failure_reason ?? '',
        ];
      }),
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    // Prepend a UTF-8 BOM so Excel detects the encoding — without it, Excel reads
    // the file as Windows-1252 and turns "—" and accented/CJK characters into mojibake.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rewards-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Rewards</h1>
        <p className="text-sm text-muted-foreground">
          Verify and issue agent rewards. Each reward is created automatically when an attendee completes full attendance.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Total Rewards"
          value={`RM${summary.totalAmount.toFixed(2)}`}
          subtitle={`${rewards?.length ?? 0} reward${(rewards?.length ?? 0) === 1 ? '' : 's'}`}
          icon={Banknote}
          iconColor="text-emerald-600"
          iconBgColor="bg-emerald-100"
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={`RM${summary.pendingAmount.toFixed(2)}`}
          subtitle={`${summary.pendingCount} awaiting issue`}
          icon={Clock}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={isLoading}
        />
        <StatCard
          title="Issued"
          value={`RM${summary.issuedAmount.toFixed(2)}`}
          subtitle={`${summary.issuedCount} sent`}
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
            <CardTitle>Reward Issuance</CardTitle>
            <CardDescription>Mark rewards as issued or failed and track when each was sent.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-48">
              <Label className="text-sm font-medium">Event</Label>
              <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  {campaigns?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  <SelectItem value={RewardStatus.PAID}>Issued</SelectItem>
                  <SelectItem value={RewardStatus.FAILED}>Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="size-4 mr-1.5" />
              Export
            </Button>
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
                    <TableHead>Event</TableHead>
                    <TableHead>Unit / Agent</TableHead>
                    <TableHead>Registrant</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        No rewards match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => {
                      const reg = r.attendance?.registration;
                      const display = rewardDisplay(r.status);
                      const isIssued = r.status === RewardStatus.PAID;
                      const isFailed = r.status === RewardStatus.FAILED;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{reg?.slot?.campaign?.name ?? '—'}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium text-foreground">{r.agent?.unit_name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{r.agent?.name ?? ''}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-foreground">{reg?.invitee_name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{reg?.invitee_phone ?? ''}</div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600">
                            RM{Number(r.amount).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={display.variant}>{display.label}</Badge>
                            {isIssued && r.issued_at && (
                              <div className="text-xs text-muted-foreground mt-1">{fmtDateTime(r.issued_at)}</div>
                            )}
                            {isFailed && r.failure_reason && (
                              <div className="text-xs text-red-600 mt-1" title={r.failure_reason}>
                                {r.failure_reason}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {!isIssued && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                  disabled={setStatus.isPending}
                                  onClick={() => runUpdate(r.id, RewardStatus.PAID)}
                                >
                                  <CheckCircle2 className="size-4 mr-1" />
                                  Issue
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
                              {(isIssued || isFailed) && (
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

      {/* Failure-reason dialog */}
      <Dialog open={!!failTarget} onOpenChange={(open) => !open && setFailTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Reward as Failed</DialogTitle>
            <DialogDescription>
              Record why issuing this reward failed (e.g. invalid payout details). This is shown to admins on the
              reward row.
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
            <Button variant="outline" onClick={() => setFailTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={confirmFail}
              disabled={setStatus.isPending}
            >
              {setStatus.isPending ? 'Saving...' : 'Mark Failed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
