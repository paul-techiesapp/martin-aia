import { useNavigate, useParams } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  DatePicker,
  Switch,
} from '@agent-system/shared-ui';
import { ArrowLeft } from 'lucide-react';
import { parseISO, format } from 'date-fns';
import { useCampaign, useCreateCampaign, useUpdateCampaign } from '../../hooks/useCampaigns';
import { useAgents } from '../../hooks/useAgents';
import { useCampaignUnits, useSetCampaignUnits } from '../../hooks/useCampaignUnits';
import { InvitationType, CampaignStatus } from '@agent-system/shared-types';
import { useEffect, useRef, useState } from 'react';

const campaignSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  venue: z.string().min(1, 'Venue is required'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  registration_type: z.nativeEnum(InvitationType),
  status: z.nativeEnum(CampaignStatus),
  max_headcount: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().int().positive().nullable()
  ),
  commission_cap: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().int().positive().nullable()
  ),
  nric_required: z.boolean(),
  allow_repeat_attendees: z.boolean(),
});

type CampaignFormData = z.infer<typeof campaignSchema>;

export function CampaignForm() {
  const navigate = useNavigate();
  const { campaignId } = useParams({ strict: false });
  const isEditing = !!campaignId;

  const { data: campaign, isLoading: isLoadingCampaign } = useCampaign(campaignId ?? '');
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const { data: unitHeads } = useAgents();
  const { data: assignedUnitIds } = useCampaignUnits(campaignId);
  const setCampaignUnits = useSetCampaignUnits();
  // Unit ids selected in the form. Empty = event open to every unit.
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  // Which campaignId selectedUnitIds was last seeded from. Guards against a
  // background refetch of useCampaignUnits (staleTime 5min, refetchOnWindowFocus
  // default true) silently clobbering unsaved ticks when the admin refocuses the tab.
  const seededUnitsForCampaignId = useRef<string | undefined>(undefined);

  const form = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: '',
      venue: '',
      start_date: '',
      end_date: '',
      registration_type: InvitationType.BUSINESS_OPPORTUNITY,
      status: CampaignStatus.DRAFT,
      max_headcount: null,
      commission_cap: null,
      nric_required: true,
      allow_repeat_attendees: false,
    },
  });

  useEffect(() => {
    if (campaign) {
      form.reset({
        name: campaign.name,
        venue: campaign.venue,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        registration_type: campaign.registration_type,
        status: campaign.status,
        max_headcount: campaign.max_headcount,
        commission_cap: campaign.commission_cap,
        nric_required: campaign.nric_required ?? true,
        allow_repeat_attendees: campaign.allow_repeat_attendees ?? false,
      });
    }
  }, [campaign, form]);

  useEffect(() => {
    // Already seeded for this campaign (or lack of one) — a refetch must not
    // overwrite ticks the admin hasn't saved yet.
    if (seededUnitsForCampaignId.current === campaignId) return;
    // Editing an existing campaign but its units haven't loaded yet — wait
    // rather than seeding with a stale/empty value.
    if (campaignId && assignedUnitIds === undefined) return;
    setSelectedUnitIds(assignedUnitIds ?? []);
    seededUnitsForCampaignId.current = campaignId;
  }, [campaignId, assignedUnitIds]);

  const onSubmit = async (data: CampaignFormData) => {
    try {
      const payload = {
        ...data,
        max_headcount: data.max_headcount || null,
        commission_cap: data.commission_cap || null,
      };
      if (isEditing && campaignId) {
        await updateCampaign.mutateAsync({ id: campaignId, ...payload });
        await setCampaignUnits.mutateAsync({ campaignId, unitAgentIds: selectedUnitIds });
      } else {
        const created = await createCampaign.mutateAsync({ ...payload, checkout_config: { fb_enabled: false, fb_url: '', video_enabled: false, video_url: '', rating_enabled: false } });
        if (selectedUnitIds.length > 0) {
          await setCampaignUnits.mutateAsync({ campaignId: created.id, unitAgentIds: selectedUnitIds });
        }
      }
      navigate({ to: '/campaigns' });
    } catch (error) {
      console.error('Failed to save campaign:', error);
    }
  };

  if (isEditing && isLoadingCampaign) {
    return <p>Loading...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/campaigns' })}>
          <ArrowLeft className="size-4 mr-1.5" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">
            {isEditing ? 'Edit Event' : 'Create Event'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEditing ? 'Update event details' : 'Set up a new recruitment event'}
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Event Details</CardTitle>
          <CardDescription>
            Enter the basic information for this event
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Q1 2026 Recruitment Drive" {...field} />
                    </FormControl>
                    <FormDescription>
                      A descriptive name for this event
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="venue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Venue</FormLabel>
                    <FormControl>
                      <Input placeholder="Marina Bay Sands Convention Hall" {...field} />
                    </FormControl>
                    <FormDescription>
                      Where the recruitment events will be held
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="start_date"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Start Date</FormLabel>
                      <DatePicker
                        date={field.value ? parseISO(field.value) : undefined}
                        onDateChange={(date) =>
                          field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                        }
                        placeholder="Select start date"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="end_date"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>End Date</FormLabel>
                      <DatePicker
                        date={field.value ? parseISO(field.value) : undefined}
                        onDateChange={(date) =>
                          field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                        }
                        placeholder="Select end date"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="registration_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invitation Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select invitation type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={InvitationType.BUSINESS_OPPORTUNITY}>
                          Business Opportunity
                        </SelectItem>
                        <SelectItem value={InvitationType.JOB_OPPORTUNITY}>
                          Job Opportunity
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The type of opportunity being presented
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={CampaignStatus.DRAFT}>Draft</SelectItem>
                        <SelectItem value={CampaignStatus.ACTIVE}>Active</SelectItem>
                        <SelectItem value={CampaignStatus.PAUSED}>Paused</SelectItem>
                        <SelectItem value={CampaignStatus.COMPLETED}>Completed</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="max_headcount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Headcount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Leave empty for unlimited"
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          field.onChange(val === '' ? null : parseInt(val));
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Maximum total attendees across all slots. Leave empty for unlimited.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="commission_cap"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commission Cap (first X invitees)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Leave empty for no cap"
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          field.onChange(val === '' ? null : parseInt(val));
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Only the first X invitees who complete the event earn a commission for their agent. Leave empty so every completion earns commission.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="nric_required"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5 pr-4">
                      <FormLabel>Require NRIC at registration</FormLabel>
                      <FormDescription>
                        When on, invitees must enter their NRIC to register. Turn off to make NRIC optional for this event.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="allow_repeat_attendees"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5 pr-4">
                      <FormLabel>Allow repeat attendees</FormLabel>
                      <FormDescription>
                        When on, people who already completed a previous event (finished Sign In &amp;
                        Sign Out, e.g. at BOP or JOP) can still register for this event. When off,
                        anyone who has completed any event is blocked from registering.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <Card>
                <CardHeader>
                  <CardTitle>Units</CardTitle>
                  <CardDescription>
                    Restrict this event to specific units. Leave everything unticked to keep it public —
                    open to every unit and agent. Agents outside the ticked units will no longer see this
                    event in their portal, create new links for it, or take new registrations through
                    links they've already shared. Existing registrations can still check in and out.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="max-h-64 space-y-2 overflow-auto rounded-md border p-3">
                    {(unitHeads ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No units found.</p>
                    ) : (
                      (unitHeads ?? []).map((u) => (
                        <label key={u.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={selectedUnitIds.includes(u.id)}
                            onCheckedChange={(checked) =>
                              setSelectedUnitIds((prev) =>
                                checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                              )
                            }
                          />
                          <span>
                            {u.unit_name || u.name}
                            <span className="text-muted-foreground"> · {u.agent_code}</span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  <p className="mt-2">
                    {selectedUnitIds.length === 0 ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                        Public — open to all units &amp; agents
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                        Restricted to {selectedUnitIds.length} unit{selectedUnitIds.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </p>
                </CardContent>
              </Card>

              <div className="flex gap-4">
                <Button
                  type="submit"
                  disabled={createCampaign.isPending || updateCampaign.isPending}
                >
                  {createCampaign.isPending || updateCampaign.isPending
                    ? 'Saving...'
                    : isEditing
                    ? 'Update Event'
                    : 'Create Event'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: '/campaigns' })}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
