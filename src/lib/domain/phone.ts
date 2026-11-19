/**
 * Bangladeshi mobile numbers, in one place.
 *
 * "01711 22 33 44", "+8801711223344" and "8801711223344" are one person, and
 * both sides have to agree on that: the browser warns about a duplicate before
 * the save, and the server is what actually refuses one. It lived in
 * `lead.repository.ts`, which is a client module, so the server could not
 * reach it — this file is pure and shared, which is where such a rule belongs
 * (AGENTS.md).
 */

/** Digits only, in the local `01XXXXXXXXX` form. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // BD numbers arrive as 01711…, 8801711…, or +8801711…
  if (digits.startsWith('880')) return `0${digits.slice(3)}`;
  if (digits.length === 10 && !digits.startsWith('0')) return `0${digits}`;
  return digits;
}

/** True for a number that could actually be dialled. */
export function isMobile(phone: string): boolean {
  return /^01[3-9]\d{8}$/.test(normalizePhone(phone));
}
