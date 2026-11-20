'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Building2,
  CalendarClock,
  Phone,
  Plus,
  Search,
  UserRound,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, SelectInput, TextInput } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination, usePagination } from '@/components/ui/Pagination';
import { ResultCard } from '@/components/ui/ResultCard';
import { ResultsLayout, ViewToggle, type ViewMode } from '@/components/ui/ViewToggle';
import { leadKeys, leadsApi, salesTeamApi, salesTeamKeys } from '@/lib/api/leads';
import { projectKeys, projectsApi } from '@/lib/api/projects';
import { useApi } from '@/lib/api/use-api';
import { LEAD_SOURCES, LEAD_STATUSES, type LeadSource, type LeadStatus } from '@/lib/db/types';
import {
  FOLLOW_UP_META,
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_META,
  followUpState,
} from '@/lib/domain/lead';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatPhone, todayLocal } from '@/lib/utils/format';

type SortKey = 'newest' | 'oldest' | 'follow_up' | 'name';

const PROJECT_PICKER = { page_size: 200, sort: 'name' as const };

/**
 * Lead list — Design Reference A.7, with the daily follow-up queue on top.
 *
 * Every row arrives ready to show: Postgres counts the activity, finds when
 * the lead was last touched and works out its open follow-up date, where the
 * prototype read the whole activity table into the browser to do the same.
 * The banner reads `/leads/summary`, which is the same queue the filters use —
 * counting raw follow-up dates here is what used to make this screen and the
 * dashboard disagree about how much work was outstanding.
 */
