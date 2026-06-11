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

## 2026-06-11 17:35 复查与数据收口

### 发布版本

- `fdfaba2 fix: exclude legacy e2e smoke data`
- `e0efc8b fix: exclude internal proxy smoke logs`

### 本轮修复

- 将历史 e2e/smoke 数据纳入内部测试口径：
  - `@example.invalid`
  - `e2e-*@zhisuan.local`
  - `Codex Local Proxy Smoke*`
  - `smoke-payout-*`
- 维护任务清理旧 e2e/smoke 租约、订单、API Key 和内部绑定。
- 普通 proxy 运行健康排除内部 smoke/test 请求，避免与 `localProxySmoke` 重复报同一批自检失败。
- 使用管理员售后入口退款并关闭不可交付的 admin 测试订单 `f8822e5f-fce4-4fd2-b6fe-ac31b2383ba5`，退款 `20`，租约状态转为 `refunded`，本地 API Key 保持 `inactive`。

### 服务端验证

- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：40/40 通过。
- 服务端 `pnpm build`：通过。
- `GET /health`：`200`。
- `GET /ready`：`200`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。
- 当前 release：`e0efc8b`。

### 维护与复查结果

- Dashboard：
  - users：`1`
  - activeRentals：`0`
  - pendingWithdrawals：`0`
  - paidOrderCount：`0`
  - paidOrderAmount：`0`
  - walletAvailable：`999.99`
  - totalSpent：`0.01`
- Sub2Binding reconciliation：`ok=true`，`totalIssues=0`。
- Billing reconciliation：`ok=true`，`totalIssues=0`。
- Admin capability coverage：`ok=true`，`65/65` registered operations，`missingRoutes=0`。
- System health：
  - totalChecks：`25`
  - ok：`20`
  - warning：`2`
  - error：`3`

### 当前剩余项

- `payments` warning：生产仍为 `PAYMENT_PROVIDER=mock`。
- `resources` warning：没有 online Codex shared resource。
- `resourceCredentials` error：没有 active OpenAI refresh token/API credential。
- `sub2` error：OpenAI group `oai` 可达但 active OpenAI accounts 为 `0`。
- `localProxySmoke` error：`/v1/models` 成功，`/v1/responses` 仍返回 `503`，与 Sub2 账号状态一致。

Sub2API 当前两个 OpenAI OAuth 账号均为 `error`：

- account `1` / `main`：OpenAI 返回 `token_invalidated`。
- account `2` / `1`：Token revoked / authentication token invalidated。

结论：本轮已经把本地代码、后台入口、维护任务、历史测试数据和真实运营数据一致性问题收口。完整 OpenAI/Codex 反代闭环仍需要重新授权或补充有效 OpenAI 上游账号；这是当前唯一阻止 `/v1/responses` 真实成功的核心外部依赖。

## 2026-06-11 17:46 管理员维修入口追补

### 发布版本

- `a628055 fix: surface resource credential repair actions`

### 本轮修复

- `resourceCredentials.detail.issues` 增加可被管理后台直接消费的维修字段：
  - `actionHint`：在巡检问题说明中展示下一步处理建议。
  - `resourceId`：当存在候选共享资源时，可直接从巡检问题行打开资源详情。
  - `sub2Status`：当问题与 Sub2/OpenAI 上游调度相关时，可直接打开反代状态页。
- `resourceCredentials.detail.samples` 增加 `sampleType`，区分：
  - `applicable`：已有 active refresh token 且绑定了 Sub2 账号 ID，可尝试应用到 Sub2。
  - `missing_sub2_account`：已有 active refresh token 但缺少 Sub2 账号绑定，需要先补资源配置。
- Admin `反代状态` 页的 OpenAI 上游账号表新增：
  - `credentialsStatus`
  - `schedulable`
  - `updatedAt`
  - `rateLimitedAt` / `overloadUntil` / `tempUnschedulableUntil`

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：40/40 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：40/40 通过。
- 服务端 `pnpm build`：通过。
- `GET /health`：`200`。
- `GET /ready`：`200`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。
- 当前 release：`a628055`。

### 线上复查结果

`GET /api/admin/system-health`：

- totalChecks：`25`
- ok：`20`
- warning：`2`
- error：`3`

`resourceCredentials` 当前仍为 error，但问题样本已经具备可操作字段：

- type：`openai_refresh_token_candidate_missing`
- actionHint：提示创建/更新 Codex shared resource，保存 active OpenAI refresh token 并绑定 Sub2 account id，或在 Sub2 状态页直接粘贴有效 token。
- sub2Status：`true`

Sub2 账号复查：

- account `2` / `1`：`status=error`，`credentialsStatus=configured(3)`，`schedulable=false`，错误为 OpenAI token revoked / authentication token invalidated。
- account `1` / `main`：`status=error`，`credentialsStatus=configured(3)`，`schedulable=false`，错误为 OpenAI `token_invalidated`。

剩余阻断保持一致：

- `resourceCredentials` error：本地没有 active 且可应用的 OpenAI refresh token 候选。
- `sub2` error：OpenAI group `oai` 有 2 个账号，但 active OpenAI accounts 为 `0`。
- `localProxySmoke` error：最近一次端到端自检失败在 `/v1/responses`。
- `payments` warning：生产仍为 `PAYMENT_PROVIDER=mock`。
- `resources` warning：没有 online Codex shared resource。

结论：管理员现在可以从“可用性巡检”直接跳到 Sub2 状态页或共享资源详情完成凭据补录/应用。完整 OpenAI/Codex 反代真实生成仍需要补充一个有效 OpenAI refresh token 或重新授权现有 Sub2 OpenAI OAuth 账号。

## 2026-06-11 17:58 OpenAI/Codex 反代路由契约复查

### 发布版本

- `8cfc216 test: assert openai proxy route contract`

### 本轮修复

- 将本地 OpenAI/Codex 反代运行路由抽为共享契约：
  - `openAiProxyRoutePath=/v1/*`
  - `openAiProxyRouteMethods=GET,HEAD,POST,PUT,PATCH,DELETE`
- `registerOpenAiProxyRoutes()` 使用该契约注册真实 Fastify 路由。
- `inspectOpenAiProxyContract()` 新增路由覆盖指标，用于系统健康巡检：
  - `supportsAllV1ChildPaths`
  - `supportsReadMethods`
  - `supportsMutationMethods`
  - `routesResponsesApi`
  - `routesResponsesItems`
  - `routesChatCompletions`
  - `routesModelMetadata`
- API 测试新增“every concrete OpenAI v1 child path”用例，覆盖 `/v1/responses`、`/v1/responses/:id/input_items`、`/v1/chat/completions`、`/v1/models/:id`。

### 验证

