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
} from '@agent-system/shared-ui';
import { Download } from 'lucide-react';
import { EnquiryStatus, VehicleStatus } from '@agent-system/shared-types';
import { useEnquiries, type EnquiryListRow } from '../../hooks/useEnquiries';
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
            <TableSkeleton rows={6} columns={6} />
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
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
                          <div className="text-xs text-muted-foreground">{e.customer_phone}</div>
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
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
