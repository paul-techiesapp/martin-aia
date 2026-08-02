import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Skeleton,
  useToast,
} from '@agent-system/shared-ui';
import { QRCodeSVG } from 'qrcode.react';
import QRCode from 'qrcode';
import { Copy, Check, QrCode, Download } from 'lucide-react';
import { useMyEnquiryLink } from '../hooks/useMyEnquiryLink';

const enquiryUrl = (code: string) =>
  `${import.meta.env.VITE_PUBLIC_PAGES_URL}/public/enquiry/${code}`;

export function MyEnquiryLink() {
  // Every active agent holds a personal enquiry link, Unit Managers included —
  // they print theirs as a QR code for gold-scanning at fairs. Round 6 hid this
  // page from unit roots and nulled their codes, which killed already-printed
  // QRs mid-event (2026-08-02); see 20260802_restore_unit_root_enquiry_links.
  const { data: code, isLoading, isError, error } = useMyEnquiryLink();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(enquiryUrl(code));
    setCopied(true);
    toast({ title: 'Link copied!', description: 'Share this enquiry link with customers.' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!code) return;
    try {
      const url = await QRCode.toDataURL(enquiryUrl(code), { width: 512, margin: 1 });
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-enquiry-qr.png';
      a.click();
      toast({ title: 'QR saved', description: 'Saved as my-enquiry-qr.png.' });
    } catch (err: unknown) {
      toast({
        title: 'Failed to save QR',
        description: (err as Error)?.message,
        variant: 'error',
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Enquiry Link</h1>
        <p className="text-sm text-muted-foreground">
          Share this with customers — submissions come to your My Enquiries.
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-muted-foreground" />
            Your Enquiry QR
          </CardTitle>
          <CardDescription>
            Customers scan this or use the link to submit an insurance enquiry directly to you.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {isLoading ? (
            <Skeleton className="h-64 w-64" />
          ) : isError ? (
            <p className="text-destructive text-sm">Error: {(error as Error)?.message}</p>
          ) : code ? (
            <>
              <QRCodeSVG value={enquiryUrl(code)} size={256} />
              <p className="text-xs text-muted-foreground break-all text-center">
                {enquiryUrl(code)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <Check className="size-4 mr-2 text-emerald-600" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="size-4 mr-2" /> Copy Link
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={handleSave}>
                  <Download className="size-4 mr-2" /> Save as photo
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