export default function LeadsListPage() {
  const today = todayLocal();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LeadStatus | 'all'>('all');
  const [source, setSource] = useState<LeadSource | 'all'>('all');
  const [assignedTo, setAssignedTo] = useState<string>('all');
  const [projectId, setProjectId] = useState('');
  const [followUp, setFollowUp] = useState<'all' | 'overdue' | 'today'>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [view, setView] = useState<ViewMode>('list');

  const query = {
    search: search.trim() || undefined,
    status: status === 'all' ? undefined : status,
    source: source === 'all' ? undefined : source,
    assigned_to: assignedTo === 'all' ? undefined : assignedTo,
    interested_project_id: projectId || undefined,
    follow_up: followUp === 'all' ? undefined : followUp,
    sort,
    today,
    page_size: 200,
  };

  const leads = useApi(leadKeys.list(query), (signal) => leadsApi.list(query, signal));
  const summary = useApi(leadKeys.summary(today), (signal) => leadsApi.summary(today, signal));
  const salesTeam = useApi(salesTeamKeys.all, (signal) => salesTeamApi.list(signal));
  const projects = useApi(projectKeys.list(PROJECT_PICKER), (signal) =>
    projectsApi.list(PROJECT_PICKER, signal),
  );

  const rows = leads ?? [];
  const paged = usePagination(rows);

  const loading = leads === undefined;
  const hasAny = (summary?.total ?? 0) > 0;
  const queue = {
    overdue: summary?.overdue ?? 0,
    dueToday: summary?.due_today ?? 0,
    unassigned: summary?.unassigned ?? 0,
  };
  const filtersActive =
    Boolean(search) ||
    status !== 'all' ||
    source !== 'all' ||
    assignedTo !== 'all' ||
    Boolean(projectId) ||
    followUp !== 'all';

  function resetFilters() {
    setSearch('');
    setStatus('all');
    setSource('all');
    setAssignedTo('all');
    setProjectId('');
    setFollowUp('all');
  }

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Inquiries from the website, WhatsApp, Facebook and walk-ins, through to booking or lost."
        action={
          <Link href="/admin/leads/new">
            <Button>
              <Plus className="size-4" /> Add Lead
            </Button>
          </Link>
        }
      />

      {(queue.overdue > 0 || queue.dueToday > 0 || queue.unassigned > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-white p-4 shadow-sm">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-admin-50 text-admin-600">
            <CalendarClock className="size-5" />
          </span>
          <p className="mr-auto text-sm text-ink">
            <span className="font-semibold">Today&apos;s follow-ups:</span>{' '}
            {queue.overdue > 0 && (
              <span className="text-red-600">{queue.overdue} overdue</span>
            )}
            {queue.overdue > 0 && queue.dueToday > 0 && ' · '}
            {queue.dueToday > 0 && (
              <span className="text-amber-600">{queue.dueToday} due today</span>
            )}
            {(queue.overdue > 0 || queue.dueToday > 0) && queue.unassigned > 0 && ' · '}
            {queue.unassigned > 0 && (
              <span className="text-ink-muted">{queue.unassigned} unassigned</span>
            )}
            {queue.overdue === 0 && queue.dueToday === 0 && queue.unassigned > 0 && (
              <span className="text-ink-muted"> — nothing to call today</span>
            )}
          </p>
          {queue.overdue > 0 && (
            <Button
              size="sm"
              variant={followUp === 'overdue' ? 'primary' : 'outline'}
              onClick={() => setFollowUp(followUp === 'overdue' ? 'all' : 'overdue')}
            >
              Show overdue
            </Button>
          )}
          {queue.dueToday > 0 && (
            <Button
              size="sm"
              variant={followUp === 'today' ? 'primary' : 'outline'}
              onClick={() => setFollowUp(followUp === 'today' ? 'all' : 'today')}
            >
              Show today
            </Button>
          )}
          {queue.unassigned > 0 && (
            <Button
              size="sm"
              variant={assignedTo === 'unassigned' ? 'primary' : 'outline'}
              onClick={() => setAssignedTo(assignedTo === 'unassigned' ? 'all' : 'unassigned')}
            >
              Show unassigned
            </Button>
          )}
        </div>
      )}

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
                    placeholder="Name, phone, code…"
                    className="pr-9"
                  />
                </div>
              </Field>

              <Field label="Status">
                <SelectInput
                  value={status}
                  onChange={(e) => setStatus(e.target.value as LeadStatus | 'all')}
                >
                  <option value="all">All statuses</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STATUS_META[s].label}
                    </option>
                  ))}
                </SelectInput>
              </Field>

              <Field label="Source">
                <SelectInput
                  value={source}
                  onChange={(e) => setSource(e.target.value as LeadSource | 'all')}
                >
                  <option value="all">All sources</option>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_SOURCE_LABEL[s]}
                    </option>
                  ))}
                </SelectInput>
              </Field>

              <Field label="Assigned To">
                <SelectInput value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="all">Everyone</option>
                  <option value="unassigned">Unassigned</option>
                  {(salesTeam ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>

              <Field label="Interested Project">
                <SelectInput value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">All projects</option>
                  {(projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>

              <Field label="Follow-up">
                <SelectInput
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value as 'all' | 'overdue' | 'today')}
                >
                  <option value="all">Any</option>
                  <option value="overdue">Overdue only</option>
                  <option value="today">Due today</option>
                </SelectInput>
              </Field>

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
              {loading ? 'Loading…' : `Showing ${rows.length} lead${rows.length === 1 ? '' : 's'}`}
            </p>
            <div className="flex items-center gap-2">
              <ViewToggle value={view} onChange={setView} />
              <SelectInput
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="w-auto max-w-[13rem]"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="follow_up">Follow-up soonest</option>
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
              icon={UserRound}
              title={hasAny ? 'No lead matches these filters' : 'No lead yet'}
              description={
                hasAny
                  ? 'Try clearing a filter or searching for a different name or number.'
                  : 'Add the first inquiry — website, WhatsApp or walk-in — to start tracking it.'
              }
              action={
                hasAny ? (
                  <Button variant="outline" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Link href="/admin/leads/new">
                    <Button>
                      <Plus className="size-4" /> Add Lead
                    </Button>
                  </Link>
                )
              }
            />
          ) : (
            <>
              <ResultsLayout view={view}>
                {paged.pageRows.map((lead) => {
                  const meta = LEAD_STATUS_META[lead.status];
                  const state = followUpState(lead.next_follow_up, today);

                  return (
                    <ResultCard
                      key={lead.id}
                      href={`/admin/leads/${lead.id}`}
                      view={view}
                      code={lead.code}
                      title={lead.name}
                      accent={cn(
                        state === 'overdue' && 'border-l-4 border-l-red-400',
                        state === 'today' && 'border-l-4 border-l-amber-400',
                      )}
                      status={
                        <>
                          {state !== 'none' && (
                            <Badge tone={FOLLOW_UP_META[state].tone}>
                              <CalendarClock className="size-3.5" />
                              {FOLLOW_UP_META[state].label}
                            </Badge>
                          )}
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </>
                      }
                      footer={
                        <>
                          Added {formatDate(lead.created_at)}
                          {/*
                            "Added" and "Follow-up" say when the lead arrived
                            and when it is next due — neither says when anyone
                            last touched it, which is how a sales manager spots
                            the ones going cold.
                          */}
                          {lead.last_activity_at
                            ? ` · Last activity ${formatDate(lead.last_activity_at)}`
                            : ' · No activity logged'}
                          {lead.next_follow_up && ` · Follow-up ${formatDate(lead.next_follow_up)}`}
                        </>
                      }
                      facts={
                        <>
                          <Badge>
                            <Phone className="size-3.5" />
                            {formatPhone(lead.phone)}
                          </Badge>
                          <Badge>{LEAD_SOURCE_LABEL[lead.source]}</Badge>
                          {lead.budget_range && (
                            <Badge>
                              <Wallet className="size-3.5" />
                              {lead.budget_range}
                            </Badge>
                          )}
                          {lead.project_name && (
                            <Badge tone="teal">
                              <Building2 className="size-3.5" />
                              {lead.project_name}
                            </Badge>
                          )}
                          <Badge tone={lead.assignee_name ? 'blue' : 'amber'}>
                            <UserRound className="size-3.5" />
                            {lead.assignee_name ?? 'Unassigned'}
                          </Badge>
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
                label="leads"
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
