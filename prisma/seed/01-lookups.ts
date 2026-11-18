/**
 * Reference data — the rows an install cannot work without.
 *
 * This runs in production too, and it is idempotent: every row is matched on
 * its natural key and only created when missing, so running it again after an
 * upgrade adds what is new and leaves the client's own edits alone. Nothing
 * here is demo data; that comes from `scripts/demo/*` over the REST API.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ *
 * Roles and what each may do
 * ------------------------------------------------------------------ */

/**
 * The modules this product has. The prototype's matrix also covered land,
 * construction, procurement and flat sale; those return with their modules.
 */
const MODULES = [
  'dashboard',
  'project',
  'crm',
  'share_sale',
  'sales_team',
  'finance_collection',
  'finance_expense',
  'master_data',
  'user_management',
  'website',
] as const;

type Level = 'full' | 'approve' | 'create' | 'view' | 'own' | 'none';

/**
 * The starting point, transcribed from the prototype's permission matrix and
 * trimmed to these modules. Unlike the prototype's, this is only a *seed*: the
 * client edits roles and their rights from Users & Roles afterwards, which is
 * what the quotation promises ("roles are defined by you").
 */
const ROLES: {
  code: string;
  name: string;
  description: string;
  sort_order: number;
  rights: Partial<Record<(typeof MODULES)[number], Level>>;
  /** everything not named above */
  rest: Level;
}[] = [
  {
    code: 'super_admin',
    name: 'Super Admin',
    description: 'Everything, including users, roles and company settings.',
    sort_order: 1,
    rights: {},
    rest: 'full',
  },
  {
    code: 'management',
    name: 'Management',
    description: 'Sees the whole business and approves what needs a decision.',
    sort_order: 2,
    rights: {
      dashboard: 'full',
      share_sale: 'approve',
      finance_collection: 'approve',
      finance_expense: 'approve',
      user_management: 'view',
      master_data: 'view',
      website: 'view',
    },
    rest: 'view',
  },
  {
    code: 'project_manager',
    name: 'Project Manager',
    description: 'Runs the projects they are assigned to.',
    sort_order: 3,
    rights: {
      project: 'full',
      dashboard: 'view',
      share_sale: 'view',
      crm: 'none',
      sales_team: 'none',
      finance_collection: 'none',
      finance_expense: 'none',
      user_management: 'none',
      master_data: 'none',
      website: 'none',
    },
    rest: 'none',
  },
  {
    code: 'sales_executive',
    name: 'Sales Executive',
    description: 'Their own leads and the share purchases they sell.',
    sort_order: 4,
    rights: {
      crm: 'own',
      share_sale: 'create',
      project: 'view',
      sales_team: 'view',
      finance_collection: 'view',
    },
    rest: 'none',
  },
  {
    code: 'sales_manager',
    name: 'Sales Manager',
    description: 'The sales team, its leads and its commission.',
    sort_order: 5,
    rights: {
      crm: 'full',
      share_sale: 'full',
      sales_team: 'full',
      project: 'view',
      dashboard: 'view',
      finance_collection: 'view',
      website: 'view',
    },
    rest: 'none',
  },
  {
    code: 'head_of_sales',
    name: 'Head of Sales',
    description: 'Everything sales, plus approving what sales asks for.',
    sort_order: 6,
    rights: {
      crm: 'full',
      share_sale: 'full',
      sales_team: 'full',
      project: 'view',
      dashboard: 'full',
      finance_collection: 'approve',
      website: 'view',
    },
    rest: 'none',
  },
  {
    code: 'accounts',
    name: 'Accounts',
    description: 'The money: receipts, payouts, the ledger and the accounts.',
    sort_order: 7,
    rights: {
      finance_collection: 'full',
      finance_expense: 'full',
      share_sale: 'view',
      sales_team: 'view',
      project: 'view',
      dashboard: 'view',
      master_data: 'view',
    },
    rest: 'none',
  },
];

