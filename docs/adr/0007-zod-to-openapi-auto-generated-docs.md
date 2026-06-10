# ADR 0007 — OpenAPI: zod-to-openapi Auto-Generation (not Hand-Written YAML)

## Context

API 文件維護方式：

- **手寫 OpenAPI YAML** — 靈活，但容易與實作 drift；需要工具同步
- **Code-first 生成（`tsoa`、`express-openapi-validator`）** — 從 decorator/annotation 生成；引入新 framework 依賴
- **Schema-first：從 Zod 生成** — 已有 Zod schema 作為請求/回應的唯一 source of truth；`@asteasolutions/zod-to-openapi` 可直接轉換

## Decision

採用 **`@asteasolutions/zod-to-openapi`**：

- 所有 request/response schema 已在 `@app/shared` 用 Zod 定義
- `openapi:generate` script 執行 `buildOpenApiDocument()` → 輸出 `docs/api/openapi.yaml`
- CI 有 drift test（`openapi.test.ts`）：如果 schema 改了但沒重新 generate，測試失敗

## Consequences

- **正面**：schema 變更自動反映在文件；Zod validation（runtime）和 OpenAPI spec（文件）同源，無法 drift
- **負面**：`zod-to-openapi` 需要 `.openapi({ example: ... })` 標注才能產生範例值，增加一點 schema 定義的冗長性
- **中性**：Swagger UI 在 dev 環境掛載 `/api/docs`；production 不暴露（`NODE_ENV !== 'development'` guard）
