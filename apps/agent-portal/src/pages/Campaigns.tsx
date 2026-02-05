import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agent-system/shared-ui';
import { Calendar, MapPin, Send, Copy, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useActiveCampaigns, useCampaignSlots } from '../hooks/useCampaigns';
import { useCreateInvitations, useInvitationCount } from '../hooks/useInvitations';
import { CapacityType, type Slot } from '@agent-system/shared-types';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function Campaigns() {
  const { agent } = useAuth();
  const { data: campaigns, isLoading } = useActiveCampaigns();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [invitationCount, setInvitationCount] = useState(1);
  const [capacityType, setCapacityType] = useState<CapacityType>(CapacityType.AGENT);
  const [generatedLinks, setGeneratedLinks] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const { data: slots } = useCampaignSlots(selectedCampaignId ?? '');
  const { data: currentCount } = useInvitationCount(agent?.id, selectedSlot?.id ?? '');
  const createInvitations = useCreateInvitations();

  const maxInvitations = agent?.tier?.invitation_limit_per_slot ?? 0;
  const remainingInvitations = Math.max(0, maxInvitations - (currentCount ?? 0));

  const handleSelectSlot = (slot: Slot) => {
    setSelectedSlot(slot);
    setIsDialogOpen(true);
    setGeneratedLinks([]);
    setInvitationCount(1);
  };

  const handleCreateInvitations = async () => {
    if (!agent?.id || !selectedSlot?.id) return;

    const result = await createInvitations.mutateAsync({
      agentId: agent.id,
      slotId: selectedSlot.id,
      capacityType,
      count: invitationCount,
    });

    const baseUrl = window.location.origin;
    const links = result.map(inv => `${baseUrl}/public/register/${inv.unique_token}`);
    setGeneratedLinks(links);
  };

  const handleCopy = async (link: string, index: number) => {
    await navigator.clipboard.writeText(link);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(generatedLinks.join('\n'));
    setCopiedIndex(-1);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Active Campaigns</h1>
        <p className="text-muted-foreground">Browse campaigns and request invitation links</p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading campaigns...</p>
      ) : campaigns?.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground text-center">No active campaigns available</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns?.map((campaign) => (
            <Card
              key={campaign.id}
              className={`cursor-pointer transition-all ${selectedCampaignId === campaign.id ? 'ring-2 ring-primary' : 'hover:border-primary'}`}
              onClick={() => setSelectedCampaignId(campaign.id)}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  {campaign.name}
                </CardTitle>
                <CardDescription className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {campaign.venue}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
                </div>
                <div className="mt-2 text-sm capitalize">
                  Type: {campaign.invitation_type.replace('_', ' ')}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedCampaignId && slots && (
        <Card>
          <CardHeader>
            <CardTitle>Available Slots</CardTitle>
            <CardDescription>Select a slot to request invitation links</CardDescription>
          </CardHeader>
          <CardContent>
            {slots.length === 0 ? (
              <p className="text-muted-foreground">No slots available for this campaign</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {slots.map((slot) => (
                  <Button
                    key={slot.id}
                    variant="outline"
                    className="justify-start h-auto py-3"
                    onClick={() => handleSelectSlot(slot)}
                  >
                    <div className="text-left">
                      <div className="font-medium">{DAYS_OF_WEEK[slot.day_of_week]}</div>
                      <div className="text-sm text-muted-foreground">
                        {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Invitation Links</DialogTitle>
            <DialogDescription>
              {selectedSlot && `${DAYS_OF_WEEK[selectedSlot.day_of_week]} ${selectedSlot.start_time.slice(0, 5)} - ${selectedSlot.end_time.slice(0, 5)}`}
            </DialogDescription>
          </DialogHeader>

          {generatedLinks.length === 0 ? (
            <>
              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-md text-sm">
                  <div className="flex justify-between">
                    <span>Your tier limit:</span>
                    <span className="font-medium">{maxInvitations} per slot</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Already used:</span>
                    <span className="font-medium">{currentCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between text-primary">
                    <span>Remaining:</span>
                    <span className="font-medium">{remainingInvitations}</span>
                  </div>
                </div>

                <div>
                  <Label>Capacity Type</Label>
                  <Select value={capacityType} onValueChange={(v) => setCapacityType(v as CapacityType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CapacityType.AGENT}>Agent</SelectItem>
                      <SelectItem value={CapacityType.BUSINESS_PARTNER}>Business Partner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Number of Invitations</Label>
                  <Input
                    type="number"
                    min={1}
                    max={remainingInvitations}
                    value={invitationCount}
                    onChange={(e) => setInvitationCount(Math.min(remainingInvitations, parseInt(e.target.value) || 1))}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateInvitations}
                  disabled={createInvitations.isPending || remainingInvitations === 0}
                >
                  <Send className="h-4 w-4 mr-2" />
                  {createInvitations.isPending ? 'Generating...' : 'Generate Links'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {generatedLinks.map((link, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 bg-muted rounded-md">
                    <span className="flex-1 text-sm truncate">{link}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(link, index)}
                    >
                      {copiedIndex === index ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handleCopyAll}>
                  {copiedIndex === -1 ? (
                    <>
                      <Check className="h-4 w-4 mr-2 text-green-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy All
                    </>
                  )}
                </Button>
                <Button onClick={() => setIsDialogOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
