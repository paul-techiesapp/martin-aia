import { useState, useRef, useMemo, Fragment } from 'react';
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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  getStatusVariant,
  TableSkeleton,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Combobox,
  useToast,
  buildEnquiriesWorkbook,
  type EnquiryExportRow,
} from '@agent-system/shared-ui';
import { format, parseISO, addYears } from 'date-fns';
import { FileText, Store, Download, Plus, Paperclip, X, Copy, Check, ArrowRightLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import {
  useMyEnquiries,
  useMarkVehicleRenewed,
  useReassignEnquiryAgent,
  type EnquiryWithDetails,
} from '../hooks/useMyEnquiries';
import { useAssignVehicleMerchant } from '../hooks/useAssignVehicleMerchant';
import { useAgentMerchants, useMyLinkedMerchantIds, type MerchantWithBranches } from '../hooks/useAgentMerchants';
import { useUnitRoster } from '../hooks/useSubAgents';
import { isMerchantAvailableToAgent } from '../lib/partnerScope';
import { useRequestQuote } from '../hooks/useRequestQuote';
import { ProposePartnerDialog } from '../components/ProposePartnerDialog';
import { compareByKey, type EnquirySortKey } from './myEnquiriesSort';
import { EnquiryStatus, VehicleStatus, type AgentWithTier } from '@agent-system/shared-types';
import {
  useEnquiryAttachments,
  useViewAttachment,
  useUploadAttachment,
  useDeleteAttachment,
  type AttachmentRow,
} from '../hooks/useEnquiryAttachments';

export interface EnquiryCardProps {
  enq: EnquiryWithDetails;
  activeMerchants: MerchantWithBranches[];
  agentId: string | undefined;
  /** Show the owning agent (unit viewer looking at unit-wide enquiries). */
  showAgent?: boolean;
  /**
   * Hide mutating controls (Assign partner, Get Quote). Currently always
   * passed `false` — unit viewers act on unit rows too — but the prop and its
   * render branches are retained for future per-row gating.
   */
  readOnly?: boolean;
  /** Unit viewer (Unit Manager / Unit Admin) — gates the Reassign control. */
  isUnitView?: boolean;
  /** Full unit roster, for the reassign target picker. */
  unitRoster?: { id: string; name: string }[];
}

export function EnquiryCard({
  enq,
  activeMerchants,
  agentId,
  showAgent,
  readOnly,
  isUnitView,
  unitRoster,
}: EnquiryCardProps) {
  const { toast } = useToast();
  const assignVehicleMerchant = useAssignVehicleMerchant(agentId);
  const requestQuote = useRequestQuote(agentId);
  const markVehicleRenewed = useMarkVehicleRenewed(agentId);
  const reassignEnquiryAgent = useReassignEnquiryAgent();
  // Per-vehicle partner selection, keyed by vehicle id (a multi-car enquiry can
  // send each car to a different partner).
  const [vehicleMerchant, setVehicleMerchant] = useState<Record<string, string>>({});
  const [assigningVehicleId, setAssigningVehicleId] = useState<string | null>(null);
  const [quotingVehicleId, setQuotingVehicleId] = useState<string | null>(null);
  const [renewingVehicleId, setRenewingVehicleId] = useState<string | null>(null);
  // Vehicle awaiting mark-renewed confirmation (null = dialog closed).
  const [renewTarget, setRenewTarget] = useState<EnquiryWithDetails['vehicles'][number] | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignAgentId, setReassignAgentId] = useState<string | null>(null);
  const { data: attachments = [] } = useEnquiryAttachments(enq.id);
  const viewAttachment = useViewAttachment();
  const uploadAttachment = useUploadAttachment(enq.id);
  const deleteAttachment = useDeleteAttachment(enq.id);
  // Per-vehicle in-flight flags, keyed by vehicle id — a single shared id
  // would let a second vehicle's upload clobber the first one's disabled
  // state mid-flight (double-upload risk on multi-car enquiries).
  const [uploadingVehicles, setUploadingVehicles] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<AttachmentRow | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyMyCars = async (enquiryId: string) => {
    const { data, error } = await supabase.rpc('ensure_customer_portal_token', {
      p_enquiry_id: enquiryId,
    });
    if (error || !data) {
      toast({ title: 'Could not create the link', description: error?.message, variant: 'error' });
      return;
    }
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    await navigator.clipboard.writeText(`${publicPagesUrl}/public/my-cars/${data}`);
    setCopiedId(enquiryId);
    toast({ title: 'Link copied!', description: "Share this with the customer to manage their cars." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAssignVehicle = async (vehicleId: string) => {
    const merchantId = vehicleMerchant[vehicleId];
    if (!merchantId) return;
    setAssigningVehicleId(vehicleId);
    try {
      await assignVehicleMerchant.mutateAsync({ vehicleId, merchantId });
      toast({ title: 'Partner assigned' });
      setVehicleMerchant((prev) => {
        const next = { ...prev };
        delete next[vehicleId];
        return next;
      });
    } catch (err: unknown) {
      toast({
        title: 'Failed to assign',
        description: (err as Error)?.message,
        variant: 'error',
      });
    } finally {
      setAssigningVehicleId(null);
    }
  };

  const handleGetQuote = async (vehicleId: string) => {
    setQuotingVehicleId(vehicleId);
    try {
      const res = (await requestQuote.mutateAsync({ enquiryId: enq.id, vehicleId })) as
        | { skipped?: boolean; alreadyRequested?: boolean }
        | null;
      if (res?.skipped) {
        toast({
          title: 'Quote request not sent',
          description: 'No admin recipient is configured yet. Please contact your administrator.',
          variant: 'error',
        });
      } else if (res?.alreadyRequested) {
        toast({ title: 'Already requested', description: 'A quote was already requested for this car.' });
      } else {
        toast({ title: 'Quote requested', description: 'Our team has been notified.' });
      }
    } catch (err: unknown) {
      toast({
        title: 'Failed to request quote',
        description: (err as Error)?.message,
        variant: 'error',
      });
    } finally {
      setQuotingVehicleId(null);
    }
  };

  const handleFileSelected = async (vehicleId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after an error
    if (!file) return;
    setUploadingVehicles((prev) => ({ ...prev, [vehicleId]: true }));
    try {
      await uploadAttachment.mutateAsync({ vehicleId, file });
      toast({ title: 'File uploaded' });
    } catch (err: unknown) {
      toast({ title: 'Failed to upload', description: (err as Error)?.message, variant: 'error' });
    } finally {
      setUploadingVehicles((prev) => {
        const next = { ...prev };
        delete next[vehicleId];
        return next;
      });
    }
  };

  const handleConfirmDelete = async () => {
    const att = deleteTarget;
    if (!att || deleteAttachment.isPending) return;
    try {
      await deleteAttachment.mutateAsync({ id: att.id, storage_path: att.storage_path });
      toast({ title: 'File removed' });
    } catch (err: unknown) {
      toast({ title: 'Failed to remove', description: (err as Error)?.message, variant: 'error' });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleConfirmRenew = async () => {
    const vehicle = renewTarget;
    if (!vehicle || markVehicleRenewed.isPending) return;
    setRenewingVehicleId(vehicle.id);
    try {
      const newExpiry = await markVehicleRenewed.mutateAsync(vehicle.id);
      toast({
        title: 'Marked as renewed',
        description: `New expiry: ${format(parseISO(newExpiry), 'd MMM yyyy')}`,
      });
    } catch (err: unknown) {
      toast({ title: 'Failed to mark renewed', description: (err as Error)?.message, variant: 'error' });
    } finally {
      setRenewingVehicleId(null);
      setRenewTarget(null);
    }
  };

  const handleConfirmReassign = async () => {
    if (!reassignAgentId || reassignEnquiryAgent.isPending) return;
    try {
      const moved = await reassignEnquiryAgent.mutateAsync({
        customerNric: enq.customer_nric,
        newAgentId: reassignAgentId,
      });
      toast({ title: `${moved} enquiry(ies) reassigned` });
      setReassignOpen(false);
      setReassignAgentId(null);
    } catch (err: unknown) {
      toast({ title: 'Failed to reassign', description: (err as Error)?.message, variant: 'error' });
    }
  };

  // Unit roster minus the customer's current agent — reassigning to the same
  // agent would be a no-op the RPC still charges an audit row for.
  const reassignOptions = (unitRoster ?? [])
    .filter((a) => a.id !== enq.agent?.id)
    .map((a) => ({ value: a.id, label: a.name }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{enq.customer_name}</CardTitle>
          <CardDescription>
            {enq.customer_phone}
            {enq.customer_email ? ` · ${enq.customer_email}` : ''}
          </CardDescription>
          <p className="text-xs text-muted-foreground">
            Submitted {format(parseISO(enq.created_at), 'd MMM yyyy, HH:mm')}
          </p>
          {showAgent && enq.agent && (
            <p className="text-xs text-muted-foreground">Agent: {enq.agent.name} ({enq.agent.agent_code})</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handleCopyMyCars(enq.id)}>
            {copiedId === enq.id ? (
              <><Check className="size-4 mr-1 text-emerald-600" /> Copied!</>
            ) : (
              <><Copy className="size-4 mr-1" /> Copy my-cars link</>
            )}
          </Button>
          {isUnitView && (
            <Button variant="outline" size="sm" onClick={() => setReassignOpen(true)}>
              <ArrowRightLeft className="size-4 mr-1" /> Reassign
            </Button>
          )}
          <Badge variant={getStatusVariant(enq.status)} className="capitalize">
            {enq.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Vehicle table — partner is assigned per car */}
        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Car Plate</TableHead>
                <TableHead>Insurance Expiry</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enq.vehicles.map((v) => {
                const vehicleAttachments = attachments.filter(a => a.enquiry_vehicle_id === v.id);
                return (
                  <Fragment key={v.id}>
                    <TableRow>
                      <TableCell className="font-medium">{v.car_plate}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(parseISO(v.insurance_expiry_date), 'd MMM yyyy')}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.product?.name ?? '-'}
                      </TableCell>
                      <TableCell>
                        {v.merchant?.name ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                            <Store className="size-3.5 text-muted-foreground shrink-0" />
                            {v.merchant.name}
                          </span>
                        ) : readOnly ? (
                          <span className="text-xs text-muted-foreground">Unassigned</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Select
                              value={vehicleMerchant[v.id] ?? ''}
                              onValueChange={(val) =>
                                setVehicleMerchant((prev) => ({ ...prev, [v.id]: val }))
                              }
                            >
                              <SelectTrigger className="w-44 h-8 text-sm">
                                <SelectValue placeholder="Assign partner" />
                              </SelectTrigger>
                              <SelectContent>
                                {activeMerchants.length === 0 ? (
                                  <SelectItem value="__none" disabled>
                                    No active partnerships
                                  </SelectItem>
                                ) : (
                                  activeMerchants.map((m) => (
                                    <SelectItem key={m.id} value={m.id}>
                                      {m.name}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !vehicleMerchant[v.id] ||
                                (assignVehicleMerchant.isPending && assigningVehicleId === v.id)
                              }
                              onClick={() => handleAssignVehicle(v.id)}
                            >
                              Assign
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(v.status)} className="capitalize">
                          {v.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          {v.quote_requested_at ? (
                            <span className="text-xs text-muted-foreground">
                              Quote requested {format(parseISO(v.quote_requested_at), 'd MMM yyyy')}
                            </span>
                          ) : readOnly ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : v.status === VehicleStatus.SUBMITTED ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={requestQuote.isPending && quotingVehicleId === v.id}
                              onClick={() => handleGetQuote(v.id)}
                            >
                              {requestQuote.isPending && quotingVehicleId === v.id
                                ? 'Requesting…'
                                : 'Get Quote'}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                          {!readOnly &&
                            (v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={markVehicleRenewed.isPending && renewingVehicleId === v.id}
                                onClick={() => setRenewTarget(v)}
                              >
                                Mark renewed
                              </Button>
                            )}
                          {v.marked_renewed_at && (
                            <span className="text-xs text-muted-foreground">
                              Renewed {format(parseISO(v.marked_renewed_at), 'd MMM yyyy')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {(vehicleAttachments.length > 0 || !readOnly) && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="py-1 pl-4 bg-muted/30">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {vehicleAttachments.map(a => (
                              <div
                                key={a.id}
                                className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                              >
                                <FileText className="size-3 shrink-0" />
                                <span className="max-w-[140px] truncate">{a.file_name}</span>
                                <span className="opacity-60">({(a.size_bytes / 1024).toFixed(0)} KB)</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 px-1 text-xs text-primary hover:text-primary"
                                  onClick={() => viewAttachment(a.storage_path)}
                                >
                                  View
                                </Button>
                                {!readOnly && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                                    onClick={() => setDeleteTarget(a)}
                                    aria-label="Remove file"
                                  >
                                    <X className="size-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                            {!readOnly && (
                              <>
                                <input
                                  ref={(el) => {
                                    fileInputRefs.current[v.id] = el;
                                  }}
                                  type="file"
                                  accept="image/*,application/pdf"
                                  className="hidden"
                                  onChange={(e) => handleFileSelected(v.id, e)}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                                  disabled={!!uploadingVehicles[v.id]}
                                  onClick={() => fileInputRefs.current[v.id]?.click()}
                                >
                                  <Paperclip className="size-3 mr-1" />
                                  {uploadingVehicles[v.id] ? 'Uploading…' : 'Upload'}
                                </Button>
                              </>
                            )}
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
      </CardContent>

      {/* Remove-attachment confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this file?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `"${deleteTarget.file_name}" will be permanently removed from this enquiry.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleteAttachment.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteAttachment.isPending ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark-renewed confirmation */}
      <AlertDialog open={!!renewTarget} onOpenChange={(open) => !open && setRenewTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {renewTarget?.car_plate} as renewed?</AlertDialogTitle>
            <AlertDialogDescription>
              The expiry moves to{' '}
              {renewTarget
                ? format(addYears(parseISO(renewTarget.insurance_expiry_date), 1), 'd MMM yyyy')
                : ''}{' '}
              and next year's reminder is re-armed. This does not issue the gold gift — the
              partner confirms that separately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRenew} disabled={markVehicleRenewed.isPending}>
              {markVehicleRenewed.isPending ? 'Marking...' : 'Mark renewed'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reassign to another agent in the unit */}
      <Dialog
        open={reassignOpen}
        onOpenChange={(open) => {
          setReassignOpen(open);
          if (!open) setReassignAgentId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign {enq.customer_name}</DialogTitle>
            <DialogDescription>
              All of this customer's open enquiries move to the selected agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New agent</Label>
            <Combobox
              options={reassignOptions}
              value={reassignAgentId}
              onValueChange={setReassignAgentId}
              placeholder="Select an agent"
              searchPlaceholder="Search agents…"
              emptyText="No other agents in your unit"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmReassign}
              disabled={!reassignAgentId || reassignEnquiryAgent.isPending}
            >
              {reassignEnquiryAgent.isPending ? 'Reassigning...' : 'Reassign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'd MMM yyyy') : '');

// Flatten an agent's enquiries into one export row per car (unit/agent come
// from the logged-in agent context; partner from the assigned merchant).
function toEnquiryExportRows(
  enquiries: EnquiryWithDetails[],
  agent: AgentWithTier | null,
): EnquiryExportRow[] {
  const unit = agent?.unit_name ?? '';
  const agentName = agent?.name ?? '';
  const agentCode = agent?.agent_code ?? '';
  const rows: EnquiryExportRow[] = [];
  for (const e of enquiries) {
    const base = {
      unit,
      agent: e.agent?.name ?? agentName,
      agentCode: e.agent?.agent_code ?? agentCode,
      partner: e.merchant?.name ?? 'Unassigned',
      customer: e.customer_name ?? '',
      phone: e.customer_phone ?? '',
      email: e.customer_email ?? '',
      // Branch-link enquiries owned by an agent carry the referring staff ID.
      staffId: e.staff_id ?? '',
      enquiryStatus: e.status,
      received: fmtDate(e.created_at),
    };
    const vehicles = e.vehicles ?? [];
    if (vehicles.length === 0) {
      rows.push({ ...base, carPlate: '', insuranceExpiry: '', roadTax: '', vehicleStatus: '' });
      continue;
    }
    for (const v of vehicles) {
      rows.push({
        ...base,
        partner: v.merchant?.name ?? base.partner,
        carPlate: v.car_plate ?? '',
        insuranceExpiry: fmtDate(v.insurance_expiry_date),
        roadTax: v.road_tax_renewal ? 'Yes' : 'No',
        vehicleStatus: v.status,
      });
    }
  }
  return rows;
}

export function MyEnquiries() {
  const { agent, isUnitViewer } = useAuth();
  const { toast } = useToast();
  const { data: enquiries, isLoading, isError, error } = useMyEnquiries(agent?.id, isUnitViewer);
  const { data: merchants } = useAgentMerchants();
  const { data: linkedMerchantIds } = useMyLinkedMerchantIds(agent?.id);
  // Unit root: the unit admin's own id, or the parent id for a deputy unit
  // manager — same derivation as TeamReport.tsx.
  const unitRootId = agent?.parent_agent_id ?? agent?.id;
  const { data: unitRoster } = useUnitRoster(isUnitViewer ? unitRootId : undefined);

  const [proposeOpen, setProposeOpen] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<EnquirySortKey>('default');
  const [partnerFilter, setPartnerFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Round 5 item 1: only Master Partners, own proposals, or branch-linked
  // merchants may be assigned — never every admin-created partner.
  const activeMerchants =
    merchants?.filter((m) =>
      isMerchantAvailableToAgent(m, agent?.id, linkedMerchantIds ?? new Set<string>()),
    ) ?? [];

  // Default ordering: Partner -> Status (open first) -> earliest expiry -> newest
  // (unit viewers get Agent as the leading key instead).
  const sortedEnquiries = [...(enquiries ?? [])].sort(compareByKey(sortKey, isUnitViewer));

  const agentOptions = Array.from(
    new Map(
      (enquiries ?? [])
        .filter((e) => e.agent)
        .map((e) => [e.agent!.id, e.agent!])
    ).values()
  );

  // Partner filter options: every merchant actually referenced by the loaded
  // enquiries (either at enquiry level or per-vehicle), deduped by id.
  const partnerOptions = Array.from(
    new Map(
      (enquiries ?? [])
        .flatMap((e) => [e.merchant, ...e.vehicles.map((v) => v.merchant)])
        .filter((m): m is { id: string; name: string } => !!m)
        .map((m) => [m.id, m])
    ).values()
  );

  const matchesPartner = (e: EnquiryWithDetails): boolean => {
    if (partnerFilter === 'all') return true;
    const merchantIds = [e.merchant?.id, ...e.vehicles.map((v) => v.merchant?.id)].filter(
      (id): id is string => !!id
    );
    if (partnerFilter === 'unassigned') return merchantIds.length === 0;
    return merchantIds.includes(partnerFilter);
  };

  const matchesStatus = (e: EnquiryWithDetails): boolean => {
    if (statusFilter === 'all') return true;
    return statusFilter === 'open' ? e.status === EnquiryStatus.OPEN : e.status === EnquiryStatus.CLOSED;
  };

  // Round 5 item 8.1: filter by submission date (yyyy-mm-dd prefix of the ISO
  // timestamp); empty bounds are unbounded.
  const matchesDate = (e: EnquiryWithDetails): boolean =>
    (!dateFrom || e.created_at.slice(0, 10) >= dateFrom) &&
    (!dateTo || e.created_at.slice(0, 10) <= dateTo);

  // Round 6 item 9: free-text search across name, NRIC, phone, and plate.
  // NRIC/plate compare with whitespace/dashes stripped so formatting doesn't
  // block a match; phone only matches once at least 3 digits are typed, so a
  // single stray digit in the query doesn't match every row.
  const q = search.trim().toLowerCase();
  const digits = search.replace(/\D/g, '');
  const matchesSearch = (e: EnquiryWithDetails): boolean =>
    !q ||
    e.customer_name.toLowerCase().includes(q) ||
    (e.customer_nric ?? '').toLowerCase().replace(/[\s-]/g, '').includes(q.replace(/[\s-]/g, '')) ||
    (digits.length >= 3 && (e.customer_phone ?? '').replace(/\D/g, '').includes(digits)) ||
    e.vehicles.some((v) => v.car_plate.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')));

  const visibleEnquiries = sortedEnquiries.filter(
    (e) =>
      (agentFilter === 'all' || e.agent?.id === agentFilter) &&
      matchesPartner(e) &&
      matchesStatus(e) &&
      matchesDate(e) &&
      matchesSearch(e)
  );

  // Totals for the rows currently on screen, so the strip always agrees with the
  // list below it (and with the unit/admin summaries, which count the same way:
  // customers dedupe by normalised IC, removed cars are excluded). The
  // useMyEnquiries query already filters removed vehicles out of e.vehicles at
  // the PostgREST level (`.is('vehicles.removed_at', null)`), so the
  // `v.removed_at` guard below is redundant but kept to mirror the RPCs'
  // FILTER (WHERE v.removed_at IS NULL) semantics.
  const totals = useMemo(() => {
    const norm = (s: string | null) => (s ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const ics = new Set<string>();
    let icLess = 0;
    let cars = 0;
    let open = 0;
    let renewed = 0;
    for (const e of visibleEnquiries) {
      const ic = norm(e.customer_nric);
      if (ic) ics.add(ic);
      else icLess += 1;
      for (const v of e.vehicles ?? []) {
        if (v.removed_at) continue;
        cars += 1;
        if (v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED) open += 1;
        if (v.status === VehicleStatus.RENEWED) renewed += 1;
      }
    }
    return { forms: visibleEnquiries.length, customers: ics.size + icLess, cars, open, renewed };
  }, [visibleEnquiries]);

  const handleDownload = async () => {
    try {
      const rows = toEnquiryExportRows(visibleEnquiries, agent);
      await buildEnquiriesWorkbook(rows, { generatedAt: new Date().toISOString().slice(0, 10) });
    } catch (err: unknown) {
      toast({
        title: 'Failed to generate report',
        description: (err as Error)?.message,
        variant: 'error',
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-row items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Enquiries</h1>
          <p className="text-sm text-muted-foreground">
            Car-insurance enquiries customers submitted through your enquiry link
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name, car plate, IC or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 h-9 text-sm"
          />
          {isUnitViewer && (
            <Button variant="outline" size="sm" onClick={() => setProposeOpen(true)}>
              <Plus className="size-4 mr-2" />
              Propose Partnership
            </Button>
          )}
          {isUnitViewer && agentOptions.length > 1 && (
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-44 h-9 text-sm">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agentOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name} ({a.agent_code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 h-9 text-sm"
            aria-label="Submitted from"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 h-9 text-sm"
            aria-label="Submitted to"
          />
          <Select value={sortKey} onValueChange={(val) => setSortKey(val as EnquirySortKey)}>
            <SelectTrigger className="w-40 h-9 text-sm">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default order</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="expiry">Insurance expiry</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="partner">Partner</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
            </SelectContent>
          </Select>
          <Select value={partnerFilter} onValueChange={setPartnerFilter}>
            <SelectTrigger className="w-44 h-9 text-sm">
              <SelectValue placeholder="All partners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All partners</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {partnerOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9 text-sm">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={visibleEnquiries.length === 0}
          >
            <Download className="size-4 mr-2" />
            Download
          </Button>
        </div>
      </div>

      {isUnitViewer && agent?.id && (
        <ProposePartnerDialog agentId={agent.id} open={proposeOpen} onOpenChange={setProposeOpen} />
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-4">
            <TableSkeleton rows={4} columns={4} />
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="py-4">
            <p className="text-destructive">Error loading: {(error as Error)?.message}</p>
          </CardContent>
        </Card>
      ) : !enquiries || enquiries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              No enquiries yet. Share your link from My Enquiry Link to start receiving them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-muted/40 px-4 py-2 text-sm">
            <span><strong>{totals.forms}</strong> form{totals.forms === 1 ? '' : 's'}</span>
            <span><strong>{totals.customers}</strong> customer{totals.customers === 1 ? '' : 's'}</span>
            <span><strong>{totals.cars}</strong> car{totals.cars === 1 ? '' : 's'}</span>
            <span className="text-amber-600"><strong>{totals.open}</strong> open</span>
            <span className="text-emerald-600"><strong>{totals.renewed}</strong> renewed</span>
          </div>
          {visibleEnquiries.map((enq) => (
            <EnquiryCard
              key={enq.id}
              enq={enq}
              activeMerchants={activeMerchants}
              agentId={agent?.id}
              showAgent={isUnitViewer}
              readOnly={false}
              isUnitView={isUnitViewer}
              unitRoster={unitRoster ?? []}
            />
          ))}
        </>
      )}
    </div>
  );
}
