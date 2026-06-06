# Implementation Plan: E-commerce Platform

> Source spec: `SPEC.md` v2
> Plan version: v1 — Pending Review
> Last updated: 2026-06-05

---

## 1. Overview

把 SPEC.md 拆成 9 個 phase、約 55 個任務。Phase 0 是純基礎建設（必序列），Phase 1+ 採垂直切片（每個 slice 從 DB → API → FE 一次到位、可驗收）。每個 phase 結束有 checkpoint，沒過不進下一個。

設計目標：每個 task 限制在 S/M 規模（最多 5 檔案、單一 focused session 可完成），讓 agent 或人類獨立執行都能精準收斂。

---

## 2. Architecture Decisions（已從 SPEC 鎖定）

- **Monorepo**：pnpm workspaces（apps/web、apps/api、packages/shared、e2e）
- **DB-first 切法**：每個 slice 先建 schema → service → API → FE
- **狀態管理收斂**：訂單狀態轉換一律走 `transitionOrder()` service；admin 寫入一律走 `withAuditLog()` middleware
- **OpenAPI 自動產生**：zod-to-openapi，build 階段輸出 yaml
- **測試 DB 策略**：integration 用真實 Postgres + per-test transaction rollback；E2E 用 seed 出固定資料

---

## 3. Dependency Graph

```
Phase 0: Repo + DB + API/FE skeleton + CI
                │
        ┌───────┴────────┐
        ▼                ▼
   Phase 1: Auth    Phase 2: Catalog  ← 可平行
        │                │
        └───────┬────────┘
                ▼
        Phase 3: Cart
                │
                ▼
        Phase 4: Checkout + Order state machine
                │
        ┌───────┴────────┐
        ▼                ▼
   Phase 5: Coupon  Phase 6: Admin  ← 可平行（只在 checkout 整合點交會）
        └───────┬────────┘
                ▼
        Phase 7: Background jobs
                │
                ▼
        Phase 8: E2E + ADR + README
```

**平行化機會**：

- P1 & P2：foundation 完成後可由不同 session 平行
- P5 & P6：只在「coupon 套用 / admin 操作 order」交會
- ADR 邊做邊寫，不必拖到 Phase 8 才補

---

## 4. Phase 0 — Foundation

> 必序列。完成後整個專案應能 `pnpm dev` 起服務、CI 全綠。

### T0.1 Monorepo init

**Description:** 建立 pnpm workspace、根 tsconfig/eslint/prettier、husky pre-commit。
**Acceptance:**

- [ ] `pnpm install` 成功
- [ ] 根目錄有 `pnpm-workspace.yaml`、`tsconfig.base.json`、`.eslintrc`、`.prettierrc`
- [ ] husky pre-commit 跑 lint-staged（lint + typecheck）
      **Verification:**
- [ ] 故意寫一行 lint 錯誤，commit 被擋
      **Dependencies:** None
      **Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.husky/pre-commit`, `.gitignore`
      **Scope:** S

### T0.2 Docker Compose + env

**Description:** Postgres 16 容器 + `.env.example`，明確區分 app DB 與 test DB。
**Acceptance:**

- [ ] `docker compose up -d` 起 Postgres
- [ ] `.env.example` 列出所有必要變數（含 `DATABASE_URL`、`TEST_DATABASE_URL`、`JWT_SECRET` 等）
- [ ] `.env` 在 `.gitignore`
      **Verification:**
- [ ] `psql $DATABASE_URL -c '\l'` 成功
      **Dependencies:** T0.1
      **Files:** `docker-compose.yml`, `.env.example`, `.gitignore`
      **Scope:** S

### T0.3 Shared package（前置依賴）

**Description:** `packages/shared` 放共用 Zod schema + 型別；先放 `ErrorResponse`、`Pagination` 基礎型別。**必須先於 API skeleton**（API error middleware 需要這個型別）。
**Acceptance:**

- [ ] api、web 都可 `import { ErrorResponse } from '@app/shared'`
      **Verification:**
- [ ] typecheck 通過
      **Dependencies:** T0.1
      **Files:** `packages/shared/src/index.ts`, `packages/shared/src/errors.ts`, `packages/shared/package.json`
      **Scope:** S

### T0.4 API skeleton

**Description:** Express + TS，含 error middleware、Zod 驗證 middleware、Helmet、rate limit、pino logger。Error middleware 回應格式對齊 `@app/shared` 的 `ErrorResponse`。
**Acceptance:**

- [ ] `GET /api/health` 回 200
- [ ] `AppError(code, message, status)` 經 error middleware 轉成 shared `ErrorResponse` 型別的 JSON
- [ ] 非預期錯誤回 500 且不洩漏 stack（dev 模式才回）
      **Verification:**
- [ ] Supertest：`/api/health` 200、刻意 throw 觀察 error format
      **Dependencies:** T0.1, T0.3
      **Files:** `apps/api/src/index.ts`, `apps/api/src/lib/errors.ts`, `apps/api/src/middleware/error.ts`, `apps/api/src/middleware/validate.ts`, `apps/api/package.json`, `apps/api/tsconfig.json`
      **Scope:** M

### T0.5 Web skeleton

**Description:** Vite + React + TS + Tailwind + shadcn + Router + Zustand + TanStack Query + Axios baseURL。
**Acceptance:**

- [ ] `pnpm dev:web` 起 dev server，首頁顯示 "Hello"
- [ ] Tailwind 樣式生效、shadcn Button 可用
- [ ] Axios client (`lib/apiClient.ts`) 設好 baseURL（dev 走 Vite proxy 到 `/api`、prod 走 Vercel rewrites）+ `withCredentials: true`
      **Verification:**
- [ ] 瀏覽器看到首頁
      **Dependencies:** T0.1, T0.3
      **Files:** `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/lib/apiClient.ts`, `apps/web/tailwind.config.js`, `apps/web/vite.config.ts`, `apps/web/package.json`
      **Scope:** M

### T0.6 Prisma init + admin seed scaffold

**Description:** Prisma client 設定、`schema.prisma` 骨架（暫不放任何 model；各 slice 自己加）、`pnpm db:migrate` / `pnpm db:seed` 指令掛起來、`db.ts` 匯出 prisma client。**不在這裡定義 User**（避免後續 T1.1 二度 migrate）。
**Acceptance:**

- [ ] `pnpm db:migrate` 成功（即使是 no-op）
- [ ] `pnpm db:seed` 可執行（先放骨架函式）
- [ ] `prisma generate` 產出 client 可被 api 使用
      **Verification:**
- [ ] `prisma migrate status` 乾淨
      **Dependencies:** T0.2, T0.4
      **Files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`, `apps/api/src/lib/db.ts`
      **Scope:** S

