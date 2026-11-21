# Next session — where to pick up

Written 21 Nov 2026, at commit `5701ce5`. Working
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
| **Foundation** | PostgreSQL 18, 34 Prisma models, 9 migrations. Transactional display codes (yearless where a record is not a document of a year), an audit row for every write, an append-only audit log, soft delete where it belongs, money in `Decimal`. |
| **Auth** | argon2id passwords, mobile OTP, opaque sessions, Postgres rate limiting, server-enforced RBAC from `role_permissions`. `npm run create-admin` makes the first user. |
| **Projects** | Master record, and a **Valuation** tab: what 100% is worth, into how many shares it is cut, the day it was valued. Locked once a round has been on the market. |
| **Share offerings** | A round offers some of the project's shares and may add its own premium. The project cannot be sold twice over; a closed round hands its unsold shares back. |
| **Leads / CRM** | The start of the story. The phone number is the dedup key, so a repeat caller joins their own lead. Stages complete with what happened in them, the follow-up date is the newest activity's, and the call queue leaves out anybody who has already bought. **Create investor file** hands the lead over to the share-sale side. |
| **Customers** | One investor, one file, across every project. KYC, nominee and bank, all optional until the signing needs them. |
| **Purchases** | Hold → sign (the schedule is written) → pay → paid off. Late fees first, oldest row first. A receipt is corrected by its opposite; the database refuses to edit or delete one. |
| **Profit sharing** | Income and cost, periods closed / approved / declared, every holder's share frozen on a record date. A loss is carried forward. The lines always add up to what was declared. |
| **Withdrawals** | Balances (never stored — always `credited − paid − pending`), request → approve → pay, or refuse. |
| **Sales team & commission** | A free tree of any depth with a **history**, so commission is read from the tree as it was on the sale date. Plans say what is earned and in what stages; the payment ledger releases each stage with nothing marked by hand; Accounts approves; a payout pays a member everything approved at once and can never be edited. |
| **Money (part)** | Accounts (`ACC-001`) for a payout or a withdrawal to name, and partners (`PTR-001`) — the company's, or one project's own investor who takes their share of it first. A percentage changes through a **dated** change, so a declaration made in June is not re-split in October, and `GET /projects/{id}/cap-table` puts customers and owners on one page as of any date. |
| **Checks** | 462 tests in 24 files, lint and types clean, production build of 68 pages. |

13 services, 62 API route files, and the screens for all of the above read them
through `src/lib/api/*` — except the Money slice, which has no screens yet (below).

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

1. **The rest of Money** (`finance_expense`). Accounts and partners landed in
   the last commit; what is left is the money moving: `fund_receipts` (a
   partner's capital or a loan coming in), `fund_allocations` (the company pool
   giving to a project), `loans` + `loan_repayments`, and the **cash position**
   that adds them up per account. `fund.repository.ts` and `bank.repository.ts`
   are the prototype's versions — both were written as a *construction* cost
   view and need rewriting as a share-sale money view (AGENTS.md says so
   explicitly). `domain/cash.ts` already holds the pure part.
2. **Three screens that can come back now**, each one small, each previously
   cut because its data did not exist:
   - the member form's **Company partner** picker
     (`components/admin/sales-team/parts.tsx`) — `GET /partners` serves it;
   - the payout's **Paid from** account picker
     (`app/admin/sales-team/payouts/page.tsx`) — `GET /accounts` serves it;
   - `components/admin/finance/AccountPicker.tsx`, still on Dexie, which the
     withdrawal screens use.
3. **The Money screens** themselves: Partners, Accounts, Fund, Loans, Cash
   Position, and a **cap table** tab on the project (the API is already there
   and tested — nothing reads it yet).
4. **Nobody has walked the whole flow in a browser yet.** The test above covers
   the services end to end, and the screens have been checked as far as a
   project and an offering. Still worth one human pass.
5. **Users & Roles** (`user_management`) — still the prototype's static matrix.
   The server already reads `roles` / `role_permissions`, so this is the screen
   catching up with what the API does.
6. **Dashboard** — rebuild on the KPIs this product actually has. It is the one
   screen a client opens first and the last one still entirely on Dexie.
7. **S4 and after**: the general ledger and auto-posting, file storage, the PDF
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
- Deliberately deferred, written down so they are not forgotten: the signing
  wizard is a single dialog until documents move, and the Purchases and
  Ownership tabs on a round, and the per-purchase paper checklist, come back
  with documents too. **Two that are no longer blocked**: the "Company partner"
  and "Paid from account" pickers were taken out of the sales-team screens
  because partners and accounts did not exist — they do now, and putting them
  back is item 2 above.
- **A declaration with no partners on file still works**, and must keep
  working: the owners' side falls back to one unattributed line, because a
  client starts with none. There is a test for it.

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
