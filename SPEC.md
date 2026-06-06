# Spec: E-commerce Platform (Portfolio)

> Status: **v2 — Auth / Order / Cart 細節確認**
> Last updated: 2026-06-05

> v2 變更摘要：補完 Auth（token 儲存、rotation、family-based reuse detection）、訂單狀態機與權限、訪客購物車合併規則、Webhook 冪等性、背景排程設計。

---

## 1. Objective

打造一個 **B2C 單一賣家電商平台**，作為個人作品集展示用途。對象是未來雇主與面試官，目標是呈現 full-stack 完整度（前端、後端、資料庫設計、後台管理、工程規範、安全）。

**不是**真實要上線賣東西，因此金流、物流、發票皆 mock；但所有「會被審視的工程細節」需做到位。

### 使用者角色

- **訪客**：瀏覽商品、加入購物車（cookie）、註冊
- **會員**：登入、結帳、查訂單、收藏
- **管理員**：商品/庫存/訂單/折價券管理、銷售報表

### 成功定義（Success Criteria）

- [ ] 訪客可從首頁 → 商品列表 → 商品頁 → 加入購物車 → 註冊/登入 → 結帳 → 看到訂單成立
- [ ] 同一 SKU 並發下單不會超賣（庫存鎖正確）
- [ ] 管理員可從後台完成：上架商品（含多 SKU）、調整庫存、處理訂單、發折價券、查看日/月/商品銷量報表
- [ ] 所有 API 有 OpenAPI 文件 + 對應 Supertest 測試
- [ ] 三個關鍵 E2E 場景 Playwright 通過：訪客結帳、會員結帳含折價券、後台出貨
- [ ] CI 綠燈（lint + test + build）
- [ ] README 含截圖 / 架構圖 / 啟動步驟 / demo 帳號
- [ ] 部署到公開可訪問的 URL（本機 docker compose 與線上 demo 兩條路徑都通）

---

## 2. Tech Stack

| Layer  | Choice                                            | Reason                     |
| ------ | ------------------------------------------------- | -------------------------- |
| 前台   | **React 18 + Vite + TypeScript**                  | 快、現代、面試常見         |
| UI     | TailwindCSS + shadcn/ui                           | 一致性、組件可複用         |
| 狀態   | Zustand（client）+ TanStack Query（server state） | 輕量、現代主流             |
| Router | React Router v6                                   |                            |
| 後端   | **Node.js + Express + TypeScript**                | 經典分層、能展示 REST 設計 |
| ORM    | Prisma                                            | type-safe、migration 友善  |
| 資料庫 | **PostgreSQL 16**                                 |                            |
| 驗證   | Zod（共用前後端 schema）                          |                            |
| 認證   | JWT（access + refresh）+ httpOnly cookie          |                            |
| 測試   | Vitest + Supertest + Playwright                   |                            |
| Docs   | OpenAPI 3 (swagger-ui-express)                    |                            |
| 容器   | Docker Compose（app + db）                        | 一鍵啟動                   |

---

## 3. Commands

```bash
# 第一次啟動
docker compose up -d              # 起 Postgres
pnpm install                       # 裝相依
pnpm db:migrate                    # 跑 Prisma migration
pnpm db:seed                       # 種子資料（demo 商品 + admin 帳號）

# 日常開發
pnpm dev                           # 前後端並行（concurrently）
pnpm dev:web                       # 只跑前端
pnpm dev:api                       # 只跑後端

# 品質
pnpm lint                          # ESLint
pnpm format                        # Prettier
pnpm typecheck                     # tsc --noEmit
pnpm test                          # Vitest（前後端單元 + Supertest）
pnpm test:e2e                      # Playwright

# Build
pnpm build                         # 前後端 production build
```

---

## 4. Project Structure

Monorepo（pnpm workspaces）：

```
ecommerce platform/
├── apps/
│   ├── web/                       # React + Vite 前台
│   │   ├── src/
│   │   │   ├── pages/             # 頁面（首頁、商品、購物車、結帳、會員、後台）
│   │   │   ├── components/        # 共用元件
│   │   │   ├── features/          # 功能模組（cart, auth, admin...）
│   │   │   ├── lib/               # api client、utils
│   │   │   └── stores/            # Zustand stores
│   │   └── tests/
│   └── api/                       # Express 後端
│       ├── src/
│       │   ├── routes/            # REST endpoints
│       │   ├── services/          # 商業邏輯
│       │   ├── middleware/        # auth、error handler、rate limit
│       │   ├── lib/               # logger、db client
│       │   └── schemas/           # Zod schemas
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts
│       └── tests/
├── packages/
│   └── shared/                    # 共用型別、Zod schema
├── e2e/                           # Playwright 測試
├── docs/
│   ├── adr/                       # 架構決策記錄
│   ├── api/                       # OpenAPI yaml
│   └── screenshots/
├── .github/workflows/             # CI
├── docker-compose.yml
├── SPEC.md                        # 本檔
└── README.md
```

