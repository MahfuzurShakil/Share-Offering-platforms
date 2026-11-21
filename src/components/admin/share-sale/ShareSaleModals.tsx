'use client';

import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { closesOn, daysBetween } from '@/lib/domain/share-sale';
import {
  shareOfferingKeys,
  shareOfferingsApi,
  type ApiShareOffering,
} from '@/lib/api/share-offerings';
import { useRefresh } from '@/lib/api/use-api';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

export function ErrorNote({ error }: { error: string }) {
  return error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null;
}

export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: () => void) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

/*
 * The reserve, receipt and release dialogs used to live here, on the interim
 * Dexie layer. `SaleModals.tsx` is the same three against the share-sales API,
 * and is what the offering and purchase pages open — these were an unreachable
 * second copy, which is the dangerous kind: a fix to one of them would have
 * looked like it worked. What is left here is the offering dialogs, and
 * `ErrorNote` / `useAction`, which eight other screens import.
 */

/** Opens a draft from a chosen day until its close date — the one planned on the draft, which can still change here. */
export function OpenOfferingModal({ offering, onClose }: { offering: ApiShareOffering; onClose: () => void }) {
  const refresh = useRefresh([shareOfferingKeys.all]);
  const today = todayLocal();
  const [date, setDate] = useState(today);
  const [closes, setCloses] = useState(offering.closes_on && offering.closes_on >= today ? offering.closes_on : closesOn(today, offering.validity_days));
  const { error, busy, run } = useAction();
  const days = closes >= date ? daysBetween(date, closes) + 1 : 0;
  return (
    <Modal
      open
      title="Open this offering"
      subtitle={`${offering.total_shares} shares at ${formatBdt(offering.price_per_share)}`}
      icon={CalendarPlus}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !days} onClick={() =>
              run(async () => {
                await shareOfferingsApi.open(offering.id, { opens_on: date, closes_on: closes });
                await refresh();
              }, onClose)
            }>
            Open for sale
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opens on" required>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Closes on" required hint={days ? `Open for ${days} day${days === 1 ? '' : 's'}` : undefined} error={days ? undefined : 'Pick a day on or after the opening day'}>
          <TextInput type="date" value={closes} min={date} onChange={(e) => setCloses(e.target.value)} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-ink-muted">Once open, the price and terms are fixed. Customers who buy keep them, whatever later offerings charge.</p>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function ExtendOfferingModal({ offering, onClose }: { offering: ApiShareOffering; onClose: () => void }) {
  const refresh = useRefresh([shareOfferingKeys.all]);
  const [days, setDays] = useState('30');
  const { error, busy, run } = useAction();
  return (
    <Modal
      open
      title="Extend the validity"
      subtitle={`Now closes ${formatDate(offering.closes_on)}`}
      icon={CalendarPlus}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() =>
              run(async () => {
                await shareOfferingsApi.extend(offering.id, Number(days));
                await refresh();
              }, onClose)
            }>
            Extend
          </Button>
        </>
      }
    >
      <Field label="Extra days" required>
        <TextInput type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
      <ErrorNote error={error} />
    </Modal>
  );
}
