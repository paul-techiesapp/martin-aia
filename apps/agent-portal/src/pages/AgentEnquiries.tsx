import { useParams, Link } from '@tanstack/react-router';
import { Card, CardContent, TableSkeleton } from '@agent-system/shared-ui';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyEnquiries } from '../hooks/useMyEnquiries';
import { useAgentMerchants, useMyLinkedMerchantIds } from '../hooks/useAgentMerchants';
import { useUnitRoster } from '../hooks/useSubAgents';
import { isMerchantAvailableToAgent } from '../lib/partnerScope';
import { EnquiryCard } from './MyEnquiries';

/**
 * Per-agent enquiries drill-down (round 6, item 5): reached from a roster row
 * in My Agents. Scopes useMyEnquiries to the TARGET agent's id with
 * unitWide=false — unit RLS grants the viewing unit-admin/unit-manager read
 * access to that agent's rows even though it isn't their own id.
 */
export function AgentEnquiries() {
  const { agentId } = useParams({ strict: false }) as { agentId: string };
  const { role, isUnitViewer } = useAuth();

  // Only unit viewers (admin + unit managers) may drill into another agent's
  // enquiries — mirrors the guard in TeamReport.tsx.
  if (role && !isUnitViewer) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>This page is only available to Unit Managers and Unit Admins.</p>
      </div>
    );
  }

  // Server-side unit roster (recursive) — empty for non unit-viewers, and the
  // page is already guarded to viewers above.
  const { data: unitRoster } = useUnitRoster(isUnitViewer);
  const targetAgent = unitRoster?.find((a) => a.id === agentId);

  const { data: enquiries, isLoading, isError, error } = useMyEnquiries(agentId, false);
  const { data: merchants } = useAgentMerchants();
  const { data: linkedMerchantIds } = useMyLinkedMerchantIds(agentId);

  const activeMerchants =
    merchants?.filter((m) =>
      isMerchantAvailableToAgent(m, agentId, linkedMerchantIds ?? new Set<string>()),
    ) ?? [];

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link
          to="/my-agents"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="size-4" /> Back to My Agents
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {targetAgent?.name ?? 'Agent'}'s Enquiries
        </h1>
        <p className="text-sm text-muted-foreground">
          Car-insurance enquiries submitted through this agent's enquiry link.
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
            <p className="text-muted-foreground">No enquiries yet for this agent.</p>
          </CardContent>
        </Card>
      ) : (
        enquiries.map((enq) => (
          <EnquiryCard
            key={enq.id}
            enq={enq}
            activeMerchants={activeMerchants}
            agentId={agentId}
            showAgent={false}
            readOnly={false}
            isUnitView={true}
            unitRoster={unitRoster ?? []}
          />
        ))
      )}
    </div>
  );
}
