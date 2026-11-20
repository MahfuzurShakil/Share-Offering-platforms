'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, CalendarPlus, Lock, Pencil, PlayCircle, Ticket, Trash2, XCircle } from 'lucide-react';
import { DocumentsPanel } from '@/components/admin/documents/DocumentsPanel';
import { AvailabilityBar, DetailTabs, OfferingBadge, Row } from '@/components/admin/share-sale/bits';
import { ExtendOfferingModal, OpenOfferingModal } from '@/components/admin/share-sale/ShareSaleModals';
import { ReserveModal } from '@/components/admin/share-sale/SaleModals';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSession } from '@/lib/auth/session';
import { FREQUENCY_LABEL, formatCrore, formatSharePct, lateFeeText, offeringState } from '@/lib/domain/share-sale';
import { messageOf } from '@/lib/api/client';
import { shareOfferingKeys, shareOfferingsApi } from '@/lib/api/share-offerings';
import { useApi, useRefresh } from '@/lib/api/use-api';
import { formatBdt, formatDate, todayLocal } from '@/lib/utils/format';

type Dialog = 'open' | 'reserve' | 'extend' | 'close' | 'cancel' | 'delete' | null;
/*
 * The Purchases and Ownership tabs are still to come: both are a view over
 * this round's purchases, which the Investors & Dues screen already shows
 * whole. Holding shares happens here, where the shares are.
 */
type Tab = 'overview' | 'documents';

