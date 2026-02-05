import { Link, useParams, useNavigate } from '@tanstack/react-router';
import {
  Button,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agent-system/shared-ui';
import { ArrowLeft, Plus, Edit, Trash2, Power, PowerOff } from 'lucide-react';
import { useCampaign, useUpdateCampaignStatus } from '../../hooks/useCampaigns';
import { useSlots, useCreateSlot, useDeleteSlot, useToggleSlotActive } from '../../hooks/useSlots';
import { CampaignStatus } from '@agent-system/shared-types';
import { useState } from 'react';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const statusColors: Record<CampaignStatus, string> = {
  [CampaignStatus.DRAFT]: 'bg-gray-100 text-gray-800',
  [CampaignStatus.ACTIVE]: 'bg-green-100 text-green-800',
  [CampaignStatus.PAUSED]: 'bg-yellow-100 text-yellow-800',
  [CampaignStatus.COMPLETED]: 'bg-blue-100 text-blue-800',
};

export function CampaignDetail() {
  const navigate = useNavigate();
  const { campaignId } = useParams({ strict: false });
  const { data: campaign, isLoading: isLoadingCampaign } = useCampaign(campaignId ?? '');
  const { data: slots, isLoading: isLoadingSlots } = useSlots(campaignId ?? '');
  const updateStatus = useUpdateCampaignStatus();
  const createSlot = useCreateSlot();
  const deleteSlot = useDeleteSlot();
  const toggleSlotActive = useToggleSlotActive();

  const [isAddSlotOpen, setIsAddSlotOpen] = useState(false);
  const [newSlot, setNewSlot] = useState({
    day_of_week: 1,
    start_time: '10:00',
    end_time: '13:00',
    checkin_window_minutes: 30,
    checkout_window_minutes: 30,
  });

  const handleAddSlot = async () => {
    if (!campaignId) return;
    await createSlot.mutateAsync({
      campaign_id: campaignId,
      day_of_week: newSlot.day_of_week,
      start_time: `${newSlot.start_time}:00`,
      end_time: `${newSlot.end_time}:00`,
      checkin_window_minutes: newSlot.checkin_window_minutes,
      checkout_window_minutes: newSlot.checkout_window_minutes,
      is_active: true,
    });
    setIsAddSlotOpen(false);
    setNewSlot({
      day_of_week: 1,
      start_time: '10:00',
      end_time: '13:00',
      checkin_window_minutes: 30,
      checkout_window_minutes: 30,
    });
  };

  const handleDeleteSlot = (slotId: string) => {
    if (confirm('Are you sure you want to delete this slot?')) {
      deleteSlot.mutate(slotId);
    }
  };

  const handleToggleStatus = (newStatus: CampaignStatus) => {
    if (!campaignId) return;
    updateStatus.mutate({ id: campaignId, status: newStatus });
  };

  if (isLoadingCampaign) {
    return <p>Loading...</p>;
  }

  if (!campaign) {
    return <p>Campaign not found</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/campaigns' })}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{campaign.name}</h1>
            <p className="text-muted-foreground">{campaign.venue}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === CampaignStatus.DRAFT && (
            <Button onClick={() => handleToggleStatus(CampaignStatus.ACTIVE)}>
              <Power className="h-4 w-4 mr-2" />
              Activate
            </Button>
          )}
          {campaign.status === CampaignStatus.ACTIVE && (
            <Button variant="outline" onClick={() => handleToggleStatus(CampaignStatus.PAUSED)}>
              <PowerOff className="h-4 w-4 mr-2" />
              Pause
            </Button>
          )}
          {campaign.status === CampaignStatus.PAUSED && (
            <Button onClick={() => handleToggleStatus(CampaignStatus.ACTIVE)}>
              <Power className="h-4 w-4 mr-2" />
              Resume
            </Button>
          )}
          <Link to="/campaigns/$campaignId/edit" params={{ campaignId: campaignId ?? '' }}>
            <Button variant="outline">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[campaign.status]}`}>
              {campaign.status}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Dates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">
              {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium capitalize">
              {campaign.invitation_type.replace('_', ' ')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Event Slots</CardTitle>
              <CardDescription>
                Configure the available time slots for this campaign
              </CardDescription>
            </div>
            <Dialog open={isAddSlotOpen} onOpenChange={setIsAddSlotOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Slot
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Slot</DialogTitle>
                  <DialogDescription>
                    Create a new time slot for this campaign
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Day of Week</Label>
                    <Select
                      value={newSlot.day_of_week.toString()}
                      onValueChange={(v) => setNewSlot({ ...newSlot, day_of_week: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((day, index) => (
                          <SelectItem key={index} value={index.toString()}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Start Time</Label>
                      <Input
                        type="time"
                        value={newSlot.start_time}
                        onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>End Time</Label>
                      <Input
                        type="time"
                        value={newSlot.end_time}
                        onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Check-in Window (mins)</Label>
                      <Input
                        type="number"
                        value={newSlot.checkin_window_minutes}
                        onChange={(e) => setNewSlot({ ...newSlot, checkin_window_minutes: parseInt(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>Check-out Window (mins)</Label>
                      <Input
                        type="number"
                        value={newSlot.checkout_window_minutes}
                        onChange={(e) => setNewSlot({ ...newSlot, checkout_window_minutes: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddSlotOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddSlot} disabled={createSlot.isPending}>
                    {createSlot.isPending ? 'Creating...' : 'Create Slot'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingSlots ? (
            <p className="text-muted-foreground">Loading slots...</p>
          ) : slots?.length === 0 ? (
            <p className="text-muted-foreground">No slots configured yet. Add a slot to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Check-in Window</TableHead>
                  <TableHead>Check-out Window</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slots?.map((slot) => (
                  <TableRow key={slot.id}>
                    <TableCell className="font-medium">
                      {DAYS_OF_WEEK[slot.day_of_week]}
                    </TableCell>
                    <TableCell>
                      {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                    </TableCell>
                    <TableCell>{slot.checkin_window_minutes} mins</TableCell>
                    <TableCell>{slot.checkout_window_minutes} mins</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        slot.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {slot.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleSlotActive.mutate({ id: slot.id, is_active: !slot.is_active })}
                        >
                          {slot.is_active ? (
                            <PowerOff className="h-4 w-4" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteSlot(slot.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
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
