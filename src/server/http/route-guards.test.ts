import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The cheap guarantee against the expensive mistake.
 *
 * Every route under `app/api/v1` must check who is asking before it does
 * anything, and must answer through the one envelope. Remembering that on each
 * new route is exactly the kind of thing that gets forgotten on the fiftieth
 * one — so it is asserted here instead of trusted.
 *
 * Routes that are open on purpose are named below, each with the reason. A new
 * public route has to be added to that list deliberately, which is the point:
 * the decision becomes visible in a diff.
 */

const API_ROOT = join(process.cwd(), 'src', 'app', 'api', 'v1');

/** Open on purpose — a person who cannot sign in yet has to reach these. */
const PUBLIC_ROUTES: Record<string, string> = {
  'auth/login/route.ts': 'signing in is how you get a session',
  'auth/otp/request/route.ts': 'an investor asks for a code before they have one',
  'auth/otp/verify/route.ts': 'the code is the credential',
};

function routeFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

const files = routeFiles(API_ROOT);
const key = (file: string) => relative(API_ROOT, file).split(sep).join('/');

describe('api routes', () => {
  it('has routes to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [key(f), f] as const))(
    '%s asks who is calling before it answers',
    (name, file) => {
      const source = readFileSync(file, 'utf8');
      const guarded = /require(Perm|Auth|Staff|Customer)\s*\(/.test(source);

      if (name in PUBLIC_ROUTES) {
        expect(guarded, `${name} is listed as public but checks a permission`).toBe(false);
        return;
      }
      expect(guarded, `${name} has no requirePerm / requireAuth — anyone could call it`).toBe(true);
    },
  );

  it.each(files.map((f) => [key(f), f] as const))(
    '%s answers through the shared envelope',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      // `handler(...)`, or `handler<Context>(...)` on a route with a [id] param
      expect(/\bhandler\s*(<[^>]*>)?\s*\(/.test(source)).toBe(true);
      // a raw NextResponse.json would skip the error shape and the audit actor
      expect(/NextResponse\.json\(/.test(source)).toBe(false);
    },
  );

  it.each(files.map((f) => [key(f), f] as const))(
    '%s keeps its business rules in a service',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      // a handler reaching for the database directly is a rule in the wrong place
      expect(/from '@\/server\/db\/prisma'/.test(source)).toBe(false);
      expect(/\bprisma\./.test(source)).toBe(false);
    },
  );
});