- 本地 `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- 本地 `pnpm.cmd --filter @zyz/api test`：41/41 通过。
- 本地 `pnpm.cmd --filter @zyz/api run build`：通过。
- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：41/41 通过。
- 服务端 `pnpm build`：通过。
- `GET /health`：`200`。
- `GET /ready`：`200`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。

### 线上复查结果

`openAiProxyContract` 当前为 `ok`，关键指标：

- endpoint：`http://192.168.31.26:4100/v1`
- routePath：`/v1/*`
- routeMethods：`GET,HEAD,POST,PUT,PATCH,DELETE`
- supportsAllV1ChildPaths：`true`
- supportsReadMethods：`true`
- supportsMutationMethods：`true`
- routesResponsesApi：`true`
- routesResponsesItems：`true`
- routesChatCompletions：`true`
- routesModelMetadata：`true`

系统健康总览保持：

- totalChecks：`25`
- ok：`20`
- warning：`2`
- error：`3`

剩余阻断仍为外部上游凭据问题：

- `sub2`：`openai_group_has_no_active_accounts`。
- `resourceCredentials`：没有 active 且可应用的 OpenAI refresh token 候选。
- `localProxySmoke`：最近一次失败仍位于 `/v1/responses`。

结论：本地反代内核已经明确以 Sub2API 为上游覆盖完整 OpenAI `/v1/*` 子路径和 Codex 常用 Responses API；真实生成仍需补齐有效 OpenAI 上游账号凭据。

## 2026-06-11 18:07 共享资源巡检可操作化

### 发布版本

- `e4c5f4a fix: surface shared resource health actions`

### 本轮修复

- `resources` 健康项从纯摘要指标升级为可操作巡检：
  - 统计 `totalCodexResources`。
  - 统计 `onlineCodexResources`。
  - 返回 `detail.issues`，包括异常资源和缺少 online Codex 共享资源。
  - 返回 `detail.samples`，展示异常资源或非 online Codex 资源样本。
- 管理后台 `可用性巡检` 的问题样本新增 `resourceList` 操作：
  - 有具体 `resourceId` 时可打开资源详情。
  - 没有具体资源 ID 时仍可打开共享资源列表。
- 巡检候选样本摘要新增资源相关字段：
  - `resourceType`
  - `resourceStatus`
  - `sub2AccountId`
  - `level`
  - `maxConcurrency`
  - `updatedAt`

### 验证

- 本地 `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- 本地 `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- 本地 `pnpm.cmd --filter @zyz/api test`：41/41 通过。
- 本地 `pnpm.cmd --filter @zyz/api run build`：通过。
- 本地 `pnpm.cmd --filter @zyz/admin run build`：通过。
- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/admin run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：41/41 通过。
- 服务端 `pnpm build`：通过。
- `GET /health`：`200`。
- `GET /ready`：`200`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。

### 线上复查结果

`GET /api/admin/system-health`：

- totalChecks：`25`
- ok：`20`
- warning：`2`
- error：`3`

`resources` 当前为 warning：

- summary：`没有 online 的 Codex 共享资源`
- metrics：
  - disabled：`1`
  - totalCodexResources：`1`
  - onlineCodexResources：`0`
  - issueSamples：`1`
- issue：
  - type：`codex_online_resource_missing`
  - resourceId：`8b7706ac-2ac6-4962-83e5-0ed6ae49e067`
  - resourceList：`true`
  - resourceStatus：`disabled`
  - resourceType：`codex`
  - supplierEmail：`admin@zhisuan.local`
  - actionHint：提示打开已有 Codex 资源，绑定 Sub2 账号和 active 凭据，测试后切换 online。

剩余核心阻断仍为：

- `resourceCredentials`：没有 active 且可应用的 OpenAI refresh token。
- `sub2`：OpenAI group `oai` 有 2 个账号但 active OpenAI accounts 为 `0`。
- `localProxySmoke`：最近一次 `/v1/responses` 失败，与 Sub2 上游账号失效一致。

结论：共享资源告警现在已经能从巡检页直接跳转到共享资源列表和具体资源详情。完整 OpenAI/Codex 反代真实生成仍需要有效 OpenAI 上游凭据。

## 2026-06-11 18:16 支付充值巡检建议补强

### 发布版本

- `6696cd8 fix: add payment health repair hints`

### 本轮修复

- `payments.detail.issues` 增加：
  - `refId=PAYMENT_PROVIDER`
  - `actionHint`
- 生产环境使用 mock 充值时，巡检问题样本会明确提示：
  - mock recharge 不能作为公开计费依据。
  - 需要真实对外收费时，应接入真实支付 provider 与 webhook flow。
  - 否则服务应保持内部使用。

### 验证

