import { useState, Fragment } from 'react';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TableSkeleton,
  useToast,
} from '@agent-system/shared-ui';
import { ArrowLeft, FileText, CheckCircle2, XCircle, Copy, Check, Link2Off } from 'lucide-react';
import { VehicleStatus, MerchantStatus } from '@agent-system/shared-types';
import {
  useEnquiry,
  useRecordQuotation,
  useConfirmVehicleRenewal,
  useMarkVehicleLost,
  type EnquiryVehicleRow,
} from '../../hooks/useEnquiries';
import { useMerchants } from '../../hooks/useMerchants';
import { useSystemSettings } from '../../hooks/useSystemSettings';
import { useEnquiryAttachments, useViewAttachment } from '../../hooks/useEnquiryAttachments';
import { supabase } from '../../lib/supabase';

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
  const { data: merchants } = useMerchants();
  const { data: settings } = useSystemSettings();
  const giftRate = settings?.customer_gift_rate_pct ?? 10;
  const activeMerchants = (merchants ?? []).filter((m) => m.status === MerchantStatus.ACTIVE);
  const recordQuotation = useRecordQuotation();
  const confirmRenewal = useConfirmVehicleRenewal();
  const markLost = useMarkVehicleLost();

  // Record-quotation dialog
  const [quoteTarget, setQuoteTarget] = useState<EnquiryVehicleRow | null>(null);
  const [quoteRef, setQuoteRef] = useState('');
  // Mark-lost dialog
  const [lostTarget, setLostTarget] = useState<EnquiryVehicleRow | null>(null);
  const [lostReason, setLostReason] = useState('');
  // Mark-renewed confirm (captures premium + per-car partner)
  const [renewTarget, setRenewTarget] = useState<EnquiryVehicleRow | null>(null);
  const [renewPremium, setRenewPremium] = useState('');
  const [renewMerchantId, setRenewMerchantId] = useState('');

  const { data: attachments = [] } = useEnquiryAttachments(enquiryId);
  const viewAttachment = useViewAttachment();

  // Customer my-cars link: copy (get-or-create) + revoke, confirmed via AlertDialog.
  const [linkCopied, setLinkCopied] = useState(false);
  const [copyLinkPending, setCopyLinkPending] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [revokeLinkPending, setRevokeLinkPending] = useState(false);

  const handleCopyMyCarsLink = async () => {
    setCopyLinkPending(true);
    try {
      const { data, error } = await supabase.rpc('ensure_customer_portal_token', {
        p_enquiry_id: enquiryId,
      });
      if (error || !data) {
        toast({ title: 'Could not create the link', description: error?.message, variant: 'error' });
        return;
      }
      const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
      await navigator.clipboard.writeText(`${publicPagesUrl}/public/my-cars/${data}`);
      setLinkCopied(true);
      toast({ title: 'Link copied!', description: 'Share this with the customer to manage their cars.' });
      setTimeout(() => setLinkCopied(false), 2000);
    } finally {
      setCopyLinkPending(false);
    }
  };

  const confirmRevokeLink = async () => {
    setRevokeLinkPending(true);
    try {
      const { data: token, error: tokenError } = await supabase.rpc('ensure_customer_portal_token', {
        p_enquiry_id: enquiryId,
      });
      if (tokenError || !token) {
        toast({ title: 'Could not find the link to revoke', description: tokenError?.message, variant: 'error' });
        return;
      }
      const { error } = await supabase.rpc('revoke_customer_portal_token', { p_token: token });
      if (error) {
        toast({ title: 'Failed to revoke link', description: error.message, variant: 'error' });
        return;
      }
      toast({ title: 'Link revoked', description: 'The customer can no longer use this link to manage their cars.' });
      setRevokeConfirmOpen(false);
    } finally {
      setRevokeLinkPending(false);
    }
  };

  const pending = recordQuotation.isPending || confirmRenewal.isPending || markLost.isPending;

  const openRenew = (v: EnquiryVehicleRow) => {
    setRenewTarget(v);
    setRenewPremium(v.renewal_premium_amount != null ? String(v.renewal_premium_amount) : '');
    setRenewMerchantId(v.merchant_id ?? enquiry?.merchant_id ?? '');
  };

  const renewGift = (() => {
    const premium = parseFloat(renewPremium);
    if (!isFinite(premium) || premium < 0) return 0;
    return Math.round(premium * giftRate) / 100;
  })();

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
    const premium = parseFloat(renewPremium);
    if (!isFinite(premium) || premium < 0) {
      toast({ title: 'Enter a valid renewal premium', variant: 'error' });
      return;
    }
    if (!renewMerchantId) {
      toast({ title: 'Select a partner', variant: 'error' });
      return;
    }
    try {
      await confirmRenewal.mutateAsync({
        vehicleId: renewTarget.id,
        enquiryId,
        premiumAmount: premium,
        merchantId: renewMerchantId,
      });
      toast({ title: 'Renewal confirmed — customer gift & merchant settlement created' });
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
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{enquiry?.customer_name ?? 'Enquiry'}</CardTitle>
            <CardDescription>
              {enquiry?.customer_phone} · {enquiry?.customer_nric}
              {enquiry?.customer_email ? ` · ${enquiry.customer_email}` : ''}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyMyCarsLink}
              disabled={copyLinkPending}
            >
              {linkCopied ? <Check className="size-4 mr-1.5" /> : <Copy className="size-4 mr-1.5" />}
              {linkCopied ? 'Copied!' : 'Copy my-cars link'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => setRevokeConfirmOpen(true)}
              disabled={revokeLinkPending}
            >
              <Link2Off className="size-4 mr-1.5" />
              Revoke link
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div>
            Suggested partnership:{' '}
            <span className="text-foreground">{enquiry?.merchant?.name ?? 'Unassigned'}</span>
            <span className="text-xs"> (confirmed per car at renewal)</span>
          </div>
          <div>
            Customer gift:{' '}
            <span className="text-foreground">{giftRate}% of the renewal premium</span>
          </div>
          <div>
            Source:{' '}
            <span className="text-foreground">
              {enquiry?.agent
                ? `${enquiry.agent.name} (${enquiry.agent.agent_code}) · ${enquiry.agent.unit_name}`
                : 'House'}
            </span>
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
                    const isRemoved = v.removed_at !== null;
                    const canQuote = !isRemoved && (v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED);
                    const canRenew = !isRemoved && (v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED);
                    const canLose = !isRemoved && (v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED);
                    const vehicleAttachments = attachments.filter(a => a.enquiry_vehicle_id === v.id);
                    return (
                      <Fragment key={v.id}>
                        <TableRow>
                          <TableCell className="font-medium">{v.car_plate}</TableCell>
                          <TableCell className="text-muted-foreground">{v.product?.name ?? '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{fmtDate(v.insurance_expiry_date)}</TableCell>
                          <TableCell>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            {isRemoved && (
                              <Badge variant="neutral" className="ml-1 text-[10px]">Removed by customer</Badge>
                            )}
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
                                  onClick={() => openRenew(v)}
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
                        {vehicleAttachments.length > 0 && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={5} className="py-1 pl-4 bg-muted/30">
                              <div className="flex flex-wrap gap-1.5">
                                {vehicleAttachments.map(a => (
                                  <div
                                    key={a.id}
                                    className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                                  >
                                    <FileText className="size-3 shrink-0" />
                                    <span className="max-w-[160px] truncate">{a.file_name}</span>
                                    <span className="opacity-60">({(a.size_bytes / 1024).toFixed(0)} KB)</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 px-1 text-xs text-primary hover:text-primary"
                                      onClick={() => viewAttachment(a.storage_path)}
                                    >
                                      View
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
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

      {/* Mark-renewed confirm — captures premium + per-car partner; mints money */}
      <Dialog open={!!renewTarget} onOpenChange={(open) => !open && setRenewTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Renewal</DialogTitle>
            <DialogDescription>
              Confirm the successful renewal of {renewTarget?.car_plate}. Enter the total car-insurance renewal
              premium and the partner. This issues the customer gift voucher and the merchant settlement and
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="renew-premium">Renewal premium (RM)</Label>
              <Input
                id="renew-premium"
                type="number"
                min={0}
                step="0.01"
                value={renewPremium}
                onChange={(e) => setRenewPremium(e.target.value)}
                placeholder="e.g. 1850.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Partner</Label>
              <Select value={renewMerchantId} onValueChange={setRenewMerchantId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a partner" />
                </SelectTrigger>
                <SelectContent>
                  {activeMerchants.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              Customer gift ({giftRate}%):{' '}
              <span className="font-medium text-foreground">RM{renewGift.toFixed(2)}</span>
              <div className="text-xs text-muted-foreground">Merchant settlement equals this amount.</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewTarget(null)}>Cancel</Button>
            <Button
              onClick={submitRenew}
              disabled={confirmRenewal.isPending || !renewMerchantId || renewPremium.trim() === ''}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {confirmRenewal.isPending ? 'Confirming...' : 'Confirm Renewal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Revoke customer link — confirm before disabling the my-cars link */}
      <AlertDialog open={revokeConfirmOpen} onOpenChange={(open) => !revokeLinkPending && setRevokeConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke customer link</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately disables the my-cars link shared with {enquiry?.customer_name}. They
              will no longer be able to view or remove their cars through it. A new link can be
              issued later, but this one cannot be reactivated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeLinkPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevokeLink}
              className="bg-red-600 hover:bg-red-700"
              disabled={revokeLinkPending}
            >
              {revokeLinkPending ? 'Revoking...' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
