import { useState, Fragment } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  getStatusVariant,
  TableSkeleton,
  useToast,
  buildEnquiriesWorkbook,
  type EnquiryExportRow,
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { FileText, Store, Download, Plus } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyEnquiries, type EnquiryWithDetails } from '../hooks/useMyEnquiries';
import { useAssignVehicleMerchant } from '../hooks/useAssignVehicleMerchant';
import { useAgentMerchants, type MerchantWithBranches } from '../hooks/useAgentMerchants';
import { useRequestQuote } from '../hooks/useRequestQuote';
import { ProposePartnerDialog } from '../components/ProposePartnerDialog';
import { compareMyEnquiries } from './myEnquiriesSort';
import { MerchantStatus, VehicleStatus, type AgentWithTier } from '@agent-system/shared-types';
import { useEnquiryAttachments, useViewAttachment } from '../hooks/useEnquiryAttachments';

interface EnquiryCardProps {
  enq: EnquiryWithDetails;
  activeMerchants: MerchantWithBranches[];
  agentId: string | undefined;
  /** Show the owning agent (unit viewer looking at unit-wide enquiries). */
  showAgent?: boolean;
  /** Hide mutating controls (Assign partner, Get Quote) — viewer doesn't own this row. */
  readOnly?: boolean;
}

function EnquiryCard({ enq, activeMerchants, agentId, showAgent, readOnly }: EnquiryCardProps) {
  const { toast } = useToast();
  const assignVehicleMerchant = useAssignVehicleMerchant(agentId);
  const requestQuote = useRequestQuote(agentId);
  // Per-vehicle partner selection, keyed by vehicle id (a multi-car enquiry can
  // send each car to a different partner).
  const [vehicleMerchant, setVehicleMerchant] = useState<Record<string, string>>({});
  const [assigningVehicleId, setAssigningVehicleId] = useState<string | null>(null);
  const [quotingVehicleId, setQuotingVehicleId] = useState<string | null>(null);
  const { data: attachments = [] } = useEnquiryAttachments(enq.id);
  const viewAttachment = useViewAttachment();

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
        <Badge variant={getStatusVariant(enq.status)} className="capitalize">
          {enq.status}
        </Badge>
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
                      </TableCell>
                    </TableRow>
                    {vehicleAttachments.length > 0 && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="py-1 pl-4 bg-muted/30">
                          <div className="flex flex-wrap gap-1.5">
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
      </CardContent>
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
  const { agent, role, isUnitViewer } = useAuth();
  const { toast } = useToast();
  const { data: enquiries, isLoading, isError, error } = useMyEnquiries(agent?.id, isUnitViewer);
  const { data: merchants } = useAgentMerchants();

  const [proposeOpen, setProposeOpen] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>('all');

  const activeMerchants = merchants?.filter((m) => m.status === MerchantStatus.ACTIVE) ?? [];

  // Default ordering: Partner -> Status (open first) -> earliest expiry -> newest.
  const sortedEnquiries = [...(enquiries ?? [])].sort(compareMyEnquiries);

  const agentOptions = Array.from(
    new Map(
      (enquiries ?? [])
        .filter((e) => e.agent)
        .map((e) => [e.agent!.id, e.agent!])
    ).values()
  );
  const visibleEnquiries = sortedEnquiries.filter(
    (e) => agentFilter === 'all' || e.agent?.id === agentFilter
  );

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
        <div className="flex items-center gap-2">
          {role === 'agent_admin' && (
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

      {role === 'agent_admin' && agent?.id && (
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
        visibleEnquiries.map((enq) => (
          <EnquiryCard
            key={enq.id}
            enq={enq}
            activeMerchants={activeMerchants}
            agentId={agent?.id}
            showAgent={isUnitViewer}
            readOnly={isUnitViewer && enq.agent_id !== agent?.id}
          />
        ))
      )}
    </div>
  );
}
