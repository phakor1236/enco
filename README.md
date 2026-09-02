# Vella — B2C 電商平台

單一賣家的 B2C 電商平台，前台、結帳、後台管理、排程任務、API 文件都做完整。
金流／物流／發票是刻意 mock 的，但金流**周圍**的東西——並發控制、狀態機、
認證、冪等性、稽核紀錄——都照生產標準實作。

**技術棧：** Node.js 22 · Express 5 · TypeScript · Prisma 6 · PostgreSQL 16 ·
React 18 + Vite · Zod · Docker Compose · GitHub Actions · Vitest / Supertest / Playwright

**298 個測試**（API 237 · 前端 39 · shared 17 · E2E 5）· **8 篇 ADR** ·
**OpenAPI 3 文件從 Zod schema 自動生成**

---

## 快速開始（資料庫一行指令）

環境需求：Node ≥ 22.13、pnpm ≥ 11、Docker。

```bash
docker compose up -d               # Postgres 16 + 獨立測試資料庫，附 healthcheck
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:migrate                    # 9 次 Prisma migration
pnpm db:seed                       # 種子商品與 demo 帳號
pnpm dev                           # API :4000 · 前端 :5173
```

| Demo 帳號           | 密碼        | 角色     |
| ------------------- | ----------- | -------- |
| `demo@example.com`  | `demo1234`  | 一般會員 |
| `admin@example.com` | `admin1234` | 管理員   |

API 文件（Swagger UI）：<http://localhost:4000/api/docs> · 原始 spec：`/api/docs.json`

```bash
pnpm test         # Vitest + Supertest（整合測試打真的 Postgres）
pnpm test:e2e     # Playwright — 5 條瀏覽器流程
pnpm lint && pnpm typecheck
```

---

## 架構

```
                 ┌──────────────────────────────────────┐
  瀏覽器 ───────▶ │ apps/web — React 18 + Vite           │
                 │ Zustand（前端狀態）· TanStack Query   │
                 │ Axios + single-flight 靜默續期        │
                 └───────────────┬──────────────────────┘
                                 │  /api/*（開發時走 Vite proxy）
                 ┌───────────────▼──────────────────────┐
                 │ apps/api — Express 5                 │
                 │  routes/    很薄，只做 Zod 驗證        │
                 │  services/  所有商業邏輯              │
                 │  middleware auth · error · validate  │
                 │  jobs/      node-cron + advisory lock│
                 └───────────────┬──────────────────────┘
                                 │  Prisma 6
                 ┌───────────────▼──────────────────────┐
                 │ PostgreSQL 16（Docker）              │
                 │ 應用資料庫 + 獨立測試資料庫            │
                 └──────────────────────────────────────┘

  packages/shared — Zod schema、錯誤碼、型別，前後端共用同一份
```

route 層刻意寫得很薄：驗證 → 呼叫一個 service → 回傳並映射錯誤。所有**真正的規則
都住在 `apps/api/src/services/`**，因此測試不必經過 HTTP 就能驗證商業邏輯。

### REST API

| 範圍    | Endpoints                                                                  |
| ------- | -------------------------------------------------------------------------- |
| 認證    | `POST /api/auth/{register,login,refresh,logout}`                           |
| 商品    | `GET /api/categories`、`GET /api/products`、`GET /api/products/:slug`      |
| 購物車  | `GET/POST/PATCH/DELETE /api/cart`（訪客購物車走 cookie，登入時合併）       |
| 結帳    | `POST /api/checkout`、`POST /api/coupons/validate`                         |
| 訂單    | `GET /api/orders`、`GET /api/orders/:id`                                   |
| Webhook | `POST /api/webhooks/payment/mock`（冪等）                                  |
| 後台    | `/api/admin/{products,skus,orders,coupons,reports}` — 需通過 `requireRole` |

---

## 值得一讀的部分

### 1. 防超賣 — 用 conditional UPDATE，不用 `SELECT FOR UPDATE`

兩個人同時買最後一件。天真的「先讀再檢查再寫」會讓兩單都通過。
結帳這裡**根本不先讀**：

```ts
const updated = await tx.sku.updateMany({
  where: { id: item.skuId, stock: { gte: item.qty } },   // 條件寫進 UPDATE 裡
  data:  { stock: { decrement: item.qty } },
});
if (updated.count === 0) throw new AppError(ErrorCodes.OUT_OF_STOCK, ...);
```

`WHERE` 條件與扣減是同一個原子語句，**由資料庫本身仲裁**——不需要顯式加鎖，
就沒有鎖順序造成的 deadlock，而 `count === 0` 本身就是庫存不足的訊號。

