'use client';

import { db } from '../db/database';
import type { Customer, Lead, ShareSale } from '../db/types';
import { nextCode } from '../utils/id';
import { BaseRepository, type NewRecord } from './base.repository';
import { documentRepository } from './document.repository';
import { normalizePhone } from './lead.repository';

export interface CustomerFilters {
  /** one field per thing you might know — a single box mixing them all
   *  matched too loosely and made the results feel random */
  name?: string;
  phone?: string;
  nid?: string;
  profession?: string;
  /** 'any' | 'none' | 'active' | 'signed' — by share purchase, Phase 1's only sale */
  holding_state?: 'any' | 'none' | 'active' | 'signed';
}

export interface CustomerWithRelations extends Customer {
  /** share purchases, newest first */
  shares: ShareSale[];
  lead: Lead | undefined;
  /**
   * Money roll-up across this investor's live purchases. A schedule hangs off
   * one purchase, not off a customer — somebody holding shares in two projects
   * has two schedules — so what belongs on a customer page is the total.
   */
  finance: {
    total_value: number;
    total_received: number;
    outstanding: number;
    received_by_sale: Record<string, number>;
  };
}

/** Purchases that still stand — anything not released or cancelled. */
const LIVE_SALE: ReadonlySet<string> = new Set(['reserved', 'agreement_signed']);

/**
 * Customers (investors), Phase 1.
 *
 * In the prototype this class sat inside `booking.repository.ts` because a
 * customer was a flat buyer. Here a customer is a share holder, so it stands
 * on its own and counts share purchases rather than bookings.
 */
class CustomerRepository extends BaseRepository<Customer> {
  constructor() {
    super(() => db.customers);
  }

  async generateCode(): Promise<string> {
    const codes = (await db.customers.toArray()).map((c) => c.code);
    return nextCode('CUST', codes);
  }

  async create(input: NewRecord<Customer>, createdBy: string | null = null): Promise<Customer> {
    const code = input.code?.trim() ? input.code : await this.generateCode();
    return super.create({ ...input, code, phone: normalizePhone(input.phone) }, createdBy);
  }

  async findByPhone(phone: string): Promise<Customer | undefined> {
    const normalized = normalizePhone(phone);
    return (await db.customers.toArray()).find((c) => normalizePhone(c.phone) === normalized);
  }

  /**
   * Customer record for a lead, reusing the existing one when the investor is
   * already known (phone is unique). Name/phone/email are copied off the lead
   * so nothing has to be retyped.
   */
  async fromLead(leadId: string, createdBy: string | null = null): Promise<Customer> {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new Error('Lead not found');

    const existing = await this.findByPhone(lead.phone);
    if (existing) {
      // link it back to the lead if it was created some other way
      if (!existing.lead_id) await this.update(existing.id, { lead_id: leadId });
      return existing;
    }

    return this.create(
      {
        code: '',
        name: lead.name,
        phone: lead.phone,
        email: lead.email ?? null,
        nid: null,
        address: null,
        profession: null,
        lead_id: leadId,
      },
      createdBy,
    );
  }

  async list(filters: CustomerFilters = {}): Promise<Customer[]> {
    let rows = await db.customers.toArray();

    if (filters.name?.trim()) {
      const q = filters.name.trim().toLowerCase();
      // name box also matches the code and email — that is what people type there
      rows = rows.filter((c) =>
        [c.name, c.code, c.email].filter(Boolean).some((f) => String(f).toLowerCase().includes(q)),
      );
    }
    if (filters.phone?.trim()) {
      const q = normalizePhone(filters.phone);
      rows = rows.filter((c) => normalizePhone(c.phone).includes(q));
    }
    if (filters.nid?.trim()) {
      const q = filters.nid.trim().toLowerCase();
      rows = rows.filter((c) => (c.nid ?? '').toLowerCase().includes(q));
    }
    if (filters.profession?.trim()) {
      const q = filters.profession.trim().toLowerCase();
      rows = rows.filter((c) => (c.profession ?? '').toLowerCase().includes(q));
    }

    if (filters.holding_state && filters.holding_state !== 'any') {
      const sales = await db.share_sales.toArray();
      rows = rows.filter((c) => {
        const live = sales.filter((s) => s.customer_id === c.id && LIVE_SALE.has(s.status));
        if (filters.holding_state === 'none') return live.length === 0;
        if (filters.holding_state === 'signed') {
          return live.some((s) => s.status === 'agreement_signed');
        }
        return live.length > 0;
      });
    }

    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async listForCustomer(customerId: string): Promise<ShareSale[]> {
    const rows = await db.share_sales.where('customer_id').equals(customerId).toArray();
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /*
   * `null`, not `undefined`, when the record is gone. `useLiveQuery` reports
   * its own pending state as `undefined`, so a repository returning
   * `undefined` for "no such row" leaves the detail page unable to tell a
   * deleted record from a query still in flight — it sat on "Loading…"
   * forever instead of saying the record no longer exists.
   */
  async getWithRelations(id: string): Promise<CustomerWithRelations | null> {
    const customer = await this.getById(id);
    if (!customer) return null;

    const shares = await this.listForCustomer(id);
    const live = shares.filter((s) => LIVE_SALE.has(s.status));

    const payments = await db.share_payments.toArray();
    const received_by_sale: Record<string, number> = {};
    let total_received = 0;
    for (const sale of live) {
      const paid = payments
        .filter((p) => p.sale_id === sale.id)
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      received_by_sale[sale.id] = paid;
      total_received += paid;
    }
    const total_value = live.reduce((sum, s) => sum + (Number(s.total_price) || 0), 0);

    return {
      ...customer,
      shares,
      lead: customer.lead_id ? await db.leads.get(customer.lead_id) : undefined,
      finance: {
        total_value,
        total_received,
        outstanding: total_value - total_received,
        received_by_sale,
      },
    };
  }

  /**
   * What every customer holds, in one pass, for the list page.
   *
   * The prototype had a `customer-portfolio` repository spanning homes and
   * shares because a customer could be a buyer or an investor. Here there is
   * one kind of holding, so the roll-up belongs with the customer.
   */
  async portfolios(): Promise<Map<string, { count: number; value: number; paid: number; due: number }>> {
    const [sales, payments] = await Promise.all([
      db.share_sales.toArray(),
      db.share_payments.toArray(),
    ]);
    const paidBySale = new Map<string, number>();
    for (const p of payments) {
      paidBySale.set(p.sale_id, (paidBySale.get(p.sale_id) ?? 0) + (Number(p.amount) || 0));
    }
    const out = new Map<string, { count: number; value: number; paid: number; due: number }>();
    for (const s of sales) {
      if (!LIVE_SALE.has(s.status)) continue;
      const row = out.get(s.customer_id) ?? { count: 0, value: 0, paid: 0, due: 0 };
      row.count += 1;
      row.value += Number(s.total_price) || 0;
      row.paid += paidBySale.get(s.id) ?? 0;
      out.set(s.customer_id, row);
    }
    for (const row of out.values()) row.due = Math.max(0, row.value - row.paid);
    return out;
  }

  /** A customer holding shares must not vanish underneath them. */
  async removeCascade(id: string): Promise<{ removed: boolean; reason?: string }> {
    const shares = await this.listForCustomer(id);
    if (shares.length > 0) {
      return {
        removed: false,
        reason: `This customer has ${shares.length} share purchase${shares.length === 1 ? '' : 's'}. Release or cancel those first.`,
      };
    }
    await documentRepository.removeForEntity('customer', id);
    await this.remove(id);
    return { removed: true };
  }
}

export const customerRepository = new CustomerRepository();
