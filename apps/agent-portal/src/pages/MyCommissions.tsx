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
  StatCard,
  StatCardGrid,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { Banknote, Clock, CheckCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyCommissions } from '../hooks/useMyCommissions';
import { RewardStatus } from '@agent-system/shared-types';

function fmtDateTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

// 'paid' === Issued/Sent, matching the Rewards page semantics.
function commissionDisplay(status: RewardStatus): {
  label: string;
  variant: 'pending' | 'paid' | 'error';
} {
  switch (status) {
    case RewardStatus.PAID:
      return { label: 'Issued', variant: 'paid' };
    case RewardStatus.FAILED:
      return { label: 'Failed', variant: 'error' };
    default:
      return { label: 'Pending', variant: 'pending' };
  }
}

export function MyCommissions() {
  const { agent } = useAuth();
  const { data: commissions, isLoading, isError, error } = useMyCommissions(agent?.id);

  const rows = commissions ?? [];
  const total = rows.reduce((sum, c) => sum + (c.amount || 0), 0);
  const pending = rows
    .filter((c) => c.status !== RewardStatus.PAID && c.status !== RewardStatus.FAILED)
    .reduce((sum, c) => sum + (c.amount || 0), 0);
  const issued = rows
    .filter((c) => c.status === RewardStatus.PAID)
    .reduce((sum, c) => sum + (c.amount || 0), 0);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Commissions</h1>
        <p className="text-sm text-muted-foreground">
          Commissions earned when customers renew through your tied branch links
        </p>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Total"
          value={`RM${total.toFixed(2)}`}
          icon={Banknote}
          iconColor="emerald"
          description={`${rows.length} commission${rows.length !== 1 ? 's' : ''}`}
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={`RM${pending.toFixed(2)}`}
          icon={Clock}
          iconColor="amber"
          description="Awaiting issuance"
          loading={isLoading}
        />
        <StatCard
          title="Issued"
          value={`RM${issued.toFixed(2)}`}
          icon={CheckCircle}
          iconColor="sky"
          description="Sent to you"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader>
          <CardTitle>Commission History</CardTitle>
          <CardDescription>One row per renewed vehicle on a tied branch link</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : isError ? (
            <Card>
              <CardContent className="py-4">
                <p className="text-destructive">Error loading: {(error as Error)?.message}</p>
              </CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">
              No commissions yet. You earn one when a customer renews through a branch QR tied to you.
            </p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Car Plate</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => {
                    const display = commissionDisplay(c.status);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {c.vehicle?.enquiry?.customer_name ?? '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.vehicle?.car_plate ?? '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.vehicle?.insurance_expiry_date
                            ? format(parseISO(c.vehicle.insurance_expiry_date), 'd MMM yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600">
                          RM{c.amount.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={display.variant}>{display.label}</Badge>
                          {c.status === RewardStatus.PAID && c.paid_at && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {fmtDateTime(c.paid_at)}
                            </div>
                          )}
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
    </div>
  );
}
