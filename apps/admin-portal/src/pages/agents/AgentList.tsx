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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, MoreHorizontal } from 'lucide-react';
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
          <p className="text-red-600">Error loading units: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Units</h1>
          <p className="text-muted-foreground mt-1">Manage unit accounts and tier assignments</p>
        </div>
        <Link to="/agents/new">
          <Button>
            <Plus className="size-4 mr-2" />
            New Unit
          </Button>
        </Link>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">All Units</CardTitle>
          <CardDescription>
            {agents?.length ?? 0} registered units
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={7} />
          ) : agents?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No units registered yet. Add your first unit to get started.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
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
                    <TableCell className="text-muted-foreground">{agent.agent_code}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.email}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.unit_name}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(agent.status)}>
                        {agent.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="size-8 p-0" aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to="/agents/$agentId/edit" params={{ agentId: agent.id }}>
                              <Pencil className="mr-2 size-4" />
                              Edit Unit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => handleDelete(agent.id)}
                            disabled={deleteAgent.isPending}
                          >
                            <Trash2 className="mr-2 size-4" />
                            Delete Unit
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Unit</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this unit? This action cannot be undone.
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
