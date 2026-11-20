'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { MemberFormModal } from '@/components/admin/sales-team/parts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterBar, FilterSelect } from '@/components/ui/FilterBar';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  designationKeys,
  designationsApi,
  orgKeys,
  orgMembersApi,
  type ApiOrgMember,
} from '@/lib/api/sales-team';
import { useApi } from '@/lib/api/use-api';
import { formatBdt, formatDate, formatPhone } from '@/lib/utils/format';

/*
 * The list comes back flat and already carries who each member reports to, how
 * big their team is and what they sold — the tree used to be walked here to
 * work all three out.
 */
type Row = ApiOrgMember;

/** Sales Team → Members: everyone in the organisation as a list, with who they report to. */
const ALL_MEMBERS = { status: 'all' as const };

export default function MembersPage() {
  const router = useRouter();
  const members = useApi(orgKeys.list(ALL_MEMBERS), (signal) =>
    orgMembersApi.list(ALL_MEMBERS, signal),
  );
  const designations = useApi(designationKeys.all, (signal) => designationsApi.list(signal));
  const [q, setQ] = useState('');
  const [designation, setDesignation] = useState('all');
  const [status, setStatus] = useState('active');
  const [link, setLink] = useState('all');
  const [adding, setAdding] = useState(false);

  if (!members) return <p className="text-sm text-ink-muted">Loading…</p>;

  const rows: Row[] = members;
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (designation !== 'all' && r.designation_id !== designation) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (link === 'user' && !r.user_id) return false;
    if (link === 'partner' && !r.partner_id) return false;
    if (link === 'agent' && (r.user_id || r.partner_id)) return false;
    return (
      !needle ||
      `${r.name} ${r.code} ${r.phone ?? ''} ${r.parent_name ?? ''}`.toLowerCase().includes(needle)
    );
  });
  const filtered = Boolean(needle || designation !== 'all' || status !== 'active' || link !== 'all');

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Member',
      cell: (r) => (
        <span className="block">
          <span className="block font-medium text-ink">{r.name}</span>
          <span className="block text-xs text-ink-muted">
            {r.code}
            {r.phone ? ` · ${formatPhone(r.phone)}` : ''}
          </span>
        </span>
      ),
      sortValue: (r) => r.name,
    },
    { key: 'designation', header: 'Designation', cell: (r) => r.designation, sortValue: (r) => r.rank },
    { key: 'parent', header: 'Reports to', cell: (r) => r.parent_name ?? <span className="text-ink-muted">Top level</span>, sortValue: (r) => r.parent_name ?? '' },
    {
      key: 'link',
      header: 'Linked to',
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.user_name && <Badge tone="neutral">Login · {r.user_name}</Badge>}
          {r.partner_id && <Badge tone="blue">Partner</Badge>}
          {!r.user_name && !r.partner_id && (
            <span className="text-xs text-ink-muted">Outside agent</span>
          )}
        </span>
      ),
    },
    { key: 'team', header: 'Team', align: 'right', cell: (r) => r.team_size, sortValue: (r) => r.team_size },
    { key: 'sales', header: 'Own sales', align: 'right', cell: (r) => <span className="tabular-nums">{formatBdt(r.own_sales)}</span>, sortValue: (r) => r.own_sales },
    {
      key: 'joined',
      header: 'Joined',
      cell: (r) => (
        <span className="block">
          <span className="block whitespace-nowrap">{formatDate(r.joined_on)}</span>
          {r.status === 'left' && (
            <span className="block text-xs text-amber-700">Left {formatDate(r.left_on)}</span>
          )}
        </span>
      ),
      sortValue: (r) => r.joined_on,
    },
  ];

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Everyone in the sales organisation — staff, partners and outside agents."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add member
          </Button>
        }
      />
      <Card>
        <FilterBar
          search={{ value: q, onChange: setQ, placeholder: 'Name, code, phone or lead…' }}
          onReset={() => {
            setQ('');
            setDesignation('all');
            setStatus('active');
            setLink('all');
          }}
          isFiltered={filtered}
          resultLabel={`${shown.length} of ${rows.length} members`}
        >
          <FilterSelect label="Designation" value={designation} onChange={(e) => setDesignation(e.target.value)}>
            <option value="all">All designations</option>
            {(designations ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.value}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="left">Left</option>
            <option value="all">Everyone</option>
          </FilterSelect>
          <FilterSelect label="Linked to" value={link} onChange={(e) => setLink(e.target.value)}>
            <option value="all">Anyone</option>
            <option value="user">Has a login</option>
            <option value="partner">Company partner</option>
            <option value="agent">Outside agent</option>
          </FilterSelect>
        </FilterBar>
        <DataTable
          rows={shown}
          columns={columns}
          label="members"
          initialSort={{ key: 'designation' }}
          onRowClick={(r) => router.push(`/admin/sales-team/members/${r.id}`)}
          emptyState={<EmptyState icon={Users} title={filtered ? 'Nobody matches' : 'No members yet'} description={filtered ? 'Change or reset the filters.' : 'Add the founders first, then their teams.'} />}
          mobileCard={(r) => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <span>
                  <span className="block font-medium text-ink">{r.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {r.designation} · {r.code}
                  </span>
                </span>
                <span className="text-right text-xs tabular-nums">
                  <span className="block font-semibold text-ink">{formatBdt(r.own_sales)}</span>
                  <span className="block text-ink-muted">team {r.team_size}</span>
                </span>
              </div>
              <p className="text-xs text-ink-muted">Reports to {r.parent_name ?? 'nobody (top level)'}</p>
            </div>
          )}
        />
      </Card>
      {adding && <MemberFormModal onClose={(saved) => (setAdding(false), saved && router.push(`/admin/sales-team/members/${saved.id}`))} />}
    </>
  );
}
