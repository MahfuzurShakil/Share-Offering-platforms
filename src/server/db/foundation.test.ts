import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withActor } from '@/server/audit/context';
import { nextCode, periodOf } from '@/server/numbering/code-series';
import type { Tx } from '@/server/db/prisma';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The rules the whole platform leans on, tested against a real Postgres:
 * display codes that cannot be issued twice, an audit row for every change
 * whether or not the caller asked for one, an append-only audit log, and soft
 * delete that actually hides a row from ordinary reads.
 */

const suite = hasTestDb ? describe : describe.skip;

suite('database foundation', () => {
  let db: TestDb;

  beforeEach(async () => {
    db ??= testDb();
    await resetDb(db);
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe('display codes', () => {
    it('numbers from one, pads, and stamps the year', async () => {
      const year = periodOf();
      const first = await db.$transaction((tx: Tx) => nextCode(tx, 'project'));
      const second = await db.$transaction((tx: Tx) => nextCode(tx, 'project'));

      expect(first).toBe(`PRJ-${year}-001`);
      expect(second).toBe(`PRJ-${year}-002`);
    });

    it('keeps a series per module', async () => {
      const year = periodOf();
      await db.$transaction((tx: Tx) => nextCode(tx, 'project'));
      const sale = await db.$transaction((tx: Tx) => nextCode(tx, 'share_sale'));

      expect(sale).toBe(`SHR-${year}-001`);
    });

    it('hands the same number to nobody, even when ten people save at once', async () => {
      const codes = await Promise.all(
        Array.from({ length: 10 }, () => db.$transaction((tx: Tx) => nextCode(tx, 'customer'))),
      );

      expect(new Set(codes).size).toBe(10);
      expect([...codes].sort()).toEqual(
        Array.from({ length: 10 }, (_, i) => `CUST-${periodOf()}-${String(i + 1).padStart(3, '0')}`),
      );
    });

    it('leaves no gap when a save fails — the number goes back', async () => {
      const first = await db.$transaction((tx: Tx) => nextCode(tx, 'loan'));
      await expect(
        db.$transaction(async (tx: Tx) => {
          await nextCode(tx, 'loan');
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      const afterRollback = await db.$transaction((tx: Tx) => nextCode(tx, 'loan'));

      expect(first).toMatch(/-001$/);
      /*
       * The counter is bumped inside the transaction, so the failed save
       * returns its number: an unbroken series, which is what a receipt book
       * is expected to be.
       */
      expect(afterRollback).toMatch(/-002$/);
    });
  });

  describe('audit trail', () => {
    it('writes a row for a create, with the actor, without being asked', async () => {
      const project = await withActor({ user_id: null, role: 'super_admin', ip: '127.0.0.1' }, () =>
        db.project.create({ data: { code: 'PRJ-2026-900', name: 'Audited' } }),
      );

      const logs = await db.auditLog.findMany({ where: { table_name: 'projects' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        action: 'create',
        record_id: project.id,
        record_code: 'PRJ-2026-900',
        actor_role: 'super_admin',
        ip: '127.0.0.1',
      });
    });

    it('logs only what changed on an update', async () => {
      const project = await db.project.create({
        data: { code: 'PRJ-2026-901', name: 'Before', location_summary: 'Dhaka' },
      });
      await db.project.update({ where: { id: project.id }, data: { name: 'After' } });

      const update = await db.auditLog.findFirst({ where: { action: 'update' } });
      expect(update?.before).toEqual({ name: 'Before' });
      expect(update?.after).toEqual({ name: 'After' });
    });

    it('cannot be edited or deleted, row by row', async () => {
      await db.project.create({ data: { code: 'PRJ-2026-902', name: 'Immutable' } });
      const row = await db.auditLog.findFirstOrThrow();

      await expect(
        db.$executeRawUnsafe(`UPDATE audit_log SET action = 'export' WHERE id = '${row.id}'`),
      ).rejects.toThrow(/append-only/);
      await expect(
        db.$executeRawUnsafe(`DELETE FROM audit_log WHERE id = '${row.id}'`),
      ).rejects.toThrow(/append-only/);
    });

    it('never copies a secret into the log', async () => {
      await db.role.create({ data: { code: 'accounts', name: 'Accounts' } });
      await db.user.create({
        data: {
          name: 'Staff',
          phone: '01711000000',
          password_hash: 'argon2-secret-hash',
          role_code: 'accounts',
        },
      });

      const logs = await db.auditLog.findMany({ where: { table_name: 'users' } });
      expect(JSON.stringify(logs)).not.toContain('argon2-secret-hash');
      expect(JSON.stringify(logs)).toContain('Staff');
    });
  });

  describe('soft delete', () => {
    it('hides a deleted project from ordinary reads but keeps the row', async () => {
      const project = await db.project.create({ data: { code: 'PRJ-2026-903', name: 'Gone' } });
      await db.project.delete({ where: { id: project.id } });

      expect(await db.project.findMany()).toHaveLength(0);
      expect(await db.project.findUnique({ where: { id: project.id } })).toBeNull();
      expect(await db.project.count()).toBe(0);

      const kept = await db.project.findMany({ includeDeleted: true });
      expect(kept).toHaveLength(1);
      expect(kept[0].deleted_at).toBeInstanceOf(Date);
    });

    it('does not touch a deleted row on an update', async () => {
      const project = await db.project.create({ data: { code: 'PRJ-2026-904', name: 'Gone' } });
      await db.project.delete({ where: { id: project.id } });

      const touched = await db.project.updateMany({ data: { name: 'Resurrected' } });
      expect(touched.count).toBe(0);
    });
  });

  describe('money', () => {
    it('keeps paisa exactly, where a float would drift', async () => {
      const project = await db.project.create({
        data: { code: 'PRJ-2026-905', name: 'Money', total_land_area: '12.35' },
      });
      // 0.1 + 0.2 in a float is 0.30000000000000004; Decimal is not a float
      const read = await db.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(read.total_land_area?.toString()).toBe('12.35');
    });
  });
});
