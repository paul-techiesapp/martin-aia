import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
} from '@agent-system/shared-ui';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Download, TrendingUp, Users, Calendar, DollarSign } from 'lucide-react';
import { useCampaigns } from '../hooks/useCampaigns';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

// Mock data for demonstration
const invitationData = [
  { name: 'Week 1', sent: 120, registered: 95, attended: 80 },
  { name: 'Week 2', sent: 150, registered: 120, attended: 100 },
  { name: 'Week 3', sent: 180, registered: 145, attended: 125 },
  { name: 'Week 4', sent: 200, registered: 170, attended: 150 },
];

const attendanceData = [
  { name: 'Full Attendance', value: 75 },
  { name: 'Partial', value: 15 },
  { name: 'No Show', value: 10 },
];

const topAgents = [
  { name: 'John Doe', invitations: 45, attendance: 38, rate: '84%' },
  { name: 'Jane Smith', invitations: 42, attendance: 35, rate: '83%' },
  { name: 'Bob Johnson', invitations: 38, attendance: 30, rate: '79%' },
  { name: 'Alice Brown', invitations: 35, attendance: 28, rate: '80%' },
  { name: 'Charlie Wilson', invitations: 32, attendance: 25, rate: '78%' },
];

const rewardSummary = [
  { tier: 'Gold Agent', count: 25, total: 2500 },
  { tier: 'Silver Agent', count: 40, total: 3200 },
  { tier: 'Gold Partner', count: 15, total: 2250 },
  { tier: 'Silver Partner', count: 30, total: 1800 },
];

export function Reports() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('month');
  const { data: campaigns } = useCampaigns();

  const handleExport = (type: string) => {
    // TODO: Implement CSV export
    alert(`Exporting ${type} report as CSV...`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reports & Analytics</h1>
          <p className="text-muted-foreground">Campaign performance and agent metrics</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-48">
          <Label>Campaign</Label>
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns?.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Label>Date Range</Label>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="quarter">This Quarter</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invitations</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">650</div>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-600">+12%</span> from last period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Registration Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">82%</div>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-600">+5%</span> from last period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Full Attendance</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">455</div>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-600">+8%</span> from last period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rewards Pending</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$9,750</div>
            <p className="text-xs text-muted-foreground">110 agents</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Invitation Funnel</CardTitle>
                <CardDescription>Weekly conversion rates</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('invitations')}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={invitationData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="sent" fill="#8884d8" name="Sent" />
                <Bar dataKey="registered" fill="#82ca9d" name="Registered" />
                <Bar dataKey="attended" fill="#ffc658" name="Attended" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Attendance Breakdown</CardTitle>
                <CardDescription>Completion status</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={attendanceData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {attendanceData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Top Performing Agents</CardTitle>
                <CardDescription>By attendance rate</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('agents')}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Invitations</TableHead>
                  <TableHead className="text-right">Attendance</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topAgents.map((agent) => (
                  <TableRow key={agent.name}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell className="text-right">{agent.invitations}</TableCell>
                    <TableCell className="text-right">{agent.attendance}</TableCell>
                    <TableCell className="text-right text-green-600">{agent.rate}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Reward Summary</CardTitle>
                <CardDescription>By tier</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExport('rewards')}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rewardSummary.map((row) => (
                  <TableRow key={row.tier}>
                    <TableCell className="font-medium">{row.tier}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right">${row.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
