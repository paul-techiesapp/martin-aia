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
} from '@agent-system/shared-ui';
import { ArrowLeft } from 'lucide-react';
import { useCampaign, useCreateCampaign, useUpdateCampaign } from '../../hooks/useCampaigns';
import { InvitationType, CampaignStatus } from '@agent-system/shared-types';
import { useEffect } from 'react';

const campaignSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  venue: z.string().min(1, 'Venue is required'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  invitation_type: z.nativeEnum(InvitationType),
  status: z.nativeEnum(CampaignStatus),
});

type CampaignFormData = z.infer<typeof campaignSchema>;

export function CampaignForm() {
  const navigate = useNavigate();
  const { campaignId } = useParams({ strict: false });
  const isEditing = !!campaignId;

  const { data: campaign, isLoading: isLoadingCampaign } = useCampaign(campaignId ?? '');
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();

  const form = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: '',
      venue: '',
      start_date: '',
      end_date: '',
      invitation_type: InvitationType.BUSINESS_OPPORTUNITY,
      status: CampaignStatus.DRAFT,
    },
  });

  useEffect(() => {
    if (campaign) {
      form.reset({
        name: campaign.name,
        venue: campaign.venue,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        invitation_type: campaign.invitation_type,
        status: campaign.status,
      });
    }
  }, [campaign, form]);

  const onSubmit = async (data: CampaignFormData) => {
    try {
      if (isEditing && campaignId) {
        await updateCampaign.mutateAsync({ id: campaignId, ...data });
      } else {
        await createCampaign.mutateAsync(data);
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
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/campaigns' })}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h1 className="text-3xl font-bold">
            {isEditing ? 'Edit Campaign' : 'Create Campaign'}
          </h1>
          <p className="text-muted-foreground">
            {isEditing ? 'Update campaign details' : 'Set up a new recruitment campaign'}
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Campaign Details</CardTitle>
          <CardDescription>
            Enter the basic information for this campaign
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
                    <FormLabel>Campaign Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Q1 2026 Recruitment Drive" {...field} />
                    </FormControl>
                    <FormDescription>
                      A descriptive name for this campaign
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
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="end_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="invitation_type"
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

              <div className="flex gap-4">
                <Button
                  type="submit"
                  disabled={createCampaign.isPending || updateCampaign.isPending}
                >
                  {createCampaign.isPending || updateCampaign.isPending
                    ? 'Saving...'
                    : isEditing
                    ? 'Update Campaign'
                    : 'Create Campaign'}
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
