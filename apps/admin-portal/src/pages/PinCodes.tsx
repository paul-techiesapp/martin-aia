import { useState, useEffect } from 'react';
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
import { supabase } from '../lib/supabase';
import { format, parseISO } from 'date-fns';

export function PinCodes() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');
  const [generateCount, setGenerateCount] = useState(10);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [qrMode, setQrMode] = useState<'checkin' | 'checkout' | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [displayTokens, setDisplayTokens] = useState<Array<{ id: string; token: string; expires_at: string }>>([]);

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

  useEffect(() => {
    if (!selectedSlotId) { setDisplayTokens([]); return; }
    supabase
      .from('display_tokens')
      .select('id, token, expires_at')
      .eq('slot_id', selectedSlotId)
      .then(({ data }) => setDisplayTokens(data || []));
  }, [selectedSlotId]);

  const handleGenerateDisplayToken = async () => {
    if (!selectedSlotId || !selectedCampaign) return;
    const { data } = await supabase
      .from('display_tokens')
      .insert({
        slot_id: selectedSlotId,
        expires_at: selectedCampaign.end_date,
      })
      .select()
      .single();
    if (data) setDisplayTokens((prev) => [...prev, data]);
  };

  const baseUrl = window.location.origin;
  const checkinUrl = `${baseUrl}/public/checkin?slot=${selectedSlotId}`;
  const checkoutUrl = `${baseUrl}/public/checkout?slot=${selectedSlotId}`;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">PIN Codes</h1>
        <p className="text-sm text-muted-foreground">Generate and manage attendance PIN codes for event slots</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Select Slot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Event</Label>
              <Select value={selectedCampaignId} onValueChange={(v) => {
                setSelectedCampaignId(v);
                setSelectedSlotId('');
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select event" />
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
                      {format(parseISO(slot.start_at), 'd MMM yyyy, HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
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
              <CardTitle>QR Codes for Venue</CardTitle>
              <CardDescription>Display for attendees to scan</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-4">
              <Dialog open={qrMode === 'checkin'} onOpenChange={(open) => setQrMode(open ? 'checkin' : null)}>
                <DialogTrigger asChild>
                  <Button className="flex-1">
                    <QrCode className="size-4 mr-1.5" />
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
                      {selectedSlot ? format(parseISO(selectedSlot.start_at), 'd MMM yyyy, HH:mm') : ''}
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
                    <QrCode className="size-4 mr-1.5" />
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
                      {selectedSlot ? `ends ${format(parseISO(selectedSlot.end_at), 'HH:mm')}` : ''}
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
                <CardTitle>Venue Display Links</CardTitle>
                <CardDescription>Share these links with venue devices for rotating QR codes</CardDescription>
              </div>
              <Button onClick={handleGenerateDisplayToken}>
                <Plus className="size-4 mr-1.5" />
                Generate Link
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {displayTokens.length === 0 ? (
              <p className="text-sm text-muted-foreground">No display links generated yet.</p>
            ) : (
              <div className="space-y-2">
                {displayTokens.map((dt) => {
                  const publicUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
                  const url = `${publicUrl}/public/display/${selectedSlotId}?token=${dt.token}`;
                  return (
                    <div key={dt.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <code className="text-xs text-slate-600 truncate max-w-[300px]">{url}</code>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(url)}>Copy</Button>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          await supabase.from('display_tokens').delete().eq('id', dt.id);
                          setDisplayTokens((prev) => prev.filter((t) => t.id !== dt.id));
                        }}>
                          <Trash2 className="size-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                      <Plus className="size-4 mr-1.5" />
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
                  <Printer className="size-4 mr-1.5" />
                  Print
                </Button>
                <Button variant="destructive" onClick={handleDeleteUnused}>
                  <Trash2 className="size-4 mr-1.5" />
                  Delete Unused
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <TableSkeleton rows={5} columns={3} />
            ) : pinCodes?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No PIN codes generated yet.</p>
            ) : (
              <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
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
                            <Check className="size-4" /> Used
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <X className="size-4" /> Unused
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{pin.linked_nric || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
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
