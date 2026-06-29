import { useState } from 'react';
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
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { Store } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyEnquiries } from '../hooks/useMyEnquiries';
import { useAssignEnquiryMerchant } from '../hooks/useMyEnquiryLink';
import { useAgentMerchants } from '../hooks/useAgentMerchants';
import { MerchantStatus } from '@agent-system/shared-types';

export function MyEnquiries() {
  const { agent } = useAuth();
  const { toast } = useToast();
  const { data: enquiries, isLoading, isError, error } = useMyEnquiries(agent?.id);
  const { data: merchants } = useAgentMerchants();
  const assignMerchant = useAssignEnquiryMerchant(agent?.id);

  // Tracks the selected merchant per enquiry row
  const [selectedMerchants, setSelectedMerchants] = useState<Record<string, string>>({});

  const activeMerchants = merchants?.filter((m) => m.status === MerchantStatus.ACTIVE) ?? [];

  const handleAssign = async (enquiryId: string) => {
    const merchantId = selectedMerchants[enquiryId];
    if (!merchantId) return;
    try {
      await assignMerchant.mutateAsync({ enquiryId, merchantId });
      toast({ title: 'Partnership assigned' });
      setSelectedMerchants((s) => {
        const next = { ...s };
        delete next[enquiryId];
        return next;
      });
    } catch (err: unknown) {
      toast({
        title: 'Failed to assign',
        description: (err as Error)?.message,
        variant: 'error',
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Enquiries</h1>
        <p className="text-sm text-muted-foreground">
          Car-insurance enquiries customers submitted through your enquiry link
        </p>
      </div>

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
        enquiries.map((enq) => (
          <Card key={enq.id}>
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
              </div>
              <Badge variant={getStatusVariant(enq.status)} className="capitalize">
                {enq.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Partnership assignment */}
              <div className="flex items-center gap-2">
                <Store className="size-4 text-muted-foreground shrink-0" />
                {enq.merchant_id ? (
                  <span className="text-sm font-medium text-foreground">
                    {enq.merchant?.name ?? 'Assigned'}
                  </span>
                ) : (
                  <>
                    <Select
                      value={selectedMerchants[enq.id] ?? ''}
                      onValueChange={(v) =>
                        setSelectedMerchants((s) => ({ ...s, [enq.id]: v }))
                      }
                    >
                      <SelectTrigger className="w-52 h-8 text-sm">
                        <SelectValue placeholder="Assign to Partnership" />
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
                      disabled={!selectedMerchants[enq.id] || assignMerchant.isPending}
                      onClick={() => handleAssign(enq.id)}
                    >
                      Assign
                    </Button>
                  </>
                )}
              </div>

              {/* Vehicle table */}
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
