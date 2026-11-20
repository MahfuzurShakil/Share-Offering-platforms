'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, FileSignature, HandCoins, Ticket, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { Field, MoneyInput, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { fieldErrorsOf, messageOf } from '@/lib/api/client';
import { customerKeys, customersApi } from '@/lib/api/customers';
import { shareSaleKeys, shareSalesApi, type ApiShareSale } from '@/lib/api/share-sales';
import { shareOfferingKeys, type ApiShareOffering } from '@/lib/api/share-offerings';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { SHARE_PAYMENT_METHODS, type SharePaymentMethod } from '@/lib/db/types';
import { SHARE_PAYMENT_METHOD_LABEL, buildSchedule } from '@/lib/domain/share-sale';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

/**
 * The four things somebody does to a purchase: hold shares, sign the
 * agreement, take money, and put a wrong receipt right.
 *
 * Every one of them previews its own arithmetic before it is saved — the
 * schedule a plan would produce, what a payment would clear — using the same
 * `lib/domain` code the server books it with. The server still decides; this
 * is so nobody saves a plan they have not seen.
 */

function useAction() {
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, done: () => void) => {
    setBusy(true);
    setError('');
    setFields({});
    try {
      await fn();
      done();
    } catch (e) {
      setFields(fieldErrorsOf(e));
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, fields, busy, run };
}

