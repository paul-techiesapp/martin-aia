import { useState } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Button, Label,
} from '@agent-system/shared-ui';
import { Download, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useEnquiryUnitSummary,
  useEnquiryAgentSummary,
  type EnquiryUnitSummaryRow,
} from '../../hooks/useEnquirySummary';
import { downloadCsv } from '../../lib/downloadCsv';

function UnitBreakdown({ unit, from, to }: { unit: EnquiryUnitSummaryRow; from: string; to: string }) {
  const { data: agents, isLoading } = useEnquiryAgentSummary(from || undefined, to || undefined, unit.unit_root_id);
  if (isLoading) return <p className="text-muted-foreground py-3 px-4 text-sm">Loading agents…</p>;
  if (!agents?.length) {
    return (
      <p className="text-muted-foreground py-3 px-4 text-sm">
        {unit.unit_root_id === null
          ? 'These enquiries have no assigned agent.'
          : 'No agent activity in this range.'}
      </p>
    );
  }
  return (
    <div className="overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">Forms</TableHead>
            <TableHead className="text-right">Customers</TableHead>
            <TableHead className="text-right">Cars</TableHead>
            <TableHead className="text-right">Open</TableHead>
            <TableHead className="text-right">Renewed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((a) => (
            <TableRow key={a.agent_id}>
              <TableCell className="font-medium">
                {a.agent_name}
                <div className="text-xs text-muted-foreground">{a.agent_code}</div>
              </TableCell>
              <TableCell className="text-right">{a.forms_submitted}</TableCell>
              <TableCell className="text-right">{a.customers}</TableCell>
              <TableCell className="text-right text-muted-foreground">{a.cars}</TableCell>
              <TableCell className="text-right text-amber-600">{a.cars_open}</TableCell>
              <TableCell className="text-right text-emerald-600">{a.cars_renewed}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EnquiriesReportTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: units, isLoading } = useEnquiryUnitSummary(from || undefined, to || undefined);

  const totals = (units ?? []).reduce(
    (acc, u) => ({
      forms: acc.forms + u.forms_submitted,
      customers: acc.customers + u.customers,
      cars: acc.cars + u.cars,
      open: acc.open + u.cars_open,
      renewed: acc.renewed + u.cars_renewed,
    }),
    { forms: 0, customers: 0, cars: 0, open: 0, renewed: 0 },
  );

  // Two different unit roots can share the same display name (e.g. a unit
  // renamed/recreated in production). The RPC groups by (unit_name,
  // unit_root_id) so the numbers stay correct, but rendering two identically
  // titled rows reads as the reporting bug this feature exists to fix — so
  // disambiguate any name that occurs more than once with its root id.
  const unitNameCounts = (units ?? []).reduce<Record<string, number>>((acc, u) => {
    acc[u.unit_name] = (acc[u.unit_name] ?? 0) + 1;
    return acc;
  }, {});

  const expandedUnit = (units ?? []).find((u) => (u.unit_root_id ?? u.unit_name) === expanded);

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Enquiries by Unit</CardTitle>
            <CardDescription>
              Car-insurance enquiry forms grouped by unit · {units?.length ?? 0} unit
              {(units?.length ?? 0) === 1 ? '' : 's'} · {totals.forms} form
              {totals.forms === 1 ? '' : 's'}
            </CardDescription>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">From</Label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">To</Label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!units?.length}
              onClick={() =>
                downloadCsv('enquiries-by-unit', [
                  ['Unit', 'Forms Submitted', 'Customers', 'Cars', 'Open', 'Renewed', 'Agents'],
                  ...(units ?? []).map((u) => [
                    u.unit_name, u.forms_submitted, u.customers, u.cars, u.cars_open, u.cars_renewed, u.agents_active,
                  ]),
                ])
              }
            >
              <Download className="size-4 mr-1.5" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-center py-6">Loading units…</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Forms Submitted</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Cars</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Renewed</TableHead>
                    <TableHead className="text-right">Agents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(units ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        No enquiries found for this date range.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {units!.map((u) => (
                        <TableRow key={u.unit_root_id ?? u.unit_name}>
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 hover:underline"
                              onClick={() =>
                                setExpanded(expanded === (u.unit_root_id ?? u.unit_name) ? null : (u.unit_root_id ?? u.unit_name))
                              }
                            >
                              {expanded === (u.unit_root_id ?? u.unit_name)
                                ? <ChevronDown className="size-4" />
                                : <ChevronRight className="size-4" />}
                              {u.unit_name}
                            </button>
                            {unitNameCounts[u.unit_name] > 1 && u.unit_root_id && (
                              <div className="text-xs text-muted-foreground">{u.unit_root_id.slice(0, 8)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">{u.forms_submitted}</TableCell>
                          <TableCell className="text-right">{u.customers}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{u.cars}</TableCell>
                          <TableCell className="text-right text-amber-600">{u.cars_open}</TableCell>
                          <TableCell className="text-right text-emerald-600">{u.cars_renewed}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{u.agents_active}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="hover:bg-transparent border-t-2">
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-semibold">{totals.forms}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.customers}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.cars}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.open}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.renewed}</TableCell>
                        <TableCell />
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {expandedUnit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {expandedUnit.unit_name} — by agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UnitBreakdown
              unit={expandedUnit}
              from={from}
              to={to}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
