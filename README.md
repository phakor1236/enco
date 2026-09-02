# Vella — B2C E-commerce Platform

A single-seller e-commerce platform built end-to-end: storefront, checkout,
admin back office, background jobs, and API docs. Payment / shipping / invoicing
are mocked on purpose — everything _around_ them (concurrency, state machines,
auth, idempotency, auditing) is built for real.

**Stack:** Node.js 22 · Express 5 · TypeScript · Prisma 6 · PostgreSQL 16 ·
React 18 + Vite · Zod · Docker Compose · GitHub Actions · Vitest / Supertest / Playwright

**298 tests** (237 API · 39 web · 17 shared · 5 E2E) · **8 ADRs** · **OpenAPI 3 docs auto-generated from Zod**

---

## Quick start (one command for the database)

Prereqs: Node ≥ 22.13, pnpm ≥ 11, Docker.

```bash
docker compose up -d               # Postgres 16 + a separate test DB, healthchecked
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:migrate                    # 9 Prisma migrations
pnpm db:seed                       # demo products + accounts
pnpm dev                           # API :4000 · web :5173
```

| Demo account        | Password    | Role     |
| ------------------- | ----------- | -------- |
| `demo@example.com`  | `demo1234`  | customer |
| `admin@example.com` | `admin1234` | admin    |

API docs (Swagger UI): <http://localhost:4000/api/docs> · raw spec: `/api/docs.json`

```bash
pnpm test         # Vitest + Supertest (integration tests hit real Postgres)
pnpm test:e2e     # Playwright — 5 browser flows
pnpm lint && pnpm typecheck
```

---

## Architecture

```
                 ┌──────────────────────────────────────┐
  browser ─────▶ │ apps/web — React 18 + Vite           │
                 │ Zustand (client) · TanStack Query    │
                 │ Axios + single-flight silent refresh │
                 └───────────────┬──────────────────────┘
                                 │  /api/*  (Vite proxy in dev)
                 ┌───────────────▼──────────────────────┐
                 │ apps/api — Express 5                 │
                 │  routes/    thin: Zod validate       │
                 │  services/  all business logic       │
                 │  middleware auth · error · validate  │
                 │  jobs/      node-cron + advisory lock│
                 └───────────────┬──────────────────────┘
                                 │  Prisma 6
                 ┌───────────────▼──────────────────────┐
                 │ PostgreSQL 16 (Docker)               │
                 │ app DB + isolated test DB            │
                 └──────────────────────────────────────┘

  packages/shared — Zod schemas + error codes + types, imported by BOTH sides
```

Routes are deliberately thin. A handler validates with Zod, calls one service
function, and maps errors — every rule that matters lives in `apps/api/src/services/`
where it can be tested without HTTP.

### REST API

| Area     | Endpoints                                                                  |
| -------- | -------------------------------------------------------------------------- |
| Auth     | `POST /api/auth/{register,login,refresh,logout}`                           |
| Catalog  | `GET /api/categories`, `GET /api/products`, `GET /api/products/:slug`      |
| Cart     | `GET/POST/PATCH/DELETE /api/cart` (guest cart via cookie, merged on login) |
| Checkout | `POST /api/checkout`, `POST /api/coupons/validate`                         |
| Orders   | `GET /api/orders`, `GET /api/orders/:id`                                   |
| Webhooks | `POST /api/webhooks/payment/mock` (idempotent)                             |
| Admin    | `/api/admin/{products,skus,orders,coupons,reports}` — `requireRole` gated  |

---

## The parts worth reading

### 1. Oversell prevention — conditional UPDATE, not `SELECT FOR UPDATE`

Two customers buy the last unit at the same instant. The naive read-check-write
lets both through. Checkout instead never reads-then-writes:

```ts
const updated = await tx.sku.updateMany({
  where: { id: item.skuId, stock: { gte: item.qty } },   // guard is IN the write
  data:  { stock: { decrement: item.qty } },
});
if (updated.count === 0) throw new AppError(ErrorCodes.OUT_OF_STOCK, ...);
```

