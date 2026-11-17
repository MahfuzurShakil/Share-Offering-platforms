'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ChevronRight,
  CircleUserRound,
  Inbox,
  PieChart,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { CashFlowChart, Ring, type MonthFlow } from '@/components/admin/dashboard/charts';
import { useMockSession } from '@/lib/auth/mock-session';
import { canView } from '@/lib/domain/access';
import { SALE_HEALTH_META } from '@/lib/domain/share-sale';
import {
  bankAccountRepository,
  commissionLineRepository,
  commissionTotals,
  customerPortalInbox,
  fundOverview,
  paymentSubmissionInbox,
  profitDistributions,
  profitWithdrawalRepository,
  shareSaleOverview,
} from '@/lib/repositories';
import { cn } from '@/lib/utils/cn';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

function KpiTile({
  icon: Icon,
  tint,
  label,
  value,
  children,
  aside,
  href,
}: {
  icon: LucideIcon;
  tint: string;
  label: string;
  value: string;
  children?: React.ReactNode;
  aside?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <Card className="h-full transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', tint)}>
            <Icon className="size-4" />
          </span>
          <p className="truncate text-sm text-ink-muted">{label}</p>
        </div>
        {aside}
      </div>
      <p className="mt-3 text-[1.35rem] font-semibold leading-tight tracking-tight text-ink">{value}</p>
      {children && <div className="mt-1.5 space-y-0.5 text-xs text-ink-muted">{children}</div>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

const MONTHS_SHOWN = 6;

/** The last six months, oldest first, as `YYYY-MM`. */
function recentMonths(today: string): string[] {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = MONTHS_SHOWN - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * The opening screen: where the share sale stands today.
 *
 * Quotation §3.1 — capital raised against target per project, instalments
 * falling due and overdue, collections this month, profit distributed and
 * withdrawals waiting, and the queue of things somebody has to act on. What
 * each person sees is filtered by their role, so a sales lead and the managing
 * director open the same screen and get their own picture.
 */
export default function AdminDashboardPage() {
  const { role, userName } = useMockSession();
  const see = (module: Parameters<typeof canView>[1]) => canView(role, module);
  const seesMoney = see('dashboard') || see('finance_collection') || see('finance_expense');
  const today = todayLocal();
  const thisMonth = today.slice(0, 7);

  const overview = useLiveQuery(() => shareSaleOverview(today), [today]);
  const inbox = useLiveQuery(() => customerPortalInbox(), []);
  const submissions = useLiveQuery(() => paymentSubmissionInbox(), []);
  const withdrawals = useLiveQuery(() => profitWithdrawalRepository.getAll(), []);
  const distributions = useLiveQuery(() => profitDistributions(), []);
  const cash = useLiveQuery(() => bankAccountRepository.position(), []);
  const flows = useLiveQuery(() => bankAccountRepository.flows(), []);
  const fund = useLiveQuery(() => (seesMoney ? fundOverview() : Promise.resolve(null)), [seesMoney]);
  const commission = useLiveQuery(
    async () => commissionTotals(await commissionLineRepository.getAll()),
    [],
  );

  const totals = overview?.totals;
  const offerings = overview?.offerings ?? [];
  const sales = overview?.sales ?? [];

  /** Collected this month, from the payments the ledger holds. */
  const collectedThisMonth = sales
    .flatMap((s) => s.payments)
    .filter((p) => p.paid_on.startsWith(thisMonth))
    .reduce((t, p) => t + (Number(p.amount) || 0), 0);

  /** What falls due in the rest of this month, not yet paid. */
  const dueThisMonth = sales
    .flatMap((s) => s.schedule)
    .filter((i) => i.due_date.startsWith(thisMonth) && i.remaining > 0.5)
    .reduce((t, i) => t + i.remaining, 0);

  /** Everything on the market: what each open round's shares would raise in full. */
  const target = offerings.reduce(
    (t, o) => t + o.offering.total_shares * o.offering.price_per_share,
    0,
  );
  const raised = totals?.collected ?? 0;

  const overdueSales = sales
    .filter((s) => s.due_now > 0.5)
    .sort((a, b) => b.due_now - a.due_now)
    .slice(0, 6);

  const pendingRequests = (inbox?.requests ?? []).filter(
    (r) => r.request.status === 'new' || r.request.status === 'contacted',
  );
  const pendingSubmissions = (submissions ?? []).filter((r) => r.submission.status === 'submitted');
  const pendingWithdrawals = (withdrawals ?? []).filter((w) => w.status === 'requested');
  const declaredToDate = (distributions ?? []).reduce(
    (t, d) => t + d.customers_gross + d.owners_gross,
    0,
  );

  const months = recentMonths(today);
  const monthly: MonthFlow[] = months.map((month) => {
    const rows = (flows ?? []).filter((f) => f.date.startsWith(month));
    return {
      month,
      money_in: rows.filter((f) => f.amount > 0).reduce((t, f) => t + f.amount, 0),
      money_out: rows.filter((f) => f.amount < 0).reduce((t, f) => t - f.amount, 0),
    };
  });

  const queue: { label: string; count: number; href: string }[] = [
    { label: 'Share requests from the portal', count: pendingRequests.length, href: '/admin/share-sale/requests' },
    { label: 'Reported payments to check', count: pendingSubmissions.length, href: '/admin/share-sale/requests' },
    { label: 'Withdrawal requests', count: pendingWithdrawals.length, href: '/admin/share-sale/withdrawals' },
    { label: 'Commission earned, waiting approval', count: commission?.earned ?? 0, href: '/admin/sales-team/commissions' },
  ].filter((q) => q.count > 0);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Welcome back, {userName}</h1>
        <p className="mt-1 text-sm text-ink-muted">Where the share sale stands today — {formatDate(today)}.</p>
      </div>

      {overview === undefined ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile
              icon={PieChart}
              tint="bg-admin-50 text-admin-700"
              label="Capital raised"
              value={formatBdt(raised)}
              href="/admin/share-sale"
              aside={
                target > 0 ? <Ring pct={share(raised, target) ?? 0} size={44} /> : undefined
              }
            >
              <p>
                {target > 0
                  ? `of ${formatBdt(target)} on offer`
                  : 'No offering is open yet'}
              </p>
              <p>
                {totals?.shares_sold ?? 0} shares sold · {totals?.shares_reserved ?? 0} reserved
              </p>
            </KpiTile>

            <KpiTile
              icon={Receipt}
              tint="bg-emerald-50 text-emerald-700"
              label="Collected this month"
              value={formatBdt(collectedThisMonth)}
              href="/admin/share-sale/transactions"
            >
              <p>{formatBdt(dueThisMonth)} still falls due this month</p>
            </KpiTile>

            <KpiTile
              icon={AlertTriangle}
              tint={totals && totals.overdue > 0.5 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-ink-muted'}
              label="Overdue"
              value={totals && totals.overdue > 0.5 ? formatBdt(totals.overdue) : 'Nothing'}
              href="/admin/share-sale/investors?show=overdue"
            >
              <p>
                {totals?.overdue_sales ?? 0} purchase{(totals?.overdue_sales ?? 0) === 1 ? '' : 's'} behind ·{' '}
                {formatBdt(totals?.outstanding ?? 0)} outstanding in all
              </p>
            </KpiTile>

            <KpiTile
              icon={TrendingUp}
              tint="bg-blue-50 text-blue-700"
              label="Profit distributed"
              value={formatBdt(declaredToDate)}
              href="/admin/share-sale/profit"
            >
              <p>
                {pendingWithdrawals.length} withdrawal{pendingWithdrawals.length === 1 ? '' : 's'} waiting
              </p>
            </KpiTile>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0 space-y-5">
              <Card>
                <CardHeader
                  title="Offerings on the market"
                  subtitle="How much of each round is sold, reserved and still free"
                  action={
                    <Link href="/admin/share-sale" className="text-sm text-admin-700 hover:underline">
                      All offerings
                    </Link>
                  }
                />
                {offerings.length === 0 ? (
                  <EmptyState
                    icon={PieChart}
                    title="No offering yet"
                    description="Open a share offering on a project to start selling."
                  />
                ) : (
                  <ul className="space-y-3">
                    {offerings.slice(0, 5).map(({ offering, project, availability, collected }) => {
                      const all = offering.total_shares;
                      const sold = share(availability.sold, all) ?? 0;
                      const reserved = share(availability.reserved, all) ?? 0;
                      return (
                        <li key={offering.id}>
                          <Link
                            href={`/admin/share-sale/offerings/${offering.id}`}
                            className="block rounded-xl border border-hairline p-3 transition-colors hover:bg-admin-50/50"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium text-ink">
                                {project?.name ?? 'Project'}{' '}
                                <span className="text-ink-muted">· {offering.code}</span>
                              </p>
                              <p className="text-sm tabular-nums text-ink">{formatBdt(collected)} in</p>
                            </div>
                            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100">
                              <span className="bg-admin-500" style={{ width: `${sold}%` }} />
                              <span className="bg-amber-400" style={{ width: `${reserved}%` }} />
                            </div>
                            <p className="mt-1.5 text-xs text-ink-muted">
                              {availability.sold} sold · {availability.reserved} reserved ·{' '}
                              {availability.available} free of {all} shares
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Behind on payments"
                  subtitle="The investors to call first"
                  action={
                    <Link
                      href="/admin/share-sale/investors?show=overdue"
                      className="text-sm text-admin-700 hover:underline"
                    >
                      All dues
                    </Link>
                  }
                />
                {overdueSales.length === 0 ? (
                  <p className="text-sm text-ink-muted">Nobody is overdue today.</p>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {overdueSales.map((s) => (
                      <li key={s.sale.id}>
                        <Link
                          href={`/admin/share-sale/sales/${s.sale.id}`}
                          className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-ink">
                              {s.customer?.name ?? 'Investor'}
                            </span>
                            <span className="block text-xs text-ink-muted">
                              {s.sale.code} · {s.project?.name ?? '—'}
                              {s.next ? ` · due ${formatDate(s.next.due_date)}` : ''}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-sm font-semibold tabular-nums text-red-600">
                              {formatBdt(s.due_now)}
                            </span>
                            <Badge tone={SALE_HEALTH_META[s.health].tone}>
                              {SALE_HEALTH_META[s.health].label}
                            </Badge>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {seesMoney && (
                <Card>
                  <CardHeader title="Money in and out" subtitle="The last six months, across every account" />
                  <CashFlowChart data={monthly} />
                </Card>
              )}
            </div>

            <aside className="min-w-0 space-y-5">
              <Card>
                <CardHeader title="Waiting for someone" />
                {queue.length === 0 ? (
                  <p className="text-sm text-ink-muted">Nothing is waiting. </p>
                ) : (
                  <ul className="space-y-1.5">
                    {queue.map((q) => (
                      <li key={q.label}>
                        <Link
                          href={q.href}
                          className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-admin-50/60"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Inbox className="size-4 shrink-0 text-admin-600" />
                            <span className="truncate text-ink">{q.label}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <Badge tone="amber">{q.count}</Badge>
                            <ChevronRight className="size-4 text-ink-muted" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {seesMoney && (
                <Card>
                  <CardHeader title="Cash position" />
                  <p className="text-[1.35rem] font-semibold tracking-tight text-ink">
                    {formatBdt(cash?.total_balance ?? 0)}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    across {cash?.accounts.length ?? 0} account
                    {(cash?.accounts.length ?? 0) === 1 ? '' : 's'}
                  </p>
                  {fund && (
                    <div className="mt-3 space-y-1.5 border-t border-hairline pt-3 text-sm">
                      <p className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink-muted">
                          <Wallet className="size-3.5" /> Partners&apos; capital
                        </span>
                        <span className="tabular-nums text-ink">{formatBdt(fund.totals.capital)}</span>
                      </p>
                      <p className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink-muted">
                          <Banknote className="size-3.5" /> Loans taken
                        </span>
                        <span className="tabular-nums text-ink">{formatBdt(fund.totals.loans)}</span>
                      </p>
                    </div>
                  )}
                  <Link href="/admin/cash" className="mt-3 inline-flex text-sm text-admin-700 hover:underline">
                    Open Cash Position
                  </Link>
                </Card>
              )}

              <Card>
                <CardHeader title="Investors" />
                <p className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <Users className="size-3.5" /> Holding shares
                  </span>
                  <span className="tabular-nums text-ink">{totals?.customers ?? 0}</span>
                </p>
                <p className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <CalendarClock className="size-3.5" /> Open offerings
                  </span>
                  <span className="tabular-nums text-ink">{totals?.open_offerings ?? 0}</span>
                </p>
                <Link
                  href="/admin/customers"
                  className="mt-3 inline-flex items-center gap-1 text-sm text-admin-700 hover:underline"
                >
                  <CircleUserRound className="size-4" /> All customers
                </Link>
              </Card>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
