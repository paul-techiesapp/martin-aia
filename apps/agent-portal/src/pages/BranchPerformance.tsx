import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge, getStatusVariant, TableSkeleton,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Input,
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';

interface BranchStat {
  branch_id: string; branch_name: string; branch_status: string;
  total_leads: number; leads_this_month: number; last_lead_at: string | null;
}

interface BranchLead {
  lead_created_at: string;
  branch_name: string;
  staff_id: string | null;
  customer_name: string | null;
  car_plate: string | null;
  insurance_expiry_date: string | null;
  vehicle_status: string;
}

// Master-partner view: leads submitted through each branch's own link/QR.
// Agent-assigned partnership leads are intentionally excluded.
export function BranchPerformance() {
  const { data, isLoading } = useQuery({
    queryKey: ['merchant-branch-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('merchant_branch_stats');
      if (error) throw error;
      return (data ?? []) as BranchStat[];
    },
  });
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ['merchant-branch-leads'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('merchant_branch_leads');
      if (error) throw error;
      return (data ?? []) as BranchLead[];
    },
  });

  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<'newest' | 'oldest' | 'staff' | 'branch'>('newest');
  const branchNames = Array.from(new Set((leads ?? []).map((l) => l.branch_name)));
  // Date range compares the yyyy-mm-dd prefix of the ISO timestamp; empty
  // bounds are unbounded. From > To simply matches nothing.
  const visibleLeads = (leads ?? [])
    .filter(
      (l) =>
        (branchFilter === 'all' || l.branch_name === branchFilter) &&
        (statusFilter === 'all' || l.vehicle_status === statusFilter) &&
        (!dateFrom || l.lead_created_at.slice(0, 10) >= dateFrom) &&
        (!dateTo || l.lead_created_at.slice(0, 10) <= dateTo),
    )
    .sort((a, b) => {
      switch (sortKey) {
        case 'oldest':
          return a.lead_created_at.localeCompare(b.lead_created_at);
        case 'staff':
          return (a.staff_id ?? '').localeCompare(b.staff_id ?? '') || b.lead_created_at.localeCompare(a.lead_created_at);
        case 'branch':
          return a.branch_name.localeCompare(b.branch_name) || b.lead_created_at.localeCompare(a.lead_created_at);
        default:
          return b.lead_created_at.localeCompare(a.lead_created_at);
      }
    });

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Branch Performance</h1>
        <p className="text-sm text-muted-foreground">
          Leads submitted through each branch's enquiry link
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branches</CardTitle>
          <CardDescription>{data?.length ?? 0} branches</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total Leads</TableHead>
                  <TableHead className="text-right">This Month</TableHead>
                  <TableHead>Last Lead</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((b) => (
                  <TableRow key={b.branch_id}>
                    <TableCell className="font-medium">{b.branch_name}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(b.branch_status)} className="capitalize">{b.branch_status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{b.total_leads}</TableCell>
                    <TableCell className="text-right">{b.leads_this_month}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.last_lead_at ? format(parseISO(b.last_lead_at), 'd MMM yyyy, HH:mm') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Lead-level detail: name/plate are shown (customers submitted at the
          merchant's own branch); NRIC, phone and email are never returned. */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">Recent Leads</CardTitle>
            <CardDescription>
              {visibleLeads.length} of {leads?.length ?? 0} leads (latest 200)
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="staff">Staff ID</SelectItem>
                <SelectItem value="branch">Branch</SelectItem>
              </SelectContent>
            </Select>
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
            {branchNames.length > 1 && (
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-40 h-9 text-sm">
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {branchNames.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="quoted">Quoted</SelectItem>
                <SelectItem value="renewed">Renewed</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {leadsLoading ? (
            <TableSkeleton rows={4} columns={6} />
          ) : visibleLeads.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">No leads yet.</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Staff ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Car Plate</TableHead>
                    <TableHead>Insurance Expiry</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLeads.map((l, i) => (
                    <TableRow key={`${l.lead_created_at}-${l.car_plate}-${i}`}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {format(parseISO(l.lead_created_at), 'd MMM yyyy, HH:mm')}
                      </TableCell>
                      <TableCell>{l.branch_name}</TableCell>
                      <TableCell className="text-muted-foreground">{l.staff_id ?? '—'}</TableCell>
                      <TableCell className="font-medium">{l.customer_name ?? '—'}</TableCell>
                      <TableCell>{l.car_plate ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {l.insurance_expiry_date
                          ? format(parseISO(l.insurance_expiry_date), 'd MMM yyyy')
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(l.vehicle_status)} className="capitalize">
                          {l.vehicle_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
