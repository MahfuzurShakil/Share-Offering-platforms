import { prisma } from '../db/prisma';
import { invalid } from '../http/respond';

/**
 * Reference data — the option lists the client edits rather than the software
 * branches on (AGENTS.md).
 *
 * Statuses are not here and never will be: they are ENUMs in code, because the
 * code decides what happens next from them. What lives here is the vocabulary
 * — designations, income and expense heads, professions, document types — all
 * of which the client renames and reorders without anybody rebuilding
 * anything.
 *
 * Read-only for now. The Master Data screens are S4 and still on the interim
 * layer; what this serves is the pickers inside the modules that have moved.
 */

/**
 * The categories the software reads, and nothing else.
 *
 * A route that took any `category` would let a caller fish for whatever else
 * ends up in this table — and the table is where a client's own vocabulary
 * goes, which is not the same as being public.
 */
const READABLE = new Set([
  'org_designation',
  'revenue_income_head',
  'revenue_expense_head',
  'profession',
  'budget_range',
  'amenity',
  'land_size_unit',
  'document_type',
]);

export interface LookupDto {
  id: string;
  category: string;
  scope: string | null;
  value: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
  /** a seeded row the client may rename but not delete */
  is_system: boolean;
}

/** One category's options, in the order the client put them in. */
export async function listLookups(
  category: string,
  scope: string | null = null,
  options: { includeInactive?: boolean } = {},
): Promise<LookupDto[]> {
  if (!READABLE.has(category)) {
    throw invalid('That is not an option list this screen may read.', {
      category: 'Unknown list.',
    });
  }

  const rows = await prisma.lookupValue.findMany({
    where: {
      category,
      ...(scope ? { scope } : {}),
      ...(options.includeInactive ? {} : { is_active: true }),
    },
    select: {
      id: true,
      category: true,
      scope: true,
      value: true,
      code: true,
      sort_order: true,
      is_active: true,
      is_system: true,
    },
    orderBy: [{ sort_order: 'asc' }, { value: 'asc' }],
  });
  return rows as LookupDto[];
}
