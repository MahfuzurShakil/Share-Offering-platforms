'use client';

import { useState } from 'react';
import { MessageSquareText, Ticket, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { messageOf } from '@/lib/api/client';
import {
  inboxKeys,
  requestsApi,
  uploadsApi,
  type ApiCustomerUpload,
  type ApiShareRequest,
} from '@/lib/api/inbox';
import { shareOfferingKeys } from '@/lib/api/share-offerings';
import { shareSaleKeys } from '@/lib/api/share-sales';
import { useApiMutation } from '@/lib/api/use-api';
import { formatBdt } from '@/lib/utils/format';
import { ErrorNote } from './ShareSaleModals';

export { UPLOAD_KIND_LABEL } from '@/lib/api/inbox';

/**
 * The three dialogs of the inbox: turning a request into a reservation,
 * noting what the office did about it, and sending a paper back.
 *
 * Each one writes through the API and then tells the queues, the offerings and
 * the purchases to refresh — a reservation changes all three at once, which is
 * why the keys are listed rather than left to the screen.
 */

/** Opens an uploaded paper in a new tab, behind its own permission check. */
export function openUpload(id: string) {
  window.open(`/api/v1/customer-uploads/${id}/file`, '_blank', 'noopener');
}

/**
 * The step that holds shares.
 *
 * The office may hold fewer than was asked for, and sets the plan — what was
 * typed on a phone is a starting point, not an agreement. The round's own
 * limits are checked by the server, so what comes back as a field error is
 * shown where it belongs.
 */
export function ReserveFromRequestModal({
  request,
  onClose,
}: {
  request: ApiShareRequest;
  onClose: () => void;
}) {
  const [shares, setShares] = useState(String(request.shares));
  const [downPct, setDownPct] = useState('20');
  const [installments, setInstallments] = useState(String(request.installments));
  const [error, setError] = useState('');

  const reserve = useApiMutation(
    (input: { shares: number; down_payment_pct: number; installment_count: number }) =>
      requestsApi.reserve(request.id, input),
    [inboxKeys.all, shareOfferingKeys.all, shareSaleKeys.all],
  );

  const n = Number(shares) || 0;
  const total = n * request.price_per_share;
  const down = Math.round((total * (Number(downPct) || 0)) / 100);
  const count = Number(installments) || 0;

  async function save() {
    setError('');
    try {
      await reserve.mutateAsync({
        shares: n,
        down_payment_pct: Number(downPct),
        installment_count: count,
      });
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Modal
      open
      title="Reserve from this request"
      subtitle={`${request.code} · ${request.name} · ${request.offering_code}`}
      icon={Ticket}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} viewSafe disabled={reserve.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={reserve.isPending}>
            {reserve.isPending ? 'Holding…' : `Hold ${n || ''} share${n === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {/* what is left of the round is the server's to judge, and it says so */}
        <Field label="Shares" required hint={`${request.shares} asked for`}>
          <TextInput
            type="number"
            min={1}
            value={shares}
            onChange={(e) => setShares(e.target.value)}
          />
        </Field>
        <Field label="Down payment (%)" required>
          <TextInput
            type="number"
            min={0}
            max={100}
            value={downPct}
            onChange={(e) => setDownPct(e.target.value)}
          />
        </Field>
        <Field label="Installments" required hint="0 = paid in full">
          <TextInput
            type="number"
            min={0}
            value={installments}
            onChange={(e) => setInstallments(e.target.value)}
          />
        </Field>
      </div>

      <p className="mt-4 rounded-xl border border-hairline bg-canvas p-3 text-sm text-ink">
        {formatBdt(total)} for {n} share{n === 1 ? '' : 's'}
        <span className="mt-1 block text-xs text-ink-muted">
          {formatBdt(down)} down
          {count > 0 ? `, then ${count} × ${formatBdt(Math.round((total - down) / count))}` : ' — the whole price at signing'}
        </span>
      </p>

      {request.note && (
        <p className="mt-3 text-xs text-ink-muted italic">“{request.note}”</p>
      )}

      <ErrorNote error={error} />
    </Modal>
  );
}

/** A note about the call, or the reason the request was declined. */
export function RequestNoteModal({
  request,
  kind,
  onClose,
}: {
  request: ApiShareRequest;
  kind: 'contacted' | 'decline';
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const move = useApiMutation(
    (input: { action: 'contacted' | 'declined'; note: string }) =>
      requestsApi.move(request.id, input.action, input.note || null),
    [inboxKeys.all],
  );

  const declining = kind === 'decline';

  async function save() {
    setError('');
    try {
      await move.mutateAsync({ action: declining ? 'declined' : 'contacted', note: note.trim() });
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Modal
      open
      title={declining ? 'Decline this request' : 'Note the call'}
      subtitle={`${request.code} · ${request.name}`}
      icon={declining ? X : MessageSquareText}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} viewSafe disabled={move.isPending}>
            Cancel
          </Button>
          <Button
            variant={declining ? 'danger' : 'primary'}
            onClick={save}
            disabled={move.isPending}
          >
            {move.isPending ? 'Saving…' : declining ? 'Decline' : 'Save note'}
          </Button>
        </>
      }
    >
      <Field
        label={declining ? 'Why' : 'What was said'}
        hint={
          declining
            ? 'The customer is told this, so write it for them.'
            : 'For whoever picks this up next.'
        }
      >
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

/** Sending a paper back. The reason is what the customer reads. */
export function RejectUploadModal({
  upload,
  onClose,
}: {
  upload: ApiCustomerUpload;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const reject = useApiMutation(
    (note: string) => uploadsApi.reject(upload.id, note),
    [inboxKeys.all],
  );

  const REASONS = [
    'The picture is too blurred to read',
    'The page with the account number is missing',
    'This is not the document asked for',
    'It has expired',
  ];

  async function save() {
    setError('');
    if (!reason.trim()) {
      setError('Say why, so the customer knows what to send instead.');
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
      subtitle={`${upload.title} · ${upload.customer_name}`}
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
      <Field label="Pick a reason, or write one">
        <SelectInput value="" onChange={(e) => e.target.value && setReason(e.target.value)}>
          <option value="">Choose…</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className="mt-3">
        <Field label="What the customer is told" required>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}
