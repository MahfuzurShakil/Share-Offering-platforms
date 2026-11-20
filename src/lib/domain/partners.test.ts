import { describe, expect, it } from 'vitest';
import {
  ownerSlices,
  partnersOn,
  shareOn,
  splitProject,
  type PartnerShare,
  type ShareChange,
} from './partners';

/*
 * Who owns the part of a project the customers do not (REVENUE-SHARE-PLAN.md
 * §4). The rule came out of `fund.repository.ts` so the server could share it;
 * these are the tests it never had there.
 */

const partner = (
  id: string,
  name: string,
  share_pct: number,
  project_id: string | null = null,
): PartnerShare => ({ id, name, share_pct, project_id, is_active: true });

/** The company: 50 / 30 / 20. */
const COMPANY = [
  partner('k', 'Karim', 50),
  partner('r', 'Rahim', 30),
  partner('s', 'Selina', 20),
];

describe('the owners of a project', () => {
  it('gives the company partners the whole project in their company shares', () => {
    const slices = splitProject('lakeview', COMPANY);
    expect(slices.map((s) => [s.name, s.share_pct])).toEqual([
      ['Karim', 50],
      ['Rahim', 30],
      ['Selina', 20],
    ]);
    expect(slices.every((s) => s.kind === 'company')).toBe(true);
  });

  /** The plan's own worked example (§4). */
  it("takes a project investor's share first, then splits what is left", () => {
    const slices = splitProject('lakeview', [
      ...COMPANY,
      partner('sh', 'Shafiqul', 30, 'lakeview'),
    ]);
    expect(slices.map((s) => [s.name, s.share_pct])).toEqual([
      ['Shafiqul', 30],
      ['Karim', 35],
      ['Rahim', 21],
      ['Selina', 14],
    ]);
    expect(slices[0]?.kind).toBe('investor');
    // a company partner's slice says what it was scaled from
    expect(slices[1]?.company_pct).toBe(50);
  });

  it("ignores an investor in somebody else's project", () => {
    const slices = splitProject('lakeview', [
      ...COMPANY,
      partner('sh', 'Shafiqul', 30, 'seapearl'),
    ]);
    expect(slices.map((s) => s.share_pct)).toEqual([50, 30, 20]);
  });

  it('leaves out a partner who is no longer active', () => {
    const slices = splitProject('lakeview', [
      ...COMPANY,
      { ...partner('x', 'Former', 40), is_active: false },
    ]);
    expect(slices.map((s) => s.name)).toEqual(['Karim', 'Rahim', 'Selina']);
  });

  it('gives nobody a NaN when no company partner is on file', () => {
    const slices = splitProject('lakeview', [partner('sh', 'Shafiqul', 30, 'lakeview')]);
    expect(slices.map((s) => s.share_pct)).toEqual([30]);
  });
});

describe('a percentage on a date', () => {
  /*
   * Karim went 40 → 50 in October and Rahim 40 → 30 the same day, so the
   * company's percentages add to 100 on both sides of the change. They have
   * to: `splitProject` shares out whatever is left between the company
   * partners in proportion, so a history where only one of them moves is an
   * inconsistent state rather than a smaller company.
   */
  const changes: ShareChange[] = [
    { partner_id: 'k', share_pct: 40, effective_from: '2026-04-01', created_at: '2026-03-20T10:00:00Z' },
    { partner_id: 'r', share_pct: 40, effective_from: '2026-04-01', created_at: '2026-03-20T10:00:00Z' },
    { partner_id: 'k', share_pct: 50, effective_from: '2026-10-01', created_at: '2026-09-20T10:00:00Z' },
    { partner_id: 'r', share_pct: 30, effective_from: '2026-10-01', created_at: '2026-09-20T10:00:00Z' },
  ];
  const karim = { id: 'k', share_pct: 50 };

  it('takes the last change on or before the day', () => {
    expect(shareOn(karim, changes, '2026-06-30')).toBe(40);
    expect(shareOn(karim, changes, '2026-10-01')).toBe(50);
    expect(shareOn(karim, changes, '2026-12-31')).toBe(50);
  });

  it("falls back to the earliest change before anything was recorded", () => {
    expect(shareOn(karim, changes, '2026-01-01')).toBe(40);
  });

  it("uses the partner's own figure when nothing was ever recorded", () => {
    expect(shareOn({ id: 's', share_pct: 20 }, changes, '2026-06-30')).toBe(20);
  });

  /*
   * This is the point of the whole mechanism: a percentage changed in October
   * must not re-split a period declared in June.
   */
  it('does not let a later change re-split an earlier period', () => {
    const june = partnersOn(COMPANY, changes, '2026-06-30');
    expect(splitProject('lakeview', june).map((s) => [s.name, s.share_pct])).toEqual([
      ['Karim', 40],
      ['Rahim', 40],
      ['Selina', 20],
    ]);

    // and October's split is the one the partners actually agreed then
    const october = partnersOn(COMPANY, changes, '2026-10-15');
    expect(splitProject('lakeview', october).map((s) => [s.name, s.share_pct])).toEqual([
      ['Karim', 50],
      ['Rahim', 30],
      ['Selina', 20],
    ]);
  });
});

describe('percentages that do not add to 100', () => {
  /*
   * Worth stating rather than discovering: the company partners always share
   * the whole of what is left, in proportion to each other. So percentages
   * adding to 90 do not leave 10% of the project unowned — they are read as
   * nine, nine and two parts of it. A screen that lets somebody save 40/30/20
   * should say so.
   */
  it('shares out the whole of what is left, in proportion', () => {
    const short = [partner('k', 'Karim', 40), partner('r', 'Rahim', 30), partner('s', 'Selina', 20)];
    const slices = splitProject('lakeview', short);
    expect(slices.map((s) => [s.name, s.share_pct])).toEqual([
      ['Karim', 44.44],
      ['Rahim', 33.33],
      ['Selina', 22.22],
    ]);
  });
});

describe('scaling the owners to what they actually keep', () => {
  it('gives the owners everything when the customers hold nothing', () => {
    const slices = ownerSlices('lakeview', COMPANY, 0);
    expect(slices.map((s) => s.share_pct)).toEqual([50, 30, 20]);
  });

  it('scales every slice to the part the owners keep', () => {
    // customers hold 25%, so the owners keep 75% between them
    const slices = ownerSlices('lakeview', COMPANY, 25);
    expect(slices.map((s) => [s.name, s.share_pct])).toEqual([
      ['Karim', 37.5],
      ['Rahim', 22.5],
      ['Selina', 15],
    ]);
    expect(slices.reduce((sum, s) => sum + s.share_pct, 0)).toBe(75);
  });

  it('puts the rounding remainder on the largest slice, so the lines add up', () => {
    const three = [partner('a', 'A', 1), partner('b', 'B', 1), partner('c', 'C', 1)];
    const slices = ownerSlices('lakeview', three, 0);
    expect(slices.reduce((sum, s) => sum + s.share_pct, 0)).toBe(100);
  });

  it('gives the owners nothing once the customers hold it all', () => {
    expect(ownerSlices('lakeview', COMPANY, 100)).toEqual([]);
    // and never a negative share, however the figures arrive
    expect(ownerSlices('lakeview', COMPANY, 120)).toEqual([]);
  });

  it('has nothing to say when no partner is on file', () => {
    expect(ownerSlices('lakeview', [], 25)).toEqual([]);
  });
});
