# ADR 0005 — Centralized `transitionOrder` State Machine

## Context

訂單狀態轉換（PENDING → PAID → SHIPPED → COMPLETED / CANCELLED / REFUNDED）需要：

1. 驗證轉換合法性（不能從 CANCELLED → SHIPPED）
2. 執行 side effects（CANCELLED → restock；PAID → ShipmentMock；SHIPPED → audit log）
3. 確保 side effects 與狀態變更在同一個 transaction

初始設計選項：

- **在各 route handler 內各自執行** — 快速實作，但 restock/shipment 邏輯散落，難維護
- **集中在 `transitionOrder` service function** — 單一入口，所有轉換驗證 + side effects 在一處

## Decision

採用集中式 **`transitionOrder(tx, orderId, toStatus, actor?, opts?)`**。

設計特點：

1. **必須由 caller 傳入 tx** — 函數本身不開 transaction，讓 caller 決定 scope（避免巢狀 tx）
2. **Conditional updateMany** — `UPDATE order WHERE id=:id AND status=:expected`；count=0 拋 `INVALID_STATUS_TRANSITION(409)`，配合外層 tx rollback 所有 side effects
3. **ALLOWED_TRANSITIONS 常數表** — 列舉所有合法路徑，新增轉換在一處修改
4. **Side effects by switch** — `case 'CANCELLED': await restock(tx, items)`；不同 toStatus 觸發不同 side effect

## Consequences

- **正面**：背景 job（cancelTimedOut、autoComplete）、admin route（ship、refund）、webhook 都走同一個 function，邏輯一致；side effect regression 只需改一處
- **負面**：所有轉換都要 import 這個 function；`opts` 參數隨功能增長可能變胖（目前有 `note`、`shipment`）
- **中性**：並發 transition 安全性依賴 conditional updateMany；測試中有 concurrent-transition regression test 驗證
