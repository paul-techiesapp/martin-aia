import { useState, useEffect } from 'react';
import { Link, useParams } from '@tanstack/react-router';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Badge,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  TableSkeleton,
  Combobox,
  Switch,
  useToast,
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, Check, ArrowLeft, QrCode, Copy, Link2, Power, FileText, KeyRound } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useMerchant, useUpdateMerchant } from '../../hooks/useMerchants';
import { useCreateMerchantUser, useRevokeMerchantUser } from '../../hooks/useMerchantUser';
import { useUploadFormImage } from '../../hooks/useCompanyAssets';
import { supabase } from '../../lib/supabase';
import {
  useMerchantBranches,
  useCreateMerchantBranch,
  useUpdateMerchantBranch,
  useDeleteMerchantBranch,
  useApproveMerchantBranch,
} from '../../hooks/useMerchantBranches';
import {
  useBranchLinks,
  useCreateBranchLink,
  useDeactivateBranchLink,
} from '../../hooks/useBranchLinks';
import { useAllAgents } from '../../hooks/useAllAgents';
import { useSystemSettings } from '../../hooks/useSystemSettings';
import { MerchantStatus, type MerchantBranch, type MerchantFormSettings } from '@agent-system/shared-types';

const publicBaseUrl = () => import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
const enquiryUrl = (code: string) => `${publicBaseUrl()}/public/enquiry/${code}`;

const HOUSE_VALUE = '__house__';

