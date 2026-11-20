'use client';

import { useState } from 'react';
import { BadgeCheck, Banknote, Clock, HandCoins, XCircle } from 'lucide-react';
import { Kpi } from '@/components/admin/share-sale/bits';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { messageOf } from '@/lib/api/client';
import {
  withdrawalKeys,
  withdrawalsApi,
  type ApiWithdrawal,
} from '@/lib/api/revenue';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { WITHDRAWAL_METHOD_LABEL, WITHDRAWAL_STATUS_META } from '@/lib/domain/revenue-share';
import { cn } from '@/lib/utils/cn';
import { formatBdt, formatDate, formatPhone, todayLocal } from '@/lib/utils/format';

type Show = 'requested' | 'approved' | 'paid' | 'rejected' | 'all';

const SHOWS: [Show, string][] = [
  ['requested', 'Waiting'],
  ['approved', 'To pay'],
  ['paid', 'Paid'],
  ['rejected', 'Refused'],
  ['all', 'All'],
];

/**
 * Share Sale → Profit Withdrawals (REVENUE-SHARE-PLAN.md §5.3).
 *
 * Money the holders have asked for out of their profit balance, and what
 * became of it. A request holds its amount from the moment it is made until
 * it is paid or refused, so the balance on the investor's page and the queue
 * here can never disagree.
 */
