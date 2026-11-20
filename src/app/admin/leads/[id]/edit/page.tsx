'use client';

import { useParams } from 'next/navigation';
import { LeadForm } from '@/components/admin/leads/LeadForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { leadKeys, leadsApi } from '@/lib/api/leads';
import { useApiQuery } from '@/lib/api/use-api';

export default function EditLeadPage() {
  const { id } = useParams<{ id: string }>();
  const { data: lead, isError } = useApiQuery(leadKeys.one(id), (signal) =>
    leadsApi.get(id, signal),
  );

  if (lead === undefined) {
    return (
      <p className="text-sm text-ink-muted">
        {isError ? 'This lead no longer exists.' : 'Loading…'}
      </p>
    );
  }

  return (
    <>
      <PageHeader title={`Edit ${lead.code}`} subtitle={lead.name} />
      <LeadForm lead={lead} />
    </>
  );
}
