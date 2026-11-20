'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  FileSignature,
  HandCoins,
  Undo2,
  UserRound,
  XCircle,
} from 'lucide-react';
import { DetailTabs, SaleBadge } from '@/components/admin/share-sale/bits';
import {
  ReasonModal,
  RecordPaymentModal,
  ReverseReceiptModal,
  SignAgreementModal,
} from '@/components/admin/share-sale/SaleModals';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSession } from '@/lib/auth/session';
import { shareSaleKeys, shareSalesApi, type ApiShareSale } from '@/lib/api/share-sales';
import { useApi } from '@/lib/api/use-api';
import { FREQUENCY_LABEL, SHARE_PAYMENT_METHOD_LABEL, formatSharePct } from '@/lib/domain/share-sale';
import { cn } from '@/lib/utils/cn';
import { formatBdt, formatDate, formatPhone } from '@/lib/utils/format';

type Tab = 'overview' | 'receipts';
type Dialog = 'sign' | 'pay' | 'release' | 'cancel' | null;

/**
 * One investor's purchase: the terms, the schedule, every receipt, and the
 * one thing to do next.
 *
 * Everything money-shaped on this page was worked out by the server through
 * `lib/domain/share-sale.ts` — what each row is owed, what is late and by how
 * much, what has been paid. The screen formats it and does not add it up.
 *
 * The signing wizard's step-by-step KYC and the purchase's paper checklist
 * come back when documents move to Postgres; signing is a single dialog
 * meanwhile, and it collects the same facts.
 */
