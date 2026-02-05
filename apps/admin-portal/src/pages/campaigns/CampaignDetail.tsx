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
  Badge,
  getStatusVariant,
  Skeleton,
} from '@agent-system/shared-ui';
import { ArrowLeft, Plus, Trash2, Power, PowerOff } from 'lucide-react';
import { useCampaign, useUpdateCampaignStatus } from '../../hooks/useCampaigns';
import { useSlots, useCreateSlot, useDeleteSlot, useToggleSlotActive } from '../../hooks/useSlots';
import { CampaignStatus } from '@agent-system/shared-types';
import { useState } from 'react';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-20" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6">
          <p className="text-slate-500">Campaign not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/campaigns' })}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{campaign.name}</h1>
            <p className="text-slate-500">{campaign.venue}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === CampaignStatus.DRAFT && (
            <Button onClick={() => handleToggleStatus(CampaignStatus.ACTIVE)} className="bg-emerald-600 hover:bg-emerald-700">
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
            <Button onClick={() => handleToggleStatus(CampaignStatus.ACTIVE)} className="bg-emerald-600 hover:bg-emerald-700">
              <Power className="h-4 w-4 mr-2" />
              Resume
            </Button>
          )}
          <Link to="/campaigns/$campaignId/edit" params={{ campaignId: campaignId ?? '' }}>
            <Button variant="outline">
              Edit
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={getStatusVariant(campaign.status)} size="lg">
              {campaign.status}
            </Badge>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Dates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-slate-900">
              {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold capitalize text-slate-900">
              {campaign.invitation_type.replace('_', ' ')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Event Slots</CardTitle>
              <CardDescription>
                Configure the available time slots for this campaign
              </CardDescription>
            </div>
            <Dialog open={isAddSlotOpen} onOpenChange={setIsAddSlotOpen}>
              <DialogTrigger asChild>
                <Button className="bg-slate-900 hover:bg-slate-800">
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
                  <Button onClick={handleAddSlot} disabled={createSlot.isPending} className="bg-slate-900 hover:bg-slate-800">
                    {createSlot.isPending ? 'Creating...' : 'Create Slot'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingSlots ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : slots?.length === 0 ? (
            <p className="text-slate-500">No slots configured yet. Add a slot to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
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
                  <TableRow key={slot.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-medium">
                      {DAYS_OF_WEEK[slot.day_of_week]}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                    </TableCell>
                    <TableCell className="text-slate-600">{slot.checkin_window_minutes} mins</TableCell>
                    <TableCell className="text-slate-600">{slot.checkout_window_minutes} mins</TableCell>
                    <TableCell>
                      <Badge variant={slot.is_active ? 'active' : 'inactive'}>
                        {slot.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
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
                          className="h-8 w-8 p-0"
                          onClick={() => handleDeleteSlot(slot.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
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
