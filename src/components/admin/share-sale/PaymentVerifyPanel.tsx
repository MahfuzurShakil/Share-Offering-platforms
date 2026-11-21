'use client';

import { useState } from 'react';
import { AlertTriangle, Banknote, Check, Eye, Landmark, X } from 'lucide-react';
import { AccountPicker } from '@/components/admin/finance/AccountPicker';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, MoneyInput, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { messageOf } from '@/lib/api/client';
import {
  OFFLINE_METHOD_LABEL,
  inboxKeys,
  submissionsApi,
  uploadFileUrl,
  type ApiPaymentSubmission,
  type PaymentSubmissionStatus,
} from '@/lib/api/inbox';
import { shareSaleKeys } from '@/lib/api/share-sales';
import { useApi, useApiMutation } from '@/lib/api/use-api';
import { formatBdt, formatDate, formatPhone, todayLocal } from '@/lib/utils/format';

/**
 * Slips customers have sent in, and what Accounts did about them
 * (SHARE-SALE-FEEDBACK-PLAN.md part C).
 *
 * Confirming one writes a real receipt on the **date on the slip**, which is
 * why the date and the amount can be corrected here: the bank statement is
 * what is true, and this is the person reading it.
 */

const META: Record<PaymentSubmissionStatus, { label: string; tone: BadgeTone }> = {
  submitted: { label: 'To check', tone: 'amber' },
  confirmed: { label: 'Confirmed', tone: 'green' },
  rejected: { label: 'Sent back', tone: 'red' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export function PaymentVerifyPanel({
  showAll,
  mayConfirm,
}: {
  showAll: boolean;
  mayConfirm: boolean;
}) {
  const query = showAll ? {} : { status: 'submitted' as const };
  const rows = useApi(inboxKeys.submissions(query), (signal) =>
    submissionsApi.list(query, signal),
  );
  const [confirming, setConfirming] = useState<ApiPaymentSubmission | null>(null);
  const [rejecting, setRejecting] = useState<ApiPaymentSubmission | null>(null);

  const columns: Column<ApiPaymentSubmission>[] = [
    {
      key: 'customer',
      header: 'Investor',
      cell: (s) => (
        <span className="block">
          <span className="block font-medium text-ink">{s.customer_name}</span>
          <span className="block text-xs whitespace-nowrap text-ink-muted tabular-nums">
            {formatPhone(s.customer_phone)}
          </span>
          <span className="block text-xs text-ink-muted">
            {s.sale_code} · {s.project_name}
          </span>
        </span>
      ),
      sortValue: (s) => s.customer_name,
    },
    {
      key: 'claim',
      header: 'Says they paid',
      cell: (s) => (
        <span className="block">
          <span className="block font-medium tabular-nums">{formatBdt(s.amount)}</span>
          <span className="block text-xs text-ink-muted">
            {OFFLINE_METHOD_LABEL[s.method]} · {formatDate(s.paid_on)}
          </span>
          <span className="block text-xs text-ink-muted">
            Ref {s.reference}
            {s.account_name ? ` · into ${s.account_name}` : ''}
          </span>
        </span>
      ),
      sortValue: (s) => s.amount,
    },
    {
      key: 'slip',
      header: 'Slip',
      cell: (s) =>
        s.slip_upload_id ? (
          <a
            href={uploadFileUrl(s.slip_upload_id)}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-admin-600 hover:underline"
          >
            <Eye className="size-4" /> Open
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="size-3.5" /> None attached
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => (
        <span className="block">
          <Badge tone={META[s.status].tone}>{META[s.status].label}</Badge>
          {s.receipt_no && (
            <span className="mt-1 block text-xs font-medium text-ink">{s.receipt_no}</span>
          )}
          {s.review_note && (
            <span className="mt-1 block max-w-56 text-xs text-ink-muted">{s.review_note}</span>
          )}
        </span>
      ),
      sortValue: (s) => s.status,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (s) =>
        mayConfirm && s.status === 'submitted' ? (
          <span className="flex flex-col items-end gap-1">
            <Button size="sm" onClick={() => setConfirming(s)}>
              <Check className="size-4" /> Confirm
            </Button>
            <Button size="sm" variant="dangerGhost" onClick={() => setRejecting(s)}>
              Send back
            </Button>
          </span>
        ) : null,
    },
  ];

  if (rows === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        label="submissions"
        emptyState={
          <EmptyState
            icon={Landmark}
            title="Nothing to check"
            description="When an investor says they deposited at the bank — from the Customer Portal or over the phone — it waits here until Accounts finds it on the statement."
          />
        }
        mobileCard={(s) => (
          <div className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <span>
                <span className="block font-medium text-ink">{s.customer_name}</span>
                <span className="block text-xs text-ink-muted">
                  {formatBdt(s.amount)} · {formatDate(s.paid_on)} · {s.sale_code}
                </span>
              </span>
              <Badge tone={META[s.status].tone}>{META[s.status].label}</Badge>
            </div>
            {mayConfirm && s.status === 'submitted' && (
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => setConfirming(s)}>
                  Confirm
                </Button>
                <Button size="sm" variant="dangerGhost" onClick={() => setRejecting(s)}>
                  Send back
                </Button>
              </div>
            )}
          </div>
        )}
      />

      {confirming && (
        <ConfirmSlipModal submission={confirming} onClose={() => setConfirming(null)} />
      )}
      {rejecting && (
        <RejectSlipModal submission={rejecting} onClose={() => setRejecting(null)} />
      )}
    </>
  );
}

/**
 * Confirming it against the statement.
 *
 * The amount and the date start as the customer claimed them and can be
 * corrected — a slip read wrong, or a deposit that cleared the next day. What
 * is saved is what the bank shows.
 */
function ConfirmSlipModal({
  submission,
  onClose,
}: {
  submission: ApiPaymentSubmission;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(submission.amount));
  const [paidOn, setPaidOn] = useState(submission.paid_on);
  const [accountId, setAccountId] = useState(submission.paid_into_account_id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const confirm = useApiMutation(
    () =>
      submissionsApi.confirm(submission.id, {
        amount: Number(amount),
        paid_on: paidOn,
        account_id: accountId || null,
        note: note.trim() || null,
      }),
    [inboxKeys.all, shareSaleKeys.all],
  );

  async function save() {
    setError('');
    try {
      await confirm.mutateAsync(undefined as never);
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  const changed =
    Number(amount) !== submission.amount || paidOn !== submission.paid_on;

  return (
    <Modal
      open
      title="Confirm this payment"
      subtitle={`${submission.code} · ${submission.customer_name} · ${submission.sale_code}`}
      icon={Banknote}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} viewSafe disabled={confirm.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={confirm.isPending}>
            {confirm.isPending ? 'Writing the receipt…' : 'Confirm and receipt it'}
          </Button>
        </>
      }
    >
      <p className="mb-4 rounded-xl border border-hairline bg-canvas p-3 text-xs text-ink-muted">
        The investor says {formatBdt(submission.amount)} went in on{' '}
        {formatDate(submission.paid_on)} by {OFFLINE_METHOD_LABEL[submission.method].toLowerCase()},
        reference {submission.reference}. Correct it here if the statement says otherwise.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount on the statement" required>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date it went in" required hint="The receipt is dated this day.">
          <TextInput
            type="date"
            value={paidOn}
            max={todayLocal()}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <AccountPicker value={accountId} onChange={setAccountId} label="Paid into" />
        </div>
        <div className="sm:col-span-2">
          <Field label="Note on the receipt">
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>

      {changed && (
        <p className="mt-3 text-xs text-amber-700">
          This differs from what the investor said. The receipt will show what you enter here.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** Not on the statement: sent back with a reason the customer reads. */
function RejectSlipModal({
  submission,
  onClose,
}: {
  submission: ApiPaymentSubmission;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const reject = useApiMutation(
    (note: string) => submissionsApi.reject(submission.id, note),
    [inboxKeys.all],
  );

  async function save() {
    setError('');
    if (!reason.trim()) {
      setError('Say why, so the customer can send the right slip.');
      return;
    }
    try {
      await reject.mutateAsync(reason.trim());
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Modal
      open
      title="Send this back"
      subtitle={`${submission.code} · ${submission.customer_name}`}
      icon={X}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} viewSafe disabled={reject.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={save} disabled={reject.isPending}>
            {reject.isPending ? 'Sending…' : 'Send back'}
          </Button>
        </>
      }
    >
      <Field label="What the investor is told" required>
        <TextArea
          value={reason}
          placeholder="e.g. Nothing of that amount on the statement for 5 January — please check the date on the slip"
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </Modal>
  );
}
