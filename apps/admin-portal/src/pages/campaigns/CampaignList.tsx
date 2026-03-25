import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  DatePicker,
  useToast,
} from '@agent-system/shared-ui';
import { Plus, Edit, Trash2, Eye, Play, Pause, MoreHorizontal, Copy, Loader2 } from 'lucide-react';
import { useCampaigns, useDeleteCampaign, useUpdateCampaignStatus, useDuplicateCampaign } from '../../hooks/useCampaigns';
import { CampaignStatus } from '@agent-system/shared-types';
import { format } from 'date-fns';

export function CampaignList() {
  const navigate = useNavigate();
  const { data: campaigns, isLoading, error } = useCampaigns();
  const deleteCampaign = useDeleteCampaign();
  const updateStatus = useUpdateCampaignStatus();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const duplicateCampaign = useDuplicateCampaign();
  const { toast } = useToast();
  const [duplicateSource, setDuplicateSource] = useState<{ id: string; name: string } | null>(null);
  const [dupName, setDupName] = useState('');
  const [dupStartDate, setDupStartDate] = useState<Date | undefined>(undefined);
  const [dupEndDate, setDupEndDate] = useState<Date | undefined>(undefined);

  const handleOpenDuplicate = (id: string, name: string) => {
    setDuplicateSource({ id, name });
    setDupName(`${name} (Copy)`);
    setDupStartDate(undefined);
    setDupEndDate(undefined);
  };

  const handleDuplicate = async () => {
    if (!duplicateSource || !dupName.trim() || !dupStartDate || !dupEndDate) return;

    try {
      const result = await duplicateCampaign.mutateAsync({
        sourceId: duplicateSource.id,
        newName: dupName.trim(),
        newStartDate: format(dupStartDate, 'yyyy-MM-dd'),
        newEndDate: format(dupEndDate, 'yyyy-MM-dd'),
      });

      setDuplicateSource(null);
      toast({
        title: 'Event duplicated',
        description: `Created "${result.campaign.name}" with ${result.slotCount} slot${result.slotCount !== 1 ? 's' : ''}`,
      });
      navigate({ to: '/campaigns/$campaignId', params: { campaignId: result.campaign.id } });
    } catch (err) {
      toast({
        title: 'Duplication failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'error',
      });
    }
  };

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
          <p className="text-red-600">Error loading events: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Events</h1>
          <p className="text-slate-500 mt-1">Manage recruitment events and time slots</p>
        </div>
        <Link to="/campaigns/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Event
          </Button>
        </Link>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">All Events</CardTitle>
          <CardDescription>
            {campaigns?.length ?? 0} total events
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : campaigns?.length === 0 ? (
            <p className="text-slate-500">No events yet. Create your first event to get started.</p>
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
                      {campaign.registration_type?.replace('_', ' ')}
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0" aria-label="Actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => navigate({ to: '/campaigns/$campaignId', params: { campaignId: campaign.id } })}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => navigate({ to: '/campaigns/$campaignId/edit', params: { campaignId: campaign.id } })}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Event
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleOpenDuplicate(campaign.id, campaign.name)}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate Event
                          </DropdownMenuItem>
                          {(campaign.status === CampaignStatus.ACTIVE || campaign.status === CampaignStatus.PAUSED) && (
                            <DropdownMenuItem
                              onClick={() => handleToggleStatus(campaign.id, campaign.status)}
                              disabled={updateStatus.isPending}
                            >
                              {campaign.status === CampaignStatus.ACTIVE ? (
                                <>
                                  <Pause className="mr-2 h-4 w-4" />
                                  Pause Event
                                </>
                              ) : (
                                <>
                                  <Play className="mr-2 h-4 w-4" />
                                  Resume Event
                                </>
                              )}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => handleDelete(campaign.id)}
                            disabled={deleteCampaign.isPending}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Event
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
              <AlertDialogTitle>Delete Event</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this event? This action cannot be undone.
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
        <Dialog open={!!duplicateSource} onOpenChange={(open) => !open && setDuplicateSource(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Duplicate Event</DialogTitle>
              <DialogDescription>
                Create a copy of this event with new dates. All slots will be shifted to match the new date range.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Event Name</Label>
                <Input
                  value={dupName}
                  onChange={(e) => setDupName(e.target.value)}
                  placeholder="Enter event name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <DatePicker date={dupStartDate} onDateChange={setDupStartDate} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <DatePicker date={dupEndDate} onDateChange={setDupEndDate} />
                </div>
              </div>
              {dupStartDate && dupEndDate && dupEndDate <= dupStartDate && (
                <p className="text-sm text-red-600">End date must be after start date</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDuplicateSource(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleDuplicate}
                disabled={
                  !dupName.trim() ||
                  !dupStartDate ||
                  !dupEndDate ||
                  dupEndDate <= dupStartDate ||
                  duplicateCampaign.isPending
                }
              >
                {duplicateCampaign.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Duplicating...
                  </>
                ) : (
                  'Duplicate'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  );
}
