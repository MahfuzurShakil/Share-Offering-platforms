'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Circle, ShoppingBag } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Checkbox } from '@/components/ui/Field';
import type { Project, ProjectSalesStatus } from '@/lib/db/types';
import {
  PROJECT_SALES_STATUS_META,
  SALES_MOVE_LABEL,
  projectSalesStatus,
} from '@/lib/domain/project';
import { projectRepository } from '@/lib/repositories';
import { websiteReadiness, type WebsiteReadinessItem } from '@/lib/repositories/public/project.public.repository';

const MOVE_QUESTION: Record<ProjectSalesStatus, string> = {
  open: 'Share offerings can be opened on this project from now on.',
  paused: 'No new share purchases until sales are opened again. Purchases already made are not affected.',
  sold_out: 'No new share purchases. Open sales again if a release puts shares back on the market.',
  not_open: '',
};

/**
 * Whether the project is selling.
 *
 * Phase 1: sales move on their own, with nothing to check them against. The
 * prototype gated this on the land being secured, the plan being approved and
 * every unit carrying a price — all of which belong to the land and
 * construction modules. What a share project is held to instead lives on the
 * offering: its valuation, price per share and how much of the round is left.
 */
export function ProjectSalesCard({ project }: { project: Project }) {
  const [target, setTarget] = useState<ProjectSalesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const website = useLiveQuery(() => websiteReadiness(project.id), [project.id, project.updated_at]);

  const current = projectSalesStatus(project);
  const meta = PROJECT_SALES_STATUS_META[current];
  const moves: ProjectSalesStatus[] =
    current === 'not_open'
      ? ['open']
      : current === 'open'
        ? ['paused', 'sold_out']
        : current === 'paused'
          ? ['open', 'sold_out']
          : ['open'];

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      await projectRepository.setSalesStatus(project.id, target);
      setTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Sales" action={<Badge tone={meta.tone}>{meta.label}</Badge>} />
        <p className="mb-3 text-xs text-ink-muted">
          {current === 'open'
            ? 'Selling. Shares can be offered and purchases recorded on this project.'
            : 'Not selling. The project is left out of new share offerings.'}
        </p>
        <div className="space-y-2">
          {moves.map((to) => (
            <Button
              key={to}
              size="sm"
              className="w-full"
              variant={to === 'open' ? 'primary' : 'outline'}
              onClick={() => setTarget(to)}
            >
              <ShoppingBag className="size-4" />
              {SALES_MOVE_LABEL[to]}
            </Button>
          ))}
        </div>
        {/*
          Publishing sits with selling (client walkthrough 2026-10-10): the
          public site shows projects an investor can buy into, so the switch
          only works once sales have opened.
        */}
        <div className="mt-4 space-y-2 border-t border-hairline pt-4">
          <Checkbox
            label="Show on the public website"
            checked={project.is_public}
            disabled={current === 'not_open' && !project.is_public}
            onChange={(e) =>
              projectRepository.update(project.id, {
                is_public: e.target.checked,
                ...(e.target.checked ? {} : { is_featured: false }),
              })
            }
          />
          <Checkbox
            label="Feature on the home page"
            checked={project.is_featured}
            disabled={!project.is_public}
            onChange={(e) => projectRepository.update(project.id, { is_featured: e.target.checked })}
          />
          {current === 'not_open' && !project.is_public && (
            <p className="text-xs text-ink-muted">Open sales first, then publish.</p>
          )}
        </div>
        {website && website.length > 0 && (
          <WebsiteChecklist items={website} published={project.is_public} />
        )}
      </Card>

      <ConfirmDialog
        open={target !== null}
        title={target ? SALES_MOVE_LABEL[target] : ''}
        subtitle={`${project.code} · ${project.name}`}
        icon={ShoppingBag}
        confirmLabel={target ? SALES_MOVE_LABEL[target] : 'Confirm'}
        message={target ? MOVE_QUESTION[target] : undefined}
        busy={busy}
        onCancel={() => {
          setTarget(null);
          setError('');
        }}
        onConfirm={confirm}
      >
        {error && <p className="text-sm text-red-600">{error}</p>}
      </ConfirmDialog>
    </>
  );
}

const WEBSITE_CHECK_LABEL: Record<WebsiteReadinessItem['key'], string> = {
  cover: 'Cover image',
  location: 'Location summary',
  gallery: 'At least one gallery image marked "Show on website"',
  priced_unit: 'An open share offering with a price',
  brochure: 'Brochure on the website (optional)',
};

/**
 * "Ready for the website" (Public Portal v2.0 §6.3). Warnings only: a project
 * can be published with gaps, the list just says what visitors will miss.
 */
function WebsiteChecklist({ items, published }: { items: WebsiteReadinessItem[]; published: boolean }) {
  const missing = items.filter((i) => !i.ok && !i.optional).length;
  return (
    <div className="mt-4 rounded-xl border border-hairline bg-slate-50/60 p-3">
      <p className="text-xs font-semibold text-ink">
        Ready for the website{' '}
        <span className={missing ? 'text-amber-700' : 'text-emerald-700'}>
          {missing ? `— ${missing} to fix${published ? ' (already live)' : ''}` : '— all set'}
        </span>
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-2 text-xs">
            {i.ok ? (
              <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-600" />
            ) : (
              <Circle
                className={`mt-px size-3.5 shrink-0 ${i.optional ? 'text-slate-400' : 'text-amber-600'}`}
              />
            )}
            <span className={i.ok ? 'text-ink-muted' : 'text-ink'}>{WEBSITE_CHECK_LABEL[i.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