export default function OfferingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const mayEdit = can('share_sale', 'edit');
  const refresh = useRefresh([shareOfferingKeys.all]);
  const o = useApi(shareOfferingKeys.one(id), (signal) => shareOfferingsApi.get(id, signal));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  if (o === undefined) return <p className="text-sm text-ink-muted">Loading...</p>;
  if (!o) {
    return (
      <EmptyState
        icon={XCircle}
        title="Offering not found"
        action={<Link href="/admin/share-sale">Back to offerings</Link>}
      />
    );
  }

  /* what the round has sold and holds, counted by the database */
  const a = {
    sold: o.sold_shares,
    reserved: o.reserved_shares,
    available: o.available_shares,
    sold_pct: o.total_shares ? (o.sold_shares / o.total_shares) * 100 : 0,
  };
  const state = offeringState(o, todayLocal());
  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await refresh();
      setDialog(null);
    } catch (e) {
      setError(messageOf(e));
      setDialog(null);
    }
  };

  return (
    <>
      <Link href="/admin/share-sale" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-admin-700">
        <ArrowLeft className="size-4" /> Share Offerings
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">
              {o.project_name} · Round {o.round_no}
            </h1>
            <OfferingBadge state={state} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {o.code} · valued {formatDate(o.valuation_date)}
            {o.opens_on && ` · open ${formatDate(o.opens_on)} – ${formatDate(o.closes_on)}`}
          </p>
        </div>
        {mayEdit && (
          <div className="flex flex-wrap gap-2">
            {state === 'draft' && (
              <>
                <Button variant="dangerGhost" onClick={() => setDialog('delete')}>
                  <Trash2 className="size-4" /> Delete
                </Button>
                <Link href={`/admin/share-sale/offerings/${o.id}/edit`}>
                  <Button variant="outline">
                    <Pencil className="size-4" /> Edit
                  </Button>
                </Link>
                <Button onClick={() => setDialog('open')}>
                  <PlayCircle className="size-4" /> Open for sale
                </Button>
              </>
            )}
            {(state === 'open' || state === 'expired') && (
              <>
                {a.sold + a.reserved === 0 && (
                  <Button variant="dangerGhost" onClick={() => setDialog('cancel')}>
                    Cancel offering
                  </Button>
                )}
                <Button variant="outline" onClick={() => setDialog('close')}>
                  <Lock className="size-4" /> Close
                </Button>
                <Button variant="outline" onClick={() => setDialog('extend')}>
                  <CalendarPlus className="size-4" /> Extend
                </Button>
                {state === 'open' && (
                  <Button onClick={() => setDialog('reserve')} disabled={a.available === 0}>
                    <Ticket className="size-4" /> Reserve shares
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {state === 'expired' && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The validity ended on {formatDate(o.closes_on)} with {a.available} share{a.available === 1 ? '' : 's'} unsold. Extend it to keep selling, or close it — the owner keeps the unsold part.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 lg:order-1">
          <DetailTabs
            tabs={[
              { key: 'overview', label: 'Overview' },
              { key: 'documents', label: 'Documents' },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'overview' && (
            <div className="space-y-5">
              <Card>
                <CardHeader title="Valuation" subtitle={`Net asset value + premium · valued ${formatDate(o.valuation_date)}`} />
                <Row label="Net asset value">{formatBdt(o.net_asset_value)}</Row>
                <Row label="Premium">
                  {formatBdt(o.premium_value)}
                  <span className="ml-1 text-xs text-ink-muted">({Number(((o.premium_value / o.net_asset_value) * 100).toFixed(1))}% of NAV)</span>
                </Row>
                <Row label="Project valuation (100%)" strong>
                  {formatBdt(o.valuation)}
                </Row>
              </Card>
              <Card>
                <CardHeader title="Offered to the market" subtitle={`${formatSharePct(o.offered_pct)} of the project in ${o.total_shares} shares`} />
                <Row label="Share of the project offered">{formatSharePct(o.offered_pct)}</Row>
                <Row label="Number of shares">{o.total_shares}</Row>
                <Row label="Ownership per share">{formatSharePct(o.share_pct)}</Row>
                <Row label="Price per share" strong>
                  {formatBdt(o.price_per_share)}
                </Row>
                <Row label="Raises if all sell">{formatBdt(o.price_per_share * o.total_shares)}</Row>
              </Card>
              <Card>
                <CardHeader title="Terms for customers" subtitle={o.status === 'draft' ? (o.closes_on ? `Planned to close ${formatDate(o.closes_on)}` : `Valid ${o.validity_days} days once opened`) : `Valid ${o.validity_days} days`} />
                <Row label="Validity">
                  {o.opens_on ? `${formatDate(o.opens_on)} – ${formatDate(o.closes_on)}` : o.closes_on ? `Closes ${formatDate(o.closes_on)}` : `${o.validity_days} days from opening`}
                </Row>
                <Row label="Shares per customer">
                  {o.min_shares}–{o.max_shares}
                </Row>
                <Row label="Down payment">at least {o.min_down_payment_pct}%</Row>
                <Row label="Installments">
                  up to {o.max_installments}, {FREQUENCY_LABEL[o.installment_frequency].toLowerCase()}
                </Row>
                <Row label="Late fee">{lateFeeText(o)}</Row>
                <Row label="Reservation hold">{o.hold_days} days</Row>
              </Card>
              {o.notes && (
                <Card>
                  <CardHeader title="Notes" />
                  <p className="text-sm whitespace-pre-line text-ink">{o.notes}</p>
                </Card>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <Card>
              <CardHeader title="Documents" subtitle="The papers behind this offering — valuation report, board resolution, offer document." />
              <DocumentsPanel entityType="share_offering" entityId={o.id} />
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-5 lg:order-2">
          <Card>
            <CardHeader title="Shares" subtitle="Sold = agreement signed" />
            <AvailabilityBar a={a} total={o.total_shares} />
            <div className="mt-3">
              <Row label="Sold value">{formatBdt(o.raised)}</Row>
              <Row label="Unsold">{formatBdt(a.available * o.price_per_share)}</Row>
            </div>
          </Card>
          <Card>
            <CardHeader title="At a glance" />
            <Row label="Valuation">{formatCrore(o.valuation)}</Row>
            <Row label="Price per share" strong>
              {formatBdt(o.price_per_share)}
            </Row>
            <Row label="Offered">
              {formatSharePct(o.offered_pct)} · {o.total_shares} shares
            </Row>
            <Row label={o.closes_on ? 'Valid until' : 'Validity'}>{o.closes_on ? formatDate(o.closes_on) : `${o.validity_days} days`}</Row>
          </Card>
        </aside>
      </div>

      {dialog === 'open' && (
        <OpenOfferingModal
          offering={o}
          onClose={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {dialog === 'reserve' && (
        <ReserveModal
          offering={o}
          onClose={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {dialog === 'extend' && (
        <ExtendOfferingModal
          offering={o}
          onClose={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === 'close'}
        title="Close this offering?"
        message={`No more shares can be reserved. ${a.available} unsold share${a.available === 1 ? '' : 's'} stay with the owner and can go into a later offering.${a.reserved ? ` ${a.reserved} reserved share${a.reserved === 1 ? '' : 's'} can still be signed.` : ''}`}
        tone="warning"
        confirmLabel="Close offering"
        onConfirm={() => act(() => shareOfferingsApi.close(o.id))}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="Cancel this offering?"
        message="Nobody has bought into it. It is withdrawn and its % of the project is free to offer again."
        confirmLabel="Cancel offering"
        onConfirm={() => act(() => shareOfferingsApi.cancel(o.id))}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title="Delete this draft?"
        message="The draft and its numbers are removed."
        onConfirm={() => act(async () => {
          await shareOfferingsApi.remove(o.id);
          router.push('/admin/share-sale');
        })}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}
