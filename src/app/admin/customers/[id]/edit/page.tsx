'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { CustomerForm } from '@/components/admin/customers/CustomerForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { customerKeys, customersApi } from '@/lib/api/customers';
import { useApiQuery } from '@/lib/api/use-api';

export default function EditCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { data: customer, isPending, isError } = useApiQuery(customerKeys.one(id), (signal) =>
    customersApi.get(id, signal),
  );

  if (isPending) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (isError || !customer) {
    return <p className="text-sm text-ink-muted">This customer no longer exists.</p>;
  }

  return (
    <>
      <PageHeader title={`Edit ${customer.code}`} subtitle={customer.name} />
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <CustomerForm customer={customer} />
      </Suspense>
    </>
  );
}
