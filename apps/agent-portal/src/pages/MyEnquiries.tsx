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
  getStatusVariant,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyEnquiries } from '../hooks/useMyEnquiries';

export function MyEnquiries() {
  const { agent } = useAuth();
  const { data: enquiries, isLoading } = useMyEnquiries(agent?.id);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Enquiries</h1>
        <p className="text-sm text-muted-foreground">
          Car-insurance enquiries customers submitted through your branch QR links
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-4">
            <TableSkeleton rows={4} columns={4} />
          </CardContent>
        </Card>
      ) : !enquiries || enquiries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              No enquiries yet. Share a branch QR from Partnerships to start receiving them.
            </p>
          </CardContent>
        </Card>
      ) : (
        enquiries.map((enq) => (
          <Card key={enq.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base">{enq.customer_name}</CardTitle>
                <CardDescription>
                  {enq.customer_phone}
                  {enq.customer_email ? ` · ${enq.customer_email}` : ''}
                  {' · '}
                  {enq.branch?.merchant?.name ?? 'Unknown merchant'} — {enq.branch?.name ?? 'Unknown branch'}
                </CardDescription>
                <p className="text-xs text-muted-foreground">
                  Submitted {format(parseISO(enq.created_at), 'd MMM yyyy, HH:mm')}
                </p>
              </div>
              <Badge variant={getStatusVariant(enq.status)} className="capitalize">
                {enq.status}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Car Plate</TableHead>
                      <TableHead>Insurance Expiry</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enq.vehicles.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.car_plate}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(parseISO(v.insurance_expiry_date), 'd MMM yyyy')}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {v.product?.name ?? '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(v.status)} className="capitalize">
                            {v.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
