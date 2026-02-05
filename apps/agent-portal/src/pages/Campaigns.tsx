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
  Skeleton,
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

    // Use public-pages URL for registration links (not the agent portal URL)
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const links = result.map(inv => `${publicPagesUrl}/public/register/${inv.unique_token}`);
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
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Active Campaigns</h1>
        <p className="text-slate-500 mt-1">Browse campaigns and request invitation links</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
            <p className="text-slate-500 text-center">No active campaigns available</p>
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
                <div className="mt-2 text-sm capitalize text-slate-500">
                  Type: {campaign.invitation_type.replace('_', ' ')}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedCampaignId && slots && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Available Slots</CardTitle>
            <CardDescription>Select a slot to request invitation links</CardDescription>
          </CardHeader>
          <CardContent>
            {slots.length === 0 ? (
              <p className="text-slate-500">No slots available for this campaign</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {slots.map((slot) => (
                  <Button
                    key={slot.id}
                    variant="outline"
                    className="justify-start h-auto py-3 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                    onClick={() => handleSelectSlot(slot)}
                  >
                    <div className="text-left">
                      <div className="font-medium">{DAYS_OF_WEEK[slot.day_of_week]}</div>
                      <div className="text-sm text-slate-500">
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
                <div className="p-4 bg-slate-50 rounded-lg text-sm border border-slate-100">
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Your tier limit:</span>
                    <span className="font-medium text-slate-900">{maxInvitations} per slot</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Already used:</span>
                    <span className="font-medium text-slate-900">{currentCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between py-1 text-sky-600">
                    <span>Remaining:</span>
                    <span className="font-semibold">{remainingInvitations}</span>
                  </div>
                </div>

                <div>
                  <Label>Capacity Type</Label>
                  <Select value={capacityType} onValueChange={(v) => setCapacityType(v as CapacityType)}>
                    <SelectTrigger className="mt-1.5">
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
                    className="mt-1.5"
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
                  className="bg-slate-900 hover:bg-slate-800"
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
                  <div key={index} className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="flex-1 text-sm truncate text-slate-600">{link}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handleCopy(link, index)}
                    >
                      {copiedIndex === index ? (
                        <Check className="h-4 w-4 text-emerald-600" />
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
                      <Check className="h-4 w-4 mr-2 text-emerald-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy All
                    </>
                  )}
                </Button>
                <Button onClick={() => setIsDialogOpen(false)} className="bg-slate-900 hover:bg-slate-800">
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
