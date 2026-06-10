# ADR 0001 — Express 5 over NestJS / Fastify

## Context

需要一個 Node.js HTTP framework 作為 API 層。主要候選：

- **NestJS** — opinionated, 大量 decorator/DI，學習曲線陡；適合大型團隊統一規範
- **Fastify** — 高效能、typed plugin ecosystem；但 ecosystem 相對 Express 小
- **Express 5** — 成熟、生態最大、middleware 幾乎都有現成套件

專案目標是 portfolio demo：展示架構決策能力，而非追求極限 QPS。API 層薄（Zod validation → service → Prisma），不需 DI container。

## Decision

選用 **Express 5（RC）**。

理由：

1. **middleware 生態** — helmet、cookie-parser、express-rate-limit 均有原生 Express 支援，不需 wrapper
2. **可讀性** — 路由定義直觀，不依賴 decorator meta-magic，方便 reviewer 一眼看懂請求流
3. **Express 5 async 錯誤自動 catch** — `router.get('/', async handler)` 拋出的 error 直接到 errorMiddleware，不再需要手動 `next(err)`
4. **monorepo 輕量** — 不需引入 NestJS 的大型 peer-dependency 樹

## Consequences

- **正面**：啟動快、cold start < 500ms、middleware 組合靈活
- **負面**：沒有 NestJS 的 module 邊界強制，需要靠 code review 維持 service/route 職責分離
- **中性**：Express 5 在專案開始時仍是 RC；API 穩定，風險低