---

## 5. Data Model（核心實體）

```
User (id, email, password_hash, role [enum: CUSTOMER | ADMIN | SUPER_ADMIN], created_at)
RefreshToken (id, user_id, family_id, token_hash UNIQUE, parent_id NULLABLE,
              revoked_at NULLABLE, expires_at, user_agent, ip, created_at)
              -- 註：token 本身用 opaque random 32 bytes（base64url），DB 只存 SHA-256 hash
              -- 註：token_hash 必須 UNIQUE — refresh 流程用 findUnique by hash 查詢
              -- 註：family_id 串起 rotation 鏈，reuse detection 撤的是整條 family
Address (id, user_id, recipient, phone, address, is_default)

Category (id, name, slug, parent_id)
Product (id, name, slug, description, category_id, base_price, status)
ProductImage (id, product_id, url, sort)
Variant (id, product_id, name)            -- 規格定義：顏色 / 尺寸
VariantOption (id, variant_id, value)     -- 選項：紅 / 藍 / M / L
SKU (id, product_id, code, price, stock, option_combination JSON)

Cart (id, user_id NULLABLE, session_id NULLABLE, updated_at)
      -- CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
      -- 同一 user 至多一筆；同一 session 至多一筆（unique partial index）
      -- 訪客 session 由 cart_session cookie 承載：HttpOnly + Secure + SameSite=Lax
      -- TTL: 7 天，採 sliding renewal（每次 cart 寫入時延長到 now + 7d）
      -- 對齊 cronjob：每日清除 updated_at < now() - 7d 且 user_id IS NULL 的訪客 cart
CartItem (id, cart_id, sku_id, qty)

Order (id, user_id, status [OrderStatus enum], payment_intent_id UNIQUE NULLABLE,
       subtotal, discount, shipping_fee, total,
       shipping_address JSON, payment_method,
       created_at, paid_at NULLABLE, shipped_at NULLABLE)
OrderItem (id, order_id, sku_id, sku_snapshot JSON, qty, unit_price)
           -- 語意嚴格區分（避免報表靈異現象）：
           --   unit_price    → 結帳當下的計價依據（金額計算唯一來源）
           --   sku_snapshot  → 凍結商品名/規格/SKU code/圖片 URL（顯示用），不含價格
           -- 商品改價、改名、下架皆不影響歷史訂單顯示與金額
OrderStatusLog (id, order_id, from_status, to_status, note, operator_id, created_at)

Coupon (id, code, type, value, min_amount, starts_at, ends_at, usage_limit)
CouponUsage (id, coupon_id, user_id, order_id)

PaymentMock (id, order_id, provider, status, outcome_mode, mock_response JSON)
             -- outcome_mode 控制 webhook 行為，支援 E2E 失敗路徑測試：
             --   'auto_success' → 模擬延遲後觸發 webhook 回 success → 訂單 PENDING→PAID
             --   'auto_failure' → 模擬延遲後觸發 webhook 回 failure → 訂單 PENDING→CANCELLED（庫存回補）
             --   'manual'       → 等待 admin 後台手動觸發 webhook（僅 SUPER_ADMIN 可觸發）
             -- 觸發時機規定：webhook 必須在 checkout response 200 OK 送回 client 之後才觸發
             -- 實作：service 用 setTimeout(..., 200-500ms) 模擬網路延遲，避免 race 讓 FE 拿到詭異狀態
             -- 由 checkout input 或 admin 控台選擇；正式 demo 預設 auto_success
ShipmentMock (id, order_id, carrier, tracking_no, status)

AdminActionLog (id, actor_id, resource_type, resource_id, action,
                diff JSON NULLABLE, ip, user_agent, created_at)
                -- 通用稽核表：所有 admin 後台寫入操作都落一筆
                -- resource_type 例：'product' / 'sku' / 'order' / 'coupon'
                -- action 例：'create' / 'update' / 'delete' / 'transition:SHIPPED'
                -- diff 存 before/after 關鍵欄位（不存敏感欄位）
```

**重要規則**：

- 結帳走 DB transaction：扣庫存 + 建訂單 + 記折價券 + 建 PaymentMock 為單一 atomic 操作
- 庫存扣減用 conditional UPDATE：`UPDATE SKU SET stock = stock - ? WHERE id = ? AND stock >= ?`，affected rows = 0 → throw `OUT_OF_STOCK` 409
- OrderItem 的 `sku_snapshot` 凍結下單當時的商品名/價格/規格，商品改價不影響歷史單
- 凡涉及狀態轉換、庫存回補、退款，皆走「狀態機 service function」（見下），禁止 route 直接寫 `order.status = ...`