- 本地 `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- 本地 `pnpm.cmd --filter @zyz/api test`：41/41 通过。
- 本地 `pnpm.cmd --filter @zyz/api run build`：通过。
- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：41/41 通过。
- 服务端 `pnpm build`：通过。
- `GET /health`：`200`。
- `GET /ready`：`200`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。

### 线上复查结果

`payments` 当前仍为 warning：

- summary：`生产环境仍启用 mock 充值`
- metrics：
  - provider：`mock`
  - nodeEnv：`production`
  - minRechargeAmount：`10`
  - rechargeEndpointEnabled：`true`
- issue：
  - type：`production_mock_recharge`
  - refId：`PAYMENT_PROVIDER`
  - actionHint：`Do not rely on mock recharge for public billing; integrate a real payment provider and webhook flow, or keep the service internal until then.`

系统健康总览保持：

- totalChecks：`25`
- ok：`20`
- warning：`2`
- error：`3`

结论：余额充值风险现在已经能在巡检问题样本中明确定位到环境配置和真实支付接入边界。完整 OpenAI/Codex 反代真实生成仍由 Sub2/OpenAI 上游凭据失效阻断。

## 2026-06-11 18:25 Sub2 账号级巡检样本

### 发布版本

- `7ac5061 fix: surface sub2 account health samples`

### 本轮修复

- `sub2.detail.samples` 新增默认 OpenAI 分组下非 active 或不可调度账号样本。
- 样本字段包括：
  - `sub2AccountId`
  - `sub2AccountName`
  - `accountStatus`
  - `credentialsStatus`
  - `schedulable`
  - `groupIds` / `groupNames`
  - `rateLimitedAt` / `overloadUntil` / `tempUnschedulableUntil`
  - `tempUnschedulableReason`
  - `updatedAt`
  - `message`
- 管理后台 `巡检候选样本` 支持 Sub2 账号样本，并提供 `打开反代状态` 操作。

### 验证

- 本地 `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- 本地 `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- 本地 `pnpm.cmd --filter @zyz/api test`：41/41 通过。
- 本地 `pnpm.cmd --filter @zyz/api run build`：通过。
- 本地 `pnpm.cmd --filter @zyz/admin run build`：通过。
- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/admin run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：41/41 通过。
- 服务端 `pnpm build`：通过。
- `GET /health`：`200`。
- `GET /ready`：`200`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。

### 线上复查结果

`sub2` 当前仍为 error：

- summary：`阻断：openai_group_has_no_active_accounts`
- metrics：
  - accounts：`2`
  - openAiAccounts：`2`
  - activeOpenAiAccounts：`0`
  - defaultGroupId：`2`
  - gatewayReachable：`true`

`sub2.detail.samples` 当前列出两个失效账号：

- account `2` / `1`：
  - accountStatus：`error`
  - credentialsStatus：`configured(3)`
  - schedulable：`false`
  - message：OpenAI token revoked / authentication token invalidated。
- account `1` / `main`：
  - accountStatus：`error`
  - credentialsStatus：`configured(3)`
  - schedulable：`false`
  - message：OpenAI `token_invalidated`。

结论：管理员现在可以在统一巡检页先看到具体失效的 Sub2 OpenAI 账号，再进入反代状态页执行账号刷新、测试、应用 refresh token 或端到端自检。真实 `/v1/responses` 仍需要有效 OpenAI refresh token 或重新授权。

## 2026-06-11 18:50 本地反代自检维修入口补强

### 发布版本

- `37d8e75 fix: link proxy smoke health repairs`

### 本轮修复

- `localProxySmoke.detail.issues` 新增 `sub2Status=true`，使管理后台 `可用性巡检 -> 巡检问题样本` 在本地 OpenAI/Codex 端到端自检失败、过期或跳过时可以直接显示 `打开反代状态`。
- 由 `admin.resource.credential_apply_sub2` 触发的 smoke 证据会把审计日志 `objectId` 暴露为 `resourceId`，管理员可以从同一条问题样本回到共享资源详情继续处理凭据、Sub2 账号绑定、资源测试或上线。
- 补充 API 单元测试 `local proxy smoke issues link operators back to repair surfaces`，锁定直接 smoke 与资源凭据触发 smoke 的可跳转字段。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：44/44 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/admin run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：44/44 通过。
- 服务端 `pnpm build`：通过。
- `GET /health`：`200`。
- `GET /ready`：`200`，database、Sub2API、OAuth Redis state、OpenAI proxy Redis limiter 均为 `ok`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。
- 当前 release marker：`commit=37d8e75`。
- 4100、3100、3101 监听进程 cwd 均已确认位于 `/opt/zhisuan-yizhan/user` 当前 release 下。

### 线上复查结果

`GET /api/admin/system-health` 当前总览：

- totalChecks：`26`
- ok：`21`
- warning：`2`
- error：`3`

`localProxySmoke` 当前仍为 error，但问题样本已经带有维修跳转字段：

- status：`error`
- summary：`Latest local OpenAI/Codex smoke test failed at /v1/responses.`
- issueType：`local_proxy_smoke_failed`
- sub2Status：`true`
- auditLogId：`bc499b11-e4b4-4070-9382-89159224f581`

CORS 复查：

- `Origin: http://192.168.31.26:3101` 请求 `GET /health` 返回 `access-control-allow-origin: http://192.168.31.26:3101`。
- 响应继续暴露 `access-control-expose-headers: x-proxy-request-id`。

剩余阻塞保持一致：

- `resourceCredentials` error：没有 active 且可应用的 OpenAI refresh token。
- `sub2` error：默认 OpenAI 分组 `oai` 下 2 个 OpenAI 账号均非 active，OpenAI 返回 token invalidated / revoked。
- `localProxySmoke` error：`/v1/models` 可通过，真实 `/v1/responses` 仍由失效 OpenAI 上游 token 阻断。
- `payments` warning：生产仍使用 `PAYMENT_PROVIDER=mock`。
- `resources` warning：当前没有 online Codex shared resource。

结论：本轮未伪造或绕过 OpenAI 上游凭据问题，而是把最后的端到端自检失败入口打通到管理员可维修页面。完整 OpenAI/Codex 反代闭环仍需要管理员补入有效 OpenAI refresh token 或重新授权 Sub2 OpenAI 账号后，再运行端到端自检确认 `/v1/responses` 成功。

## 2026-06-11 18:59 部署运行态巡检补强

### 发布版本

- `60be53a fix: add deployment runtime health check`

### 本轮修复

- 新增 `deploymentRuntime` 系统巡检项，读取当前 API 进程 cwd、release root 和 `.release-marker`。
- 当进程仍运行在 `user-replaced-*` 旧 release 目录时标记 `error`，避免 release marker 已切换但旧代码仍接管 4100 的情况被漏掉。
- 当进程运行在 `user.new-*` staging 目录时标记 `error`。
- 生产环境缺少 `.release-marker` 时标记 `warning`。
- 新增 `admin-deployment-runtime.test.ts`，覆盖当前 release、旧 release、staging release 和缺 marker 场景。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：48/48 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/admin run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：48/48 通过。
- 服务端 `pnpm build`：通过。
- 发布脚本启动后校验：
  - 4100 cwd：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100 cwd：`/opt/zhisuan-yizhan/user/apps/web`
  - 3101 cwd：`/opt/zhisuan-yizhan/user/apps/admin`
- 当前 release marker：`commit=60be53a`，`deployed_at=20260611T105847Z`。
- `GET /health`：`200`。
- `GET /ready`：`200`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。

### 线上复查结果

`GET /api/admin/system-health` 当前总览：

- totalChecks：`27`
- ok：`22`
- warning：`2`
- error：`3`

`deploymentRuntime` 当前为 ok：

- summary：`当前进程运行在 release 60be53a`
- releaseRoot：`/opt/zhisuan-yizhan/user`
- cwd：`/opt/zhisuan-yizhan/user/apps/api`
- markerPresent：`true`
- commit：`60be53a`
- deployedAt：`20260611T105847Z`
- runningFromReplacedRelease：`false`
- runningFromStagingRelease：`false`

剩余阻塞仍未变化：

- `resourceCredentials` error：没有 active 且可应用的 OpenAI refresh token。
- `sub2` error：默认 OpenAI 分组 `oai` 下 2 个 OpenAI 账号均非 active。
- `localProxySmoke` error：真实 `/v1/responses` 仍由失效 OpenAI 上游 token 阻断。
- `payments` warning：生产仍使用 `PAYMENT_PROVIDER=mock`。
- `resources` warning：当前没有 online Codex shared resource。

结论：本轮把发布过程中的“进程是否真的运行在当前 release”纳入后台巡检证据。完整 OpenAI/Codex 反代真实生成仍取决于有效 OpenAI 上游凭据补录或重新授权。

## 2026-06-11 19:09 资源凭据维修账号候选补强

### 发布版本

- `5714885 fix: surface credential repair account candidates`

### 本轮修复

