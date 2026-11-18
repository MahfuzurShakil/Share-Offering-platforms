# Share-Sale & Investor Management Platform

A developer opens a project, sells **shares** in it to investors, and shares
the profit the project earns with everyone who holds a part of it. This
repository is that platform: an Admin Portal where the business is run, an
Investor Portal where each investor sees their own position, and a Public
Website that brings investors in.

> **New here?** Read [`PHASE-1-PLAN.md`](PHASE-1-PLAN.md) — what Phase 1 is,
> the decisions behind it and the six stages. Then
> [`AGENTS.md`](AGENTS.md) for the rules this codebase holds itself to.

## Where this came from

It is a fork of the `RealEstateSolution3` prototype, pruned to this one
business. Land acquisition, construction, site progress, procurement, stock and
flat/plot sale were removed — they are in this repository's history (before
commit `48acd42`) and return in Phase 2. The prototype itself is untouched and
still runs as a prototype.

## Running it

```bash
npm install
npm run dev
```

- Admin Portal → http://localhost:3001/admin
- Portal chooser → http://localhost:3001
- Investor Portal → http://localhost:3001/customer
- Public Website → http://localhost:3001/home

Next 16 allows one `next dev` per machine. If the prototype's dev server is
running, stop it, or serve the built app instead:

```bash
npm run build && npm run start -- -p 3002
```

## State of play

Phase 1 is being built in six stages (`PHASE-1-PLAN.md` §Stages). Today:

| | |
|---|---|
| **Data** | PostgreSQL + Prisma behind `/api/v1` is being built. Until it lands, `src/lib/db/database.ts` is interim Dexie/IndexedDB scaffolding so the UI runs — browser-local, lost when site data is cleared. |
| **Auth** | None yet. Real server-enforced RBAC with password and mobile-OTP login is the next batch; the topbar's role switcher is a simulation. **Do not put this on a public or staging host until it lands.** |
| **Data in it** | Nothing is seeded. Reference data will come from `prisma/seed/01-lookups.ts`, demo data from `scripts/demo/*` over the real API. |

## Checks

```bash
npm test             # vitest — domain and service tests
npm run lint         # eslint
npx tsc --noEmit     # types
npm run build        # production build
```

All four are expected to be clean before a commit.

## Structure

```
src/
  app/
    admin/          Admin Portal (teal shell)
    (customer)/     Investor Portal
    (public)/       Public Website
    api/v1/         the REST API (being built)
  server/           services, auth, audit, numbering, storage (being built)
  lib/
    api/            the typed client the UI calls (being built)
    domain/         pure business rules, unit-tested — shared by both sides
    repositories/   interim Dexie data layer, replaced by server/services
    db/             interim Dexie schema and types
  components/
    admin/ investor/ public/ ui/ print/
prisma/             schema, migrations, reference-data seed
scripts/demo/       demo data, created through the REST API
docs/prototype/     the prototype's own plans and audits — history, not rules
```
