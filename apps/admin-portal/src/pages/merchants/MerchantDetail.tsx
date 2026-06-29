import { Link, useParams } from '@tanstack/react-router';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@agent-system/shared-ui';
import { ArrowLeft } from 'lucide-react';
import { useMerchant } from '../../hooks/useMerchants';

export function MerchantDetail() {
  const { merchantId } = useParams({ strict: false }) as { merchantId: string };
  const { data: merchant } = useMerchant(merchantId);

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
            Gift pool: <span className="text-foreground">RM{merchant?.gift_pool_amount?.toFixed(2) ?? '0.00'}</span>
          </div>
          <div>
            Split:{' '}
            <span className="text-foreground">
              {merchant?.merchant_share_pct ?? 0}% merchant / {100 - (merchant?.merchant_share_pct ?? 0)}% customer
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
