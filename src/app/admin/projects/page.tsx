'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Building2, CalendarDays, Globe, MapPin, Plus, Search, Star } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Checkbox, Field, SelectInput, TextInput } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination, usePagination } from '@/components/ui/Pagination';
import { ResultCard } from '@/components/ui/ResultCard';
import { ResultsLayout, ViewToggle, type ViewMode } from '@/components/ui/ViewToggle';
import {
  PROJECT_SALES_STATUS_META,
  PROJECT_STATUS_META,
  PROJECT_TYPE_LABEL,
  projectSalesStatus,
  projectShape,
  projectStatusLabel,
} from '@/lib/domain/project';
import { PROJECT_SALES_STATUSES, type ProjectSalesStatus } from '@/lib/db/types';
import { useApi } from '@/lib/api/use-api';
import { projectKeys, projectsApi } from '@/lib/api/projects';
import { formatDate } from '@/lib/utils/format';

type SortKey = 'newest' | 'oldest' | 'completion_soon' | 'name';

/** Project list — Design Reference A.7 (filter sidebar + result cards). */
export default function ProjectsListPage() {
  const [search, setSearch] = useState('');
  const [publicOnly, setPublicOnly] = useState(false);
  // QA audit P-09 — sales status is a key project fact, so it can be filtered
  const [sales, setSales] = useState<ProjectSalesStatus | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [view, setView] = useState<ViewMode>('list');

  /*
   * The filtering and the sorting happen in Postgres now, not in the browser:
   * a list that filters after it has fetched everything stops working at the
   * first few hundred rows, and `search` is a case-insensitive LIKE the
   * database can index. The pager below still pages what came back — the
   * server-paged lists are S3's batch — so the page size asked for is generous.
   */
  const query = {
    search: search.trim() || undefined,
    ...(publicOnly ? { is_public: true } : {}),
    ...(sales === 'all' ? {} : { sales_status: sales }),
    sort,
    page_size: 200,
  } as const;

  const projects = useApi(projectKeys.list(query), (signal) => projectsApi.list(query, signal));
  const rows = projects ?? [];

  /*
   * "No project yet" and "nothing matches these filters" are different things
   * to say, so the unfiltered count is asked for separately — one row, for its
   * total.
   */
  const anyPage = useApi(
    projectKeys.list({ page_size: 1 }),
    (signal) => projectsApi.page({ page_size: 1 }, signal),
  );

  const paged = usePagination(rows);

  const loading = projects === undefined;
  const hasAny = (anyPage?.meta.total ?? 0) > 0;
  const filtersActive =
    Boolean(search) || publicOnly || sales !== 'all';

  function resetFilters() {
    setSearch('');
    setSales('all');
    setPublicOnly(false);
  }

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Every development, from planning to handover: towers, plots or shares, with or without land yet."
        action={
          <Link href="/admin/projects/new">
            <Button>
              <Plus className="size-4" /> Add Project
            </Button>
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="min-w-0 space-y-5">
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-ink">Filters</h2>
            <div className="space-y-4">
              <Field label="Search">
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <TextInput
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Code, name, location…"
                    className="pr-9"
                  />
                </div>
              </Field>

              <Field label="Sales">
                <SelectInput
                  value={sales}
                  onChange={(e) => setSales(e.target.value as ProjectSalesStatus | 'all')}
                >
                  <option value="all">Any</option>
                  {PROJECT_SALES_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_SALES_STATUS_META[s].label}
                    </option>
                  ))}
                </SelectInput>
              </Field>

              <Checkbox
                label="Public website only"
                checked={publicOnly}
                onChange={(e) => setPublicOnly(e.target.checked)}
              />

              {filtersActive && (
                <Button variant="outline" size="sm" className="w-full" onClick={resetFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </Card>
        </aside>

        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">
              {loading
                ? 'Loading…'
                : `Showing ${rows.length} project${rows.length === 1 ? '' : 's'}`}
            </p>
            <div className="flex items-center gap-2">
              <ViewToggle value={view} onChange={setView} />
              <SelectInput
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="w-auto max-w-[12rem]"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="completion_soon">Completing soonest</option>
                <option value="name">Name A–Z</option>
              </SelectInput>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-2xl border border-hairline bg-white"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={hasAny ? 'No project matches these filters' : 'No project yet'}
              description={
                hasAny
                  ? 'Try clearing a filter or searching for a different code.'
                  : 'Create a project against an acquired or JV-signed land to start adding towers and units.'
              }
              action={
                hasAny ? (
                  <Button variant="outline" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Link href="/admin/projects/new">
                    <Button>
                      <Plus className="size-4" /> Add Project
                    </Button>
                  </Link>
                )
              }
            />
          ) : (
            <>
              <ResultsLayout view={view}>
                {paged.pageRows.map((project) => {
                  const meta = PROJECT_STATUS_META[project.status];
                  return (
                    <ResultCard
                      key={project.id}
                      href={`/admin/projects/${project.id}`}
                      view={view}
                      code={project.code}
                      title={project.name}
                      status={
                        <>
                          <Badge tone={meta.tone}>
                            {projectStatusLabel(project.status, projectShape(project.project_type))}
                          </Badge>
                          {project.is_featured && (
                            <Badge tone="amber">
                              <Star className="size-3.5" /> Featured
                            </Badge>
                          )}
                        </>
                      }
                      footer={`Added ${formatDate(project.created_at)}`}
                      facts={
                        <>
                          {project.location_summary && (
                            <Badge>
                              <MapPin className="size-3.5" />
                              {project.location_summary}
                            </Badge>
                          )}
                          <Badge>{PROJECT_TYPE_LABEL[project.project_type]}</Badge>
                          {project.expected_completion_date && (
                            <Badge>
                              <CalendarDays className="size-3.5" />
                              Completion {formatDate(project.expected_completion_date)}
                            </Badge>
                          )}
                          <Badge tone={PROJECT_SALES_STATUS_META[projectSalesStatus(project)].tone}>
                            {PROJECT_SALES_STATUS_META[projectSalesStatus(project)].label}
                          </Badge>
                          {/*
                            How much of each project is sold and what it raised
                            used to be computed here from the share tables. They
                            move to Postgres with the share-sale slice (S2) and
                            come back as fields on this list then, counted by
                            the database rather than by the browser.
                          */}
                          {project.is_public && (
                            <Badge tone="green">
                              <Globe className="size-3.5" /> Public
                            </Badge>
                          )}
                        </>
                      }
                    />
                  );
                })}
              </ResultsLayout>

              <Pagination
                page={paged.page}
                pageCount={paged.pageCount}
                pageSize={paged.pageSize}
                total={paged.total}
                from={paged.from}
                to={paged.to}
                onPageChange={paged.setPage}
                onPageSizeChange={paged.setPageSize}
                label="projects"
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
