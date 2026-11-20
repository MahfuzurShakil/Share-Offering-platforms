'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/** Signing is a dialog on the purchase page now; old links land there. */
export default function SignAgreementRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/admin/share-sale/sales/${id}`);
  }, [id, router]);
  return <p className="text-sm text-ink-muted">Opening the agreement…</p>;
}