### T0.7 CI pipeline

**Description:** GitHub Actions：lint + typecheck + test + build；服務化 Postgres for tests。
**Acceptance:**

- [ ] PR 觸發 workflow
- [ ] 四個 job 全綠
      **Verification:**
- [ ] 開一個 dummy PR 看 CI 結果
      **Dependencies:** T0.6
      **Files:** `.github/workflows/ci.yml`
      **Scope:** M

### T0.8 Test infra

**Description:** Vitest + Supertest 設定；建立 `withTestTx` helper，所有 integration test 在 tx 內跑、結束 rollback。
**Acceptance:**

- [ ] `pnpm test` 跑得起來
- [ ] 範例測試示範 tx rollback：寫一筆 user，測試結束後資料庫沒有那筆
      **Verification:**
- [ ] 連跑兩次 `pnpm test` 不會因前次資料污染
      **Dependencies:** T0.6
      **Files:** `apps/api/vitest.config.ts`, `apps/api/tests/setup.ts`, `apps/api/tests/helpers/withTestTx.ts`, `apps/api/tests/example.test.ts`
      **Scope:** M

### ✅ Checkpoint 0 — Foundation

- [ ] `pnpm dev` 同時起 api + web，瀏覽器看到 hello + `/api/health` 200
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全綠
- [ ] CI 在 PR 上跑過一次
- [ ] **與 human review 後才進 Phase 1**

---

## 5. Phase 1 — Auth Slice

### T1.1 Schema: User (full) + RefreshToken

**Description:** **一次定義完整 User**（含 `role` enum: `CUSTOMER | ADMIN | SUPER_ADMIN`、`is_demo_readonly BOOLEAN DEFAULT false`）+ RefreshToken（含 family_id、`token_hash UNIQUE`、parent_id、revoked_at、expires_at、user_agent、ip）。同時補上 `pnpm db:seed` 寫入 demo 帳號（標 readonly）+ admin 帳號。
**Acceptance:**

- [ ] migration 跑過（一份完整 migration，無中途版本）
- [ ] `RefreshToken.token_hash` 標 `@unique`（Prisma `findUnique` 才能用）
- [ ] index on `(user_id, family_id)`
- [ ] seed 後可看到 demo / admin / super_admin 三個帳號
      **Verification:**
- [ ] `prisma studio` 看欄位齊全；token_hash 有 unique constraint
      **Dependencies:** Checkpoint 0
      **Files:** `apps/api/prisma/schema.prisma`, 新 migration, `apps/api/prisma/seed.ts`
      **Scope:** S

### T1.2 Auth services

**Description:** `hashPassword`、`issueAccessToken`、`issueRefreshToken`（產 opaque + 存 hash + family 管理）、`rotateRefreshToken`（含 grace window + reuse detection）、`revokeFamily`。
**Acceptance:**

- [ ] Vitest 覆蓋：rotation 成功路徑、grace window（10s 內舊 token 接受）、reuse detection（revoked token 再用 → revokeFamily）
      **Verification:**
- [ ] Vitest 全綠
      **Dependencies:** T1.1
      **Files:** `apps/api/src/services/authService.ts`, `apps/api/tests/services/authService.test.ts`
      **Scope:** M

### T1.3 Auth endpoints

**Description:** `POST /auth/register`、`/auth/login`、`/auth/refresh`、`/auth/logout`；refresh cookie 設 HttpOnly+Secure+SameSite=Lax+Path=/api/auth。
**Acceptance:**

