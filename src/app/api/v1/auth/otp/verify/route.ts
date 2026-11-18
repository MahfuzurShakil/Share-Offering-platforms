import { z } from 'zod';
import { verifyCustomerOtp } from '@/server/services/auth.service';
import { sessionCookie } from '@/server/auth/session';
import { handler, ipOf, ok, readJson } from '@/server/http/respond';

const Body = z.object({
  phone: z.string().min(6, 'Enter your mobile number.'),
  code: z.string().regex(/^\d{4,8}$/, 'Enter the code from the SMS.'),
});

/** An investor signs in with the code. */
export const POST = handler(async (request) => {
  const input = await readJson(request, Body);
  const { session, customer } = await verifyCustomerOtp({
    ...input,
    ip: ipOf(request),
    device: request.headers.get('user-agent'),
  });

  const response = ok({
    customer,
    token: session.token,
    expires_at: session.expires_at,
  });
  response.cookies.set(sessionCookie(session.token, session.expires_at));
  return response;
});