整個結帳包在單一 transaction 裡，所以第 3 個品項扣失敗時，前 2 個會一起 rollback，
不會留下扣一半的庫存。扣減採**循序執行**而非 `Promise.all`——共用同一條交易連線的
平行寫入在重疊資料列上可能 deadlock，而購物車的品項數量小到讓循序成本可忽略。
→ [ADR 0003](docs/adr/0003-conditional-update-over-select-for-update.md)

### 2. 訂單狀態機 — 單一入口，side effect 一起進交易

訂單狀態轉換全部走同一個 `transitionOrder()`，背後是一張明確的允許表：

```
PENDING ──▶ PAID ──▶ SHIPPED ──▶ COMPLETED
   │          │         │
   │          └──▶ REFUNDED（回補庫存）
   └──▶ CANCELLED（回補庫存）
```

不在表上的轉換一律丟 `409 INVALID_STATUS_TRANSITION`。關鍵在於：狀態變更、
`OrderStatusLog` 歷史紀錄、以及 side effect（回補庫存、建立出貨 mock、寫稽核 log）
**全部在同一個 transaction 內**——不可能出現「訂單標成已取消、庫存卻沒還回去」。
→ [ADR 0005](docs/adr/0005-centralized-transition-order-state-machine.md)

### 3. 認證 — 記憶體 access token + 會輪替的 refresh token family

- **Access token：** JWT，15 分鐘，HS256 且在驗證時**明確白名單演算法**
  （擋 alg-confusion 攻擊）；只放記憶體，**不放 `localStorage`**。
- **Refresh token：** 256 bit 不透明隨機字串，以 `httpOnly` cookie 傳遞、
  scope 限定 `/api/auth`。資料庫**只存 SHA-256 hash**——資料庫被 dump 也拿不到
  可用的 session。
- **輪替與重放偵測：** 每次續期都作廢舊 token、發新的，並以 `parentId` 串成鏈。
  若有人拿已作廢的 token 來換：可能是被竊 token 的重放 → **整條 token family
  全部撤銷**；也可能是使用者網路重試 → 10 秒 grace window 內照常發放，
  避免網路一抖就把人登出。family 以裝置為單位，單一裝置被攻陷不會把所有裝置踢出。
- **競態處理：** 輪替用條件式 `updateMany(where revokedAt: null)` 當樂觀鎖；
  並發續期會拿到 `409 TOKEN_RACED`，而不是產生兩組都有效的 token。
  前端則以 single-flight 佇列對應。
- 登入時若 email 不存在，仍然對一組 dummy hash 跑一次 bcrypt，
  **讓回應時間無法用來列舉已註冊帳號**。
  → [ADR 0004](docs/adr/0004-auth-access-token-refresh-cookie.md)

### 4. 測試隔離 — 每個整合測試都會 rollback

整合測試打**真的 PostgreSQL**（不是 mock），並包在一個保證回滾的 transaction 裡：

```ts
await withTestTx(async (tx) => {
  /* 寫入資料、呼叫 service、斷言 */
}); // ← 上面寫的東西，出了這行全部消失
```

測試之間不可能互相污染、執行順序無關，也不需要每次 truncate 整個資料庫。
測試資料庫與開發資料庫是分開的，所以 `pnpm dev` 和 `pnpm test` 可以同時跑。

### 5. 排程任務 — 同進程執行，用 advisory lock 保護

五個 `node-cron` 任務（取消逾時未付款訂單、自動完成已出貨訂單、清理過期 refresh
token 與殭屍訪客購物車、重置 demo 資料庫）。以這個規模，跑在 API 同一個進程裡是
合理的選擇，但**只要開到兩個 instance 就會重複觸發**——所以每個任務都包在
PostgreSQL **advisory lock** 裡，不必引入 Redis 或獨立 worker 服務就能杜絕重複執行。
→ [ADR 0006](docs/adr/0006-node-cron-same-process-with-advisory-lock.md)

### 6. 不會 drift 的 API 文件

OpenAPI 3 文件由「執行期實際用來驗證請求的那份 Zod schema」生成，而且有一個測試會
在 commit 進版控的 `docs/api/openapi.yaml` 與程式碼產出不一致時直接讓 build 失敗。
→ [ADR 0007](docs/adr/0007-zod-to-openapi-auto-generated-docs.md)

---

## 安全檢核

