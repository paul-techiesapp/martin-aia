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
  useToast,
  DatePicker,
  Checkbox,
} from '@agent-system/shared-ui';
import { format, parseISO, eachDayOfInterval, getDay } from 'date-fns';
import { ArrowLeft, Plus, Trash2, Power, PowerOff, Mail, CalendarPlus, Monitor, FileText } from 'lucide-react';
import { useCampaign, useUpdateCampaignStatus, useUpdateCampaign } from '../../hooks/useCampaigns';
import { useEmailReminders } from '../../hooks/useEmailReminders';
import { useSlots, useCreateSlot, useDeleteSlot, useToggleSlotActive, useUpdateSlot } from '../../hooks/useSlots';
import { useRegistrationsBySlot } from '../../hooks/useRegistrations';
import { CampaignStatus, getEffectiveTemplate, DEFAULT_CARD_TEMPLATE } from '@agent-system/shared-types';
import type { CardTemplate, Slot } from '@agent-system/shared-types';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useSystemSettings } from '../../hooks/useSystemSettings';

function getRegistrationStatusVariant(status: string): 'active' | 'warning' | 'info' | 'inactive' {
  switch (status) {
    case 'registered': return 'info';
    case 'attended': return 'warning';
    case 'completed': return 'active';
    case 'expired': return 'inactive';
    default: return 'inactive';
  }
}

