'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ArrowLeft, Globe, Pencil, Star, Trash2 } from 'lucide-react';
import { DocumentsPanel } from '@/components/admin/documents/DocumentsPanel';
import { ProjectGalleryPanel } from '@/components/admin/projects/ProjectGalleryPanel';
import { ProjectValuationTab } from '@/components/admin/projects/ProjectValuationTab';
import { ProjectSalesCard } from '@/components/admin/projects/ProjectSalesCard';
import { RevenueTab } from '@/components/admin/revenue/RevenueTab';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { ViewOnlyArea, ViewOnlyNotice } from '@/components/ui/ViewOnly';
import { useSession } from '@/lib/auth/session';
import { PROJECT_TYPE_LABEL } from '@/lib/domain/project';
import { projectKeys, projectsApi } from '@/lib/api/projects';
import { messageOf } from '@/lib/api/client';
import { useApi, useApiMutation } from '@/lib/api/use-api';
import { cn } from '@/lib/utils/cn';
import { formatBdt, formatDate } from '@/lib/utils/format';

type Tab = 'overview' | 'valuation' | 'revenue' | 'documents';

/** Kept beside the form's own copy; both read the API's values. */
const INCOME_TYPE_LABEL: Record<string, string> = {
  rent: 'Rent or lease income',
  resale: 'Selling the land or the units on',
  operation: 'A business run on it',
  mixed: 'More than one of these',
  undecided: 'Not decided yet',
};

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline py-2.5 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{value ?? '—'}</span>
    </div>
  );
}

/**
 * Project detail — Design Reference A.8 (sidebar cards + tabbed main column).
 *
 * Phase 1 is the share-sale build: a project is its master record, the income
 * and profit it earns, and its papers. The prototype's inventory, JV
 * allocation, stage-cost and pipeline-timeline tabs belong to the land and
 * construction modules and return in Phase 2.
 */
