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
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from '@agent-system/shared-ui';
import { EnquiryStatus, VehicleStatus } from '@agent-system/shared-types';
import { useEnquiries, type EnquiryListRow } from '../../hooks/useEnquiries';

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('en-SG', { dateStyle: 'medium' });
}

export function EnquiryList() {
  const { data: enquiries, isLoading, error } = useEnquiries();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = useMemo(
    () => (enquiries ?? []).filter((e) => statusFilter === 'all' || e.status === statusFilter),
    [enquiries, statusFilter]
  );

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Enquiries</h1>
          <p className="text-sm text-muted-foreground">
            Customer car-insurance enquiries from partner branches. Open one to quote, renew, or mark each car lost.
          </p>
        </div>
        <div className="w-40">
          <Label className="text-sm font-medium">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value={EnquiryStatus.OPEN}>Open</SelectItem>
              <SelectItem value={EnquiryStatus.CLOSED}>Closed</SelectItem>
            </SelectContent>
          </Select>
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
                    <TableHead>Branch</TableHead>
                    <TableHead>Source</TableHead>
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
                          {e.branch?.merchant?.name ?? '—'}
                          <div className="text-xs">{e.branch?.name ?? ''}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.agent_id ? 'Agent' : 'House'}
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