- `resourceCredentials.detail.issues` 在 `openai_refresh_token_candidate_missing` 场景下新增 Sub2 账号维修候选字段：
  - `sub2AccountId`
  - `sub2AccountName`
  - `accountStatus`
  - `credentialsStatus`
  - `schedulable`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `resourceCredentials.detail.samples` 新增 `sampleType=sub2_account_repair_candidate`，直接列出可优先补 OpenAI refresh token 的 Sub2 账号候选。
- 新增 `resource-credential-health.ts` 纯函数和 `admin-resource-credential-health.test.ts`，覆盖账号候选字段映射、空候选处理和样本生成。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：51/51 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- 服务端 `pnpm --filter @zyz/api run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/admin run typecheck`：通过。
- 服务端 `pnpm --filter @zyz/api test`：51/51 通过。
- 服务端 `pnpm build`：通过。
- 发布脚本启动后校验：
  - 4100 cwd：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100 cwd：`/opt/zhisuan-yizhan/user/apps/web`
  - 3101 cwd：`/opt/zhisuan-yizhan/user/apps/admin`
- 当前 release marker：`commit=5714885`，`deployed_at=20260611T110759Z`。
- `GET /health`：`200`。
- `GET /ready`：`200`。
- `GET /` on `3100`：`200`。
- `GET /` on `3101`：`200`。

### 线上复查结果

`GET /api/admin/system-health` 当前总览：

- totalChecks：`27`
- ok：`22`
- warning：`2`
- error：`3`

`deploymentRuntime` 当前为 ok：

- commit：`5714885`

`resourceCredentials` 当前仍为 error，但已带出维修账号候选：

- issueType：`openai_refresh_token_candidate_missing`
- sub2Status：`true`
- sub2AccountId：`2`
- sub2AccountName：`1`
- accountStatus：`error`
- credentialsStatus：`configured(3)`
- schedulable：`false`
- repairAction：`apply_openai_refresh_token_to_sub2_account`
- repairSampleCount：`2`
- firstRepairSample.message：`Token revoked (401): Your authentication token has been invalidated. Please try signing in again.`

剩余阻塞仍未变化：

- Sub2/OpenAI 上游账号凭据失效，需要管理员补入有效 OpenAI refresh token 或重新授权。
- 本地 `/v1/*` 反代契约、限流、CORS、部署运行态和管理员入口均继续正常。

结论：管理员现在可以在统一巡检页直接看到应优先修复的 Sub2 OpenAI 账号，而不是只看到“缺少 active refresh token”。这进一步缩短了从巡检发现到反代状态页补 token、测试账号、重跑端到端自检的路径。

## 2026-06-11 19:21 反代状态页维修预选部署

### 发布版本

- `fd0babe fix: preselect sub2 repair account`

### 本轮修复

- 管理后台 `反代状态` 页复用已加载的 Sub2/OpenAI 账号状态，计算优先维修账号：
  - 优先选择默认 OpenAI 分组下非 active 或不可调度账号。
  - 默认分组无候选时，回退到任意非 active 或不可调度的 OpenAI 账号。
  - 仍无候选时，回退到第一个 OpenAI 账号。
- `Apply OpenAI Credentials` 下拉框默认选中该维修账号，并在对应选项上标记 `建议修复`。
- 该改动只影响管理员操作入口的默认选择和提示，不自动应用凭据，也不改变 Sub2API 账号状态。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- 服务端部署门禁：
  - `pnpm install --frozen-lockfile --prod=false`：通过。
  - `pnpm db:generate`：通过。
  - `pnpm exec prisma migrate deploy`：无待应用迁移。
  - `pnpm --filter @zyz/api run typecheck`：通过。
  - `pnpm --filter @zyz/admin run typecheck`：通过。
  - `pnpm --filter @zyz/api test`：51/51 通过。
  - `pnpm build`：通过。
- 发布脚本首次切换后发现 4100 API 进程仍运行在 `user-replaced-20260611T111821Z-fd0babe`，cwd 复核按预期中止。
- 已纠正重启三端口，并直接从当前 release 的应用目录启动：
  - 4100 cwd：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100 cwd：`/opt/zhisuan-yizhan/user/apps/web`
  - 3101 cwd：`/opt/zhisuan-yizhan/user/apps/admin`
- 当前 release marker：
  - `commit=fd0babe`
  - `deployed_at=20260611T111821Z`
- 启动后 HTTP 复查：
  - `GET /health`：`200`
  - `GET /ready`：`200`
  - `GET /` on `3100`：`200`
  - `GET /` on `3101`：`200`
- 管理后台构建产物已切换为 `apps/admin/dist/assets/index-B9hJepAO.js`，且包含 `Apply OpenAI Credentials` 与维修提示相关片段。

### 线上复查结果

`GET /api/admin/system-health` 当前总览：

- status：`error`
- totalChecks：`27`
- ok：`22`
- warning：`2`
- error：`3`
- checkedAt：`2026-06-11T11:21:28.882Z`

`deploymentRuntime` 当前为 ok：

- summary：`当前进程运行在 release fd0babe`
- cwd：`/opt/zhisuan-yizhan/user/apps/api`
- markerPath：`/opt/zhisuan-yizhan/user/.release-marker`
- issues：`[]`

`resourceCredentials` 仍为 error，但维修候选字段保持可用：

- issueType：`openai_refresh_token_candidate_missing`
- sub2Status：`true`
- sub2AccountId：`2`
- sub2AccountName：`1`
- accountStatus：`error`
- credentialsStatus：`configured(3)`
- schedulable：`false`
- repairAction：`apply_openai_refresh_token_to_sub2_account`

剩余阻断仍未变化：

- `sub2` error：默认 OpenAI 分组 `oai` 下没有 active OpenAI 上游账号。
- `localProxySmoke` error：最近一次 `/v1/responses` 真实生成仍失败。
- `payments` warning：生产环境仍启用 `PAYMENT_PROVIDER=mock`。
- `resources` warning：当前没有 online Codex shared resource。

结论：管理员从 `可用性巡检` 进入 `反代状态` 后，补 OpenAI refresh token 的表单会直接落到最可能需要修复的上游账号。完整 OpenAI/Codex 真实生成仍需要补入有效 OpenAI refresh token 或重新授权 Sub2 OpenAI 账号后再复查。

## 2026-06-11 19:31 生产部署脚本固化与验收

### 发布版本

- `5b4de01 chore: add production deploy script`

### 本轮修复

- 新增 `user/scripts/deploy-production.sh`，把生产发布流程从临时 SSH 命令固化为可复用脚本。
- 脚本能力：
  - 解包 `git archive HEAD:user` 生成的 release 包到 `user.new-*`。
  - 复制当前 `.env`，并确保 `SUB2_USAGE_SYNC_INTERVAL_MS=300000`、`SUB2_USAGE_SYNC_ON_START=true`。
  - 执行依赖安装、Prisma generate/migrate、API/Admin typecheck、API 测试和全量 build。
  - 停止 4100、3100、3101 后切换 release 目录。
  - 直接从当前 release 的 `apps/api`、`apps/web`、`apps/admin` 目录启动服务。
  - 对 `/health`、`/ready`、Web、Admin 首页执行 HTTP 复查。
  - 读取 `/proc/<pid>/cwd`，确认三个端口都运行在 `/opt/zhisuan-yizhan/user/apps/*`，且不是 `user-replaced-*` 或 `user.new-*`。
