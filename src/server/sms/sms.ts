/**
 * Sending an SMS.
 *
 * The gateway account is the client's, opened in their name and billed to them
 * (quotation §10.2), so this is an adapter with the provider behind it rather
 * than one provider's SDK threaded through the code. Until they give us the
 * account, development writes the message to the server log — which is also
 * how the OTP flow is tested without spending money or a real phone.
 */

export interface SmsMessage {
  to: string;
  text: string;
  /** what it is for, so the log and any provider report can be read */
  purpose: string;
}

export interface SmsResult {
  ok: boolean;
  /** the provider's own id for the message, when it gives one */
  reference?: string;
  error?: string;
}

export interface SmsSender {
  name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

/** Development and tests: nothing leaves the machine. */
const logSender: SmsSender = {
  name: 'log',
  async send(message) {
    const safe = process.env.SMS_LOG_CODES === 'true' ? message.text : redactCode(message.text);
    console.log(`[sms:${message.purpose}] ${message.to} — ${safe}`);
    return { ok: true, reference: `log-${Date.now()}` };
  },
};

/**
 * A code in a log is a code anybody with the log can use, so it is hidden
 * unless the developer explicitly asks for it (`SMS_LOG_CODES=true`).
 */
function redactCode(text: string): string {
  return text.replace(/\b\d{4,8}\b/g, '******');
}

let configured: SmsSender | null = null;

/** Replaces the sender — the seam the provider and the tests both use. */
export function setSmsSender(sender: SmsSender | null): void {
  configured = sender;
}

export function smsSender(): SmsSender {
  return configured ?? logSender;
}

/** Sends, and never throws: a failed SMS must not fail the request around it. */
export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  try {
    return await smsSender().send(message);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[sms:${message.purpose}] could not send to ${message.to}: ${reason}`);
    return { ok: false, error: reason };
  }
}

/** The wording an investor gets when they ask to sign in. */
export function otpMessage(code: string, companyName: string, minutes: number): string {
  return `${code} is your ${companyName} sign-in code. It is valid for ${minutes} minutes. Do not share it with anyone.`;
}
