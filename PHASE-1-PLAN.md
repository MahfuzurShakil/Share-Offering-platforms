# Phase 1 — Share-Sale Platform (new client, full-stack)

## Context

একটা নতুন client এসেছে যারা এই platform-টাই নিতে চায়, কিন্তু তাদের ব্যবসা অন্য আকারের: তারা
জমি কেনে না, construction করে না, flat বিক্রি করে না। তারা **একটা project খোলে, সেই project-এর
share বিক্রি করে, এবং অর্জিত profit অংশীদারদের মধ্যে বিতরণ করে।** তাই আমাদের আটটা module-এর
মধ্যে Land, Construction, Procurement, আর Flat/Unit sale তাদের কাজে আসে না — ওগুলো Phase 2-এর
জন্য রেখে দিতে হবে, চিরতরে বাদ দেওয়ার জন্য নয়।

কাজের দ্বিতীয় মাত্রা: **এটা আর prototype নয়।** এখনকার build পুরোটাই browser-এর IndexedDB-তে চলে
(Dexie, 92 table, 49 version block, 55 repository) — প্রতি ব্যবহারকারীর data তার নিজের browser-এ,
কোনো server নেই, আসল login নেই, permission matrix কোডে hard-coded, display-code numbering
localStorage-এ। Client-কে পাঠানো `QUOTATION_Share-Sale-Platform_v3.docx` (BDT 10,00,000, ৬ সপ্তাহ)
লিখিতভাবে প্রতিশ্রুতি দিয়েছে: PostgreSQL + Prisma, একটা typed versioned API যেটা admin portal,
investor portal ও দুটো mobile app খাওয়াবে, server-এ enforce করা RBAC, mobile OTP login,
append-only audit, atomic money transaction, reversal-not-delete, gap-checked numbering,
PDF engine, background jobs, staging + production, daily backup.

**Intended outcome:** নতুন repo-তে production-ready share-sale platform — Admin Portal, Investor
Portal, Public Website — Postgres-এর উপরে, client-এর cloud account-এ deploy করা, যার API পরে
Android/iOS app-কেও খাওয়াবে। এই repo (`RealEstateSolution3`) prototype হিসেবে অপরিবর্তিত থাকবে
এবং Phase 2-এ Land/Construction ফিরিয়ে আনার source হবে।

## Decisions taken

| প্রশ্ন | সিদ্ধান্ত |
|---|---|
| Codebase | নতুন GitHub repo — এই repo-র copy (history সহ, 8.7MB), তারপর prune + rewrite |
| Scope anchor | Quotation v3, Android/iOS বাদে (app দুটো Phase 1-এর পরে আলাদা stage) |
| API shape | Next route handlers, versioned REST `/api/v1`, zod validation |
| Client data layer | TanStack Query v5 + typed API client (method নাম আজকের repository-র মতোই) |
| Hosting | Dev-এ Docker নেই (cloud dev Postgres); production VPS + Docker Compose |
| Accounting | Full double-entry GL — chart of accounts, journal, trial balance, auto-posting |
| Land/Construction/Procurement/Flat-sale | সম্পূর্ণ বাদ; Phase 2-এ prototype থেকে ফিরিয়ে আনা |
| Website-direct sale-এর commission | Configurable "house rule" — designation বা নাম-করা member-দের ভাগ |
| Project status flow | Phase 1-এ off; land কেবল optional "already owned" reference |

## Scope

**থাকবে** — Dashboard (share-sale KPI দিয়ে নতুন করে সাজানো) · Project (simplified: master +
share structure + Income & Profit + Documents) · Share Sale · Profit Sharing · Share Agreement
& Documents · Sales & CRM · Sales Team + Commission · Fund & Partners, Loans, Cash Position ·
Customers · Users & Roles · Administration · Investor Portal · Public Website

**বাদ** — Land (13 table) · Site progress/Construction · Procurement (14 table) · Flat sale
(bookings, units, towers, unit_deliveries, booking_installments, discount rules) · Bills to pay ·
Material items/requests/stock · Expenses, refunds, supplier vouchers/bills · customer portal-এর
buyer অংশ (homes) · `land_offers` public enquiry

