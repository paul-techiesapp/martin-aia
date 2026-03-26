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
  Button,
  Badge,
  getStatusVariant,
  StatCard,
  StatCardGrid,
  Skeleton,
  TableSkeleton,
  InvitationCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@agent-system/shared-ui';
import { Link2, Copy, Check, MapPin, UserCheck, CheckCircle, Users, FileDown, Loader2 } from 'lucide-react';
import { generateBulkInvitationCards } from '@agent-system/shared-ui';
import type { InvitationCardData } from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useActiveCampaigns, useCampaignSlots } from '../hooks/useCampaigns';
import { useMyLinks, useCreateLink } from '../hooks/useAgentLinks';
import { useRegistrationsBySlot, useRegistrationStats } from '../hooks/useRegistrations';
import { useSystemSettings } from '../hooks/useSystemSettings';
import { DEFAULT_CARD_TEMPLATE, DEFAULT_COMPANY_BRANDING } from '@agent-system/shared-types';
import type { Slot } from '@agent-system/shared-types';

export function MyLinks() {
  const { agent } = useAuth();
  const { data: campaigns, isLoading: campaignsLoading } = useActiveCampaigns();
  const { data: links, isLoading: linksLoading } = useMyLinks(agent?.id);
  const { data: stats, isLoading: statsLoading } = useRegistrationStats(agent?.id);
  const createLink = useCreateLink();
  const { toast } = useToast();
  const { data: systemSettings } = useSystemSettings();

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [creatingSlotId, setCreatingSlotId] = useState<string | null>(null);
  const [downloadingLinkId, setDownloadingLinkId] = useState<string | null>(null);

  const { data: slots } = useCampaignSlots(selectedCampaignId ?? '');
  const { data: slotRegistrations } = useRegistrationsBySlot(agent?.id, selectedSlotId ?? undefined);

  const maxPerSlot = agent?.tier?.invitation_limit_per_slot ?? 0;

  const getExistingLink = (slotId: string) => {
    return links?.find((l) => l.slot.id === slotId);
  };

  const handleGetLink = async (slotId: string) => {
    if (!agent?.id) return;
    setCreatingSlotId(slotId);
    try {
      const link = await createLink.mutateAsync({ agentId: agent.id, slotId });
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

  const handleDownloadCards = async (link: NonNullable<typeof links>[number]) => {
    if (!link.slot) return;
    setDownloadingLinkId(link.id);
    try {
      const { data: regs, error } = await supabase
        .from('registrations')
        .select('id, invitee_name')
        .eq('agent_link_id', link.id)
        .not('invitee_name', 'is', null);

      if (error) throw error;
      if (!regs || regs.length === 0) {
        toast({ title: 'No registrations', description: 'No registered invitees for this link yet.', variant: 'error' });
        return;
      }

      const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
      const invitationData: InvitationCardData[] = regs.map((reg) => ({
        inviteeName: reg.invitee_name || 'Guest',
        campaignName: link.slot.campaign.name,
        venue: link.slot.campaign.venue,
        dayOfWeek: format(parseISO(link.slot.start_at), 'EEE'),
        slotDate: link.slot.start_at,
        startTime: format(parseISO(link.slot.start_at), 'HH:mm'),
        endTime: format(parseISO(link.slot.end_at), 'HH:mm'),
        uniqueToken: link.link_code,
        registrationId: reg.id,
        registrationUrl: `${publicPagesUrl}/public/register/${link.link_code}`,
        isAutoCard: true,
      }));

      const branding = systemSettings?.company_branding ?? DEFAULT_COMPANY_BRANDING;
      const template = systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE;
      const doc = await generateBulkInvitationCards(invitationData, template, branding);
      doc.save(`invitation-cards-${link.slot.campaign.name}.pdf`);
      toast({ title: `${regs.length} card${regs.length > 1 ? 's' : ''} downloaded` });
    } catch (err: any) {
      toast({ title: 'Failed to generate cards', description: err.message, variant: 'error' });
    } finally {
      setDownloadingLinkId(null);
    }
  };

  const isLoading = campaignsLoading || linksLoading || statsLoading;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">My Links</h1>
        <p className="text-sm text-muted-foreground">Generate and share registration links for events</p>
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
        <h2 className="text-lg font-semibold text-foreground mb-3">Select an Event</h2>
        {campaignsLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
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
          <Card>
            <CardContent className="py-4">
              <p className="text-muted-foreground text-center">No active events available</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {campaigns?.map((campaign) => (
              <Card
                key={campaign.id}
                className={`cursor-pointer transition-colors duration-150 ${
                  selectedCampaignId === campaign.id
                    ? 'ring-2 ring-primary shadow-sm'
                    : 'hover:bg-muted/50'
                }`}
                onClick={() => {
                  setSelectedCampaignId(campaign.id);
                  setSelectedSlotId(null);
                }}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{campaign.name}</CardTitle>
                  <CardDescription className="flex items-center gap-1">
                    <MapPin className="size-3" />
                    {campaign.venue}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground">
                    {new Date(campaign.start_date).toLocaleDateString()} – {new Date(campaign.end_date).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Slots for Selected Campaign */}
      {selectedCampaignId && slots && (
        <Card>
          <CardHeader>
            <CardTitle>Event Slots</CardTitle>
            <CardDescription>Get your shareable link for each slot</CardDescription>
          </CardHeader>
          <CardContent>
            {slots.length === 0 ? (
              <p className="text-muted-foreground">No slots available for this event</p>
            ) : (
              <div className="space-y-3">
                {slots.map((slot: Slot) => {
                  const existingLink = getExistingLink(slot.id);
                  const regCount = existingLink?.registration_count ?? 0;

                  return (
                    <div
                      key={slot.id}
                      className={`flex items-center justify-between p-4 rounded-lg border ${
                        selectedSlotId === slot.id
                          ? 'border-primary/30 bg-primary/5'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => setSelectedSlotId(selectedSlotId === slot.id ? null : slot.id)}
                      >
                        <div className="font-medium text-foreground">
                          {format(parseISO(slot.start_at), 'd MMM yyyy')}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {format(parseISO(slot.start_at), 'HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
                        </div>
                        {existingLink && (
                          <div className="mt-1 text-sm">
                            <span className={regCount >= maxPerSlot ? 'text-amber-600 font-medium' : 'text-sky-600'}>
                              {regCount}/{maxPerSlot} registered
                            </span>
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
                                <Check className="size-4 mr-1 text-emerald-600" /> Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="size-4 mr-1" /> Copy Link
                              </>
                            )}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleGetLink(slot.id)}
                            disabled={creatingSlotId === slot.id}
                          >
                            <Link2 className="size-4 mr-1" />
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

      {/* My Active Links as InvitationCards */}
      {links && links.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Active Links</CardTitle>
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
                    companyName={systemSettings?.company_branding?.companyName}
                    logoUrl={systemSettings?.company_branding?.logoUrl}
                    actions={
                      <div className="flex items-center gap-1">
                        {link.slot?.is_auto_card && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-8 p-0"
                                onClick={() => handleDownloadCards(link)}
                                disabled={downloadingLinkId === link.id}
                                aria-label="Download invitation cards"
                              >
                                {downloadingLinkId === link.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <FileDown className="size-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download invitation cards</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0"
                              onClick={() => handleCopyLink(link.link_code, link.id)}
                              aria-label="Copy registration link"
                            >
                              {copiedLinkId === link.id ? (
                                <Check className="size-4 text-emerald-600" />
                              ) : (
                                <Copy className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {copiedLinkId === link.id ? 'Link copied!' : 'Copy registration link'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    }
                  />
                ))}
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      )}

      {/* Registrations Table for Selected Slot */}
      {selectedSlotId && (
        <Card>
          <CardHeader>
            <CardTitle>Registrations</CardTitle>
            <CardDescription>
              People who registered via your link for this slot
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!slotRegistrations ? (
              <TableSkeleton rows={3} columns={4} />
            ) : slotRegistrations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No registrations yet for this slot.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Registered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slotRegistrations.map((reg) => (
                    <TableRow key={reg.id}>
                      <TableCell className="font-medium">{reg.invitee_name}</TableCell>
                      <TableCell className="text-muted-foreground">{reg.invitee_phone}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(reg.status)}>
                          {reg.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {reg.registered_at
                          ? format(parseISO(reg.registered_at), 'd MMM yyyy, HH:mm')
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
