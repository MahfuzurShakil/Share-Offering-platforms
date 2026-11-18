'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSession } from '@/lib/auth/session';
import {
  PERMISSION_MODULE_LABEL,
  isFormPath,
  moduleForPath,
} from '@/lib/domain/permissions';
import { humanize } from '@/lib/utils/format';

/**
 * The permission check, at the route.
 *
 * Hiding a menu item is presentation: the URL still works if it is typed in or
 * arrives in a link somebody pasted. One check in the shell covers every page
 * — putting it on each page instead would mean remembering it on every page
 * added afterwards, which is exactly the kind of thing that gets forgotten.
 *
 * This is still not the boundary. The rights it reads come from the server, and
 * the server checks them again on every `/api/v1` call, so a person who got
 * past this would see an empty screen rather than somebody else's data. What
 * it is for is telling them plainly that the screen is not theirs.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can, role, loading } = useSession();

  const moduleKey = moduleForPath(pathname);
  if (!moduleKey) return <>{children}</>;

  // until the rights have arrived, show nothing rather than a refusal
  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;

  /*
   * QA audit 2026-10-11 (X-01): a form is not a view. A role that may only see
   * a module could still type /new or /edit and save; those pages need edit
   * rights, the same right the page's own Edit button is gated on.
   */
  const isForm = isFormPath(pathname);
  if (isForm ? can(moduleKey, 'edit') : can(moduleKey)) return <>{children}</>;

  const label = PERMISSION_MODULE_LABEL[moduleKey];
  const roleLabel = role ? humanize(role) : 'Your role';

  return (
    <EmptyState
      icon={ShieldAlert}
      title={
        isForm && can(moduleKey)
          ? `${label} is view only for your role`
          : `${label} is not open to your role`
      }
      description={`${roleLabel} does not have the rights for this screen. Ask a Super Admin to change your role's permissions in Users & Roles.`}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge tone="neutral">Signed in as {roleLabel}</Badge>
          <Link href="/admin">
            <Button variant="outline">Back to the dashboard</Button>
          </Link>
        </div>
      }
    />
  );
}