**নতুন লিখতে হবে (prototype-এ নেই)** — ১. Server + API + service layer ২. আসল auth (admin
password, investor mobile+OTP, server-side RBAC, rate limit) ৩. **Client-editable role ও
per-module permission** (এখন `PERMISSION_MATRIX` কোডে hard-coded, কিন্তু quotation বলেছে
"roles are defined by you") ৪. Double-entry GL ৫. Audit trail ৬. File storage adapter
৭. PDF engine ৮. Payment gateway webhook ৯. SMS + email ১০. Background jobs ১১. House-sale
commission rule ১২. Transactional code numbering। এর মধ্যে ৫,৬,৭,১০,১২ quotation-এর Part D-তে
"included, no separate charge" — তাই optional নয়।

## Architecture

### Folders (নতুন repo)

```
src/server/db/prisma.ts              singleton PrismaClient
src/server/services/*.service.ts     আজকের src/lib/repositories/* logic, নাম ধরে ১:১
src/server/services/_tx.ts           withTx(fn) — হাতে-লেখা cascade গুলো এক transaction
src/server/services/public/*.public.service.ts   Prisma `select` whitelist
src/server/auth/{session,rbac,otp,ratelimit}.ts
src/server/numbering/code-series.ts  transactional display-code
src/server/audit/audit.ts            Prisma $extends hook
src/server/storage/{adapter,local,s3}.ts
src/server/pdf/*                     agreement, receipt, statement
src/server/jobs/*                    pg-boss worker
src/app/api/v1/<module>/route.ts     thin: zod parse → requirePerm → service → respond (<30 line)
src/lib/api/client.ts                fetch wrapper, error envelope, ISO-date passthrough
src/lib/api/<module>.ts              typed method, নাম আজকের barrel-এর হুবহু
src/lib/api/use-api.ts               useApi(fn, args) — useLiveQuery-র জায়গায়
src/lib/domain/*                     অপরিবর্তিত, server ও client দুই দিকেই import
src/lib/types/*                      types.ts থেকে হাতে ছাঁটা DTO/view-model
prisma/schema.prisma, prisma/seed/*
```

`src/lib/domain/*` (share-sale, revenue-share, commission, installment-ledger, signing,
share-documents, access, cash) **একটুও বদলাবে না** — এগুলোই platform-এর আসল ব্যবসায়িক গণিত এবং
এগুলোর unit test ইতিমধ্যে আছে।

### Client data layer — ২৬০টি call site যান্ত্রিকভাবে

আজ UI কখনো Dexie-তে হাত দেয় না; সে barrel থেকে নাম-করা function ডাকে। তাই:

```ts
// আগে
const data = useLiveQuery(() => shareSaleOverview(), []);
// পরে
const data = useApi(api.shareSale.overview, []);
```
`if (!data)` guard, destructuring, filter, DataTable column — সব অপরিবর্তিত। `useApi` একটা
পাতলা TanStack wrapper। Kept অংশে ~২৬০টি site (pruning-এর পর ~১৮০–২২০), যার ~৮৫% regex
codemod-এ যায়; বাকিগুলো হাতে। Mutation গুলো `useMutation` + module-prefix `invalidateQueries`।
বাস্তব খরচ ৭–৯ dev-day, rewrite নয়। Liveness: `staleTime 30s` + focus refetch + mutation-এর পর
invalidate; websocket নেই।

**List pagination** — এখন সব list পুরো table পড়ে। ~২৫টা table-backed list (customers, leads,
transactions, journal lines, audit, documents) একটা সাধারণ `ListQuery {page,pageSize,sort,q,filters}`
পাবে এবং `{rows,total}` ফেরাবে; `src/components/ui/DataTable.tsx`-এ একটা opt-in `serverPaged`
mode — একটাই component বদলায়। বাকি aggregate read আগের মতোই।

### Prisma schema