- [ ] register 寫 user + 自動 login（回 access + set refresh cookie）
- [ ] login 速率限制 5/min/IP
- [ ] refresh 換新 access + 新 refresh（rotate）
- [ ] logout 撤銷 DB 端 refresh + 清 cookie
      **Verification:**
- [ ] Supertest：每條 endpoint happy + 主要錯誤（密碼錯、refresh 過期、reuse 攻擊）
      **Dependencies:** T1.2
      **Files:** `apps/api/src/routes/auth.ts`, `apps/api/src/schemas/auth.ts`, `apps/api/tests/api/auth.test.ts`
      **Scope:** M

### T1.4 Auth middleware

**Description:** `requireAuth`（解 access、注入 `req.user`）、`requireRole('admin'|'super_admin')`。
**Acceptance:**

- [ ] 沒帶 token → 401；token 無效 → 401；角色不符 → 403
      **Verification:**
- [ ] Supertest：保護一條 dummy route 測三種狀態
      **Dependencies:** T1.3
      **Files:** `apps/api/src/middleware/auth.ts`, `apps/api/tests/middleware/auth.test.ts`
      **Scope:** S

### T1.5 OpenAPI infra + auth docs

**Description:** 接 `zod-to-openapi`，build 階段產出 `docs/api/openapi.yaml`；swagger-ui 掛 `/api/docs`。先把 auth 四條 endpoint 文件化。
**Acceptance:**

- [ ] `/api/docs` 顯示 4 條 auth endpoint
- [ ] yaml 進 git
      **Verification:**
- [ ] 瀏覽器看 swagger-ui
      **Dependencies:** T1.3
      **Files:** `apps/api/src/lib/openapi.ts`, `apps/api/scripts/generate-openapi.ts`, `docs/api/openapi.yaml`
      **Scope:** M

### T1.6 FE: Axios client + auth store

**Description:** Axios interceptor：(a) 401 觸發 refresh + single-flight queue、(b) 重試原 request；Zustand auth store；app boot 主動 `/refresh`。
**Acceptance:**

- [ ] 平行 5 個 401 只觸發 1 個 refresh request（用 mock 驗）
- [ ] F5 後使用者仍在登入狀態
      **Verification:**
- [ ] Vitest（FE）+ 手動瀏覽器測 F5
      **Dependencies:** T1.3
      **Files:** `apps/web/src/lib/apiClient.ts`, `apps/web/src/stores/authStore.ts`, `apps/web/src/lib/__tests__/apiClient.test.ts`
      **Scope:** M

### T1.7 FE: Login + Register pages

**Description:** 兩頁基本表單 + Zod 驗證（共用 shared schema）+ 錯誤顯示。
**Acceptance:**

- [ ] 註冊成功跳首頁、登入失敗顯示錯誤
      **Verification:**
- [ ] 手動瀏覽器走一遍
      **Dependencies:** T1.6
      **Files:** `apps/web/src/pages/Login.tsx`, `apps/web/src/pages/Register.tsx`, `apps/web/src/features/auth/`
      **Scope:** S

### ✅ Checkpoint 1 — Auth

- [ ] 可註冊 / 登入 / F5 維持登入 / 登出
- [ ] Supertest：reuse detection 主動撤 family（觀察 DB）
- [ ] swagger-ui 看到 auth 文件
- [ ] **預留 mergeGuestCart 接點**：login service 內留 `// TODO(P3): mergeGuestCart(userId, sessionId, tx)` 註解 + space；Phase 3 T3.3 會在此處填邏輯（明文承認 P3 會回頭改 P1，避免 P1 假裝完成）

---

## 6. Phase 2 — Product Catalog Slice

### T2.1 Schema: Category / Product / Variant / SKU

**Description:** 五張表（Category, Product, ProductImage, Variant, VariantOption, SKU）+ index on `category_id, status, created_at`。
**Acceptance:**

- [ ] migration 跑過
- [ ] SKU 有 `option_combination JSON`（反正規化欄位，ADR 解釋）
      **Verification:**
- [ ] prisma studio 結構正確
      **Dependencies:** Checkpoint 0
      **Files:** `prisma/schema.prisma`, 新 migration
      **Scope:** S

### T2.2 Seed data

**Description:** 5 分類、30 商品、平均 3 SKU、每個商品 2-3 張圖（用 placeholder URL）。
**Acceptance:**

- [ ] `pnpm db:seed` 後 product count = 30
      **Verification:**
- [ ] SQL count 確認
      **Dependencies:** T2.1
      **Files:** `apps/api/prisma/seed.ts`, `apps/api/prisma/seed/products.ts`
      **Scope:** S

### T2.3 Product APIs

**Description:** `GET /categories`、`GET /products`（cursor pagination + filter by category/status）、`GET /products/:slug`（含 variants/SKUs）。
**Acceptance:**

- [ ] 列表回 `{ items, nextCursor }`
- [ ] 詳細頁回完整 variant/SKU 結構
- [ ] N+1 防禦：列表只一次 query（測試用 `prisma.$on('query')` 計次）
      **Verification:**
- [ ] Supertest 三條 endpoint + N+1 計次
      **Dependencies:** T2.2
      **Files:** `apps/api/src/routes/products.ts`, `apps/api/src/services/productService.ts`, `apps/api/tests/api/products.test.ts`
      **Scope:** M