**訂單狀態機**

| From                       | To        | 觸發者                                               | 副作用（同 tx）                            |
| -------------------------- | --------- | ---------------------------------------------------- | ------------------------------------------ |
| PENDING                    | PAID      | 系統（payment webhook）                              | 寫 `paid_at`                               |
| PENDING                    | CANCELLED | 買家手動 / cronjob 逾時 / payment webhook 回 failure | **回補 SKU stock**                         |
| PAID                       | SHIPPED   | Admin                                                | 寫 `shipped_at`、產生 ShipmentMock         |
| SHIPPED                    | COMPLETED | 買家確認 / cronjob 自動（出貨 7 天後）               | —                                          |
| PAID / SHIPPED / COMPLETED | REFUNDED  | Super Admin                                          | **回補 SKU stock**、建 PaymentMock(refund) |

- 非表列轉換一律 409 `INVALID_STATUS_TRANSITION`
- 集中走 `transitionOrder(orderId, toStatus, actor, ctx)` service：驗證合法轉換 → 寫 OrderStatusLog → 觸發副作用，全部在同一 tx
- `PAID → CANCELLED` **不開放**：已付款要取消一律走 `REFUNDED`（合併「取消＋退款」語意）

**Payment Webhook 冪等性**

- Mock payment webhook 會重送，handler 必須冪等
- `PENDING → PAID` 透過 `UPDATE Order SET status='PAID', paid_at=now() WHERE id=? AND status='PENDING' AND payment_intent_id=?` 保證原子性 + 冪等
- `Order.payment_intent_id` UNIQUE，重複 webhook 進來 updated rows = 0 → no-op
- Handler 一律回 200（即使 no-op），避免上游重試風暴

**訪客購物車合併（login flow）**

- 觸發時機：login success 同一個 DB transaction 內合併，response 直接回合併後 cart
- 規則：同 SKU 數量加總；guest 有但會員沒有 → 直接接管
- 數量截斷：加總後超過 `SKU.stock` 或單筆購買上限 → 截斷至上限，前端 toast「部分商品數量已達上限」
- 失效 SKU：guest cart 內 `SKU.status != ACTIVE` 或商品已下架 → 靜默丟棄，前端 toast「N 件商品已下架」
- 收尾：合併完成後刪除原 guest cart（`session_id` 那筆），避免孤兒

**Coupon 限制語意**（明文）

- `Coupon.usage_limit`：整張券全站總用量上限
- 每人限用 1 次：透過 `CouponUsage` 表 `UNIQUE(coupon_id, user_id)` 強制

**Admin 操作稽核**

- 所有 admin 後台**寫入操作**（create / update / delete / 狀態轉換）必須落 `AdminActionLog`
- 寫入透過 **service 層 Higher-Order Function**（**非** Express middleware）統一處理：
  ```ts
  // 示意
  await withAuditLog({ actor, resourceType, action, resourceId }, async (tx) => {
    return await coreLogic(tx, args); // 業務邏輯與 audit log 寫入同一個 tx
  });
  ```
- 為何不用 middleware：Prisma `$transaction` 生命週期綁在 callback 作用域，Express middleware 無法跨 `next()` 傳遞 tx 上下文
- 不打 audit log 的 admin 寫入路徑視為違規（review 強制；可加 ESLint custom rule 兜底）
- `diff JSON` 欄位 deny-list（永不寫入）：`password_hash`、`token_hash`、`refresh_token`、客戶 `ip`、`user_agent`

---

## 6. Code Style

```typescript
// ✅ 範例：services/orderService.ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';

const CheckoutInput = z.object({
  cartId: z.string().uuid(),
  addressId: z.string().uuid(),
  couponCode: z.string().optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutInput>;

export async function checkout(userId: string, raw: unknown) {
  const input = CheckoutInput.parse(raw);

  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUniqueOrThrow({
      where: { id: input.cartId },
      include: { items: { include: { sku: true } } },
    });

    for (const item of cart.items) {
      const updated = await tx.sKU.updateMany({
        where: { id: item.skuId, stock: { gte: item.qty } },
        data: { stock: { decrement: item.qty } },
      });
      if (updated.count === 0) {
        throw new AppError('OUT_OF_STOCK', `SKU ${item.skuId} 庫存不足`, 409);
      }
    }

    // ... 建 Order / OrderItem / 套用 coupon / mock payment
  });
}
```

**Conventions**：

