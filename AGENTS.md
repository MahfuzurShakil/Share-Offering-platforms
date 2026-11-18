<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-rules -->

# Share-Sale & Investor Management Platform — project rules

This repository is the **share-sale product**: a developer opens a project,
sells shares in it, and shares the profit with the holders. It began as a fork
of the prototype `RealEstateSolution3` and was pruned to that business.

## Source of truth

- `PHASE-1-PLAN.md` — what Phase 1 is, the decisions behind it, and the six
  stages. Read it before planning work; it outranks every other doc here.
- `PROJECT-SHARE-SALE-PLAN.md`, `REVENUE-SHARE-PLAN.md`,
  `SHARE-SALE-FEEDBACK-PLAN.md`, `SALES-FLOW-PLAN.md`,
  `PUBLIC-WEBSITE-MASTER-PLAN.md` — the business rules of the modules this
  product keeps. Still current.
- `Real-Estate-Developer-Platform_Design-Reference_v1.md` — visual language.
- `docs/prototype/*` and the land/construction halves of
  `Real-Estate-Developer-Platform_Scope-Document_v3.md`,
  `PLATFORM-REPLAN.md`, `PROJECT-MODULE-PLAN.md`, `OPEN-ITEMS.md` — the
  prototype's history. **Not requirements here.** They describe Land,
  Construction, Procurement and flat sale, which return in Phase 2.

Do not invent fields. Table and field names follow the plans above, and a name
that already exists in the code wins over a new one.

## What this product does NOT have

Land acquisition, construction, site progress, procurement, stock, and flat /
plot (unit) sale. Their code is in this repository's history (before commit
`48acd42`) and comes back in Phase 2 — so when something looks missing, check
there before writing it again.

## Architecture (Phase 1 target)

- One Next.js app, three faces: Admin `src/app/admin/*`, Investor Portal
  `src/app/(customer)/*`, Public Website `src/app/(public)/*`.
- **PostgreSQL + Prisma** behind a versioned REST API: route handlers under
  `src/app/api/v1/*`, thin (zod parse → `requirePerm` → service → respond).
  Business rules live in `src/server/services/*`, never in a route handler.
- The client reaches the API through `src/lib/api/*` (a typed client whose
  method names mirror the old repository functions) with TanStack Query.
  **The UI never talks to a database.**
- `src/lib/domain/*` is pure, shared by server and client, and unit-tested.
  Money and date maths belong there, not in a component or a service.
- Public and investor reads go through `src/server/services/public/*` and
  `.../investor/*`, which whitelist fields **inside the Prisma `select`** —
  never `include`, never a spread of a whole row. Cost, margin, partner terms
  and other internal figures must be structurally unable to reach those
  screens, and a test enforces it.
- Money: `Decimal(18,2)` in the database, `number` BDT over the wire; share
  percentages `Decimal(9,6)`. Sum money in SQL or Decimal, never in JS floats.
- Statuses stay ENUMs in code; option lists live in `lookup_values`.
- Every entity carries `id`, `created_at`, `updated_at`, `created_by`, plus a
  display `code` (e.g. `SHR-2026-001`) where the plans specify one. Codes come
  from `code_series` inside the writing transaction — never from a count.
- Financial rows (journal lines, payments, installments, commission postings)
  are immutable: a correction is a reversing entry, never an edit or a delete.
  Everything else soft-deletes with `deleted_at`.
- Every write is audited. The audit log is append-only.

## Interim state (until the Prisma layer lands)

`src/lib/db/database.ts` is still Dexie/IndexedDB — one `version(1)` holding
the 40 tables this product keeps, as scaffolding so the UI runs while the
server is built. It is not the data layer and gets no new tables: schema
changes go into `prisma/schema.prisma`. There is also **no access control at
all** right now (the prototype's access code was dropped and real auth is the
next batch), so nothing goes on a public or staging host until it lands.

## Working rules

- Build module by module, verify each batch in the browser, commit, push.
- `npm test` (vitest), `npm run lint` and `npx tsc --noEmit` must all be clean
  before a commit.
- Reference data is seeded by `prisma/seed/01-lookups.ts` (runs in production
  too). Demo data is created by `scripts/demo/*` **through the REST API**, so
  the demo doubles as an end-to-end test. Never seed demo rows with Prisma
  directly, and never run the demo script against production.
<!-- END:project-rules -->
