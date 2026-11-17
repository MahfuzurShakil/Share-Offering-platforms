'use client';

import { db } from '../db/database';
import type { Customer, Project, ShareOffering, SharePayment, ShareSale } from '../db/types';
import { offeringFeeRule, viewSale, type SaleView } from '../domain/share-sale';
import { todayLocal } from '../utils/format';

/*
 * One customer and what they hold.
 *
 * In the prototype this file carried two kinds of holding, because a customer
 * could be a flat buyer as well as an investor. Here a customer holds project
 * shares, so there is one kind — but the shape of the page it feeds is kept,
 * so the flat side can be added back beside it in Phase 2.
 */

export interface MoneyTotals {
  count: number;
  value: number;
  received: number;
  balance: number;
  overdue: number;
}

export interface ShareHolding {
  view: SaleView;
  offering?: ShareOffering;
  project?: Project;
}

export interface CustomerPortfolio {
  customer: Customer;
  /** true once they hold shares, or have asked to */
  is_investor: boolean;
  shares: MoneyTotals & { shares: number; pct: number };
  total: MoneyTotals;
}

/** A share purchase that is still held: reserved, being paid or paid. */
const HOLDS = (s: ShareSale) =>
  s.status === 'reserved' || s.status === 'agreement_signed' || s.status === 'fully_paid';

const EMPTY: MoneyTotals = { count: 0, value: 0, received: 0, balance: 0, overdue: 0 };

function sum(rows: MoneyTotals[]): MoneyTotals {
  return rows.reduce(
    (t, r) => ({
      count: t.count + r.count,
      value: t.value + r.value,
      received: t.received + r.received,
      balance: t.balance + r.balance,
      overdue: t.overdue + r.overdue,
    }),
    EMPTY,
  );
}

async function readAll(today: string) {
  const [customers, sales, offerings, installments, sharePayments, requests] = await Promise.all([
    db.customers.toArray(),
    db.share_sales.toArray(),
    db.share_offerings.toArray(),
    db.share_installments.toArray(),
    db.share_payments.toArray(),
    db.share_requests.toArray(),
  ]);
  const offeringById = new Map(offerings.map((o) => [o.id, o]));
  const saleViews = new Map<string, SaleView>();
  for (const s of sales) {
    const o = offeringById.get(s.offering_id);
    saleViews.set(s.id, viewSale(s, installments, sharePayments, today, offeringFeeRule(o)));
  }
  return { customers, sales, requests, saleViews, offeringById };
}

function portfolioOf(customer: Customer, data: Awaited<ReturnType<typeof readAll>>): CustomerPortfolio {
  const held = data.sales.filter((s) => s.customer_id === customer.id && HOLDS(s));
  const asked = data.requests.some(
    (r) => r.customer_id === customer.id && (r.status === 'new' || r.status === 'contacted'),
  );

  const shareTotals = sum(
    held.map((s) => {
      const v = data.saleViews.get(s.id)!;
      return { count: 1, value: s.total_price, received: v.paid, balance: v.outstanding, overdue: v.due_now };
    }),
  );

  return {
    customer,
    is_investor: held.length > 0 || asked || customer.customer_type === 'investor',
    shares: {
      ...shareTotals,
      shares: held.reduce((t, s) => t + s.shares, 0),
      pct: held.reduce((t, s) => t + s.share_pct, 0),
    },
    total: shareTotals,
  };
}

export const customerPortfolioRepository = {
  /** Every customer's money, for the Customers list. */
  async all(today = todayLocal()): Promise<Map<string, CustomerPortfolio>> {
    const data = await readAll(today);
    return new Map(data.customers.map((c) => [c.id, portfolioOf(c, data)]));
  },

  /** One customer's holdings in full, for the customer page. */
  async forCustomer(
    customerId: string,
    today = todayLocal(),
  ): Promise<{
    portfolio: CustomerPortfolio;
    shares: ShareHolding[];
    payments: CustomerPaymentRow[];
  } | null> {
    const data = await readAll(today);
    const customer = data.customers.find((c) => c.id === customerId);
    if (!customer) return null;
    const sales = data.sales.filter((s) => s.customer_id === customerId && s.status !== 'released');
    const [projects, sharePays] = await Promise.all([
      db.projects.toArray(),
      db.share_payments.where('sale_id').anyOf(sales.map((s) => s.id)).toArray(),
    ]);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const shares: ShareHolding[] = sales.map((s) => ({
      view: data.saleViews.get(s.id)!,
      offering: data.offeringById.get(s.offering_id),
      project: projectById.get(s.project_id),
    }));
    const saleCode = new Map(sales.map((s) => [s.id, s.code]));
    const payments: CustomerPaymentRow[] = sharePays
      .map((p: SharePayment) => ({
        id: p.id,
        date: p.paid_on,
        amount: p.amount,
        late_fee: p.late_fee,
        against: saleCode.get(p.sale_id) ?? 'Share purchase',
        href: `/admin/share-sale/sales/${p.sale_id}?from=customer`,
        reference: p.reference ?? null,
        online: p.channel === 'online',
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    return { portfolio: portfolioOf(customer, data), shares, payments };
  },
};

/** One payment on the customer's ledger. */
export interface CustomerPaymentRow {
  id: string;
  date: string;
  amount: number;
  late_fee: number;
  against: string;
  href: string;
  reference: string | null;
  online: boolean;
}
