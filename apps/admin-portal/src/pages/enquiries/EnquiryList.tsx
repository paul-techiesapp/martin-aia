import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
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
  Button,
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  buildEnquiriesWorkbook,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  useToast,
} from '@agent-system/shared-ui';
import { Download } from 'lucide-react';
import { EnquiryStatus, VehicleStatus } from '@agent-system/shared-types';
import {
  useEnquiries,
  useReassignCustomerAgent,
  type EnquiryListRow,
} from '../../hooks/useEnquiries';
import { useAllAgents } from '../../hooks/useAllAgents';
import { compareEnquiries, toEnquiryExportRows } from './enquirySort';

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('en-SG', { dateStyle: 'medium' });
}

const ALL = 'all';

export function EnquiryList() {
  const { data: enquiries, isLoading, error } = useEnquiries();
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [unitFilter, setUnitFilter] = useState<string>(ALL);
  const [agentFilter, setAgentFilter] = useState<string>(ALL);
  const [partnerFilter, setPartnerFilter] = useState<string>(ALL);

  const unitOptions = useMemo(
    () => Array.from(new Set((enquiries ?? []).map((e) => e.agent?.unit_name).filter(Boolean))).sort() as string[],
    [enquiries]
  );
  const agentOptions = useMemo(
    () => Array.from(new Set((enquiries ?? []).map((e) => e.agent?.name).filter(Boolean))).sort() as string[],
    [enquiries]
  );
  const partnerOptions = useMemo(
    () => Array.from(new Set((enquiries ?? []).map((e) => e.merchant?.name).filter(Boolean))).sort() as string[],
    [enquiries]
  );

  const filtered = useMemo(
    () =>
      (enquiries ?? [])
        .filter((e) => statusFilter === ALL || e.status === statusFilter)
        .filter((e) => unitFilter === ALL || e.agent?.unit_name === unitFilter)
        .filter((e) => agentFilter === ALL || e.agent?.name === agentFilter)
        .filter((e) => partnerFilter === ALL || e.merchant?.name === partnerFilter)
        .slice()
        .sort(compareEnquiries),
    [enquiries, statusFilter, unitFilter, agentFilter, partnerFilter]
  );

  const { toast } = useToast();
  const { data: allAgents } = useAllAgents();
  const reassign = useReassignCustomerAgent();

  // Reassign dialog: holds the clicked row (null = closed).
  const [reassignTarget, setReassignTarget] = useState<EnquiryListRow | null>(null);
  const [reassignAgentId, setReassignAgentId] = useState('');

  // How many of this customer's enquiries will actually move: same IC, and at
  // least one car still submitted/quoted. Shown before confirming, because the
  // admin clicked ONE row but is about to change several.
  const reassignImpact = useMemo(() => {
    if (!reassignTarget) return 0;
    const norm = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const targetNric = norm(reassignTarget.customer_nric);
    return (enquiries ?? []).filter(
      (e) =>
        norm(e.customer_nric) === targetNric &&
        (e.vehicles ?? []).some(
          (v) => v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED,
        ),
    ).length;
  }, [enquiries, reassignTarget]);

  const submitReassign = async () => {
    if (!reassignTarget) return;
    if (!reassignAgentId) {
      toast({ title: 'Select an agent', variant: 'error' });
      return;
    }
    try {
      const moved = await reassign.mutateAsync({
        customerNric: reassignTarget.customer_nric,
        newAgentId: reassignAgentId,
      });
      toast({
        title: moved > 0 ? `Reassigned ${moved} enquiry(s)` : 'Nothing to reassign',
        description:
          moved > 0
            ? 'Completed enquiries stay with the original agent.'
            : 'This customer has no open enquiries.',
      });
      setReassignTarget(null);
      setReassignAgentId('');
    } catch (err: any) {
      toast({ title: 'Failed to reassign', description: err.message, variant: 'error' });
    }
  };

  const handleDownload = () => {
    void buildEnquiriesWorkbook(toEnquiryExportRows(filtered), {
      generatedAt: new Date().toISOString().slice(0, 10),
    });
  };

  const vehicleSummary = (e: EnquiryListRow) => {
    const total = e.vehicles?.length ?? 0;
    const open = (e.vehicles ?? []).filter(
      (v) => v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED
    ).length;
    return `${total} car${total === 1 ? '' : 's'}${open > 0 ? ` · ${open} open` : ''}`;
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading enquiries: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Enquiries</h1>
            <p className="text-sm text-muted-foreground">
              Customer car-insurance enquiries. Open one to quote, renew, or mark each car lost.
            </p>
          </div>
          <Button variant="outline" onClick={handleDownload} disabled={filtered.length === 0}>
            <Download className="size-4 mr-1.5" />
            Download report
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Unit</Label>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All units</SelectItem>
                {unitOptions.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All agents</SelectItem>
                {agentOptions.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Partner</Label>
            <Select value={partnerFilter} onValueChange={setPartnerFilter}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All partners</SelectItem>
                {partnerOptions.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value={EnquiryStatus.OPEN}>Open</SelectItem>
                <SelectItem value={EnquiryStatus.CLOSED}>Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>{filtered.length} enquiries</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={6} columns={7} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Partnership</TableHead>
                    <TableHead>Agent / Unit</TableHead>
                    <TableHead>Cars</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        No enquiries match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          <Link
                            to="/enquiries/$enquiryId"
                            params={{ enquiryId: e.id }}
                            className="hover:underline"
                          >
                            {e.customer_name}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {e.customer_phone}
                            {e.staff_id ? ` · Staff ID: ${e.staff_id}` : ''}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.merchant?.name ?? 'Unassigned'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.agent ? (
                            <>
                              <div className="text-foreground">{e.agent.name}</div>
                              <div className="text-xs">{e.agent.unit_name}</div>
                            </>
                          ) : (
                            'House'
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{vehicleSummary(e)}</TableCell>
                        <TableCell>
                          <Badge variant={e.status === EnquiryStatus.CLOSED ? 'success' : 'warning'}>
                            {e.status === EnquiryStatus.CLOSED ? 'Closed' : 'Open'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(e.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setReassignTarget(e);
                              setReassignAgentId(e.agent_id ?? '');
                            }}
                          >
                            Reassign agent
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!reassignTarget}
        onOpenChange={(open) => {
          if (!open) {
            setReassignTarget(null);
            setReassignAgentId('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign customer to another agent</DialogTitle>
            <DialogDescription>
              This moves <strong>every open enquiry</strong> for{' '}
              {reassignTarget?.customer_name} (IC {reassignTarget?.customer_nric}) — not just
              this row. {reassignImpact} enquiry(s) will move. Enquiries whose cars are all
              renewed or lost stay with the original agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New agent</Label>
            <Select value={reassignAgentId} onValueChange={setReassignAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {(allAgents ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} — {a.unit_name} ({a.agent_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitReassign} disabled={reassign.isPending}>
              {reassign.isPending ? 'Reassigning...' : 'Reassign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