- 檔名：`camelCase.ts`（檔案）、`PascalCase.tsx`（React 元件）
- Function/var：camelCase；Type/Interface/Component：PascalCase；常數：UPPER_SNAKE
- 錯誤統一走 `AppError(code, message, httpStatus)`，由 middleware 轉成 JSON response
- Route 只負責 parse + call service；商業邏輯都在 service 層
- 前端 API 呼叫一律走 `lib/apiClient.ts`，不在 component 內 fetch
- Zod schema 放 `packages/shared`，前後端共用

---

## 7. Testing Strategy

| 層級 | 工具       | 覆蓋對象                  | 目標                                   |
| ---- | ---------- | ------------------------- | -------------------------------------- |
| 單元 | Vitest     | service 層商業邏輯、utils | 商業邏輯 80%+                          |
| API  | Supertest  | 所有 REST endpoint        | 100% endpoint hit                      |
| E2E  | Playwright | 三大關鍵流程              | 訪客結帳 / 會員結帳含折價券 / 後台出貨 |

**測試規則**：

- 整合測試用真實 Postgres（透過 docker-compose），不 mock DB
- 每個 test file 開始前 reset DB（`prisma migrate reset --force`）或用 transaction rollback
- E2E 用 seed 出的固定資料，測試前不重 seed（速度）

---

## 8. Engineering Standards

**已選**：

