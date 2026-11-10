// Royal Treasury, no-key source: US Treasury Fiscal Data (Debt to the Penny and average
// interest rates on Treasury securities). Official figures, updated daily / monthly.
import { fetchJson, qs, type CallContext } from './http';

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';
export interface DebtDay {
  date: string; // YYYY-MM-DD
  total: number; // USD
  public: number; // held by the public
  intragov: number; // intragovernmental holdings
}
export interface TreasuryRate {
  type: string; // Marketable / Non-marketable
  security: string;
  rate: number; // percent
}
export interface UsFiscal {
  debt: DebtDay[]; // newest first
  debtChange: { days: number; amount: number } | null; // newest minus the oldest shown
  ratesMonth: string | null; // YYYY-MM-DD (month end)
  rates: TreasuryRate[];
  sourceUrl: string;
  fetchedAt: string;
}

/** US federal debt (last ~10 business days) and the average interest rate the Treasury pays, by security type. */
export async function usFiscal(ctx: CallContext): Promise<UsFiscal> {
  const o = { provider: 'fiscaldata', ctx, ttlMs: 3 * 3600_000, timeoutMs: 20_000 };
  const [d, r] = await Promise.all([
    fetchJson<any>(`${BASE}/v2/accounting/od/debt_to_penny` + qs({ sort: '-record_date', 'page[size]': 10, fields: 'record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt' }), o),
    fetchJson<any>(`${BASE}/v2/accounting/od/avg_interest_rates` + qs({ sort: '-record_date', 'page[size]': 30, fields: 'record_date,security_type_desc,security_desc,avg_interest_rate_amt' }), o),
  ]);
  const debt: DebtDay[] = ((d.data?.data ?? []) as any[]).map((x) => ({ date: String(x.record_date), total: Number(x.tot_pub_debt_out_amt), public: Number(x.debt_held_public_amt), intragov: Number(x.intragov_hold_amt) })).filter((x) => Number.isFinite(x.total));
  const rows = (r.data?.data ?? []) as any[];
  const month = rows[0]?.record_date ?? null;
  const first = debt[0];
  const last = debt.at(-1);
  return {
    debt,
    debtChange: first && last && first !== last ? { days: Math.round((new Date(first.date).getTime() - new Date(last.date).getTime()) / 86400_000), amount: first.total - last.total } : null,
    ratesMonth: month,
    rates: rows
      .filter((x) => x.record_date === month && Number.isFinite(Number(x.avg_interest_rate_amt)))
      .map((x) => ({ type: String(x.security_type_desc), security: String(x.security_desc), rate: Number(x.avg_interest_rate_amt) })),
    sourceUrl: 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/',
    fetchedAt: d.fetchedAt,
  };
}
