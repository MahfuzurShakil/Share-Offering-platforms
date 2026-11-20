'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BadgeCheck, CheckCheck, Clock, HandCoins, ReceiptText, Wallet } from 'lucide-react';
import { Kpi } from '@/components/admin/share-sale/bits';
import { LineStatusBadge } from '@/components/admin/sales-team/parts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterBar, FilterSelect } from '@/components/ui/FilterBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { useReadOnly } from '@/components/ui/ViewOnly';
import { messageOf } from '@/lib/api/client';
import {
  commissionKeys,
  commissionsApi,
  type ApiCommissionLine,
  type CommissionQuery,
} from '@/lib/api/sales-team';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { COMMISSION_LINE_STATUSES } from '@/lib/db/types';
import { COMMISSION_LINE_STATUS_META, SALE_KIND_LABEL } from '@/lib/domain/commission';
import { formatBdt, formatDate } from '@/lib/utils/format';

const saleHref = (r: ApiCommissionLine) => `/admin/share-sale/sales/${r.share_sale_id}`;

/** Every line, for the pickers and the "of N" count. */
const EVERYTHING: CommissionQuery = { page_size: 500 };

/**
 * Sales Team → Commissions (plan §7.3): every commission line, by member,
 * project, sale, stage and status. Stages turn earned on their own as buyers
 * pay; Accounts approves earned lines here, singly or in bulk.
 */
