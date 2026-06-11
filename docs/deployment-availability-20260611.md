# 线上部署可用性巡检与同步记录 2026-06-11

## 巡检对象

- 服务器：`192.168.31.26`
- 业务 API：`http://192.168.31.26:4100`
- 用户端 Web：`http://192.168.31.26:3100`
- 管理员端 Admin：`http://192.168.31.26:3101`
- Sub2API：`http://192.168.31.26:8080`

## 初始发现

- `22`、`80`、`3000`、`3100`、`3101`、`4100`、`8080` 等端口可达，`443` 未监听。
- Sub2API 进程位于 `/opt/sub2api`，`/health` 返回 `{"status":"ok"}`，`/v1/models` 在未带 Key 时返回 `401`，符合网关鉴权预期。
- 当前业务代码部署在 `/opt/zhisuan-yizhan/user`，不是 Git 工作区。
- 部署版本落后于 GitHub `main@aeeb18c`：
  - API 缺少 `/live`、`/ready`、`/api/admin/capabilities`。
  - Admin 构建产物未正确使用 `VITE_API_BASE`，直连 `3101` 时会请求相对 `/api/...`，导致管理端无法稳定调用 `4100` API。

## 修复动作

- 从本地 `main@aeeb18c` 生成 `user/` 部署包。
- 保留线上 `/opt/zhisuan-yizhan/user/.env`，构建时注入 `VITE_API_BASE=http://192.168.31.26:4100`。
- 创建备份：
  - `/opt/zhisuan-yizhan/user-backup-20260611T0833Z-aeeb18c`
  - `/opt/zhisuan-yizhan/user-replaced-20260611T0833Z-aeeb18c`
- 在新版本目录执行：
  - `pnpm install --frozen-lockfile --prod=false`
  - `pnpm db:generate`
  - `pnpm exec prisma migrate deploy`
  - `pnpm typecheck`
  - `pnpm --filter @zyz/api test`
  - `pnpm build`
- Prisma 已成功应用迁移 `0003` 到 `0014`。
- 停止旧 `4100`、`3100`、`3101` 进程后，切换新目录并重启 API/Web/Admin。
- 清理失败部署留下的临时目录和 `/tmp` 部署包。

## 验证结果

- `GET /health`：`200`，API 基础健康正常。
- `GET /live`：`200`，新版本存活探针可用。
- `GET /ready`：`200`，依赖检查通过：
  - database：`ok`
  - sub2api：`ok`
  - oauthStateStore：Redis shared `ok`
  - openAiProxyLimiter：Redis shared `ok`
- `GET /api/admin/capabilities`：未登录返回 `401`，证明路由已存在且受后台鉴权保护，不再是旧版本 `404`。
- `GET /` on `3101`：`200`，Admin 加载新资产 `index-CI9BnnPG.js`。
- `GET /` on `3100`：`200`，Web 加载新资产 `index-DizoTZ4a.js`。
- Admin/Web 构建产物均包含 `http://192.168.31.26:4100` API base。

## 当前未完成证明

真实 `/v1/responses` 端到端生成仍需有效 Sub2/OpenAI 上游账号和可用租赁 Key 证明。本次只证明：

- Sub2API 网关进程健康。
- 本地 API 的 `/ready` 依赖检查通过。
- 管理员入口的新能力覆盖端点已上线。
- Admin/Web 能正确指向业务 API。

## 2026-06-11 17:15 复查与增量修复

### 发布版本

- `17f231a fix: filter smoke sub2 bindings in app code`
- `04e37e7 fix: clean legacy health check rentals`
- `2eb5957 fix: ignore internal health bindings`

### 已修复问题

- 修复 Prisma JSON path 反选导致的 Sub2Binding 健康巡检误判：生产绑定不再因为缺少 `meta.smokeTest` 路径被排除。
- 生产环境启用 Sub2 usage 自动同步：
  - `SUB2_USAGE_SYNC_INTERVAL_MS=300000`
  - `SUB2_USAGE_SYNC_ON_START=true`
- 清理历史 `codex_health_*@example.invalid` 巡检用户产生的测试租约、订单、API Key、钱包余额和内部 Sub2Binding。
- 管理员系统维护任务新增对 legacy health check 用户的识别，真实运营统计不再混入旧巡检数据。
- 发布脚本增加 4100 监听进程 cwd 校验，避免旧 release API 进程占用端口导致新 API 启动失败。

### 服务端验证

- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：40/40 通过。
- 服务端 `pnpm build`：通过。
- `GET /health`：`200`。
- `GET /ready`：`200`，database、sub2api、OAuth Redis state、OpenAI proxy Redis limiter 均为 `ok`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。
- 4100 监听进程：`/opt/zhisuan-yizhan/user` 当前 release，marker 为 `commit=2eb5957`。

### 管理员入口复查

- `GET /api/admin/capabilities`：`ok=true`。
- 能力覆盖：
  - requiredAreas：`5`
  - coveredRequiredAreas：`5`
  - totalOperations：`65`
  - criticalOperations：`45`
  - registeredOperations：`65`
  - missingRoutes：`0`
- `GET /api/admin/dashboard` 当前真实运营口径：
  - users：`8`
  - activeRentals：`6`
  - onlineResources：`0`
  - paidOrderCount：`7`
  - paidOrderAmount：`120.01`
  - walletAvailable：`1160.99`
  - totalRecharged：`1200`
  - totalSpent：`140.01`

### 维护任务结果

`POST /api/admin/system-maintenance/run`：

- usage sync：`ok=true`，本轮 imported/recovered/skipped/unmatched 均为 `0`。
- Sub2Binding repair：`ok=true`。
- Sub2Binding reconciliation：
  - rentalsScanned：`7`
  - bindingsScanned：`11`
  - totalIssues：`0`
  - missingCurrentApiKeyBindings：`0`
  - duplicateCurrentApiKeyReferences：`0`
  - orphanBindings：`0`
- legacy health cleanup：
  - usersMatched：`3`
  - rentalsMatched：`6`
  - bindingsDeleted：`6`
  - sub2DisableSkipped：`1`，该项为保守跳过共享 Sub2 key，避免影响非内部 active 租约。

### 当前系统健康状态

`GET /api/admin/system-health`：

- totalChecks：`25`
- ok：`15`
- warning：`4`
- error：`6`

仍未达成 `ok` 的项目：

- `resourceCredentials` / `sub2` / `localProxySmoke` / `proxy`：
  - Sub2API 网关可达，`/v1/models` 可返回模型列表。
  - `/v1/responses` 返回 `503 Service temporarily unavailable`。
  - Sub2 状态明确给出 `openai_group_has_no_active_accounts`，当前 OpenAI group 有 2 个账号但 active OpenAI accounts 为 `0`。
  - 该项需要补充有效 OpenAI refresh token/API credential 或修复 Sub2API 上游账号状态后才能完成真实 Codex/OpenAI 反代闭环。
- `payments`：
  - 生产仍配置 `PAYMENT_PROVIDER=mock`。
- `resources`：
  - 当前 online Codex resources 为 `0`，没有可供管理员分配的在线共享资源。
- `orders` / `salesDelivery`：
  - 历史订单仍有 1 个 failed、1 个 provisioning，销售交付检查仍有 active order/rental/API key 状态不一致样本。
- `reconciliation`：
  - 仍有 2 个 withdrawal allocation mismatch 历史账务问题。

结论：本轮已修复可由代码、配置和内部测试数据清理解决的问题；完整 OpenAI/Codex 反代仍被 Sub2API 上游 OpenAI 账号不可用阻塞。