The `WHERE` clause and the decrement are one atomic statement, so the database
itself is the arbiter — no explicit lock, no lock-ordering deadlock, and
`count === 0` _is_ the out-of-stock signal. The whole checkout runs in one
transaction, so a failure on line 3 of 5 rolls back lines 1–2; stock is never
left partially decremented. The decrements run sequentially rather than via
`Promise.all` — parallel writes sharing one transaction connection can deadlock
on overlapping rows, and a cart is small enough that the sequential cost is noise.
→ [ADR 0003](docs/adr/0003-conditional-update-over-select-for-update.md)

### 2. Order state machine — one door in, side effects included

Order status transitions live in a single `transitionOrder()` function backed by
an explicit allow-table:

```
PENDING ──▶ PAID ──▶ SHIPPED ──▶ COMPLETED
   │          │         │
   │          └──▶ REFUNDED (restock)
   └──▶ CANCELLED (restock)
```

Anything outside the table throws `409 INVALID_STATUS_TRANSITION`. Crucially the
status change, the `OrderStatusLog` row, and the side effects (restock,
shipment mock, audit log) all happen **inside the same transaction** — you can
never end up with an order marked CANCELLED whose stock was not returned.
→ [ADR 0005](docs/adr/0005-centralized-transition-order-state-machine.md)

### 3. Auth — in-memory access token + rotating refresh family

- **Access token:** JWT, 15 min, HS256 with the algorithm explicitly whitelisted
  on verify (blocks alg-confusion), kept in memory only — never in `localStorage`.
- **Refresh token:** opaque 256-bit random, sent as an `httpOnly` cookie scoped
  to `/api/auth`. The database stores **only a SHA-256 hash** — a database dump
  does not hand over live sessions.
- **Rotation + reuse detection:** every refresh revokes the old token and issues
  a new one linked by `parentId`. If an already-revoked token is presented, it's
  either a stolen token being replayed → **the entire token family is revoked**,
  or a legitimate network retry within a 10-second grace window → served, so a
  flaky connection doesn't log the user out. Families are per-device, so a
  compromise on one device doesn't sign you out everywhere.
- **Races:** rotation uses a conditional `updateMany(where revokedAt: null)` as an
  optimistic lock; a concurrent rotation gets `409 TOKEN_RACED` instead of two
  valid token pairs. The frontend answers with a single-flight refresh queue.
- Login runs bcrypt against a dummy hash when the email doesn't exist, so
  response timing can't be used to enumerate registered users.
  → [ADR 0004](docs/adr/0004-auth-access-token-refresh-cookie.md)

### 4. Test isolation — every integration test rolls back

Integration tests run against a **real Postgres**, not a mock, inside a
transaction that is always rolled back:

```ts
await withTestTx(async (tx) => {
  /* insert, call service, assert */
}); // ← everything written above is gone
```

No test can pollute another, the suite is order-independent, and there is no
truncate-between-tests slowdown. Test and app databases are separate, so
`pnpm dev` and `pnpm test` can run at the same time.

### 5. Background jobs — same process, guarded by an advisory lock

Five `node-cron` jobs (cancel timed-out orders, auto-complete shipped orders,
clean up refresh tokens and stale guest carts, reset the demo DB). Running them
in the API process is the right call at this scale, but the moment you run two
instances they double-fire — so each job wraps its body in a Postgres
**advisory lock**, making duplicate execution impossible without adding Redis or
a separate worker service. → [ADR 0006](docs/adr/0006-node-cron-same-process-with-advisory-lock.md)

### 6. Docs that can't drift

OpenAPI 3 is generated from the same Zod schemas used to validate requests at
runtime, and a test fails the build if the committed `docs/api/openapi.yaml`
drifts from what the code produces. → [ADR 0007](docs/adr/0007-zod-to-openapi-auto-generated-docs.md)

---

## Security checklist

