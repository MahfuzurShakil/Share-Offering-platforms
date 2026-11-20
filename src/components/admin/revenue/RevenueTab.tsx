'use client';

import { useState } from 'react';
import { Banknote, CheckCircle2, Lock, Plus, Receipt, Send, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, MoneyInput, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { fieldErrorsOf, messageOf } from '@/lib/api/client';
import {
  revenueApi,
  revenueKeys,
  type ApiOpenPeriod,
  type ApiRevenuePeriod,
  type ApiRevenuePolicy,
  type Statement,
} from '@/lib/api/revenue';
import { useApi, useRefresh } from '@/lib/api/use-api';
import {
  DISTRIBUTION_FREQUENCY_LABEL,
  ELIGIBILITY_LABEL,
  LOSS_RULE_LABEL,
  MGMT_FEE_LABEL,
} from '@/lib/domain/revenue-share';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

/**
 * Income &amp; Profit — what the project earns, and what is shared out of it
 * (REVENUE-SHARE-PLAN.md).
 *
 * The tab shows nothing until somebody says how this project shares its
 * profit, which is how a project that only sells shares stays out of the
 * module entirely.
 *
 * The statement on every period — income, cost, past loss, reserve, fee,
 * what is left — is the server's, worked out through the shared domain code.
 * An open period is not a row anywhere: it is a date range and a sum, until
 * somebody closes it.
 */
export function RevenueTab({ projectId, mayEdit }: { projectId: string; mayEdit: boolean }) {
  const refresh = useRefresh([revenueKeys.all]);
  const [dialog, setDialog] = useState<'policy' | 'entry' | null>(null);
  const [approving, setApproving] = useState<ApiRevenuePeriod | null>(null);
  const [error, setError] = useState('');

  const view = useApi(revenueKeys.periods(projectId), (signal) =>
    revenueApi.periods(projectId, signal),
  );
  const entries = useApi(revenueKeys.entries(projectId), (signal) =>
    revenueApi.entries(projectId, { page_size: 100 }, signal),
  );

  if (view === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;

  const policy = view.policy;

  if (!policy) {
    return (
      <>
        <Card>
          <EmptyState
            icon={Banknote}
            title="This project does not share its profit yet"
            description="Say how often a profit period runs, how much is kept back as reserve, and who shares — then income and cost can be recorded against it."
            action={
              mayEdit ? <Button onClick={() => setDialog('policy')}>Set it up</Button> : undefined
            }
          />
        </Card>
        {dialog === 'policy' && (
          <PolicyModal
            projectId={projectId}
            policy={null}
            onClose={() => {
              setDialog(null);
              void refresh();
            }}
          />
        )}
      </>
    );
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Card>
        <CardHeader
          title="How the profit is shared"
          subtitle={`${DISTRIBUTION_FREQUENCY_LABEL[policy.distribution_frequency]} · since ${formatDate(policy.first_period_start)}`}
          action={
            mayEdit ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('policy')}>
                Change
              </Button>
            ) : undefined
          }
        />
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Line label="Reserve kept back">{policy.reserve_pct}% of the profit</Line>
          <Line label="Management fee">
            {MGMT_FEE_LABEL[policy.mgmt_fee_type]}
            {policy.mgmt_fee_type !== 'none' &&
              ` · ${policy.mgmt_fee_type === 'fixed' ? formatBdt(policy.mgmt_fee_value) : `${policy.mgmt_fee_value}%`}`}
          </Line>
          <Line label="Tax withheld on payouts">{policy.tax_withholding_pct}%</Line>
          <Line label="Past losses">{LOSS_RULE_LABEL[policy.loss_rule]}</Line>
          <Line label="Who shares">{ELIGIBILITY_LABEL[policy.eligibility_rule]}</Line>
          <Line label="Bought mid-period">
            {policy.prorate_days ? 'Counts the days held' : 'Shares from the record date'}
          </Line>
        </div>
      </Card>

      <Card className="p-0">
        <div className="px-5 pt-5">
          <CardHeader
            title="Profit periods"
            subtitle="A period is closed when it ends, approved when its figures are accepted, and declared when every holder's share is written."
          />
        </div>
        <div className="divide-y divide-hairline">
          {view.open.map((p) => (
            <PeriodRow
              key={p.period_start}
              label={p.label}
              dates={`${formatDate(p.period_start)} – ${formatDate(p.period_end)}`}
              statement={p}
              badge={<Badge tone={p.closable ? 'amber' : 'neutral'}>{p.closable ? 'Ready to close' : 'Running'}</Badge>}
              action={
                mayEdit && p.closable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act(() => revenueApi.close(projectId, p.period_start))}
                  >
                    <Lock className="size-4" /> Close
                  </Button>
                ) : undefined
              }
            />
          ))}

          {[...view.closed].reverse().map((p) => (
            <PeriodRow
              key={p.id}
              label={p.label}
              dates={`${formatDate(p.period_start)} – ${formatDate(p.period_end)}`}
              statement={p}
              declared={p.status !== 'closed' ? p.declared : undefined}
              badge={
                <Badge
                  tone={p.status === 'declared' ? 'green' : p.status === 'approved' ? 'blue' : 'neutral'}
                >
                  {p.status === 'declared'
                    ? `Declared ${formatDate(p.declared_on)}`
                    : p.status === 'approved'
                      ? 'Approved'
                      : 'Closed'}
                </Badge>
              }
              action={
                !mayEdit ? undefined : p.status === 'closed' ? (
                  <span className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => act(() => revenueApi.reopen(p.id))}>
                      <Undo2 className="size-4" /> Reopen
                    </Button>
                    <Button size="sm" onClick={() => setApproving(p)}>
                      <CheckCircle2 className="size-4" /> Approve
                    </Button>
                  </span>
                ) : p.status === 'approved' ? (
                  <Button size="sm" onClick={() => act(() => revenueApi.declare(p.id))}>
                    <Send className="size-4" /> Declare
                  </Button>
                ) : undefined
              }
              periodId={p.status === 'declared' ? p.id : undefined}
            />
          ))}

          {view.open.length === 0 && view.closed.length === 0 && (
            <div className="p-5">
              <EmptyState
                icon={Banknote}
                title="No period has started yet"
                description="Periods appear once the first one is under way."
              />
            </div>
          )}
        </div>
      </Card>

      <Card className="p-0">
        <div className="px-5 pt-5">
          <CardHeader
            title="Income &amp; cost"
            subtitle="What the project earned and what it cost to run. An entry inside a closed period cannot be changed; a correction goes in the open one."
            action={
              mayEdit ? (
                <Button size="sm" onClick={() => setDialog('entry')}>
                  <Plus className="size-4" /> Add
                </Button>
              ) : undefined
            }
          />
        </div>
        {entries === undefined ? (
          <p className="px-5 pb-5 text-sm text-ink-muted">Loading…</p>
        ) : entries.rows.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState icon={Receipt} title="Nothing recorded yet" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-y border-hairline bg-canvas/60 text-left text-xs text-ink-muted">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">What for</th>
                  <th className="px-3 py-2 text-right font-medium">Income</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-5 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {entries.rows.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2.5 tabular-nums">{formatDate(e.entry_date)}</td>
                    <td className="px-3 py-2.5">
                      {e.head}
                      {e.reference_no && (
                        <span className="block text-xs text-ink-muted">{e.reference_no}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">
                      {e.direction === 'income' ? formatBdt(e.amount) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600">
                      {e.direction === 'cost' ? formatBdt(e.amount) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {e.locked ? (
                        <span className="text-xs text-ink-muted">In a closed period</span>
                      ) : (
                        mayEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => act(() => revenueApi.removeEntry(e.id))}
                          >
                            Remove
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog === 'policy' && (
        <PolicyModal
          projectId={projectId}
          policy={policy}
          onClose={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {dialog === 'entry' && (
        <EntryModal
          projectId={projectId}
          onClose={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {approving && (
        <ApproveModal
          period={approving}
          onClose={() => {
            setApproving(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One period, with its statement
 * ------------------------------------------------------------------ */

function PeriodRow({
  label,
  dates,
  statement,
  badge,
  action,
  declared,
  periodId,
}: {
  label: string;
  dates: string;
  statement: Statement;
  badge: React.ReactNode;
  action?: React.ReactNode;
  declared?: number;
  periodId?: string;
}) {
  const [open, setOpen] = useState(false);
  const allocations = useApi(
    revenueKeys.allocations(periodId ?? ''),
    (signal) => revenueApi.allocations(periodId!, signal),
    { enabled: Boolean(periodId) && open },
  );

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)}>
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
            {label} {badge}
          </p>
          <p className="text-xs text-ink-muted">{dates}</p>
        </button>
        <span className="text-right text-sm tabular-nums">
          <span className="block font-semibold text-ink">
            {formatBdt(declared ?? statement.available)}
          </span>
          <span className="block text-xs text-ink-muted">
            {declared === undefined ? 'available to share' : 'declared'}
          </span>
        </span>
        {action}
      </div>

      {open && (
        <div className="mt-3 rounded-xl border border-hairline bg-slate-50/60 px-4 py-3 text-sm">
          <Line label="Income">{formatBdt(statement.income)}</Line>
          <Line label="Operating cost">− {formatBdt(statement.cost)}</Line>
          <Line label="Operating profit" strong>
            {formatBdt(statement.operating_profit)}
          </Line>
          {statement.loss_brought_in > 0 && (
            <Line label="Past loss recovered">− {formatBdt(statement.loss_brought_in)}</Line>
          )}
          {statement.reserve > 0 && <Line label="Reserve">− {formatBdt(statement.reserve)}</Line>}
          {statement.mgmt_fee > 0 && (
            <Line label="Management fee">− {formatBdt(statement.mgmt_fee)}</Line>
          )}
          <Line label="Available to share" strong>
            {formatBdt(statement.available)}
          </Line>
          {statement.loss_carried_out > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              {formatBdt(statement.loss_carried_out)} loss carried into the next period — nothing is
              shared until it is covered.
            </p>
          )}

          {periodId && (
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Who got what
              </p>
              {allocations === undefined ? (
                <p className="text-xs text-ink-muted">Loading…</p>
              ) : (
                <ul className="space-y-1">
                  {allocations.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3 text-xs tabular-nums">
                      <span>
                        {a.customer_name ?? 'The owners'}
                        <span className="text-ink-muted">
                          {' '}
                          · {a.ownership_pct}%
                          {a.eligibility_factor < 1 && ` × ${a.eligibility_factor}`}
                        </span>
                      </span>
                      <span>
                        {formatBdt(a.gross)}
                        <span className="text-ink-muted"> − {formatBdt(a.tax_withheld)} tax</span>
                        <strong className="ml-2 font-semibold text-emerald-700">
                          {formatBdt(a.net_credited)}
                        </strong>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Line({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 border-b border-hairline py-1.5 last:border-0 ${strong ? 'font-semibold text-ink' : ''}`}
    >
      <span className={strong ? '' : 'text-ink-muted'}>{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The three dialogs
 * ------------------------------------------------------------------ */

function PolicyModal({
  projectId,
  policy,
  onClose,
}: {
  projectId: string;
  policy: ApiRevenuePolicy | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const [frequency, setFrequency] = useState(policy?.distribution_frequency ?? 'quarterly');
  const [start, setStart] = useState(policy?.first_period_start ?? todayLocal());
  const [reserve, setReserve] = useState(String(policy?.reserve_pct ?? 10));
  const [feeType, setFeeType] = useState(policy?.mgmt_fee_type ?? 'none');
  const [feeValue, setFeeValue] = useState(String(policy?.mgmt_fee_value ?? 0));
  const [tax, setTax] = useState(String(policy?.tax_withholding_pct ?? 10));
  const [lossRule, setLossRule] = useState(policy?.loss_rule ?? 'recover_first');
  const [eligibility, setEligibility] = useState(policy?.eligibility_rule ?? 'pro_rata_paid');
  const [prorate, setProrate] = useState(policy?.prorate_days ?? true);

  return (
    <Modal
      open
      title={policy ? 'How the profit is shared' : 'Set up profit sharing'}
      subtitle="These rules decide every holder's share, so a closed period keeps the ones it was closed with."
      icon={Banknote}
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
              setFields({});
              try {
                await revenueApi.savePolicy(projectId, {
                  distribution_frequency: frequency,
                  first_period_start: start,
                  reserve_pct: Number(reserve) || 0,
                  mgmt_fee_type: feeType,
                  mgmt_fee_value: Number(feeValue) || 0,
                  tax_withholding_pct: Number(tax) || 0,
                  loss_rule: lossRule,
                  eligibility_rule: eligibility,
                  prorate_days: prorate,
                });
                onClose();
              } catch (e) {
                setFields(fieldErrorsOf(e));
                setError(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="A profit period runs" required>
          <SelectInput
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          >
            {(Object.keys(DISTRIBUTION_FREQUENCY_LABEL) as (typeof frequency)[]).map((k) => (
              <option key={k} value={k}>
                {DISTRIBUTION_FREQUENCY_LABEL[k]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field
          label="First period starts"
          required
          error={fields.first_period_start}
          hint="The day the project started earning"
        >
          <TextInput
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={Boolean(policy)}
          />
        </Field>
        <Field label="Reserve kept back (%)" error={fields.reserve_pct} hint="Repairs, sinking fund">
          <TextInput
            type="number"
            min="0"
            max="100"
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
          />
        </Field>
        <Field label="Tax withheld on payouts (%)" error={fields.tax_withholding_pct}>
          <TextInput
            type="number"
            min="0"
            max="100"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          />
        </Field>
        <Field label="Management fee">
          <SelectInput value={feeType} onChange={(e) => setFeeType(e.target.value as typeof feeType)}>
            {(Object.keys(MGMT_FEE_LABEL) as (typeof feeType)[]).map((k) => (
              <option key={k} value={k}>
                {MGMT_FEE_LABEL[k]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field
          label={feeType === 'fixed' ? 'Fee per period (BDT)' : 'Fee (%)'}
          error={fields.mgmt_fee_value}
        >
          {feeType === 'fixed' ? (
            <MoneyInput value={feeValue} onChange={(e) => setFeeValue(e.target.value)} />
          ) : (
            <TextInput
              type="number"
              min="0"
              value={feeValue}
              onChange={(e) => setFeeValue(e.target.value)}
              disabled={feeType === 'none'}
            />
          )}
        </Field>
        <Field label="Past losses">
          <SelectInput value={lossRule} onChange={(e) => setLossRule(e.target.value as typeof lossRule)}>
            {(Object.keys(LOSS_RULE_LABEL) as (typeof lossRule)[]).map((k) => (
              <option key={k} value={k}>
                {LOSS_RULE_LABEL[k]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Who shares">
          <SelectInput
            value={eligibility}
            onChange={(e) => setEligibility(e.target.value as typeof eligibility)}
          >
            {(Object.keys(ELIGIBILITY_LABEL) as (typeof eligibility)[]).map((k) => (
              <option key={k} value={k}>
                {ELIGIBILITY_LABEL[k]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Bought mid-period" className="sm:col-span-2">
          <SelectInput
            value={prorate ? 'days' : 'record'}
            onChange={(e) => setProrate(e.target.value === 'days')}
          >
            <option value="days">Count the days they held it</option>
            <option value="record">Share in full from the record date</option>
          </SelectInput>
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

function EntryModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const [date, setDate] = useState(todayLocal());
  const [direction, setDirection] = useState<'income' | 'cost'>('income');
  const [head, setHead] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <Modal
      open
      title="Income or cost"
      subtitle="One form, both directions. It lands in whichever period it falls in."
      icon={Receipt}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !head.trim() || !(Number(amount) > 0)}
            onClick={async () => {
              setBusy(true);
              setError('');
              setFields({});
              try {
                await revenueApi.addEntry(projectId, {
                  entry_date: date,
                  direction,
                  head: head.trim(),
                  amount: Number(amount),
                  reference_no: reference.trim() || null,
                  notes: notes.trim() || null,
                });
                onClose();
              } catch (e) {
                setFields(fieldErrorsOf(e));
                setError(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Record it
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" required error={fields.entry_date}>
          <TextInput
            type="date"
            max={todayLocal()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Which way" required>
          <SelectInput
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'income' | 'cost')}
          >
            <option value="income">Money in — income</option>
            <option value="cost">Money out — running cost</option>
          </SelectInput>
        </Field>
        <Field
          label="What for"
          required
          error={fields.head}
          hint={direction === 'income' ? 'e.g. Room rent, Shop rent' : 'e.g. Salary, Utilities'}
        >
          <TextInput value={head} onChange={(e) => setHead(e.target.value)} />
        </Field>
        <Field label="Amount" required error={fields.amount}>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reference" error={fields.reference_no} hint="Invoice or voucher number">
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

function ApproveModal({
  period,
  onClose,
}: {
  period: ApiRevenuePeriod;
  onClose: () => void;
}) {
  const [declared, setDeclared] = useState(String(Math.round(period.available)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const typed = Math.round(Number(declared) || 0);

  return (
    <Modal
      open
      title={`Approve ${period.label}`}
      subtitle="The figures are accepted, and this is how much of them will be shared."
      icon={CheckCircle2}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || typed < 0 || typed > period.available}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await revenueApi.approve(period.id, typed);
                onClose();
              } catch (e) {
                setError(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        {formatBdt(period.available)} is available after the reserve and the fee. Management may keep
        some of it back — a low season, a repair coming.
      </p>
      <Field label="Declare" required hint={`At most ${formatBdt(period.available)}`}>
        <MoneyInput value={declared} onChange={(e) => setDeclared(e.target.value)} />
      </Field>
      <p className="mt-3 text-xs text-ink-muted">
        Approving does not pay anybody yet. Declaring, next, fixes the record date and writes every
        holder&apos;s share — and that cannot be undone.
      </p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

export type { ApiOpenPeriod };
