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
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  useToast,
} from '@agent-system/shared-ui';
import { ArrowLeft, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { VehicleStatus } from '@agent-system/shared-types';
import {
  useEnquiry,
  useRecordQuotation,
  useConfirmVehicleRenewal,
  useMarkVehicleLost,
  type EnquiryVehicleRow,
} from '../../hooks/useEnquiries';

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-SG', { dateStyle: 'medium' });
}

function vehicleBadge(status: VehicleStatus): { label: string; variant: 'neutral' | 'warning' | 'success' | 'error' } {
  switch (status) {
    case VehicleStatus.QUOTED:
      return { label: 'Quoted', variant: 'warning' };
    case VehicleStatus.RENEWED:
      return { label: 'Renewed', variant: 'success' };
    case VehicleStatus.LOST:
      return { label: 'Lost', variant: 'error' };
    default:
      return { label: 'Submitted', variant: 'neutral' };
  }
}

export function EnquiryDetail() {
  const { enquiryId } = useParams({ strict: false }) as { enquiryId: string };
  const { toast } = useToast();
  const { data: enquiry, isLoading, error } = useEnquiry(enquiryId);
  const recordQuotation = useRecordQuotation();
  const confirmRenewal = useConfirmVehicleRenewal();
  const markLost = useMarkVehicleLost();

  // Record-quotation dialog
  const [quoteTarget, setQuoteTarget] = useState<EnquiryVehicleRow | null>(null);
  const [quoteRef, setQuoteRef] = useState('');
  // Mark-lost dialog
  const [lostTarget, setLostTarget] = useState<EnquiryVehicleRow | null>(null);
  const [lostReason, setLostReason] = useState('');
  // Mark-renewed confirm
  const [renewTarget, setRenewTarget] = useState<EnquiryVehicleRow | null>(null);

  const pending = recordQuotation.isPending || confirmRenewal.isPending || markLost.isPending;

  const submitQuote = async () => {
    if (!quoteTarget) return;
    try {
      await recordQuotation.mutateAsync({
        vehicleId: quoteTarget.id,
        enquiryId,
        externalRef: quoteRef.trim() === '' ? null : quoteRef.trim(),
      });
      toast({ title: 'Quotation recorded' });
      setQuoteTarget(null);
      setQuoteRef('');
    } catch (err: any) {
      toast({ title: 'Failed to record quotation', description: err.message, variant: 'error' });
    }
  };

  const submitRenew = async () => {
    if (!renewTarget) return;
    try {
      await confirmRenewal.mutateAsync({ vehicleId: renewTarget.id, enquiryId });
      toast({ title: 'Renewal confirmed — gift, commission & settlement created' });
      setRenewTarget(null);
    } catch (err: any) {
      toast({ title: 'Failed to confirm renewal', description: err.message, variant: 'error' });
    }
  };

  const submitLost = async () => {
    if (!lostTarget) return;
    try {
      await markLost.mutateAsync({
        vehicleId: lostTarget.id,
        enquiryId,
        reason: lostReason.trim() === '' ? null : lostReason.trim(),
      });
      toast({ title: 'Vehicle marked lost' });
      setLostTarget(null);
      setLostReason('');
    } catch (err: any) {
      toast({ title: 'Failed to mark lost', description: err.message, variant: 'error' });
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading enquiry: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link to="/enquiries" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 mr-1" />
          Back to Enquiries
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{enquiry?.customer_name ?? 'Enquiry'}</CardTitle>
          <CardDescription>
            {enquiry?.customer_phone} · {enquiry?.customer_nric}
            {enquiry?.customer_email ? ` · ${enquiry.customer_email}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div>
            Branch: <span className="text-foreground">{enquiry?.branch?.merchant?.name ?? '—'}</span>
            {enquiry?.branch?.name ? ` — ${enquiry.branch.name}` : ''}
          </div>
          <div>
            Split: pool RM{enquiry?.branch?.merchant?.gift_pool_amount?.toFixed(2) ?? '0.00'} ·{' '}
            {enquiry?.branch?.merchant?.merchant_share_pct ?? 0}% merchant /{' '}
            {100 - (enquiry?.branch?.merchant?.merchant_share_pct ?? 0)}% customer
          </div>
          <div>
            Source: <span className="text-foreground">{enquiry?.agent ? `${enquiry.agent.name} (${enquiry.agent.agent_code})` : 'House (no agent commission)'}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicles</CardTitle>
          <CardDescription>{enquiry?.vehicles?.length ?? 0} cars · act on each line</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Plate</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(enquiry?.vehicles ?? []).map((v) => {
                    const badge = vehicleBadge(v.status);
                    const canQuote = v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED;
                    const canRenew = v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED;
                    const canLose = v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED;
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.car_plate}</TableCell>
                        <TableCell className="text-muted-foreground">{v.product?.name ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(v.insurance_expiry_date)}</TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          {v.status === VehicleStatus.QUOTED && v.external_quotation_ref && (
                            <div className="text-xs text-muted-foreground mt-1">Ref: {v.external_quotation_ref}</div>
                          )}
                          {v.status === VehicleStatus.LOST && v.lost_reason && (
                            <div className="text-xs text-red-600 mt-1" title={v.lost_reason}>{v.lost_reason}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canQuote && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => {
                                  setQuoteTarget(v);
                                  setQuoteRef(v.external_quotation_ref ?? '');
                                }}
                              >
                                <FileText className="size-4 mr-1" />
                                {v.status === VehicleStatus.QUOTED ? 'Edit quote' : 'Quote'}
                              </Button>
                            )}
                            {canRenew && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                disabled={pending}
                                onClick={() => setRenewTarget(v)}
                              >
                                <CheckCircle2 className="size-4 mr-1" />
                                Renew
                              </Button>
                            )}
                            {canLose && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                disabled={pending}
                                onClick={() => {
                                  setLostTarget(v);
                                  setLostReason('');
                                }}
                              >
                                <XCircle className="size-4 mr-1" />
                                Lost
                              </Button>
                            )}
                            {v.status === VehicleStatus.RENEWED && (
                              <span className="text-xs text-muted-foreground">Renewed {fmtDate(v.renewed_at)}</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record-quotation dialog */}
      <Dialog open={!!quoteTarget} onOpenChange={(open) => !open && setQuoteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Quotation</DialogTitle>
            <DialogDescription>
              Mark {quoteTarget?.car_plate} as quoted and store the external quotation reference (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="quote-ref">External quotation reference</Label>
            <Input
              id="quote-ref"
              value={quoteRef}
              onChange={(e) => setQuoteRef(e.target.value)}
              placeholder="e.g. QTN-2026-00123"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteTarget(null)}>Cancel</Button>
            <Button onClick={submitQuote} disabled={recordQuotation.isPending}>
              {recordQuotation.isPending ? 'Saving...' : 'Record Quotation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark-renewed confirm (mints money) */}
      <AlertDialog open={!!renewTarget} onOpenChange={(open) => !open && setRenewTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Renewal</AlertDialogTitle>
            <AlertDialogDescription>
              Confirming {renewTarget?.car_plate} issues the customer gift voucher, the merchant settlement, and
              (if this enquiry came from an agent) the agent commission. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={submitRenew}
              disabled={confirmRenewal.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {confirmRenewal.isPending ? 'Confirming...' : 'Confirm Renewal'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark-lost dialog */}
      <Dialog open={!!lostTarget} onOpenChange={(open) => !open && setLostTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Vehicle Lost</DialogTitle>
            <DialogDescription>
              Record why {lostTarget?.car_plate} did not renew (optional). No payout is created for a lost vehicle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lost-reason">Reason</Label>
            <Input
              id="lost-reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="e.g. Renewed elsewhere"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={submitLost} disabled={markLost.isPending}>
              {markLost.isPending ? 'Saving...' : 'Mark Lost'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
