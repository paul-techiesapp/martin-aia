import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agent-system/shared-ui';
import { FileDown, FileText, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { generateBulkInvitationCards } from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { useSystemSettings } from '../hooks/useSystemSettings';
import { getEffectiveTemplate, DEFAULT_CARD_TEMPLATE, DEFAULT_COMPANY_BRANDING } from '@agent-system/shared-types';
import type { CardTemplate } from '@agent-system/shared-types';

interface Campaign {
  id: string;
  name: string;
  venue: string;
}

interface Slot {
  id: string;
  campaign_id: string;
  start_at: string;
  end_at: string;
}

interface Registration {
  id: string;
  invitee_name: string | null;
  agent_link: {
    link_code: string;
  } | null;
  slot: {
    start_at: string;
    end_at: string;
    is_auto_card: boolean;
    campaign: {
      name: string;
      venue: string;
      card_template_overrides: Record<string, unknown> | null;
    };
  };
}

export function PdfExport() {
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [isGeneratingInvitations, setIsGeneratingInvitations] = useState(false);
  const { data: systemSettings } = useSystemSettings();

  // Fetch campaigns
  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('id, name, venue')
        .order('name');
      if (error) throw error;
      return data as Campaign[];
    },
  });

  // Fetch slots for selected campaign
  const { data: slots = [] } = useQuery({
    queryKey: ['slots', selectedCampaign],
    queryFn: async () => {
      if (!selectedCampaign) return [];
      const { data, error } = await supabase
        .from('slots')
        .select('id, campaign_id, start_at, end_at')
        .eq('campaign_id', selectedCampaign)
        .order('start_at');
      if (error) throw error;
      return data as Slot[];
    },
    enabled: !!selectedCampaign,
  });

  // Fetch registrations for selected slot
  const { data: registrations = [] } = useQuery({
    queryKey: ['registrations-for-pdf', selectedSlot],
    queryFn: async () => {
      if (!selectedSlot) return [];
      const { data, error } = await supabase
        .from('registrations')
        .select(`
          id,
          invitee_name,
          agent_link:agent_links(link_code),
          slot:slots(
            start_at,
            end_at,
            is_auto_card,
            campaign:campaigns(name, venue, card_template_overrides)
          )
        `)
        .eq('slot_id', selectedSlot)
        .not('invitee_name', 'is', null);
      if (error) throw error;
      return data as unknown as Registration[];
    },
    enabled: !!selectedSlot,
  });

  const selectedCampaignData = campaigns.find((c) => c.id === selectedCampaign);

  const handleGenerateInvitationCards = async () => {
    if (!selectedSlot || registrations.length === 0) return;

    setIsGeneratingInvitations(true);
    try {
      const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
      const invitationData = registrations.map((reg) => ({
        inviteeName: reg.invitee_name || 'Guest',
        campaignName: reg.slot.campaign.name,
        venue: reg.slot.campaign.venue,
        dayOfWeek: format(parseISO(reg.slot.start_at), 'EEE'),
        slotDate: reg.slot.start_at,
        startTime: format(parseISO(reg.slot.start_at), 'HH:mm'),
        endTime: format(parseISO(reg.slot.end_at), 'HH:mm'),
        uniqueToken: reg.agent_link?.link_code ?? reg.id,
        registrationId: reg.id,
        registrationUrl: reg.agent_link
          ? `${publicPagesUrl}/public/register/${reg.agent_link.link_code}`
          : '',
        isAutoCard: reg.slot.is_auto_card,
      }));

      const branding = systemSettings?.company_branding ?? DEFAULT_COMPANY_BRANDING;
      const campaignOverrides = registrations[0]?.slot?.campaign?.card_template_overrides as Partial<CardTemplate> | null;
      const template = getEffectiveTemplate(
        systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE,
        campaignOverrides
      );
      const doc = await generateBulkInvitationCards(invitationData, template, branding);
      doc.save(`invitation-cards-${selectedCampaignData?.name || 'campaign'}.pdf`);
    } catch (error) {
      console.error('Error generating invitation cards:', error);
    } finally {
      setIsGeneratingInvitations(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">PDF Export</h1>
        <p className="text-sm text-muted-foreground">
          Generate invitation cards for events
        </p>
      </div>

      {/* Selection Card */}
      <Card>
        <CardHeader>
          <CardTitle>Select Event</CardTitle>
          <CardDescription>
            Choose an event and slot to generate PDFs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Event</label>
              <Select
                value={selectedCampaign}
                onValueChange={(value) => {
                  setSelectedCampaign(value);
                  setSelectedSlot('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an event" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Slot</label>
              <Select
                value={selectedSlot}
                onValueChange={setSelectedSlot}
                disabled={!selectedCampaign}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a slot" />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((slot) => (
                    <SelectItem key={slot.id} value={slot.id}>
                      {format(parseISO(slot.start_at), 'EEE d MMM, HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export Options */}
      {selectedSlot && (
        <div className="grid grid-cols-1 gap-6">
          {/* Invitation Cards */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-5" />
                Invitation Cards
              </CardTitle>
              <CardDescription>
                Generate personalized invitation cards for registered attendees
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted p-4 rounded-md space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Registered Invitations:</span>
                  <span className="font-medium">{registrations.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Format:</span>
                  <span className="font-medium">A6 Landscape</span>
                </div>
              </div>

              <Button
                onClick={handleGenerateInvitationCards}
                disabled={registrations.length === 0 || isGeneratingInvitations}
                className="w-full"
              >
                {isGeneratingInvitations ? (
                  <>
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="mr-1.5 size-4" />
                    Download Invitation Cards
                  </>
                )}
              </Button>

              {registrations.length === 0 && (
                <p className="text-sm text-muted-foreground text-center">
                  No registered invitations found for this slot
                </p>
              )}
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