- হাতে, module ধরে, stage-এর ক্রমে — generator নয়। `types.ts`-এর interface থেকে column,
  Dexie-র version block থেকে index: `'id, project_id, status, &code'` → `@@index([project_id])`,
  `@@index([status])`, `@unique(code)`। ~45 model।
- Model PascalCase + `@@map("share_offerings")`; field আগেই snake_case। `id String @id @db.Uuid`।
  `created_at DateTime @db.Timestamptz`, কিন্তু **API boundary-তে ISO string** হিসেবেই যাবে, যাতে
  `formatDate` call গুলো অপরিবর্তিত থাকে।
- **টাকা: `Decimal @db.Decimal(18,2)`**, share % `Decimal(9,6)`। Int-paisa নয় — কারণ domain-এর
  সব গণিত ও formatter আজ `number` BDT ধরে লেখা; paisa-তে গেলে প্রতিটি domain function বদলাতে হবে।
  API-তে `number`-এ serialize (BDT কোটি 2^53-এর নিচে), কিন্তু **accounting-এর যোগ SQL/Decimal-এ**,
  কখনো JS float-এ নয়।
- DB enum কেবল সত্যিকারের বন্ধ set-এ (~১২টা: offering status, sale status, journal status, user
  role, payment status…)। যা আজ `lookup_values`-এ আছে তা FK হয়েই থাকবে — admin সেগুলো edit করে।
- **Code series**: `code_series(module, prefix, period, next_no)`; insert-এর একই transaction-এ
  `UPDATE ... SET next_no = next_no + 1 RETURNING next_no` (row lock = concurrency-safe)।
  Nightly `scripts/check-code-gaps.ts` gap report দেবে, ভরাট করবে না।
- **Delete নীতি দুই রকম**: non-financial row-এ `deleted_at` + Prisma extension যা প্রতিটি
  `findMany`-তে `deleted_at: null` ঢোকায়। Financial row (journal_lines, payments, installments,
  commission posting) **immutable** — সংশোধন মানে `reverses_id` সহ উল্টো entry; Postgres trigger
  `UPDATE`/`DELETE` আটকাবে।
- **Audit**: একটাই append-only `audit_log(at, actor_id, actor_role, action, table_name, record_id,
  before jsonb, after jsonb, ip, user_agent, request_id)`, Prisma `$extends` hook থেকে লেখা হবে
  যাতে কোনো service ভুলে বাদ দিতে না পারে; app role-এর UPDATE/DELETE permission তুলে নেওয়া।

### Auth

`sessions(id, user_id?, customer_id?, kind, token_hash, expires_at, revoked_at, device)` — এক
table, দুই ধরনের subject। Browser → HttpOnly/Secure/SameSite=Lax cookie-তে opaque token; Expo →
একই token `Authorization: Bearer`-এ। JWT নয়, কারণ instant revocation ও role-change দরকার।
Admin: mobile/email + password (argon2id)। Investor: OTP (hash করা, 6 digit, 5 min TTL, 5 attempt,
দিন-প্রতি cap) — hard-coded `'123456'` এবং `src/lib/auth/mock-session.tsx` পুরোটা মুছে যাবে, তার
জায়গায় `session-provider.tsx` **একই `useSession()` shape** দেবে, তাই call site শুধু import বদলায়।
RBAC: `src/lib/domain/access.ts`-এর module key গুলোই server-এর permission key; প্রতিটি route
`await requirePerm(req, 'share_sale', 'edit')` ডাকবে, আর একটা vitest test জোর করবে যে
`src/app/api/v1/**/route.ts`-এর প্রতিটি file-এ `requirePerm`/`requireAuth` আছে। Role ও permission
DB-তে (`roles`, `role_permissions`) — matrix-টা seed হবে আজকের `PERMISSION_MATRIX` থেকে, তারপর
client নিজে edit করবে। Rate limit Postgres-backed fixed window (Redis নয়)।

### Public data boundary