export default function ProfitWithdrawalsPage() {
  const refresh = useRefresh([withdrawalKeys.all]);
  const [show, setShow] = useState<Show>('requested');
  const [paying, setPaying] = useState<ApiWithdrawal | null>(null);
  const [rejecting, setRejecting] = useState<ApiWithdrawal | null>(null);
  const [error, setError] = useState('');

  const query = { page_size: 200 } as const;
  const page = useApi(withdrawalKeys.list(query), (signal) =>
    withdrawalsApi.list(query, signal),
  );

  if (page === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;

  const all = page.rows;
  const rows = show === 'all' ? all : all.filter((r) => r.status === show);

  const totals = {
    waiting: all.filter((r) => r.status === 'requested').reduce((t, r) => t + r.amount, 0),
    toPay: all.filter((r) => r.status === 'approved').reduce((t, r) => t + r.amount, 0),
    paid: all.filter((r) => r.status === 'paid').reduce((t, r) => t + r.amount, 0),
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const columns: Column<ApiWithdrawal>[] = [
    {
      key: 'code',
      header: 'Request',
      cell: (r) => (
        <span className="block">
          <span className="block font-medium text-ink">{r.code}</span>
          <span className="block text-xs text-ink-muted">{formatDate(r.requested_on)}</span>
        </span>
      ),
      sortValue: (r) => r.code,
    },
    {
      key: 'holder',
      header: 'Holder',
      cell: (r) => (
        <span className="block">
          <span className="block">{r.customer_name ?? 'Partner'}</span>
          <span className="block text-xs text-ink-muted">
            {r.customer_phone ? formatPhone(r.customer_phone) : r.customer_code} · {r.project_name}
          </span>
        </span>
      ),
      sortValue: (r) => r.customer_name ?? '',
    },
    {
      key: 'pay_to',
      header: 'Pay to',
      cell: (r) => (
        <span className="block">
          <span className="block">{WITHDRAWAL_METHOD_LABEL[r.method]}</span>
          <span className="block text-xs text-ink-muted">{r.pay_to}</span>
        </span>
      ),
      sortValue: (r) => r.method,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => <span className="font-medium tabular-nums">{formatBdt(r.amount)}</span>,
      sortValue: (r) => r.amount,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="block">
          <Badge tone={WITHDRAWAL_STATUS_META[r.status].tone}>
            {WITHDRAWAL_STATUS_META[r.status].label}
          </Badge>
          {r.status === 'rejected' && r.reject_reason && (
            <span className="mt-1 block max-w-48 text-xs text-ink-muted">{r.reject_reason}</span>
          )}
          {r.status === 'paid' && r.paid_on && (
            <span className="mt-1 block text-xs text-ink-muted">
              {formatDate(r.paid_on)}
              {r.reference_no ? ` · ${r.reference_no}` : ''}
            </span>
          )}
        </span>
      ),
      sortValue: (r) => r.status,
    },
    {
      key: 'do',
      header: '',
      cell: (r) => (
        <span className="flex justify-end gap-2">
          {r.status === 'requested' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setRejecting(r)}>
                Refuse
              </Button>
              <Button size="sm" onClick={() => act(() => withdrawalsApi.approve(r.id))}>
                Approve
              </Button>
            </>
          )}
          {r.status === 'approved' && (
            <Button size="sm" onClick={() => setPaying(r)}>
              <Banknote className="size-4" /> Record payout
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Profit Withdrawals"
        subtitle="What holders have asked for out of their profit, and what became of it. The amount is held from their balance until it is paid or refused."
      />

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Waiting on a decision"
          value={formatBdt(totals.waiting)}
          hint={`${all.filter((r) => r.status === 'requested').length} request(s)`}
          icon={Clock}
          tone={totals.waiting ? 'danger' : 'default'}
        />
        <Kpi
          label="Approved, to pay"
          value={formatBdt(totals.toPay)}
          hint="money owed to holders"
          icon={BadgeCheck}
        />
        <Kpi label="Paid out" value={formatBdt(totals.paid)} icon={HandCoins} />
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap gap-1 border-b border-hairline px-5 pt-3">
          {SHOWS.map(([key, label]) => {
            const n = key === 'all' ? all.length : all.filter((r) => r.status === key).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setShow(key)}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  show === key
                    ? 'border-admin-500 text-admin-700'
                    : 'border-transparent text-ink-muted hover:text-ink',
                )}
              >
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px]',
                    key === 'requested' && n
                      ? 'bg-amber-50 text-amber-700'
                      : show === key
                        ? 'bg-admin-50 text-admin-700'
                        : 'bg-slate-100 text-ink-muted',
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <div className="p-5">
          <DataTable
            rows={rows}
            columns={columns}
            label="requests"
            emptyState={
              <EmptyState
                icon={HandCoins}
                title={show === 'requested' ? 'Nothing waiting' : 'Nothing here'}
                description={
                  all.length
                    ? 'Try another tab.'
                    : 'A holder can ask for their profit once a period has been declared.'
                }
              />
            }
            mobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-medium text-ink">{r.customer_name}</span>
                    <span className="block text-xs text-ink-muted">
                      {r.code} · {r.project_name}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{formatBdt(r.amount)}</span>
                </div>
                <Badge tone={WITHDRAWAL_STATUS_META[r.status].tone}>
                  {WITHDRAWAL_STATUS_META[r.status].label}
                </Badge>
              </div>
            )}
          />
        </div>
      </Card>

      {paying && (
        <PayModal
          request={paying}
          onClose={() => {
            setPaying(null);
            void refresh();
          }}
        />
      )}
      {rejecting && (
        <RejectModal
          request={rejecting}
          onClose={() => {
            setRejecting(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function PayModal({ request, onClose }: { request: ApiWithdrawal; onClose: () => void }) {
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal
      open
      title="Record the payout"
      subtitle={`${request.code} · ${request.customer_name} · ${formatBdt(request.amount)}`}
      icon={Banknote}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await withdrawalsApi.pay(request.id, {
                  paid_on: paidOn,
                  reference_no: reference.trim() || null,
                  notes: notes.trim() || null,
                });
                onClose();
              } catch (e) {
                setError(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark as paid
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        Paying to {WITHDRAWAL_METHOD_LABEL[request.method].toLowerCase()}:{' '}
        <strong className="text-ink">{request.pay_to}</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid on" required>
          <TextInput
            type="date"
            max={todayLocal()}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </Field>
        <Field label="Reference" hint="Transaction or cheque number">
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <Field label="Note" className="mt-4">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

function RejectModal({ request, onClose }: { request: ApiWithdrawal; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal
      open
      title="Refuse this request"
      subtitle={`${request.code} · ${formatBdt(request.amount)}`}
      icon={XCircle}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await withdrawalsApi.reject(request.id, reason.trim());
                onClose();
              } catch (e) {
                setError(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Refuse
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        The amount goes back to their balance, and they are told why.
      </p>
      <Field label="Why" required>
        <TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Bank account not verified yet"
        />
      </Field>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