### T2.4 OpenAPI: products

**Description:** 把 T2.3 的 endpoint 加入 openapi.yaml。
**Acceptance:**

- [ ] swagger-ui 看得到
      **Dependencies:** T2.3, T1.5
      **Files:** `apps/api/src/routes/products.ts`（schema 註冊）
      **Scope:** XS

### T2.5 FE: Home / List / Detail

**Description:** 三頁，TanStack Query 串資料；商品詳細頁含 variant picker（選完計算對應 SKU）。
**Acceptance:**

- [ ] 列表分頁可滾動載入
- [ ] 詳細頁切換 variant 顯示對應價格 + 庫存
      **Verification:**
- [ ] 手動瀏覽
      **Dependencies:** T2.3, T0.4
      **Files:** `apps/web/src/pages/Home.tsx`, `apps/web/src/pages/ProductList.tsx`, `apps/web/src/pages/ProductDetail.tsx`, `apps/web/src/features/products/`
      **Scope:** M

### ✅ Checkpoint 2 — Catalog

- [ ] 訪客可從首頁 → 列表 → 詳細頁 → 選 variant
- [ ] N+1 測試綠

---

## 7. Phase 3 — Cart Slice

### T3.1 Schema: Cart + CartItem

**Description:** Cart + CartItem + CHECK constraint（user_id 或 session_id 至少一）+ unique partial index（user_id 唯一、session_id 唯一）。
**Dependencies:** Checkpoint 2
**Scope:** S

### T3.2 Cart service & API

**Description:** `GET /cart`、`POST /cart/items`、`PATCH /cart/items/:id`、`DELETE /cart/items/:id`。同時支援 user_id（JWT）與 session_id（cookie）。
**Acceptance:**

- [ ] 訪客操作：first add 自動發 `cart_session` cookie（HttpOnly, Lax）
- [ ] 加超量直接 409 OUT_OF_STOCK
      **Verification:**
- [ ] Supertest：guest + member 兩條路徑
      **Dependencies:** T3.1
      **Files:** `apps/api/src/routes/cart.ts`, `apps/api/src/services/cartService.ts`, `apps/api/tests/api/cart.test.ts`
      **Scope:** M

### T3.3 Cart merge on login（回頭填 P1 預留接點）

**Description:** 實作 `mergeGuestCart(userId, sessionId, tx)` — 合併 & 截斷 & 丟下架；填入 Checkpoint 1 留下的 `// TODO(P3)` 接點（login + register flow 內同一 tx）；response 多帶 `cartMergeResult: { truncatedItems, droppedItems }`。
**Acceptance:**

- [ ] guest cart 與 member cart 同 SKU 加總
- [ ] 加總超 stock 截斷到 stock；前端收到 truncated list
- [ ] 下架 SKU 靜默丟棄
- [ ] 合併完 guest cart 被刪
- [ ] merge 內部失敗只 log warning，不擋登入（前端走 fallback toast）
      **Verification:**
- [ ] Supertest：四種 case（無衝突、有衝突、截斷、下架）+ 一種 merge 拋錯不擋登入
      **Dependencies:** T3.2, T1.3
      **Files:** `apps/api/src/services/cartService.ts`、`apps/api/src/services/authService.ts`（填 TODO 接點）、test
      **Scope:** M

### T3.4 FE: Cart drawer + AddToCart

**Description:** Header cart icon 開 drawer；商品詳細頁 AddToCart 按鈕；toast 顯示截斷/下架訊息。
**Acceptance:**

- [ ] 訪客加完商品在 drawer 看得到
- [ ] 登入後 toast 顯示「N 件商品已達上限／已下架」
      **Verification:**
- [ ] 手動：未登入加 → 註冊 → 看到合併結果與 toast
      **Dependencies:** T3.3, T2.5
      **Files:** `apps/web/src/features/cart/`, `apps/web/src/stores/cartStore.ts`, `apps/web/src/components/CartDrawer.tsx`
      **Scope:** M

### ✅ Checkpoint 3 — Cart

- [ ] 訪客加車 → 登入 → 合併 + 截斷 toast 顯示

---

## 8. Phase 4 — Checkout & Order State Machine

### T4.1 Schema: Order family

**Description:** Order（含 status enum、`payment_intent_id UNIQUE`、`paid_at`、`shipped_at`）、OrderItem（`sku_snapshot JSON`）、OrderStatusLog、PaymentMock、ShipmentMock。
**Dependencies:** Checkpoint 3
**Scope:** S

### T4.2 Order state machine service

**Description:** `transitionOrder(orderId, toStatus, actor, ctx)` — 驗證合法轉換、寫 OrderStatusLog、執行副作用（庫存回補、ShipmentMock 建立、PaymentMock refund）。
**Acceptance:**

- [ ] 非法轉換 throw 409 `INVALID_STATUS_TRANSITION`
- [ ] CANCELLED / REFUNDED 在同 tx 回補 stock
      **Verification:**
- [ ] Vitest 矩陣式測所有 from×to 組合
      **Dependencies:** T4.1
      **Files:** `apps/api/src/services/orderService.ts`, `apps/api/tests/services/orderService.test.ts`
      **Scope:** M

