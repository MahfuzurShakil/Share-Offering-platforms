'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, FileText, Inbox, Landmark, MessageSquareText, Ticket, TrendingUp } from 'lucide-react';
import { Kpi } from '@/components/admin/share-sale/bits';
import { PaymentVerifyPanel } from '@/components/admin/share-sale/PaymentVerifyPanel';
import {
  RejectUploadModal,
  RequestNoteModal,
  ReserveFromRequestModal,
  openUpload,
} from '@/components/admin/share-sale/InboxModals';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useSession } from '@/lib/auth/session';
import {
  UPLOAD_KIND_LABEL,
  inboxKeys,
  requestsApi,
  submissionsApi,
  uploadsApi,
  type ApiCustomerUpload,
  type ApiShareRequest,
  type CustomerUploadStatus,
  type ShareRequestStatus,
} from '@/lib/api/inbox';
import { useApi, useApiMutation } from '@/lib/api/use-api';
import { cn } from '@/lib/utils/cn';
import { formatFileSize } from '@/lib/domain/file-upload';
import { formatBdt, formatDate, formatPhone } from '@/lib/utils/format';

const REQUEST_META: Record<ShareRequestStatus, { label: string; tone: BadgeTone }> = {
  new: { label: 'New', tone: 'amber' },
  contacted: { label: 'Contacted', tone: 'blue' },
  reserved: { label: 'Reserved', tone: 'green' },
  declined: { label: 'Declined', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn by customer', tone: 'neutral' },
};

const UPLOAD_META: Record<CustomerUploadStatus, { label: string; tone: BadgeTone }> = {
  under_review: { label: 'To review', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'green' },
  rejected: { label: 'Sent back', tone: 'red' },
};

type Tab = 'requests' | 'documents' | 'payments';

const isOpenRequest = (r: ApiShareRequest) => r.status === 'new' || r.status === 'contacted';

/**
 * Customer Requests — the office's side of the portal inbox: requests to buy
 * into an open round (plan §4 step 3), papers sent in for checking, and slips
 * from investors who paid at the bank.
 *
 * Three queues on one screen because they are one job: the morning's post.
 */
function RequestsPage() {
  const params = useSearchParams();
  const { can } = useSession();
  const mayEdit = can('share_sale', 'edit');

  const tabParam = params.get('tab');
  const [tab, setTab] = useState<Tab>(
    tabParam === 'documents' ? 'documents' : tabParam === 'payments' ? 'payments' : 'requests',
  );
  const [showAll, setShowAll] = useState(false);
  const [reserve, setReserve] = useState<ApiShareRequest | null>(null);
  const [note, setNote] = useState<{ row: ApiShareRequest; kind: 'contacted' | 'decline' } | null>(
    null,
  );
  const [reject, setReject] = useState<ApiCustomerUpload | null>(null);

  const counts = useApi(inboxKeys.counts, (signal) => submissionsApi.counts(signal));
  const requests = useApi(inboxKeys.requests(), (signal) => requestsApi.list({}, signal));
  const uploads = useApi(inboxKeys.uploads(), (signal) => uploadsApi.list({}, signal));
  const accept = useApiMutation((id: string) => uploadsApi.accept(id), [inboxKeys.all]);

  if (!requests || !uploads || !counts) return <p className="text-sm text-ink-muted">Loading…</p>;

  const openRequests = requests.filter(isOpenRequest);
  const toReview = uploads.filter((u) => u.status === 'under_review');
  const requestRows = showAll ? requests : openRequests;
  const uploadRows = showAll ? uploads : toReview;

  const requestColumns: Column<ApiShareRequest>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (r) => (
        <span className="block">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            {r.name}
            {r.source === 'website' && <Badge tone="blue">Website</Badge>}
          </span>
          <span className="block text-xs whitespace-nowrap text-ink-muted tabular-nums">
            {r.phone ? formatPhone(r.phone) : ''}
            {r.email ? ` · ${r.email}` : ''}
          </span>
          <span className="block text-xs whitespace-nowrap text-ink-muted">
            {r.code} · {formatDate(r.requested_at)}
          </span>
        </span>
      ),
      sortValue: (r) => r.requested_at,
    },
    {
      key: 'offering',
      header: 'Offering',
      cell: (r) => (
        <span className="block">
          <span className="block">{r.project_name}</span>
          <span className="block text-xs text-ink-muted">
            {r.offering_code} · Round {r.offering_round}
            {r.offering_status !== 'open' ? ' · round closed' : ''}
          </span>
        </span>
      ),
      sortValue: (r) => r.project_name,
    },
    {
      key: 'asked',
      header: 'Asked for',
      cell: (r) => (
        <span className="block">
          <span className="block font-medium tabular-nums">
            {r.shares} share{r.shares === 1 ? '' : 's'} · {formatBdt(r.value)}
          </span>
          <span className="block text-xs text-ink-muted">
            {r.installments === 0 ? 'Pay in full' : `${r.installments} installments`}
          </span>
          {r.note && (
            <span className="mt-0.5 block max-w-64 truncate text-xs text-ink-muted italic">
              “{r.note}”
            </span>
          )}
        </span>
      ),
      sortValue: (r) => r.shares,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="block">
          <Badge tone={REQUEST_META[r.status].tone}>{REQUEST_META[r.status].label}</Badge>
          {r.sale_id && (
            <Link
              href={`/admin/share-sale/sales/${r.sale_id}?from=requests`}
              className="mt-1 block text-xs font-medium text-admin-600 hover:underline"
            >
              {r.sale_code}
            </Link>
          )}
          {r.office_note && (
            <span className="mt-1 block max-w-56 truncate text-xs text-ink-muted">
              {r.office_note}
            </span>
          )}
        </span>
      ),
      sortValue: (r) => r.status,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        mayEdit && isOpenRequest(r) ? (
          <span className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={r.offering_status !== 'open'}
              title={
                r.offering_status !== 'open'
                  ? 'That round is no longer open'
                  : 'Hold the shares for this customer'
              }
              onClick={() => setReserve(r)}
            >
              <Ticket className="size-4" /> Reserve
            </Button>
            <span className="flex gap-1">
              {r.status === 'new' && (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Note a call to the customer"
                  onClick={() => setNote({ row: r, kind: 'contacted' })}
                >
                  <MessageSquareText className="size-4" /> Called
                </Button>
              )}
              <Button
                size="sm"
                variant="dangerGhost"
                onClick={() => setNote({ row: r, kind: 'decline' })}
              >
                Decline
              </Button>
            </span>
          </span>
        ) : null,
    },
  ];

  const uploadColumns: Column<ApiCustomerUpload>[] = [
    {
      key: 'when',
      header: 'Uploaded',
      cell: (u) => formatDate(u.uploaded_at),
      sortValue: (u) => u.uploaded_at,
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (u) => (
        <span className="block">
          <span className="block font-medium text-ink">{u.customer_name}</span>
          {u.sale_id ? (
            <Link
              href={`/admin/share-sale/sales/${u.sale_id}?from=requests`}
              className="block text-xs text-admin-600 hover:underline"
            >
              {u.sale_code} · {u.project_name}
            </Link>
          ) : (
            <span className="block text-xs text-ink-muted">
              {u.customer_code} · their own papers
            </span>
          )}
        </span>
      ),
      sortValue: (u) => u.customer_name,
    },
    {
      key: 'doc',
      header: 'Document',
      cell: (u) => (
        <button
          type="button"
          onClick={() => openUpload(u.id)}
          className="flex items-start gap-2 text-left hover:text-admin-700"
        >
          <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" />
          <span className="block">
            <span className="block font-medium">{u.title}</span>
            <span className="block text-xs text-ink-muted">
              {UPLOAD_KIND_LABEL[u.kind]} · {formatFileSize(u.file_size)}
            </span>
            {u.note && (
              <span className="block max-w-64 truncate text-xs text-ink-muted italic">
                “{u.note}”
              </span>
            )}
          </span>
        </button>
      ),
      sortValue: (u) => u.title,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (u) => (
        <span className="block">
          <Badge tone={UPLOAD_META[u.status].tone}>{UPLOAD_META[u.status].label}</Badge>
          {u.review_note && (
            <span className="mt-1 block max-w-56 text-xs text-ink-muted">{u.review_note}</span>
          )}
        </span>
      ),
      sortValue: (u) => u.status,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) =>
        mayEdit && u.status === 'under_review' ? (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => accept.mutate(u.id)}>
              <Check className="size-4" /> Accept
            </Button>
            <Button size="sm" variant="dangerGhost" onClick={() => setReject(u)}>
              Send back
            </Button>
          </span>
        ) : null,
    },
  ];

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'requests', label: 'Purchase requests', n: counts.requests_new },
    { key: 'documents', label: 'Documents', n: counts.uploads_waiting },
    { key: 'payments', label: 'Bank payments', n: counts.submissions_waiting },
  ];

  return (
    <>
      <PageHeader
        title="Customer Requests"
        subtitle="What investors and website visitors have sent in: requests to buy, papers for checking, and slips from the bank. Nothing here is a record until the office acts on it."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Inbox}
          label="Requests waiting"
          value={String(counts.requests_new)}
          hint="new and contacted"
        />
        <Kpi
          icon={TrendingUp}
          label="Asked for"
          value={formatBdt(counts.requests_value)}
          hint="at the round's price"
        />
        <Kpi
          icon={FileText}
          label="Papers to review"
          value={String(counts.uploads_waiting)}
          hint="sent by customers"
        />
        <Kpi
          icon={Landmark}
          label="Slips to check"
          value={formatBdt(counts.submissions_value)}
          hint={`${counts.submissions_waiting} against the statement`}
        />
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline px-5">
          <div className="flex gap-1">
            {tabs.map(({ key, label, n }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                  tab === key
                    ? 'border-admin-500 text-admin-700'
                    : 'border-transparent text-ink-muted hover:text-ink',
                )}
              >
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px]',
                    n ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-ink-muted',
                  )}
                >
                  {n}
                </span>
              </button>
            ))}
          </div>
          <label className="mb-2 flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="size-4 accent-admin-600"
            />
            Show dealt-with too
          </label>
        </div>

        <div className="p-5">
          {tab === 'payments' ? (
            <PaymentVerifyPanel showAll={showAll} mayConfirm={can('finance_collection', 'approve')} />
          ) : tab === 'requests' ? (
            <DataTable
              rows={requestRows}
              columns={requestColumns}
              label="requests"
              emptyState={
                <EmptyState
                  icon={Inbox}
                  title="No purchase requests waiting"
                  description="When an investor asks to buy into a round — from the Customer Portal, the website's Invest page, or over the phone — it shows up here."
                />
              }
              mobileCard={(r) => (
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block font-medium text-ink">
                        {r.name}
                        {r.source === 'website' && (
                          <Badge tone="blue" className="ml-1.5">
                            Website
                          </Badge>
                        )}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {r.project_name} · {r.shares} shares · {formatBdt(r.value)}
                      </span>
                    </span>
                    <Badge tone={REQUEST_META[r.status].tone}>{REQUEST_META[r.status].label}</Badge>
                  </div>
                  {mayEdit && isOpenRequest(r) && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        disabled={r.offering_status !== 'open'}
                        onClick={() => setReserve(r)}
                      >
                        Reserve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setNote({ row: r, kind: 'contacted' })}
                      >
                        Contacted
                      </Button>
                      <Button
                        size="sm"
                        variant="dangerGhost"
                        onClick={() => setNote({ row: r, kind: 'decline' })}
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              )}
            />
          ) : (
            <DataTable
              rows={uploadRows}
              columns={uploadColumns}
              label="documents"
              emptyState={
                <EmptyState
                  icon={FileText}
                  title="No documents to review"
                  description="Papers an investor sends in wait here until somebody accepts them or sends them back with a reason."
                />
              }
              mobileCard={(u) => (
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block font-medium text-ink">{u.title}</span>
                      <span className="block text-xs text-ink-muted">
                        {u.customer_name} · {u.sale_code ?? u.customer_code} ·{' '}
                        {formatDate(u.uploaded_at)}
                      </span>
                    </span>
                    <Badge tone={UPLOAD_META[u.status].tone}>{UPLOAD_META[u.status].label}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => openUpload(u.id)}>
                      Open
                    </Button>
                    {mayEdit && u.status === 'under_review' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => accept.mutate(u.id)}>
                          Accept
                        </Button>
                        <Button size="sm" variant="dangerGhost" onClick={() => setReject(u)}>
                          Send back
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            />
          )}
        </div>
      </Card>

      {reserve && (
        <ReserveFromRequestModal request={reserve} onClose={() => setReserve(null)} />
      )}
      {note && (
        <RequestNoteModal request={note.row} kind={note.kind} onClose={() => setNote(null)} />
      )}
      {reject && <RejectUploadModal upload={reject} onClose={() => setReject(null)} />}
    </>
  );
}

export default function CustomerRequestsPage() {
  return (
    <Suspense>
      <RequestsPage />
    </Suspense>
  );
}
