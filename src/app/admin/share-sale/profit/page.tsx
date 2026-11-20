'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HandCoins, Megaphone, Receipt, TrendingUp } from 'lucide-react';
import { Kpi } from '@/components/admin/share-sale/bits';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterBar, FilterSelect } from '@/components/ui/FilterBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { PERIOD_STATUS_META } from '@/lib/domain/revenue-share';
import type { BadgeTone } from '@/components/ui/Badge';
import { distributionKeys, distributionsApi, type ApiPeriodRow } from '@/lib/api/revenue';
import { useApi } from '@/lib/api/use-api';
import { formatBdt, formatDate } from '@/lib/utils/format';

/**
 * Every closed period across projects (REVENUE-SHARE-PLAN.md §10): what each
 * made, what was declared, and how many holders it was split between.
 *
 * Income and cost are recorded on each project's own Income & Profit tab, and
 * a period is closed, approved and declared there — this is the place somebody
 * stands back and looks at all of them.
 */
/**
 * A cancelled period is a status the database allows and the domain's label
 * map does not carry, because nothing in the app cancels one yet. Said here
 * rather than left to crash a page if one ever appears.
 */
const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  ...PERIOD_STATUS_META,
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export default function ProfitDistributionsPage() {
  const [project, setProject] = useState('');
  const [status, setStatus] = useState('');

  const query = {} as const;
  const rows = useApi(distributionKeys.periods(query), (signal) =>
    distributionsApi.periods(query, signal),
  );

  if (rows === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;

  const projects = [...new Map(rows.map((r) => [r.project_id, r.project_name])).entries()];
  const shown = rows.filter(
    (r) => (!project || r.project_id === project) && (!status || r.status === status),
  );
  const declared = rows.filter((r) => r.status === 'declared');
  const waiting = rows.filter((r) => r.status !== 'declared' && r.operating_profit > 0).length;

  const columns: Column<ApiPeriodRow>[] = [
    {
      key: 'period',
      header: 'Period',
      cell: (r) => (
        <span className="block">
          <span className="block font-medium text-ink">{r.label}</span>
          <span className="block text-xs text-ink-muted">
            {r.project_name} · {formatDate(r.period_start)} – {formatDate(r.period_end)}
          </span>
        </span>
      ),
      sortValue: (r) => r.period_start,
    },
    {
      key: 'income',
      header: 'Income',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{formatBdt(r.income)}</span>,
      sortValue: (r) => r.income,
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      cell: (r) => <span className="tabular-nums text-ink-muted">{formatBdt(r.cost)}</span>,
      sortValue: (r) => r.cost,
    },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      cell: (r) => (
        <span
          className={`font-medium tabular-nums ${r.operating_profit < 0 ? 'text-red-600' : 'text-ink'}`}
        >
          {formatBdt(r.operating_profit)}
        </span>
      ),
      sortValue: (r) => r.operating_profit,
    },
    {
      key: 'declared',
      header: 'Declared',
      align: 'right',
      cell: (r) => (
        <span className="block tabular-nums">
          <span className="block font-medium text-emerald-700">
            {r.status === 'closed' ? '—' : formatBdt(r.declared)}
          </span>
          <span className="block text-xs text-ink-muted">
            of {formatBdt(r.available)} available
          </span>
        </span>
      ),
      sortValue: (r) => r.declared,
    },
    {
      key: 'holders',
      header: 'Holders',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">{r.status === 'declared' ? r.holders : '—'}</span>
      ),
      sortValue: (r) => r.holders,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="block">
          <Badge tone={STATUS_META[r.status].tone}>
            {STATUS_META[r.status].label}
          </Badge>
          {r.record_date && (
            <span className="mt-1 block text-xs text-ink-muted">
              As of {formatDate(r.record_date)}
            </span>
          )}
        </span>
      ),
      sortValue: (r) => r.status,
    },
  ];

  return (
    <>
      <PageHeader
        title="Profit Distributions"
        subtitle="Every closed profit period, across projects. Income and cost are recorded on each project's Income & Profit tab, and a period is closed, approved and declared there."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Declared to date"
          value={formatBdt(declared.reduce((t, r) => t + r.declared, 0))}
          hint={`${declared.length} period${declared.length === 1 ? '' : 's'}`}
          icon={Megaphone}
        />
        <Kpi
          label="Profit earned"
          value={formatBdt(rows.reduce((t, r) => t + r.operating_profit, 0))}
          hint="across every closed period"
          icon={TrendingUp}
        />
        <Kpi
          label="Kept back"
          value={formatBdt(rows.reduce((t, r) => t + r.reserve + r.mgmt_fee, 0))}
          hint="reserve and management fee"
          icon={Receipt}
        />
        <Kpi
          label="Waiting to be declared"
          value={waiting}
          hint="closed, with a profit"
          icon={HandCoins}
          tone={waiting ? 'danger' : 'default'}
        />
      </div>

      <Card className="p-0">
        <div className="p-5">
          <FilterBar>
            <FilterSelect
              label="Project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="closed">Closed</option>
              <option value="approved">Approved</option>
              <option value="declared">Declared</option>
            </FilterSelect>
          </FilterBar>

          <DataTable
            rows={shown}
            columns={columns}
            label="periods"
            emptyState={
              <EmptyState
                icon={TrendingUp}
                title={rows.length ? 'Nothing matches' : 'No period has been closed yet'}
                description={
                  rows.length
                    ? undefined
                    : 'Record income and cost on a project, then close its first period from the project page.'
                }
                action={
                  rows.length ? undefined : (
                    <Link href="/admin/projects" className="font-medium text-admin-700 underline">
                      Open Projects
                    </Link>
                  )
                }
              />
            }
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-medium text-ink">{r.label}</span>
                    <span className="block text-xs text-ink-muted">{r.project_name}</span>
                  </span>
                  <Badge tone={STATUS_META[r.status].tone}>
                    {STATUS_META[r.status].label}
                  </Badge>
                </div>
                <p className="text-xs text-ink-muted tabular-nums">
                  Profit {formatBdt(r.operating_profit)} · declared {formatBdt(r.declared)}
                </p>
              </div>
            )}
          />
        </div>
      </Card>
    </>
  );
}
