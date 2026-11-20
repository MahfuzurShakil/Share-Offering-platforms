'use client';

import { Banknote, PiggyBank, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { revenueApi, revenueKeys, withdrawalKeys, withdrawalsApi } from '@/lib/api/revenue';
import { useApi } from '@/lib/api/use-api';
import { WITHDRAWAL_STATUS_META } from '@/lib/domain/revenue-share';
import { formatBdt, formatDate } from '@/lib/utils/format';

/**
 * What one investor has earned, and what is left to take
 * (REVENUE-SHARE-PLAN.md §5.4).
 *
 * Three different numbers, which is why they are shown apart: what was
 * credited to them, what they have already taken, and what is being held
 * against a request they have made. The balance is the arithmetic of those,
 * worked out fresh by the server every time rather than stored anywhere.
 */
export function CustomerEarnings({ customerId }: { customerId: string }) {
  const earnings = useApi(revenueKeys.earnings(customerId), (signal) =>
    revenueApi.earnings(customerId, signal),
  );
  const balances = useApi(withdrawalKeys.balances(customerId), (signal) =>
    withdrawalsApi.balances(customerId, signal),
  );
  const requests = useApi(
    withdrawalKeys.list({ customer_id: customerId }),
    (signal) => withdrawalsApi.list({ customer_id: customerId, page_size: 50 }, signal),
  );

  if (earnings === undefined || balances === undefined) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  if (earnings.lines.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={PiggyBank}
          title="Nothing earned yet"
          description="A share of the profit is credited when a project declares a period they held shares in."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Credited"
          value={formatBdt(earnings.totals.credited)}
          hint={`${formatBdt(earnings.totals.tax_withheld)} tax withheld`}
          icon={PiggyBank}
        />
        <Tile
          label="Available to withdraw"
          value={formatBdt(balances.reduce((t, b) => t + b.available, 0))}
          hint="across every project"
          icon={Banknote}
        />
        <Tile
          label="Already paid out"
          value={formatBdt(balances.reduce((t, b) => t + b.paid_out, 0))}
          icon={Receipt}
        />
      </div>

      {balances.length > 0 && (
        <Card className="p-0">
          <div className="px-5 pt-5">
            <CardHeader
              title="Balance by project"
              subtitle="Profit is earned per project, and asked for per project."
            />
          </div>
          <ul className="divide-y divide-hairline">
            {balances.map((b) => (
              <li key={b.project_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{b.project_name}</span>
                  <span className="block text-xs text-ink-muted tabular-nums">
                    {formatBdt(b.credited)} credited · {formatBdt(b.paid_out)} paid
                    {b.pending > 0 && ` · ${formatBdt(b.pending)} being asked for`}
                  </span>
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-emerald-700">
                  {formatBdt(b.available)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-0">
        <div className="px-5 pt-5">
          <CardHeader
            title="Period by period"
            subtitle="Their ownership on each record date, and what it earned them."
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-y border-hairline bg-canvas/60 text-left text-xs text-ink-muted">
                <th className="px-5 py-2 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Owned</th>
                <th className="px-3 py-2 text-right font-medium">Gross</th>
                <th className="px-3 py-2 text-right font-medium">Tax</th>
                <th className="px-5 py-2 text-right font-medium">Credited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {earnings.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-5 py-2.5">
                    <span className="block">{line.period_label}</span>
                    <span className="block text-xs text-ink-muted">
                      {line.project_name}
                      {line.record_date && ` · as of ${formatDate(line.record_date)}`}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {line.ownership_pct}%
                    {line.eligibility_factor < 1 && (
                      <span className="block text-xs text-amber-700">
                        × {line.eligibility_factor}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatBdt(line.gross)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                    {formatBdt(line.tax_withheld)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium tabular-nums text-emerald-700">
                    {formatBdt(line.net_credited)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {requests && requests.rows.length > 0 && (
        <Card className="p-0">
          <div className="px-5 pt-5">
            <CardHeader title="Withdrawals" />
          </div>
          <ul className="divide-y divide-hairline">
            {requests.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">
                    {r.code} · {r.project_name}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    Asked {formatDate(r.requested_on)}
                    {r.paid_on && ` · paid ${formatDate(r.paid_on)}`}
                    {r.reject_reason && ` · ${r.reject_reason}`}
                  </span>
                </span>
                <span className="text-sm font-medium tabular-nums">{formatBdt(r.amount)}</span>
                <Badge tone={WITHDRAWAL_STATUS_META[r.status].tone}>
                  {WITHDRAWAL_STATUS_META[r.status].label}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof PiggyBank;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex items-center gap-2 text-ink-muted">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
