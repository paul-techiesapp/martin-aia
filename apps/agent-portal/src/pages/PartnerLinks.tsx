import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  StatCard,
  StatCardGrid,
  Skeleton,
  InvitationCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@agent-system/shared-ui';
import { Link2, Copy, Check, Calendar, MapPin, UserCheck, CheckCircle, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useActiveCampaigns, useCampaignSlots } from '../hooks/useCampaigns';
import { usePartnerLinks, useCreateLink } from '../hooks/useAgentLinks';
import { usePartnerRegistrationStats } from '../hooks/useRegistrations';
import type { Slot } from '@agent-system/shared-types';

export function PartnerLinks() {
  const { partner, role } = useAuth();

  // Role guard: only partners can access this page
  if (role && role !== 'partner') {
    return (
      <div className="p-6 text-center text-slate-500">
        <p>This page is only available to partners.</p>
      </div>
    );
  }

  const { data: campaigns, isLoading: campaignsLoading } = useActiveCampaigns();
  const { data: links, isLoading: linksLoading } = usePartnerLinks(partner?.id);
  const { data: stats, isLoading: statsLoading } = usePartnerRegistrationStats(partner?.id);
  const createLink = useCreateLink();
  const { toast } = useToast();

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [creatingSlotId, setCreatingSlotId] = useState<string | null>(null);

  const { data: slots } = useCampaignSlots(selectedCampaignId ?? '');

  const getExistingLink = (slotId: string) => {
    return links?.find((l) => l.slot.id === slotId);
  };

  const handleGetLink = async (slotId: string) => {
    if (!partner?.agent_id || !partner?.id) return;
    setCreatingSlotId(slotId);
    try {
      const link = await createLink.mutateAsync({
        agentId: partner.agent_id,
        slotId,
        partnerId: partner.id,
      });
      const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
      const url = `${publicPagesUrl}/public/register/${link.link_code}`;
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link created & copied!', description: 'Share this link with your invitees.' });
    } catch (err: any) {
      toast({ title: 'Failed to create link', description: err.message, variant: 'error' });
    } finally {
      setCreatingSlotId(null);
    }
  };

  const handleCopyLink = async (linkCode: string, linkId: string) => {
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const url = `${publicPagesUrl}/public/register/${linkCode}`;
    await navigator.clipboard.writeText(url);
    setCopiedLinkId(linkId);
    toast({ title: 'Link copied!', description: 'Share this link with your invitees.' });
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const isLoading = campaignsLoading || linksLoading || statsLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">My Links</h1>
        <p className="text-slate-500 mt-1">
          Generate and share registration links under {partner?.agent?.name ?? 'your unit'}
        </p>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Registered"
          value={stats?.registered ?? 0}
          icon={UserCheck}
          iconColor="sky"
          description="Signed up via your links"
          loading={isLoading}
        />
        <StatCard
          title="Attended"
          value={stats?.attended ?? 0}
          icon={Users}
          iconColor="amber"
          description="Checked in at event"
          loading={isLoading}
        />
        <StatCard
          title="Completed"
          value={stats?.completed ?? 0}
          icon={CheckCircle}
          iconColor="emerald"
          description="Full attendance"
          loading={isLoading}
        />
      </StatCardGrid>

      {/* Campaign Selection */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Select an Event</h2>
        {campaignsLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="glass-card">
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : campaigns?.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="p-6">
              <p className="text-slate-500 text-center">No active events available</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns?.map((campaign) => (
              <Card
                key={campaign.id}
                className={`glass-card cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-xl ${
                  selectedCampaignId === campaign.id
                    ? 'ring-2 ring-sky-500 shadow-lg shadow-sky-500/10'
                    : 'hover:border-sky-200'
                }`}
                onClick={() => setSelectedCampaignId(campaign.id)}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-slate-900">
                    <div className="h-8 w-8 rounded-lg bg-sky-100 flex items-center justify-center">
                      <Calendar className="h-4 w-4 text-sky-600" />
                    </div>
                    {campaign.name}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1 text-slate-500">
                    <MapPin className="h-4 w-4" />
                    {campaign.venue}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-slate-600">
                    {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Slots for Selected Campaign */}
      {selectedCampaignId && slots && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Event Slots</CardTitle>
            <CardDescription>Get your shareable link for each slot</CardDescription>
          </CardHeader>
          <CardContent>
            {slots.length === 0 ? (
              <p className="text-slate-500">No slots available for this event</p>
            ) : (
              <div className="space-y-3">
                {slots.map((slot: Slot) => {
                  const existingLink = getExistingLink(slot.id);
                  const regCount = existingLink?.registration_count ?? 0;

                  return (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-slate-900">
                          {format(parseISO(slot.start_at), 'd MMM yyyy')}
                        </div>
                        <div className="text-sm text-slate-500">
                          {format(parseISO(slot.start_at), 'HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
                        </div>
                        {existingLink && (
                          <div className="mt-1 text-sm text-sky-600">
                            {regCount} registered
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {existingLink ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyLink(existingLink.link_code, existingLink.id)}
                          >
                            {copiedLinkId === existingLink.id ? (
                              <>
                                <Check className="h-4 w-4 mr-1 text-emerald-600" /> Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4 mr-1" /> Copy Link
                              </>
                            )}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleGetLink(slot.id)}
                            disabled={creatingSlotId === slot.id}
                            className="bg-slate-900 hover:bg-slate-800"
                          >
                            <Link2 className="h-4 w-4 mr-1" />
                            {creatingSlotId === slot.id ? 'Creating...' : 'Get My Link'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing Links Summary */}
      {links && links.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">My Active Links</CardTitle>
            <CardDescription>
              {links.length} link{links.length !== 1 ? 's' : ''} created
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TooltipProvider>
              <div className="space-y-3">
                {links.map((link) => (
                  <InvitationCard
                    key={link.id}
                    eventName={link.slot?.campaign?.name ?? 'Unknown Event'}
                    venue={link.slot?.campaign?.venue ?? '-'}
                    date={link.slot ? parseISO(link.slot.start_at) : new Date()}
                    startTime={link.slot ? format(parseISO(link.slot.start_at), 'HH:mm') : '-'}
                    actions={
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleCopyLink(link.link_code, link.id)}
                            aria-label="Copy registration link"
                          >
                            {copiedLinkId === link.id ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {copiedLinkId === link.id ? 'Link copied!' : 'Copy registration link'}
                        </TooltipContent>
                      </Tooltip>
                    }
                  />
                ))}
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
