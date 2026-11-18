import { z } from 'zod';
import { requestCustomerOtp } from '@/server/services/auth.service';
import { handler, ipOf, ok, readJson } from '@/server/http/respond';

const Body = z.object({
  phone: z.string().min(6, 'Enter your mobile number.'),
});

/**
 * An investor asks for a sign-in code.
 *
 * The reply is the same whether or not the number is known — otherwise this
 * would answer "is this person an investor here?" to anyone who asked.
 */
export const POST = handler(async (request) => {
  const input = await readJson(request, Body);
  const result = await requestCustomerOtp({ phone: input.phone, ip: ipOf(request) });
  return ok(result);
});
