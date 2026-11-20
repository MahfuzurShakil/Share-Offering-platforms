'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  HandCoins,
  Pencil,
  Printer,
  ReceiptText,
  UserCheck,
  UserMinus,
  XCircle,
} from 'lucide-react';
import { DetailTabs } from '@/components/admin/share-sale/bits';
import {
  CommissionSummary,
  LineStatusBadge,
  MarkLeftDialog,
  MemberFormModal,
  MoveMemberModal,
} from '@/components/admin/sales-team/parts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  commissionKeys,
  commissionsApi,
  orgKeys,
  orgMembersApi,
  payoutKeys,
  payoutsApi,
  type ApiCommissionLine,
  type ApiOrgMember,
} from '@/lib/api/sales-team';
import { useApi, useApiQuery, useRefresh } from '@/lib/api/use-api';
import { descendantsOf, SALE_KIND_LABEL } from '@/lib/domain/commission';
import { formatBdt, formatDate, formatPhone } from '@/lib/utils/format';

type Tab = 'statement' | 'team' | 'history' | 'payouts';
type Dialog = 'edit' | 'move' | 'left' | null;

const ALL_MEMBERS = { status: 'all' as const };

/** Who this member reports to, and who they report to, up to the top. */
function chainUp(member: ApiOrgMember, members: ApiOrgMember[]): ApiOrgMember[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const path: ApiOrgMember[] = [];
  const seen = new Set<string>([member.id]);
  let at = member.parent_id ? byId.get(member.parent_id) : undefined;
  while (at && !seen.has(at.id)) {
    path.unshift(at);
    seen.add(at.id);
    at = at.parent_id ? byId.get(at.parent_id) : undefined;
  }
  return path;
}

/** What a set of lines comes to, by status. */
function sum(lines: ApiCommissionLine[]) {
  const by = (status: ApiCommissionLine['status']) =>
    lines.filter((l) => l.status === status).reduce((total, l) => total + l.amount, 0);
  return { earned: by('earned'), approved: by('approved'), paid: by('paid') };
}

/**
 * One member: where they sit, their commission statement (plan §7.3), their
 * team and their payouts.
 *
 * The statement arrives grouped by sale and already totalled, and the
 * reporting history arrives with both ends named — the page used to walk the
 * whole tree and join three tables in the browser to show the same thing.
 */
