'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BriefcaseBusiness, Mail, PieChart, Phone, Plus, Search, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, SelectInput, TextInput } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination, usePagination } from '@/components/ui/Pagination';
import { ResultCard } from '@/components/ui/ResultCard';
import { ResultsLayout, ViewToggle, type ViewMode } from '@/components/ui/ViewToggle';
import { customerKeys, customersApi } from '@/lib/api/customers';
import { useApi } from '@/lib/api/use-api';
import { formatBdt, formatDate, formatPhone } from '@/lib/utils/format';

type SortKey = 'newest' | 'oldest' | 'name' | 'value_high' | 'holdings';
type HoldingState = 'any' | 'none' | 'active' | 'signed';

const EMPTY_FILTERS = {
  name: '',
  phone: '',
  nid: '',
  profession: '',
  holding_state: 'any' as HoldingState,
};

/**
 * Customer list — Design Reference A.7, profile-style cards (A.10).
 *
 * Phase 1 has one kind of customer: an investor holding project shares. The
 * prototype's Buyers / Investors tabs went with the flat-sale module.
 *
 * Filtering happens in Postgres, and what each investor holds arrives on the
 * row already added up. Two of the sorts are still done here, over the page
 * that came back: they sort by that roll-up, which is not a column — they
 * become server-side when this list is paged by the server (S3).
 */
export default function CustomersListPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('newest');
  const [view, setView] = useState<ViewMode>('grid');

  const set = <K extends keyof typeof EMPTY_FILTERS>(
    key: K,
    value: (typeof EMPTY_FILTERS)[K],
  ) => setFilters((f) => ({ ...f, [key]: value }));

  const query = {
    name: filters.name.trim() || undefined,
    phone: filters.phone.trim() || undefined,
    nid: filters.nid.trim() || undefined,
    profession: filters.profession.trim() || undefined,
    holding_state: filters.holding_state === 'any' ? undefined : filters.holding_state,
    sort: sort === 'oldest' || sort === 'name' ? sort : ('newest' as const),
    page_size: 200,
  };

  const customers = useApi(customerKeys.list(query), (signal) =>
    customersApi.list(query, signal),
  );

  /** "no customer yet" and "nothing matches" are different things to say */
  const anyPage = useApi(customerKeys.list({ page_size: 1 }), (signal) =>
    customersApi.page({ page_size: 1 }, signal),
  );

  const rows = [...(customers ?? [])];
  if (sort === 'value_high') rows.sort((a, b) => b.holdings.value - a.holdings.value);
  if (sort === 'holdings') rows.sort((a, b) => b.holdings.purchases - a.holdings.purchases);

  const paged = usePagination(rows);

  const loading = customers === undefined;
  const hasAny = (anyPage?.meta.total ?? 0) > 0;
  const filtersActive =
    Boolean(filters.name || filters.phone || filters.nid || filters.profession) ||
    filters.holding_state !== 'any';

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="The investors: one file per person, however many projects they hold shares in."
        action={
          <Link href="/admin/customers/new">
            <Button>
              <Plus className="size-4" /> Add Customer
            </Button>
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="min-w-0 space-y-5">
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-ink">Filters</h2>
            <div className="space-y-4">
              {/* one box per thing you might actually know about a buyer */}
              <Field label="Name / code / email">
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <TextInput
                    value={filters.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Kamrul"
                    className="pr-9"
                  />
                </div>
              </Field>

              <Field label="Phone">
                <TextInput
                  value={filters.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="e.g. 01866"
                />
              </Field>

              <Field label="NID">
                <TextInput
                  value={filters.nid}
                  onChange={(e) => set('nid', e.target.value)}
                  placeholder="e.g. 1985447"
                />
              </Field>

              <Field label="Profession">
                <TextInput
                  value={filters.profession}
                  onChange={(e) => set('profession', e.target.value)}
                  placeholder="e.g. Doctor"
                />
              </Field>

              <Field label="Shares held">
                <SelectInput
                  value={filters.holding_state}
                  onChange={(e) => set('holding_state', e.target.value as HoldingState)}
                >
                  <option value="any">Any</option>
                  <option value="active">Holds shares</option>
                  <option value="signed">Agreement signed</option>
                  <option value="none">Nothing held yet</option>
                </SelectInput>
              </Field>

              {filtersActive && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
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
                : `Showing ${rows.length} customer${rows.length === 1 ? '' : 's'}`}
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
                <option value="name">Name A–Z</option>
                <option value="value_high">Highest value</option>
                <option value="holdings">Most purchases</option>
              </SelectInput>
            </div>
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3 [&>*]:min-w-0">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-40 animate-pulse rounded-2xl border border-hairline bg-white"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title={hasAny ? 'No customer matches these filters' : 'No customer yet'}
              description={
                hasAny
                  ? 'Try a different name, phone number or NID.'
                  : 'An investor gets a file here before shares are reserved for them.'
              }
              action={
                hasAny ? (
                  <Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                ) : (
                  <Link href="/admin/customers/new">
                    <Button>
                      <Plus className="size-4" /> Add Customer
                    </Button>
                  </Link>
                )
              }
            />
          ) : (
            <>
              <ResultsLayout view={view}>
                {paged.pageRows.map((customer) => {
                  const m = customer.holdings;
                  return (
                    <ResultCard
                      key={customer.id}
                      href={`/admin/customers/${customer.id}`}
                      view={view}
                      // contact and booking facts are short, evenly sized
                      // labels — they fill a wide row rather than hugging its
                      // left edge, which is why only this list uses the row
                      // layout
                      listLayout="row"
                      code={customer.code}
                      title={customer.name}
                      subtitle={
                        customer.profession ? (
                          <span className="flex items-center gap-1.5">
                            <BriefcaseBusiness className="size-3" />
                            {customer.profession}
                          </span>
                        ) : undefined
                      }
                      leading={
                        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-admin-50 text-admin-600">
                          {m.purchases > 0 ? (
                            <PieChart className="size-5" />
                          ) : (
                            <UserRound className="size-5" />
                          )}
                        </span>
                      }
                      status={
                        m.purchases > 0 ? (
                          <Badge tone="blue">Investor</Badge>
                        ) : (
                          <Badge tone="amber">Nothing held yet</Badge>
                        )
                      }
                      footer={`Added ${formatDate(customer.created_at)}`}
                      /* contact on one side, booking facts spread across —
                         previously everything hugged the left of a wide row */
                      facts={
                        <>
                          <Badge>
                            <Phone className="size-3.5" />
                            {formatPhone(customer.phone)}
                          </Badge>
                          {customer.email && (
                            <Badge>
                              <Mail className="size-3.5" />
                              <span className="max-w-[14rem] truncate">{customer.email}</span>
                            </Badge>
                          )}
                          {customer.nid && <Badge>NID {customer.nid}</Badge>}
                          {m.purchases > 0 && (
                            <>
                              <Badge tone="teal">
                                {m.purchases} purchase{m.purchases === 1 ? '' : 's'} · {m.shares}{' '}
                                share{m.shares === 1 ? '' : 's'}
                              </Badge>
                              <Badge>{formatBdt(m.value)}</Badge>
                              <Badge tone="green">{formatBdt(m.paid)} paid</Badge>
                              {m.due > 0.5 && <Badge tone="amber">{formatBdt(m.due)} still due</Badge>}
                            </>
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
                label="customers"
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
