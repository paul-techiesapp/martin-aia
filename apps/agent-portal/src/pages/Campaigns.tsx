import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Skeleton,
  useToast,
} from '@agent-system/shared-ui';
import { CalendarDays, MapPin, Link2, Copy, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useActiveCampaigns, useCampaignSlots } from '../hooks/useCampaigns';
import { useMyLinks, useCreateLink } from '../hooks/useAgentLinks';
import type { Slot } from '@agent-system/shared-types';

export function Campaigns() {
  const { agent } = useAuth();
  const { data: campaigns, isLoading } = useActiveCampaigns();
  const { data: links } = useMyLinks(agent?.id);
  const createLink = useCreateLink();
  const { toast } = useToast();

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [copiedSlotId, setCopiedSlotId] = useState<string | null>(null);
  const [creatingSlotId, setCreatingSlotId] = useState<string | null>(null);

  const { data: slots } = useCampaignSlots(selectedCampaignId ?? '');

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
      setCopiedSlotId(slotId);
      toast({ title: 'Link created & copied!', description: 'Share this link with your invitees.' });
      setTimeout(() => setCopiedSlotId(null), 2000);
    } catch (err: any) {
      toast({ title: 'Failed to create link', description: err.message, variant: 'error' });
    } finally {
      setCreatingSlotId(null);
    }
  };

  const handleCopyLink = async (linkCode: string, slotId: string) => {
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const url = `${publicPagesUrl}/public/register/${linkCode}`;
    await navigator.clipboard.writeText(url);
    setCopiedSlotId(slotId);
    toast({ title: 'Link copied!' });
    setTimeout(() => setCopiedSlotId(null), 2000);
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Active Events</h1>
        <p className="text-muted-foreground">Browse events and generate your shareable invitation links</p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="glass-card">
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : campaigns?.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="p-6">
            <p className="text-muted-foreground text-center">No active events available</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {campaigns?.map((campaign) => (
            <Card
              key={campaign.id}
              className={`glass-card cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-xl ${
                selectedCampaignId === campaign.id
                  ? 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/10'
                  : 'hover:border-indigo-200'
              }`}
              onClick={() => setSelectedCampaignId(campaign.id)}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <div className="h-8 w-8 rounded-lg bg-sky-100 flex items-center justify-center">
                    <CalendarDays className="size-4 text-sky-600" />
                  </div>
                  {campaign.name}
                </CardTitle>
                <CardDescription className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="size-4" />
                  {campaign.venue}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
                </div>
                <div className="mt-2 text-sm capitalize text-muted-foreground">
                  Type: {campaign.registration_type?.replace('_', ' ')}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedCampaignId && slots && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Available Slots</CardTitle>
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
                  const maxPerSlot = agent?.tier?.invitation_limit_per_slot ?? 0;

                  return (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex-1">
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
                            onClick={() => handleCopyLink(existingLink.link_code, slot.id)}
                          >
                            {copiedSlotId === slot.id ? (
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
                            className=""
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
    </div>
  );
}