- 脚本不保存服务器密码或业务密钥，只通过参数接收 archive、commit、base 和端口。

### 本地/远端脚本验证

- 本地工作树新增脚本后，由于 Windows PowerShell 环境没有 `bash`，未在本机执行 `bash -n`。
- 已上传脚本到服务器临时目录执行：
  - `bash -n /tmp/sub2share-deploy-production-syntax.sh`：通过。
  - `bash /tmp/sub2share-deploy-production-help.sh --help`：通过。

### 服务端发布验证

使用新增脚本部署 `5b4de01`：

- `pnpm install --frozen-lockfile --prod=false`：通过。
- `pnpm db:generate`：通过。
- `pnpm exec prisma migrate deploy`：无待应用迁移。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm --filter @zyz/api test`：51/51 通过。
- `pnpm build`：通过。
- 启动后 HTTP 复查：
  - `GET /health`：`200`
  - `GET /ready`：`200`
  - `GET /` on `3100`：`200`
  - `GET /` on `3101`：`200`
- cwd 复查：
  - 4100：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100：`/opt/zhisuan-yizhan/user/apps/web`
  - 3101：`/opt/zhisuan-yizhan/user/apps/admin`
- release marker：
  - `commit=5b4de01`
  - `deployed_at=20260611T113056Z`

### 线上复查结果

`GET /api/admin/system-health` 当前总览：

- status：`error`
- totalChecks：`27`
- ok：`22`
- warning：`2`
- error：`3`
- checkedAt：`2026-06-11T11:31:53.311Z`

`deploymentRuntime` 当前为 ok：

- summary：`当前进程运行在 release 5b4de01`
- commit：`5b4de01`
- deployedAt：`20260611T113056Z`
- releaseRoot：`/opt/zhisuan-yizhan/user`
- cwd：`/opt/zhisuan-yizhan/user/apps/api`
- markerPresent：`true`
- runningFromReplacedRelease：`false`
- runningFromStagingRelease：`false`
- issues：`[]`

剩余阻断仍未变化：

- `resourceCredentials` error：没有 active 且可应用的 OpenAI refresh token；候选维修账号仍为 Sub2 account `#2` / `1`。
- `sub2` error：默认 OpenAI 分组 `oai` 下 2 个 OpenAI 账号均非 active。
- `localProxySmoke` error：最近一次 `/v1/responses` 真实生成失败，models 阶段成功。
- `payments` warning：生产环境仍启用 `PAYMENT_PROVIDER=mock`。
- `resources` warning：当前没有 online Codex shared resource。

结论：生产部署过程现在有仓库内脚本可复用，且真实发布已证明脚本能够避免旧 release cwd 漂移。完整 OpenAI/Codex 真实生成仍取决于有效 OpenAI refresh token 或重新授权 Sub2 OpenAI 账号。

## 2026-06-11 19:44 支付巡检跳转与部署脚本加固

### 发布版本

- `20a53ce fix: link payment health to wallet views`
- `bd6999a fix: harden production deploy restarts`

### 本轮修复

- `payments.detail.issues` 在 `PAYMENT_PROVIDER=disabled` 和生产环境 `PAYMENT_PROVIDER=mock` 场景下新增：
  - `walletList=true`
  - `walletTransactionList=true`
- 管理后台 `可用性巡检 -> 巡检问题样本` 新增操作：
  - `打开余额列表`
  - `打开余额流水`
- 这样管理员看到支付充值配置 warning/error 后，可以直接进入余额管理和余额流水复核受影响账务数据。
- 加固 `user/scripts/deploy-production.sh`：
  - 停端口时先发 `TERM`，再用 `fuser -k` 清理仍占用 4100/3100/3101 的进程。
  - 启动服务时使用 `cd -P` 进入当前 release 的 `apps/api`、`apps/web`、`apps/admin`。
  - 若 HTTP 复查成功但 cwd 复查发现旧 release listener，脚本会自动停止三端口并从当前 release 再启动一次。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：51/51 通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- 服务器临时路径 `bash -n` 校验加固后的 `deploy-production.sh`：通过。

### 服务端发布验证

首次部署 `20a53ce` 时，脚本按预期捕获到 4100 仍由旧 cwd 提供服务：

- marker 已切到 `20a53ce`。
- 4100 cwd：`/opt/zhisuan-yizhan/user-replaced-20260611T113911Z-20a53ce`
- Web/Admin cwd 已是当前 release。
- 已手动杀掉 4100 stale listener，并从 `/opt/zhisuan-yizhan/user/apps/api` 重启 API。

加固脚本后部署 `bd6999a`，发布门禁全部通过：

- `pnpm install --frozen-lockfile --prod=false`：通过。
- `pnpm db:generate`：通过。
- `pnpm exec prisma migrate deploy`：无待应用迁移。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm --filter @zyz/api test`：51/51 通过。
- `pnpm build`：通过。
- 启动后 HTTP 复查：
  - `GET /health`：`200`
  - `GET /ready`：`200`
  - `GET /` on `3100`：`200`
  - `GET /` on `3101`：`200`
- cwd 复查：
  - 4100：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100：`/opt/zhisuan-yizhan/user/apps/web`
  - 3101：`/opt/zhisuan-yizhan/user/apps/admin`
- release marker：
  - `commit=bd6999a`
  - `deployed_at=20260611T114311Z`

### 线上复查结果

`GET /api/admin/system-health` 当前总览：

- status：`error`
- totalChecks：`27`
- ok：`22`
- warning：`2`
- error：`3`
- checkedAt：`2026-06-11T11:44:02.343Z`

`deploymentRuntime` 当前为 ok：

- summary：`当前进程运行在 release bd6999a`
- commit：`bd6999a`
- deployedAt：`20260611T114311Z`
- cwd：`/opt/zhisuan-yizhan/user/apps/api`
- issues：`[]`

`payments` 当前仍为 warning，但操作入口已经补齐：

- provider：`mock`
- nodeEnv：`production`
- issueType：`production_mock_recharge`
- walletList：`true`
- walletTransactionList：`true`

剩余阻断仍未变化：

- `resourceCredentials` error：没有 active 且可应用的 OpenAI refresh token；候选维修账号仍为 Sub2 account `#2` / `1`。
- `sub2` error：默认 OpenAI 分组 `oai` 下 2 个 OpenAI 账号均非 active。
- `localProxySmoke` error：最近一次 `/v1/responses` 真实生成失败。
- `resources` warning：当前没有 online Codex shared resource。

