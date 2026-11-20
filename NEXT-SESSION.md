# Next session — where to pick up

Written 21 Nov 2026, at commit `721ca75` plus the whole-flow extension. Working
tree clean, pushed to `origin`
(github.com/MahfuzurShakil/Share-Offering-platforms). `prototype` is the other
remote: it is where Phase 2 reads Land and Construction back out of, never
somewhere to push.

## What is done

The product's whole story runs on Postgres, start to finish — an inquiry
arrives, becomes an investor, buys into a valued project, pays for it, the
project earns, a period is declared, the investor takes their share out, and
the person who sold it is paid their commission.

| | |
|---|---|
| **Foundation** | PostgreSQL 18, 31 Prisma models, 8 migrations. Transactional display codes (yearless where a record is not a document of a year), an audit row for every write, an append-only audit log, soft delete where it belongs, money in `Decimal`. |
| **Auth** | argon2id passwords, mobile OTP, opaque sessions, Postgres rate limiting, server-enforced RBAC from `role_permissions`. `npm run create-admin` makes the first user. |
| **Projects** | Master record, and a **Valuation** tab: what 100% is worth, into how many shares it is cut, the day it was valued. Locked once a round has been on the market. |
| **Share offerings** | A round offers some of the project's shares and may add its own premium. The project cannot be sold twice over; a closed round hands its unsold shares back. |
| **Leads / CRM** | The start of the story. The phone number is the dedup key, so a repeat caller joins their own lead. Stages complete with what happened in them, the follow-up date is the newest activity's, and the call queue leaves out anybody who has already bought. **Create investor file** hands the lead over to the share-sale side. |
| **Customers** | One investor, one file, across every project. KYC, nominee and bank, all optional until the signing needs them. |
| **Purchases** | Hold → sign (the schedule is written) → pay → paid off. Late fees first, oldest row first. A receipt is corrected by its opposite; the database refuses to edit or delete one. |
| **Profit sharing** | Income and cost, periods closed / approved / declared, every holder's share frozen on a record date. A loss is carried forward. The lines always add up to what was declared. |
| **Withdrawals** | Balances (never stored — always `credited − paid − pending`), request → approve → pay, or refuse. |
| **Sales team & commission** | A free tree of any depth with a **history**, so commission is read from the tree as it was on the sale date. Plans say what is earned and in what stages; the payment ledger releases each stage with nothing marked by hand; Accounts approves; a payout pays a member everything approved at once and can never be edited. |
| **Checks** | 411 tests in 22 files, lint and types clean, production build of 68 pages. |

12 services, 56 API route files, and the screens for all of the above read them
through `src/lib/api/*`.

### The whole-flow test

`src/server/http/whole-flow.test.ts` walks the entire story once, in order,
through the real route handlers: project → valuation → sales open → round →
open → inquiry → worked → investor file → seller and plan → 20 shares reserved
→ KYC → agreement → paid off → commission earned, approved and paid → a
quarter's income and cost → closed → approved → declared → withdrawal
requested, approved, paid. It is the browser pass written down, and what breaks
a hand-over between two modules breaks there rather than in front of the
client. **Keep it current as modules land** — it is the cheapest guard this
repository has.

## Start here

1. **Money** (`finance_expense`) — fund receipts, partners, loans, cash
   position. Three things are already waiting for it, with the columns in
   place: the owners' single line in a profit declaration becomes one per
   partner; the member form's "Company partner" picker comes back; and a
   commission payout and a withdrawal get their "paid from" account. This is
   the last module the story needs to be complete.
2. **Nobody has walked the whole flow in a browser yet.** The test above
   covers the services end to end, and the screens have been checked as far as
   a project and an offering. Still worth one human pass.
3. **Users & Roles** (`user_management`) — still the prototype's static matrix.
   The server already reads `roles` / `role_permissions`, so this is the screen
   catching up with what the API does.
4. **Dashboard** — rebuild on the KPIs this product actually has. It is the
   one screen a client opens first and the last one still entirely on Dexie.
5. **S4 and after**: the general ledger and auto-posting, file storage, the PDF
   engine, the audit-log viewer, the payment-gateway webhook, background jobs,
   `scripts/demo/*` through the REST API, staging and Docker.

## Still on the interim Dexie layer

