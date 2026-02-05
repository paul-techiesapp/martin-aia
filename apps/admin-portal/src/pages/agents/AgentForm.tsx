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
import { useAgent, useCreateAgent, useUpdateAgent } from '../../hooks/useAgents';
import { useTiers } from '../../hooks/useTiers';
import { AgentStatus } from '@agent-system/shared-types';
import { useEffect } from 'react';

const agentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(8, 'Phone number must be at least 8 characters'),
  nric: z.string().min(9, 'NRIC must be at least 9 characters'),
  agent_code: z.string().min(1, 'Agent code is required'),
  unit_name: z.string().min(1, 'Unit name is required'),
  tier_id: z.string().min(1, 'Tier is required'),
  status: z.nativeEnum(AgentStatus),
});

type AgentFormData = z.infer<typeof agentSchema>;

export function AgentForm() {
  const navigate = useNavigate();
  const { agentId } = useParams({ strict: false });
  const isEditing = !!agentId;

  const { data: agent, isLoading: isLoadingAgent } = useAgent(agentId ?? '');
  const { data: tiers, isLoading: isLoadingTiers } = useTiers();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();

  const form = useForm<AgentFormData>({
    resolver: zodResolver(agentSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      nric: '',
      agent_code: '',
      unit_name: '',
      tier_id: '',
      status: AgentStatus.ACTIVE,
    },
  });

  useEffect(() => {
    if (agent) {
      form.reset({
        name: agent.name,
        email: agent.email,
        phone: agent.phone,
        nric: agent.nric,
        agent_code: agent.agent_code,
        unit_name: agent.unit_name,
        tier_id: agent.tier_id,
        status: agent.status,
      });
    }
  }, [agent, form]);

  const onSubmit = async (data: AgentFormData) => {
    try {
      if (isEditing && agentId) {
        await updateAgent.mutateAsync({ id: agentId, ...data });
      } else {
        // For new agents, we need to create an auth user first
        // For now, we'll use a placeholder user_id
        await createAgent.mutateAsync({ ...data, user_id: crypto.randomUUID() });
      }
      navigate({ to: '/agents' });
    } catch (error) {
      console.error('Failed to save agent:', error);
    }
  };

  if (isEditing && isLoadingAgent) {
    return <p>Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/agents' })}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h1 className="text-3xl font-bold">
            {isEditing ? 'Edit Agent' : 'Create Agent'}
          </h1>
          <p className="text-muted-foreground">
            {isEditing ? 'Update agent details' : 'Register a new agent'}
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Agent Details</CardTitle>
          <CardDescription>
            Enter the agent's information
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
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="+65 9123 4567" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="nric"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>NRIC</FormLabel>
                    <FormControl>
                      <Input placeholder="S1234567A" {...field} />
                    </FormControl>
                    <FormDescription>
                      National Registration Identity Card number
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="agent_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Agent Code</FormLabel>
                      <FormControl>
                        <Input placeholder="AGT001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="unit_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Team Alpha" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="tier_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tier</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select tier" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {isLoadingTiers ? (
                          <SelectItem value="" disabled>Loading...</SelectItem>
                        ) : (
                          tiers?.map((tier) => (
                            <SelectItem key={tier.id} value={tier.id}>
                              {tier.name} - ${tier.reward_amount}/attendance
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
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
                        <SelectItem value={AgentStatus.ACTIVE}>Active</SelectItem>
                        <SelectItem value={AgentStatus.INACTIVE}>Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-4">
                <Button
                  type="submit"
                  disabled={createAgent.isPending || updateAgent.isPending}
                >
                  {createAgent.isPending || updateAgent.isPending
                    ? 'Saving...'
                    : isEditing
                    ? 'Update Agent'
                    : 'Create Agent'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: '/agents' })}
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