### T4.3 Checkout service

**Description:** `checkout(userId, input)` — 在單一 tx 內：(a) 對每個 cartItem 跑 conditional UPDATE 扣庫存、(b) 建 Order + OrderItem(snapshot)、(c) 建 PaymentMock(PENDING)、(d) 清 cart。
**Acceptance:**

- [ ] 任一 SKU 不足 → 整個 tx rollback + 回 409
- [ ] 成功 → Order status = PENDING、cart 清空、回 `{ orderId, paymentIntent }`
      **Verification:**
- [ ] Vitest + Supertest 各一
      **Dependencies:** T4.2
      **Files:** `apps/api/src/services/checkoutService.ts`, tests
      **Scope:** M

### T4.4 Checkout API + Webhook

**Description:** `POST /checkout`、`GET /orders`、`GET /orders/:id`（會員）、`POST /webhooks/payment/mock`（idempotent）。Webhook 觸發走 `setTimeout(..., 200-500ms)` 模擬延遲，確保 checkout response 已送回。
**Acceptance:**

- [ ] webhook 重送：第二次呼叫 updated rows = 0、no-op、回 200
- [ ] 訂單 paid 後 status = PAID、paid_at 有值
- [ ] auto_failure 模式：response 送回後才轉 CANCELLED（不會出現 FE 拿到 PENDING 後瞬間變 CANCELLED 的詭異 race）
      **Verification:**
- [ ] Supertest：重送 webhook N 次後 `SELECT COUNT(*) FROM OrderStatusLog WHERE order_id=? AND to_status='PAID'` **嚴格 = 1**（不是只看 status 不變）
- [ ] Supertest：auto_failure 流程下，checkout response 收到時訂單為 PENDING；等待後再查為 CANCELLED + stock 回補
      **Dependencies:** T4.3
      **Files:** `apps/api/src/routes/checkout.ts`, `apps/api/src/routes/orders.ts`, `apps/api/src/routes/webhooks.ts`, tests
      **Scope:** M

### T4.5 Concurrency test (HTTP-level)

**Description:** **必須走 HTTP 層**：用 Supertest 開 N 個獨立 request 並行打 `POST /api/checkout`，逼出真實 DB row lock 與 conditional UPDATE 競態。**不可用 service 層 Promise.all**（Prisma `$transaction` 內部會序列化，假綠燈）。
**Acceptance:**

- [ ] 10 個並發 HTTP 請求對 stock=5 的 SKU → 恰 5 個 200、5 個 409 OUT_OF_STOCK、終局 stock = 0
- [ ] 連跑 10 次無 flake
      **Verification:**
- [ ] 故意把 conditional UPDATE 條件拿掉（`WHERE stock >= qty` 刪掉）→ 測試必須失敗（驗證測試本身真的在測並發）
      **Dependencies:** T4.4
      **Files:** `apps/api/tests/concurrency/checkout.test.ts`
      **Scope:** S

### T4.6 FE: Checkout / Order pages

**Description:** Checkout 頁（選地址、顯示明細、送出）、訂單成功頁、My Orders 列表 + 詳情。
**Acceptance:**

- [ ] 結帳後跳成功頁、My Orders 看得到
      **Verification:**
- [ ] 手動走完
      **Dependencies:** T4.4
      **Files:** `apps/web/src/pages/Checkout.tsx`, `apps/web/src/pages/OrderSuccess.tsx`, `apps/web/src/pages/MyOrders.tsx`, `apps/web/src/features/checkout/`
      **Scope:** M

### ✅ Checkpoint 4 — Checkout

- [ ] 會員結帳 → mock webhook → 訂單變 PAID
- [ ] 並發測試綠

---

## 9. Phase 5 — Coupon Slice

### T5.1 Schema: Coupon + CouponUsage

**Description:** Coupon + CouponUsage（`UNIQUE(coupon_id, user_id)` 強制每人 1 次）。
**Dependencies:** Checkpoint 4
**Scope:** S

### T5.2 Coupon service & validation API

**Description:** `validateCoupon(code, userId, subtotal)` 檢查 min_amount / 日期 / usage_limit / per-user；`POST /coupons/validate` 回試算後折扣。
**Acceptance:**

- [ ] 五種失敗 code：EXPIRED / NOT_STARTED / LIMIT_REACHED / ALREADY_USED / BELOW_MIN
      **Verification:**
- [ ] Supertest 矩陣
      **Dependencies:** T5.1
      **Files:** `apps/api/src/services/couponService.ts`, `apps/api/src/routes/coupons.ts`, tests
      **Scope:** M

### T5.3 Checkout 整合

**Description:** checkout 接受 `couponCode`，套用後在同 tx 寫 CouponUsage；併發第二人套同 limit=1 的券 → 409。
**Acceptance:**

- [ ] Order.discount 正確 = 計算結果
- [ ] CouponUsage 寫一筆
      **Verification:**
- [ ] 加 supertest：成功 + 重複使用 + 並發競爭
      **Dependencies:** T5.2, T4.3
      **Files:** `apps/api/src/services/checkoutService.ts`（改）, test
      **Scope:** S

