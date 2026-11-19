'use client';

import { useState } from 'react';
import { Lock, PieChart } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, MoneyInput, TextInput } from '@/components/ui/Field';
import { fieldErrorsOf, messageOf } from '@/lib/api/client';
import { projectKeys, projectsApi, type ApiProject } from '@/lib/api/projects';
import { useApiMutation } from '@/lib/api/use-api';
import { formatSharePct } from '@/lib/domain/share-sale';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

/**
 * What the project is worth, and into how many shares it is divided.
 *
 * It sits on the project rather than on each round because one share has to
 * mean the same fraction of the project in every round — otherwise two people
 * who each hold "ten shares" own different parts of the same thing, and no cap
 * table can be read. A round adds its own premium on top of this and offers
 * some of these shares.
 *
 * It is the owner's judgement, not a figure the platform can infer: this build
 * records no construction cost, and what a project cost is not what it is
 * worth. Once a round has been on the market it is fixed — people have been
 * shown a price worked out from it.
 */
export function ProjectValuationTab({
  project,
  mayEdit,
}: {
  project: ApiProject;
  mayEdit: boolean;
}) {
  const locked = project.valuation_locked;
  const [valuation, setValuation] = useState(project.valuation ? String(project.valuation) : '');
  const [shares, setShares] = useState(project.total_shares ? String(project.total_shares) : '');
  const [date, setDate] = useState(project.valuation_date ?? todayLocal());
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = useApiMutation(
    () =>
      projectsApi.update(project.id, {
        valuation: Number(valuation) || null,
        total_shares: Number(shares) || null,
        valuation_date: date || null,
      }),
    [projectKeys.all],
  );

  const typedValuation = Number(valuation) || 0;
  const typedShares = Math.floor(Number(shares) || 0);
  const perShare = typedShares > 0 ? Math.round(typedValuation / typedShares) : 0;
  const pctEach = typedShares > 0 ? 100 / typedShares : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFields({});
    try {
      await save.mutateAsync(undefined);
      setSaved(true);
    } catch (err) {
      setFields(fieldErrorsOf(err));
      setError(messageOf(err));
    }
  }

  if (locked) {
    return (
      <Card>
        <CardHeader
          title="Valuation"
          subtitle="Fixed: a round of shares in this project has been on the market."
        />
        <Row label="Project valuation (100%)" strong>
          {formatBdt(project.valuation ?? 0)}
        </Row>
        <Row label="Divided into">
          {project.total_shares} shares · {formatSharePct(project.share_pct ?? 0)} each
        </Row>
        <Row label="One share is worth">
          {formatBdt(Math.round((project.valuation ?? 0) / (project.total_shares || 1)))}
        </Row>
        <Row label="Valued on">{formatDate(project.valuation_date)}</Row>
        <Row label="In rounds already">
          {project.shares_offered} of {project.total_shares} shares
        </Row>

        <p className="mt-4 flex items-start gap-2 rounded-xl border border-hairline bg-slate-50/60 px-4 py-3 text-sm text-ink-muted">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            People have bought, or been offered, shares priced from this valuation. Changing it
            now would quietly reprice what they were promised. A project worth more today sells
            its next round at a <strong className="font-medium text-ink">premium</strong> instead,
            which is set on the round.
          </span>
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Valuation"
        subtitle="What 100% of this project is worth, and how many equal shares it is divided into. Set this before offering any shares."
      />

      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Project valuation (100%)"
            required
            error={fields.valuation}
            hint="The owner's judgement: land, building and what the project earns."
          >
            <MoneyInput
              value={valuation}
              onChange={(e) => {
                setValuation(e.target.value);
                setSaved(false);
              }}
              placeholder="e.g. 1000000000"
              disabled={!mayEdit}
            />
          </Field>
          <Field
            label="Total number of shares"
            required
            error={fields.total_shares}
            hint={pctEach > 0 ? `${formatSharePct(pctEach)} of the project each` : 'e.g. 1000'}
          >
            <TextInput
              type="number"
              min="1"
              step="1"
              value={shares}
              onChange={(e) => {
                setShares(e.target.value);
                setSaved(false);
              }}
              placeholder="e.g. 1000"
              disabled={!mayEdit}
            />
          </Field>
          <Field label="Valuation date" required error={fields.valuation_date}>
            <TextInput
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSaved(false);
              }}
              disabled={!mayEdit}
            />
          </Field>
        </div>

        {perShare > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-admin-100 bg-admin-50/60 px-4 py-3 text-sm">
            <PieChart className="size-4 text-admin-700" />
            <span className="text-ink-muted">
              One share ={' '}
              <strong className="font-semibold text-admin-700">{formatBdt(perShare)}</strong> and
              owns {formatSharePct(pctEach)} of the project
            </span>
            <span className="text-xs text-ink-muted">
              A round may sell it for more by adding a premium.
            </span>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && (
          <p className="text-sm text-emerald-700">
            Saved. Shares of this project can now be offered.
          </p>
        )}

        {mayEdit && (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save valuation'}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function Row({
  label,
  value,
  children,
  strong,
}: {
  label: string;
  value?: React.ReactNode;
  children?: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline py-2.5 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span
        className={`text-right text-sm text-ink ${strong ? 'font-semibold' : 'font-medium'} tabular-nums`}
      >
        {children ?? value ?? '—'}
      </span>
    </div>
  );
}
