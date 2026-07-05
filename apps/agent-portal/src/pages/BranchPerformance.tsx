import { useQuery } from '@tanstack/react-query';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge, getStatusVariant, TableSkeleton,
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';

interface BranchStat {
  branch_id: string; branch_name: string; branch_status: string;
  total_leads: number; leads_this_month: number; last_lead_at: string | null;
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
    </div>
  );
}
