'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Receipt, Settings2 } from 'lucide-react';
import { Checkbox, Field, MoneyInput, SelectInput, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import {
  DISTRIBUTION_FREQUENCIES,
  ELIGIBILITY_RULES,
  LOSS_RULES,
  MGMT_FEE_TYPES,
  REVENUE_ENTRY_FREQUENCIES,
} from '@/lib/db/types';
import {
  DISTRIBUTION_FREQUENCY_LABEL,
  ELIGIBILITY_LABEL,
  ENTRY_FREQUENCY_LABEL,
  LOSS_RULE_LABEL,
  MGMT_FEE_LABEL,
} from '@/lib/domain/revenue-share';
import { useSession } from '@/lib/auth/session';
import { messageOf } from '@/lib/api/client';
import { accountKeys, accountsApi } from '@/lib/api/money';
import { lookupKeys, lookupsApi } from '@/lib/api/lookups';
import {
  revenueApi,
  revenueKeys,
  type ApiRevenuePolicy,
  type RevenuePolicyWrite,
} from '@/lib/api/revenue';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { bankAccountRepository, loanRepository, type LoanRow } from '@/lib/repositories';
import { cn } from '@/lib/utils/cn';
import { formatBdt, todayLocal } from '@/lib/utils/format';
import { FormError, ModalFooter } from './bits';

/**
 * The dialogs of the Income & Profit tab: the policy, and one income or cost
 * line.
 *
 * Both write through the API. What used to be here as well — a day sheet, a
 * close-period preview, the loan and loss-cover dialogs, and three withdrawal
 * dialogs — was a second, unreachable copy on the interim Dexie layer: the
 * screens that do those things were migrated and left these behind. They are
 * gone rather than kept, because dead code that still compiles is code a fix
 * can be applied to without anything changing on screen. The loan repayment
 * dialog stays, since the Loans screen has not moved yet and opens it.
 */

/** The API's own values: `any_time`, not the interim layer's `anytime`. */
const WITHDRAWAL_WINDOWS: ApiRevenuePolicy['withdrawal_window'][] = [
  'any_time',
  'after_declare',
  'day_of_month',
];

const WITHDRAWAL_WINDOW_LABEL: Record<ApiRevenuePolicy['withdrawal_window'], string> = {
  any_time: 'Any time',
  after_declare: 'Within N days of a declaration',
  day_of_month: 'On one day each month',
};

/** What a project starts with when revenue sharing is first turned on. */
const DEFAULT_POLICY: RevenuePolicyWrite = {
  entry_frequency: 'monthly',
  distribution_frequency: 'quarterly',
  first_period_start: todayLocal().slice(0, 8) + '01',
  reserve_pct: 0,
  mgmt_fee_type: 'none',
  mgmt_fee_value: 0,
  tax_withholding_pct: 0,
  loss_rule: 'recover_first',
  eligibility_rule: 'pro_rata_paid',
  prorate_days: true,
  repay_loans_first: false,
  min_withdrawal: 0,
  withdrawal_window: 'any_time',
  withdrawal_window_days: 0,
  adjust_overdue_first: true,
};

/** The account a movement went through, from the Money module. */
function AccountSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const accounts =
    useApi(accountKeys.list({ is_active: true }), (signal) =>
      accountsApi.list({ is_active: true }, signal),
    ) ?? [];
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

/* ---------------------------------------------------------------- settings */

/** Plan §2.1 — turning revenue sharing on, or changing how it works. */
export function PolicyModal({
  projectId,
  policy,
  onClose,
}: {
  projectId: string;
  policy?: ApiRevenuePolicy | null;
  onClose: () => void;
}) {
  const refresh = useRefresh([revenueKeys.all]);
  const [f, setF] = useState<RevenuePolicyWrite>(() => {
    if (!policy) return { ...DEFAULT_POLICY };
    /* the write shape is the read shape minus what the server owns */
    const write: RevenuePolicyWrite = {
      entry_frequency: policy.entry_frequency,
      distribution_frequency: policy.distribution_frequency,
      first_period_start: policy.first_period_start,
      reserve_pct: policy.reserve_pct,
      mgmt_fee_type: policy.mgmt_fee_type,
      mgmt_fee_value: policy.mgmt_fee_value,
      tax_withholding_pct: policy.tax_withholding_pct,
      loss_rule: policy.loss_rule,
      eligibility_rule: policy.eligibility_rule,
      prorate_days: policy.prorate_days,
      repay_loans_first: policy.repay_loans_first,
      min_withdrawal: policy.min_withdrawal,
      withdrawal_window: policy.withdrawal_window,
      withdrawal_window_days: policy.withdrawal_window_days,
      adjust_overdue_first: policy.adjust_overdue_first,
      notes: policy.notes,
    };
    return write;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof RevenuePolicyWrite>(k: K, v: RevenuePolicyWrite[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const num = (k: keyof RevenuePolicyWrite) => (e: { target: { value: string } }) =>
    set(k, Number(e.target.value) as never);

  async function save() {
    setError('');
    setBusy(true);
    try {
      await revenueApi.savePolicy(projectId, f);
      await refresh();
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
      size="lg"
      icon={Settings2}
      title={policy ? 'Revenue sharing settings' : 'Turn on revenue sharing'}
      subtitle="How income is recorded, how often profit is shared, and the rules for sharing it"
      onClose={onClose}
      footer={<ModalFooter busy={busy} onClose={onClose} onSave={save} label={policy ? 'Save settings' : 'Turn on'} />}
    >
      <div className="space-y-5">
        <Section title="Recording and sharing">
          <Field label="Income and cost are typed" hint="A hotel types every day; a rented building once a month.">
            <SelectInput value={f.entry_frequency} onChange={(e) => set('entry_frequency', e.target.value as never)}>
              {REVENUE_ENTRY_FREQUENCIES.map((k) => (
                <option key={k} value={k}>
                  {ENTRY_FREQUENCY_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Profit is shared" required>
            <SelectInput value={f.distribution_frequency} onChange={(e) => set('distribution_frequency', e.target.value as never)}>
              {DISTRIBUTION_FREQUENCIES.map((k) => (
                <option key={k} value={k}>
                  {DISTRIBUTION_FREQUENCY_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="First period starts" required hint="Usually the day the business opened.">
            <TextInput type="date" value={f.first_period_start} onChange={(e) => set('first_period_start', e.target.value)} />
          </Field>
        </Section>

        <Section title="Before anything is shared">
          <Field label="Past losses">
            <SelectInput value={f.loss_rule} onChange={(e) => set('loss_rule', e.target.value as never)}>
              {LOSS_RULES.map((k) => (
                <option key={k} value={k}>
                  {LOSS_RULE_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Reserve kept back (%)" hint="For repairs and bad months.">
            <TextInput type="number" min={0} max={100} value={f.reserve_pct} onChange={num('reserve_pct')} />
          </Field>
          <Field label="Management fee">
            <SelectInput value={f.mgmt_fee_type} onChange={(e) => set('mgmt_fee_type', e.target.value as never)}>
              {MGMT_FEE_TYPES.map((k) => (
                <option key={k} value={k}>
                  {MGMT_FEE_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          {f.mgmt_fee_type !== 'none' && (
            <Field label={f.mgmt_fee_type === 'fixed' ? 'Fee per period (Tk)' : 'Fee (%)'}>
              <TextInput type="number" min={0} value={f.mgmt_fee_value} onChange={num('mgmt_fee_value')} />
            </Field>
          )}
          <Checkbox
            className="sm:col-span-2"
            label="Set aside loan principal due in the period before sharing"
            checked={Boolean(f.repay_loans_first)}
            onChange={(e) => set('repay_loans_first', e.target.checked)}
          />
        </Section>

        <Section title="Who shares">
          <Field label="Customer holdings">
            <SelectInput value={f.eligibility_rule} onChange={(e) => set('eligibility_rule', e.target.value as never)}>
              {ELIGIBILITY_RULES.map((k) => (
                <option key={k} value={k}>
                  {ELIGIBILITY_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Tax withheld from each share (%)">
            <TextInput type="number" min={0} max={100} value={f.tax_withholding_pct} onChange={num('tax_withholding_pct')} />
          </Field>
          <Checkbox
            label="Count days held for shares bought mid-period"
            checked={Boolean(f.prorate_days)}
            onChange={(e) => set('prorate_days', e.target.checked)}
          />
          <Checkbox
            label="Pay overdue installments from the share first"
            checked={Boolean(f.adjust_overdue_first)}
            onChange={(e) => set('adjust_overdue_first', e.target.checked)}
          />
        </Section>

        <Section title="Customer withdrawals">
          <Field label="Minimum withdrawal (Tk)">
            <TextInput type="number" min={0} value={f.min_withdrawal} onChange={num('min_withdrawal')} />
          </Field>
          <Field label="Customers can ask">
            <SelectInput value={f.withdrawal_window} onChange={(e) => set('withdrawal_window', e.target.value as never)}>
              {WITHDRAWAL_WINDOWS.map((k) => (
                <option key={k} value={k}>
                  {WITHDRAWAL_WINDOW_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          {f.withdrawal_window !== 'any_time' && (
            <Field label={f.withdrawal_window === 'after_declare' ? 'Days open after a declaration' : 'Day of the month'}>
              <TextInput type="number" min={1} value={f.withdrawal_window_days} onChange={num('withdrawal_window_days')} />
            </Field>
          )}
        </Section>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- entries */

/** The client's own income and cost heads, from `lookup_values`. */
function useHeads() {
  const income =
    useApi(lookupKeys.category('revenue_income_head'), (signal) =>
      lookupsApi.options('revenue_income_head', null, signal),
    ) ?? [];
  const cost =
    useApi(lookupKeys.category('revenue_expense_head'), (signal) =>
      lookupsApi.options('revenue_expense_head', null, signal),
    ) ?? [];
  return { income: income.map((h) => h.value), cost: cost.map((h) => h.value) };
}

/** One income or cost line. */
export function EntryModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const refresh = useRefresh([revenueKeys.all]);
  const heads = useHeads();
  const [direction, setDirection] = useState<'income' | 'cost'>('income');
  const [head, setHead] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = direction === 'income' ? heads.income : heads.cost;

  async function save() {
    setError('');
    setBusy(true);
    try {
      await revenueApi.addEntry(projectId, {
        entry_date: date,
        direction,
        head,
        amount: Number(amount),
        account_id: accountId || null,
        reference_no: reference || null,
        notes: notes || null,
      });
      await refresh();
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
      icon={Receipt}
      title="Add income or cost"
      subtitle="Money the running business took in or paid out"
      onClose={onClose}
      footer={<ModalFooter busy={busy} onClose={onClose} onSave={save} label="Save" />}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['income', 'cost'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDirection(d);
                setHead('');
              }}
              className={cn(
                'rounded-xl border px-3 py-2.5 text-sm font-medium',
                direction === d ? 'border-admin-500 bg-admin-50 text-admin-700 ring-1 ring-admin-500' : 'border-hairline bg-white text-ink-muted',
              )}
            >
              {d === 'income' ? 'Income' : 'Cost'}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Head" required>
            <SelectInput value={head} onChange={(e) => setHead(e.target.value)}>
              <option value="">Pick…</option>
              {list.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Date" required>
            <TextInput type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Amount" required>
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={direction === 'income' ? 'Paid into' : 'Paid from'}>
            <AccountSelect value={accountId} onChange={setAccountId} />
          </Field>
          <Field label="Invoice / voucher no.">
            <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Note">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

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
