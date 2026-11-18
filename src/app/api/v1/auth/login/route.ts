import { z } from 'zod';
import { loginWithPassword } from '@/server/services/auth.service';
import { sessionCookie } from '@/server/auth/session';
import { handler, ipOf, ok, readJson } from '@/server/http/respond';

const Body = z.object({
  identifier: z.string().min(3, 'Enter your phone number or email.'),
  password: z.string().min(1, 'Enter your password.'),
});

/** Staff sign-in. The browser gets a cookie; a mobile app reads `token`. */
export const POST = handler(async (request) => {
  const input = await readJson(request, Body);
  const { session, user } = await loginWithPassword({
    ...input,
    ip: ipOf(request),
    device: request.headers.get('user-agent'),
  });

  const response = ok({
    user,
    /*
     * The token is in the body for the apps, which have no cookie jar, and in
     * an HttpOnly cookie for the browser, which must not let a script read it.
     */
    token: session.token,
    expires_at: session.expires_at,
  });
  response.cookies.set(sessionCookie(session.token, session.expires_at));
  return response;
});
