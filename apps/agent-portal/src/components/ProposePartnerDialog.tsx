import { useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useToast,
} from '@agent-system/shared-ui';
import { FileText, Upload } from 'lucide-react';
import { useProposeMerchant } from '../hooks/useAgentMerchants';

const ACCEPTED = 'application/pdf,image/jpeg,image/png';
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Round 3 item 1: agents submit the full partner profile + signed agreement;
// a master admin reviews the agreement and sets money terms before approval.
export function ProposePartnerDialog({ agentId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const proposeMerchant = useProposeMerchant();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [agreementFile, setAgreementFile] = useState<File | null>(null);

  const reset = () => {
    setName(''); setContactPerson(''); setContactPhone('');
    setBranchName(''); setBranchAddress(''); setBranchPhone('');
    setAgreementFile(null);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast({ title: 'File too large', description: 'Max 10 MB.', variant: 'error' });
      return;
    }
    setAgreementFile(file);
  };

  const canSubmit = name.trim() !== '' && agreementFile !== null && !proposeMerchant.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || !agreementFile) return;
    try {
      await proposeMerchant.mutateAsync({
        agentId,
        name: name.trim(),
        contactPerson,
        contactPhone,
        branch: { name: branchName, address: branchAddress, phone: branchPhone },
        agreementFile,
      });
      toast({ title: 'Submitted for admin approval' });
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      toast({ title: 'Failed to submit', description: (err as Error)?.message, variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Propose a Partnership</DialogTitle>
          <DialogDescription>
            Complete the partner info and upload the signed agreement. A master admin will
            review and approve before the partnership becomes active.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="propose-partner-name">Merchant name *</Label>
            <Input id="propose-partner-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Golden Jewellers" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="propose-contact-person">Contact person</Label>
              <Input id="propose-contact-person" value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="propose-contact-phone">Contact phone</Label>
              <Input id="propose-contact-phone" value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="propose-branch-name">First branch / outlet</Label>
            <Input id="propose-branch-name" value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="Defaults to merchant name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="propose-branch-address">Branch address</Label>
            <Input id="propose-branch-address" value={branchAddress}
              onChange={(e) => setBranchAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="propose-branch-phone">Branch phone</Label>
            <Input id="propose-branch-phone" value={branchPhone}
              onChange={(e) => setBranchPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Signed agreement (PDF or image) *</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" className="w-full justify-start"
              onClick={() => fileInputRef.current?.click()}>
              {agreementFile ? (
                <><FileText className="size-4 mr-2" />
                  <span className="truncate">{agreementFile.name}</span></>
              ) : (
                <><Upload className="size-4 mr-2" />Upload agreement</>
              )}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {proposeMerchant.isPending ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