আজকের whitelist browser-এ পড়ার *পরে* ছাঁটে; server-এ whitelist **query-র ভেতরে** যাবে:
`const PUBLIC_FIELDS = {...} satisfies Prisma.ProjectSelect` এবং কেবল `select: PUBLIC_FIELDS` —
কখনো `include`, কখনো full-row spread নয়। `public-whitelist.test.ts` port হবে: (ক) ফেরানো object-এর
`Object.keys` ঘোষিত whitelist-এর সমান, (খ) source-level assertion যে `services/public/`-এ কোনো
query `select` ছাড়া নেই। প্রতিরক্ষার দ্বিতীয় স্তর: public route-এর জন্য আলাদা read-only Postgres role।

### Tests ও seed

১০টার মধ্যে ৭টা pure-domain test **শূন্য পরিবর্তনে** টিকে যায় (booking-ledger বাদ যাবে)।
`commission.repository.test.ts`, `investor.repository.test.ts` service test হবে — `fake-indexeddb`
সরিয়ে `tests/setup-db.ts` একটা `*_test` schema-তে `prisma migrate deploy` চালাবে ও test-এর মাঝে
truncate করবে।

**Seed: পুরনো ১১,৫০০ লাইন demo data port করা হবে না।** দুটো আলাদা জিনিস থাকবে:

1. `prisma/seed/01-lookups.ts` — আসল reference data (lookup category, designation, income/expense
   head, chart of accounts, role-permission matrix, company settings-এর খালি কাঠামো)। এটা
   production-এও চলে, idempotent, `createMany ... skipDuplicates`।
2. `scripts/demo/*.ts` — **আসল REST API দিয়ে demo data বানানো হবে**, Prisma দিয়ে নয়। একটা
   script admin হিসেবে login করে `/api/v1/*`-এ ধারাবাহিক call দেয়: project → offering →
   customer → request → agreement sign → down payment → installment → period close → profit
   declare → withdrawal → commission → payout → journal। `BASE_URL` env দিয়ে local বা staging
   দুই জায়গাতেই চলে।

এর লাভ তিনটে: (ক) একই script **API integration test** — auth, zod validation, RBAC,
code numbering, audit hook, GL auto-posting সব সত্যিকারের পথে যাচাই হয়, Prisma-তে সরাসরি
লিখলে এর একটাও পরীক্ষা হত না; (খ) stage ধরে বাড়ে — S1-এ project, S2-এ share sale, S3-এ profit ও
commission — তাই কোনো পর্যায়ে অব্যবহৃত seed বসে থাকে না; (গ) client demo ও training data এই
script-এই তৈরি হয়, আর go-live-এ শুধু চালানো হয় না।

Dexie-র `DatabaseProvider.tsx`, `seed.ts` এবং সব `demo-*.ts` মুছে যাবে। পুরনো demo file গুলো
দরকার হলে prototype repo-তে রয়ে গেল — কিন্তু সেখান থেকে কোড নয়, কেবল **বাস্তবসম্মত সংখ্যা ও নাম**
(দাম, কিস্তির হার, project নাম) তুলে এনে script-এর payload-এ বসানো হবে, যাতে demo বিশ্বাসযোগ্য থাকে।

## Fork procedure (S1-এর প্রথম দিন)

1. নতুন GitHub repo (নাম client-এর brand ঠিক হলে; আপাতত `share-sale-platform`)। এই repo clone
   করে `git remote set-url`, তারপর একটা commit-এ prune — history থেকে যায়, তাই Phase 2-এ
   `git show` দিয়ে Land/Construction কোড ফিরিয়ে আনা যায়।
2. মুছে ফেলা: `src/app/admin/{lands,landowners,land-offers,site-progress,material-items,material-requests,purchase-orders,stock,suppliers,supplier-vouchers,expenses,refunds,bookings,collections,payments}`,
   `src/components/admin/{lands,construction,site-progress,procurement,material-requests,bookings,payments}`,
   সংশ্লিষ্ট repository ও demo file, `nav-config.ts`-এর group গুলো।
