import { PrismaClient } from '@prisma/client';
import { withAudit } from '../audit/audit';
import { withSoftDelete } from './soft-delete';

/*
 * The one database client, with the two rules that must never be optional
 * already wrapped around it: every change is audited, and records people
 * manage soft-delete instead of vanishing.
 *
 * Next's dev server reloads modules on every edit, and a fresh client each
 * time exhausts Postgres connections within a few saves — so in development
 * the instance is parked on `globalThis`.
 */

function build() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  // soft delete first, so what audit reads as "before" is a live row
  return withAudit(withSoftDelete(base));
}

export type Db = ReturnType<typeof build>;

const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const prisma: Db = globalForPrisma.prisma ?? build();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Runs `fn` in one transaction.
 *
 * Money moves in full or not at all, and a record and the display code it was
 * given commit together — so every write that touches more than one row goes
 * through here rather than firing statements one after another.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = any;

export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).$transaction(fn) as Promise<T>;
}
