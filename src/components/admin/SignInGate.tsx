'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/auth/session';

/**
 * Nobody sees the Admin Portal without a session.
 *
 * This is the *courtesy* half of access control, not the boundary: it keeps a
 * signed-out person from staring at an empty shell, and sends them where they
 * can do something about it. The boundary is on the server, where every
 * `/api/v1` route checks for itself — so even if this component were deleted,
 * no data would follow.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const { loading, signedIn } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !signedIn) {
      const next = encodeURIComponent(pathname ?? '/admin');
      router.replace(`/login?next=${next}`);
    }
  }, [loading, signedIn, pathname, router]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas">
        <p className="text-sm text-ink-muted">Loading…</p>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas">
        <p className="text-sm text-ink-muted">Taking you to the sign-in page…</p>
      </div>
    );
  }

  return <>{children}</>;
}