3. **Prune-এর পরের surgery** (exploration-এ চিহ্নিত আসল coupling):
   - `commission.repository.ts::allSaleFacts()` — `bookings/payments/unit_deliveries/units/towers`
     শাখা বাদ, `applies_to: 'booking'` arm বাদ, `sale_kind` কেবল `'share'`।
   - `fund.repository.ts` ও `project-statement.repository.ts` — এগুলো আজ construction-cost view;
     share-sale money view হিসেবে নতুন করে লেখা (fund receipt, allocation, loan, profit payout,
     commission payout)।
   - `bank.repository.ts` cash position — ১১টা money table-এর বদলে ছয়টা।
   - `investor/investor.repository.ts` (1133 line) — homes/booking অর্ধেক বাদ; `HoldingDetailPage`
     শুধু share path রাখবে।
   - `payment-submission.repository.ts` — `bookingRepository`/`homeReceiptNo` নির্ভরতা বাদ।
   - `RevenueTab` আজ project detail page-এ বসে; সেটাই থাকবে (client "income/profit project-এর
     ভেতরে" চেয়েছে), কিন্তু project page-এর towers/allocation/costs/timeline tab বাদ — থাকবে
     overview, **income & profit**, documents।
   - Project status flow: `ProjectStatusCard` ও `project_status_history` off (code রাখা হবে না,
     Phase 2-এ history থেকে ফেরানো হবে)।
4. `npm run build` + `npm test` সবুজ করা — এখনো Dexie-র উপরেই, শুধু ছোট হয়ে। এটাই baseline।

## Stages (quotation §9-এর সঙ্গে মিলিয়ে)

**S1 — Foundation + Project (week 1).** Fork + prune (উপরের ধাপ)। Cloud dev Postgres, Prisma
init, `code_series`, audit extension, soft-delete extension, auth পুরোটা (password, OTP, RBAC,
rate limit, session provider), storage adapter, `src/lib/api` + TanStack provider, `01-lookups`
seed, এবং **Project module পুরো পথ end-to-end** (Prisma model → service → `/api/v1/projects` →
typed client → codemod → audit → `scripts/demo/01-projects.ts`)। তারপরই codemod ব্যাপকভাবে চালানো। **Staging + Docker Compose এখনই দাঁড় করানো,
S6-তে নয়।** Dashboard-এর নতুন share-sale KPI।

**S2 — Share Sale + Agreements (week 2–3).** Offerings, holdings, instalments, transactions,
portal inbox, signing wizard, document checklist, PDF engine (agreement + receipt, letterhead ও
numbering সহ)। `installment-ledger.ts`, `share-documents.ts`, `signing.ts` অপরিবর্তিত পুনঃব্যবহার।

**S3 — Profit Sharing + CRM + Commission (week 3–4).** Revenue policy/entry/period/close/declare,
cap table, allocation, withdrawal, loss covering, loans। Leads → share purchase (এক ধাপে)।
Org tree, designation override, staged release, payout — এবং **house-sale rule**: একটা
`commission_rules` row (`source = 'website_direct'`) যার ভাগ-নীতি সমানভাগ / equity-অনুপাতে /
হাতে-দেওয়া %, resolve হবে `src/lib/domain/commission.ts`-এ। প্রথম server-paged list গুলো।

**S4 — Accounting + Users + Admin + Audit (week 4–5).** Chart of accounts, journal entry/line,
immutability trigger, reversal, ledger view, trial balance, project-wise income & expenditure।
Share payment / profit payout / commission payout / fund receipt / loan — সব auto-posting।
Cash Position ও Fund & Partners GL-এর উপরে। Role ও permission admin UI, lookup list,
company settings, numbering series, audit-log viewer। Payment gateway webhook (signature verify
+ idempotency key)। Background job (due reminder, overdue marking, gap check)।

**S5 — Investor Portal + Public Website (week 5).** Portal: dashboard, my investments, payments,
receipts, documents + signing, earnings + withdrawal, notification, profile — সব server API-র
উপরে। Public site: home, project showcase, invest, NRB, content/blog, enquiry → lead।
`select`-whitelist service + whitelist test suite। SMS/email notification।

**S6 — Deploy + go-live (week 6).** Production VPS, Docker Compose (Next + Postgres + Caddy),
backup + **restore drill**, prod-এ কেবল `01-lookups` (demo script কখনো prod-এ নয়),
rate-limit tuning, paged list-এ load check,
user training, cutover। (Android/iOS এর পরে আলাদা stage — API ইতিমধ্যেই mobile-ready।)

## Risks (ক্রমানুসারে) ও প্রতিকার

1. **Query migration যান্ত্রিক নয় বলে দেরিতে ধরা পড়া** → S1-এ Project module পুরো পথ আগে শেষ
   করে সংখ্যাটা মেপে নেওয়া (দিন ৫-এর মধ্যে)।
2. **GL-এর সঠিকতা** আজকের `cash.ts`/`revenue-share.ts` প্রত্যাশার সঙ্গে → প্রতিটি auto-posting-এর
   unit test: debit = credit, এবং trial balance বনাম cash position মিলিয়ে দেখা।
3. **হাতে-লেখা cascade** FK + transaction-এ রূপান্তরে নীরবে ভুল হওয়া → প্রতিটি `removeCascade`-এর
   জন্য একটা service test।
4. **Money/date serialization** formatter ভাঙা → boundary-তে Decimal→number, Date→ISO string;
   একটা contract test।
5. **Public whitelist regression** → source-level + runtime দুই test, এবং read-only DB role।
6. **প্রথম Docker/VPS deploy** → S1-এই staging দাঁড়ানো, week 6-এ নয়।

## Verification

- `npm test` — domain unit test (অপরিবর্তিত ৭টা) + নতুন service test (`*_test` schema-র উপরে) +
  route-guard test + whitelist test + code-gap test + GL balance test।
- `npm run demo` — `scripts/demo/*` খালি database-এ চালিয়ে পুরো ব্যবসায়িক চক্র API দিয়ে তৈরি হয়
  কিনা। কোনো stage-এ এটা ব্যর্থ হলে সেই stage শেষ নয় — এটাই আমাদের end-to-end gate।
- `npx prisma migrate dev` / `migrate deploy` — migration দুই দিকেই চলে কিনা।
- **Browser pass প্রতি stage-এর শেষে** (verification-efficiency স্মৃতি অনুসারে এক পাস, port 3000):
  `npm run demo`-র তৈরি data নিয়ে offering খোলা → investor request → agreement sign → down payment →
  installment → receipt PDF → period close → profit declare → withdrawal → commission earn →
  payout → journal ও trial balance মেলানো → investor portal-এ একই সংখ্যা দেখা → public site-এ
  internal field ফাঁস হয়নি তা পরীক্ষা।
- Staging-এ প্রতি stage demo (quotation §9: "a working demonstration at the end of every stage,
  on the client's own data")।
- Restore drill: nightly dump থেকে আলাদা database-এ restore করে একটা smoke test।

## Phase 2-এর তালিকা (এখনই লিখে রাখা)

Land acquisition (landowner, offer, negotiation, DD, payment plan) · Construction ও site progress
· Procurement ও stock · Flat/Unit sale ও buyer portal · Bills to pay, payment history ·
Project status flow · Android + iOS app · bilingual UI · data migration (client-এর পুরনো
spreadsheet) — প্রতিটি prototype repo-তে কাজ করা অবস্থায় আছে, `git show` দিয়ে ফেরানো যাবে।

## Client-এর কাছ থেকে যা দরকার (S1-এর আগে)

1. নতুন product/brand নাম ও logo, রঙ (repo নাম ও letterhead-এর জন্য)
2. Chart of accounts — তাদের accountant-এর তালিকা (না পেলে আমরা একটা standard real-estate CoA দেব)
3. Designation তালিকা ও commission plan-এর আসল হার, house-sale ভাগের নিয়ম
4. Tax withholding % (profit ও commission), reserve %, management fee
5. Payment gateway, SMS, email account (তাদের নামে), এবং VPS/cloud account
6. Agreement template ও letterhead
7. পুরনো share/investor record-এর একটা sample (migration ছোট কাজ না আলাদা project, সেটা ঠিক করতে)
