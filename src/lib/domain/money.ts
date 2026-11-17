/**
 * Money and calendar helpers shared by the whole domain layer.
 *
 * These two lived in `domain/procurement.ts` and `domain/booking.ts` in the
 * prototype, which is an accident of the order the modules were built in —
 * share sale, revenue sharing and commission all need them, and none of them
 * needs procurement or bookings.
 */

/** Taka, rounded to the paisa. Every money figure goes through this. */
export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * The same day-of-month `months` later, clamped to the month's length — so a
 * schedule that starts on the 31st falls on the 30th, the 28th and so on,
 * instead of silently rolling into the next month.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