### T5.4 FE: Coupon input on checkout

**Description:** 結帳頁加 coupon code 輸入框 + 驗證 + 顯示折扣後金額。
**Dependencies:** T5.3, T4.6
**Files:** `apps/web/src/features/checkout/CouponInput.tsx`, Checkout page edit
**Scope:** S

### ✅ Checkpoint 5 — Coupon

- [ ] 含折價券結帳金額正確、無法重複使用

---

## 10. Phase 6 — Admin Slice

### T6.1 Schema: AdminActionLog

**Dependencies:** Checkpoint 4
**Files:** schema + migration
**Scope:** XS

### T6.2 withAuditLog Higher-Order Function（**非** middleware）

**Description:** Service 層 HOF：`withAuditLog({ actor, resourceType, action, resourceId }, async (tx) => coreLogic(tx))`。內部開 `prisma.$transaction`，將 tx 傳給 coreLogic 執行，成功時於同 tx 寫 AdminActionLog；失敗整個 rollback。**不是** Express middleware（Prisma tx 生命週期綁 callback，middleware 無法跨 `next()` 傳 tx）。Admin route handler 內呼叫此 HOF。
**Acceptance:**

- [ ] core logic throw → 整個 tx rollback、AdminActionLog 無紀錄
- [ ] core logic 成功 → 業務變更與 audit log 同一 tx commit
- [ ] `diff` 寫入時自動過濾 deny-list 欄位（password_hash / token_hash / refresh_token / ip / user_agent）
      **Verification:**
- [ ] Vitest：兩種情境 + deny-list 過濾驗證
      **Dependencies:** T6.1
      **Files:** `apps/api/src/services/auditLog.ts`、`apps/api/src/services/__tests__/auditLog.test.ts`
      **Scope:** M

### T6.3 Admin product / SKU APIs

**Description:** admin product CRUD + SKU 庫存調整 endpoint，全部走 `withAuditLog`。
**Acceptance:**

- [ ] CRUD 各一條 Supertest + audit log 存在
      **Dependencies:** T6.2
      **Files:** `apps/api/src/routes/admin/products.ts`, test
      **Scope:** M

### T6.4 Admin order APIs

**Description:** list orders、order detail、轉態 endpoint（PAID→SHIPPED、\*→REFUNDED）。
**Acceptance:**

- [ ] super_admin 才能 REFUND
- [ ] 觸發 `transitionOrder`
      **Dependencies:** T6.2, T4.2
      **Files:** `apps/api/src/routes/admin/orders.ts`, test
      **Scope:** M

### T6.5 Admin coupon APIs

**Description:** Coupon CRUD（admin 才能建）。
**Dependencies:** T6.2, T5.1
**Files:** `apps/api/src/routes/admin/coupons.ts`, test
**Scope:** S

### T6.6 Sales report APIs

**Description:** `GET /admin/reports/daily`、`/monthly`、`/by-product`（用 SQL aggregation；非 mock payment 數，是真實 Order）。
**Acceptance:**

- [ ] 三條 endpoint 回正確 sum
      **Verification:**
- [ ] Supertest：seed 幾筆訂單後跑報表斷言金額
      **Dependencies:** T4.4
      **Files:** `apps/api/src/routes/admin/reports.ts`, `apps/api/src/services/reportService.ts`, test
      **Scope:** M

### T6.7 FE: Admin layout + pages

**Description:** Admin 路由群（`/admin/*` requireRole）、sidebar、product mgmt、order mgmt、coupon mgmt、reports。
**Acceptance:**

- [ ] 非 admin 進 `/admin` → 跳首頁
- [ ] 四個頁面可操作
      **Dependencies:** T6.3, T6.4, T6.5, T6.6
      **Files:** `apps/web/src/pages/admin/`, `apps/web/src/features/admin/`
      **Scope:** L（可拆 4 個子任務：layout、products、orders、coupons+reports）

### ✅ Checkpoint 6 — Admin

- [ ] Admin 可：上架商品 / 調庫存 / 出貨 / 退款 / 發券 / 看報表
- [ ] AdminActionLog 累積正確

---

## 11. Phase 7 — Background Jobs

### T7.1 Cron infra + advisory lock

**Description:** `withAdvisoryLock(key, fn)` helper；cron registry（啟動時註冊所有 job）。
**Acceptance:**

- [ ] 兩個 process 同時跑 → 只有一個拿到 lock
      **Verification:**
- [ ] Vitest：開兩個 connection 同 advisory key
      **Dependencies:** Checkpoint 4
      **Files:** `apps/api/src/jobs/index.ts`, `apps/api/src/lib/advisoryLock.ts`, test
      **Scope:** M

### T7.2 Job: cancel timed-out orders

**Description:** 每 5 min 掃 `status='PENDING' AND created_at < now() - 30min` → `transitionOrder(_, 'CANCELLED', system)`。
**Acceptance:**

- [ ] Vitest：seed 過期單，跑 job 後變 CANCELLED + 庫存回補
      **Dependencies:** T7.1, T4.2
      **Files:** `apps/api/src/jobs/cancelTimedOutOrders.ts`, test
      **Scope:** S