async function seedRoles(): Promise<void> {
  for (const role of ROLES) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      // an existing role keeps the client's own name and description
      update: {},
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        sort_order: role.sort_order,
        is_system: true,
      },
    });

    for (const moduleKey of MODULES) {
      const level = role.rights[moduleKey] ?? role.rest;
      await prisma.rolePermission.upsert({
        where: { role_id_module: { role_id: saved.id, module: moduleKey } },
        // a permission the client changed stays changed
        update: {},
        create: { role_id: saved.id, module: moduleKey, level },
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Option lists
 * ------------------------------------------------------------------ */

/** category → the values a fresh install starts with. */
const OPTIONS: { category: string; scope?: string; values: readonly string[] }[] = [
  // what an investor-facing project may list
  {
    category: 'amenity',
    values: [
      'Lift',
      'Generator',
      'Parking',
      'Security',
      'CCTV',
      'Community Space',
      'Rooftop Garden',
      'Gymnasium',
      'Prayer Room',
      'Children Play Area',
      'Substation',
      'Fire Fighting System',
    ],
  },
  // REVENUE-SHARE-PLAN.md §2.1 — each business keeps its own heads
  {
    category: 'revenue_income_head',
    values: [
      'Room rent',
      'Food & beverage',
      'Hall & event booking',
      'Shop / floor rent',
      'Service charge',
      'Parking',
      'Other income',
    ],
  },
  {
    category: 'revenue_expense_head',
    values: [
      'Salary & wages',
      'Utilities',
      'Maintenance & repair',
      'Supplies',
      'Marketing',
      'Government fees & tax',
      'Loan interest',
      'Other cost',
    ],
  },
  // REVENUE-SHARE-PLAN.md §6 — the order is the rank: Founder at the top
  {
    category: 'org_designation',
    values: [
      'Founder',
      'Director',
      'General Manager',
      'Team Lead',
      'Senior Sales',
      'Sales Executive',
      'Freelance Agent',
    ],
  },
  // how an investor describes what they do, on their profile
  {
    category: 'profession',
    values: [
      'Business',
      'Service holder',
      'Doctor',
      'Engineer',
      'Teacher',
      'Lawyer',
      'Retired',
      'Expatriate',
      'Other',
    ],
  },
  // what a lead says they can put in
  {
    category: 'budget_range',
    values: [
      'Under 5 Lakh',
      '5 – 10 Lakh',
      '10 – 25 Lakh',
      '25 – 50 Lakh',
      '50 Lakh – 1 Crore',
      'Above 1 Crore',
    ],
  },
  { category: 'land_size_unit', values: ['katha', 'bigha', 'decimal'] },
  // the papers each kind of record can carry
  {
    category: 'document_type',
    scope: 'project',
    values: [
      'layout_floor_plan',
      'brochure',
      'gallery_image',
      'valuation_report',
      'title_deed',
      'mutation_paper',
      'tax_receipt',
      'other',
    ],
  },
  {
    category: 'document_type',
    scope: 'share_offering',
    values: ['valuation_report', 'offer_terms', 'board_resolution', 'other'],
  },
  {
    category: 'document_type',
    scope: 'share_sale',
    values: [
      'share_agreement',
      'allotment_letter',
      'share_certificate',
      'payment_receipt',
      'other',
    ],
  },
  {
    category: 'document_type',
    scope: 'customer',
    values: ['nid_copy', 'photo', 'tin_certificate', 'bank_details', 'nominee_nid', 'other'],
  },
  { category: 'document_type', scope: 'lead', values: ['nid_copy', 'other'] },
  { category: 'document_type', scope: 'payment', values: ['deposit_slip', 'receipt', 'other'] },
  { category: 'document_type', scope: 'blog_post', values: ['cover_image', 'other'] },
];

async function seedOptions(): Promise<void> {
  for (const group of OPTIONS) {
    let order = 0;
    for (const value of group.values) {
      order += 1;
      const existing = await prisma.lookupValue.findFirst({
        where: { category: group.category, scope: group.scope ?? null, value },
      });
      if (existing) continue;
      await prisma.lookupValue.create({
        data: {
          category: group.category,
          scope: group.scope ?? null,
          value,
          sort_order: order,
          is_system: true,
        },
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * The company's own record
 * ------------------------------------------------------------------ */

async function seedCompany(): Promise<void> {
  const existing = await prisma.companySettings.findFirst();
  if (existing) return;
  /*
   * Deliberately blank rather than branded: the name, logo and letterhead are
   * the client's, filled in from Administration → Company Settings. Nothing in
   * the code may assume a brand (AGENTS.md).
   */
  await prisma.companySettings.create({
    data: { company_name: 'Your Company', default_currency: 'BDT' },
  });
}

async function main(): Promise<void> {
  await seedRoles();
  await seedOptions();
  await seedCompany();

  const [roles, permissions, options] = await Promise.all([
    prisma.role.count(),
    prisma.rolePermission.count(),
    prisma.lookupValue.count(),
  ]);
  console.log(
    `Reference data ready: ${roles} roles, ${permissions} permissions, ${options} option values.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