function BranchLinksDialog({
  branch,
  open,
  onOpenChange,
}: {
  branch: MerchantBranch;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: links, isLoading } = useBranchLinks(branch.id);
  const createLink = useCreateBranchLink();
  const deactivateLink = useDeactivateBranchLink(branch.id);
  const { data: agents } = useAllAgents();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(HOUSE_VALUE);

  const handleGenerate = async () => {
    const agentId = selectedAgentId === HOUSE_VALUE ? null : selectedAgentId;
    try {
      await createLink.mutateAsync({ branchId: branch.id, agentId });
      const label = agentId
        ? (agents?.find((a) => a.id === agentId)?.name ?? 'agent')
        : 'house';
      toast({ title: 'Link created', description: `QR link tied to ${label} created.` });
    } catch (err: any) {
      toast({ title: 'Failed to create link', description: err.message, variant: 'error' });
    }
  };

  const handleCopy = async (code: string, id: string) => {
    await navigator.clipboard.writeText(enquiryUrl(code));
    setCopiedId(id);
    toast({ title: 'Link copied!', description: 'Customer enquiry link copied to clipboard.' });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const agentName = (agentId: string | null) =>
    agentId ? (agents?.find((a) => a.id === agentId)?.name ?? agentId) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Branch Links — {branch.name}</DialogTitle>
          <DialogDescription>
            Generate QR codes for the customer enquiry form. Optionally tie to an agent for commission tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Tie to agent (optional)</Label>
            <Combobox
              className="mt-1"
              value={selectedAgentId}
              onValueChange={setSelectedAgentId}
              placeholder="House — no agent"
              searchPlaceholder="Search agents..."
              options={[
                { value: HOUSE_VALUE, label: 'House — no agent' },
                ...(agents ?? [])
                  .filter((agent) => agent.parent_agent_id !== null)
                  .map((agent) => ({
                    value: agent.id,
                    label: `${agent.name} (${agent.agent_code})`,
                  })),
              ]}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleGenerate} disabled={createLink.isPending}>
              <Link2 className="size-4 mr-1.5" />
              {createLink.isPending ? 'Generating...' : 'Generate link'}
            </Button>
          </div>
        </div>

        <div className="space-y-3 max-h-[50vh] overflow-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading links...</p>
          ) : (links?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No links yet. Generate the first link above.</p>
          ) : (
            links?.map((link) => {
              const tied = agentName(link.agent_id);
              return (
                <div key={link.id} className="flex items-center gap-3 rounded-md border p-3">
                  <div className="shrink-0 rounded bg-white p-1">
                    <QRCodeSVG value={enquiryUrl(link.link_code)} size={88} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={link.is_active ? 'active' : 'inactive'}>
                        {link.is_active ? 'active' : 'inactive'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {tied ? `Agent: ${tied}` : 'House'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={enquiryUrl(link.link_code)}>
                      {enquiryUrl(link.link_code)}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleCopy(link.link_code, link.id)}>
                        {copiedId === link.id ? (
                          <>
                            <Check className="size-4 mr-1 text-emerald-600" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="size-4 mr-1" /> Copy URL
                          </>
                        )}
                      </Button>
                      {link.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deactivateLink.mutate(link.id)}
                          disabled={deactivateLink.isPending}
                        >
                          <Power className="size-4 mr-1 text-destructive" /> Deactivate
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormDesignCard({ merchantId, formSettings }: { merchantId: string; formSettings: MerchantFormSettings | null }) {
  const { toast } = useToast();
  const updateMerchant = useUpdateMerchant();
  const uploadFormImage = useUploadFormImage();
  const [draft, setDraft] = useState<MerchantFormSettings>(formSettings ?? {});
  const [uploadingKey, setUploadingKey] = useState<'header_image_url' | 'header_logo_url' | null>(null);

  // Reseed the draft only when the SAVED settings content changes (a plain
  // object identity check would wipe drafts on every unrelated refetch).
  const settingsKey = JSON.stringify(formSettings ?? {});
  useEffect(() => {
    setDraft(formSettings ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  const handleUpload = async (
    key: 'header_image_url' | 'header_logo_url',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (uploadingKey) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Please upload a PNG or JPEG image.', variant: 'error' });
      return;
    }
    setUploadingKey(key);
    try {
      const url = await uploadFormImage.mutateAsync({ file, key: `merchant-${merchantId}-${key}` });
      setDraft((prev) => ({ ...prev, [key]: url }));
      toast({ title: 'Image uploaded', description: 'Remember to save the form design.' });
    } catch {
      toast({ title: 'Upload failed', variant: 'error' });
    } finally {
      setUploadingKey(null);
    }
  };

  const handleSave = async () => {
    // Empty strings mean "use the global setting" — strip them so the public
    // form's per-field fallback works. Booleans are kept when true and dropped
    // when false, so `false` and "unset" store identically (absent = not
    // required). Filtering by `typeof v === 'string'` alone silently discarded
    // the staff_id_required flag.
    const cleaned = Object.fromEntries(
      Object.entries(draft).filter(([, v]) =>
        typeof v === 'boolean' ? v : typeof v === 'string' && v.trim() !== '',
      ),
    ) as MerchantFormSettings;
    try {
      await updateMerchant.mutateAsync({
        id: merchantId,
        form_settings: Object.keys(cleaned).length > 0 ? cleaned : null,
      });
      toast({ title: 'Form design saved' });
    } catch (err: unknown) {
      toast({ title: 'Failed to save', description: (err as Error)?.message, variant: 'error' });
    }
  };

  const textField = (key: 'header_title' | 'header_subtitle' | 'footer_text', label: string, placeholder: string) => (
    <div>
      <Label>{label}</Label>
      <Input
        value={draft[key] ?? ''}
        onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
      />
    </div>
  );

  const imageField = (key: 'header_image_url' | 'header_logo_url', label: string) => (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-3">
        {draft[key] ? (
          <img src={draft[key]} alt="" className="h-12 rounded border object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">Using global image</span>
        )}
        <Button variant="outline" size="sm" asChild disabled={uploadingKey === key}>
          <label className="cursor-pointer">
            {uploadingKey === key ? 'Uploading…' : 'Upload'}
            <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploadingKey === key} onChange={(e) => handleUpload(key, e)} />
          </label>
        </Button>
        {draft[key] && (
          <Button variant="ghost" size="sm" onClick={() => setDraft((prev) => ({ ...prev, [key]: '' }))}>
            Reset to global
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Form Design</CardTitle>
        <CardDescription>
          Customise this partner's branch enquiry form. Empty fields fall back to the global form settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {imageField('header_image_url', 'Header banner image')}
        {imageField('header_logo_url', 'Form logo')}
        {textField('header_title', 'Header title', 'Car Insurance Enquiry — Gold Gift on Renewal')}
        {textField('header_subtitle', 'Header subtitle', 'Submit your details and our team will be in touch…')}
        {textField('footer_text', 'Footer text', '© RACC Agency. All rights reserved.')}
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label>Require Staff ID</Label>
            <p className="text-xs text-muted-foreground">
              Customers submitting through this partner's branch links must enter the referring
              staff ID. Enforced on the server, not just in the browser.
            </p>
          </div>
          <Switch
            checked={draft.staff_id_required === true}
            onCheckedChange={(checked) =>
              setDraft((prev) => ({ ...prev, staff_id_required: checked }))
            }
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateMerchant.isPending}>
            {updateMerchant.isPending ? 'Saving…' : 'Save form design'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function MerchantDetail() {
  const { merchantId } = useParams({ strict: false }) as { merchantId: string };
  const { data: merchant } = useMerchant(merchantId);
  const { data: settings } = useSystemSettings();
  const { data: branches, isLoading, error } = useMerchantBranches(merchantId);
  const createBranch = useCreateMerchantBranch();
  const updateBranch = useUpdateMerchantBranch();
  const deleteBranch = useDeleteMerchantBranch(merchantId);
  const approveBranch = useApproveMerchantBranch(merchantId);
  const { toast } = useToast();
  const updateMerchant = useUpdateMerchant();
  const createMerchantUser = useCreateMerchantUser();
  const revokeMerchantUser = useRevokeMerchantUser();
  const [sharePct, setSharePct] = useState<string>('');
  const [portalEmail, setPortalEmail] = useState('');
  const [portalPassword, setPortalPassword] = useState('');
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);

  const handleViewAgreement = async () => {
    if (!merchant?.agreement_path) return;
    const { data, error } = await supabase.storage
      .from('merchant-agreements')
      .createSignedUrl(merchant.agreement_path, 60);
    if (error || !data?.signedUrl) {
      toast({ title: 'Could not open agreement', description: error?.message, variant: 'error' });
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const handleSaveShare = async () => {
    const pct = Number(sharePct);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast({ title: 'Invalid share %', description: 'Enter a number 0-100.', variant: 'error' });
      return;
    }
    try {
      await updateMerchant.mutateAsync({ id: merchantId, merchant_share_pct: pct });
      toast({ title: 'Merchant share updated' });
    } catch (err: unknown) {
      toast({ title: 'Failed to update', description: (err as Error)?.message, variant: 'error' });
    }
  };

  const handleToggleMaster = async (checked: boolean) => {
    try {
      await updateMerchant.mutateAsync({ id: merchantId, is_master: checked });
      toast({
        title: checked ? 'Marked as Master Partner' : 'Master Partner removed',
        description: checked
          ? 'Every agent can now assign this partner.'
          : 'Only the proposing/linked agents can assign this partner now.',
      });
    } catch (err: unknown) {
      toast({ title: 'Failed to update', description: (err as Error)?.message, variant: 'error' });
    }
  };

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantBranch | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [linksBranch, setLinksBranch] = useState<MerchantBranch | null>(null);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '' });

  const handleOpenDialog = (branch?: MerchantBranch) => {
    if (branch) {
      setEditing(branch);
      setFormData({ name: branch.name, address: branch.address ?? '', phone: branch.phone ?? '' });
    } else {
      setEditing(null);
      setFormData({ name: '', address: '', phone: '' });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      address: formData.address.trim() === '' ? null : formData.address.trim(),
      phone: formData.phone.trim() === '' ? null : formData.phone.trim(),
    };
    try {
      if (editing) {
        await updateBranch.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createBranch.mutateAsync({ merchant_id: merchantId, ...payload });
      }
      setIsDialogOpen(false);
    } catch (err) {
      console.error('Failed to save branch:', err);
    }
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteBranch.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const handleCreatePortalLogin = async () => {
    if (!portalEmail.trim() || portalPassword.length < 6) {
      toast({
        title: 'Invalid input',
        description: 'Enter an email and a password with at least 6 characters.',
        variant: 'error',
      });
      return;
    }
    try {
      await createMerchantUser.mutateAsync({
        merchant_id: merchantId,
        email: portalEmail.trim(),
        password: portalPassword,
      });
      toast({ title: 'Portal login created', description: `${portalEmail.trim()} can now sign in to the merchant portal.` });
      setPortalEmail('');
      setPortalPassword('');
    } catch (err) {
      toast({ title: 'Failed to create login', description: (err as Error)?.message, variant: 'error' });
    }
  };

  const handleRevokePortalLogin = async () => {
    try {
      await revokeMerchantUser.mutateAsync(merchantId);
      toast({ title: 'Portal access revoked' });
    } catch (err) {
      toast({ title: 'Failed to revoke access', description: (err as Error)?.message, variant: 'error' });
    } finally {
      setRevokeConfirmOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link to="/merchants" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 mr-1" />
          Back to Partnerships
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{merchant?.name ?? 'Partnership'}</h1>
        <p className="text-sm text-muted-foreground capitalize">{merchant?.status}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Partnership Details</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div>
            Customer gift:{' '}
            <span className="text-foreground">
              {settings?.customer_gift_rate_pct ?? 10}% of the car-insurance renewal premium
            </span>
          </div>
          <div className="text-xs">
            The gift value (and the merchant payable) is calculated from each renewal premium at confirmation.
          </div>
          {(merchant?.contact_person || merchant?.contact_phone) && (
            <div>
              Contact:{' '}
              <span className="text-foreground">
                {merchant?.contact_person ?? '—'}
                {merchant?.contact_phone ? ` · ${merchant.contact_phone}` : ''}
              </span>
            </div>
          )}
          {merchant?.agreement_path && (
            <div>
              <Button variant="outline" size="sm" onClick={handleViewAgreement}>
                <FileText className="size-4 mr-1.5" />
                View signed agreement
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <span>Merchant share %:</span>
            <Input
              className="h-8 w-24"
              inputMode="decimal"
              placeholder={String(merchant?.merchant_share_pct ?? 0)}
              value={sharePct}
              onChange={(e) => setSharePct(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={handleSaveShare}
              disabled={sharePct.trim() === '' || updateMerchant.isPending}>
              Save
            </Button>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Switch
              checked={!!merchant?.is_master}
              onCheckedChange={handleToggleMaster}
              disabled={updateMerchant.isPending}
            />
            <span>
              Master Partner — appears in <span className="text-foreground">every</span> agent's Assign-partner list
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Portal Access
          </CardTitle>
          <CardDescription>
            Give this Master Partner read-only access to their Branch Performance dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {merchant?.portal_email ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Login email: </span>
                <span className="text-foreground font-medium">{merchant.portal_email}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevokeConfirmOpen(true)}
                disabled={revokeMerchantUser.isPending}
              >
                {revokeMerchantUser.isPending ? 'Revoking...' : 'Revoke access'}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={portalEmail}
                  onChange={(e) => setPortalEmail(e.target.value)}
                  placeholder="merchant@example.com"
                />
              </div>
              <div className="flex-1">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={portalPassword}
                  onChange={(e) => setPortalPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>
              <Button onClick={handleCreatePortalLogin} disabled={createMerchantUser.isPending}>
                {createMerchantUser.isPending ? 'Creating...' : 'Create login'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {merchant && <FormDesignCard merchantId={merchantId} formSettings={merchant.form_settings ?? null} />}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Branches</CardTitle>
            <CardDescription>{branches?.length ?? 0} branches</CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="size-4 mr-1.5" />
                New Branch
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Branch' : 'Create Branch'}</DialogTitle>
                <DialogDescription>An outlet where customers can be referred.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Branch Name</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Poh Kong — Sunway Pyramid"
                  />
                </div>
                <div>
                  <Label>Address (optional)</Label>
                  <Input
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Phone (optional)</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={createBranch.isPending || updateBranch.isPending}>
                  {createBranch.isPending || updateBranch.isPending ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-destructive text-sm">Error loading branches: {error.message}</p>
          ) : isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : branches?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No branches yet. Add the first outlet.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches?.map((branch) => (
                    <TableRow key={branch.id}>
                      <TableCell className="font-medium">{branch.name}</TableCell>
                      <TableCell className="text-muted-foreground">{branch.phone ?? '—'}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{branch.status}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLinksBranch(branch)}
                            aria-label="Manage branch QR links"
                          >
                            <QrCode className="size-4" />
                          </Button>
                          {branch.status === MerchantStatus.PENDING && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => approveBranch.mutate(branch.id)}
                              disabled={approveBranch.isPending}
                              aria-label="Approve branch"
                            >
                              <Check className="size-4 text-emerald-600" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(branch)} aria-label="Edit branch">
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteId(branch.id)}
                            disabled={deleteBranch.isPending}
                            aria-label="Delete branch"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {linksBranch && (
        <BranchLinksDialog
          branch={linksBranch}
          open={!!linksBranch}
          onOpenChange={(o) => !o && setLinksBranch(null)}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting a branch also deletes its links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={revokeConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Portal Access</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the merchant's login ({merchant?.portal_email}). They will no longer be able to sign in to
              the Branch Performance dashboard. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevokePortalLogin} className="bg-red-600 hover:bg-red-700">
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
