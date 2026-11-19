'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calculator, Equal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, MoneyInput, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { LATE_FEE_TYPES, type LateFeeType, type ShareFrequency } from '@/lib/db/types';
import { FREQUENCY_LABEL, LATE_FEE_TYPE_LABEL, addDays, closesOn, daysBetween, formatCrore, formatSharePct } from '@/lib/domain/share-sale';
import { fieldErrorsOf, messageOf } from '@/lib/api/client';
import { projectKeys, projectsApi } from '@/lib/api/projects';
import {
  shareOfferingKeys,
  shareOfferingsApi,
  type ApiShareOffering,
} from '@/lib/api/share-offerings';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { cn } from '@/lib/utils/cn';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

/** The form's state: every number as typed, so a half-typed field is not forced into a number. */
interface Draft {
  project_id: string;
  premium_mode: 'amount' | 'pct';
  premium_value: string;
  premium_pct: string;
  /** how many of the project's shares this round offers */
  total_shares: string;
  closes_on: string;
  min_shares: string;
  max_shares: string;
  min_down_payment_pct: string;
  max_installments: string;
  installment_frequency: ShareFrequency;
  late_fee_type: LateFeeType;
  late_fee_pct: string;
  late_fee_amount: string;
  grace_days: string;
  hold_days: string;
  notes: string;
}

/** How the premium is typed (feedback A1, round 2): a clear name for each choice. */
const PREMIUM_MODE_LABEL: Record<Draft['premium_mode'], string> = {
  amount: 'Fixed amount (BDT)',
  pct: 'Percentage of NAV (%)',
};

function fromOffering(o: ApiShareOffering | undefined, projectId: string | null): Draft {
  const today = todayLocal();
  return {
    project_id: o?.project_id ?? projectId ?? '',
    premium_mode: 'amount',
    premium_value: o ? String(o.premium_value) : '',
    premium_pct: '',
    total_shares: o ? String(o.total_shares) : '',
    // a draft saved before close dates keeps its day count, counted from today
    closes_on: o?.closes_on && o.closes_on > today ? o.closes_on : closesOn(today, o?.validity_days ?? 90),
    min_shares: o ? String(o.min_shares) : '1',
    max_shares: o ? String(o.max_shares) : '',
    min_down_payment_pct: o ? String(o.min_down_payment_pct) : '20',
    max_installments: o ? String(o.max_installments) : '20',
    installment_frequency: o?.installment_frequency ?? 'monthly',
    late_fee_type: o?.late_fee_type ?? 'pct_once',
    // switching a fixed-fee draft back to % starts from the usual 2%
    late_fee_pct: o && o.late_fee_type !== 'fixed_once' ? String(o.late_fee_pct) : '2',
    late_fee_amount: o?.late_fee_amount ? String(o.late_fee_amount) : '',
    grace_days: o ? String(o.grace_days) : '7',
    hold_days: o ? String(o.hold_days) : '7',
    notes: o?.notes ?? '',
  };
}