function CommissionsPage() {
  const params = useSearchParams();
  const readOnly = useReadOnly();
  const refresh = useRefresh([commissionKeys.all]);
  const [q, setQ] = useState('');
  const [member, setMember] = useState(params.get('member') ?? 'all');
  const [project, setProject] = useState('all');
  const [status, setStatus] = useState(params.get('status') ?? 'all');
  const [kind, setKind] = useState('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /*
   * Postgres filters by member, project and status, and adds the totals up
   * over everything that matched rather than over the page — a figure that
   * changed when somebody turned the page would be worse than none. The text
   * box and "paid, to recover" still narrow what came back.
   */
  const query: CommissionQuery = {
    member_id: member === 'all' ? undefined : member,
    project_id: project === 'all' ? undefined : project,
    status:
      status === 'all' || status === 'to_recover'
        ? undefined
        : (status as ApiCommissionLine['status']),
    page_size: 500,
  };
  const page = useApi(commissionKeys.list(query), (signal) => commissionsApi.page(query, signal));
  const everything = useApi(commissionKeys.list(EVERYTHING), (signal) =>
    commissionsApi.page(EVERYTHING, signal),
  );

  if (!page) return <p className="text-sm text-ink-muted">Loading…</p>;

  const rows = page.rows;
  const all = everything?.rows ?? rows;
  const members = [...new Map(all.map((r) => [r.member_id, r.member_name])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  const projects = [
    ...new Map(
      all.filter((r) => r.project_id).map((r) => [r.project_id as string, r.project_name ?? '—']),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (status === 'to_recover' && !(r.status === 'paid' && r.to_recover)) return false;
    if (kind !== 'all' && r.sale_kind !== kind) return false;
    return (
      !needle ||
      [r.member_name, r.member_code, r.sale_code, r.customer_name, r.project_name, r.stage_label]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  });
  const filtered = Boolean(
    needle || member !== 'all' || project !== 'all' || status !== 'all' || kind !== 'all',
  );
  const totals = page.totals;
  const earnedShown = shown.filter((r) => r.status === 'earned');
  const chosen = shown.filter((r) => picked.has(r.id) && r.status === 'earned');
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      await commissionsApi.approve(chosen.map((r) => r.id));
      await refresh();
      setPicked(new Set());
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const columns: Column<ApiCommissionLine>[] = [
    {
      key: 'pick',
      header: '',
      className: 'w-8',
      cell: (r) =>
        r.status === 'earned' && !readOnly ? (
          <input
            type="checkbox"
            aria-label={`Select ${r.member_name} ${r.stage_label}`}
            className="size-4 accent-admin-500"
            checked={picked.has(r.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggle(r.id)}
          />
        ) : null,
    },
    {
      key: 'member',
      header: 'Member',
      cell: (r) => (
        <span className="block">
          <Link href={`/admin/sales-team/members/${r.member_id}`} className="block font-medium text-ink hover:text-admin-700 hover:underline">
            {r.member_name}
          </Link>
          <span className="block text-xs text-ink-muted">
            {r.role === 'seller' ? 'Seller' : 'Override'} · {r.designation_at_sale}
          </span>
        </span>
      ),
      sortValue: (r) => r.member_name,
    },
    {
      key: 'sale',
      header: 'Sale',
      cell: (r) => (
        <span className="block">
          <Link href={saleHref(r)} className="block font-medium text-admin-700 hover:underline">
            {r.sale_code}
          </Link>
          <span className="block text-xs text-ink-muted">
            {SALE_KIND_LABEL[r.sale_kind]} · {r.customer_name ?? '—'} · {r.project_name ?? '—'}
          </span>
        </span>
      ),
      sortValue: (r) => r.sale_date,
    },
    {
      key: 'stage',
      header: 'Stage',
      cell: (r) => (
        <span className="block">
          <span className="block">{r.stage_label}</span>
          <span className="block text-xs text-ink-muted">{r.earned_on ? `Released ${formatDate(r.earned_on)}` : `Sale ${formatDate(r.sale_date)}`}</span>
        </span>
      ),
      sortValue: (r) => `${r.sale_date}${r.stage_seq}`,
    },
    { key: 'status', header: 'Status', cell: (r) => <LineStatusBadge status={r.status} toRecover={r.to_recover} />, sortValue: (r) => COMMISSION_LINE_STATUSES.indexOf(r.status) },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums font-medium">{formatBdt(r.amount)}</span>, sortValue: (r) => r.amount },
  ];

  return (
    <>
      <PageHeader
        title="Commissions"
        subtitle="Every commission line. A stage turns earned on its own when the buyer's payments reach it; approve earned lines to make them payable."
        action={
          !readOnly && (
            <div className="flex flex-wrap gap-2">
              {earnedShown.length > 0 && (
                <Button variant="outline" onClick={() => setPicked(new Set(earnedShown.map((r) => r.id)))}>
                  Select all earned ({earnedShown.length})
                </Button>
              )}
              <Button disabled={chosen.length === 0} onClick={() => setConfirm(true)}>
                <CheckCheck className="size-4" /> Approve {chosen.length || ''}
              </Button>
            </div>
          )
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Still to come" value={formatBdt(totals.pending)} hint="stages the buyer has not reached" icon={Clock} />
        <Kpi label="Earned, to approve" value={formatBdt(totals.earned)} hint={`${earnedShown.length} line${earnedShown.length === 1 ? '' : 's'}`} icon={BadgeCheck} href="/admin/sales-team/commissions?status=earned" />
        <Kpi label="Approved, to pay" value={formatBdt(totals.approved)} hint="paid from Payouts" icon={HandCoins} href="/admin/sales-team/payouts" />
        <Kpi label="Paid" value={formatBdt(totals.paid)} hint={totals.to_recover ? `${formatBdt(totals.to_recover)} to recover` : `${formatBdt(totals.recovered)} recovered`} icon={Wallet} tone={totals.to_recover ? 'danger' : 'default'} />
      </div>
      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <Card>
        <FilterBar
          search={{ value: q, onChange: setQ, placeholder: 'Member, sale, customer, stage…' }}
          onReset={() => {
            setQ('');
            setMember('all');
            setProject('all');
            setStatus('all');
            setKind('all');
          }}
          isFiltered={filtered}
          resultLabel={`${shown.length} of ${all.length} lines`}
        >
          <FilterSelect label="Member" value={member} onChange={(e) => setMember(e.target.value)}>
            <option value="all">Everyone</option>
            {members.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All projects</option>
            {projects.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any status</option>
            {COMMISSION_LINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {COMMISSION_LINE_STATUS_META[s].label}
              </option>
            ))}
            <option value="to_recover">Paid, to recover</option>
          </FilterSelect>
          <FilterSelect label="Sale" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">Shares & bookings</option>
            <option value="share">Share sales</option>
            <option value="booking">Bookings</option>
          </FilterSelect>
        </FilterBar>
        <DataTable
          rows={shown}
          columns={columns}
          label="lines"
          initialSort={{ key: 'stage', direction: 'desc' }}
          emptyState={<EmptyState icon={ReceiptText} title={filtered ? 'No line matches' : 'No commission yet'} description={filtered ? 'Change or reset the filters.' : 'Lines appear once a sale has a seller and a plan covers it.'} />}
          mobileCard={(r) => (
            <div className="flex items-start gap-3">
              {r.status === 'earned' && !readOnly && (
                <input type="checkbox" aria-label={`Select ${r.member_name} ${r.stage_label}`} className="mt-1 size-4 accent-admin-500" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-medium text-ink">{r.member_name}</span>
                    <span className="block text-xs text-ink-muted">
                      {r.sale_code} · {r.stage_label}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatBdt(r.amount)}</span>
                </div>
                <LineStatusBadge status={r.status} toRecover={r.to_recover} />
              </div>
            </div>
          )}
        />
      </Card>
      <ConfirmDialog
        open={confirm}
        tone="default"
        icon={CheckCheck}
        title={`Approve ${chosen.length} line${chosen.length === 1 ? '' : 's'}?`}
        message={`${formatBdt(chosen.reduce((t, r) => t + r.amount, 0))} becomes payable to ${new Set(chosen.map((r) => r.member_id)).size} member(s).`}
        confirmLabel={busy ? 'Approving…' : 'Approve'}
        busy={busy}
        onConfirm={approve}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <CommissionsPage />
    </Suspense>
  );
}