结论：余额/售出可信度相关的支付配置 warning 现在可以从巡检页直达余额与流水复核入口；生产部署脚本也能捕获并恢复旧 release listener 漂移。完整 OpenAI/Codex 真实生成仍由 Sub2/OpenAI 上游凭据失效阻断。

## 2026-06-11 19:53 共享资源巡检筛选跳转

### 发布版本

- `659dd4e fix: filter resource health links`

### 本轮修复

- 管理后台 `可用性巡检 -> 巡检问题样本` 解析共享资源问题中的：
  - `resourceType`
  - `resourceStatus`
- 点击 `打开共享资源` 时，会把这些字段写入共享资源列表筛选条件，而不是只打开全量资源列表。
- 当前线上 `resources` warning 的 `codex_online_resource_missing` 问题会直接打开 `resourceType=codex` 且 `status=disabled` 的共享资源列表。
- 问题样本的对象摘要也会展示 `resourceType` 和 `resourceStatus`，便于管理员在巡检页先看清资源类型与状态。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

使用 `user/scripts/deploy-production.sh` 部署 `659dd4e`：

- `pnpm install --frozen-lockfile --prod=false`：通过。
- `pnpm db:generate`：通过。
- `pnpm exec prisma migrate deploy`：无待应用迁移。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm --filter @zyz/api test`：51/51 通过。
- `pnpm build`：通过。
- 启动后 HTTP 复查：
  - `GET /health`：`200`
  - `GET /ready`：`200`
  - `GET /` on `3100`：`200`
  - `GET /` on `3101`：`200`
- cwd 复查：
  - 4100：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100：`/opt/zhisuan-yizhan/user/apps/web`
  - 3101：`/opt/zhisuan-yizhan/user/apps/admin`
- release marker：
  - `commit=659dd4e`
  - `deployed_at=20260611T115253Z`

### 线上复查结果

`GET /api/admin/system-health` 当前总览：

- status：`error`
- totalChecks：`27`
- ok：`22`
- warning：`2`
- error：`3`
- checkedAt：`2026-06-11T11:53:49.488Z`

`deploymentRuntime` 当前为 ok：

- summary：`当前进程运行在 release 659dd4e`
- commit：`659dd4e`
- deployedAt：`20260611T115253Z`
- cwd：`/opt/zhisuan-yizhan/user/apps/api`
- issues：`[]`

`resources` 当前仍为 warning，但跳转筛选字段齐全：

- issueType：`codex_online_resource_missing`
- resourceId：`8b7706ac-2ac6-4962-83e5-0ed6ae49e067`
- resourceList：`true`
- resourceType：`codex`
- resourceStatus：`disabled`

筛选接口复查：

- `GET /api/admin/resources?resourceType=codex&status=disabled&page=1&pageSize=10`
- total：`1`
- first：`8b7706ac-2ac6-4962-83e5-0ed6ae49e067`
- firstType：`codex`
- firstStatus：`disabled`

剩余阻断仍未变化：

- `resourceCredentials` error：没有 active 且可应用的 OpenAI refresh token；候选维修账号仍为 Sub2 account `#2` / `1`。
- `sub2` error：默认 OpenAI 分组 `oai` 下 2 个 OpenAI 账号均非 active。
- `localProxySmoke` error：最近一次 `/v1/responses` 真实生成失败。
- `payments` warning：生产环境仍启用 `PAYMENT_PROVIDER=mock`。

结论：共享资源 warning 现在可以从巡检页直接进入精确筛选后的资源列表，并继续打开资源详情、补凭据、应用到 Sub2、测试并上线。完整 OpenAI/Codex 真实生成仍由 Sub2/OpenAI 上游凭据失效阻断。

## 2026-06-12 00:09 支付流水筛选与部署 cwd 严格判定

### 发布版本

- `8282b35 fix: filter payment health ledger links`
- `e2a2d28 fix: detect stale release cwd during deploy`

### 本轮修复

- `payments.detail.issues` 新增 `walletTransactionType=recharge`。
- 管理后台 `可用性巡检 -> 巡检问题样本 -> 打开余额流水` 会读取该字段，并把余额流水列表筛选到 `status=recharge`。
- 问题样本对象摘要新增 `walletTransactionType`，便于管理员在巡检页直接看出跳转会定位到充值流水。
- 修复生产部署脚本 cwd 判定：
  - `/opt/zhisuan-yizhan/user-replaced-*` 不再会被 `"/opt/zhisuan-yizhan/user"*` 前缀误判为当前 release。
  - `verify_all_port_cwds` 会汇总 4100、3100、3101 三个端口的失败状态，任一端口失败都会触发重启或部署失败。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：51/51 通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- 服务器临时路径 `bash -n` 校验修复后的 `deploy-production.sh`：通过。

### 服务端发布验证

部署 `8282b35` 时再次暴露 4100 旧 release cwd：

- marker 已切到 `8282b35`。
- 4100 cwd：`/opt/zhisuan-yizhan/user-replaced-20260611T160439Z-8282b35`
- 已手动杀掉 4100 stale listener，并从 `/opt/zhisuan-yizhan/user/apps/api` 重启 API。

修复脚本后部署 `e2a2d28`，发布门禁全部通过：

- `pnpm install --frozen-lockfile --prod=false`：通过。
- `pnpm db:generate`：通过。
- `pnpm exec prisma migrate deploy`：无待应用迁移。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm --filter @zyz/api test`：51/51 通过。
- `pnpm build`：通过。
- 启动后 HTTP 复查：
  - `GET /health`：`200`
  - `GET /ready`：`200`
  - `GET /` on `3100`：`200`
  - `GET /` on `3101`：`200`
- cwd 复查：
  - 4100：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100：`/opt/zhisuan-yizhan/user/apps/web`
  - 3101：`/opt/zhisuan-yizhan/user/apps/admin`
- release marker：
  - `commit=e2a2d28`
  - `deployed_at=20260611T160810Z`

### 线上复查结果

`GET /api/admin/system-health` 当前总览：

- status：`error`
- totalChecks：`27`
- ok：`22`
- warning：`2`
- error：`3`
- checkedAt：`2026-06-11T16:09:16.544Z`

`deploymentRuntime` 当前为 ok：

- summary：`当前进程运行在 release e2a2d28`
- commit：`e2a2d28`
- deployedAt：`20260611T160810Z`
- cwd：`/opt/zhisuan-yizhan/user/apps/api`
- issues：`[]`

`payments` 当前仍为 warning，但充值流水筛选字段齐全：

- issueType：`production_mock_recharge`
- walletList：`true`
- walletTransactionList：`true`
- walletTransactionType：`recharge`

筛选接口复查：

- `GET /api/admin/wallet-transactions?status=recharge&page=1&pageSize=10`
- total：`0`
- count：`0`
- 说明：当前线上没有充值流水，但接口按筛选参数正常返回分页结构。

剩余阻断仍未变化：

- `resourceCredentials` error：没有 active 且可应用的 OpenAI refresh token；候选维修账号仍为 Sub2 account `#2` / `1`。
- `sub2` error：默认 OpenAI 分组 `oai` 下 2 个 OpenAI 账号均非 active。
- `localProxySmoke` error：最近一次 `/v1/responses` 真实生成失败。
- `resources` warning：当前没有 online Codex shared resource。