### T7.3 Job: auto-complete shipped orders

**Description:** 每日掃 `status='SHIPPED' AND shipped_at < now() - 7d` → `transitionOrder(_, 'COMPLETED', system)`。
**Dependencies:** T7.1, T4.2
**Files:** `apps/api/src/jobs/autoCompleteShippedOrders.ts`, test
**Scope:** S

### T7.4 Job: cleanup refresh tokens

**Description:** 每日刪除過期或 revoked 超過 30 天的 RefreshToken。
**Dependencies:** T7.1, T1.1
**Files:** `apps/api/src/jobs/cleanupRefreshTokens.ts`, test
**Scope:** S

### T7.5 Job: cleanup stale guest carts

**Description:** 每日刪除 `user_id IS NULL AND updated_at < now() - 7d` 的 Cart + CartItem（對齊 `cart_session` cookie TTL 7 天），防止無效 session 累積。
**Acceptance:**

- [ ] Vitest：seed 過期 guest cart、跑 job 後該 cart + items 都消失；同期會員 cart 不受影響
      **Dependencies:** T7.1, T3.1
      **Files:** `apps/api/src/jobs/cleanupStaleGuestCarts.ts`, test
      **Scope:** S

### T7.6 Job: reset demo DB（線上 demo 專用）

**Description:** 每 6 小時 truncate user-generated 表（Order / OrderItem / Cart / RefreshToken / CouponUsage / AdminActionLog）並重 seed 商品與 demo 帳號。**只在 `NODE_ENV=production` 且 `RESET_DEMO_DB=true` 啟動**。
**Acceptance:**

- [ ] env flag 關閉時不註冊
- [ ] 跑完後 demo 帳號還在、商品還在、訂單清空
      **Dependencies:** T7.1
      **Files:** `apps/api/src/jobs/resetDemoDb.ts`, test
      **Scope:** S

### ✅ Checkpoint 7 — Jobs

- [ ] 五個 job 在 dev 跑得起來、advisory lock 防重複

---

## 12. Phase 8 — E2E + Polish

### T8.1 Playwright setup

**Description:** Playwright config、共用 fixture（reset DB 一次 + seed）、page object 基礎。
**Acceptance:**

- [ ] `pnpm test:e2e` 跑得起來（先跑一個 dummy test）
      **Dependencies:** Checkpoint 6
      **Files:** `e2e/playwright.config.ts`, `e2e/fixtures/`, `e2e/tests/smoke.spec.ts`
      **Scope:** M

### T8.2 E2E: Guest checkout

**Description:** 首頁 → 商品 → 加車（訪客）→ 註冊 → 結帳 → 訂單成立。
**Dependencies:** T8.1
**Files:** `e2e/tests/guest-checkout.spec.ts`
**Scope:** S

### T8.3 E2E: Member checkout with coupon

**Dependencies:** T8.1
**Files:** `e2e/tests/member-coupon-checkout.spec.ts`
**Scope:** S

### T8.4 E2E: Admin shipping

**Description:** 登入 admin → 找 paid order → 出貨 → 觀察狀態 + audit log。
**Dependencies:** T8.1
**Files:** `e2e/tests/admin-shipping.spec.ts`
**Scope:** S

### T8.5 ADRs（補齊 8 篇）

**Description:** 把 SPEC §8 列的 ADR 寫成 markdown 放 `docs/adr/`。
**Acceptance:**

- [ ] 8 篇都存在、格式統一（Context / Decision / Consequences）
      **Dependencies:** 各 phase 完成
      **Files:** `docs/adr/0001-*.md` ~ `0008-*.md`
      **Scope:** M（建議邊做邊寫，最後集中校稿）

### T8.6 README + screenshots

**Description:** Quickstart、架構圖、demo 帳號、截圖（首頁/商品/結帳/後台/報表）；**顯著位置標註線上 demo 限制**（demo 帳號 read-only、每 IP 註冊上限、DB 每 6h 重置）。
**Acceptance:**

- [ ] README 首頁有「Live Demo」區塊：URL + demo 帳號 + 限制聲明
- [ ] Quickstart：本機 docker compose + pnpm dev 一條龍
- [ ] 5 張以上截圖
      **Dependencies:** All slices
      **Files:** `README.md`, `docs/screenshots/`
      **Scope:** M

### T8.7 (Optional) Load test

**Description:** autocannon 腳本對 `/checkout` 壓 50 RPS、觀察 p95；放在 `scripts/load/`。
**Dependencies:** Checkpoint 4
**Scope:** S

### T8.8 Deployment（Vercel rewrite proxy 同源策略）

**Description:** API + DB → Fly.io 或 Render（免費 tier）；Web → Vercel；**關鍵：用 `vercel.json` rewrites 把 `/api/:path*` 反向代理到真實 API origin**（瀏覽器看起來同源 → refresh cookie `SameSite=Lax` 正常運作、不需 CORS、CSRF 表面積最小）。CI 加 deploy job（main 分支觸發）；prod swagger 預設關閉。Demo 帳號程式端鎖死寫入（middleware 檢查 `is_demo_readonly` → 403 `DEMO_ACCOUNT_READONLY`）。
**Acceptance:**

