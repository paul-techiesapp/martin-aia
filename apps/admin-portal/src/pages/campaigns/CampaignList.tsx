import { useState } from 'react';
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
  Badge,
  getStatusVariant,
  TableSkeleton,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@agent-system/shared-ui';
import { Plus, Edit, Trash2, Eye, Play, Pause } from 'lucide-react';
import { useCampaigns, useDeleteCampaign, useUpdateCampaignStatus } from '../../hooks/useCampaigns';
import { CampaignStatus } from '@agent-system/shared-types';

export function CampaignList() {
  const { data: campaigns, isLoading, error } = useCampaigns();
  const deleteCampaign = useDeleteCampaign();
  const updateStatus = useUpdateCampaignStatus();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteCampaign.mutate(deleteId);
      setDeleteId(null);
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
      <Card className="glass-card">
        <CardContent className="p-6">
          <p className="text-red-600">Error loading campaigns: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-slate-500 mt-1">Manage recruitment campaigns and event slots</p>
        </div>
        <Link to="/campaigns/new">
          <Button className="bg-slate-900 hover:bg-slate-800">
            <Plus className="h-4 w-4 mr-2" />
            New Campaign
          </Button>
        </Link>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">All Campaigns</CardTitle>
          <CardDescription>
            {campaigns?.length ?? 0} total campaigns
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : campaigns?.length === 0 ? (
            <p className="text-slate-500">No campaigns yet. Create your first campaign to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
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
                  <TableRow key={campaign.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell className="text-slate-600">{campaign.venue}</TableCell>
                    <TableCell className="capitalize text-slate-600">
                      {campaign.invitation_type.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {new Date(campaign.start_date).toLocaleDateString()} -
                      {new Date(campaign.end_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link to="/campaigns/$campaignId" params={{ campaignId: campaign.id }}>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        {(campaign.status === CampaignStatus.ACTIVE || campaign.status === CampaignStatus.PAUSED) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
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
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <Edit className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleDelete(campaign.id)}
                          disabled={deleteCampaign.isPending}
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
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this campaign? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </div>
  );
}
