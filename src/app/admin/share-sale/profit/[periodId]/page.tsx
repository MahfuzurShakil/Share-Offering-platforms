'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, BadgeCheck, Megaphone, RotateCcw, Undo2 } from 'lucide-react';
import { FormError, PeriodBadge, StatementLine, Waterfall } from '@/components/admin/revenue/bits';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { Field, MoneyInput, TextInput } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { useSession } from '@/lib/auth/session';
import { messageOf } from '@/lib/api/client';
import {
  distributionKeys,
  revenueApi,
  revenueKeys,
  type ApiHolderLine,
} from '@/lib/api/revenue';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

/**
 * One period (REVENUE-SHARE-PLAN.md §2.3–§5.1): the frozen statement,
 * management's approval of how much to share, the declaration that writes
 * every holder's line, and what each head contributed.
 *
 * All of it arrives in one read — `GET /revenue-periods/{id}` — because a
 * preview assembled from several calls can disagree with itself while the
 * person is looking at it.
 */
export default function PeriodPage() {
  const { periodId } = useParams<{ periodId: string }>();
  const router = useRouter();
  const { can } = useSession();
  const mayEdit = can('share_sale', 'edit');

  const detail = useApi(revenueKeys.period(periodId), (signal) =>
    revenueApi.detail(periodId, signal),
  );
  const refresh = useRefresh([revenueKeys.all, distributionKeys.all]);

  const [dialog, setDialog] = useState<'approve' | 'unapprove' | 'declare' | 'reopen' | null>(null);
  const [amount, setAmount] = useState('');
  const [recordDate, setRecordDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (detail === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;
  const p = detail.period;
  const policy = detail.policy;
  const loss = Math.max(0, -p.operating_profit);
  // a loss period shares nothing, so there is no one to preview
  const lines = p.status === 'declared' ? detail.lines : loss > 0 ? [] : detail.preview;

  async function run(action: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await action();
      await refresh();
      setDialog(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ApiHolderLine & { id: string }>[] = [
    {
      key: 'name',
      header: 'Holder',
      cell: (l) => (
        <div>
          <p className="font-medium text-ink">{l.name}</p>
          <p className="text-xs text-ink-muted">
            {l.allocation.holder_type === 'customer' ? `Customer · ${l.code ?? ''}` : `Owner · ${l.code ?? ''}`}
          </p>
        </div>
      ),
    },
    { key: 'pct', header: 'Ownership', align: 'right', sortValue: (l) => l.allocation.ownership_pct, cell: (l) => `${l.allocation.ownership_pct.toFixed(3)}%` },
    {
      key: 'factor',
      header: 'Counted',
      align: 'right',
      cell: (l) =>
        l.allocation.holder_type === 'partner' ? (
          <span className="text-xs text-ink-muted">+ unclaimed</span>
        ) : (
          `${Math.round(l.allocation.eligibility_factor * 100)}%`
        ),
    },
    { key: 'gross', header: 'Share', align: 'right', sortValue: (l) => l.allocation.gross, cell: (l) => formatBdt(l.allocation.gross) },
    { key: 'tax', header: 'Tax', align: 'right', cell: (l) => formatBdt(l.allocation.tax_withheld) },
    {
      key: 'adj',
      header: 'To dues',
      align: 'right',
      cell: (l) => (l.allocation.adjusted_to_dues ? formatBdt(l.allocation.adjusted_to_dues) : '—'),
    },
    { key: 'net', header: 'Credited', align: 'right', cell: (l) => <span className="font-medium">{formatBdt(l.allocation.net_credited)}</span> },
  ];

  return (
    <>
      <Link
        href={`/admin/projects/${p.project_id}`}
        className="mb-4 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-admin-700"
      >
        <ArrowLeft className="size-4" /> {detail.project_name}
      </Link>
      <PageHeader
        title={`${p.label} · ${detail.project_name}`}
        subtitle={`${p.code} · ${formatDate(p.period_start)} – ${formatDate(p.period_end)}`}
        action={
          mayEdit && (
            <div className="flex flex-wrap gap-2">
              {p.status === 'closed' && (
                <>
                  <Button variant="outline" onClick={() => setDialog('reopen')}>
                    <RotateCcw className="size-4" /> Reopen
                  </Button>
                  {loss === 0 && (
                    <Button
                      onClick={() => {
                        setAmount(String(p.available));
                        setDialog('approve');
                      }}
                    >
                      <BadgeCheck className="size-4" /> Approve
                    </Button>
                  )}
                </>
              )}
              {p.status === 'approved' && (
                <>
                  <Button variant="outline" onClick={() => setDialog('unapprove')}>
                    <Undo2 className="size-4" /> Back to closed
                  </Button>
                  <Button
                    onClick={() => {
                      setRecordDate(todayLocal() < p.period_end ? p.period_end : todayLocal());
                      setDialog('declare');
                    }}
                  >
                    <Megaphone className="size-4" /> Declare
                  </Button>
                </>
              )}
            </div>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">{p.status === 'declared' ? 'Who got what' : 'Who would get what'}</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {p.status === 'declared'
                    ? `Ownership on ${formatDate(p.record_date)}, frozen at declaration.`
                    : `A preview on today's ownership. ${p.declared > 0 ? '' : 'Nothing has been approved yet, so this is the whole of what is available.'}`}
                </p>
              </div>
              {lines.length > 0 && (
                <ExportCsvButton
                  filenamePrefix={`${p.code}-holders`}
                  rows={lines}
                  columns={[
                    { header: 'Holder', value: (l) => l.name },
                    { header: 'Type', value: (l) => l.allocation.holder_type },
                    { header: 'Ownership %', value: (l) => l.allocation.ownership_pct },
                    { header: 'Share', value: (l) => l.allocation.gross },
                    { header: 'Tax', value: (l) => l.allocation.tax_withheld },
                    { header: 'To dues', value: (l) => l.allocation.adjusted_to_dues },
                    { header: 'Credited', value: (l) => l.allocation.net_credited },
                  ]}
                />
              )}
            </div>
            <DataTable
              rows={lines.map((l) => ({ ...l, id: l.allocation.id }))}
              columns={columns}
              label="holders"
              emptyState={<p className="p-6 text-sm text-ink-muted">{loss > 0 ? 'A loss period shares nothing.' : 'No holders.'}</p>}
              mobileCard={(l) => (
                <div className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-ink">{l.name}</p>
                    <p className="text-xs text-ink-muted">{l.allocation.ownership_pct.toFixed(3)}%</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">{formatBdt(l.allocation.net_credited)}</span>
                </div>
              )}
            />
          </Card>

          {loss > 0 && (
            <Card>
              <CardHeader
                title="This period lost money"
                subtitle={`${formatBdt(loss)} lost`}
                action={<Badge tone="amber">Carried forward</Badge>}
              />
              <p className="text-sm text-ink-muted">
                {policy?.loss_rule === 'recover_first'
                  ? 'Nothing is shared, and the loss is recovered out of the next period that earns before anything is distributed.'
                  : 'Nothing is shared. The policy does not carry this loss into the next period.'}{' '}
                Recording that the owners or a loan covered it instead comes with Loans, in the
                Money module.
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Statement" action={<PeriodBadge status={p.status === 'cancelled' ? 'closed' : p.status} />} />
            <Waterfall s={p} reservePct={policy?.reserve_pct} />
            {(p.status === 'approved' || p.status === 'declared') && (
              <StatementLine label="Declared by management" value={p.declared} strong tone="good" />
            )}
            {p.declared < p.available && p.status !== 'closed' && (
              <p className="mt-1 text-xs text-ink-muted">{formatBdt(p.available - p.declared)} kept back in the project.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="By head" />
            {detail.heads.length === 0 && <p className="text-sm text-ink-muted">No entries in this period.</p>}
            {detail.heads.map((h) => (
              <StatementLine key={`${h.direction}${h.head}`} label={h.head} value={h.amount} minus={h.direction === 'cost'} />
            ))}
          </Card>
          <Card>
            <CardHeader title="Trail" />
            <div className="space-y-1 text-sm text-ink-muted">
              <p>Closed {formatDate(p.created_at.slice(0, 10))}</p>
              {p.approved_on && <p>Approved {formatDate(p.approved_on)}</p>}
              {p.declared_on && (
                <p>
                  Declared {formatDate(p.declared_on)}, record date {formatDate(p.record_date)}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'approve'}
        tone="default"
        icon={BadgeCheck}
        title={`Approve ${p.label}`}
        subtitle={`Up to ${formatBdt(p.available)} can be shared`}
        confirmLabel="Approve"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => run(() => revenueApi.approve(p.id, Number(amount)))}
      >
        <Field label="Amount to share" hint="Less keeps the rest in the project.">
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="mt-3">
          <FormError error={error} />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'declare'}
        tone="warning"
        icon={Megaphone}
        title={`Declare ${formatBdt(p.declared)}`}
        subtitle="Every holder's share is written and cannot be changed"
        confirmLabel="Declare"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => run(() => revenueApi.declare(p.id, recordDate))}
      >
        <Field label="Record date" hint="Ownership on this day decides who shares.">
          <TextInput type="date" value={recordDate} min={p.period_end} max={todayLocal()} onChange={(e) => setRecordDate(e.target.value)} />
        </Field>
        {policy?.adjust_overdue_first && (
          <p className="mt-3 text-xs text-ink-muted">Customers with overdue installments have their share paid onto those first.</p>
        )}
        <div className="mt-3">
          <FormError error={error} />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'reopen'}
        tone="warning"
        icon={RotateCcw}
        title={`Reopen ${p.label}?`}
        message={error || 'Its entries unlock and the statement is worked out again when it is next closed.'}
        confirmLabel="Reopen"
        busy={busy}
        onCancel={() => {
          setDialog(null);
          setError('');
        }}
        /* reopening removes the period row, so there is no page to come back to */
        onConfirm={() =>
          run(async () => {
            await revenueApi.reopen(p.id);
            router.push(`/admin/projects/${p.project_id}`);
          })
        }
      />

      <ConfirmDialog
        open={dialog === 'unapprove'}
        tone="warning"
        icon={Undo2}
        title="Back to closed?"
        message={error || 'The approval and the amount to share are cleared.'}
        confirmLabel="Back to closed"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => run(() => revenueApi.unapprove(p.id))}
      />
    </>
  );
}
