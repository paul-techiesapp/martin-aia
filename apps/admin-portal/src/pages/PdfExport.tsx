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
import {
  generateBulkInvitationCards,
  generatePinSheet,
  formatDayOfWeek,
  formatTime,
} from '../utils/pdfGenerator';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Campaign {
  id: string;
  name: string;
  venue: string;
}

interface Slot {
  id: string;
  campaign_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface Invitation {
  id: string;
  invitee_name: string | null;
  unique_token: string;
  slot: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    campaign: {
      name: string;
      venue: string;
    };
  };
}

interface PinCode {
  id: string;
  code: string;
  is_used: boolean;
}

export function PdfExport() {
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [isGeneratingInvitations, setIsGeneratingInvitations] = useState(false);
  const [isGeneratingPins, setIsGeneratingPins] = useState(false);

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
        .select('id, campaign_id, day_of_week, start_time, end_time')
        .eq('campaign_id', selectedCampaign)
        .order('day_of_week')
        .order('start_time');
      if (error) throw error;
      return data as Slot[];
    },
    enabled: !!selectedCampaign,
  });

  // Fetch invitations for selected slot
  const { data: invitations = [] } = useQuery({
    queryKey: ['invitations-for-pdf', selectedSlot],
    queryFn: async () => {
      if (!selectedSlot) return [];
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          id,
          invitee_name,
          unique_token,
          slot:slots(
            day_of_week,
            start_time,
            end_time,
            campaign:campaigns(name, venue)
          )
        `)
        .eq('slot_id', selectedSlot)
        .not('invitee_name', 'is', null);
      if (error) throw error;
      return data as unknown as Invitation[];
    },
    enabled: !!selectedSlot,
  });

  // Fetch PIN codes for selected slot
  const { data: pinCodes = [] } = useQuery({
    queryKey: ['pincodes-for-pdf', selectedSlot],
    queryFn: async () => {
      if (!selectedSlot) return [];
      const { data, error } = await supabase
        .from('pin_codes')
        .select('id, code, is_used')
        .eq('slot_id', selectedSlot)
        .order('code');
      if (error) throw error;
      return data as PinCode[];
    },
    enabled: !!selectedSlot,
  });

  const selectedSlotData = slots.find((s) => s.id === selectedSlot);
  const selectedCampaignData = campaigns.find((c) => c.id === selectedCampaign);

  const handleGenerateInvitationCards = async () => {
    if (!selectedSlot || invitations.length === 0) return;

    setIsGeneratingInvitations(true);
    try {
      // Use public-pages URL for registration links (not the admin portal URL)
      const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
      const invitationData = invitations.map((inv) => ({
        inviteeName: inv.invitee_name || 'Guest',
        campaignName: inv.slot.campaign.name,
        venue: inv.slot.campaign.venue,
        dayOfWeek: formatDayOfWeek(inv.slot.day_of_week),
        startTime: formatTime(inv.slot.start_time),
        endTime: formatTime(inv.slot.end_time),
        uniqueToken: inv.unique_token,
        registrationUrl: `${publicPagesUrl}/public/register/${inv.unique_token}`,
      }));

      const doc = generateBulkInvitationCards(invitationData);
      doc.save(`invitation-cards-${selectedCampaignData?.name || 'campaign'}.pdf`);
    } catch (error) {
      console.error('Error generating invitation cards:', error);
    } finally {
      setIsGeneratingInvitations(false);
    }
  };

  const handleGeneratePinSheet = async () => {
    if (!selectedSlot || !selectedSlotData || !selectedCampaignData || pinCodes.length === 0) return;

    setIsGeneratingPins(true);
    try {
      const baseUrl = window.location.origin;
      const slotInfo = `${DAYS_OF_WEEK[selectedSlotData.day_of_week]} ${formatTime(selectedSlotData.start_time)} - ${formatTime(selectedSlotData.end_time)}`;

      const doc = generatePinSheet({
        campaignName: selectedCampaignData.name,
        slotInfo,
        pinCodes: pinCodes.map((p) => p.code),
        checkinUrl: `${baseUrl}/public/checkin?slot=${selectedSlot}`,
        checkoutUrl: `${baseUrl}/public/checkout?slot=${selectedSlot}`,
      });

      doc.save(`pin-sheet-${selectedCampaignData.name}-${DAYS_OF_WEEK[selectedSlotData.day_of_week]}.pdf`);
    } catch (error) {
      console.error('Error generating PIN sheet:', error);
    } finally {
      setIsGeneratingPins(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">PDF Export</h1>
        <p className="text-muted-foreground">
          Generate invitation cards and PIN sheets for events
        </p>
      </div>

      {/* Selection Card */}
      <Card>
        <CardHeader>
          <CardTitle>Select Event</CardTitle>
          <CardDescription>
            Choose a campaign and slot to generate PDFs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Campaign</label>
              <Select
                value={selectedCampaign}
                onValueChange={(value) => {
                  setSelectedCampaign(value);
                  setSelectedSlot('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a campaign" />
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
                      {DAYS_OF_WEEK[slot.day_of_week]} {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Invitation Cards */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
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
                  <span className="font-medium">{invitations.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Format:</span>
                  <span className="font-medium">A6 Landscape</span>
                </div>
              </div>

              <Button
                onClick={handleGenerateInvitationCards}
                disabled={invitations.length === 0 || isGeneratingInvitations}
                className="w-full"
              >
                {isGeneratingInvitations ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="mr-2 h-4 w-4" />
                    Download Invitation Cards
                  </>
                )}
              </Button>

              {invitations.length === 0 && (
                <p className="text-sm text-muted-foreground text-center">
                  No registered invitations found for this slot
                </p>
              )}
            </CardContent>
          </Card>

          {/* PIN Sheet */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                PIN Code Sheet
              </CardTitle>
              <CardDescription>
                Generate a printable sheet with all PIN codes for check-in/out
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted p-4 rounded-md space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total PIN Codes:</span>
                  <span className="font-medium">{pinCodes.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Used:</span>
                  <span className="font-medium">{pinCodes.filter((p) => p.is_used).length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Available:</span>
                  <span className="font-medium">{pinCodes.filter((p) => !p.is_used).length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Format:</span>
                  <span className="font-medium">A4 Portrait</span>
                </div>
              </div>

              <Button
                onClick={handleGeneratePinSheet}
                disabled={pinCodes.length === 0 || isGeneratingPins}
                className="w-full"
              >
                {isGeneratingPins ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="mr-2 h-4 w-4" />
                    Download PIN Sheet
                  </>
                )}
              </Button>

              {pinCodes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center">
                  No PIN codes found for this slot. Generate PINs first.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