- ✅ **TypeScript 全專案** + ESLint（airbnb-typescript or @typescript-eslint/recommended）+ Prettier + Husky pre-commit（lint-staged 跑 lint + typecheck）
- ✅ **Conventional Commits**：`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
- ✅ **Branch 策略（Trunk-based）**：`main`（受保護、唯一 deploy 來源）+ `feature/*` / `fix/*` 短命分支；PR merge 直回 main 觸發 CI/CD。**不採用 git-flow**（單人專案沒必要 develop 分支增加合併摩擦）
- ✅ **GitHub Actions CI**：每個 PR 跑 `lint + typecheck + test + build`，全綠才可 merge
- ✅ **OpenAPI 3** 文件：用 **`zod-to-openapi`** 從現有 Zod schema 自動產出 yaml，build 時輸出到 `docs/api/openapi.yaml`，swagger-ui-express 掛在 `/api/docs`（與實作同步、無漂移）
- ✅ **部署**：兩條路徑並存
  - **本機**：`docker compose up -d`（含 Postgres）+ `pnpm dev` 起應用
  - **線上 demo**：
    - API + DB → Fly.io 或 Render（單 region、免費 tier）
    - Web → Vercel
    - **同源策略：用 `vercel.json` rewrites 反向代理 `/api/*` 到真實 API origin**（Vercel Edge 層轉發），對瀏覽器看起來 FE 與 API 同源 → refresh cookie `SameSite=Lax` 正常運作、CORS 不用設、CSRF 表面積最小
    - 環境變數區分 `production` / `local`
    - prod 不暴露 `/api/docs` 給匿名（加 basic auth 或環境變數 disable）
  - `vercel.json` 範例：
    ```json
    {
      "rewrites": [
        { "source": "/api/:path*", "destination": "https://api.example.fly.dev/api/:path*" }
      ]
    }
    ```
- ✅ **ADR**：每個重大決策寫一份 ADR 放 `docs/adr/NNNN-title.md`。候選清單：
  - 為何選 Express not Nest / Fastify
  - 為何 monorepo（pnpm workspaces）
  - 為何 conditional UPDATE 而非 row-level lock / SELECT FOR UPDATE 防超賣
  - **Auth 設計**：access in-memory + refresh httpOnly cookie + family-based rotation + grace window
  - **Order 狀態機**：為何集中走 `transitionOrder` service（而非散落 route）
  - **Background jobs**：為何同 process node-cron + advisory lock（而非獨立 worker）
  - **OpenAPI**：為何 `zod-to-openapi` 自動產生（而非手寫 yaml）
  - **SKU `option_combination JSON`**：為何反正規化保留（查詢效能 vs 與 VariantOption 一致性的取捨）
  - **Admin 稽核**：為何用通用 `AdminActionLog` 表 + middleware（而非每張表自寫 audit）

---

## 9. Non-Functional Requirements

### Security（電商必備）

- 密碼：**bcrypt** cost ≥ 12
- **Rate limiting**：登入 / 註冊 / 結帳 endpoint 用 `express-rate-limit`（登入 5/min/IP）
- **輸入驗證**：所有 request body / query / param 走 Zod schema，不通過直接 400
- **SQL Injection**：一律走 Prisma，禁止 raw SQL；必要時用 `$queryRaw` 加 parameterized
- **XSS**：React 預設 escape，但 admin 編輯器若用 rich text 要 sanitize（DOMPurify）
- **Helmet** middleware 設 security headers
- **OWASP Top 10** 自查清單放 `docs/security-checklist.md`

### Authentication & Session

**Token 配置**

- **Access token**：JWT、15 min TTL、**只存前端記憶體（Zustand store）**，禁止落地（不放 localStorage / sessionStorage / cookie）
- **Refresh token**：opaque random 32 bytes（`crypto.randomBytes(32).toString('base64url')`），DB 只存 SHA-256 hash；**不用 JWT**（反正要查 DB 才能撤銷，JWT 沒好處）
- **Refresh cookie 屬性**：`HttpOnly` + `Secure` + `SameSite=Lax` + `Path=/api/auth`
  - 為何 Lax 不用 Strict：Strict 會擋掉「外部連結點進站」的 top-level navigation，使用者第一次載入會被誤判未登入
  - Path 限定 + refresh endpoint 只接受 POST → Lax 已足夠擋 CSRF，**不採用 double-submit cookie pattern**（避免過度設計）

**Silent Refresh**

- App 啟動先打 `POST /api/auth/refresh` 嘗試還原 session（access 在記憶體，硬重新整理就沒了）
- API 回 401 由 Axios interceptor 觸發 refresh → 換到新 access → 重試原 request
- **Single-flight**：interceptor 內部用 promise queue，平行 401 共用同一個 refresh promise，避免併發競態

**Refresh Token Rotation**

- **Rotate on use**：每次 refresh 換發新 access + 新 refresh，舊 refresh 立即 `revoked_at = now()`
- **Family-based reuse detection**：rotation 鏈共用同一 `family_id`；偵測到已 revoked 的 token 再次使用 → **撤銷整條 family**（非整個 user，其他裝置不受影響）
- **Grace window**：舊 token 在 rotate 後 10 秒內、且請求帶的是同 family 最新一個的「上一代」，視為網路毛刺重試，回傳 family 內最新有效 token，**不觸發 reuse detection**
- **Logout**：將當前 refresh token DB 標 revoked，並清除 cookie
- **過期清理**：cronjob 每日刪除 `expires_at < now()` 或 `revoked_at < now() - 30d` 的 refresh tokens

### Performance

- 前端：**首頁 LCP < 2.5s**（4G 模擬，Lighthouse）；圖片 lazy load + responsive `srcset`
- API：**p95 < 300ms**（不含 mock payment 模擬延遲）
- 商品列表：分頁（cursor-based）+ DB index on `category_id`, `status`, `created_at`
- N+1 防禦：Prisma `include` 明確指定，不在 loop 內查

### Reliability

- 結帳全程 **DB transaction**（Prisma `$transaction`）
- 庫存扣減用 **conditional UPDATE**（`updateMany` + `where stock >= qty`），affected = 0 回 409 `OUT_OF_STOCK`
- 任何狀態轉換、退款 → **庫存回補必須與狀態轉換在同一個 tx 內**，禁止分開兩步
- 統一錯誤格式：`{ error: { code, message, details? } }`
- 全域 error middleware 接住未捕捉錯誤，5xx 不洩漏 stack 給 client（dev 模式才回 stack）
- DB connection pool：Prisma 預設 10，docker-compose 內視 PG `max_connections` 調整；query timeout 5s

### Background Jobs

- 跑在 API 同 process，用 `node-cron`（單機 demo 不需獨立 worker）
- 並行安全：每個 job 進入點先 `pg_try_advisory_lock(<jobKey>)`，拿不到 lock 直接 skip（防多 instance 重複跑、防上次未跑完又啟動）
- 已定義 jobs：
  - **逾時未付款訂單取消**：每 5 min 掃 `status='PENDING' AND created_at < now() - 30min` → `transitionOrder(_, 'CANCELLED', system)`，含庫存回補
  - **SHIPPED 自動完成**：每日掃 `status='SHIPPED' AND shipped_at < now() - 7d` → `transitionOrder(_, 'COMPLETED', system)`
  - **Refresh token 清理**：每日刪除過期或 revoked 超過 30 天的 token

### 不在 NFR scope 內（明文排除以控 scope）

- ❌ 可觀測性（logging 只用 pino 預設 console，不接 APM）
- ❌ WCAG / a11y 規範
- ❌ SEO / SSR（前台是 Vite CSR，作品集 demo 用不上）

---

## 10. Boundaries

**Always do**

- 動 schema 必跑 migration + 寫 seed 更新
- 新增 endpoint 必寫 OpenAPI + Supertest
- 商業邏輯改動必有對應 Vitest
- commit 前跑 `pnpm lint && pnpm typecheck && pnpm test`

**Ask first**

- 改 data model
- 引入新依賴（評估必要性 + bundle size）
- 改 CI / docker-compose / 環境變數結構
- 改認證邏輯
- 引入第三方服務（即使是 free tier）

**Never do**

- commit `.env` 或任何 secrets
- skip pre-commit hook（`--no-verify`）
- 在 route handler 內直接寫 DB query（一定要透過 service）
- 用 `any`（必要時用 `unknown` + 縮窄）
- raw SQL 字串拼接

---

## 11. 範圍外（明文不做，避免 scope creep）

- 多賣家 / 多店鋪
- 真實金流 / 物流 API 串接（皆 mock）
- 電子發票 / 載具
- 商品評價 / 留言
- 客服訊息系統
- Email / SMS 通知（後台只顯示「應發通知」log）
- 紅利點數 / 會員等級
- 多語系（繁中 only）
- App / PWA

---

## 11.5 線上 Demo 限制（公開可訪問版本）

由於 §11 排除 email 驗證 / 密碼重設等流程，線上版本必須做以下防禦，避免被惡意腳本塞爆：

- 預設 demo 帳號 `demo@example.com` / `admin@example.com` 標記為 **DEMO_READONLY**，後端攔截寫入操作（下單、改密碼、admin CRUD）一律回 403 `DEMO_ACCOUNT_READONLY`
- 一般註冊開放，但每 IP 限制 3 帳號/天
- 每 6 小時 cronjob 重置 DB 為初始 seed（保留 demo 帳號 + 商品 + 範例訂單）
- README 顯著位置標註上述限制

---

## 12. Open Questions

1. Seed 資料規模？建議 5 分類 / 30 商品 / 平均 3 SKU，夠 demo 不過量。
2. 並發超賣是否做壓測（k6/autocannon）驗證？目前 NFR 沒列。建議做一支簡單壓測腳本放 `scripts/`，作為 portfolio 加分點。
3. ADR 寫到哪個粒度？建議只記「會被質疑的決策」（5-8 篇），不寫每個小選擇。

**v2 已決議（從原 Open Questions 收斂）**

- ✅ #3 Admin 操作稽核：**加入** `AdminActionLog` 表 + middleware 強制（見 §5）
- ✅ #5 OpenAPI 來源：採用 **`zod-to-openapi`** 自動產生（見 §8）
- ✅ #6 SKU `option_combination JSON`：**保留**為反正規化欄位，理由與權衡寫 ADR（見 §8 ADR 候選清單）

---

## 13. Design System (VELLA)

> 視覺與互動規範。設計稿來源：Claude Design 匯出的 React 原型 `_design/untitled/project/`（不入 git，僅作參考）。設計稿用 CDN React + Babel standalone 在瀏覽器跑，**不是**實作目標 — 實作走 §2 的 Vite + React + Tailwind + shadcn/ui，token 從本章節抽出對應到 `tailwind.config.ts`。

### 13.1 品牌定位

- **品牌**：VELLA — 時尚精品選物（女性服飾 / 配件）
- **個性**：現代活潑、精緻、圓角、暖色系紙感底
- **Wordmark**：純文字 logo，使用 Bricolage Grotesque

### 13.2 Color Tokens

所有色票走 CSS Custom Properties，Tailwind 從這些 var 讀取（避免雙重維護）。

```css
/* Surfaces — 紙感底 + 卡片白 */
--paper: #f4f1ea; /* app 背景（暖奶油） */
--paper-2: #efeae1; /* 深一階奶油（hover / 次要區塊）*/
--surface: #ffffff;
--surface-2: #fbf9f5;
--ink: #17151a; /* 主文字（暖近黑）*/
--ink-2: #423e48;
--ink-soft: #726c78; /* 次要文字 */
--ink-faint: #a39da9; /* 三級文字 / placeholder */
--line: #e6e0d6; /* 奶油底上的分隔線 */
--line-2: #ede9e2; /* 白底上的分隔線 */

