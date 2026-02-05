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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agent-system/shared-ui';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { useAgents, useDeleteAgent } from '../../hooks/useAgents';

export function AgentList() {
  const { data: agents, isLoading, error } = useAgents();
  const deleteAgent = useDeleteAgent();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteAgent.mutate(deleteId);
      setDeleteId(null);
    }
  };

  if (error) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6">
          <p className="text-red-600">Error loading agents: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Agents</h1>
          <p className="text-slate-500 mt-1">Manage agent accounts and tier assignments</p>
        </div>
        <Link to="/agents/new">
          <Button className="bg-slate-900 hover:bg-slate-800">
            <Plus className="h-4 w-4 mr-2" />
            New Agent
          </Button>
        </Link>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">All Agents</CardTitle>
          <CardDescription>
            {agents?.length ?? 0} registered agents
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={7} />
          ) : agents?.length === 0 ? (
            <p className="text-slate-500">No agents registered yet.</p>
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Agent Code</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents?.map((agent) => (
                    <TableRow key={agent.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell className="text-slate-600">{agent.agent_code}</TableCell>
                      <TableCell className="text-slate-600">{agent.email}</TableCell>
                      <TableCell className="text-slate-600">{agent.phone}</TableCell>
                      <TableCell className="text-slate-600">{agent.unit_name}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(agent.status)}>
                          {agent.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link to="/agents/$agentId/edit" params={{ agentId: agent.id }}>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>Edit agent</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleDelete(agent.id)}
                                disabled={deleteAgent.isPending}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete agent</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this agent? This action cannot be undone.
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
    </div>
  );
}