- [ ] 公開可訪問的前台 URL
- [ ] **登入後 refresh cookie 能在跨 page reload 後維持登入**（驗證 Vercel rewrite proxy 同源策略生效）
- [ ] demo 帳號嘗試下單 → 403 `DEMO_ACCOUNT_READONLY`
- [ ] 一般訪客帳號可走完一筆訂單
- [ ] 本機 `docker compose up -d && pnpm dev` 仍正常（兩條路徑並存）
- [ ] prod 環境 `/api/docs` 不暴露（401 或 disable）
- [ ] 每 IP 註冊限制 3/day 生效
      **Verification:**
- [ ] 把 URL 開到陌生瀏覽器（無 cookie）走完訪客結帳
- [ ] 用 demo 帳號嘗試各種寫入 → 全部 403
- [ ] DevTools 觀察 cookie：refresh cookie domain 是 Vercel domain（非 API domain）
      **Dependencies:** Checkpoint 6
      **Files:** `fly.toml` 或 `render.yaml`、`vercel.json`（**含 rewrites 設定**）、`.github/workflows/deploy.yml`、`apps/api/src/middleware/demoReadonly.ts`、README 部署章節
      **Scope:** M

### T8.9 E2E: Payment failure path

**Description:** checkout 時帶 `outcome_mode='auto_failure'` → webhook 回 failure → 訂單轉 CANCELLED → 庫存回補 → FE 顯示失敗提示與重試入口。
**Acceptance:**

- [ ] E2E：下單 → 看到「付款失敗」頁 → 庫存恢復原數量
      **Dependencies:** T8.1, T4.4
      **Files:** `e2e/tests/payment-failure.spec.ts`
      **Scope:** S

### ✅ Checkpoint 8 — Ship

- [ ] SPEC §1 所有 Success Criteria 打勾
- [ ] CI 綠燈
- [ ] README 截圖 + demo 帳號齊全
- [ ] 三個 E2E 全綠

---

## 13. Risks and Mitigations

| Risk                                                   | Impact | Mitigation                                                                                 |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------ |
| Webhook idempotency 寫錯 → 雙重 paid                   | High   | T4.4 用 OrderStatusLog COUNT=1 嚴格斷言（非 status 不變）；UNIQUE constraint 兜底          |
| Refresh rotation grace window 邏輯誤判                 | Med    | T1.2 矩陣測試（happy / reuse / grace / expired）必須先綠才進 T1.3                          |
| 並發超賣                                               | High   | T4.5 強制 HTTP-level 並發；倒置驗證（拿掉 conditional 條件測試必須變紅）                   |
| Cart merge 在 login 內失敗回滾整個 login               | Med    | merge 失敗只 log warning + 前端 toast，不擋登入；T3.3 acceptance 含此案例                  |
| OpenAPI 自動產出與 zod 不同步                          | Low    | T1.5 起 CI 加一步 `pnpm openapi:check`（diff 出檔比對）                                    |
| node-cron 在多 instance 重複跑                         | Med    | T7.1 advisory lock 必測                                                                    |
| **Vercel rewrite proxy 在 dev 環境跟 prod 行為不一致** | Med    | dev 用 Vite proxy 模擬同源；E2E 至少跑一次在 staging 環境（rewrite 生效）驗 refresh cookie |
| **Demo 帳號被繞過寫入限制**                            | High   | `is_demo_readonly` flag 在 service 層而非 route 層檢查；T6.x 寫入 path 全部加測試          |

---

## 14. Open Questions — 已全部收斂

| #   | 議題                      | 決議                                                                       | 落地位置                  |
| --- | ------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| 1   | 部署？                    | **本機 + 線上 demo 都做**（Fly/Render + Vercel）                           | T8.8、SPEC §1、§8         |
| 2   | Admin 角色                | **Enum：`CUSTOMER / ADMIN / SUPER_ADMIN`**                                 | SPEC §5 User schema       |
| 3   | `cart_session` cookie TTL | **30 天 + 每次寫入 sliding renewal**                                       | SPEC §5 Cart              |
| 4   | Payment 失敗 E2E          | **需要**：PaymentMock 加 `outcome_mode` 欄位、失敗走 `PENDING → CANCELLED` | SPEC §5 PaymentMock、T8.9 |

---

## 15. Parallelization Map（多 session 加速時）

- Foundation 完成後：**P1 Auth** 與 **P2 Catalog** 完全獨立，可雙開
- P5 Coupon 的 T5.1+T5.2 不依賴 P6，可與 P6.1-P6.3 平行；T5.3 需等 T4.3
- ADR T8.5：拆給每個 phase 收尾時寫自己的那篇
- E2E T8.2-T8.4：底層 slice 完成即可寫對應 spec

---

## 16. Definition of Done（每個 task 共通）

- [ ] 程式碼通過 `pnpm lint && pnpm typecheck`
- [ ] 對應測試綠
- [ ] 若改 schema：migration + seed 同步更新
- [ ] 若加 endpoint：OpenAPI schema 註冊
- [ ] commit message 用 Conventional Commits
- [ ] 與 task 的 Acceptance criteria 一一對照打勾