/* Brand */
--primary: #5b30e6; /* 電光紫 — CTA / 主要動作 */
--primary-press: #4a23c9;
--primary-tint: #ece7ff;
--primary-tint-2: #dcd3ff;
--on-primary: #ffffff;
--accent: #ff5c8a; /* 桃粉 — 特賣 / 高亮 */
--accent-tint: #ffe3ec;

/* Semantic — 與紫/粉明確區隔，避免儀表板讀不清 */
--success: #15924e; /* 成長、完成 */
--success-tint: #dcf3e6;
--warning: #e0820b; /* 行動所需（橘色，待出貨）*/
--warning-tint: #fbeacf;
--danger: #e0344b; /* 失敗、低庫存 */
--danger-tint: #fbe0e4;
--info: #2f6fe0; /* 已出貨、資訊 */
--info-tint: #dee9fc;

/* Order status — 訂單狀態專用色（對應 OrderStatus enum） */
--st-pending: #8a7cf0; /* PENDING */
--st-paid: #e0820b; /* PAID（待出貨，警示橘）*/
--st-shipped: #2f6fe0; /* SHIPPED */
--st-done: #15924e; /* COMPLETED */
--st-failed: #e0344b; /* CANCELLED / FAILED */
--st-refunded: #726c78; /* REFUNDED（中性灰）*/
```

**用色規則**：

- CTA 一律 `--primary`，不混用 `--accent`（accent 只給 sale badge / 特殊強調）
- 待處理訂單卡片用 `--warning`（橘）非紅，紅留給「異常 / 失敗 / 低庫存」
- 後台側欄底色 `#1d1a24`（near-black violet），與 storefront 紙感底形成對比
- ::selection 用 `--primary-tint-2`