function Row({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-2 text-sm', strong && 'font-semibold text-ink')}>
      <span className={strong ? '' : 'text-ink-muted'}>{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

/**
 * New or draft share offering (client meeting, 2026-11-01):
 *   valuation = net asset value + premium
 *   then the % going to the market, how many shares, the day it closes,
 *   and the longest installment plan.
 * The summary on the right works the price out as the numbers are typed;
 * the buttons sit under the form, as on the other forms (feedback A4).
 */
export function OfferingForm({
  offering,
  projectId,
}: {
  offering?: ApiShareOffering;
  projectId?: string | null;
}) {
  const router = useRouter();
  const refresh = useRefresh([shareOfferingKeys.all]);
  const [d, setD] = useState<Draft>(() => fromOffering(offering, projectId ?? null));
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // an error belongs to the numbers it was about; editing any of them clears it
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setError('');
    setFields({});
  };

  /*
   * Every project is listed, not only the ones a round can be written
   * against: a dropdown that silently leaves a project out looks broken.
   * The ones that are not ready are disabled, with the reason beside them.
   */
  const projectQuery = { page_size: 200 } as const;
  const projects = useApi(projectKeys.list(projectQuery), (signal) =>
    projectsApi.list(projectQuery, signal),
  );
  const project = (projects ?? []).find((p) => p.id === d.project_id);
  /*
   * How many of the project's shares are still free is the server's answer: it
   * counts the project's other rounds, including what its closed ones sold.
   */
  const room = useApi(
    shareOfferingKeys.room(d.project_id, offering?.id),
    (signal) => shareOfferingsApi.room(d.project_id, offering?.id, signal),
    { enabled: Boolean(d.project_id) },
  );

  /*
   * What a share is comes from the project; this round only adds a premium.
   * The sums are the server's, repeated here so the price moves while somebody
   * types — `offeringMath` is not used, because the share size is not derived
   * from a percentage any more.
   */
  const nav = project?.valuation ?? 0;
  const sharePct = project?.share_pct ?? 0;
  const premium =
    d.premium_mode === 'pct' ? Math.round((nav * (Number(d.premium_pct) || 0)) / 100) : Number(d.premium_value) || 0;
  const shares = Math.floor(Number(d.total_shares) || 0);
  const m = {
    valuation: nav + premium,
    share_pct: sharePct,
    price_per_share: Math.round(((nav + premium) * sharePct) / 100),
    raise: 0,
  };
  m.raise = m.price_per_share * shares;
  const offeredPct = Number((shares * sharePct).toFixed(6));
  const free = room?.free ?? null;
  const ready = Boolean(project?.valuation && project?.total_shares);
  const maxShares = Number(d.max_shares) || 0;
  const n = Number(d.max_installments) || 0;
  const downPct = Number(d.min_down_payment_pct) || 0;
  const example = Math.max(1, Number(d.min_shares) || 1) * m.price_per_share;
  const exampleDown = Math.round((example * downPct) / 100);
  const today = todayLocal();
  const openDays = d.closes_on > today ? daysBetween(today, d.closes_on) + 1 : 0;
  const premiumPctOfNav = nav > 0 && premium > 0 ? Number(((premium / nav) * 100).toFixed(1)) : null;

  /** Switching how the premium is typed carries the number across, so the same premium shows the other way. */
  function premiumMode(mode: Draft['premium_mode']) {
    if (mode === 'pct') set('premium_pct', premiumPctOfNav !== null ? String(premiumPctOfNav) : '');
    else if (premium > 0) set('premium_value', String(premium));
    set('premium_mode', mode);
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const payload = {
          project_id: d.project_id,
          premium_value: premium,
          total_shares: shares,
          closes_on: d.closes_on,
          min_shares: Number(d.min_shares),
          max_shares: Number(d.max_shares),
          min_down_payment_pct: downPct,
          max_installments: Number(d.max_installments),
          installment_frequency: d.installment_frequency,
          late_fee_type: d.late_fee_type,
          late_fee_pct: Number(d.late_fee_pct),
          late_fee_amount: Number(d.late_fee_amount) || 0,
          grace_days: Number(d.grace_days),
          hold_days: Number(d.hold_days),
          notes: d.notes,
      };

      const saved = offering
        ? await shareOfferingsApi.update(offering.id, payload)
        : await shareOfferingsApi.create(payload);

      await refresh();
      router.push(`/admin/share-sale/offerings/${saved.id}`);
    } catch (e) {
      // the server names the term it refused, so it lands on that field
      setFields(fieldErrorsOf(e));
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="1. Project valuation"
            subtitle="What the project is worth and how many shares it is divided into are the project's own, set on its Valuation tab. A round may add a premium on top."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Project" required error={fields.project_id} className="md:col-span-2">
              <SelectInput
                value={d.project_id}
                onChange={(e) => set('project_id', e.target.value)}
                disabled={!!offering}
              >
                <option value="">Choose a project…</option>
                {(projects ?? []).map((p) => {
                  const why =
                    p.sales_status === 'not_open'
                      ? 'sales not open'
                      : !p.valuation || !p.total_shares
                        ? 'no valuation yet'
                        : p.shares_free === 0
                          ? 'every share is in a round'
                          : null;
                  return (
                    <option key={p.id} value={p.id} disabled={Boolean(why) && p.id !== d.project_id}>
                      {p.name} · {p.code}
                      {why ? ` — ${why}` : ''}
                    </option>
                  );
                })}
              </SelectInput>
            </Field>

            {project && !ready && (
              <p className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {project.sales_status === 'not_open'
                  ? 'This project is not selling yet. Open its sales on the project page first.'
                  : 'This project has no valuation yet.'}{' '}
                <Link
                  href={`/admin/projects/${project.id}`}
                  className="font-medium underline underline-offset-2"
                >
                  Open {project.name}
                </Link>
              </p>
            )}

            {project && ready && (
              <div className="md:col-span-2 rounded-xl border border-hairline bg-slate-50/60 px-4 py-3">
                <Row label="Project valuation (100%)" strong>
                  {formatBdt(project.valuation ?? 0)}
                </Row>
                <Row label="Divided into">
                  {project.total_shares} shares · {formatSharePct(sharePct)} each
                </Row>
                <Row label="Valued on">{formatDate(project.valuation_date)}</Row>
                <Row label="Still free to offer">
                  {free === null ? '—' : `${free} share${free === 1 ? '' : 's'}`}
                </Row>
                <p className="pt-2 text-xs text-ink-muted">
                  Fixed once a round of this project has been on the market, so a later
                  valuation cannot change what somebody already bought.
                </p>
              </div>
            )}

            <Field
              label="Premium over NAV"
              error={fields.premium_value}
              hint="Brand, location, expected income — what this round adds on top. Leave it empty to sell at the project's valuation."
              className="md:col-span-2"
            >
              <div className="flex items-start gap-2">
                <SelectInput
                  value={d.premium_mode}
                  onChange={(e) => premiumMode(e.target.value as Draft['premium_mode'])}
                  className="w-48 shrink-0"
                  aria-label="Enter the premium as"
                >
                  {(Object.keys(PREMIUM_MODE_LABEL) as Draft['premium_mode'][]).map((mode) => (
                    <option key={mode} value={mode}>
                      {PREMIUM_MODE_LABEL[mode]}
                    </option>
                  ))}
                </SelectInput>
                <div className="min-w-0 flex-1">
                  {d.premium_mode === 'amount' ? (
                    <MoneyInput
                      value={d.premium_value}
                      onChange={(e) => set('premium_value', e.target.value)}
                      placeholder="e.g. 250000000"
                    />
                  ) : (
                    <TextInput
                      type="number"
                      min="0"
                      step="0.1"
                      value={d.premium_pct}
                      onChange={(e) => set('premium_pct', e.target.value)}
                      placeholder="e.g. 25"
                    />
                  )}
                </div>
              </div>
              {premiumPctOfNav !== null && (
                <span className="mt-1 block text-xs font-medium text-admin-700">
                  {d.premium_mode === 'pct' ? `= ${formatBdt(premium)}` : `= ${premiumPctOfNav}% of NAV`}
                </span>
              )}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="2. Share offered to the market"
            subtitle={
              free !== null
                ? `${free} of ${project?.name ?? 'this project'}'s shares are still free to offer.`
                : 'How many of the project’s shares go on sale in this round, and for how long.'
            }
          />
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label="Shares offered in this round"
              required
              error={fields.total_shares}
              hint={
                shares > 0 && sharePct > 0
                  ? `${formatSharePct(offeredPct)} of the project`
                  : free !== null
                    ? `Up to ${free}`
                    : undefined
              }
            >
              <TextInput
                type="number"
                min="1"
                step="1"
                max={free ?? undefined}
                value={d.total_shares}
                onChange={(e) => set('total_shares', e.target.value)}
                placeholder="e.g. 500"
              />
            </Field>
            <Field label="Offer closes on" required error={fields.closes_on} hint={openDays ? `Open ${openDays} days if opened today` : 'Pick a day after today'}>
              <TextInput type="date" value={d.closes_on} min={addDays(today, 1)} max={addDays(today, 364)} onChange={(e) => set('closes_on', e.target.value)} />
            </Field>
            <Field label="Minimum shares per customer" required error={fields.min_shares}>
              <TextInput type="number" min="1" step="1" value={d.min_shares} onChange={(e) => set('min_shares', e.target.value)} />
            </Field>
            <Field label="Maximum shares per customer" required error={fields.max_shares} hint={maxShares > 0 && m.share_pct > 0 ? `${formatSharePct(maxShares * m.share_pct)} at most` : undefined}>
              <TextInput type="number" min="1" step="1" value={d.max_shares} onChange={(e) => set('max_shares', e.target.value)} placeholder="e.g. 25" />
            </Field>
            <Field label="Hold reserved shares (days)" required error={fields.hold_days} hint="Until the agreement is signed">
              <TextInput type="number" min="1" max="60" step="1" value={d.hold_days} onChange={(e) => set('hold_days', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="3. Payment plan limits" subtitle="The most a buyer may spread the price over. Each agreement can choose fewer installments or a bigger down payment." />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Minimum down payment (%)" required error={fields.min_down_payment_pct}>
              <TextInput type="number" min="0" max="100" step="1" value={d.min_down_payment_pct} onChange={(e) => set('min_down_payment_pct', e.target.value)} />
            </Field>
            <Field label="Maximum installments" required error={fields.max_installments} hint="After the down payment; 0 = full price at signing">
              <TextInput type="number" min="0" max="120" step="1" value={d.max_installments} onChange={(e) => set('max_installments', e.target.value)} />
            </Field>
            <Field label="Installment frequency" required>
              <SelectInput value={d.installment_frequency} onChange={(e) => set('installment_frequency', e.target.value as ShareFrequency)}>
                {(Object.keys(FREQUENCY_LABEL) as ShareFrequency[]).map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Late fee type" required hint="Charged once on each late installment, never on the down payment">
              <SelectInput value={d.late_fee_type} onChange={(e) => set('late_fee_type', e.target.value as LateFeeType)}>
                {LATE_FEE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LATE_FEE_TYPE_LABEL[t]}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {d.late_fee_type === 'fixed_once' ? (
              <Field label="Late fee (BDT)" required error={fields.late_fee_amount} hint="0 = no late fee">
                <MoneyInput value={d.late_fee_amount} onChange={(e) => set('late_fee_amount', e.target.value)} placeholder="e.g. 2000" />
              </Field>
            ) : (
              <Field label="Late fee (% of the installment)" required error={fields.late_fee_pct} hint="0 = no late fee">
                <TextInput type="number" min="0" max="25" step="0.5" value={d.late_fee_pct} onChange={(e) => set('late_fee_pct', e.target.value)} />
              </Field>
            )}
            <Field label="Grace days before the late fee" required error={fields.grace_days}>
              <TextInput type="number" min="0" step="1" value={d.grace_days} onChange={(e) => set('grace_days', e.target.value)} />
            </Field>
            <Field label="Notes" className="md:col-span-3">
              <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything the sales team should know about this offering" />
            </Field>
          </div>
        </Card>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto text-xs text-ink-muted">Saved as a draft. Open it from the next page when the numbers are agreed.</p>
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : offering ? 'Save draft' : 'Save as draft'}
          </Button>
        </div>
      </div>

      <div className="space-y-4 xl:sticky xl:top-20">
        <Card className="p-0">
          <div className="flex items-center gap-2 border-b border-hairline px-5 py-3.5">
            <Calculator className="size-4 text-admin-600" />
            <h2 className="text-sm font-semibold text-ink">Offer at a glance</h2>
          </div>
          <div className="px-5 py-3">
            <div className="mb-2 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 rounded-xl bg-canvas/70 p-3 text-center">
              <div>
                <p className="text-[11px] text-ink-muted">NAV</p>
                <p className="text-sm font-semibold tabular-nums">{nav ? formatCrore(nav) : '—'}</p>
              </div>
              <Plus className="size-3.5 text-ink-muted" />
              <div>
                <p className="text-[11px] text-ink-muted">Premium</p>
                <p className="text-sm font-semibold tabular-nums">{premium ? formatCrore(premium) : '—'}</p>
              </div>
              <Equal className="size-3.5 text-ink-muted" />
              <div>
                <p className="text-[11px] text-ink-muted">Valuation</p>
                <p className="text-sm font-semibold tabular-nums text-admin-700">{m.valuation ? formatCrore(m.valuation) : '—'}</p>
              </div>
            </div>
            {premiumPctOfNav !== null && premium > 0 && (
              <p className="mb-1 text-xs text-ink-muted">Premium is {premiumPctOfNav}% over NAV.</p>
            )}
            <div className="divide-y divide-hairline">
              <Row label="Offered to the market">
                {shares > 0 ? `${shares} shares · ${formatSharePct(offeredPct)}` : '—'}
              </Row>
              <Row label="Ownership per share">{m.share_pct ? formatSharePct(m.share_pct) : '—'}</Row>
              <Row label="Price per share" strong>
                {m.price_per_share ? formatBdt(m.price_per_share) : '—'}
              </Row>
              <Row label="Raises if every share sells" strong>
                {m.raise ? formatBdt(m.raise) : '—'}
              </Row>
              <Row label="Owner keeps after this round">
                {free !== null && shares > 0
                  ? `${Math.max(0, free - shares)} shares · ${formatSharePct(Math.max(0, free - shares) * sharePct)}`
                  : '—'}
              </Row>
              <Row label="Offer closes">{openDays ? `${formatDate(d.closes_on)} · ${openDays} days` : '—'}</Row>
            </div>
          </div>
          {m.price_per_share > 0 && (
            <div className="border-t border-hairline bg-canvas/50 px-5 py-3 text-xs text-ink-muted">
              <p className="font-semibold text-ink">Smallest purchase, longest plan</p>
              <p className="mt-1">
                {Number(d.min_shares) || 1} share{(Number(d.min_shares) || 1) > 1 ? 's' : ''} = {formatBdt(example)}: {formatBdt(exampleDown)} down
                {n > 0 ? `, then ${n} × ${formatBdt(Math.round((example - exampleDown) / n))} ${FREQUENCY_LABEL[d.installment_frequency].toLowerCase()}` : ' (paid in full)'}.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
