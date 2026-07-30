/**
 * PostgREST caps every response at `db.max_rows` (1000 on Supabase's default
 * config) and returns HTTP 200 with a PARTIAL array — no error is raised. An
 * unbounded `.select()` on a growing table therefore truncates silently: as of
 * 2026-07-30 the admin portal received 1000 of 1507 enquiries, which is why
 * admin, unit and agent views disagreed on the same agent's customer count.
 *
 * This helper pages through the full result set instead.
 *
 * The caller supplies a BUILDER rather than a query, because PostgREST query
 * builders are single-use — each page needs a freshly constructed query.
 *
 * The builder's ordering MUST be deterministic: order by a timestamp alone is
 * not, since tied values have no defined order between pages, so a row can be
 * returned twice or skipped entirely. Add `id` as a tiebreaker:
 *
 *   fetchAllRows<Row>((from, to) =>
 *     supabase.from('enquiries').select('...')
 *       .order('created_at', { ascending: false })
 *       .order('id', { ascending: false })
 *       .range(from, to))
 */
export type PageBuilder<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export interface FetchAllOptions {
  /** Rows per request. Must not exceed the server's max-rows or paging stalls. */
  pageSize?: number;
  /** Safety ceiling. A query that reaches it should be aggregated server-side. */
  maxRows?: number;
  /** Query name used in the ceiling warning. */
  label?: string;
}

export async function fetchAllRows<T>(
  build: PageBuilder<T>,
  opts: FetchAllOptions = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 50000;
  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    // A short page means the server had nothing more to give.
    if (page.length < pageSize) return rows;
  }

  console.warn(
    `[fetchAllRows] hit the ${maxRows}-row ceiling${opts.label ? ` for ${opts.label}` : ''}; ` +
      'results are truncated. This query should be aggregated server-side.',
  );
  return rows;
}
