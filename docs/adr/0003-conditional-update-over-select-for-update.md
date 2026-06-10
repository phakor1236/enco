# ADR 0003 — Conditional UPDATE for Oversell Prevention (not SELECT FOR UPDATE)

## Context

電商超賣問題：兩個並發請求同時讀到 `stock = 1`，都通過檢查，都下單，導致 `stock = -1`。
防止方式有三種：

1. **SELECT FOR UPDATE**（悲觀鎖）— 讀取時鎖行，其他 tx 必須等待；適合競爭激烈的秒殺場景
2. **樂觀鎖（version/timestamp）** — 讀取 version，UPDATE WHERE version = old；競爭失敗重試
3. **Conditional UPDATE（`WHERE stock >= qty`）** — 不讀取，直接更新，依賴 DB 原子性；count=0 表示庫存不足

## Decision

採用 **Conditional UPDATE**：

```sql
UPDATE sku
SET stock = stock - qty
WHERE id = :skuId AND stock >= :qty
```

若 `count = 0`，重新讀取當前 stock，拋出 `OUT_OF_STOCK`，整個 checkout tx rollback。

理由：

1. **無需鎖等待** — 不持有 row-level lock，其他 tx 不被阻塞；吞吐量更高
2. **Prisma 原生支援** — `updateMany({ where: { stock: { gte: qty } }, data: { stock: { decrement: qty } } })` 直接 mapping，不需 raw SQL
3. **TOCTOU 安全** — 讀寫在同一個原子操作，不存在「讀後寫前被搶」的時間窗
4. **簡單** — 不需要 retry loop（樂觀鎖失敗要重試），失敗直接 rollback

## Consequences

- **正面**：checkout service 邏輯簡潔；無鎖競爭；對 Prisma 友好
- **負面**：高競爭（秒殺）場景下，大量請求同時成功過 WHERE 卻只有一個 count=1，其他都 rollback；但本系統不是秒殺平台，可接受
- **中性**：`transitionOrder` 也採用同樣 pattern（`updateMany WHERE status = expected`）防止並發狀態轉換的 lost-update
