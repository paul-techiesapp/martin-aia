import { useState } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { Plus, Trash2, Printer, QrCode, Check, X } from 'lucide-react';
import { useCampaigns } from '../hooks/useCampaigns';
import { useSlots } from '../hooks/useSlots';
import { usePinCodes, useGeneratePinCodes, useDeletePinCodes } from '../hooks/usePinCodes';
import { QRCodeSVG } from 'qrcode.react';
import { CampaignStatus } from '@agent-system/shared-types';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function PinCodes() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');
  const [generateCount, setGenerateCount] = useState(10);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [qrMode, setQrMode] = useState<'checkin' | 'checkout' | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: campaigns } = useCampaigns();
  const { data: slots } = useSlots(selectedCampaignId);
  const { data: pinCodes, isLoading } = usePinCodes(selectedSlotId || undefined);
  const generatePins = useGeneratePinCodes();
  const deletePins = useDeletePinCodes();

  const activeCampaigns = campaigns?.filter(c => c.status === CampaignStatus.ACTIVE);
  const selectedSlot = slots?.find(s => s.id === selectedSlotId);
  const selectedCampaign = campaigns?.find(c => c.id === selectedCampaignId);

  const handleGenerate = async () => {
    if (!selectedSlotId) return;
    await generatePins.mutateAsync({ slotId: selectedSlotId, count: generateCount });
    setIsGenerateOpen(false);
  };

  const handleDeleteUnused = () => {
    setShowDeleteDialog(true);
  };

  const confirmDeleteUnused = () => {
    if (selectedSlotId) {
      deletePins.mutate({ slotId: selectedSlotId, onlyUnused: true });
    }
    setShowDeleteDialog(false);
  };

  const handlePrint = () => {
    window.print();
  };

  const baseUrl = window.location.origin;
  const checkinUrl = `${baseUrl}/public/checkin?slot=${selectedSlotId}`;
  const checkoutUrl = `${baseUrl}/public/checkout?slot=${selectedSlotId}`;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">PIN Codes</h1>
        <p className="text-slate-500">Generate and manage attendance PIN codes</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Select Slot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Campaign</Label>
              <Select value={selectedCampaignId} onValueChange={(v) => {
                setSelectedCampaignId(v);
                setSelectedSlotId('');
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select campaign" />
                </SelectTrigger>
                <SelectContent>
                  {activeCampaigns?.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Slot</Label>
              <Select
                value={selectedSlotId}
                onValueChange={setSelectedSlotId}
                disabled={!selectedCampaignId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select slot" />
                </SelectTrigger>
                <SelectContent>
                  {slots?.filter(s => s.is_active).map((slot) => (
                    <SelectItem key={slot.id} value={slot.id}>
                      {DAYS_OF_WEEK[slot.day_of_week]} {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {selectedSlotId && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">QR Codes for Venue</CardTitle>
              <CardDescription>Display for attendees to scan</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-4">
              <Dialog open={qrMode === 'checkin'} onOpenChange={(open) => setQrMode(open ? 'checkin' : null)}>
                <DialogTrigger asChild>
                  <Button className="flex-1">
                    <QrCode className="h-4 w-4 mr-2" />
                    Check-In QR
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Check-In QR Code</DialogTitle>
                    <DialogDescription>
                      Display this for attendees to scan when arriving
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col items-center gap-4 py-4">
                    <QRCodeSVG value={checkinUrl} size={256} />
                    <p className="text-sm text-muted-foreground text-center">
                      {selectedCampaign?.name}<br />
                      {DAYS_OF_WEEK[selectedSlot?.day_of_week ?? 0]} {selectedSlot?.start_time.slice(0, 5)}
                    </p>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => setQrMode(null)}>Close</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={qrMode === 'checkout'} onOpenChange={(open) => setQrMode(open ? 'checkout' : null)}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="flex-1">
                    <QrCode className="h-4 w-4 mr-2" />
                    Check-Out QR
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Check-Out QR Code</DialogTitle>
                    <DialogDescription>
                      Display this for attendees to scan when leaving
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col items-center gap-4 py-4">
                    <QRCodeSVG value={checkoutUrl} size={256} />
                    <p className="text-sm text-muted-foreground text-center">
                      {selectedCampaign?.name}<br />
                      {DAYS_OF_WEEK[selectedSlot?.day_of_week ?? 0]} ends {selectedSlot?.end_time.slice(0, 5)}
                    </p>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => setQrMode(null)}>Close</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        )}
      </div>

      {selectedSlotId && (
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>PIN Codes</CardTitle>
                <CardDescription>
                  {pinCodes?.length ?? 0} total • {pinCodes?.filter(p => !p.is_used).length ?? 0} unused
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Generate
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Generate PIN Codes</DialogTitle>
                      <DialogDescription>
                        Create new PIN codes for this slot
                      </DialogDescription>
                    </DialogHeader>
                    <div>
                      <Label>Number of PINs</Label>
                      <Input
                        type="number"
                        value={generateCount}
                        onChange={(e) => setGenerateCount(parseInt(e.target.value) || 10)}
                        min={1}
                        max={100}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsGenerateOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleGenerate} disabled={generatePins.isPending}>
                        {generatePins.isPending ? 'Generating...' : 'Generate'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button variant="outline" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
                <Button variant="destructive" onClick={handleDeleteUnused}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Unused
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <TableSkeleton rows={5} columns={3} />
            ) : pinCodes?.length === 0 ? (
              <p className="text-muted-foreground">No PIN codes generated yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PIN Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Linked NRIC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pinCodes?.map((pin) => (
                    <TableRow key={pin.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-mono text-lg">{pin.code}</TableCell>
                      <TableCell>
                        {pin.is_used ? (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <Check className="h-4 w-4" /> Used
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <X className="h-4 w-4" /> Unused
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{pin.linked_nric || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Unused PIN Codes</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all unused PIN codes for this slot? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUnused} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