function SlotRow({
  slot,
  isExpanded,
  onToggleExpand,
  onOpenReminder,
  onToggleActive,
  onToggleCardType,
  onDelete,
}: {
  slot: Slot;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenReminder: () => void;
  onToggleActive: () => void;
  onToggleCardType: () => void;
  onDelete: () => void;
}) {
  const { data: registrations, isLoading: isLoadingRegistrations } = useRegistrationsBySlot(slot.id);
  const count = registrations?.length ?? 0;

  return (
    <>
      <TableRow className="hover:bg-muted/50 transition-colors">
        <TableCell className="font-medium">
          {format(parseISO(slot.start_at), 'd MMM yyyy')}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {format(parseISO(slot.start_at), 'HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
        </TableCell>
        <TableCell className="text-muted-foreground">{slot.checkin_window_minutes} mins</TableCell>
        <TableCell className="text-muted-foreground">{slot.checkout_window_minutes} mins</TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-sm"
            onClick={onToggleExpand}
          >
            <Badge variant={count > 0 ? 'active' : 'inactive'}>
              {count} registered
            </Badge>
          </Button>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Badge variant={slot.is_active ? 'active' : 'inactive'}>
              {slot.is_active ? 'Active' : 'Inactive'}
            </Badge>
            <Badge variant={slot.is_auto_card ? 'info' : 'warning'}>
              {slot.is_auto_card ? 'Auto' : 'Manual'}
            </Badge>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0" aria-label="Actions"
              onClick={() => window.open(`/venue-display/${slot.id}`, '_blank')}
              title="Open venue display with QR codes"
            >
              <Monitor className="size-4 text-sky-500" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0" aria-label="Actions"
              onClick={onOpenReminder}
              title="Send email reminders"
            >
              <Mail className="size-4 text-indigo-500" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0" aria-label="Actions"
              onClick={onToggleCardType}
              title={slot.is_auto_card ? 'Switch to manual cards' : 'Switch to auto cards'}
            >
              <FileText className="size-4 text-amber-500" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0" aria-label="Actions"
              onClick={onToggleActive}
            >
              {slot.is_active ? (
                <PowerOff className="size-4" />
              ) : (
                <Power className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0" aria-label="Actions"
              onClick={onDelete}
            >
              <Trash2 className="size-4 text-red-500" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/50 p-0">
            <div className="p-4">
              <h4 className="text-sm font-semibold text-foreground mb-3">
                Registrations for {format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm')}
              </h4>
              {isLoadingRegistrations ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : !registrations || registrations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No registrations for this slot yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Name</TableHead>
                      <TableHead>NRIC</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Agent</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registrations.map((reg) => (
                      <TableRow key={reg.id} className="hover:bg-background/50 transition-colors">
                        <TableCell className="font-medium">{reg.invitee_name}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-sm">{reg.invitee_nric}</TableCell>
                        <TableCell className="text-muted-foreground">{reg.invitee_phone}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {reg.agent?.name ?? '-'}
                          {reg.agent?.agent_code ? ` (${reg.agent.agent_code})` : ''}
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">
                          {reg.capacity_type?.replace('_', ' ') ?? '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getRegistrationStatusVariant(reg.status)}>
                            {reg.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function CampaignDetail() {
  const navigate = useNavigate();
  const { campaignId } = useParams({ strict: false });
  const { data: campaign, isLoading: isLoadingCampaign } = useCampaign(campaignId ?? '');
  const { data: slots, isLoading: isLoadingSlots } = useSlots(campaignId ?? '');
  const updateStatus = useUpdateCampaignStatus();
  const createSlot = useCreateSlot();
  const deleteSlot = useDeleteSlot();
  const toggleSlotActive = useToggleSlotActive();
  const updateSlot = useUpdateSlot();

  const sendReminders = useEmailReminders();
  const [reminderSlot, setReminderSlot] = useState<{ id: string; label: string; count: number } | null>(null);
  const { toast } = useToast();
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);

  const [isAddSlotOpen, setIsAddSlotOpen] = useState(false);
  const [newSlot, setNewSlot] = useState({
    date: undefined as Date | undefined,
    start_time: '10:00',
    end_time: '13:00',
    checkin_window_minutes: 30,
    checkout_window_minutes: 30,
    is_auto_card: true,
  });

  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkDayOfWeek, setBulkDayOfWeek] = useState(1);
  const [bulkStartTime, setBulkStartTime] = useState('10:00');
  const [bulkEndTime, setBulkEndTime] = useState('13:00');
  const [bulkCheckinWindow, setBulkCheckinWindow] = useState(30);
  const [bulkCheckoutWindow, setBulkCheckoutWindow] = useState(30);
  const [bulkIsAutoCard, setBulkIsAutoCard] = useState(true);
  const [bulkPreview, setBulkPreview] = useState<Date[]>([]);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  // Checkout config state
  const updateCampaign = useUpdateCampaign();
  const [checkoutConfig, setCheckoutConfig] = useState({
    fb_enabled: false,
    fb_url: '',
    video_enabled: false,
    video_url: '',
    rating_enabled: false,
  });
  const [isCheckoutConfigDirty, setIsCheckoutConfigDirty] = useState(false);

  // Card template override state
  const { data: systemSettings } = useSystemSettings();
  const [showOverrideEditor, setShowOverrideEditor] = useState(false);
  const [templateOverrides, setTemplateOverrides] = useState<Partial<CardTemplate> | null>(null);
  const [isOverrideDirty, setIsOverrideDirty] = useState(false);

  useEffect(() => {
    if (campaign?.card_template_overrides) {
      setTemplateOverrides(campaign.card_template_overrides as Partial<CardTemplate>);
    }
  }, [campaign]);

  useEffect(() => {
    if (campaign?.checkout_config && typeof campaign.checkout_config === 'object') {
      const cfg = campaign.checkout_config as unknown as Record<string, unknown>;
      setCheckoutConfig({
        fb_enabled: cfg.fb_enabled === true,
        fb_url: (cfg.fb_url as string) ?? '',
        video_enabled: cfg.video_enabled === true,
        video_url: (cfg.video_url as string) ?? '',
        rating_enabled: cfg.rating_enabled === true,
      });
    }
  }, [campaign]);

  const handleSaveCheckoutConfig = async () => {
    if (!campaignId) return;
    try {
      await updateCampaign.mutateAsync({
        id: campaignId,
        checkout_config: checkoutConfig,
      } as any);
      setIsCheckoutConfigDirty(false);
      toast({ title: 'Checkout configuration saved' });
    } catch (err: any) {
      toast({ title: 'Failed to save', description: err.message, variant: 'error' });
    }
  };

  const handleSaveOverrides = async () => {
    if (!campaignId) return;
    try {
      await updateCampaign.mutateAsync({
        id: campaignId,
        card_template_overrides: templateOverrides,
      } as any);
      setIsOverrideDirty(false);
      toast({ title: 'Card template overrides saved' });
    } catch (err: any) {
      toast({ title: 'Failed to save overrides', description: err.message, variant: 'error' });
    }
  };

  const handleResetOverrides = async () => {
    if (!campaignId) return;
    try {
      await updateCampaign.mutateAsync({
        id: campaignId,
        card_template_overrides: null,
      } as any);
      setTemplateOverrides(null);
      setIsOverrideDirty(false);
      setShowOverrideEditor(false);
      toast({ title: 'Card template reset to system default' });
    } catch (err: any) {
      toast({ title: 'Failed to reset', description: err.message, variant: 'error' });
    }
  };

  const effectiveTemplate = getEffectiveTemplate(
    systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE,
    templateOverrides
  );

  const overrideCount = templateOverrides ? Object.keys(templateOverrides).length : 0;

  const updateOverrideField = <K extends keyof CardTemplate>(key: K, value: CardTemplate[K]) => {
    setTemplateOverrides((prev) => ({ ...prev, [key]: value }));
    setIsOverrideDirty(true);
  };

  const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const handleAddSlot = async () => {
    if (!campaignId || !newSlot.date) return;
    const dateStr = format(newSlot.date, 'yyyy-MM-dd');
    await createSlot.mutateAsync({
      campaign_id: campaignId,
      start_at: new Date(`${dateStr}T${newSlot.start_time}:00`).toISOString(),
      end_at: new Date(`${dateStr}T${newSlot.end_time}:00`).toISOString(),
      checkin_window_minutes: newSlot.checkin_window_minutes,
      checkout_window_minutes: newSlot.checkout_window_minutes,
      is_active: true,
      is_auto_card: newSlot.is_auto_card,
    });
    setIsAddSlotOpen(false);
    setNewSlot({
      date: undefined,
      start_time: '10:00',
      end_time: '13:00',
      checkin_window_minutes: 30,
      checkout_window_minutes: 30,
      is_auto_card: true,
    });
  };

  const handleGenerateBulkPreview = () => {
    if (!campaign) return;
    const start = parseISO(campaign.start_date);
    const end = parseISO(campaign.end_date);
    const allDays = eachDayOfInterval({ start, end });
    const matching = allDays.filter((d) => getDay(d) === bulkDayOfWeek);
    setBulkPreview(matching);
    setBulkSelected(new Set(matching.map((d) => format(d, 'yyyy-MM-dd'))));
  };

  const handleBulkCreate = async () => {
    if (!campaignId) return;
    const selectedDates = Array.from(bulkSelected);
    for (const dateStr of selectedDates) {
      await createSlot.mutateAsync({
        campaign_id: campaignId,
        start_at: new Date(`${dateStr}T${bulkStartTime}:00`).toISOString(),
        end_at: new Date(`${dateStr}T${bulkEndTime}:00`).toISOString(),
        checkin_window_minutes: bulkCheckinWindow,
        checkout_window_minutes: bulkCheckoutWindow,
        is_active: true,
        is_auto_card: bulkIsAutoCard,
      });
    }
    setIsAddSlotOpen(false);
    setBulkPreview([]);
    setBulkSelected(new Set());
    setIsBulkMode(false);
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

  const handleOpenReminderDialog = async (slot: { id: string; start_at: string }) => {
    const { count } = await supabase
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('slot_id', slot.id)
      .eq('status', 'registered')
      .not('invitee_email', 'is', null);

    setReminderSlot({
      id: slot.id,
      label: format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm'),
      count: count ?? 0,
    });
  };

  const handleSendReminders = async () => {
    if (!reminderSlot) return;
    try {
      const result = await sendReminders.mutateAsync(reminderSlot.id);
      if (result.sent > 0) {
        toast({ title: `${result.sent} reminder${result.sent > 1 ? 's' : ''} sent` });
      } else {
        toast({ title: result.message || 'No emails sent', variant: 'error' });
      }
    } catch (err: any) {
      toast({ title: 'Failed to send reminders', description: err.message, variant: 'error' });
    }
    setReminderSlot(null);
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
        <div className="grid gap-3 md:grid-cols-3">
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
          <p className="text-muted-foreground">Event not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/campaigns' })}>
            <ArrowLeft className="size-4 mr-1.5" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{campaign.name}</h1>
            <p className="text-muted-foreground">{campaign.venue}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === CampaignStatus.DRAFT && (
            <Button onClick={() => handleToggleStatus(CampaignStatus.ACTIVE)} className="bg-emerald-600 hover:bg-emerald-700">
              <Power className="size-4 mr-1.5" />
              Activate
            </Button>
          )}
          {campaign.status === CampaignStatus.ACTIVE && (
            <Button variant="outline" onClick={() => handleToggleStatus(CampaignStatus.PAUSED)}>
              <PowerOff className="size-4 mr-1.5" />
              Pause
            </Button>
          )}
          {campaign.status === CampaignStatus.PAUSED && (
            <Button onClick={() => handleToggleStatus(CampaignStatus.ACTIVE)} className="bg-emerald-600 hover:bg-emerald-700">
              <Power className="size-4 mr-1.5" />
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

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
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
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Dates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-foreground">
              {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold capitalize text-foreground">
              {campaign.registration_type?.replace('_', ' ')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Event Slots</CardTitle>
              <CardDescription>
                Configure the available time slots for this event
              </CardDescription>
            </div>
            <Dialog open={isAddSlotOpen} onOpenChange={setIsAddSlotOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary hover:bg-primary/90">
                  <Plus className="size-4 mr-1.5" />
                  Add Slot
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add New Slot</DialogTitle>
                  <DialogDescription>
                    Create a new time slot for this event
                  </DialogDescription>
                </DialogHeader>

                {/* Mode toggle */}
                <div className="flex gap-2 border-b pb-3">
                  <Button
                    variant={isBulkMode ? 'ghost' : 'default'}
                    size="sm"
                    onClick={() => { setIsBulkMode(false); setBulkPreview([]); }}
                  >
                    Single Slot
                  </Button>
                  <Button
                    variant={isBulkMode ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setIsBulkMode(true)}
                  >
                    <CalendarPlus className="size-4 mr-1" />
                    Bulk Generate
                  </Button>
                </div>

                {!isBulkMode ? (
                  /* Single slot mode */
                  <div className="space-y-4">
                    <div>
                      <Label>Date</Label>
                      <DatePicker
                        date={newSlot.date}
                        onDateChange={(d) => setNewSlot({ ...newSlot, date: d })}
                        placeholder="Select date"
                        disabled={(date) => {
                          if (!campaign) return true;
                          const start = parseISO(campaign.start_date);
                          const end = parseISO(campaign.end_date);
                          return date < start || date > end;
                        }}
                      />
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
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="is_auto_card"
                        checked={newSlot.is_auto_card}
                        onCheckedChange={(checked) =>
                          setNewSlot({ ...newSlot, is_auto_card: checked === true })
                        }
                      />
                      <div className="grid gap-0.5 leading-none">
                        <Label htmlFor="is_auto_card">Auto Card Distribution</Label>
                        <p className="text-xs text-muted-foreground">
                          {newSlot.is_auto_card
                            ? 'Agents can download invitation cards from their portal'
                            : 'Only admin can print invitation cards'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Bulk generation mode */
                  <div className="space-y-4">
                    <div>
                      <Label>Day of Week</Label>
                      <Select
                        value={bulkDayOfWeek.toString()}
                        onValueChange={(v) => setBulkDayOfWeek(parseInt(v))}
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
                        <Input type="time" value={bulkStartTime} onChange={(e) => setBulkStartTime(e.target.value)} />
                      </div>
                      <div>
                        <Label>End Time</Label>
                        <Input type="time" value={bulkEndTime} onChange={(e) => setBulkEndTime(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Check-in Window (mins)</Label>
                        <Input type="number" value={bulkCheckinWindow} onChange={(e) => setBulkCheckinWindow(parseInt(e.target.value))} />
                      </div>
                      <div>
                        <Label>Check-out Window (mins)</Label>
                        <Input type="number" value={bulkCheckoutWindow} onChange={(e) => setBulkCheckoutWindow(parseInt(e.target.value))} />
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="bulk_is_auto_card"
                        checked={bulkIsAutoCard}
                        onCheckedChange={(checked) => setBulkIsAutoCard(checked === true)}
                      />
                      <div className="grid gap-0.5 leading-none">
                        <Label htmlFor="bulk_is_auto_card">Auto Card Distribution</Label>
                        <p className="text-xs text-muted-foreground">
                          {bulkIsAutoCard
                            ? 'Agents can download invitation cards from their portal'
                            : 'Only admin can print invitation cards'}
                        </p>
                      </div>
                    </div>

                    {bulkPreview.length === 0 ? (
                      <Button onClick={handleGenerateBulkPreview} className="w-full" variant="outline">
                        Preview Dates
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <Label>Select dates to create ({bulkSelected.size} of {bulkPreview.length})</Label>
                        <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1">
                          {bulkPreview.map((date) => {
                            const key = format(date, 'yyyy-MM-dd');
                            return (
                              <label key={key} className="flex items-center gap-2 py-1 px-2 hover:bg-muted rounded text-sm">
                                <Checkbox
                                  checked={bulkSelected.has(key)}
                                  onCheckedChange={(checked) => {
                                    const next = new Set(bulkSelected);
                                    if (checked) next.add(key); else next.delete(key);
                                    setBulkSelected(next);
                                  }}
                                />
                                {format(date, 'EEE, d MMM yyyy')}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setIsAddSlotOpen(false); setIsBulkMode(false); setBulkPreview([]); }}>
                    Cancel
                  </Button>
                  {!isBulkMode ? (
                    <Button
                      onClick={handleAddSlot}
                      disabled={createSlot.isPending || !newSlot.date}
                      className="bg-primary hover:bg-primary/90"
                    >
                      {createSlot.isPending ? 'Creating...' : 'Create Slot'}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleBulkCreate}
                      disabled={createSlot.isPending || bulkSelected.size === 0}
                      className="bg-primary hover:bg-primary/90"
                    >
                      {createSlot.isPending ? 'Creating...' : `Create ${bulkSelected.size} Slots`}
                    </Button>
                  )}
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
            <p className="text-muted-foreground">No slots configured yet. Add a slot to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Check-in Window</TableHead>
                  <TableHead>Check-out Window</TableHead>
                  <TableHead>Registrations</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slots?.map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slot={slot}
                    isExpanded={expandedSlotId === slot.id}
                    onToggleExpand={() => setExpandedSlotId(expandedSlotId === slot.id ? null : slot.id)}
                    onOpenReminder={() => handleOpenReminderDialog(slot)}
                    onToggleActive={() => toggleSlotActive.mutate({ id: slot.id, is_active: !slot.is_active })}
                    onToggleCardType={() => updateSlot.mutate({ id: slot.id, is_auto_card: !slot.is_auto_card })}
                    onDelete={() => handleDeleteSlot(slot.id)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Post-Checkout Content Configuration */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Post-Checkout Content</CardTitle>
          <CardDescription>
            Configure what attendees see after successful check-out
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Facebook Follow Button */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="fb_enabled"
                checked={checkoutConfig.fb_enabled}
                onCheckedChange={(checked) => {
                  setCheckoutConfig({ ...checkoutConfig, fb_enabled: checked === true });
                  setIsCheckoutConfigDirty(true);
                }}
              />
              <Label htmlFor="fb_enabled" className="font-semibold">Facebook Follow Button</Label>
            </div>
            {checkoutConfig.fb_enabled && (
              <Input
                placeholder="https://facebook.com/your-page"
                value={checkoutConfig.fb_url}
                onChange={(e) => {
                  setCheckoutConfig({ ...checkoutConfig, fb_url: e.target.value });
                  setIsCheckoutConfigDirty(true);
                }}
              />
            )}
          </div>

          {/* Video / Photo */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="video_enabled"
                checked={checkoutConfig.video_enabled}
                onCheckedChange={(checked) => {
                  setCheckoutConfig({ ...checkoutConfig, video_enabled: checked === true });
                  setIsCheckoutConfigDirty(true);
                }}
              />
              <Label htmlFor="video_enabled" className="font-semibold">Video / Photo</Label>
            </div>
            {checkoutConfig.video_enabled && (
              <Input
                placeholder="https://youtube.com/watch?v=..."
                value={checkoutConfig.video_url}
                onChange={(e) => {
                  setCheckoutConfig({ ...checkoutConfig, video_url: e.target.value });
                  setIsCheckoutConfigDirty(true);
                }}
              />
            )}
          </div>

          {/* Experience Rating */}
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="rating_enabled"
                checked={checkoutConfig.rating_enabled}
                onCheckedChange={(checked) => {
                  setCheckoutConfig({ ...checkoutConfig, rating_enabled: checked === true });
                  setIsCheckoutConfigDirty(true);
                }}
              />
              <Label htmlFor="rating_enabled" className="font-semibold">Experience Rating</Label>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              Shows a 1-5 star rating after checkout. Ratings are stored per attendance record.
            </p>
          </div>

          {/* Save Button */}
          {isCheckoutConfigDirty && (
            <Button
              onClick={handleSaveCheckoutConfig}
              disabled={updateCampaign.isPending}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {updateCampaign.isPending ? 'Saving...' : 'Save Configuration'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Card Template Override */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Card Template</CardTitle>
              <CardDescription>
                {overrideCount > 0
                  ? `${overrideCount} field${overrideCount > 1 ? 's' : ''} overridden from system default`
                  : 'Using system default template'}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOverrideEditor(!showOverrideEditor)}
            >
              {showOverrideEditor ? 'Collapse' : 'Customize'}
            </Button>
          </div>
        </CardHeader>
        {showOverrideEditor && (
          <CardContent className="space-y-6">
            {/* Colors */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Colors</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Auto Card Color
                    {templateOverrides?.autoCardColor && <Badge variant="info" className="ml-1 text-[10px]">Overridden</Badge>}
                  </Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={effectiveTemplate.autoCardColor}
                      onChange={(e) => updateOverrideField('autoCardColor', e.target.value)}
                      className="h-9 w-12 rounded border cursor-pointer"
                    />
                    <Input
                      value={effectiveTemplate.autoCardColor}
                      onChange={(e) => updateOverrideField('autoCardColor', e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Manual Card Color
                    {templateOverrides?.manualCardColor && <Badge variant="info" className="ml-1 text-[10px]">Overridden</Badge>}
                  </Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={effectiveTemplate.manualCardColor}
                      onChange={(e) => updateOverrideField('manualCardColor', e.target.value)}
                      className="h-9 w-12 rounded border cursor-pointer"
                    />
                    <Input
                      value={effectiveTemplate.manualCardColor}
                      onChange={(e) => updateOverrideField('manualCardColor', e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Accent Color
                    {templateOverrides?.accentColor && <Badge variant="info" className="ml-1 text-[10px]">Overridden</Badge>}
                  </Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={effectiveTemplate.accentColor}
                      onChange={(e) => updateOverrideField('accentColor', e.target.value)}
                      className="h-9 w-12 rounded border cursor-pointer"
                    />
                    <Input
                      value={effectiveTemplate.accentColor}
                      onChange={(e) => updateOverrideField('accentColor', e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Panel Text Color
                    {templateOverrides?.panelTextColor && <Badge variant="info" className="ml-1 text-[10px]">Overridden</Badge>}
                  </Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={effectiveTemplate.panelTextColor}
                      onChange={(e) => updateOverrideField('panelTextColor', e.target.value)}
                      className="h-9 w-12 rounded border cursor-pointer"
                    />
                    <Input
                      value={effectiveTemplate.panelTextColor}
                      onChange={(e) => updateOverrideField('panelTextColor', e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Content</h4>
              <div className="space-y-2">
                <Label className="text-xs">
                  Subtitle
                  {templateOverrides?.subtitle && <Badge variant="info" className="ml-1 text-[10px]">Overridden</Badge>}
                </Label>
                <Input
                  value={effectiveTemplate.subtitle}
                  onChange={(e) => updateOverrideField('subtitle', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">
                  Instruction Text
                  {templateOverrides?.instructionText && <Badge variant="info" className="ml-1 text-[10px]">Overridden</Badge>}
                </Label>
                <Input
                  value={effectiveTemplate.instructionText}
                  onChange={(e) => updateOverrideField('instructionText', e.target.value)}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              {overrideCount > 0 && (
                <Button
                  variant="outline"
                  onClick={handleResetOverrides}
                  disabled={updateCampaign.isPending}
                >
                  Reset to System Default
                </Button>
              )}
              {isOverrideDirty && (
                <Button
                  onClick={handleSaveOverrides}
                  disabled={updateCampaign.isPending}
                >
                  {updateCampaign.isPending ? 'Saving...' : 'Save Overrides'}
                </Button>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Send Reminders confirmation dialog */}
      <Dialog open={!!reminderSlot} onOpenChange={(open) => { if (!open) setReminderSlot(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Event Reminders?</DialogTitle>
            <DialogDescription>
              {reminderSlot && reminderSlot.count > 0 ? (
                <>
                  This will send a reminder email to <strong>{reminderSlot.count} registered attendee{reminderSlot.count > 1 ? 's' : ''}</strong> for the <strong>{reminderSlot.label}</strong> slot.
                </>
              ) : (
                'No registered attendees with email addresses for this slot.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderSlot(null)}>
              Cancel
            </Button>
            {reminderSlot && reminderSlot.count > 0 && (
              <Button
                onClick={handleSendReminders}
                disabled={sendReminders.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Mail className="size-4 mr-1.5" />
                {sendReminders.isPending
                  ? 'Sending...'
                  : `Send ${reminderSlot.count} Email${reminderSlot.count > 1 ? 's' : ''}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
