# ADR 0008 — SKU `option_combination` Denormalized as JSONB

## Context

SKU 與 VariantOption 的關係有兩種建模方式：

**正規化**：`SKUOption` join table（`sku_id`, `variant_option_id`）

- 查詢 SKU 的所有選項需要 JOIN `sku_option` → `variant_option`
- 選項值修改能即時同步到所有引用的 SKU
- 無法快速知道「M + 藍色」對應哪個 SKU（需要聚合 join）

**反正規化 JSONB**：`sku.option_combination = { "尺寸": "M", "顏色": "藍色" }`

- SKU 自帶所有選項值，前端 picker 直接用 JSON 做 key-value 比對
- 不需要 JOIN；一次查詢拿到所有 SKU 的所有 option
- VariantOption 修改不會反映到歷史 SKU（快照語義）

## Decision

採用 **JSONB `option_combination` 反正規化**。

理由：

1. **前端 VariantPicker 邏輯簡單** — `skus.find(s => s.optionCombination[variantName] === selectedValue)` 直接 O(n) 搜尋，無需後端 JOIN API
2. **OrderItem 快照一致** — 訂單建立時把 SKU 快照複製到 OrderItem，JSONB 選項同時保留在快照裡，歷史訂單不受 VariantOption 改名影響
3. **Postgres JSONB 索引支援** — 如未來需要「查所有尺寸=M 的 SKU」，可加 GIN index
4. **管理複雜度低** — 本系統不需要跨 SKU 的選項統計，不需要正規化的好處

## Consequences

- **正面**：storefront 產品詳頁一次查詢（Product include SKUs）即可渲染所有選項；picker 邏輯純前端
- **負面**：VariantOption 修改（如改名）不自動同步到已存在的 SKU；需要 migration script 或 admin 手動更新 SKU
- **中性**：JSONB 欄位型別為 `Prisma.JsonValue`，需在 DTO 層 cast 成 `Record<string, string>` 並驗證
