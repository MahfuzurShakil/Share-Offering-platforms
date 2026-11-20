import { money } from './money';

/**
 * Who owns the part of a project the customers do not — the owners' side of the
 * cap table (REVENUE-SHARE-PLAN.md §4).
 *
 * It lived in `fund.repository.ts`, which is a client module, so the server
 * could not reach it. The rule decides what each partner is credited in a
 * profit declaration, and the browser previews the same figures — both sides
 * have to agree, which is what a pure shared module is for (AGENTS.md).
 */

/** A partner, as much of one as the split needs. */
export interface PartnerShare {
  id: string;
  name: string;
  /** their percentage: of one project when `project_id` is set, of the company otherwise */
  share_pct: number;
  /**
   * An investor in this project only — a landowner's relative, an outside
   * investor (client, 2026-10-21). Null or absent = a partner of the whole
   * company.
   */
  project_id?: string | null;
  is_active: boolean;
}

export interface ShareSlice {
  partner_id: string;
  name: string;
  /** share of this project */
  share_pct: number;
  /** an investor in this project only, or one of the company's partners */
  kind: 'investor' | 'company';
  /** a company partner's share of the company, which their slice is scaled from */
  company_pct: number | null;
}

/**
 * The two cases the business actually has (client, 2026-10-21):
 *
 * 1. The company's partners own every project, in their company shares.
 * 2. Somebody may invest in one project only. They take their share of that
 *    project first; the company's partners share what is left, still in their
 *    company proportions.
 *
 * So Lakeview with Shafiqul at 30% and the company at 50/30/20 is Shafiqul
 * 30%, Karim 35%, Rahim 21%, Selina 14%. A separately negotiated split for one
 * project is not offered until that case is asked for again.
 */
export function splitProject(projectId: string, partners: PartnerShare[]): ShareSlice[] {
  const active = partners.filter((p) => p.is_active);
  const investors = active.filter((p) => p.project_id === projectId);
  const company = active.filter((p) => !p.project_id);
  const left = Math.max(0, 100 - investors.reduce((sum, p) => sum + p.share_pct, 0));
  /*
   * Falling back to 100 when the company's percentages add to nothing keeps
   * the division safe and the answer honest: with no company partners on file,
   * every company slice is 0 rather than NaN.
   */
  const companyTotal = company.reduce((sum, p) => sum + p.share_pct, 0) || 100;
  const round = (n: number) => Math.round(n * 100) / 100;

  /*
   * Biggest first, then by name. The tiebreak matters: two partners on the
   * same percentage would otherwise come back in whatever order the database
   * happened to return, and a cap table whose rows reshuffle between loads
   * reads as a bug.
   */
  const order = (a: PartnerShare, b: PartnerShare) =>
    b.share_pct - a.share_pct || a.name.localeCompare(b.name);

  return [
    ...investors
      .sort(order)
      .map((p) => ({
        partner_id: p.id,
        name: p.name,
        share_pct: p.share_pct,
        kind: 'investor' as const,
        company_pct: null,
      })),
    ...company
      .sort(order)
      .map((p) => ({
        partner_id: p.id,
        name: p.name,
        share_pct: round((p.share_pct * left) / companyTotal),
        kind: 'company' as const,
        company_pct: p.share_pct,
      })),
  ];
}

/* ------------------------------------------------------------------ *
 * As of a date
 * ------------------------------------------------------------------ */

/** A change to a partner's percentage, from the day it took effect. */
export interface ShareChange {
  partner_id: string;
  share_pct: number;
  effective_from: string;
  created_at: string;
}

/**
 * A partner's percentage on a given day.
 *
 * The partner's own `share_pct` is today's answer. Each change records the day
 * it took effect, so the last change on or before the date wins — and before
 * the first change the partner held whatever that change replaced, which is
 * why a change stores the percentage it *becomes* and the history is read
 * backwards from today when nothing applies yet.
 *
 * Without this a percentage changed in June would re-split March's declaration
 * the next time anybody opened it.
 */
export function shareOn(
  partner: { id: string; share_pct: number },
  changes: ShareChange[],
  date: string,
): number {
  const mine = changes
    .filter((c) => c.partner_id === partner.id)
    .sort(
      (a, b) =>
        a.effective_from.localeCompare(b.effective_from) ||
        a.created_at.localeCompare(b.created_at),
    );
  if (mine.length === 0) return partner.share_pct;

  const applied = mine.filter((c) => c.effective_from <= date);
  if (applied.length > 0) return applied[applied.length - 1]!.share_pct;

  /*
   * The date is before every recorded change, so nothing on file says what
   * they held then. The earliest change is the first thing known about them,
   * and it is the closest honest answer.
   */
  return mine[0]!.share_pct;
}

/** The partners as they stood on a day, ready for `splitProject`. */
export function partnersOn(
  partners: PartnerShare[],
  changes: ShareChange[],
  date: string,
): PartnerShare[] {
  return partners.map((p) => ({ ...p, share_pct: shareOn(p, changes, date) }));
}

/**
 * What the owners' side of a project comes to, as slices of the whole project.
 *
 * `held` is what the customers hold, so the owners keep the rest: unsold
 * shares and the never-offered part both belong to them, and a purchase that
 * was released or cancelled has already gone back (§4).
 */
export function ownerSlices(
  projectId: string,
  partners: PartnerShare[],
  held: number,
): ShareSlice[] {
  const owners = Math.max(0, 100 - held);
  if (owners <= 0) return [];
  const slices = splitProject(projectId, partners);
  if (slices.length === 0) return [];

  /*
   * The slices are percentages *of the project* as the owners' whole; scaled
   * to the part the owners actually keep. The remainder goes on the largest
   * slice, so the lines add back to the owners' part to the paisa rather than
   * drifting by a rounding step per partner.
   */
  const total = slices.reduce((sum, s) => sum + s.share_pct, 0) || 100;
  const scaled = slices.map((s) => ({
    ...s,
    share_pct: money((s.share_pct * owners) / total),
  }));
  const given = scaled.reduce((sum, s) => sum + s.share_pct, 0);
  const drift = money(owners - given);
  if (drift !== 0) {
    const biggest = scaled.reduce((at, s, i) => (s.share_pct > scaled[at]!.share_pct ? i : at), 0);
    scaled[biggest] = { ...scaled[biggest]!, share_pct: money(scaled[biggest]!.share_pct + drift) };
  }
  return scaled;
}