结论：支付配置 warning 现在能直接定位到充值流水筛选结果，部署脚本也能严格识别旧 release cwd。完整 OpenAI/Codex 真实生成仍由 Sub2/OpenAI 上游凭据失效阻断。

## 2026-06-12 01:19 生产资源健康口径复查

### 发布版本

- `e1eaf6e fix: exclude internal supplier resources from health`

### 本轮修复

- `resources` 系统健康检查现在排除内部禁用 smoke 资源 `sub2AccountId=admin-disabled-smoke-resource`。
- dashboard 在线资源数量、资源状态分组、Codex resource 总量和 online 数量均按生产资源口径统计。
- `resources.metrics.ignoredInternalResources` 新增内部资源忽略数量，便于管理员理解数据库中仍存在内部记录。
- `resourceCredentials` 只把生产 Codex 资源上的 OpenAI refresh token 凭据视为可应用候选。
- 后台资源列表保持不变，仍可审计或清理内部资源。

### 本地验证

- `npm.cmd test` in `user/apps/api`：57/57 通过。
- `npm.cmd run typecheck` in `user/apps/api`：通过。
- `npm.cmd run build` in `user/apps/api`：通过。

### 服务端发布验证

- release marker：
  - `commit=e1eaf6e`
  - `deployed_at=20260611T171718Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `GET http://127.0.0.1:4100/health`：200
  - `GET http://127.0.0.1:4100/ready`：200
  - `GET http://127.0.0.1:3100/`：200
  - `GET http://127.0.0.1:3101/`：200
- cwd：
  - 4100：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100：`/opt/zhisuan-yizhan/user`
  - 3101：`/opt/zhisuan-yizhan/user`

### 线上系统健康复查

`GET /api/admin/system-health` 当前总览：

- status：`error`
- totalChecks：`28`
- ok：`23`
- warning：`2`
- error：`3`
- checkedAt：`2026-06-11T17:19:42.913Z`

`resources` 当前仍为 warning，但已经不再指向内部禁用资源：

- summary：`No online production Codex shared resource`
- totalCodexResources：`0`
- onlineCodexResources：`0`
- ignoredInternalResources：`1`
- issueSamples：`0`
- issueType：`codex_online_resource_missing`
- resourceId：未返回
- resourceStatus：`null`
- samples：`[]`

剩余阻断：

- `resourceCredentials` error：没有生产 Codex 资源上的 active 且可应用 OpenAI refresh token；Sub2 account `#2` / `1` 仍报告 token invalidated。
- `sub2` error：默认 OpenAI 分组 `oai` 下 2 个 OpenAI 账号均非 active。
- `localProxySmoke` error：最近一次 `/v1/responses` 真实生成失败，request id `d5435936-acc1-41fe-88ed-c99850834d22`，proxy request log id `efd432c8-1b7e-4830-b4a6-67f216aa82e2`。
- `payments` warning：生产环境仍为 `PAYMENT_PROVIDER=mock`。

结论：资源健康误报已修复。当前没有真实生产 Codex 共享资源，因此 `resources` warning 保留，但不再误导管理员打开内部 disabled smoke resource。完整 OpenAI/Codex 真实生成仍由上游 OpenAI/Sub2 refresh token 失效阻断。

## 2026-06-12 01:28 Sub2 维修账号预选发布

### 发布版本

- `e21272b fix: preselect sub2 repair account from health`

### 本轮修复

- 管理后台 `可用性巡检` 的问题样本和候选样本会提取 `sub2AccountId`。
- 点击 `打开反代状态` 时会携带该账号 ID。
- `反代状态` 页的 `Apply OpenAI Credentials` 表单会优先选中巡检定位的 OpenAI 上游账号，并在选项中标记 `巡检定位`。
- 没有巡检定位账号时，仍沿用原有自动建议：默认 OpenAI 分组下非 active 或不可调度账号优先，否则回退到任意非 active/不可调度账号，再回退到第一个 OpenAI 账号。

### 本地验证

- `npm.cmd run typecheck` in `user/apps/admin`：通过。
- `npm.cmd run build` in `user/apps/admin`：通过。

### 服务端发布验证

- release marker：
  - `commit=e21272b`
  - `deployed_at=20260611T172821Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `GET http://127.0.0.1:4100/health`：200
  - `GET http://127.0.0.1:4100/ready`：200
  - `GET http://127.0.0.1:3100/`：200
  - `GET http://127.0.0.1:3101/`：200
- cwd：
  - 4100：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100：`/opt/zhisuan-yizhan/user`
  - 3101：`/opt/zhisuan-yizhan/user`

### 线上复查

- `resourceCredentials.detail.issues[0].sub2AccountId`：`2`
- `resourceCredentials.detail.samples[0].sub2AccountId`：`2`
- `sub2.detail.samples[0].sub2AccountId`：`2`
- Admin 首页加载 JS 资产：`/assets/index-BvtfW6yT.js`
- 线上 Admin JS 资产包含 `preferredAccountId` 和 `Opened Sub2/OpenAI proxy status for account #`，确认新预选逻辑已发布。

结论：管理员从巡检页处理 Sub2/OpenAI 上游账号失效时，不再需要手工复制账号 ID；可以一键进入反代状态页并直接向被巡检定位的账号粘贴有效 OpenAI refresh token。真实生成阻断仍取决于提供有效的 OpenAI/Sub2 refresh token 并重新通过账号测试与端到端自检。

## 2026-06-12 01:39 直接 Sub2 Token 维修闭环发布

### 发布版本

- `c9bf204 fix: verify direct sub2 token repairs`

### 本轮修复

- `POST /api/admin/sub2/accounts/:id/apply-openai-refresh-token` 新增应用后验证：
  - `runAccountTest`：默认开启，应用成功后立即测试该 Sub2 OpenAI 账号。
  - `runSmokeTest`：可选开启，账号测试通过后继续运行本地 OpenAI/Codex 反代端到端自检。
  - `smokeModel`：可选自检模型。
  - `proxyId`：可选 Sub2 proxy id。
- 接口响应现在包含 `accountId`、`result`、`test`、`smokeTest`、`smokeTestSkippedReason`。
- 审计日志 `admin.sub2.account.apply_openai_refresh_token` 记录账号测试、自检请求、自检结果和跳过原因。
- 管理后台 `反代状态 -> Apply OpenAI Credentials` 表单新增 `proxy_id`、`应用后测试账号`、`应用后端到端自检` 和 `自检模型` 控件，并会在操作完成后直接展示测试/自检摘要。

