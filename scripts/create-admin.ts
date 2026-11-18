/**
 * The first user.
 *
 * Nothing in this product can be looked at without signing in, and there is no
 * sign-up screen on purpose — staff accounts are made by an administrator. That
 * leaves a chicken-and-egg on a fresh database, which this closes:
 *
 *     npx tsx scripts/create-admin.ts
 *
 * It asks for a name, a mobile number and a password, holds the password to the
 * same policy the app does, hashes it with argon2id (never writes it anywhere)
 * and creates a `super_admin`.
 *
 * It refuses to run when the users table already has somebody in it, so it
 * cannot be used to quietly add a second owner to a live system. `--force`
 * overrides that, for the case somebody has locked themselves out and is
 * standing at the server.
 *
 * Non-interactive, for a container's first boot:
 *
 *     ADMIN_NAME=… ADMIN_PHONE=… ADMIN_PASSWORD=… npx tsx scripts/create-admin.ts --yes
 */

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient } from '@prisma/client';
import { checkPasswordStrength, hashPassword } from '../src/server/auth/password';

const ROLE = 'super_admin';

const prisma = new PrismaClient();

/** A Bangladeshi mobile number, which is what the login screen accepts. */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+?88/, '');
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

function normaliseEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const unattended = argv.includes('--yes') || argv.includes('-y');

  const existing = await prisma.user.count({ where: { deleted_at: null } });
  if (existing > 0 && !force) {
    console.error(
      `There are already ${existing} user(s). An administrator adds staff from Users & Roles.\n` +
        'Pass --force only if you are recovering a locked-out system.',
    );
    process.exitCode = 1;
    return;
  }

  /*
   * The role has to exist before a user can point at it: `users.role_code` is a
   * foreign key into `roles`, which `prisma/seed/01-lookups.ts` fills.
   */
  const role = await prisma.role.findUnique({ where: { code: ROLE } });
  if (!role) {
    console.error(`There is no "${ROLE}" role yet. Run \`npm run db:seed\` first.`);
    process.exitCode = 1;
    return;
  }

  let name: string;
  let phone: string;
  let email: string | null;
  let password: string;

  if (unattended) {
    name = (process.env.ADMIN_NAME ?? '').trim();
    phone = process.env.ADMIN_PHONE ?? '';
    email = normaliseEmail(process.env.ADMIN_EMAIL ?? '');
    password = process.env.ADMIN_PASSWORD ?? '';
    if (!name || !phone || !password) {
      console.error('--yes needs ADMIN_NAME, ADMIN_PHONE and ADMIN_PASSWORD in the environment.');
      process.exitCode = 1;
      return;
    }
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      name = (await rl.question('Full name: ')).trim();
      phone = await rl.question('Mobile number (01XXXXXXXXX): ');
      email = normaliseEmail(await rl.question('Email (optional): '));
      /*
       * Typed in the clear. Node gives no portable way to turn the echo off on
       * a Windows console, and a half-working mask is worse than an honest
       * prompt — this is run once, by the person at the machine.
       */
      password = await rl.question('Password (at least 10 characters): ');
      const again = await rl.question('Password again: ');
      if (password !== again) {
        console.error('Those two passwords are not the same. Nothing was created.');
        process.exitCode = 1;
        return;
      }
    } finally {
      rl.close();
    }
  }

  if (name.length < 2) {
    console.error('Enter the full name of the person who will own this system.');
    process.exitCode = 1;
    return;
  }

  const mobile = normalisePhone(phone);
  if (!mobile) {
    console.error(`"${phone}" is not a Bangladeshi mobile number.`);
    process.exitCode = 1;
    return;
  }

  const strength = checkPasswordStrength(password, [name, mobile, email ?? '']);
  if (!strength.ok) {
    console.error(strength.message);
    process.exitCode = 1;
    return;
  }

  const clash = await prisma.user.findFirst({
    where: { OR: [{ phone: mobile }, ...(email ? [{ email }] : [])] },
    select: { phone: true },
  });
  if (clash) {
    console.error('A user with that mobile number or email already exists.');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.create({
    data: {
      name,
      phone: mobile,
      email,
      password_hash: await hashPassword(password),
      role_code: ROLE,
      status: 'active',
    },
    select: { id: true, name: true, phone: true, role_code: true },
  });

  /*
   * Written by hand rather than left to the audit extension: this runs outside
   * a request, so there is no actor in scope, and the first account appearing
   * with no trace of where it came from is exactly what an auditor asks about.
   */
  await prisma.auditLog.create({
    data: {
      action: 'create',
      table_name: 'users',
      record_id: user.id,
      actor_role: 'system',
      after: { name: user.name, phone: user.phone, role_code: user.role_code },
      user_agent: 'scripts/create-admin.ts',
    },
  });

  console.log(`\n${user.name} (${user.phone}) can now sign in as ${ROLE}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
