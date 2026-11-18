import { logout, logoutEverywhere } from '@/server/services/auth.service';
import { requireAuth } from '@/server/auth/rbac';
import { clearedSessionCookie } from '@/server/auth/session';
import { handler, ok } from '@/server/http/respond';

/** Signs this device out. `?everywhere=1` signs out every device. */
export const POST = handler(async (request) => {
  const principal = await requireAuth(request);
  const everywhere = request.nextUrl.searchParams.get('everywhere') === '1';

  if (everywhere) {
    const count = await logoutEverywhere(
      principal.kind === 'staff'
        ? { user_id: principal.user_id }
        : { customer_id: principal.customer_id },
    );
    const response = ok({ signed_out: count });
    response.cookies.set(clearedSessionCookie());
    return response;
  }

  await logout(principal.session_id, {
    user_id: principal.kind === 'staff' ? principal.user_id : null,
    customer_id: principal.kind === 'customer' ? principal.customer_id : null,
  });
  const response = ok({ signed_out: 1 });
  response.cookies.set(clearedSessionCookie());
  return response;
});