### 本地验证

- `npm.cmd run typecheck` in `user/apps/api`：通过。
- `npm.cmd test` in `user/apps/api`：57/57 通过。
- `npm.cmd run typecheck` in `user/apps/admin`：通过。
- `npm.cmd run build` in `user/apps/admin`：通过。

### 服务端发布验证

- release marker：
  - `commit=c9bf204`
  - `deployed_at=20260611T173834Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `GET http://127.0.0.1:4100/health`：200
  - `GET http://127.0.0.1:4100/ready`：200
  - `GET http://127.0.0.1:3100/`：200
  - `GET http://127.0.0.1:3101/`：200
- cwd：
  - 4100：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100：`/opt/zhisuan-yizhan/user`
  - 3101：`/opt/zhisuan-yizhan/user`

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
  - deploymentRuntime commit：`c9bf204`
- Admin 首页加载 JS 资产：`/assets/index-lQJPHrrS.js`
- 线上 Admin JS 资产包含 `runAccountTest`、`runSmokeTest`、`proxyId`，确认新维修表单逻辑已发布。
- `resourceCredentials` / `sub2` 仍为 error：当前线上 OpenAI/Sub2 refresh token 失效，仍需要管理员提供有效 token。

结论：管理员直接粘贴 OpenAI refresh token 的路径已经从“仅应用凭据”升级为“应用、账号测试、可选端到端自检、审计留痕”的闭环。当前真实生成阻断仍由无有效上游 token 导致，待有效 token 提供后可在同一入口完成恢复验证。

## 2026-06-12 01:54 OpenAI 反代运行契约巡检发布

### 发布版本

- `68b6828 fix: expose openai proxy runtime contract`

### 本轮修复

- `GET /api/admin/system-health` 的 `openAiProxyContract` 巡检新增生产运行契约指标：
  - `requestBodyMode=raw-buffer`
  - `parsesAllContentTypesAsBuffer=true`
  - `forwardsOriginalBodyBytes=true`
  - `bodyLimitBytes=52428800`
  - `upstreamTimeoutMs=300000`
  - `streamIdleTimeoutMs=300000`
  - `upstreamAcceptEncoding=identity`
  - `stripsInboundAuthorization=true`
  - `reinjectsLocalBearerToSub2=true`
  - `hasStreamIdleTimeout=true`
- 非正整数的 `bodyLimitBytes`、`upstreamTimeoutMs` 或 `streamIdleTimeoutMs` 会让 `openAiProxyContract` 标记 `error`。
- 更新 `docs/system-health-check.md`、`docs/openai-proxy-test-coverage.md` 与 `docs/需求文档.md`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：58/58 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=68b6828`
  - `deployed_at=20260611T175446Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `GET http://127.0.0.1:4100/health`：200
  - `GET http://127.0.0.1:4100/ready`：200
  - `GET http://127.0.0.1:3100/`：200
  - `GET http://127.0.0.1:3101/`：200
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：58/58 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `openAiProxyContract`：`ok`
  - endpoint：`http://192.168.31.26:4100/v1`
  - routePath：`/v1/*`
  - routeMethods：`GET,HEAD,POST,PUT,PATCH,DELETE`
  - requestBodyMode：`raw-buffer`
  - bodyLimitBytes：`52428800`
  - upstreamTimeoutMs：`300000`
  - streamIdleTimeoutMs：`300000`
  - upstreamAcceptEncoding：`identity`
  - issueCount：`0`
- `openAiProxyRuntime`：`ok`
  - `storeMode=redis`
  - `limiterScope=redis`
  - `redisReachable=true`
- 剩余 warnings：
  - `payments`：生产环境仍启用 mock 充值。
  - `resources`：当前没有 online production Codex shared resource。
- 剩余 errors：
  - `resourceCredentials`：没有 active OpenAI refresh token 可应用凭据。
  - `sub2`：`openai_group_has_no_active_accounts`，两个 OpenAI OAuth 账号均为 token invalidated/revoked。
  - `localProxySmoke`：最新端到端自检在 `/v1/responses` 失败，代理日志错误码 `upstream_http_503`。

结论：本地 OpenAI/Codex 反代的接口契约、原始请求体转发策略、Sub2API 上游转发策略、Redis limiter 运行态和流式超时日志策略已经能在管理员巡检中直接证明。当前真实生成不可用仍由外部 OpenAI/Sub2 上游 token 失效导致，需要管理员在 `反代状态` 页粘贴有效 refresh token 后重新运行账号测试与端到端自检。

## 2026-06-12 02:03 共享资源巡检指标修正发布

### 发布版本

- `81c0384 fix: separate resource health issue metrics`

### 本轮修复

- `resources.metrics.issueSamples` 改为结构化资源健康 issue 数量。
- 新增 `resources.metrics.resourceSamples` 表示实际返回的资源候选样本数量。
- 当没有任何生产 Codex 资源时，巡检现在显示：
  - `issueSamples=1`
  - `resourceSamples=0`
- 新增单元测试覆盖“有 `codex_online_resource_missing` 问题，但没有具体资源行”的线上场景。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：59/59 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=81c0384`
  - `deployed_at=20260611T180304Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `GET http://127.0.0.1:4100/health`：200
  - `GET http://127.0.0.1:4100/ready`：200
  - `GET http://127.0.0.1:3100/`：200
  - `GET http://127.0.0.1:3101/`：200
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：59/59 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `resources`：`warning`
  - summary：`No online production Codex shared resource`
  - `totalCodexResources=0`
  - `onlineCodexResources=0`
  - `ignoredInternalResources=1`
  - `issueSamples=1`
  - `resourceSamples=0`
  - issue：`codex_online_resource_missing`
  - actionHint：创建生产 Codex 共享资源，绑定 Sub2 账号和 active OpenAI 凭据，测试后切换 online。
- `openAiProxyContract`：`ok`
- `openAiProxyRuntime`：`ok`
- `adminCapabilities`：`ok`，覆盖 5/5 个核心管理范围。
- 剩余 errors：
  - `resourceCredentials`：没有 active OpenAI refresh token 可应用凭据。
  - `sub2`：`openai_group_has_no_active_accounts`。
  - `localProxySmoke`：最新 `/v1/responses` 自检失败，代理日志错误码 `upstream_http_503`。

结论：共享资源巡检现在能准确表达“存在资源可用性问题，但线上没有可直接打开的生产资源行”。管理员仍可从 `resourceList=true` / `resourceType=codex` 的问题样本进入共享资源列表创建或修复生产 Codex 资源；真实生成恢复仍需要有效 OpenAI/Sub2 refresh token。
