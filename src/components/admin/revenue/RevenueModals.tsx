'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote } from 'lucide-react';
import { Field, MoneyInput, SelectInput, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useSession } from '@/lib/auth/session';
import { messageOf } from '@/lib/api/client';
import { bankAccountRepository, loanRepository, type LoanRow } from '@/lib/repositories';
import { formatBdt, todayLocal } from '@/lib/utils/format';
import { FormError, ModalFooter } from './bits';

/**
 * One dialog: recording a loan repayment, for the Loans screen.
 *
 * Everything else that lived here — the policy and entry dialogs, a day sheet,
 * a close-period preview, the loan and loss-cover dialogs and three withdrawal
 * dialogs — was an unreachable second copy on the interim Dexie layer. The
 * screens that do those things define their own (`RevenueTab` has the policy
 * and entry dialogs, already on the API) and never imported these, so a fix
 * applied here would have changed nothing on screen. This one stays because
 * the Loans screen really does open it, and goes when Money moves.
 */

/* ------------------------------------------------------------------- loans */

/**
 * A loan repayment. Still on the interim layer, with the Loans screen that
 * opens it; it moves when the rest of Money does.
 */
export function RepayModal({ row, onClose }: { row: LoanRow; onClose: () => void }) {
  const { userId } = useSession();
  const [principal, setPrincipal] = useState(String(Math.min(row.outstanding, row.loan.monthly_instalment || row.outstanding)));
  const [interest, setInterest] = useState('0');
  const [date, setDate] = useState(todayLocal());
  const [accountId, setAccountId] = useState(row.loan.account_id);
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setError('');
    setBusy(true);
    try {
      await loanRepository.repay(
        row.loan.id,
        { paid_on: date, principal: Number(principal) || 0, interest: Number(interest) || 0, account_id: accountId, reference_no: reference || null },
        userId,
      );
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      icon={Banknote}
      title={`Repay ${row.loan.lender_name}`}
      subtitle={`${row.loan.code} · ${formatBdt(row.outstanding)} still owed`}
      onClose={onClose}
      footer={<ModalFooter busy={busy} onClose={onClose} onSave={save} label="Record repayment" />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Principal">
          <MoneyInput value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </Field>
        <Field label="Interest" hint="Also recorded as a running cost.">
          <MoneyInput value={interest} onChange={(e) => setInterest(e.target.value)} />
        </Field>
        <Field label="Paid on" required>
          <TextInput type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Paid from" required>
          <LegacyAccountSelect value={accountId} onChange={setAccountId} />
        </Field>
        <Field label="Reference" className="sm:col-span-2">
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * The account picker the repayment uses.
 *
 * It has to be the interim layer's own accounts: a loan row and its repayment
 * live there, and an id from Postgres would not match anything they can see.
 * It goes when the Loans screen does.
 */
function LegacyAccountSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const accounts = useLiveQuery(() => bankAccountRepository.options(), []) ?? [];
  return (
    <SelectInput value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pick an account…</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </SelectInput>
  );
}