function ErrorNote({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Hold shares
 * ------------------------------------------------------------------ */

/**
 * Holds shares for an investor while the agreement is prepared (plan §4.3).
 *
 * The customer is picked, not typed: one investor is one file, so a new one is
 * added on the Customers screen and found here by name or number.
 */
export function ReserveModal({
  offering,
  onClose,
}: {
  offering: ApiShareOffering;
  onClose: () => void;
}) {
  const refresh = useRefresh([shareSaleKeys.all, shareOfferingKeys.all, customerKeys.all]);
  const { error, fields, busy, run } = useAction();

  const [customerId, setCustomerId] = useState('');
  const [shares, setShares] = useState(String(offering.min_shares || 1));
  const [downPct, setDownPct] = useState(String(offering.min_down_payment_pct || 0));
  const [installments, setInstallments] = useState(String(offering.max_installments || 0));
  const [notes, setNotes] = useState('');

  const customers =
    useApi(customerKeys.list({ page_size: 200, sort: 'name' }), (signal) =>
      customersApi.list({ page_size: 200, sort: 'name' }, signal),
    ) ?? [];

  const count = Math.max(0, Math.floor(Number(shares) || 0));
  const total = count * offering.price_per_share;
  const down = Math.round((total * (Number(downPct) || 0)) / 100);
  const n = Math.max(0, Math.floor(Number(installments) || 0));
  const each = n > 0 ? Math.floor((total - down) / n) : 0;

  return (
    <Modal
      open
      title="Reserve shares"
      subtitle={`${offering.project_name} · ${offering.code} · ${formatBdt(offering.price_per_share)} a share`}
      icon={Ticket}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !customerId || count < 1}
            onClick={() =>
              run(async () => {
                await shareSalesApi.reserve({
                  offering_id: offering.id,
                  customer_id: customerId,
                  shares: count,
                  down_payment_pct: Number(downPct) || 0,
                  installment_count: n,
                  notes: notes.trim() || null,
                });
                await refresh();
              }, onClose)
            }
          >
            Hold {count} share{count === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Investor" required error={fields.customer_id}>
          <Combobox
            value={customerId}
            onChange={(id) => setCustomerId(id ?? '')}
            placeholder="Search by name, code or number…"
            options={customers.map((c) => ({
              id: c.id,
              label: c.name,
              hint: `${c.code} · ${c.phone}`,
              keywords: c.phone,
            }))}
          />
          <span className="mt-1 block text-xs text-ink-muted">
            Not on file yet?{' '}
            <Link href="/admin/customers/new" className="font-medium text-admin-700 underline">
              Add them first
            </Link>
          </span>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Shares"
            required
            error={fields.shares}
            hint={`${offering.min_shares}–${offering.max_shares ?? offering.available_shares}, ${offering.available_shares} free`}
          >
            <TextInput
              type="number"
              min={offering.min_shares}
              max={Math.min(offering.max_shares ?? offering.available_shares, offering.available_shares)}
              value={shares}
              onChange={(e) => setShares(e.target.value)}
            />
          </Field>
          <Field
            label="Down payment (%)"
            required
            error={fields.down_payment_pct}
            hint={`At least ${offering.min_down_payment_pct}%`}
          >
            <TextInput
              type="number"
              min={offering.min_down_payment_pct}
              max={100}
              value={downPct}
              onChange={(e) => setDownPct(e.target.value)}
            />
          </Field>
          <Field
            label="Installments"
            required
            error={fields.installment_count}
            hint={`Up to ${offering.max_installments}`}
          >
            <TextInput
              type="number"
              min={0}
              max={offering.max_installments}
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
            />
          </Field>
        </div>

        {count > 0 && (
          <div className="rounded-xl border border-admin-100 bg-admin-50/60 px-4 py-3 text-sm">
            <p className="font-semibold text-admin-700 tabular-nums">
              {formatBdt(total)} for {count} share{count === 1 ? '' : 's'}
            </p>
            <p className="mt-1 text-ink-muted tabular-nums">
              {formatBdt(down)} down
              {n > 0
                ? `, then ${n} × ${formatBdt(each)} ${offering.installment_frequency}`
                : ' — the whole price at signing'}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Held until the agreement is signed, {offering.hold_days} days from today.
            </p>
          </div>
        )}

        <Field label="Note" error={fields.notes}>
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything agreed on the phone, for whoever signs it"
          />
        </Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Sign the agreement
 * ------------------------------------------------------------------ */

/**
 * Signing fixes the plan and writes the schedule.
 *
 * The plan can be re-agreed at the table — people negotiate the down payment
 * and the tenure right up to signing — so the schedule is previewed here from
 * whatever is typed, and saved only when it is what both sides agreed.
 *
 * The witnesses, stamp and notary of §4a are collected as one block; the full
 * step-by-step wizard, with the paper checklist that gates it, returns when
 * documents move to Postgres.
 */
export function SignAgreementModal({
  sale,
  onClose,
}: {
  sale: ApiShareSale;
  onClose: () => void;
}) {
  const refresh = useRefresh([shareSaleKeys.all, shareOfferingKeys.all, customerKeys.all]);
  const { error, fields, busy, run } = useAction();

  const [date, setDate] = useState(todayLocal());
  const [firstDue, setFirstDue] = useState(sale.first_due_date ?? '');
  const [shares, setShares] = useState(String(sale.shares));
  const [downPct, setDownPct] = useState(
    String(sale.total_price ? Math.round((sale.down_payment / sale.total_price) * 100) : 0),
  );
  const [installments, setInstallments] = useState(String(sale.installment_count));
  const [place, setPlace] = useState('');
  const [signatory, setSignatory] = useState('');
  const [witness1, setWitness1] = useState('');
  const [witness2, setWitness2] = useState('');

  const count = Math.max(0, Math.floor(Number(shares) || 0));
  const total = count * sale.price_per_share;
  const down = Math.round((total * (Number(downPct) || 0)) / 100);
  const n = Math.max(0, Math.floor(Number(installments) || 0));
  const changed =
    count !== sale.shares ||
    n !== sale.installment_count ||
    down !== sale.down_payment;

  const preview =
    date && (n === 0 || firstDue)
      ? buildSchedule({
          total_price: total,
          down_payment: down,
          installment_count: n,
          installment_frequency: sale.installment_frequency,
          agreement_date: date,
          first_due_date: firstDue || date,
        })
      : [];

  return (
    <Modal
      open
      title="Sign the agreement"
      subtitle={`${sale.code} · ${sale.customer_name}`}
      icon={FileSignature}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !date || (n > 0 && !firstDue)}
            onClick={() =>
              run(async () => {
                await shareSalesApi.sign(sale.id, {
                  agreement_date: date,
                  first_due_date: n > 0 ? firstDue : null,
                  terms: changed
                    ? {
                        shares: count,
                        down_payment_pct: Number(downPct) || 0,
                        installment_count: n,
                      }
                    : null,
                  signing: {
                    place: place.trim(),
                    company_signatory: signatory.trim(),
                    witnesses: [witness1, witness2]
                      .map((w) => w.trim())
                      .filter(Boolean)
                      .map((name) => ({ name })),
                  },
                });
                await refresh();
              }, onClose)
            }
          >
            Sign and write the schedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Signed on" required error={fields.agreement_date}>
            <TextInput
              type="date"
              max={todayLocal()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field
            label="First installment due"
            required={n > 0}
            error={fields.first_due_date}
            hint={n === 0 ? 'No installments — the whole price is due at signing' : undefined}
          >
            <TextInput
              type="date"
              min={date}
              value={firstDue}
              onChange={(e) => setFirstDue(e.target.value)}
              disabled={n === 0}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-hairline p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            The plan, as agreed at the table
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Shares" error={fields.shares}>
              <TextInput
                type="number"
                min={1}
                value={shares}
                onChange={(e) => setShares(e.target.value)}
              />
            </Field>
            <Field label="Down payment (%)" error={fields.down_payment_pct}>
              <TextInput
                type="number"
                min={0}
                max={100}
                value={downPct}
                onChange={(e) => setDownPct(e.target.value)}
              />
            </Field>
            <Field label="Installments" error={fields.installment_count}>
              <TextInput
                type="number"
                min={0}
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
              />
            </Field>
          </div>
          {changed && (
            <p className="mt-2 text-xs text-amber-700">
              Different from the reservation — the price and the schedule are worked out again.
            </p>
          )}
        </div>

        {preview.length > 0 && (
          <div className="rounded-xl border border-admin-100 bg-admin-50/60 px-4 py-3 text-sm">
            <p className="font-semibold text-admin-700 tabular-nums">
              {formatBdt(total)} over {preview.length} payment{preview.length === 1 ? '' : 's'}
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-ink-muted">
              {preview.map((row) => (
                <li key={row.seq} className="flex justify-between gap-3 tabular-nums">
                  <span>{row.seq === 0 ? 'Down payment' : `Installment ${row.seq}`}</span>
                  <span>
                    {formatDate(row.due_date)} · {formatBdt(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Signed at" hint="Where the agreement was signed">
            <TextInput
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="e.g. Head office, Gulshan"
            />
          </Field>
          <Field label="Signed for the company by">
            <TextInput value={signatory} onChange={(e) => setSignatory(e.target.value)} />
          </Field>
          <Field label="Witness 1">
            <TextInput value={witness1} onChange={(e) => setWitness1(e.target.value)} />
          </Field>
          <Field label="Witness 2">
            <TextInput value={witness2} onChange={(e) => setWitness2(e.target.value)} />
          </Field>
        </div>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Money in
 * ------------------------------------------------------------------ */

/** Records money received. The server decides how it lands on the schedule. */
export function RecordPaymentModal({
  sale,
  onClose,
}: {
  sale: ApiShareSale;
  onClose: () => void;
}) {
  const refresh = useRefresh([shareSaleKeys.all, customerKeys.all]);
  const { error, fields, busy, run } = useAction();

  const due = sale.due_now > 0.5 ? sale.due_now : (sale.schedule.find((r) => r.status !== 'paid')?.remaining ?? 0);
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [amount, setAmount] = useState(String(Math.round(due)));
  const [method, setMethod] = useState<SharePaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const max = sale.outstanding + sale.late_fees;
  const typed = Math.round(Number(amount) || 0);

  return (
    <Modal
      open
      title="Record a payment"
      subtitle={`${sale.code} · ${sale.customer_name}`}
      icon={HandCoins}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || typed <= 0}
            onClick={() =>
              run(async () => {
                await shareSalesApi.pay(sale.id, {
                  paid_on: paidOn,
                  amount: typed,
                  method,
                  reference: reference.trim() || null,
                  notes: notes.trim() || null,
                });
                await refresh();
              }, onClose)
            }
          >
            Record {formatBdt(typed)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-hairline bg-slate-50/60 px-4 py-3 text-sm tabular-nums">
          <p className="text-ink-muted">
            Owed now: <strong className="text-ink">{formatBdt(sale.due_now)}</strong>
            {sale.late_fees > 0 && (
              <span className="text-amber-700"> (including {formatBdt(sale.late_fees)} late fee)</span>
            )}
          </p>
          <p className="text-xs text-ink-muted">
            Outstanding on the whole purchase: {formatBdt(sale.outstanding)}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received on" required error={fields.paid_on}>
            <TextInput
              type="date"
              max={todayLocal()}
              min={sale.agreement_date ?? undefined}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </Field>
          <Field label="Amount" required error={fields.amount} hint={`At most ${formatBdt(max)}`}>
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="How" required>
            <SelectInput
              value={method}
              onChange={(e) => setMethod(e.target.value as SharePaymentMethod)}
            >
              {SHARE_PAYMENT_METHODS.filter((m) => m !== 'profit_adjustment').map((m) => (
                <option key={m} value={m}>
                  {SHARE_PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Reference" error={fields.reference} hint="Cheque or transaction number">
            <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>

        <Field label="Note">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <p className="text-xs text-ink-muted">
          Late fees are cleared before the installment itself, oldest row first — and worked out as
          of the day the money arrived, not today.
        </p>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Putting things right
 * ------------------------------------------------------------------ */

/** Reverses a receipt — the only way to correct one. */
export function ReverseReceiptModal({
  sale,
  paymentId,
  onClose,
}: {
  sale: ApiShareSale;
  paymentId: string;
  onClose: () => void;
}) {
  const refresh = useRefresh([shareSaleKeys.all, customerKeys.all]);
  const { error, fields, busy, run } = useAction();
  const [reason, setReason] = useState('');
  const receipt = sale.payments.find((p) => p.id === paymentId);

  return (
    <Modal
      open
      title="Reverse this receipt"
      subtitle={receipt ? `${receipt.code} · ${formatBdt(receipt.amount)}` : undefined}
      icon={Undo2}
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
            onClick={() =>
              run(async () => {
                await shareSalesApi.reverse(sale.id, paymentId, reason.trim());
                await refresh();
              }, onClose)
            }
          >
            Reverse it
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        A receipt is never edited or deleted. This writes its opposite, with your reason, and the
        two stand together on the file — which is what makes the receipt book trustworthy.
      </p>
      <Field label="Why" required error={fields.reason}>
        <TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Recorded against the wrong purchase"
        />
      </Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

/** Releasing a hold, or ending a signed purchase. Both want a reason. */
export function ReasonModal({
  sale,
  action,
  onClose,
}: {
  sale: ApiShareSale;
  action: 'release' | 'cancel';
  onClose: () => void;
}) {
  const refresh = useRefresh([shareSaleKeys.all, shareOfferingKeys.all, customerKeys.all]);
  const { error, fields, busy, run } = useAction();
  const [note, setNote] = useState('');
  const releasing = action === 'release';

  return (
    <Modal
      open
      title={releasing ? 'Release these shares' : 'Cancel this purchase'}
      subtitle={`${sale.code} · ${sale.customer_name}`}
      icon={CalendarPlus}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            disabled={busy || (!releasing && note.trim().length < 3)}
            onClick={() =>
              run(async () => {
                await (releasing
                  ? shareSalesApi.release(sale.id, note.trim())
                  : shareSalesApi.cancel(sale.id, note.trim()));
                await refresh();
              }, onClose)
            }
          >
            {releasing ? 'Release' : 'Cancel the purchase'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        {releasing
          ? `${sale.shares} share${sale.shares === 1 ? '' : 's'} go back to the round and can be sold to somebody else.`
          : 'The agreement ends and the shares go back to the round. What has already been paid stays on the file — refunding it is money going out, recorded separately.'}
      </p>
      <Field label="Why" required={!releasing} error={fields.status_note}>
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorNote error={error} />
    </Modal>
  );
}
