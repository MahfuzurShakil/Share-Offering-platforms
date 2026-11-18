import type { LucideIcon } from 'lucide-react';
import type { PermissionModule } from '@/lib/domain/permissions';
import {
  Building2,
  Globe,
  LayoutDashboard,
  PieChart,
  Network,
  UserRound,
  Wallet,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  /**
   * Which module this item belongs to. The sidebar hides items the signed-in
   * role cannot open, reading the same rights the server enforces — so the
   * menu is the first place a permission shows up rather than a table nobody
   * reads, and it can never offer a screen the API would refuse.
   */
  module: PermissionModule | null;
  /** modules not built yet render disabled, so the shell shows the full map */
  disabled?: boolean;
  /**
   * Other paths that belong to this item: a detail page that lives outside the
   * list's own path (a share purchase opened from Investors & Dues).
   */
  activeFor?: string[];
}

/**
 * Material Requests is the Site → Procurement bridge of Section 6.5. Since
 * 2026-10-11 it has one entry, under Procurement, for everyone with access:
 * the site raises and follows its own requests from the project's Materials
 * tab, and this list is every project's requests in one place.
 */

export interface NavGroup {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

/** Sidebar groups, Phase 1: the share-sale product's own modules. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    items: [{ label: 'Overview', href: '/admin', module: null }],
  },
  {
    // project starts the life cycle; land sits under it (client, 2026-10-10)
    label: 'Projects',
    icon: Building2,
    items: [
      { label: 'All Projects', href: '/admin/projects', module: 'project' },
    ],
  },
  {
    label: 'Sales & CRM',
    icon: UserRound,
    items: [
      { label: 'Leads', href: '/admin/leads', module: 'crm' },
      { label: 'Customers', href: '/admin/customers', module: 'share_sale' },
      // SALES-FLOW-PLAN.md S5 — who owes what against their agreement, in every purchase mode
    ],
  },
  /*
   * PROJECT-SHARE-SALE-PLAN.md: once a project is set up, the owner sells part
   * of it as shares — offerings first, then each customer's purchase.
   */
  {
    label: 'Share Sale',
    icon: PieChart,
    items: [
      { label: 'Share Offerings', href: '/admin/share-sale', module: 'share_sale' },
      // a purchase page is reached from this list, not from Share Offerings (feedback D1)
      { label: 'Investors & Dues', href: '/admin/share-sale/investors', module: 'share_sale', activeFor: ['/admin/share-sale/sales'] },
      // every payment investors made, across all projects and purchases
      { label: 'Transactions', href: '/admin/share-sale/transactions', module: 'share_sale' },
      { label: 'Customer Requests', href: '/admin/share-sale/requests', module: 'share_sale' },
      // REVENUE-SHARE-PLAN.md — each project's profit, shared; and the payouts holders ask for
      { label: 'Profit Distributions', href: '/admin/share-sale/profit', module: 'share_sale' },
      { label: 'Profit Withdrawals', href: '/admin/share-sale/withdrawals', module: 'share_sale' },
    ],
  },
  /*
   * REVENUE-SHARE-PLAN.md §6–7: the sales organisation (any depth) and the
   * commission it earns, released in stages as buyers pay.
   */
  {
    label: 'Sales Team',
    icon: Network,
    items: [
      { label: 'Org Chart', href: '/admin/sales-team', module: 'sales_team' },
      { label: 'Members', href: '/admin/sales-team/members', module: 'sales_team' },
      { label: 'Commission Plans', href: '/admin/sales-team/plans', module: 'sales_team' },
      { label: 'Commissions', href: '/admin/sales-team/commissions', module: 'sales_team' },
      { label: 'Payouts', href: '/admin/sales-team/payouts', module: 'sales_team' },
    ],
  },
  /*
   * No Site Progress group (client feedback 2026-10-11): site log updates and
   * material requests are made from the project's own tabs. Procurement keeps
   * the all-project request list below.
   */
  /*
   * The money screens: whose capital the company holds, what it owes on its
   * loans, and what the accounts hold today. Bills to pay and the payment
   * history belong to the construction build (Phase 2); the General Ledger
   * joins this group in S4.
   */
  {
    label: 'Money',
    icon: Wallet,
    items: [
      { label: 'Fund & Partners', href: '/admin/fund', module: 'finance_expense' },
      { label: 'Loans', href: '/admin/fund/loans', module: 'finance_expense' },
      { label: 'Cash Position', href: '/admin/cash', module: 'finance_expense' },
    ],
  },
  {
    label: 'Administration',
    icon: Users,
    items: [
      { label: 'Users & Roles', href: '/admin/users', module: 'user_management' },
      { label: 'Master Data', href: '/admin/master-data', module: 'master_data' },
      { label: 'Company Settings', href: '/admin/settings', module: 'master_data' },
    ],
  },
  {
    // Public Portal v2.0 §6.2: the website's own content, apart from company settings
    label: 'Website',
    icon: Globe,
    items: [
      { label: 'Website Content', href: '/admin/website', module: 'website' },
      { label: 'Blog', href: '/admin/blog', module: 'website' },
    ],
  },
];

/*
 * There used to be a `HELP_ITEM` pinned to the bottom of the sidebar. It
 * rendered as plain text rather than a link, and the `/admin/help` route it
 * named does not exist — typing the URL returned a 404. Removed rather than
 * left looking clickable; it comes back when there is something to open.
 */