| Concern               | Handling                                                           |
| --------------------- | ------------------------------------------------------------------ |
| Password storage      | bcrypt, cost 12                                                    |
| Refresh token storage | SHA-256 hash only; plaintext returned once                         |
| XSS → token theft     | access token in memory; refresh in `httpOnly` cookie               |
| Brute force           | rate limit: login 5/min/IP, register 3/day/IP                      |
| User enumeration      | dummy-hash compare on unknown email                                |
| Header hardening      | `helmet`, `x-powered-by` disabled                                  |
| Log leakage           | pino redacts `cookie` / `authorization` / `set-cookie`             |
| Privilege escalation  | `requireAuth` + `requireRole`; admin writes go to `AdminActionLog` |
| Body size             | `express.json({ limit: '1mb' })`                                   |
| Prod docs exposure    | Swagger UI off in production unless `EXPOSE_API_DOCS=true`         |

---

## Architecture decision records

Every non-obvious choice is written down with the options rejected and why:

| ADR                                                                 | Decision                                        |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| [0001](docs/adr/0001-express-over-nest-fastify.md)                  | Express 5 over NestJS / Fastify                 |
| [0002](docs/adr/0002-pnpm-workspaces-monorepo.md)                   | pnpm workspaces, no build orchestrator          |
| [0003](docs/adr/0003-conditional-update-over-select-for-update.md)  | Conditional UPDATE for oversell prevention      |
| [0004](docs/adr/0004-auth-access-token-refresh-cookie.md)           | Access token + refresh cookie + family rotation |
| [0005](docs/adr/0005-centralized-transition-order-state-machine.md) | Centralized order state machine                 |
| [0006](docs/adr/0006-node-cron-same-process-with-advisory-lock.md)  | node-cron in-process + advisory lock            |
| [0007](docs/adr/0007-zod-to-openapi-auto-generated-docs.md)         | OpenAPI generated from Zod                      |
| [0008](docs/adr/0008-sku-option-combination-denormalized-json.md)   | SKU option combination denormalized as JSONB    |

Full requirements spec: [`SPEC.md`](SPEC.md).

---

## CI

GitHub Actions runs four parallel jobs on every push and PR — **lint**,
**typecheck**, **test** (with a real Postgres 16 service container, migrations
applied first), and **build**. A husky `pre-commit` hook runs lint-staged so
formatting never reaches CI.

---

## Data model

26 Prisma models / enums across 9 migrations, one migration per concern:

```
User · RefreshToken                        auth
Category · Product · ProductImage
  · Variant · VariantOption · Sku          catalog (multi-SKU products)
Cart · CartItem                            guest + member carts
Order · OrderItem · OrderStatusLog         orders (append-only status history)
PaymentMock · ShipmentMock                 mocked external services
Coupon · CouponUsage                       discounts (per-user usage cap)
AdminActionLog                             audit trail for every admin write
```

Order items snapshot the product name and price at purchase time — later catalog
edits must never rewrite historical orders.

---

## Project layout

```
apps/api/         Express 5 API
  src/routes/     12 route modules (thin: validate → service → respond)
  src/services/   9 services — auth, cart, checkout, order, coupon, payment,
                  product, report, auditLog
  src/jobs/       5 cron jobs + advisory-lock helper
  src/middleware/ auth (requireAuth/requireRole) · validate · error
  prisma/         schema + 9 migrations + seed
  tests/          237 tests, integration tests on real Postgres
apps/web/         React 18 + Vite storefront and admin back office
packages/shared/  Zod schemas, error codes, types — shared by FE and BE
e2e/              Playwright: guest checkout, member+coupon checkout,
                  admin shipping, payment failure + stock restore, smoke
docs/adr/         8 architecture decision records
docs/api/         generated openapi.yaml (drift-tested)
```

---

## Status

Core commerce flow, admin back office, background jobs, E2E suite, and CI are
done. Public deployment (Vercel + Fly.io) is the remaining step — the
`docker compose` path above runs the whole system locally today.
