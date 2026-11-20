'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRightLeft, UserMinus, UserPlus } from 'lucide-react';
import { ErrorNote, useAction } from '@/components/admin/share-sale/ShareSaleModals';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Combobox } from '@/components/ui/Combobox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useReadOnly } from '@/components/ui/ViewOnly';
import { salesTeamApi, salesTeamKeys } from '@/lib/api/leads';
import {
  commissionKeys,
  commissionsApi,
  designationKeys,
  designationsApi,
  orgKeys,
  orgMembersApi,
  payoutKeys,
  type ApiOrgMember,
} from '@/lib/api/sales-team';
import { useApi, useRefresh } from '@/lib/api/use-api';
import type { CommissionLineStatus } from '@/lib/db/types';
import { COMMISSION_LINE_STATUS_META, descendantsOf } from '@/lib/domain/commission';
import { formatBdt, todayLocal } from '@/lib/utils/format';

/**
 * The pieces the Sales Team screens share.
 *
 * There used to be a `useCommissionSync` hook here, which every screen called
 * on mount to reconcile the commission lines with the payment ledgers before
 * reading them. The server does that inside the read now — it is idempotent,
 * so being right on every request is cheaper than keeping a browser hook
 * honest — and the hook is gone with nothing taking its place.
 */

/** Everything the sales-team screens read, refreshed together after a write. */
const TOUCHES = [orgKeys.all, commissionKeys.all, payoutKeys.all];

export function LineStatusBadge({
  status,
  toRecover,
}: {
  status: CommissionLineStatus;
  toRecover?: boolean | null;
}) {
  const meta = COMMISSION_LINE_STATUS_META[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={meta.tone}>{meta.label}</Badge>
      {toRecover && status === 'paid' && <Badge tone="amber">To recover</Badge>}
    </span>
  );
}

const ACTIVE_MEMBERS = { status: 'active' as const };

/** The members a sale can be credited to, as picker options. */
export function useMemberOptions() {
  const members = useApi(orgKeys.list(ACTIVE_MEMBERS), (signal) =>
    orgMembersApi.list(ACTIVE_MEMBERS, signal),
  );
  return (members ?? []).map((m) => ({
    id: m.id,
    label: m.name,
    hint: `${m.code} · ${m.designation}`,
    keywords: `${m.code} ${m.phone ?? ''} ${m.designation}`,
  }));
}