export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [confirmDelete, setConfirmDelete] = useState(false);
  // QA audit X-01 — viewing a project is not changing it (Section 9.6)
  const { can } = useSession();
  const mayEdit = can('project', 'edit');
  // opening and pausing sales is also the sales team's call
  const maySell = mayEdit || can('share_sale', 'edit');

  const project = useApi(projectKeys.one(id), (signal) => projectsApi.get(id, signal));
  const [deleteError, setDeleteError] = useState('');

  /*
   * A project with money against it is closed, not deleted — and the server is
   * what knows that, so the question is not asked up front any more: DELETE
   * answers 409 with the reason, which is shown in the dialog.
   */
  const remove = useApiMutation(() => projectsApi.remove(id), [projectKeys.all]);

  if (project === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!project) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">This project no longer exists.</p>
        <Link href="/admin/projects" className="mt-3 inline-block">
          <Button variant="outline" size="sm">
            <ArrowLeft className="size-4" /> Back to projects
          </Button>
        </Link>
      </Card>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    // what the project is worth and how many shares it is cut into: the thing
    // every share offering is priced from (PROJECT-SHARE-SALE-PLAN.md §4.1)
    { key: 'valuation', label: 'Valuation' },
    // REVENUE-SHARE-PLAN.md — a project that earns money shares its profit
    { key: 'revenue', label: 'Income & Profit' },
    { key: 'documents', label: 'Documents' },
  ];

  return (
    <>
      <Link
        href="/admin/projects"
        className="mb-4 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-admin-700"
      >
        <ArrowLeft className="size-4" /> Back to projects
      </Link>

      <PageHeader
        title={project.name}
        subtitle={`${project.code} · ${project.location_summary ?? PROJECT_TYPE_LABEL[project.project_type]}`}
        action={
          <div className="flex flex-wrap gap-2">
            {mayEdit && (
              <Link href={`/admin/projects/${project.id}/edit`}>
                <Button variant="outline">
                  <Pencil className="size-4" /> Edit
                </Button>
              </Link>
            )}
            {mayEdit && (
              <Button variant="dangerGhost" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
          </div>
        }
      />

      {!mayEdit && <ViewOnlyNotice what="project" />}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 lg:order-1">
          <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-hairline bg-white p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  tab === t.key
                    ? 'bg-admin-500 text-white'
                    : 'text-ink-muted hover:bg-admin-50 hover:text-admin-700',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <ViewOnlyArea readOnly={!mayEdit}>
            {tab === 'overview' && (
              <div className="space-y-5">
                <Card>
                  <CardHeader title="Project Information" />
                  <Row label="Name" value={project.name} />
                  <Row label="Code" value={project.code} />
                  <Row label="Type" value={PROJECT_TYPE_LABEL[project.project_type]} />
                  <Row label="Location summary" value={project.location_summary} />
                  <Row label="How it earns" value={INCOME_TYPE_LABEL[project.income_type]} />
                  <Row
                    label="Expected holding period"
                    value={
                      project.expected_hold_months
                        ? `${project.expected_hold_months} months`
                        : 'Open-ended'
                    }
                  />
                  {/* Scope v3 §3.3 — who runs this project */}
                  <Row label="Project manager" value={project.project_manager_name} />
                  <Row
                    label="Valuation"
                    value={
                      project.valuation
                        ? `${formatBdt(project.valuation)} · ${project.total_shares} shares`
                        : 'Not set yet'
                    }
                  />
                </Card>

                {(project.amenities.length > 0 || project.surroundings) && (
                  <Card>
                    <CardHeader title="Amenities & Surroundings" />
                    {project.amenities.length > 0 && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        {project.amenities.map((a) => (
                          <Badge key={a} tone="teal">
                            {a}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {project.surroundings && (
                      <p className="whitespace-pre-wrap text-sm text-ink-muted">
                        {project.surroundings}
                      </p>
                    )}
                  </Card>
                )}
              </div>
            )}

            {tab === 'valuation' && <ProjectValuationTab project={project} mayEdit={mayEdit} />}

            {tab === 'revenue' && <RevenueTab projectId={project.id} mayEdit={mayEdit} />}

            {tab === 'documents' && (
              <div className="space-y-5">
                {/*
                  Pictures first, because that is what a project is sold on, and
                  deliberately not a fourth tab.
                */}
                <Card>
                  <CardHeader title="Pictures" />
                  <p className="-mt-2 mb-4 text-sm text-ink-muted">
                    What the public website shows, and which one it leads with.
                  </p>
                  <ProjectGalleryPanel project={project} />
                </Card>

                <Card>
                  <CardHeader title="Documents" />
                  <DocumentsPanel entityType="project" entityId={project.id} />
                </Card>
              </div>
            )}
          </ViewOnlyArea>
        </div>

        <aside className="min-w-0 space-y-5 lg:order-2">
          {/* selling runs beside the project, not inside it */}
          <ViewOnlyArea readOnly={!maySell}>
            <ProjectSalesCard project={project} />
          </ViewOnlyArea>

          <Card>
            <CardHeader title="Public Website" />
            <div className="flex flex-wrap gap-2">
              <Badge tone={project.is_public ? 'green' : 'neutral'}>
                <Globe className="size-3.5" /> {project.is_public ? 'Published' : 'Not published'}
              </Badge>
              {project.is_featured && (
                <Badge tone="amber">
                  <Star className="size-3.5" /> Featured
                </Badge>
              )}
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              Only whitelisted fields reach the public portal — cost, margin and partner terms
              never leave the admin.
            </p>
          </Card>

          <Card>
            <CardHeader title="Record" />
            <Row label="Created" value={formatDate(project.created_at)} />
            <Row label="Last updated" value={formatDate(project.updated_at)} />
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${project.code}`}
        subtitle={project.name}
        confirmLabel="Delete project"
        message="This deletes the project with its documents. It cannot be undone."
        busy={remove.isPending}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteError('');
        }}
        onConfirm={async () => {
          setDeleteError('');
          try {
            await remove.mutateAsync(undefined);
            router.push('/admin/projects');
          } catch (error) {
            setDeleteError(messageOf(error));
          }
        }}
      >
        {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
      </ConfirmDialog>
    </>
  );
}
