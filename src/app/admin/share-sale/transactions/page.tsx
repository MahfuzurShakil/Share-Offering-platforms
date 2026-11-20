'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, ReceiptText, Undo2, Wallet } from 'lucide-react';
import { Kpi } from '@/components/admin/share-sale/bits';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextInput } from '@/components/ui/Field';
import { FilterBar, FilterField, FilterSelect } from '@/components/ui/FilterBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { SHARE_PAYMENT_METHODS, type SharePaymentMethod } from '@/lib/db/types';
import { SHARE_PAYMENT_METHOD_LABEL } from '@/lib/domain/share-sale';
import { shareSaleKeys, shareSalesApi, type ApiShareSale } from '@/lib/api/share-sales';
import { useApi } from '@/lib/api/use-api';
import { formatBdt, formatDate } from '@/lib/utils/format';

/** One receipt, with the purchase it belongs to. */
interface Row {
  id: string;
  code: string;
  paid_on: string;
  amount: number;
  late_fee: number;
  method: SharePaymentMethod;
  reference: string | null;
  channel: string;
  reversal: boolean;
  reversed: boolean;
  sale_id: string;
  sale_code: string;
  customer_name: string;
  project_id: string;
  project_name: string;
}

function flatten(sales: ApiShareSale[]): Row[] {
  return sales
    .flatMap((sale) =>
      sale.payments.map((p) => ({
        id: p.id,
        code: p.code,
        paid_on: p.paid_on,
        amount: p.amount,
        late_fee: p.late_fee,
        method: p.method,
        reference: p.reference,
        channel: p.channel,
        reversal: p.amount < 0,
        reversed: sale.payments.some((x) => x.reverses_payment_id === p.id),
        sale_id: sale.id,
        sale_code: sale.code,
        customer_name: sale.customer_name,
        project_id: sale.project_id,
        project_name: sale.project_name,
      })),
    )
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.code.localeCompare(a.code));
}

/**
 * Share Sale → Transactions: every payment investors have made, across all
 * projects — the history the purchase page shows one customer at a time.
 *
 * A reversal is a row of its own, in red, beside the receipt it cancels. They
 * are never hidden or netted away here: a receipt book that quietly drops its
 * mistakes is not a receipt book.
 */
function TransactionsPage() {
  const router = useRouter();
  const params = useSearchParams();

  const query = { page_size: 200 } as const;
  const sales = useApi(shareSaleKeys.list(query), (signal) => shareSalesApi.list(query, signal));

  const [q, setQ] = useState('');
  const [project, setProject] = useState(params.get('project') ?? 'all');
  const [method, setMethod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  if (sales === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;

  const all = flatten(sales);
  const projects = [...new Map(sales.map((s) => [s.project_id, s.project_name])).entries()];

  const text = q.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      (project === 'all' || r.project_id === project) &&
      (method === 'all' || r.method === method) &&
      (!from || r.paid_on >= from) &&
      (!to || r.paid_on <= to) &&
      (!text ||
        [r.code, r.sale_code, r.customer_name, r.reference ?? '']
          .join(' ')
          .toLowerCase()
          .includes(text)),
  );

  const net = rows.reduce((t, r) => t + r.amount, 0);
  const fees = rows.reduce((t, r) => t + r.late_fee, 0);

  const columns: Column<Row>[] = [
    {
      key: 'code',
      header: 'Receipt',
      cell: (r) => (
        <span className="block">
          <span className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
            {r.code}
            {r.reversal && <Badge tone="amber">Reversal</Badge>}
            {r.reversed && <Badge tone="neutral">Reversed</Badge>}
          </span>
          <span className="block text-xs text-ink-muted">{formatDate(r.paid_on)}</span>
        </span>
      ),
      sortValue: (r) => r.code,
    },
    {
      key: 'customer',
      header: 'Investor',
      cell: (r) => (
        <span className="block">
          <span className="block">{r.customer_name}</span>
          <span className="block text-xs text-ink-muted">
            {r.sale_code} · {r.project_name}
          </span>
        </span>
      ),
      sortValue: (r) => r.customer_name,
    },
    {
      key: 'method',
      header: 'How',
      cell: (r) => (
        <span className="block">
          <span className="block">{SHARE_PAYMENT_METHOD_LABEL[r.method]}</span>
          {r.reference && <span className="block text-xs text-ink-muted">{r.reference}</span>}
        </span>
      ),
      sortValue: (r) => r.method,
    },
    {
      key: 'late_fee',
      header: 'Late fee',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums text-amber-700">
          {r.late_fee ? formatBdt(r.late_fee) : '—'}
        </span>
      ),
      sortValue: (r) => r.late_fee,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => (
        <span
          className={`font-medium tabular-nums ${r.reversal ? 'text-red-600' : 'text-emerald-700'}`}
        >
          {formatBdt(r.amount)}
        </span>
      ),
      sortValue: (r) => r.amount,
    },
  ];

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Every payment investors have made, across every project. A correction appears as its own reversing receipt."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Receipts" value={rows.length} hint={`of ${all.length} in all`} icon={ReceiptText} />
        <Kpi label="Net received" value={formatBdt(net)} hint="reversals taken off" icon={Wallet} />
        <Kpi label="Late fees in it" value={formatBdt(fees)} icon={CalendarDays} />
        <Kpi
          label="Reversals"
          value={rows.filter((r) => r.reversal).length}
          hint="corrections, not deletions"
          icon={Undo2}
        />
      </div>

      <Card className="p-0">
        <div className="p-5">
          <FilterBar>
            <FilterField label="Search">
              <TextInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Receipt, purchase, investor, reference…"
              />
            </FilterField>
            <FilterSelect
              label="Project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="all">All projects</option>
              {projects.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="How" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="all">Any</option>
              {SHARE_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {SHARE_PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </FilterSelect>
            <FilterField label="From">
              <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </FilterField>
            <FilterField label="To">
              <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </FilterField>
          </FilterBar>

          <DataTable
            rows={rows}
            columns={columns}
            label="receipts"
            onRowClick={(r) => router.push(`/admin/share-sale/sales/${r.sale_id}`)}
            emptyState={
              <EmptyState
                icon={ReceiptText}
                title={all.length ? 'Nothing matches these filters' : 'No payment yet'}
                description={
                  all.length
                    ? 'Try a wider date range.'
                    : 'Payments appear here once an agreement is signed and money comes in.'
                }
              />
            }
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-medium text-ink">{r.customer_name}</span>
                    <span className="block text-xs text-ink-muted">
                      {r.code} · {formatDate(r.paid_on)}
                    </span>
                  </span>
                  <span
                    className={`font-medium tabular-nums ${r.reversal ? 'text-red-600' : 'text-emerald-700'}`}
                  >
                    {formatBdt(r.amount)}
                  </span>
                </div>
              </div>
            )}
          />
        </div>
      </Card>
    </>
  );
}

export default function ShareTransactionsPage() {
  return (
    <Suspense>
      <TransactionsPage />
    </Suspense>
  );
}
