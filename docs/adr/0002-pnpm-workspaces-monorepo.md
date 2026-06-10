# ADR 0002 — pnpm Workspaces Monorepo

## Context

專案有三個可交付單元：`apps/api`、`apps/web`、`packages/shared`。
主要組織方式：

- **各自獨立 repo** — 分開部署簡單，但 shared types 需要 publish 版號，跨 repo PR 笨重
- **monorepo（Turborepo / Nx）** — 任務編排功能強，但為三個 package 引入 build orchestrator 過重
- **pnpm workspaces（無 orchestrator）** — 原生 hoisting + symlinking，腳本用 `pnpm -r` / `pnpm -F` 組合

## Decision

採用 **pnpm workspaces**，不引入 Turborepo/Nx。

理由：

1. **shared types 零版本管理** — `@app/shared` 透過 workspace symlink 直接 import，API 和 Web 永遠看同一份 Zod schema
2. **單一 CI 流水線** — `pnpm lint && pnpm typecheck && pnpm test` 一條命令覆蓋所有 package
3. **規模合適** — 三個 package 不需要 incremental build cache；Turborepo 帶來的收益小於引入的複雜度
4. **hoisting 策略** — `shamefully-hoist=false`（預設），各 package 只看自己宣告的 dependency

## Consequences

- **正面**：型別變更立即反映在所有 package（不需 publish 循環）；tooling 統一在根目錄
- **負面**：沒有 build cache，全量 typecheck 在大型 repo 會慢；目前規模無感
- **中性**：新開 package 需手動在 `pnpm-workspace.yaml` 宣告；E2E 就是這樣加進來的
