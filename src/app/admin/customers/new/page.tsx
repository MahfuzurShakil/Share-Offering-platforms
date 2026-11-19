'use client';

import { Suspense } from 'react';
import { CustomerForm } from '@/components/admin/customers/CustomerForm';
import { PageHeader } from '@/components/ui/PageHeader';

export default function NewCustomerPage() {
  return (
    <>
      <PageHeader
        title="Add Customer"
        subtitle="An investor's file: who they are, what the agreement will need, and where their profit is sent. A code (CUST-YYYY-NNN) is given on save."
      />
      {/* the form reads search params, which needs a Suspense boundary */}
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <CustomerForm />
      </Suspense>
    </>
  );
}
