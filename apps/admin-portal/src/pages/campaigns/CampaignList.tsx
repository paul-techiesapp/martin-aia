import { Link } from '@tanstack/react-router';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@agent-system/shared-ui';
import { Plus, Edit, Trash2, Eye, Play, Pause } from 'lucide-react';
import { useCampaigns, useDeleteCampaign, useUpdateCampaignStatus } from '../../hooks/useCampaigns';
import { CampaignStatus } from '@agent-system/shared-types';

const statusColors: Record<CampaignStatus, string> = {
  [CampaignStatus.DRAFT]: 'bg-gray-100 text-gray-800',
  [CampaignStatus.ACTIVE]: 'bg-green-100 text-green-800',
  [CampaignStatus.PAUSED]: 'bg-yellow-100 text-yellow-800',
  [CampaignStatus.COMPLETED]: 'bg-blue-100 text-blue-800',
};

export function CampaignList() {
  const { data: campaigns, isLoading, error } = useCampaigns();
  const deleteCampaign = useDeleteCampaign();
  const updateStatus = useUpdateCampaignStatus();

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this campaign?')) {
      deleteCampaign.mutate(id);
    }
  };

  const handleToggleStatus = (id: string, currentStatus: CampaignStatus) => {
    const newStatus = currentStatus === CampaignStatus.ACTIVE
      ? CampaignStatus.PAUSED
      : CampaignStatus.ACTIVE;
    updateStatus.mutate({ id, status: newStatus });
  };

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-destructive">Error loading campaigns: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Campaigns</h1>
          <p className="text-muted-foreground">Manage recruitment campaigns and event slots</p>
        </div>
        <Link to="/campaigns/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Campaign
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Campaigns</CardTitle>
          <CardDescription>
            {campaigns?.length ?? 0} total campaigns
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading campaigns...</p>
          ) : campaigns?.length === 0 ? (
            <p className="text-muted-foreground">No campaigns yet. Create your first campaign to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns?.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell>{campaign.venue}</TableCell>
                    <TableCell className="capitalize">
                      {campaign.invitation_type.replace('_', ' ')}
                    </TableCell>
                    <TableCell>
                      {new Date(campaign.start_date).toLocaleDateString()} -
                      {new Date(campaign.end_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[campaign.status]}`}>
                        {campaign.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link to="/campaigns/$campaignId" params={{ campaignId: campaign.id }}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        {(campaign.status === CampaignStatus.ACTIVE || campaign.status === CampaignStatus.PAUSED) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleStatus(campaign.id, campaign.status)}
                            disabled={updateStatus.isPending}
                          >
                            {campaign.status === CampaignStatus.ACTIVE ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Link to="/campaigns/$campaignId/edit" params={{ campaignId: campaign.id }}>
                          <Button variant="ghost" size="sm">
                            <Edit className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(campaign.id)}
                          disabled={deleteCampaign.isPending}
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
