'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ArrowLeft, CircleUserRound, Pencil, PieChart, Trash2, UserRound } from 'lucide-react';
import { DocumentsPanel } from '@/components/admin/documents/DocumentsPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ResultDialog } from '@/components/ui/ResultDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { messageOf } from '@/lib/api/client';
import { customerKeys, customersApi } from '@/lib/api/customers';
import { useApi, useApiMutation } from '@/lib/api/use-api';
import { cn } from '@/lib/utils/cn';
import { formatBdt, formatDate, formatPhone } from '@/lib/utils/format';

/*
 * Shares, Earnings and Payments are not here yet: each is a view over this
 * investor's purchases and the receipts against them, which move to Postgres
 * in the next batch. What is already true from the database is the roll-up in
 * `customer.holdings` — how many purchases, what they are worth, what has been
 * paid — so the person's own page is not silent about their money meanwhile.
 */
type Tab = 'overview' | 'documents';


function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline py-2.5 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{value ?? '—'}</span>
    </div>
  );
}

/**
 * Customer detail — Design Reference A.11.
 *
 * One investor's file: who they are, what the agreement names them as, where
 * their profit is sent, and their papers. What they hold is summed by the
 * database and shown at the top; the purchase-by-purchase view returns with
 * the purchases batch.
 */
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const customer = useApi(customerKeys.one(id), (signal) => customersApi.get(id, signal));
  const remove = useApiMutation(() => customersApi.remove(id), [customerKeys.all]);

  if (customer === undefined) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!customer) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">This customer no longer exists.</p>
        <Link href="/admin/customers" className="mt-3 inline-block">
          <Button variant="outline" size="sm">
            <ArrowLeft className="size-4" /> Back to customers
          </Button>
        </Link>
      </Card>
    );
  }

  const held = customer.holdings;
  const isInvestor = held.purchases > 0;

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'documents', label: 'Documents', show: true },
  ];

  return (
    <>
      <Link
        href="/admin/customers"
        className="mb-4 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-admin-700"
      >
        <ArrowLeft className="size-4" /> Back to customers
      </Link>

      <PageHeader
        title={customer.name}
        subtitle={`${customer.code} · ${formatPhone(customer.phone)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/share-sale">
              <Button variant="outline">
                <PieChart className="size-4" /> Reserve shares
              </Button>
            </Link>
            <Link href={`/admin/customers/${customer.id}/edit`}>
              <Button variant="outline">
                <Pencil className="size-4" /> Edit
              </Button>
            </Link>
            <Button variant="dangerGhost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 lg:order-1">
          <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-hairline bg-white p-1">
            {tabs
              .filter((t) => t.show)
              .map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                    tab === t.key ? 'bg-admin-500 text-white' : 'text-ink-muted hover:bg-admin-50 hover:text-admin-700',
                  )}
                >
                  {t.label}
                </button>
              ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-5">
              {isInvestor && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Tile
                    label="Total value"
                    value={formatBdt(held.value)}
                    hint={`${held.purchases} purchase${held.purchases === 1 ? '' : 's'}`}
                  />
                  <Tile
                    label="Shares held"
                    value={String(held.shares)}
                    hint="across every project"
                  />
                  <Tile label="Paid" value={formatBdt(held.paid)} tone="green" hint="toward the price" />
                  <Tile label="Balance" value={formatBdt(held.due)} hint="still to come" />
                </div>
              )}
              <Card>
                <CardHeader title="Customer Information" />
                <Row label="Name" value={customer.name} />
                <Row label="Code" value={customer.code} />
                <Row
                  label="Type"
                  value={
                    isInvestor ? <Badge tone="blue">Investor</Badge> : 'Nothing held yet'
                  }
                />
                <Row
                  label="Phone"
                  value={
                    <a href={`tel:${customer.phone}`} className="text-admin-700 hover:underline">
                      {formatPhone(customer.phone)}
                    </a>
                  }
                />
                <Row
                  label="Email"
                  value={
                    customer.email ? (
                      <a href={`mailto:${customer.email}`} className="text-admin-700 hover:underline">
                        {customer.email}
                      </a>
                    ) : (
                      '—'
                    )
                  }
                />
                <Row label="NID" value={customer.nid} />
                <Row label="e-TIN" value={customer.tin} />
                <Row label="Father’s / spouse’s name" value={customer.father_or_spouse_name} />
                <Row label="Profession" value={customer.profession} />
                <Row label="Date of birth" value={formatDate(customer.date_of_birth)} />
                <Row label="Present address" value={customer.address} />
                <Row label="Permanent address" value={customer.permanent_address} />
                <Row
                  label="Nominee"
                  value={customer.nominee_name ? `${customer.nominee_name}${customer.nominee_relation ? ` (${customer.nominee_relation})` : ''}` : null}
                />
                <Row
                  label="Bank account"
                  value={
                    customer.bank_account
                      ? `${customer.bank_name ?? ''} ${customer.bank_branch ?? ''} · ${customer.bank_account}`.trim()
                      : null
                  }
                />
                <Row label="Customer since" value={formatDate(customer.created_at)} />
              </Card>
            </div>
          )}

          {/* one Documents tab in one design (feedback D3): the customer file, then anything else on the customer */}
          {tab === 'documents' && (
            <Card>
              <CardHeader title="Documents" subtitle="KYC papers and each share purchase's papers — the customer sees these on their Customer Portal." />
              {/*
                The purchase-by-purchase checklist (NID to sign, deed, receipts)
                comes back with the purchases batch; what is here meanwhile is
                the customer's own file.
              */}
              <DocumentsPanel entityType="customer" entityId={customer.id} />
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-5 lg:order-2">
          <Card>
            <div className="flex flex-col items-center text-center">
              <span className="mb-3 grid size-16 place-items-center rounded-full bg-admin-50 text-admin-600">
                <UserRound className="size-8" />
              </span>
              <p className="text-base font-semibold text-ink">{customer.name}</p>
              <p className="text-sm text-ink-muted">{customer.profession ?? 'Customer'}</p>
              {isInvestor && (
                <span className="mt-2 flex flex-wrap justify-center gap-1">
                  <Badge tone="blue">Investor</Badge>
                </span>
              )}
              <a href={`tel:${customer.phone}`} className="mt-3 w-full">
                <Button variant="outline" size="sm" className="w-full">
                  Call {formatPhone(customer.phone)}
                </Button>
              </a>
            </div>
          </Card>



          {isInvestor && (
            <Card>
              <CardHeader title="Customer Portal" />
              <p className="flex items-start gap-2 text-sm text-ink-muted">
                <CircleUserRound className="mt-0.5 size-4 shrink-0 text-admin-600" />
                Signs in at /customer with {formatPhone(customer.phone)} and a one-time code, and sees
                their shares, payment schedules, receipts and papers.
              </p>
            </Card>
          )}

          {/*
            Where this investor came from (the lead they were converted from)
            returns with the CRM batch, which still reads the interim layer.
          */}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${customer.code}`}
        subtitle={customer.name}
        confirmLabel="Delete customer"
        message="This deletes the customer record and its documents. It cannot be undone."
        tone="danger"
        onCancel={() => setConfirmDelete(false)}
        busy={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(undefined);
            router.push('/admin/customers');
          } catch (error) {
            // refused: close the question and say why, in a notice of its own
            setConfirmDelete(false);
            setDeleteError(messageOf(error));
          }
        }}
      />

      <ResultDialog
        open={Boolean(deleteError)}
        tone="warning"
        title="This customer cannot be deleted"
        message={deleteError}
        actionLabel="OK"
        onClose={() => setDeleteError('')}
      />
    </>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-xl border border-hairline bg-white p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold', tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-600' : 'text-ink')}>{value}</p>
      <p className="text-xs text-ink-muted">{hint}</p>
    </div>
  );
}
