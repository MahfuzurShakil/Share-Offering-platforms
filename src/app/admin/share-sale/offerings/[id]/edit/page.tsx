'use client';

import { useParams } from 'next/navigation';
import { OfferingForm } from '@/components/admin/share-sale/OfferingForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { shareOfferingKeys, shareOfferingsApi } from '@/lib/api/share-offerings';
import { useApiQuery } from '@/lib/api/use-api';

export default function EditOfferingPage() {
  const { id } = useParams<{ id: string }>();
  const { data: offering, isPending, isError } = useApiQuery(shareOfferingKeys.one(id), (signal) =>
    shareOfferingsApi.get(id, signal),
  );

  if (isPending) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (isError || !offering) {
    return <p className="text-sm text-ink-muted">This offering no longer exists.</p>;
  }
  if (offering.status !== 'draft') {
    return <p className="text-sm text-ink-muted">Only a draft offering can be changed.</p>;
  }
  return (
    <>
      <PageHeader title={`Edit ${offering.code}`} subtitle="Draft — nothing is on sale until it is opened." />
      <OfferingForm offering={offering} />
    </>
  );
}
