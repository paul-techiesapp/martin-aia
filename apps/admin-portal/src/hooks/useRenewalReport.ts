import { useQuery } from '@tanstack/react-query';
import { fetchAllRows } from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';

interface EmbeddedAmount {
  value_amount?: number;
  amount?: number;
}

export interface RenewalReportRow {
  id: string;
  car_plate: string;
  renewed_at: string | null;
  renewal_premium_amount: number | null;
  merchant_id: string | null;
  merchant: { name: string } | null;
  enquiry: {
    customer_name: string;
    agent: { name: string; agent_code: string; unit_name: string } | null;
  } | null;
  /** The customer gift value actually minted at confirmation (source of truth). */
  gift_amount: number | null;
  /** The merchant settlement (payable) actually minted at confirmation. */
  settlement_amount: number | null;
}

export interface RenewalReportFilters {
  from?: string; // ISO date (inclusive, SGT)
  to?: string; // ISO date (inclusive, SGT)
}

function firstAmount(embedded: unknown, key: 'value_amount' | 'amount'): number | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  const v = row ? (row as EmbeddedAmount)[key] : undefined;
  return typeof v === 'number' ? v : null;
}

/**
 * Successful renewal cases: every vehicle in status 'renewed'. The displayed
 * gift / settlement come from the IMMUTABLE ledger rows minted at confirmation
 * (gifts.value_amount / merchant_settlements.amount), not a re-derivation from
 * the mutable global rate — so editing the rate later never restates history.
 * Unit/agent/partner filtering and value sorting are applied client-side
 * (the joined agent.unit_name is not filterable in PostgREST).
 */
export function useRenewalReport(filters: RenewalReportFilters) {
  return useQuery({
    queryKey: ['renewal-report', filters],
    queryFn: async () => {
      // Paged: enquiry_vehicles already exceeds PostgREST's 1000-row page cap
      // (1832 rows), and `.eq('status', 'renewed')` alone doesn't narrow it
      // enough to stay under the cap. `id` is a tiebreaker for deterministic pages.
      const data = await fetchAllRows<any>(
        (from, to) => {
          let q = supabase
            .from('enquiry_vehicles')
            .select(`
              id, car_plate, renewed_at, renewal_premium_amount, merchant_id,
              merchant:merchants(name),
              enquiry:enquiries(customer_name, agent:agents(name, agent_code, unit_name)),
              gifts(value_amount),
              merchant_settlements(amount)
            `)
            .eq('status', 'renewed');

          // Bound the inclusive day range in Singapore local time (renewed_at is UTC).
          if (filters.from) q = q.gte('renewed_at', `${filters.from}T00:00:00+08:00`);
          if (filters.to) q = q.lte('renewed_at', `${filters.to}T23:59:59.999+08:00`);

          return q
            .order('renewed_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as unknown as PromiseLike<{
            data: any[] | null;
            error: { message: string } | null;
          }>;
        },
        { label: 'admin renewal-report' },
      );

      return data.map((r: any) => ({
        id: r.id,
        car_plate: r.car_plate,
        renewed_at: r.renewed_at,
        renewal_premium_amount: r.renewal_premium_amount,
        merchant_id: r.merchant_id,
        merchant: Array.isArray(r.merchant) ? r.merchant[0] ?? null : r.merchant,
        enquiry: Array.isArray(r.enquiry) ? r.enquiry[0] ?? null : r.enquiry,
        gift_amount: firstAmount(r.gifts, 'value_amount'),
        settlement_amount: firstAmount(r.merchant_settlements, 'amount'),
      })) as RenewalReportRow[];
    },
  });
}