export default function ShareSaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const maySell = can('share_sale', 'edit');
  const maySign = can('share_sale', 'approve');
  const mayTakeMoney = can('finance_collection', 'create');
  const mayReverse = can('finance_collection', 'approve');

  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reversing, setReversing] = useState<string | null>(null);

  const sale = useApi(shareSaleKeys.one(id), (signal) => shareSalesApi.get(id, signal));

  if (sale === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!sale) {
    return (
      <EmptyState
        icon={XCircle}
        title="Purchase not found"
        action={<Link href="/admin/share-sale/investors">Back to investors</Link>}
      />
    );
  }

  const live = sale.status === 'reserved' || sale.status === 'agreement_signed';

  return (
    <>
      <Link
        href="/admin/share-sale/investors"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-admin-700"
      >
        <ArrowLeft className="size-4" /> Investors &amp; Dues
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">{sale.customer_name}</h1>
            <SaleBadge health={sale.health} />
            {sale.agreement_no && <Badge tone="teal">{sale.agreement_no}</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {sale.code} · {sale.project_name} · Round {sale.round_no} · {sale.shares} share
            {sale.shares === 1 ? '' : 's'} ({formatSharePct(sale.share_pct)})
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/customers/${sale.customer_id}`}>
            <Button variant="outline">
              <UserRound className="size-4" /> The investor
            </Button>
          </Link>
          {sale.status === 'reserved' && maySell && (
            <Button variant="dangerGhost" onClick={() => setDialog('release')}>
              Release
            </Button>
          )}
          {sale.status === 'reserved' && maySign && (
            <Button onClick={() => setDialog('sign')}>
              <FileSignature className="size-4" /> Sign the agreement
            </Button>
          )}
          {sale.status === 'agreement_signed' && maySign && (
            <Button variant="dangerGhost" onClick={() => setDialog('cancel')}>
              Cancel purchase
            </Button>
          )}
          {(sale.status === 'agreement_signed' || sale.status === 'fully_paid') &&
            mayTakeMoney &&
            sale.outstanding + sale.late_fees > 0.5 && (
              <Button onClick={() => setDialog('pay')}>
                <HandCoins className="size-4" /> Record a payment
              </Button>
            )}
        </div>
      </div>

      {sale.status === 'reserved' && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {sale.shares} share{sale.shares === 1 ? '' : 's'} are held until{' '}
          {formatDate(sale.hold_until)}. Nothing is owed until the agreement is signed — the
          schedule is written then.
        </p>
      )}
      {sale.status_note && (
        <p className="mb-4 rounded-xl border border-hairline bg-slate-50/60 px-4 py-3 text-sm text-ink-muted">
          {sale.status === 'released' ? 'Released' : 'Cancelled'}: {sale.status_note}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 lg:order-1">
          <DetailTabs
            tabs={[
              { key: 'overview' as const, label: 'Schedule' },
              { key: 'receipts' as const, label: `Receipts (${sale.payments.length})` },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'overview' && (
            <Card className="p-0">
              <div className="px-5 pt-5">
                <CardHeader
                  title="Payment schedule"
                  subtitle={
                    sale.schedule.length
                      ? `Down payment on the signing day, then ${sale.installment_count} ${FREQUENCY_LABEL[sale.installment_frequency].toLowerCase()} installment${sale.installment_count === 1 ? '' : 's'}.`
                      : 'Written when the agreement is signed.'
                  }
                />
              </div>
              {sale.schedule.length === 0 ? (
                <div className="px-5 pb-5">
                  <EmptyState
                    icon={FileSignature}
                    title="No schedule yet"
                    description="Sign the agreement and the schedule is written from the agreed plan."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-y border-hairline bg-canvas/60 text-left text-xs text-ink-muted">
                        <th className="px-5 py-2 font-medium">Due</th>
                        <th className="px-3 py-2 font-medium">What</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                        <th className="px-3 py-2 text-right font-medium">Paid</th>
                        <th className="px-3 py-2 text-right font-medium">Late fee</th>
                        <th className="px-5 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {sale.schedule.map((row) => (
                        <tr key={row.id} className={row.status === 'overdue' ? 'bg-red-50/40' : ''}>
                          <td className="px-5 py-2.5 tabular-nums">{formatDate(row.due_date)}</td>
                          <td className="px-3 py-2.5">{row.label}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {formatBdt(row.amount)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">
                            {row.paid_amount ? formatBdt(row.paid_amount) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">
                            {row.late_fee_due || row.late_fee_paid
                              ? formatBdt(row.late_fee_due + row.late_fee_paid)
                              : '—'}
                          </td>
                          <td className="px-5 py-2.5">
                            <StatusBadge row={row} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-hairline font-semibold">
                        <td className="px-5 py-3" colSpan={2}>
                          Total
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatBdt(sale.total_price)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                          {formatBdt(sale.paid)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-amber-700">
                          {sale.late_fees ? formatBdt(sale.late_fees) : '—'}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'receipts' && (
            <Card className="p-0">
              <div className="px-5 pt-5">
                <CardHeader
                  title="Receipts"
                  subtitle="Every payment on this purchase. A wrong one is reversed, never edited — both entries stay."
                />
              </div>
              {sale.payments.length === 0 ? (
                <div className="px-5 pb-5">
                  <EmptyState icon={HandCoins} title="Nothing received yet" />
                </div>
              ) : (
                <ul className="divide-y divide-hairline">
                  {sale.payments.map((p) => {
                    const reversal = p.amount < 0;
                    const reversed = sale.payments.some((x) => x.reverses_payment_id === p.id);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                            {p.code}
                            <span className="text-ink-muted">{formatDate(p.paid_on)}</span>
                            <Badge>{SHARE_PAYMENT_METHOD_LABEL[p.method]}</Badge>
                            {reversal && <Badge tone="amber">Reversal</Badge>}
                            {reversed && <Badge tone="neutral">Reversed</Badge>}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {p.reference ? `Ref ${p.reference}` : 'No reference'}
                            {p.late_fee !== 0 && ` · ${formatBdt(p.late_fee)} of it late fee`}
                            {p.notes ? ` · ${p.notes}` : ''}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-sm font-semibold tabular-nums',
                            reversal ? 'text-red-600' : 'text-emerald-700',
                          )}
                        >
                          {formatBdt(p.amount)}
                        </span>
                        {mayReverse && !reversal && !reversed && !sale.certificate_no && (
                          <Button variant="ghost" size="sm" onClick={() => setReversing(p.id)}>
                            <Undo2 className="size-4" /> Reverse
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-5 lg:order-2">
          <Card>
            <CardHeader title="Money" />
            <Line label="Price">{formatBdt(sale.total_price)}</Line>
            <Line label="Paid">
              <span className="text-emerald-700">{formatBdt(sale.paid)}</span>
            </Line>
            <Line label="Outstanding">{formatBdt(sale.outstanding)}</Line>
            <Line label="Owed now">
              {sale.due_now > 0.5 ? (
                <span className="text-red-600">{formatBdt(sale.due_now)}</span>
              ) : (
                'Nothing'
              )}
            </Line>
            {live && sale.schedule.length > 0 && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${sale.progress_pct}%` }}
                />
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="The purchase" />
            <Line label="Shares">
              {sale.shares} · {formatSharePct(sale.share_pct)}
            </Line>
            <Line label="Price a share">{formatBdt(sale.price_per_share)}</Line>
            <Line label="Down payment">{formatBdt(sale.down_payment)}</Line>
            <Line label="Installments">
              {sale.installment_count} {FREQUENCY_LABEL[sale.installment_frequency].toLowerCase()}
            </Line>
            <Line label="Reserved">{formatDate(sale.reserved_on)}</Line>
            {sale.agreement_date && <Line label="Signed">{formatDate(sale.agreement_date)}</Line>}
            {sale.next_due_date && <Line label="Next due">{formatDate(sale.next_due_date)}</Line>}
          </Card>

          <Card>
            <CardHeader title="Investor" />
            <Line label="Name">{sale.customer_name}</Line>
            <Line label="Code">{sale.customer_code}</Line>
            <Line label="Phone">{formatPhone(sale.customer_phone)}</Line>
          </Card>
        </aside>
      </div>

      {dialog === 'sign' && (
        <SignAgreementModal sale={sale} onClose={() => setDialog(null)} />
      )}
      {dialog === 'pay' && <RecordPaymentModal sale={sale} onClose={() => setDialog(null)} />}
      {(dialog === 'release' || dialog === 'cancel') && (
        <ReasonModal
          sale={sale}
          action={dialog === 'release' ? 'release' : 'cancel'}
          onClose={() => setDialog(null)}
        />
      )}
      {reversing && (
        <ReverseReceiptModal
          sale={sale}
          paymentId={reversing}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-2 text-sm last:border-0">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="min-w-0 text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

function StatusBadge({ row }: { row: ApiShareSale['schedule'][number] }) {
  if (row.status === 'paid') return <Badge tone="green">Paid</Badge>;
  if (row.status === 'overdue') {
    return (
      <Badge tone="red">
        {row.days_late} day{row.days_late === 1 ? '' : 's'} late
      </Badge>
    );
  }
  if (row.status === 'due') return <Badge tone="amber">Due</Badge>;
  return <Badge>Upcoming</Badge>;
}
