import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Skeleton,
  InvitationCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
  generateBulkInvitationCards,
  generateRegistrantsWorkbook,
  formatSlotTime,
  resolveCardGradient,
} from '@agent-system/shared-ui';
import type { InvitationCardData } from '@agent-system/shared-ui';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Copy, Check, FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useMyLinks, usePartnerLinks } from '../hooks/useAgentLinks';
import { useSystemSettings } from '../hooks/useSystemSettings';
import { DEFAULT_CARD_TEMPLATE, DEFAULT_COMPANY_BRANDING, getEffectiveTemplate } from '@agent-system/shared-types';

export function AllLinks() {
  const { agent, partner, role } = useAuth();
  const isPartner = role === 'partner';
  const { toast } = useToast();
  const { data: systemSettings } = useSystemSettings();

  // Unfiltered: every link this agent/partner generated, active or ended.
  const agentLinksQuery = useMyLinks(isPartner ? undefined : agent?.id, true);
  const partnerLinksQuery = usePartnerLinks(isPartner ? partner?.id : undefined, true);
  const links = isPartner ? partnerLinksQuery.data : agentLinksQuery.data;
  const isLoading = isPartner ? partnerLinksQuery.isLoading : agentLinksQuery.isLoading;

  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [downloadingLinkId, setDownloadingLinkId] = useState<string | null>(null);
  const [exportingLinkId, setExportingLinkId] = useState<string | null>(null);

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
        startTime: formatSlotTime(link.slot.start_at),
        endTime: formatSlotTime(link.slot.end_at),
        uniqueToken: link.link_code,
        registrationId: reg.id,
        registrationUrl: `${publicPagesUrl}/public/register/${link.link_code}`,
      }));

      const branding = systemSettings?.company_branding ?? DEFAULT_COMPANY_BRANDING;
      const template = getEffectiveTemplate(
        systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE,
        link.slot?.campaign?.card_template_overrides ?? null,
      );
      const doc = await generateBulkInvitationCards(invitationData, template, branding);
      doc.save(`invitation-cards-${link.slot.campaign.name}.pdf`);
      toast({ title: `${regs.length} card${regs.length > 1 ? 's' : ''} downloaded` });
    } catch (err: any) {
      toast({ title: 'Failed to generate cards', description: err.message, variant: 'error' });
    } finally {
      setDownloadingLinkId(null);
    }
  };

  const handleExportRegistrants = async (link: NonNullable<typeof links>[number]) => {
    if (!link.slot) return;
    setExportingLinkId(link.id);
    try {
      const { data: regs, error } = await supabase
        .from('registrations')
        .select(
          'invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, status, registered_at',
        )
        .eq('agent_link_id', link.id)
        .order('registered_at', { ascending: true });

      if (error) throw error;
      if (!regs || regs.length === 0) {
        toast({ title: 'No registrants', description: 'No one has registered via this link yet.', variant: 'error' });
        return;
      }

      await generateRegistrantsWorkbook(regs, {
        campaignName: link.slot.campaign.name,
        slotDate: link.slot.start_at,
      });
      toast({ title: `${regs.length} registrant${regs.length > 1 ? 's' : ''} exported` });
    } catch (err: any) {
      toast({ title: 'Failed to export list', description: err.message, variant: 'error' });
    } finally {
      setExportingLinkId(null);
    }
  };

  // Active links first (soonest first), then ended links (most recent first).
  const now = new Date();
  const sortedLinks = [...(links ?? [])].sort((a, b) => {
    const aEnded = a.slot ? parseISO(a.slot.end_at) < now : false;
    const bEnded = b.slot ? parseISO(b.slot.end_at) < now : false;
    if (aEnded !== bEnded) return aEnded ? 1 : -1;
    const aStart = a.slot ? parseISO(a.slot.start_at).getTime() : 0;
    const bStart = b.slot ? parseISO(b.slot.start_at).getTime() : 0;
    return aEnded ? bStart - aStart : aStart - bStart;
  });

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link
          to={isPartner ? '/partner-links' : '/my-links'}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1"
        >
          <ArrowLeft className="size-4" /> Back to My Links
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">All Links</h1>
        <p className="text-sm text-muted-foreground">
          Every registration link you've generated, including past events
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : !sortedLinks.length ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">You haven't generated any links yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Links</CardTitle>
            <CardDescription>
              {sortedLinks.length} link{sortedLinks.length !== 1 ? 's' : ''} total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TooltipProvider>
              <div className="space-y-3">
                {sortedLinks.map((link) => {
                  const ended = link.slot ? parseISO(link.slot.end_at) < now : false;
                  const [gradientFrom, gradientTo] = resolveCardGradient(
                    link.slot?.campaign?.id,
                    link.slot?.campaign?.card_template_overrides,
                    systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE,
                  );
                  return (
                    <InvitationCard
                      key={link.id}
                      eventName={link.slot?.campaign?.name ?? 'Unknown Event'}
                      venue={link.slot?.campaign?.venue ?? '-'}
                      date={link.slot ? parseISO(link.slot.start_at) : new Date()}
                      startTime={link.slot ? formatSlotTime(link.slot.start_at) : '-'}
                      status={ended ? 'Ended' : undefined}
                      registeredCount={link.registration_count}
                      companyName={systemSettings?.company_branding?.companyName}
                      logoUrl={systemSettings?.company_branding?.logoUrl}
                      gradientFrom={gradientFrom}
                      gradientTo={gradientTo}
                      actions={
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-8 p-0"
                                onClick={() => handleExportRegistrants(link)}
                                disabled={exportingLinkId === link.id || link.registration_count === 0}
                                aria-label="Download registrant list (Excel)"
                              >
                                {exportingLinkId === link.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <FileSpreadsheet className="size-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {link.registration_count === 0
                                ? 'No registrants yet'
                                : 'Download registrant list (Excel)'}
                            </TooltipContent>
                          </Tooltip>
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
                  );
                })}
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
