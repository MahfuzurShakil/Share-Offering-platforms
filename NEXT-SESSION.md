# Next session — where to pick up

Written 18 Nov 2026, last revised after the Projects batch. Working tree clean.

## What is done

| | |
|---|---|
| **The fork** | `RealEstateSolution3` copied with its history, pruned to the share-sale product (`48acd42`). Land, construction, procurement and flat sale are in the history before that commit and return in Phase 2. |
| **Docs** | `PHASE-1-PLAN.md` is the plan of record. `AGENTS.md` states this product's architecture. 16 prototype-era plans moved to `docs/prototype/`. |
| **Database** | PostgreSQL 18 locally. 13 Prisma models (reference data, roles and permissions, users, sessions, OTP, auth attempts, audit log, code series, documents, projects), one migration applied, reference data seeded (7 roles, 70 permissions, 82 option values). |
| **Foundation rules** | Transactional display codes (`PRJ-2026-001`), an audit row for every write, append-only audit log enforced by a trigger, soft delete on records people manage, money in `Decimal`. |
| **Auth** | argon2id passwords, mobile OTP, opaque sessions (cookie for the browser, Bearer for the apps), Postgres rate limiting, server-enforced RBAC from `role_permissions` rows. Six `/api/v1/auth/*` routes. |
| **Browser** | Typed API client, TanStack Query, `useApi` (same shape as `useLiveQuery`), a real `useSession()`, `/login`, and a sign-in gate. The role-simulator dropdown is gone. |
| **First user** | `scripts/create-admin.ts` (`npm run create-admin`): prompts for name / mobile / password, holds it to the app's own policy, hashes with argon2id, creates a `super_admin`, writes its own audit row, and refuses to run when the users table is not empty unless `--force` is passed. `--yes` with `ADMIN_*` in the environment for a container's first boot. |
| **Projects** | End to end on Postgres: `server/services/project.service.ts` → `/api/v1/projects` (list, create, read, update, delete) + `/api/v1/projects/[id]/sales-status` → `lib/api/projects.ts` → the four admin project screens on `useApi`. Filtering, search, sorting and paging are SQL; name uniqueness, the date order, the sales moves and "publish before featuring" are server rules; Decimal and Date cross the wire as `number` and `YYYY-MM-DD`. Plus `/api/v1/users/assignable` so the manager picker has names. |
| **Checks** | 149 tests in 13 files, lint and types clean, production build of 63 pages. |

## Start here

1. **Browser pass on Projects** (the one thing not yet checked by a person):
   `npm run db:seed`, `npm run create-admin`, then `npm run build && npm run start -- -p 3002`
   — sign in, create a project, see it in the list and on its own page, open
   sales, publish it, and check the `audit_log` rows it left.
2. **The next schema slice**: customers, share offerings, share sales,
   installments, payments — then the same path for Share Sale (S2).
3. **What the Projects move cost, as measured**: the service, routes and typed
   client were new code; the four screens were close to mechanical — hooks and
   field names, not logic. The three things that were not a codemod, and will
   not be in any module: validation moving from the form to zod + the service,
   a client-side cross-row check (unique name) becoming a server rule, and
   joins the browser used to do by hand becoming a `select` (the manager's
   name). Budget those three per module.
4. **Still Dexie, and now showing no projects** because projects live in
   Postgres: the project pickers on leads, fund, sales-team plans, website,
   share-sale offerings and the user form. They come right as their own
   modules move — but a demo of those screens before then will look empty.
   `scripts/demo/01-projects.ts` (through the REST API) is still to write.

## How we divide the work

The user runs the browser steps themselves and reports back in a sentence —
"it saved but the list is empty" replaces five to eight browser tool calls. So:

- finish a batch, make `npm test`, `npm run lint`, `npx tsc --noEmit` and the
  build green, commit, then hand the user the exact steps to try and ask what
  they saw. A screenshot or pasted console text is enough; do not go and look
  unless they ask or it is a visual judgement nothing else can settle.
- put the weight of verification in tests against the real database. Today's
  125 cover audit rows, rate limiting, OTP, sessions and the login API without
  a browser at all.
- grow `scripts/demo/*` — it creates data through the real REST API — rather
  than clicking the same flow by hand.
- **start a fresh session per batch.** A long session re-reads its whole
  history on every message, which costs more than any amount of testing. This
  file exists so a new session needs none of that history.

## How to run and check

```bash
npm run build && npm run start -- -p 3002     # the built app
npm test && npm run lint && npx tsc --noEmit  # all three must be clean
npm run db:migrate                            # after a schema change
npm run db:seed                               # idempotent reference data
npm run create-admin                          # the first super_admin
```

Next 16 allows one `next dev` per machine and the prototype in
`../RealEstateSolution3` usually holds it, so the built app on **port 3002** is
the way to look at this one. `.claude/launch.json`'s first entry does that.

## Things to know

- **Nothing goes on a public or staging host yet.** The admin portal has auth,
  but the data layer is half-moved: most screens still read the interim Dexie
  scaffolding in the browser.
- The project list no longer shows "% of the project sold" and "raised": those
  were computed in the browser from the share tables, and come back as fields
  on the list once share sale is in Postgres. The sales card's website
  checklist is empty for the same reason.
- `src/lib/db/database.ts` is scaffolding, not the data layer. Schema changes
  go to `prisma/schema.prisma`. It gets no new tables.
- Local database credentials are in `.env` (gitignored). The app connects as
  `sharesale_app`, never as the Postgres superuser. `.env.example` is the
  template.
- Tests point at `sharesale_test` through `DATABASE_URL_TEST`; `src/test/db.ts`
  applies migrations and truncates between cases. Database tests run in one
  fork — do not parallelise them.
- Two foundation bugs the tests caught are worth remembering: Prisma's promises
  are lazy, so `AsyncLocalStorage` scopes must `await` inside themselves; and a
  code series is gapless because a failed save rolls its number back.
- Deliberately deferred, written down so they are not forgotten: the Users &
  Roles screen still renders the prototype's static matrix and needs rewriting
  against `role_permissions` (S4); `UserRole` in `src/lib/db/types.ts` still
  lists `land_team`, `site_manager` and `procurement`; the general ledger,
  audit-log viewer, PDF engine, payment-gateway webhook, file storage and
  background jobs are all still to come (S4, per the plan).