### 13.3 Typography

```css
--display: 'Bricolage Grotesque', 'Noto Sans TC', system-ui, sans-serif;
--body: 'Noto Sans TC', 'Bricolage Grotesque', system-ui, sans-serif;
--num: 'Bricolage Grotesque', 'Noto Sans TC', system-ui, sans-serif;
```

- **載入**：Google Fonts `Bricolage+Grotesque:opsz,wght@12..96,400..800` + `Noto+Sans+TC:wght@400;500;600;700;800`
- **Body 預設**：15px / line-height 1.5 / antialiased
- **Headings**：font-weight 700、letter-spacing -.01em、line-height 1.12
- **數字**：所有金額 / 庫存 / 統計用 `.num` class 套 Bricolage Grotesque + `font-variant-numeric: tabular-nums lining-nums`（對齊用）
- **Wordmark**：用 `.display` class

### 13.4 Radius & Shadow

```css
--r-xs: 8px;
--r-sm: 12px;
--r-md: 16px;
--r-lg: 22px;
--r-xl: 30px;
--r-pill: 999px;

--sh-1: 0 1px 2px rgba(23, 21, 26, 0.06), 0 1px 3px rgba(23, 21, 26, 0.05);
--sh-2: 0 4px 14px rgba(23, 21, 26, 0.07), 0 2px 4px rgba(23, 21, 26, 0.05);
--sh-3: 0 14px 40px rgba(23, 21, 26, 0.12), 0 6px 14px rgba(23, 21, 26, 0.07);
--sh-pop: 0 24px 60px rgba(31, 18, 80, 0.22); /* drawer / modal */
--ring: 0 0 0 4px var(--primary-tint-2); /* input focus / focus visible */
```

**Header 高度**：`--header-h: 68px`（storefront sticky header）；後台 top bar 64px。

### 13.5 Component Primitives

以下為 shadcn/ui 之外、必須自製或客製的元件規範。建構時 base 用 shadcn/ui，再以 token override 對齊 VELLA 視覺。

**Button** — 變體：`primary` / `ink` / `ghost` / `soft` / `danger` / `quiet`；尺寸：`sm` (h36) / default (h44) / `lg` (h52) / `icon` (44×44, sm 為 36×36)。所有 button **圓角為 pill（999px）**，font-weight 600，hover 上抬 1px + shadow-2。
**Input / Select / Textarea** — h46、`--r-sm` 圓角、1.5px border (`--line`)；focus 切到 `--primary` 邊框 + `--ring` 光暈。`Field` wrapper 含 label（12.5px、weight 600、ink-2）+ error 訊息（12px、danger、weight 600）。
**Card** — surface 白底、1px `--line-2` 邊框、`--r-md` 圓角；`card-pad` 預設 18px padding。
**Status Pill** — 26px 高、pill 圓角、左側 7px 圓點（`currentColor`）、字 12px weight 700 letter-spacing .02em。訂單狀態色取自 13.2 status palette。
**IconButton (`.iconbtn`)** — 34×34、9px 圓角、`--line` border、`--ink-soft` 預設色、hover 深一階。
**Skeleton (`.skel`)** — shimmer 動畫（cream gradient，1.4s linear infinite），用於商品圖 / 列表 loading。

### 13.6 Layout & Breakpoints

| Breakpoint | 影響                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| `≤ 980px`  | 商品 grid 4→3 欄；後台 dashboard 雙表並排→單欄                                |
| `≤ 900px`  | PDP 雙欄→單欄；sticky 解除                                                    |
| `≤ 860px`  | Auth 雙欄→單欄；checkout 雙欄→單欄（aside 移上）；admin 側欄收起、burger 顯示 |
| `≤ 720px`  | 訂單確認 timeline cols 雙欄→單欄；`.hide-sm` 隱藏                             |
| `≤ 680px`  | 商品 grid 3→2 欄                                                              |

**關鍵 grid**：

- `.prod-grid`：4 / 3 / 2 欄 RWD、gap 22px 18px → 18px 12px
- `.pdp-grid`：`1.05fr 1fr`，gap 44px（手機 26px）
- `.checkout-wrap`：`1fr 400px`，max-width 1180、aside 用 `--surface-2` + 左邊 border-line
- `.admin-shell`：`232px 1fr`，側欄 sticky h-100vh
- `.kpi-grid`：3 欄 → 1 欄
- `.dash-tables`：2 欄 → 1 欄