23 files under `src/app/admin` and `src/components/admin` still call
`useLiveQuery`: the whole of Money (fund, loans, cash), Website/Blog, Master
Data, Company Settings, Users & Roles, the Dashboard, Customer Requests, the
profit period's own page, and these pieces of screens that are otherwise
moved: `DocumentsPanel`, `ProjectGalleryPanel`, `ProjectForm`'s amenity list,
`ProjectSalesCard`'s website checklist, `AccountPicker`, `RevenueModals`,
`PaymentVerifyPanel`, `ShareSaleModals`. The Customer Portal and the public
site are entirely Dexie.

They show empty rather than wrong: their tables are in Postgres or not at all,
and the Dexie copy has nothing in it.

`ShareSaleModals.tsx` is worth a note: it is half-migrated and is also where
`useAction` and `ErrorNote` live, which eight other files import. Those two are
generic and fine; the Dexie modals around them are not.

## How we divide the work

The user runs the browser steps themselves and reports back in a sentence —
"it saved but the list is empty" replaces five to eight browser tool calls. So:

- finish a batch, make `npm test`, `npm run lint`, `npx tsc --noEmit` and the
  build green, commit, push, then hand the user the exact steps to try.
- put the weight of verification in tests against the real database, and in
  the whole-flow test for anything that crosses a module boundary.
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
Prisma client and will say a new column does not exist. **It also holds the
query-engine DLL**, so `npx prisma generate` fails with `EPERM` until it is
stopped — stop the dev server first, generate, then start it again.

## Things to know

- **A migration cannot be made with `prisma migrate dev`**: the app's database
  role cannot create the shadow database, and should not be able to. Use
  `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma
  --to-schema-datamodel prisma/schema.prisma --script` into a new folder under
  `prisma/migrations/`, then `npx prisma migrate deploy`. Load `.env` first
  (`set -a && . ./.env && set +a`). **Read what `prisma format` added before
  committing it** — given a new relation it will invent a column rather than
  use the one already there (it tried to add `orgMemberId` next to the
  `sold_by_member_id` that was waiting for it).
- **The money maths is not in the services.** `src/lib/domain/share-sale.ts`,
  `revenue-share.ts` and `commission.ts` build the schedule, say what is owed
  and how late, split a declared amount, work out the chain on a date and the
  stages a payment has released. A service decides *when* those sums may be
  done and what they are frozen into. Keep it that way.
- `Decimal` and `Date` are converted at the service boundary, once: money and
  percentages as `number`, dates as `YYYY-MM-DD`, timestamps as ISO strings.
- A payment row without allocation rows pays nothing — the schedule is read
  through the allocations. That is the design; a test fixture that forgets it
  looks like a bug in the ledger.
- **A reversing receipt is a negative row**, and anything that reads the ledger
  has to expect one. `paidReachedOn` did not, and a commission stage pushed
  past by a since-reversed payment stayed earned. Whatever reads payments next
  should ask itself the same question.
- Permissions follow desks, not modules: signing an agreement is
  `share_sale: approve`, receipting money is `finance_collection`, paying it
  out is `finance_expense` (commission payouts included), moving somebody in
  the sales tree is `sales_team: approve`. `requireAnyPerm` exists for the
  handful of reads two modules want behind different rights.
- **Commission reconciles on read.** `reconcile()` in
  `commission.service.ts` is idempotent and runs at the top of every
  commission read, which is how a stage is released "automatically" with no
  background job. If a screen ever shows stale commission, it is because it
  did not go through one of those reads.
- Local database credentials are in `.env` (gitignored); the app connects as
  `sharesale_app`. Tests use `sharesale_test` through `DATABASE_URL_TEST`, in
  one fork — do not parallelise them.
- Deliberately deferred, written down so they are not forgotten: the owners'
  side of a declaration is one line until partners move; the "Company partner"
  and "Paid from account" pickers are out of the sales-team screens for the
  same reason; the signing wizard is a single dialog until documents move; the
  Purchases and Ownership tabs on a round, and the per-purchase paper
  checklist, come back with documents too.

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
3. **Who may see a commission statement.** Today it is anybody with
   `sales_team: view`, which means a sales executive can read a colleague's.
   The plan leaves the door open to letting sales people log in and see only
   their own (§9); the `own` permission level and `requirePerm`'s `own_only`
   are both already there for it. Worth asking the client before the Users &
   Roles screen lands.
