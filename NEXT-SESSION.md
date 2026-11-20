# Next session — where to pick up

Written 20 Nov 2026, at commit `a38f9a2`. Working tree clean, pushed to
`origin` (github.com/MahfuzurShakil/Share-Offering-platforms). `prototype` is
the other remote: it is where Phase 2 reads Land and Construction back out of,
never somewhere to push.

## What is done

The product's own story now runs end to end on Postgres — a project is valued,
a round of its shares goes to the market, an investor buys into it, pays, and
takes a share of the profit.

| | |
|---|---|
| **Foundation** | PostgreSQL 18, 24 Prisma models, 6 migrations. Transactional display codes, an audit row for every write, an append-only audit log, soft delete where it belongs, money in `Decimal`. |
| **Auth** | argon2id passwords, mobile OTP, opaque sessions, Postgres rate limiting, server-enforced RBAC from `role_permissions`. `npm run create-admin` makes the first user. |
| **Projects** | Master record, and a **Valuation** tab: what 100% is worth, into how many shares it is cut, the day it was valued. Locked once a round has been on the market. |
| **Share offerings** | A round offers some of the project's shares and may add its own premium. The project cannot be sold twice over; a closed round hands its unsold shares back. Draft → open → closed / cancelled, with extend. |
| **Customers** | One investor, one file, across every project. The phone number is the identity, normalised in `domain/phone.ts` and unique in the database. KYC, nominee and bank, all optional until the signing needs them. |
| **Purchases** | Hold → sign (the schedule is written) → pay → paid off. Late fees first, oldest row first, as of the day the money arrived. A receipt is corrected by its opposite; the database refuses to edit or delete one. |
| **Profit sharing** | Income and cost, periods closed / approved / declared, every holder's share frozen on a record date. A loss is carried forward. What a holder cannot take goes to the owners; the lines always add up to what was declared. |
| **Withdrawals** | Balances (never stored — always `credited − paid − pending`), request → approve → pay, or refuse. "Adjust against overdue dues first" pays the holder's own installments out of their profit, as a `profit_adjustment` receipt. |
| **Checks** | 275 tests in 20 files, lint and types clean, production build of 68 pages. |

8 services, 30 API routes, and the screens for all of the above read them
through `src/lib/api/*`.

## Start here

1. **Nobody has walked the whole flow in a browser yet.** The services are
   covered by tests against the real database, but the screens have only been
   checked as far as creating a project and an offering. Worth one pass:
   create-admin → project → valuation → offering → open → customer → reserve →
   sign → payment → income → close → approve → declare → withdrawal.
2. **Leads / CRM** (`crm` module) — the start of the story, and the last part
   of the customer's journey still on the interim layer. `leads`,
   `lead_activities`, converting a lead into a customer.
3. **Sales Team & commission** (REVENUE-SHARE-PLAN.md Parts E–F) — org chart,
   commission plans, what a purchase earns whoever sold it, payouts.
4. **Money** (`finance_expense`) — fund receipts, partners, loans, cash
   position. This is also what the owners' single line in a profit declaration
   is waiting for: once partners exist, that line becomes one per partner and
   nothing else changes.
5. **S4 and after**: the general ledger and auto-posting, the Users & Roles
   screen (still the prototype's static matrix), file storage, the PDF engine,
   the audit-log viewer, the payment-gateway webhook, background jobs,
   `scripts/demo/*` through the REST API, staging and Docker.

## Still on the interim Dexie layer

37 files under `src/app/admin` and `src/components/admin` still call
`useLiveQuery`. The whole of Leads, Sales Team, Money, Website/Blog, Master
Data, Company Settings, Users & Roles, the Dashboard, Customer Requests, the
profit period's own page, and these pieces of screens that are otherwise
moved: `DocumentsPanel`, `ProjectGalleryPanel`, `ProjectSalesCard`'s website
checklist, `AccountPicker`. The Customer Portal and the public site are
entirely Dexie.

They show empty rather than wrong: their tables are in Postgres or not at all,
and the Dexie copy has nothing in it.

## How we divide the work

The user runs the browser steps themselves and reports back in a sentence —
"it saved but the list is empty" replaces five to eight browser tool calls. So:

- finish a batch, make `npm test`, `npm run lint`, `npx tsc --noEmit` and the
  build green, commit, push, then hand the user the exact steps to try.
- put the weight of verification in tests against the real database.
- **start a fresh session per batch.** A long session re-reads its whole
  history on every message; this file exists so a new one needs none of it.

## How to run and check

```bash
npm run dev                                   # port 3000
npm test && npm run lint && npx tsc --noEmit  # all three must be clean
npm run build                                 # before every commit
npm run create-admin                          # the first super_admin
npm run db:seed                               # idempotent reference data
```

Restart `next dev` after any schema change: the running server holds the old
Prisma client and will say a new column does not exist.

## Things to know

- **A migration cannot be made with `prisma migrate dev`**: the app's database
  role cannot create the shadow database, and should not be able to. Use
  `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma
  --to-schema-datamodel prisma/schema.prisma --script` into a new folder under
  `prisma/migrations/`, then `npx prisma migrate deploy`. Load `.env` first
  (`set -a && . ./.env && set +a`).
- **The money maths is not in the services.** `src/lib/domain/share-sale.ts`
  and `revenue-share.ts` build the schedule, say what is owed and how late,
  split a declared amount, and the browser runs the same code to preview it.
  A service decides *when* those sums may be done and what they are frozen
  into. Keep it that way.
- `Decimal` and `Date` are converted at the service boundary, once: money and
  percentages as `number`, dates as `YYYY-MM-DD`, timestamps as ISO strings.
- A payment row without allocation rows pays nothing — the schedule is read
  through the allocations. That is the design; a test fixture that forgets it
  looks like a bug in the ledger.
- Permissions follow desks, not modules: signing an agreement is
  `share_sale: approve`, receipting money is `finance_collection`, paying it
  out is `finance_expense`.
- Local database credentials are in `.env` (gitignored); the app connects as
  `sharesale_app`. Tests use `sharesale_test` through `DATABASE_URL_TEST`, in
  one fork — do not parallelise them.
- Deliberately deferred, written down so they are not forgotten: the owners'
  side of a declaration is one line until partners move; the signing wizard is
  a single dialog until documents move; the Purchases and Ownership tabs on a
  round, and the per-purchase paper checklist, come back with documents too.

## Decisions waiting

1. **What a project should ask for.** The form now takes a description, what
   kind of thing is sold, where the money comes from, the expected holding
   period and what happens to the land after the shares sell. Still open after
   a market look: district as its own lookup (worth it when the public site can
   filter on it), size in units or floors (Phase 2), and whether a target
   return is ever typed rather than computed — it should not be.
2. **`expected_start_date` / `expected_completion_date` on the project.** The
   selling window belongs to the round, and these two are no longer on the
   form. The columns stay; decide whether anything still reads them once the
   public site moves.
