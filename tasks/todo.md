# Todo — E-commerce Platform

> Tracks task status. Full detail in `plan.md`.
> Mark: `[ ]` todo, `[~]` in-progress, `[x]` done, `[-]` skipped/deferred

---

## Phase 0 — Foundation

- [ ] T0.1 Monorepo init (pnpm workspaces + eslint + prettier + husky)
- [ ] T0.2 Docker Compose Postgres + .env.example
- [ ] T0.3 Shared package (Zod base schemas) ← **moved earlier (API depends on this)**
- [ ] T0.4 API skeleton (Express + error mw + Zod mw + helmet + rate limit + pino)
- [ ] T0.5 Web skeleton (Vite + Tailwind + shadcn + Router + Zustand + Query + Axios + Vite proxy to /api)
- [ ] T0.6 Prisma init + admin seed scaffold (no User model yet — owned by T1.1)
- [ ] T0.7 CI workflow (lint + typecheck + test + build, with Postgres service)
- [ ] T0.8 Test infra (Vitest + Supertest + per-test tx rollback helper)
- [ ] ✅ **Checkpoint 0** — `pnpm dev` works, CI green, human review

## Phase 1 — Auth

- [ ] T1.1 Schema: User (full, with role enum + is_demo_readonly) + RefreshToken (token_hash UNIQUE)
- [ ] T1.2 Auth services (hash / issue / rotate / grace / reuse-detect / revoke-family)
- [ ] T1.3 Auth endpoints (register / login / refresh / logout) + rate limit
- [ ] T1.4 Auth middleware (requireAuth / requireRole)
- [ ] T1.5 OpenAPI infra (zod-to-openapi) + auth endpoints documented
- [ ] T1.6 FE Axios + single-flight interceptor + cold-start refresh + auth store
- [ ] T1.7 FE Login + Register pages
- [ ] ✅ **Checkpoint 1** — auth roundtrip + reuse detection verified + **mergeGuestCart TODO hook 預留**

## Phase 2 — Catalog

- [ ] T2.1 Schema: Category / Product / Image / Variant / VariantOption / SKU
- [ ] T2.2 Seed: 5 categories, 30 products, ~3 SKUs each
- [ ] T2.3 Product APIs (categories / products list with cursor / detail) + N+1 test
- [ ] T2.4 OpenAPI: products
- [ ] T2.5 FE Home / List / Detail with variant picker
- [ ] ✅ **Checkpoint 2** — browse end-to-end, N+1 green

## Phase 3 — Cart

- [ ] T3.1 Schema: Cart + CartItem + CHECK constraint
- [ ] T3.2 Cart service & API (supports user_id OR session_id)
- [ ] T3.3 mergeGuestCart + fill Checkpoint 1's TODO hook in auth service (failure must not block login)
- [ ] T3.4 FE Cart drawer + AddToCart + merge toast
- [ ] ✅ **Checkpoint 3** — guest→login cart merge + truncation toast works

## Phase 4 — Checkout & Order

- [ ] T4.1 Schema: Order (payment_intent_id UNIQUE) / OrderItem / OrderStatusLog / PaymentMock / ShipmentMock
- [ ] T4.2 `transitionOrder` state machine service (matrix test)
- [ ] T4.3 `checkout` service (single tx: conditional stock UPDATE + order + snapshot + PaymentMock)
- [ ] T4.4 Checkout API + idempotent webhook (setTimeout delay + OrderStatusLog COUNT=1 assertion)
- [ ] T4.5 Concurrency test — **HTTP-level via Supertest** (not service-level Promise.all) + inverse-check sanity
- [ ] T4.6 FE Checkout / OrderSuccess / MyOrders
- [ ] ✅ **Checkpoint 4** — member checkout → webhook → PAID, concurrency green

## Phase 5 — Coupon

- [ ] T5.1 Schema: Coupon + CouponUsage (UNIQUE coupon+user)
- [ ] T5.2 `validateCoupon` service + validate API (5 fail codes covered)
- [ ] T5.3 Integrate coupon into checkout tx
- [ ] T5.4 FE Coupon input on checkout
- [ ] ✅ **Checkpoint 5** — coupon discount correct, no double-use

## Phase 6 — Admin

- [ ] T6.1 Schema: AdminActionLog
- [ ] T6.2 `withAuditLog` **HOF in service layer** (not Express middleware) — opens its own tx, deny-list filter for diff
- [ ] T6.3 Admin product / SKU APIs
- [ ] T6.4 Admin order APIs (transitions: SHIP / REFUND with role gate)
- [ ] T6.5 Admin coupon CRUD
- [ ] T6.6 Sales reports (daily / monthly / by-product)
- [ ] T6.7 FE admin layout + 4 pages (consider split: layout / products / orders / coupons+reports)
- [ ] ✅ **Checkpoint 6** — full admin flow + audit log accumulating

## Phase 7 — Background Jobs

- [ ] T7.1 Cron infra + advisory lock helper (two-process test)
- [ ] T7.2 Job: cancel timed-out orders (every 5 min)
- [ ] T7.3 Job: auto-complete shipped orders (daily)
- [ ] T7.4 Job: cleanup expired refresh tokens (daily)
- [ ] T7.5 Job: cleanup stale guest carts (`user_id IS NULL AND updated_at < now() - 7d`)
- [ ] T7.6 Job: reset demo DB every 6h (prod only, env-gated)
- [ ] ✅ **Checkpoint 7** — 5 jobs run, advisory lock prevents double-fire

## Phase 8 — E2E + Polish

- [ ] T8.1 Playwright setup + fixtures
- [ ] T8.2 E2E: Guest checkout
- [ ] T8.3 E2E: Member checkout with coupon
- [ ] T8.4 E2E: Admin shipping
- [ ] T8.5 ADRs (8 docs — better written incrementally per phase)
- [ ] T8.6 README + screenshots + architecture diagram + demo credentials
- [ ] T8.7 (Optional) Load test script (autocannon at /checkout)
- [ ] T8.8 Deployment — **Vercel rewrite proxy** same-origin strategy + demo readonly middleware + per-IP register limit
- [ ] T8.9 E2E: Payment failure path (outcome_mode='auto_failure' → CANCELLED → stock restored)
- [ ] ✅ **Checkpoint 8** — SPEC §1 Success Criteria all checked

---

## Resolved Decisions

- [x] Q1: 本機 + 線上 demo 都做（Fly/Render + Vercel） → T8.8
- [x] Q2: 角色用 enum：`CUSTOMER / ADMIN / SUPER_ADMIN` → SPEC §5
- [x] Q3: cart_session cookie TTL = 30 天 + sliding renewal → SPEC §5
- [x] Q4: PaymentMock 加 `outcome_mode`，失敗走 `PENDING → CANCELLED` → T8.9
