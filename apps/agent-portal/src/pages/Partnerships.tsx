import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  useToast,
} from '@agent-system/shared-ui';
import { QRCodeSVG } from 'qrcode.react';
import { Store, QrCode, Copy, Check, Plus, MapPin } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  useAgentMerchants,
  useProposeMerchant,
  useProposeBranch,
} from '../hooks/useAgentMerchants';
import { useMyBranchLinks, useCreateBranchLink } from '../hooks/useAgentBranchLinks';
import { MerchantStatus, type MerchantBranch } from '@agent-system/shared-types';

const enquiryUrl = (code: string) =>
  `${import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin}/public/enquiry/${code}`;

export function Partnerships() {
  const { agent, role } = useAuth();
  const { toast } = useToast();

  const { data: merchants, isLoading, isError, error } = useAgentMerchants();
  const { data: myLinks } = useMyBranchLinks(agent?.id);
  const proposeMerchant = useProposeMerchant();
  const proposeBranch = useProposeBranch();
  const createBranchLink = useCreateBranchLink();

  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null);
  const [isMerchantOpen, setIsMerchantOpen] = useState(false);
  const [isBranchOpen, setIsBranchOpen] = useState(false);
  const [merchantName, setMerchantName] = useState('');
  const [branchForm, setBranchForm] = useState({ name: '', address: '', phone: '' });
  const [qr, setQr] = useState<{ code: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyBranchId, setBusyBranchId] = useState<string | null>(null);

  // Partner-role users have no agents row (get_agent_id() is null), so this
  // surface does not apply to them.
  if (role === 'partner') {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>This page is only available to agents.</p>
      </div>
    );
  }

  const activeMerchants = merchants?.filter((m) => m.status === MerchantStatus.ACTIVE) ?? [];
  const myPending =
    merchants?.filter(
      (m) => m.status === MerchantStatus.PENDING && m.created_by_agent_id === agent?.id,
    ) ?? [];
  const selectedMerchant = merchants?.find((m) => m.id === selectedMerchantId) ?? null;

  const handleProposeMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent?.id) return;
    try {
      await proposeMerchant.mutateAsync({ name: merchantName, agentId: agent.id });
      toast({ title: 'Merchant proposed', description: 'An admin will review and approve it.' });
      setIsMerchantOpen(false);
      setMerchantName('');
    } catch (err: any) {
      toast({ title: 'Failed to propose merchant', description: err.message, variant: 'error' });
    }
  };

  const handleProposeBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent?.id || !selectedMerchantId) return;
    try {
      await proposeBranch.mutateAsync({
        merchantId: selectedMerchantId,
        name: branchForm.name,
        address: branchForm.address,
        phone: branchForm.phone,
        agentId: agent.id,
      });
      toast({ title: 'Branch proposed', description: 'An admin will review and approve it.' });
      setIsBranchOpen(false);
      setBranchForm({ name: '', address: '', phone: '' });
    } catch (err: any) {
      toast({ title: 'Failed to propose branch', description: err.message, variant: 'error' });
    }
  };

  const handleGenerateQr = async (branch: MerchantBranch, merchantName: string) => {
    if (!agent?.id) return;
    setBusyBranchId(branch.id);
    try {
      const link = await createBranchLink.mutateAsync({
        agentId: agent.id,
        merchantBranchId: branch.id,
      });
      setQr({ code: link.link_code, label: `${merchantName} — ${branch.name}` });
    } catch (err: any) {
      toast({ title: 'Failed to generate QR', description: err.message, variant: 'error' });
    } finally {
      setBusyBranchId(null);
    }
  };

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(enquiryUrl(code));
    setCopied(true);
    toast({ title: 'Link copied!', description: 'Share this enquiry link with customers.' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Partnerships</h1>
          <p className="text-sm text-muted-foreground">
            Browse gift-partner merchants, propose new ones, and share your branch QR
          </p>
        </div>
        <Button onClick={() => setIsMerchantOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          Propose Merchant
        </Button>
      </div>

      {/* Approved merchants to browse */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Approved Merchants</h2>
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-2" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="py-4">
              <p className="text-destructive">Error loading: {(error as Error)?.message}</p>
            </CardContent>
          </Card>
        ) : activeMerchants.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <p className="text-muted-foreground text-center">
                No approved merchants yet. Propose one above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {activeMerchants.map((merchant) => (
              <Card
                key={merchant.id}
                className={`cursor-pointer transition-colors duration-150 ${
                  selectedMerchantId === merchant.id
                    ? 'ring-2 ring-primary shadow-sm'
                    : 'hover:bg-muted/50'
                }`}
                onClick={() => setSelectedMerchantId(merchant.id)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Store className="size-4 text-muted-foreground" />
                    {merchant.name}
                  </CardTitle>
                  <CardDescription>
                    {merchant.branches.filter((b) => b.status === MerchantStatus.ACTIVE).length} approved
                    branch(es)
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Branches of the selected merchant */}
      {selectedMerchant && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{selectedMerchant.name} — Branches</CardTitle>
              <CardDescription>Generate and share your QR for an approved branch</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setIsBranchOpen(true)}>
              <Plus className="size-4 mr-1.5" />
              Propose Branch
            </Button>
          </CardHeader>
          <CardContent>
            {selectedMerchant.branches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No branches yet. Propose one for admin approval.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedMerchant.branches.map((branch) => (
                  <div
                    key={branch.id}
                    className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50"
                  >
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        {branch.name}
                        {branch.status !== MerchantStatus.ACTIVE && (
                          <Badge variant="warning" className="text-xs">
                            Pending approval
                          </Badge>
                        )}
                      </div>
                      {branch.address && (
                        <div className="text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="size-3" />
                          {branch.address}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={branch.status !== MerchantStatus.ACTIVE || busyBranchId === branch.id}
                      onClick={() => handleGenerateQr(branch, selectedMerchant.name)}
                    >
                      <QrCode className="size-4 mr-1" />
                      {busyBranchId === branch.id ? 'Creating...' : 'Get QR'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Agent's own pending merchant proposals */}
      {myPending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Pending Proposals</CardTitle>
            <CardDescription>Merchants you proposed, awaiting admin approval</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {myPending.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{m.name}</span>
                  <Badge variant="warning">Pending approval</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing shared branch links */}
      {myLinks && myLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Shared Branches</CardTitle>
            <CardDescription>
              {myLinks.length} branch QR{myLinks.length !== 1 ? 's' : ''} generated
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {myLinks.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50"
                >
                  <div>
                    <div className="font-medium text-foreground">{link.branch.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {link.branch.merchant?.name ?? 'Unknown merchant'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setQr({
                          code: link.link_code,
                          label: `${link.branch.merchant?.name ?? ''} — ${link.branch.name}`,
                        })
                      }
                    >
                      <QrCode className="size-4 mr-1" />
                      Show QR
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleCopy(link.link_code)}>
                      {copied ? (
                        <>
                          <Check className="size-4 mr-1 text-emerald-600" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="size-4 mr-1" /> Copy Link
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Propose Merchant dialog */}
      <Dialog open={isMerchantOpen} onOpenChange={setIsMerchantOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Propose Merchant</DialogTitle>
            <DialogDescription>
              Suggest a new gift-partner merchant. An admin reviews, configures the gift split, and
              approves it before it goes live.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProposeMerchant} className="space-y-4">
            <div>
              <Label htmlFor="merchant-name">Merchant Name</Label>
              <Input
                id="merchant-name"
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                placeholder="Poh Kong"
                required
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsMerchantOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={proposeMerchant.isPending}>
                {proposeMerchant.isPending ? 'Submitting...' : 'Propose'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Propose Branch dialog */}
      <Dialog open={isBranchOpen} onOpenChange={setIsBranchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Propose Branch</DialogTitle>
            <DialogDescription>
              Add a branch under {selectedMerchant?.name ?? 'this merchant'}. It awaits admin approval
              before you can share its QR.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProposeBranch} className="space-y-4">
            <div>
              <Label htmlFor="branch-name">Branch Name</Label>
              <Input
                id="branch-name"
                value={branchForm.name}
                onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Mid Valley"
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="branch-address">Address (optional)</Label>
              <Input
                id="branch-address"
                value={branchForm.address}
                onChange={(e) => setBranchForm((f) => ({ ...f, address: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="branch-phone">Phone (optional)</Label>
              <Input
                id="branch-phone"
                value={branchForm.phone}
                onChange={(e) => setBranchForm((f) => ({ ...f, phone: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsBranchOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={proposeBranch.isPending}>
                {proposeBranch.isPending ? 'Submitting...' : 'Propose'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* QR display dialog */}
      <Dialog open={!!qr} onOpenChange={(open) => !open && setQr(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Branch QR</DialogTitle>
            <DialogDescription>{qr?.label}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qr && <QRCodeSVG value={enquiryUrl(qr.code)} size={256} />}
            <p className="text-xs text-muted-foreground break-all text-center">
              {qr && enquiryUrl(qr.code)}
            </p>
            {qr && (
              <Button variant="outline" onClick={() => handleCopy(qr.code)}>
                {copied ? (
                  <>
                    <Check className="size-4 mr-1 text-emerald-600" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-4 mr-1" /> Copy Link
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