/** "Sold by" for a share purchase, with the commission it carries (plan §6–7). */
export function SaleCommissionCard({
  saleId,
  soldBy,
  editable: allowed,
}: {
  saleId: string;
  soldBy: string | null | undefined;
  editable: boolean;
}) {
  const readOnly = useReadOnly();
  const editable = allowed && !readOnly;
  const refresh = useRefresh(TOUCHES);
  const options = useMemberOptions();
  const [error, setError] = useState('');

  const lines = useApi(commissionKeys.forSale(saleId), (signal) =>
    commissionsApi.forSale(saleId, signal),
  );
  const seller = useApi(
    orgKeys.one(soldBy ?? 'none'),
    (signal) => orgMembersApi.get(soldBy as string, signal),
    { enabled: Boolean(soldBy) },
  );

  const change = async (id: string | null) => {
    setError('');
    try {
      await commissionsApi.setSoldBy(saleId, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  const people = [...new Map((lines ?? []).map((l) => [l.member_id, l])).values()];
  return (
    <Card>
      <CardHeader
        title="Sales commission"
        subtitle="Who sold it, and the commission released as the buyer pays."
      />
      <Field
        label="Sold by"
        hint={editable ? 'Commission follows the plan in force on the sale date.' : undefined}
      >
        {editable ? (
          <Combobox
            value={soldBy ?? null}
            options={options}
            onChange={change}
            placeholder="Pick a sales team member…"
            unlistedLabel={seller?.name ?? null}
          />
        ) : (
          <p className="text-sm font-medium text-ink">
            {seller ? `${seller.name} · ${seller.code}` : '—'}
          </p>
        )}
      </Field>
      <ErrorNote error={error} />
      {lines && lines.length > 0 ? (
        <div className="mt-4 space-y-3">
          {people.map((person) => {
            const mine = lines.filter((l) => l.member_id === person.member_id);
            return (
              <div key={person.member_id} className="rounded-xl border border-hairline p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/admin/sales-team/members/${person.member_id}`}
                    className="text-sm font-semibold text-admin-700 hover:underline"
                  >
                    {person.member_name}
                  </Link>
                  <span className="text-xs text-ink-muted">
                    {person.role === 'seller' ? 'Seller' : 'Override'} ·{' '}
                    {person.designation_at_sale} ·{' '}
                    {formatBdt(mine.reduce((total, l) => total + l.amount, 0))}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {mine.map((line) => (
                    <li
                      key={line.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span className="text-ink-muted">{line.stage_label}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{formatBdt(line.amount)}</span>
                        <LineStatusBadge status={line.status} toRecover={line.to_recover} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">
          {soldBy
            ? 'No commission plan covers this sale on its date, so it carries no commission.'
            : 'Pick who sold it to work out the commission.'}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Member dialogs
 * ------------------------------------------------------------------ */

/**
 * Add a member (optionally under somebody) or edit one.
 *
 * On an edit, "Reports to" is not here: that is a move, with the date it took
 * effect, because commission is read from the tree as it was on the sale date.
 * The server's member route has no `parent_id` at all, so the form could not
 * change it even if it tried.
 */
export function MemberFormModal({
  member,
  parentId,
  onClose,
}: {
  member?: ApiOrgMember;
  parentId?: string | null;
  onClose: (saved?: ApiOrgMember) => void;
}) {
  const refresh = useRefresh(TOUCHES);
  const designations = useApi(designationKeys.all, (signal) => designationsApi.list(signal));
  const members = useApi(orgKeys.list(ACTIVE_MEMBERS), (signal) =>
    orgMembersApi.list(ACTIVE_MEMBERS, signal),
  );
  const logins = useApi(salesTeamKeys.all, (signal) => salesTeamApi.list(signal));

  const [f, setF] = useState({
    name: member?.name ?? '',
    phone: member?.phone ?? '',
    designation_id: member?.designation_id ?? '',
    parent_id: member ? member.parent_id : (parentId ?? null),
    user_id: member?.user_id ?? '',
    joined_on: member?.joined_on ?? todayLocal(),
    notes: member?.notes ?? '',
  });
  const { error, busy, run } = useAction();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((x) => ({ ...x, [k]: v }));

  // until one is picked, the designation one step below the parent's
  const parent = members?.find((m) => m.id === f.parent_id);
  const below = designations?.length
    ? designations[
        Math.min(
          (parent ? designations.findIndex((d) => d.id === parent.designation_id) : -1) + 1,
          designations.length - 1,
        )
      ]!.id
    : '';
  const designationId = f.designation_id || (member ? '' : below);

  return (
    <Modal
      open
      title={member ? `Edit ${member.name}` : 'Add a member'}
      subtitle={
        member
          ? member.code
          : parent
            ? `Reports to ${parent.name}`
            : 'At the top level of the organisation'
      }
      icon={UserPlus}
      onClose={() => onClose()}
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              let saved: ApiOrgMember | undefined;
              void run(
                async () => {
                  const payload = {
                    name: f.name.trim(),
                    phone: f.phone.trim() || null,
                    designation_id: designationId,
                    joined_on: f.joined_on,
                    user_id: f.user_id || null,
                    notes: f.notes.trim() || null,
                  };
                  saved = member
                    ? await orgMembersApi.update(member.id, payload)
                    : await orgMembersApi.create({ ...payload, parent_id: f.parent_id });
                  await refresh();
                },
                () => onClose(saved),
              );
            }}
          >
            {busy ? 'Saving…' : member ? 'Save changes' : 'Add member'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" required>
          <TextInput value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Phone">
          <TextInput
            value={f.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="01XXXXXXXXX"
          />
        </Field>
        <Field
          label="Designation"
          required
          hint="Names and order are set in Master Data → Org designation."
        >
          <SelectInput
            value={designationId}
            onChange={(e) => set('designation_id', e.target.value)}
          >
            <option value="">Pick a designation</option>
            {(designations ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.value}
              </option>
            ))}
          </SelectInput>
        </Field>
        {member ? (
          <Field label="Reports to" hint="Use Move, so the change carries the date it took effect.">
            <p className="py-2 text-sm font-medium text-ink">{member.parent_name ?? 'Top level'}</p>
          </Field>
        ) : (
          <Field label="Reports to">
            <Combobox
              value={f.parent_id}
              onChange={(id) => set('parent_id', id)}
              placeholder="Top level — reports to nobody"
              options={(members ?? []).map((m) => ({
                id: m.id,
                label: m.name,
                hint: `${m.code} · ${m.designation}`,
              }))}
            />
          </Field>
        )}
        <Field label="Joined on" required>
          <TextInput
            type="date"
            value={f.joined_on}
            onChange={(e) => set('joined_on', e.target.value)}
          />
        </Field>
        <Field label="Admin login" hint="Staff who log in; leave empty for an outside agent.">
          <SelectInput value={f.user_id} onChange={(e) => set('user_id', e.target.value)}>
            <option value="">No login</option>
            {(logins ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Notes" className="md:col-span-2">
          <TextArea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      {/*
        The "Company partner" picker is not here yet: partners arrive with the
        Fund & Partners module (S4), and the column on the member is waiting
        for them. A founder who owns part of the company is an ordinary member
        until then.
      */}
      <ErrorNote error={error} />
    </Modal>
  );
}

/** Puts a member (and their team) under somebody else from a date; the old place stays in the history. */
export function MoveMemberModal({
  member,
  toParentId,
  onClose,
}: {
  member: ApiOrgMember;
  toParentId?: string | null;
  onClose: () => void;
}) {
  const refresh = useRefresh(TOUCHES);
  const members = useApi(orgKeys.list(ACTIVE_MEMBERS), (signal) =>
    orgMembersApi.list(ACTIVE_MEMBERS, signal),
  );
  const [to, setTo] = useState<string | null>(toParentId === undefined ? null : toParentId);
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const { error, busy, run } = useAction();

  /*
   * Their own team cannot be their new parent — that would be a loop. Worked
   * out here with the same pure function the server refuses it with, so the
   * picker does not offer what the save would reject.
   */
  const team = descendantsOf(member.id, members ?? []);
  const blocked = new Set([member.id, ...team]);

  return (
    <Modal
      open
      title={`Move ${member.name}`}
      subtitle={`Now reports to ${member.parent_name ?? 'nobody (top level)'}${
        team.length ? ` · ${team.length} in their team move too` : ''
      }`}
      icon={ArrowRightLeft}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await orgMembersApi.move(member.id, {
                  to_parent_id: to,
                  effective_date: date,
                  note: note.trim() || null,
                });
                await refresh();
              }, onClose)
            }
          >
            {busy ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Reports to" className="md:col-span-2">
          <Combobox
            value={to}
            onChange={setTo}
            placeholder="Top level — reports to nobody"
            options={(members ?? [])
              .filter((m) => !blocked.has(m.id))
              .map((m) => ({ id: m.id, label: m.name, hint: `${m.code} · ${m.designation}` }))}
          />
        </Field>
        <Field label="From" required hint="Sales before this date keep the old team for commission.">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. new team formed"
          />
        </Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function MarkLeftDialog({
  member,
  onClose,
}: {
  member: ApiOrgMember;
  onClose: () => void;
}) {
  const refresh = useRefresh(TOUCHES);
  const [date, setDate] = useState(todayLocal());
  const { error, busy, run } = useAction();
  return (
    <ConfirmDialog
      open
      tone="warning"
      icon={UserMinus}
      title={`${member.name} has left`}
      subtitle="Commission already worked out stays theirs; no new sales can be credited to them."
      confirmLabel={busy ? 'Saving…' : 'Mark as left'}
      busy={busy}
      onConfirm={() =>
        run(async () => {
          await orgMembersApi.markLeft(member.id, date);
          await refresh();
        }, onClose)
      }
      onCancel={onClose}
    >
      <Field label="Left on" required>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <ErrorNote error={error} />
    </ConfirmDialog>
  );
}

/** A compact money summary of commission lines. */
export function CommissionSummary({
  totals,
}: {
  totals: { pending: number; earned: number; approved: number; paid: number; to_recover: number };
}) {
  const cells: [string, number, string?][] = [
    ['To come', totals.pending],
    ['Earned, to approve', totals.earned],
    ['Approved, to pay', totals.approved],
    ['Paid', totals.paid],
  ];
  if (totals.to_recover > 0) cells.push(['To recover', totals.to_recover, 'text-red-600']);
  return (
    <div
      className={`grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline text-sm grid-cols-2 ${
        cells.length === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
      }`}
    >
      {cells.map(([k, v, cls]) => (
        <div key={k} className="bg-white px-4 py-3">
          <p className="text-xs text-ink-muted">{k}</p>
          <p className={`mt-0.5 font-semibold tabular-nums ${cls ?? ''}`}>{formatBdt(v)}</p>
        </div>
      ))}
    </div>
  );
}
