import { useState } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge, Button, getStatusVariant, TableSkeleton,
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { Plus, Store } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useAgentMerchants, useMyLinkedMerchantIds } from '../hooks/useAgentMerchants';
import { isMerchantAvailableToAgent } from '../lib/partnerScope';
import { ProposePartnerDialog } from '../components/ProposePartnerDialog';

// Round 4 item 8: partnership merchants the agent proposed, with status —
// distinct from event-recruitment "Event Partners".
export function MyPartners() {
  const { agent, isUnitViewer } = useAuth();
  const { data: merchants, isLoading } = useAgentMerchants();
  const [proposeOpen, setProposeOpen] = useState(false);

  const { data: linkedMerchantIds } = useMyLinkedMerchantIds(agent?.id);
  // Round 5 item 4b: every agent sees the partners available to them —
  // masters + branch-linked + own proposals (own pending ones included).
  const myMerchants = (merchants ?? []).filter(
    (m) =>
      m.created_by_agent_id === agent?.id ||
      isMerchantAvailableToAgent(m, agent?.id, linkedMerchantIds ?? new Set<string>()),
  );
  const sourceOf = (m: (typeof myMerchants)[number]): string =>
    m.created_by_agent_id === agent?.id
      ? 'Proposed by you'
      : m.is_master
        ? 'Master'
        : 'Linked';

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-row items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Partners</h1>
          <p className="text-sm text-muted-foreground">
            Partnership merchants available to you — master partners, branch-linked partners, and your own proposals
          </p>
        </div>
        {isUnitViewer && (
          <Button variant="outline" size="sm" onClick={() => setProposeOpen(true)}>
            <Plus className="size-4 mr-2" />
            Propose Partnership
          </Button>
        )}
      </div>
      {isUnitViewer && agent?.id && (
        <ProposePartnerDialog agentId={agent.id} open={proposeOpen} onOpenChange={setProposeOpen} />
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="size-4" /> Available Partners
          </CardTitle>
          <CardDescription>{myMerchants.length} partners</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : myMerchants.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              No partners available yet. Master partners appear here automatically once set up.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Branches</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Proposed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myMerchants.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.contact_person ?? '—'}{m.contact_phone ? ` · ${m.contact_phone}` : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.branches.map((b) => b.name).join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{sourceOf(m)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(parseISO(m.created_at), 'd MMM yyyy')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(m.status)} className="capitalize">{m.status}</Badge>
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
