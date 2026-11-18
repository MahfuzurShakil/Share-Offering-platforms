import { requireAuth } from '@/server/auth/rbac';
import { listSessions } from '@/server/auth/session';
import { handler, ok } from '@/server/http/respond';

/** The devices I am signed in on — so a lost phone can be signed out. */
export const GET = handler(async (request) => {
  const principal = await requireAuth(request);
  const sessions = await listSessions(
    principal.kind === 'staff'
      ? { user_id: principal.user_id }
      : { customer_id: principal.customer_id },
  );
  return ok(
    sessions.map((s: { id: string }) => ({ ...s, current: s.id === principal.session_id })),
  );
});
