# ADR 0004 — Auth: In-Memory Access Token + HttpOnly Refresh Cookie + Family Rotation

## Context

Session 管理的主要模式：

- **Server-side session（Redis）** — 有狀態，水平擴展需要 sticky session 或 Redis cluster
- **純 JWT（access only）** — 無狀態但 token 一旦洩漏無法撤銷，且長效 token 有安全風險
- **Access + Refresh（雙 token）** — short-lived access token + long-lived refresh token；需決定 refresh 如何傳遞

## Decision

採用：

- **Access token（JWT HS256, 15分鐘）** — 存在前端 memory（`useAuthStore`），不寫 localStorage/cookie；XSS 無法竊取
- **Refresh token（opaque 32 bytes, 7天）** — 存 HttpOnly + SameSite=Lax cookie；JS 無法讀取
- **DB 只存 SHA-256 hash**，token 本身不落 DB；`findUnique by hash` 驗證
- **Family-based rotation** — 每次 refresh 產生新 token，舊 token 作廢；replay detection：非 immediate parent 的重用 → 撤銷整條 family（`TOKEN_REUSED`）
- **10 秒 grace window** — 同一 parent 在 10 秒內允許重複使用（網路重試 idempotency）

前端：

- `main.tsx` boot 時呼叫 `restoreSession()`（`POST /api/auth/refresh`）→ F5 後仍維持登入
- `apiClient` interceptor：401 → single-flight refresh → retry；single-flight 防止 N 個並發 401 各自 refresh 觸發 family reuse

## Consequences

- **正面**：無 Redis 依賴；XSS 安全（access in-memory）；CSRF 安全（SameSite=Lax + refresh 只用 HttpOnly cookie）
- **負面**：access token 不可撤銷（15分鐘內有效）；重要操作（更改密碼）應強制 re-auth
- **中性**：部署到雲端時，refresh cookie 須與 API 同源（透過 Vercel rewrites proxy 解決，見 T8.8）
