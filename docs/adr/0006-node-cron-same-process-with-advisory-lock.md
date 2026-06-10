# ADR 0006 — Background Jobs: node-cron in Same Process + Advisory Lock

## Context

系統需要五個定期任務：

- `cancelTimedOutOrders`（每 5 分鐘）
- `autoCompleteShippedOrders`（每天）
- `cleanupRefreshTokens`（每週）
- `cleanupStaleGuestCarts`（每天）
- `resetDemoDb`（每 6 小時，僅 production+flag）

架構選項：

- **獨立 worker process（BullMQ + Redis / Temporal）** — 分離關注點，可獨立部署；需要 Redis/queue infra
- **Serverless cron（Vercel Cron / AWS EventBridge）** — 平台管理排程；cold start 問題，需單獨 endpoint
- **同 process `node-cron`** — 零依賴；適合單一 instance 部署

## Decision

採用 **`node-cron` 在同一 API process**。

理由：

1. **零 infra 依賴** — 不需要 Redis、queue service、外部 scheduler，deploy 更簡單
2. **規模合適** — 五個低頻 job（最高頻 5 分鐘一次），沒有 queue backlog 的需求
3. **SIGTERM 優雅退出** — `registerJobs()` 回傳 `ScheduledTask[]`，`index.ts` 的 SIGTERM handler 呼叫 `task.stop()` + `server.close()`

`resetDemoDb` 用 Postgres advisory lock（`pg_try_advisory_lock(JOB_KEYS.RESET_DEMO_DB)`）防止多個 instance（藍綠部署 overlap）同時清資料。

## Consequences

- **正面**：本機開發 / CI / 雲端 deploy 一致；不需要維護 Redis
- **負面**：API process 重啟時，如果有 job 正在執行，SIGTERM 不等待 in-flight job 完成（目前接受：job 最長幾秒，Prisma tx 自動 rollback）
- **中性**：水平擴展超過一個 instance 時，job 會重複執行；advisory lock 防止 `resetDemoDb` 的 race，其他 job（cleanup、cancel）重複執行是冪等的
