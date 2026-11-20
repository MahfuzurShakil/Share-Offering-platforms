'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarClock, Users, Wallet } from 'lucide-react';
import { Kpi, SaleBadge } from '@/components/admin/share-sale/bits';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterBar, FilterSelect } from '@/components/ui/FilterBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatSharePct } from '@/lib/domain/share-sale';
import { shareSaleKeys, shareSalesApi, type ApiShareSale } from '@/lib/api/share-sales';
import { useApi } from '@/lib/api/use-api';
import { cn } from '@/lib/utils/cn';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

type Show = 'active' | 'overdue' | 'reserved' | 'paid' | 'ended' | 'all';
const SHOWS: [Show, string][] = [
  ['active', 'Being paid'],
  ['overdue', 'Overdue'],
  ['reserved', 'Reserved'],
  ['paid', 'Fully paid'],
  ['ended', 'Released / cancelled'],
  ['all', 'All'],
];

function matches(r: ApiShareSale, show: Show): boolean {
  switch (show) {
    case 'active':
      return r.health === 'paying' || r.health === 'overdue';
    case 'overdue':
      return r.health === 'overdue';
    case 'reserved':
      return r.health === 'reserved' || r.health === 'hold_expired';
    case 'paid':
      return r.health === 'fully_paid' || r.health === 'certified';
    case 'ended':
      return r.health === 'released' || r.health === 'cancelled';
    default:
      return true;
  }
}

/**
 * Investors & Dues (plan §4 steps 4–8): every customer purchase across all
 * offerings — who holds what, what they have paid, and who is late and by
 * how long. The Overdue tab is the follow-up list.
 *
 * Each row arrives with its schedule already read: what is paid, what is
 * overdue, how many days late and what the late fee has reached. The server
 * worked that out through `lib/domain/share-sale.ts`, so this screen sorts and
 * formats, and adds nothing up.
 */
function InvestorsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const query = { page_size: 200 } as const;
  const sales = useApi(shareSaleKeys.list(query), (signal) => shareSalesApi.list(query, signal));

  const initial = (params.get('show') as Show) ?? 'active';
  const [show, setShow] = useState<Show>(SHOWS.some(([k]) => k === initial) ? initial : 'active');
  const [project, setProject] = useState('all');

  if (sales === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;

  const today = todayLocal();
  const inProject = sales.filter((r) => project === 'all' || r.project_id === project);
  const rows = inProject.filter((r) => matches(r, show));
  const projects = [...new Map(sales.map((r) => [r.project_id, r.project_name])).entries()];

  const live = sales.filter((r) => r.status === 'agreement_signed' || r.status === 'fully_paid');
  const totals = {
    investors: new Set(sales.filter((r) => r.health !== 'released' && r.health !== 'cancelled').map((r) => r.customer_id)).size,
    signed: live.length,
    collected: sales.reduce((t, r) => t + r.paid, 0),
    sold: live.reduce((t, r) => t + r.total_price, 0),
    overdue: sales.reduce((t, r) => t + r.due_now, 0),
    overdue_sales: sales.filter((r) => r.due_now > 0.5).length,
  };
  const dueSoon = sales
    .flatMap((r) => r.schedule.filter((i) => i.status === 'due'))
    .reduce((t, i) => t + i.remaining, 0);

  const columns: Column<ApiShareSale>[] = [
    {
      key: 'customer',
      header: 'Investor',
      cell: (r) => (
        <span className="block">
          <span className="block font-medium text-ink">{r.customer_name}</span>
          <span className="block text-xs text-ink-muted">
            {r.customer_code} · {r.code}
          </span>
        </span>
      ),
      sortValue: (r) => r.customer_name,
    },
    {
      key: 'project',
      header: 'Project',
      cell: (r) => (
        <span className="block">
          <span className="block">{r.project_name}</span>
          <span className="block text-xs text-ink-muted">
            Round {r.round_no} · {r.shares} shares · {formatSharePct(r.share_pct)}
          </span>
        </span>
      ),
      sortValue: (r) => r.project_name,
    },
    { key: 'price', header: 'Total price', align: 'right', cell: (r) => <span className="tabular-nums">{formatBdt(r.total_price)}</span>, sortValue: (r) => r.total_price },
    {
      key: 'paid',
      header: 'Paid',
      cell: (r) =>
        r.schedule.length ? (
          <span className="block min-w-28">
            <span className="block text-xs tabular-nums">
              {formatBdt(r.paid)} · {r.paid_count}/{r.schedule.length}
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
              <span className={cn('block h-full', r.health === 'overdue' ? 'bg-red-500' : 'bg-admin-500')} style={{ width: `${r.progress_pct}%` }} />
            </span>
          </span>
        ) : (
          <span className="text-xs text-ink-muted">Not signed</span>
        ),
      sortValue: (r) => r.progress_pct,
    },
    {
      key: 'overdue',
      header: 'Overdue',
      align: 'right',
      cell: (r) => {
        const oldest = r.schedule.find((i) => i.status === 'overdue');
        return oldest ? (
          <span className="block tabular-nums">
            <span className="block font-medium text-red-600">{formatBdt(r.due_now)}</span>
            <span className="block text-xs text-ink-muted">
              {oldest.days_late} days{r.late_fees ? ` · ${formatBdt(r.late_fees)} fee` : ''}
            </span>
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        );
      },
      sortValue: (r) => r.due_now,
    },
    {
      key: 'next',
      header: 'Next due',
      cell: (r) => {
        const next = r.schedule.find((i) => i.status === 'due' || i.status === 'upcoming');
        if (r.status === 'reserved')
          return (
            <span className="block text-xs">
              <span className={cn('block', r.hold_until < today ? 'text-amber-700' : 'text-ink-muted')}>
                Hold until {formatDate(r.hold_until)}
              </span>
            </span>
          );
        return next ? (
          <span className="block tabular-nums">
            <span className="block">{formatBdt(next.remaining)}</span>
            <span className="block text-xs text-ink-muted">{formatDate(next.due_date)}</span>
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        );
      },
      sortValue: (r) => r.next_due_date ?? '9999',
    },
    { key: 'status', header: 'Status', cell: (r) => <SaleBadge health={r.health} />, sortValue: (r) => r.health },
  ];

  return (
    <>
      <PageHeader title="Investors & Dues" subtitle="Every customer (type Investor) who bought shares: what they hold, what they have paid and who is late." />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Investors"
          value={totals.investors}
          hint={`${totals.signed} signed purchase${totals.signed === 1 ? '' : 's'}`}
          icon={Users}
        />
        <Kpi
          label="Collected"
          value={formatBdt(totals.collected)}
          hint={`of ${formatBdt(totals.sold)} signed`}
          icon={Wallet}
        />
        <Kpi label="Due in 30 days" value={formatBdt(dueSoon)} hint="not late yet" icon={CalendarClock} />
        <Kpi
          label="Overdue now"
          value={formatBdt(totals.overdue)}
          hint={`${totals.overdue_sales} purchase${totals.overdue_sales === 1 ? '' : 's'}, late fees included`}
          icon={AlertTriangle}
          tone={totals.overdue ? 'danger' : 'default'}
        />
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap gap-1 border-b border-hairline px-5 pt-3">
          {SHOWS.map(([key, label]) => {
            const n = inProject.filter((r) => matches(r, key)).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setShow(key)}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  show === key ? 'border-admin-500 text-admin-700' : 'border-transparent text-ink-muted hover:text-ink',
                )}
              >
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px]',
                    key === 'overdue' && n ? 'bg-red-50 text-red-600' : show === key ? 'bg-admin-50 text-admin-700' : 'bg-slate-100 text-ink-muted',
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {projects.length > 1 && (
            <FilterBar>
              <FilterSelect label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="all">All projects</option>
                {projects.map(([pid, name]) => (
                  <option key={pid} value={pid}>
                    {name}
                  </option>
                ))}
              </FilterSelect>
            </FilterBar>
          )}
          <DataTable
            rows={rows}
            columns={columns}
            label="purchases"
            initialSort={show === 'overdue' ? { key: 'overdue', direction: 'desc' } : undefined}
            onRowClick={(r) => router.push(`/admin/share-sale/sales/${r.id}`)}
            emptyState={<EmptyState icon={Users} title={show === 'overdue' ? 'Nobody is late' : 'Nothing here'} description={show === 'overdue' ? 'Every investor is up to date.' : undefined} />}
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-medium text-ink">{r.customer_name}</span>
                    <span className="block text-xs text-ink-muted">
                      {r.project_name} · {r.shares} shares
                    </span>
                  </span>
                  <SaleBadge health={r.health} />
                </div>
                <p className="text-xs text-ink-muted tabular-nums">
                  Paid {formatBdt(r.paid)} of {formatBdt(r.total_price)}
                  {r.due_now > 0 && <span className="font-medium text-red-600"> · {formatBdt(r.due_now)} overdue</span>}
                </p>
              </div>
            )}
          />
        </div>
      </Card>
    </>
  );
}

export default function InvestorsDuesPage() {
  return (
    <Suspense>
      <InvestorsPage />
    </Suspense>
  );
}
