'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banknote, PieChart, Plus, Store, Ticket } from 'lucide-react';
import { AvailabilityBar, Kpi, OfferingBadge } from '@/components/admin/share-sale/bits';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/lib/auth/session';
import { formatCrore, formatSharePct, offeringState } from '@/lib/domain/share-sale';
import {
  shareOfferingKeys,
  shareOfferingsApi,
  type ApiShareOffering,
} from '@/lib/api/share-offerings';
import { useApi } from '@/lib/api/use-api';
import { cn } from '@/lib/utils/cn';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

type Filter = 'all' | 'open' | 'draft' | 'ended';

/**
 * Share Offerings (PROJECT-SHARE-SALE-PLAN.md §4 steps 1–2): every round of
 * every project — its valuation, what went to the market, and how much of it
 * is sold, reserved and left.
 *
 * What a round has sold is counted by the database and arrives on each row, so
 * this screen no longer loads every purchase to add them up. The money that
 * came *in* — collected, overdue, who is late — is deliberately not here yet:
 * it is read from payments, which move in the next batch, and a zero shown
 * where a figure belongs would be a lie rather than a gap.
 */
export default function ShareOfferingsPage() {
  const router = useRouter();
  const { can } = useSession();
  const mayEdit = can('share_sale', 'edit');
  const [filter, setFilter] = useState<Filter>('all');

  const query = { page_size: 200 } as const;
  const offerings = useApi(shareOfferingKeys.list(query), (signal) =>
    shareOfferingsApi.list(query, signal),
  );

  if (offerings === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;

  const today = todayLocal();
  const withState = offerings.map((o) => ({ ...o, state: offeringState(o, today) }));
  type Row = (typeof withState)[number];

  const match = (r: Row) =>
    filter === 'all' ||
    (filter === 'open' && r.state === 'open') ||
    (filter === 'draft' && r.state === 'draft') ||
    (filter === 'ended' &&
      (r.state === 'expired' || r.state === 'closed' || r.state === 'cancelled'));
  const rows = withState.filter(match);

  const totals = {
    open: withState.filter((r) => r.state === 'open').length,
    shares_sold: withState.reduce((t, r) => t + r.sold_shares, 0),
    shares_reserved: withState.reduce((t, r) => t + r.reserved_shares, 0),
    sold_value: withState.reduce((t, r) => t + r.raised, 0),
    unsold_value: withState
      .filter((r) => r.state === 'open' || r.state === 'expired')
      .reduce((t, r) => t + r.available_shares * r.price_per_share, 0),
  };

  const columns: Column<Row>[] = [
    {
      key: 'code',
      header: 'Offering',
      cell: (r) => (
        <span className="block">
          <span className="block font-medium text-ink">{r.project_name}</span>
          <span className="block text-xs text-ink-muted">
            {r.code} · Round {r.round_no}
          </span>
        </span>
      ),
      sortValue: (r) => r.code,
    },
    {
      key: 'valuation',
      header: 'Valuation',
      cell: (r) => (
        <span className="block">
          <span className="block font-medium tabular-nums">{formatCrore(r.valuation)}</span>
          <span className="block text-xs text-ink-muted tabular-nums">
            NAV {formatCrore(r.net_asset_value)} + {formatCrore(r.premium_value)}
          </span>
        </span>
      ),
      sortValue: (r) => r.valuation,
    },
    {
      key: 'offered',
      header: 'Offered',
      cell: (r) => (
        <span className="block tabular-nums">
          <span className="block font-medium">{formatSharePct(r.offered_pct)}</span>
          <span className="block text-xs text-ink-muted">{r.total_shares} shares</span>
        </span>
      ),
      sortValue: (r) => r.offered_pct,
    },
    {
      key: 'price',
      header: 'Price / share',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{formatBdt(r.price_per_share)}</span>,
      sortValue: (r) => r.price_per_share,
    },
    {
      key: 'sold',
      header: 'Shares',
      cell: (r) => (
        <AvailabilityBar
          a={{
            sold: r.sold_shares,
            reserved: r.reserved_shares,
            available: r.available_shares,
            sold_pct: r.total_shares ? (r.sold_shares / r.total_shares) * 100 : 0,
          }}
          total={r.total_shares}
          compact
        />
      ),
      sortValue: (r) => r.sold_shares,
    },
    {
      key: 'money',
      header: 'Sold value',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{formatBdt(r.raised)}</span>,
      sortValue: (r) => r.raised,
    },
    {
      key: 'closes',
      header: 'Valid until',
      cell: (r) =>
        r.closes_on ? (
          formatDate(r.closes_on)
        ) : (
          <span className="text-xs text-ink-muted">{r.validity_days} days once opened</span>
        ),
      sortValue: (r) => r.closes_on ?? '',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <OfferingBadge state={r.state} />,
      sortValue: (r) => r.state,
    },
  ];

  const counts = {
    all: withState.length,
    open: totals.open,
    draft: withState.filter((r) => r.state === 'draft').length,
    ended: withState.filter((r) => ['expired', 'closed', 'cancelled'].includes(r.state)).length,
  };

  return (
    <>
      <PageHeader
        title="Share Offerings"
        subtitle="Sell part of a project as equal shares: valuation (NAV + premium), the % offered, the number of shares, how long it is valid and the longest installment plan."
        action={
          mayEdit && (
            <Link href="/admin/share-sale/offerings/new">
              <Button>
                <Plus className="size-4" /> New offering
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Open offerings"
          value={totals.open}
          hint={`${withState.length} in all`}
          icon={Store}
        />
        <Kpi
          label="Shares sold"
          value={totals.shares_sold}
          hint={totals.shares_reserved ? `+ ${totals.shares_reserved} reserved` : 'none reserved'}
          icon={PieChart}
        />
        <Kpi label="Sold value" value={formatBdt(totals.sold_value)} icon={Banknote} />
        <Kpi
          label="Still on the market"
          value={formatBdt(totals.unsold_value)}
          hint="in open rounds"
          icon={Ticket}
        />
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap gap-1 border-b border-hairline px-5 pt-3">
          {(
            [
              ['all', 'All'],
              ['open', 'Open'],
              ['draft', 'Drafts'],
              ['ended', 'Ended'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                filter === key
                  ? 'border-admin-500 text-admin-700'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-[11px]',
                  filter === key ? 'bg-admin-50 text-admin-700' : 'bg-slate-100 text-ink-muted',
                )}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
        <div className="p-5">
          <DataTable
            rows={rows}
            columns={columns}
            label="offerings"
            onRowClick={(r: ApiShareOffering) => router.push(`/admin/share-sale/offerings/${r.id}`)}
            emptyState={
              <EmptyState
                icon={PieChart}
                title={withState.length ? 'No offerings here' : 'No share offerings yet'}
                description={
                  withState.length
                    ? 'Try another tab.'
                    : 'Start with a project that is selling: value it, then choose how much of it to offer as shares.'
                }
              />
            }
            mobileCard={(r) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-medium text-ink">{r.project_name}</span>
                    <span className="block text-xs text-ink-muted">
                      {r.code} · Round {r.round_no} · {formatBdt(r.price_per_share)}/share
                    </span>
                  </span>
                  <OfferingBadge state={r.state} />
                </div>
                <AvailabilityBar
                  a={{
                    sold: r.sold_shares,
                    reserved: r.reserved_shares,
                    available: r.available_shares,
                    sold_pct: r.total_shares ? (r.sold_shares / r.total_shares) * 100 : 0,
                  }}
                  total={r.total_shares}
                />
              </div>
            )}
          />
        </div>
      </Card>
    </>
  );
}