export default function MemberPage() {
  const { id } = useParams<{ id: string }>();
  const refresh = useRefresh([orgKeys.all, commissionKeys.all, payoutKeys.all]);
  const [tab, setTab] = useState<Tab>('statement');
  const [dialog, setDialog] = useState<Dialog>(null);

  const { data: member, isError } = useApiQuery(orgKeys.one(id), (signal) =>
    orgMembersApi.get(id, signal),
  );
  const statement = useApi(orgKeys.statement(id), (signal) => orgMembersApi.statement(id, signal));
  const history = useApi(orgKeys.history(id), (signal) => orgMembersApi.history(id, signal));
  const members = useApi(orgKeys.list(ALL_MEMBERS), (signal) =>
    orgMembersApi.list(ALL_MEMBERS, signal),
  );
  const payouts = useApi(payoutKeys.list(id), (signal) => payoutsApi.list({ member_id: id }, signal));
  /** this member and their whole branch, so each team row shows its own total */
  const branchQuery = { team_of: id, page_size: 500 };
  const branch = useApi(commissionKeys.list(branchQuery), (signal) =>
    commissionsApi.list(branchQuery, signal),
  );

  if (isError) {
    return (
      <EmptyState
        icon={XCircle}
        title="Member not found"
        action={<Link href="/admin/sales-team/members">Back to members</Link>}
      />
    );
  }
  if (!member || !statement || !members) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  const path = chainUp(member, members);
  const totals = statement.totals;
  const teamIds = descendantsOf(member.id, members);
  const team = members.filter((m) => teamIds.includes(m.id));
  const branchLines = branch ?? [];

  return (
    <>
      <Link
        href="/admin/sales-team/members"
        className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-admin-700 print:hidden"
      >
        <ArrowLeft className="size-4" /> Members
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-ink">
            {member.name}
            <Badge tone="teal">{member.designation}</Badge>
            {member.status === 'left' && <Badge tone="amber">Left {formatDate(member.left_on)}</Badge>}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {member.code}
            {member.phone ? ` · ${formatPhone(member.phone)}` : ''} · joined{' '}
            {formatDate(member.joined_on)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {path.length
              ? `${path.map((p) => p.name).join(' → ')} → ${member.name}`
              : 'Top level'}
            {member.user_name ? ` · login: ${member.user_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" viewSafe onClick={() => window.print()}>
            <Printer className="size-4" /> Print statement
          </Button>
          {member.status === 'active' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog('edit')}>
                <Pencil className="size-4" /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog('move')}>
                <ArrowRightLeft className="size-4" /> Move
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog('left')}>
                <UserMinus className="size-4" /> Has left
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await orgMembersApi.rejoin(member.id);
                await refresh();
              }}
            >
              <UserCheck className="size-4" /> Rejoined
            </Button>
          )}
          {totals.approved > 0 && (
            <Link
              href={`/admin/sales-team/payouts?member=${member.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-admin-500 px-3 text-sm font-medium text-white hover:bg-admin-600"
            >
              <HandCoins className="size-4" /> Pay {formatBdt(totals.approved)}
            </Link>
          )}
        </div>
      </div>

      <div className="mb-5">
        <CommissionSummary totals={totals} />
      </div>

      <div className="print:hidden">
        <DetailTabs
          tabs={[
            { key: 'statement', label: `Statement (${statement.sales.length})` },
            { key: 'team', label: `Team (${team.length})` },
            { key: 'history', label: 'Reporting history' },
            { key: 'payouts', label: `Payouts (${payouts?.length ?? 0})` },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'statement' && (
        <div className="space-y-4">
          {statement.sales.length === 0 ? (
            <Card>
              <EmptyState
                icon={ReceiptText}
                title="No commission yet"
                description="Sales credited to this member, or to their team, appear here once a plan covers them."
              />
            </Card>
          ) : (
            statement.sales.map((s) => (
              <Card key={s.key} className="break-inside-avoid">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/admin/share-sale/sales/${s.share_sale_id}`}
                      className="font-semibold text-admin-700 hover:underline"
                    >
                      {s.sale_code}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {SALE_KIND_LABEL.share} · {s.customer_name ?? '—'} · {s.project_name ?? '—'} ·{' '}
                      {formatDate(s.sale_date)}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="text-ink-muted">
                      {s.role === 'seller'
                        ? 'Seller'
                        : `Override as ${s.designation_at_sale}`}{' '}
                      on {formatBdt(s.sale_amount)}
                    </p>
                    <p className="text-base font-semibold tabular-nums text-ink">
                      {formatBdt(s.total)}
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                        <th className="py-1.5 font-medium">Stage</th>
                        <th className="py-1.5 font-medium">Status</th>
                        <th className="py-1.5 font-medium">Released</th>
                        <th className="py-1.5 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.lines.map((l) => (
                        <tr key={l.id} className="border-b border-hairline/60 last:border-0">
                          <td className="py-2">{l.stage_label}</td>
                          <td className="py-2">
                            <LineStatusBadge status={l.status} toRecover={l.to_recover} />
                          </td>
                          <td className="py-2 text-ink-muted">
                            {l.earned_on
                              ? formatDate(l.earned_on)
                              : l.status === 'void'
                                ? (l.void_reason ?? '—')
                                : 'Still to come'}
                          </td>
                          <td className="py-2 text-right tabular-nums">{formatBdt(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'team' && (
        <Card>
          <CardHeader
            title="Team"
            subtitle={`Branch sales ${formatBdt(member.branch_sales)} · ${member.branch_sales_count} sale${
              member.branch_sales_count === 1 ? '' : 's'
            }`}
          />
          {team.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody reports to {member.name}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                    <th className="py-1.5 font-medium">Member</th>
                    <th className="py-1.5 font-medium">Reports to</th>
                    <th className="py-1.5 text-right font-medium">Own sales</th>
                    <th className="py-1.5 text-right font-medium">Commission earned</th>
                    <th className="py-1.5 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((t) => {
                    const theirs = sum(branchLines.filter((l) => l.member_id === t.id));
                    return (
                      <tr key={t.id} className="border-b border-hairline/60 last:border-0">
                        <td className="py-2">
                          <Link
                            href={`/admin/sales-team/members/${t.id}`}
                            className="font-medium text-admin-700 hover:underline"
                          >
                            {t.name}
                          </Link>
                          <span className="block text-xs text-ink-muted">{t.designation}</span>
                        </td>
                        <td className="py-2 text-ink-muted">{t.parent_name ?? 'Top level'}</td>
                        <td className="py-2 text-right tabular-nums">{formatBdt(t.own_sales)}</td>
                        <td className="py-2 text-right tabular-nums">
                          {formatBdt(theirs.earned + theirs.approved + theirs.paid)}
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatBdt(theirs.paid)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          <CardHeader
            title="Reporting history"
            subtitle="Commission on a sale follows the tree as it was on the sale date."
          />
          <ol className="space-y-3 text-sm">
            {(history ?? []).map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap justify-between gap-2 border-b border-hairline/60 pb-2 last:border-0"
              >
                <span>
                  From <span className="font-medium">{h.from_parent_name ?? 'Top level'}</span> to{' '}
                  <span className="font-medium">{h.to_parent_name ?? 'Top level'}</span>
                  {h.note && <span className="block text-xs text-ink-muted">{h.note}</span>}
                </span>
                <span className="text-ink-muted">{formatDate(h.effective_date)}</span>
              </li>
            ))}
            <li className="flex flex-wrap justify-between gap-2 text-ink-muted">
              <span>
                Joined{history?.length ? '' : `, reporting to ${member.parent_name ?? 'nobody'}`}
              </span>
              <span>{formatDate(member.joined_on)}</span>
            </li>
          </ol>
        </Card>
      )}

      {tab === 'payouts' && (
        <Card>
          <CardHeader title="Payouts" />
          {(payouts ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">No commission paid yet.</p>
          ) : (
            <ul className="divide-y divide-hairline text-sm">
              {(payouts ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-medium">{p.code}</span>
                    <span className="block text-xs text-ink-muted">
                      {formatDate(p.paid_on)} · {p.line_count} line{p.line_count === 1 ? '' : 's'}
                      {p.reference_no ? ` · ${p.reference_no}` : ''}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block font-semibold">{formatBdt(p.net)}</span>
                    <span className="block text-xs text-ink-muted">
                      {formatBdt(p.lines_total)}
                      {p.recovered > 0 && ` − ${formatBdt(p.recovered)} recovered`}
                      {p.tax_withheld > 0 && ` − ${formatBdt(p.tax_withheld)} tax`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {dialog === 'edit' && <MemberFormModal member={member} onClose={() => setDialog(null)} />}
      {dialog === 'move' && <MoveMemberModal member={member} onClose={() => setDialog(null)} />}
      {dialog === 'left' && <MarkLeftDialog member={member} onClose={() => setDialog(null)} />}
    </>
  );
}