### 13.7 Motion

```css
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes popIn {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes shimmer {
  100% {
    background-position: -200% 0;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
```

- 預設 transition：button transform .12s、shadow .18s、background .18s
- 入場動畫 `.fade-up` / `.fade-in` 適用於主視覺、訂單確認 hero；**不要**用於商品列表多卡片 stagger（原型已驗證會在背景 iframe 卡住）
- **必須**支援 `prefers-reduced-motion: reduce`，所有 animation/transition 縮為 .001ms

### 13.8 Accessibility

- `:focus-visible` 顯示 2px primary outline + 2px offset；button / input 自帶 focus state（不重複 outline）
- 所有顏色配對符合 WCAG AA：ink-on-paper、on-primary-on-primary 已驗證；ink-soft 不可用於小字主要資訊
- ⚠️ 對齊 §9 NFR 排除清單：**完整 a11y 不在 scope**，但本章節列的最小焦點 / 對比要求必須做到

### 13.9 Implementation Strategy（Tailwind + shadcn/ui 對接）

**做法**：

1. 將 13.2 所有 color tokens 寫進 `apps/web/src/styles/tokens.css`（CSS custom properties，掛在 `:root`）
2. `tailwind.config.ts` 用 `theme.extend.colors` 對應 token（例如 `primary: 'rgb(from var(--primary) r g b / <alpha-value>)'`）
3. shadcn/ui 元件複製進來後，把預設的 `bg-primary` / `text-foreground` 等對應到 VELLA tokens，**不改 component API**
4. 字體在 `apps/web/index.html` 的 `<head>` 載入 Google Fonts；`font-family` 透過 Tailwind `theme.extend.fontFamily.display / body / num`
5. 13.5 的 primitive 變體（btn--soft、btn--ghost 等）寫成 shadcn `Button` 的額外 `variant`，不另開新元件
6. 設計稿原始 CSS（`_design/untitled/project/styles.css` + `layout.css`）作為對照表，**不直接複製**進專案

**不做**：

- ❌ 直接複製設計稿的 JSX 進專案（原型用 window 全域 + Babel standalone，不適合）
- ❌ 把 `.btn` `.input` `.card` 等原型 class 名搬進專案（用 shadcn 的 component API + Tailwind class）
- ❌ 引入除 shadcn 預設外的 UI library（Mantine / Antd / Chakra 等）

### 13.10 Asset References

| 設計稿檔案                  | 對應實作 task                         | 用途                                                               |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| `styles.css` + `layout.css` | T0.5 web skeleton、本章節 §13.2~§13.7 | Design tokens / 元件 / 版面參考                                    |
| `data.jsx`                  | T2.2 seed                             | 假資料樣態（30 商品結構、近 7 天訂單分布）                         |
| `store.jsx`                 | T3.x / T4.x                           | 跨頁 cart、訪客→會員綁定、狀態機（原型版，正式版走 Zustand + API） |
| `router.jsx`                | T0.5                                  | Router 結構參考（正式版用 React Router v6）                        |
| `ui.jsx`                    | T0.5 / 13.5                           | UI primitive + icon set 參考                                       |
| `shell.jsx`                 | T0.5 / T2.5                           | Storefront header / footer / cart drawer 版面                      |
| `store-home.jsx`            | T2.5                                  | 首頁 + 商品列表 + PDP 版面                                         |
| `store-account.jsx`         | T1.7 / T4.6                           | Login / Register / Checkout（Shopify 雙欄）/ OrderConfirm 版面     |
| `store-orders.jsx`          | T4.6                                  | 會員中心訂單列表                                                   |
| `admin-shell.jsx`           | T6.7                                  | 後台 shell + RBAC guard 版面（正式版 guard 走 React Router）       |
| `admin-dashboard.jsx`       | T6.6 / T6.7                           | KPI 卡 + 7 日營收長條圖（手刻 SVG）+ 雙表並排                      |
| `admin-products.jsx`        | T6.3 / T6.7                           | 商品 CRUD + SKU 編輯版面                                           |
| `admin-orders.jsx`          | T6.4 / T6.7                           | 訂單列表 + 狀態轉換 UI                                             |
| `admin-logs.jsx`            | T6.7                                  | AdminActionLog 列表                                                |

---

## Next Phase

驗收這份 SPEC 後 → **Phase 2: Plan**（產出技術實作計畫，包含模組相依、實作順序、風險、可平行 vs 必序列）→ **Phase 3: Tasks**（拆成可驗收的小任務）→ **Phase 4: Implement**。
