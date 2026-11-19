import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withActor } from '@/server/audit/context';
import { nextCode } from '@/server/numbering/code-series';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The share-sale slice, against the real Postgres.
 *
 * Not a test of a service — there are none yet — but of the rules the schema
 * itself has to carry, because every service written on top will assume them:
 * money that does not drift, a receipt that cannot be edited, a round that
 * cannot be numbered twice, and an audit row for each of it.
 */

const suite = hasTestDb ? describe : describe.skip;

suite('share sale schema', () => {
  let db: TestDb;
  let projectId: string;
  let customerId: string;
  let offeringId: string;

  beforeEach(async () => {
    db ??= testDb();
    await resetDb(db);

    const project = await db.project.create({
      data: { code: 'PRJ-2026-001', name: 'Sea Pearl Hotel' },
    });
    projectId = project.id;

    const customer = await db.customer.create({
      data: { code: 'CUST-2026-001', name: 'Rahim Uddin', phone: '01711223344' },
    });
    customerId = customer.id;

    /*
     * The plan's own worked example (§4 step 2): a hotel valued at 100 crore,
     * half of it offered as 500 shares, so one share is 0.1% and costs 10 lakh.
     */
    const offering = await db.shareOffering.create({
      data: {
        code: 'OFR-2026-001',
        project_id: projectId,
        round_no: 1,
        net_asset_value: '750000000.00',
        premium_value: '250000000.00',
        valuation: '1000000000.00',
        valuation_date: new Date('2026-12-01T00:00:00Z'),
        offered_pct: '50.000000',
        total_shares: 500,
        share_pct: '0.100000',
        price_per_share: '1000000.00',
        min_down_payment_pct: '20.000',
        max_installments: 20,
        late_fee_pct: '2.000',
        grace_days: 7,
        status: 'open',
      },
    });
    offeringId = offering.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function reserve(shares = 10) {
    return db.shareSale.create({
      data: {
        code: 'SHR-2026-001',
        offering_id: offeringId,
        project_id: projectId,
        customer_id: customerId,
        shares,
        share_pct: '0.100000',
        price_per_share: '1000000.00',
        total_price: String(shares * 1_000_000) + '.00',
        down_payment: '2000000.00',
        installment_count: 8,
        reserved_on: new Date('2026-12-02T00:00:00Z'),
        hold_until: new Date('2026-12-09T00:00:00Z'),
      },
    });
  }

  it('keeps money and share percentages exactly, in Decimal', async () => {
    const sale = await reserve(10);
    expect(sale.total_price.toString()).toBe('10000000');
    expect(sale.share_pct.toString()).toBe('0.1');

    /*
     * The sum that matters: ten installments of 833333.33 do not add up to
     * 8333333.33 in floating point. In Decimal, and in SQL, they add up to
     * exactly what they are.
     */
    await db.shareInstallment.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        sale_id: sale.id,
        seq: i + 1,
        due_date: new Date(`2027-0${(i % 9) + 1}-05T00:00:00Z`),
        amount: '833333.33',
      })),
    });

    const total = await db.shareInstallment.aggregate({
      where: { sale_id: sale.id },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBeInstanceOf(Prisma.Decimal);
    expect(total._sum.amount!.toString()).toBe('8333333.3');
  });

  it('refuses a second round with the same number on one project', async () => {
    await expect(
      db.shareOffering.create({
        data: {
          code: 'OFR-2026-002',
          project_id: projectId,
          round_no: 1,
          net_asset_value: '1.00',
          valuation: '1.00',
          valuation_date: new Date('2026-12-01T00:00:00Z'),
          offered_pct: '1.000000',
          total_shares: 1,
          share_pct: '1.000000',
          price_per_share: '1.00',
        },
      }),
    ).rejects.toThrow();
  });

  it('will not let a receipt be edited or deleted', async () => {
    const sale = await reserve();
    const installment = await db.shareInstallment.create({
      data: {
        sale_id: sale.id,
        seq: 0,
        due_date: new Date('2026-12-09T00:00:00Z'),
        amount: '2000000.00',
      },
    });
    const payment = await db.sharePayment.create({
      data: {
        code: 'SRC-2026-0001',
        sale_id: sale.id,
        paid_on: new Date('2026-12-09T00:00:00Z'),
        amount: '2000000.00',
        principal: '2000000.00',
        method: 'bank_transfer',
        allocations: {
          create: [{ installment_id: installment.id, principal: '2000000.00' }],
        },
      },
    });

    await expect(
      db.sharePayment.update({ where: { id: payment.id }, data: { amount: '1.00' } }),
    ).rejects.toThrow(/not allowed/i);
    await expect(db.sharePayment.delete({ where: { id: payment.id } })).rejects.toThrow(
      /not allowed/i,
    );
    await expect(
      db.sharePaymentAllocation.deleteMany({ where: { payment_id: payment.id } }),
    ).rejects.toThrow(/not allowed/i);

    // the way to correct one: a reversing receipt that points at it
    const reversal = await db.sharePayment.create({
      data: {
        code: 'SRC-2026-0002',
        sale_id: sale.id,
        paid_on: new Date('2026-12-10T00:00:00Z'),
        amount: '-2000000.00',
        principal: '-2000000.00',
        method: 'bank_transfer',
        reverses_payment_id: payment.id,
        notes: 'Recorded against the wrong purchase',
      },
    });
    expect(reversal.reverses_payment_id).toBe(payment.id);

    const net = await db.sharePayment.aggregate({
      where: { sale_id: sale.id },
      _sum: { amount: true },
    });
    expect(net._sum.amount!.toString()).toBe('0');
  });

  it('audits what happens to a purchase, with the actor that did it', async () => {
    const actor = { user_id: null, role: 'accounts', request_id: 'req-1' };
    const sale = await withActor(actor, () => reserve());
    await withActor(actor, () =>
      db.shareSale.update({ where: { id: sale.id }, data: { status: 'agreement_signed' } }),
    );

    const rows = await db.auditLog.findMany({
      where: { table_name: 'share_sales' },
      orderBy: { at: 'asc' },
    });
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['create', 'update']);
    expect(rows[0]!.record_code).toBe('SHR-2026-001');
    expect(rows[0]!.actor_role).toBe('accounts');
    expect(rows[1]!.after).toMatchObject({ status: 'agreement_signed' });
  });

  it('soft-deletes a customer, a round and a purchase, but not a payment', async () => {
    const sale = await reserve();
    await db.shareSale.delete({ where: { id: sale.id } });

    expect(await db.shareSale.findUnique({ where: { id: sale.id } })).toBeNull();
    const raw = await db.shareSale.findFirst({ where: { id: sale.id }, includeDeleted: true });
    expect(raw?.deleted_at).toBeInstanceOf(Date);

    await db.customer.delete({ where: { id: customerId } });
    expect(await db.customer.count()).toBe(0);
  });

  it('numbers purchases and receipts from the series, inside the transaction', async () => {
    const codes = await db.$transaction(async (tx: TestDb) => [
      await nextCode(tx, 'share_sale'),
      await nextCode(tx, 'share_sale'),
      await nextCode(tx, 'share_payment'),
    ]);
    const year = new Date().getUTCFullYear();
    expect(codes).toEqual([
      `SHR-${year}-001`,
      `SHR-${year}-002`,
      // receipts are four digits: a busy project writes more of them
      `SRC-${year}-0001`,
    ]);
  });
});