| 風險               | 處理方式                                                         |
| ------------------ | ---------------------------------------------------------------- |
| 密碼儲存           | bcrypt，cost 12                                                  |
| Refresh token 儲存 | 僅存 SHA-256 hash；明文只回傳一次                                |
| XSS 竊取 token     | access token 只在記憶體；refresh 走 `httpOnly` cookie            |
| 暴力破解           | rate limit：登入 5 次/分鐘/IP、註冊 3 次/天/IP                   |
| 帳號列舉           | 對不存在的 email 仍執行 dummy hash 比對                          |
| HTTP header 強化   | `helmet`、關閉 `x-powered-by`                                    |
| Log 外洩           | pino 遮蔽 `cookie` / `authorization` / `set-cookie`              |
| 權限提升           | `requireAuth` + `requireRole`；後台寫入一律寫進 `AdminActionLog` |
| 請求體積           | `express.json({ limit: '1mb' })`                                 |
| 生產環境文件外露   | 生產環境預設關閉 Swagger UI，除非 `EXPOSE_API_DOCS=true`         |

---

## 架構決策記錄（ADR）

每個非顯而易見的選擇都寫下來，包含**被否決的選項與理由**：

| ADR                                                                 | 決策                                        |
| ------------------------------------------------------------------- | ------------------------------------------- |
| [0001](docs/adr/0001-express-over-nest-fastify.md)                  | 選 Express 5，不選 NestJS / Fastify         |
| [0002](docs/adr/0002-pnpm-workspaces-monorepo.md)                   | pnpm workspaces，不引入 build orchestrator  |
| [0003](docs/adr/0003-conditional-update-over-select-for-update.md)  | 用 conditional UPDATE 防超賣                |
| [0004](docs/adr/0004-auth-access-token-refresh-cookie.md)           | access token + refresh cookie + family 輪替 |
| [0005](docs/adr/0005-centralized-transition-order-state-machine.md) | 集中式訂單狀態機                            |
| [0006](docs/adr/0006-node-cron-same-process-with-advisory-lock.md)  | node-cron 同進程 + advisory lock            |
| [0007](docs/adr/0007-zod-to-openapi-auto-generated-docs.md)         | OpenAPI 由 Zod 生成                         |
| [0008](docs/adr/0008-sku-option-combination-denormalized-json.md)   | SKU 選項組合以 JSONB 反正規化               |

完整需求規格：[`SPEC.md`](SPEC.md)。

---

## CI

GitHub Actions 在每次 push 與 PR 跑四個平行 job — **lint**、**typecheck**、
**test**（掛真的 Postgres 16 service container，先跑 migration）、**build**。
另有 husky `pre-commit` hook 跑 lint-staged，格式問題不會流到 CI。

Playwright 測試**刻意不放進 `test` job**：它需要前後端都跑起來、還要下載瀏覽器，
所以改為本機執行 `pnpm test:e2e`（先跑 `pnpm exec playwright install`），
不拖慢每一次 push。

---

## 資料模型

9 次 migration、26 個 Prisma model／enum，一次 migration 只處理一個主題：

```
User · RefreshToken                        認證
Category · Product · ProductImage
  · Variant · VariantOption · Sku          商品（多 SKU）
Cart · CartItem                            訪客與會員購物車
Order · OrderItem · OrderStatusLog         訂單（狀態歷史為 append-only）
PaymentMock · ShipmentMock                 模擬的外部服務
Coupon · CouponUsage                       折價券（含每人使用上限）
AdminActionLog                             後台寫入的稽核軌跡
```

`OrderItem` 會**快照購買當下的商品名稱與價格**——之後改價改名，
絕不能回頭改寫歷史訂單。

---

## 專案結構

```
apps/api/         Express 5 API
  src/routes/     12 個 route 模組（很薄：驗證 → service → 回傳）
  src/services/   9 個 service — auth, cart, checkout, order, coupon,
                  payment, product, report, auditLog
  src/jobs/       5 個 cron 任務 + advisory lock helper
  src/middleware/ auth（requireAuth / requireRole）· validate · error
  prisma/         schema + 9 次 migration + seed
  tests/          237 個測試，整合測試打真的 Postgres
apps/web/         React 18 + Vite 前台與後台
packages/shared/  Zod schema、錯誤碼、型別 — 前後端共用
e2e/              Playwright：訪客結帳、會員含折價券結帳、
                  後台出貨、付款失敗與庫存回補、smoke
docs/adr/         8 篇架構決策記錄
docs/api/         生成的 openapi.yaml（有 drift 測試把關）
```

---

## 進度

核心購物流程、後台管理、排程任務、E2E 測試套件與 CI 都已完成。
**公開部署（Vercel + Fly.io）是最後一步**——目前上面的 `docker compose` 路徑
已可在本機完整跑起整套系統。
