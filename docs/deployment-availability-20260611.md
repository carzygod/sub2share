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

## 2026-06-12 02:10 资源凭据缺失问题共享资源入口发布

### 发布版本

- `298a142 fix: link credential issues to codex resources`

### 本轮修复

- `resourceCredentials.detail.issues` 中的 `openai_refresh_token_candidate_missing` 现在同时携带：
  - `resourceList=true`
  - `resourceType=codex`
  - `resourceStatus=null`
  - `sub2Status=true`
- 管理后台 `可用性巡检` 的同一问题行会同时展示 `打开共享资源` 与 `打开反代状态` 操作。
- 新增单元测试覆盖资源凭据缺失问题的 Codex 资源列表定位字段。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：60/60 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=298a142`
  - `deployed_at=20260611T181005Z`
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
  - API tests：60/60 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `resourceCredentials`：`error`
  - issue：`openai_refresh_token_candidate_missing`
  - `sub2Status=true`
  - `resourceList=true`
  - `resourceType=codex`
  - `resourceStatus=null`
  - `sub2AccountId=2`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `resources`：`warning`
  - `issueSamples=1`
  - `resourceSamples=0`
- `openAiProxyContract`：`ok`
- `openAiProxyRuntime`：`ok`
- `adminCapabilities`：`ok`

结论：当 Sub2/OpenAI 上游无 active 账号且本地没有可应用 refresh token 时，管理员不再只能进入反代状态页；同一巡检问题也可以直接打开 Codex 共享资源列表，选择创建生产资源或补齐资源凭据。真实生成恢复仍依赖有效 OpenAI/Sub2 refresh token。

## 2026-06-12 02:23 支付 mock 充值流水影响巡检发布

### 发布版本

- `71355e9 fix: expose mock recharge ledger risk`

### 本轮修复

- `GET /api/admin/system-health` 的 `payments.metrics` 新增最近充值流水影响指标：
  - `rechargeWindowHours`
  - `rechargeWindowStartedAt`
  - `recentRechargeTransactions`
  - `recentRechargeAmount`
  - `latestRechargeAt`
- 生产环境 `PAYMENT_PROVIDER=mock` 且最近窗口内已有充值流水时，`production_mock_recharge` 会提示管理员先复核充值流水，再把余额与售出收入视为真实收款依据。
- 新增 `inspectPaymentProviderHealth()` 纯 helper，并补测试覆盖 mock 无近期流水、mock 有近期流水和 disabled 充值。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：63/63 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=71355e9`
  - `deployed_at=20260611T182335Z`
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
  - API tests：63/63 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `payments`：`warning`
  - provider：`mock`
  - nodeEnv：`production`
  - rechargeEndpointEnabled：`true`
  - rechargeWindowHours：`24`
  - recentRechargeTransactions：`0`
  - recentRechargeAmount：`0.000000`
  - latestRechargeAt：`null`
  - issue：`production_mock_recharge`
- `resources`：`warning`
  - `issueSamples=1`
  - `resourceSamples=0`
- `resourceCredentials` / `sub2` / `localProxySmoke` 仍为 error：上游 OpenAI/Sub2 refresh token 失效。
- `openAiProxyContract` / `openAiProxyRuntime` / `adminCapabilities`：`ok`

结论：支付配置 warning 现在能同时回答“生产是否仍在 mock 充值”和“最近 24 小时 mock 充值是否已经写入余额流水”。当前线上未发现最近 mock 充值流水，余额风险仍主要来自生产继续启用 mock 充值配置本身；真实支付渠道接入仍是生产级后续任务。

## 2026-06-12 02:49 巡检共享资源生产范围跳转发布

### 发布版本

- `6e44e8f fix: scope resource health jumps to production`

### 本轮修复

- `resources.detail.issues` 与 `resourceCredentials.detail.issues` 的共享资源修复入口新增 `resourceScope=production`。
- `GET /api/admin/resources` 新增隐藏查询语义 `action=production`，会应用生产资源过滤，排除内部 smoke / disabled 自检资源。
- Admin `可用性巡检 -> 巡检问题样本 -> 打开共享资源` 会把 `resourceScope=production` 映射到生产资源列表。
- 普通共享资源列表不带 `action=production` 时仍保留内部资源行，用于管理员审计和清理。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：63/63 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=6e44e8f`
  - `deployed_at=20260611T184954Z`
- HTTP：
  - `GET http://192.168.31.26:4100/health`：200
  - `GET http://192.168.31.26:4100/ready`：200
  - `GET http://192.168.31.26:3100/`：200
  - `GET http://192.168.31.26:3101/`：200
- 监听端口：
  - `4100`：API
  - `3100`：Web
  - `3101`：Admin
  - `8080`：Sub2API
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：63/63 通过。
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
  - `resourceList=true`
  - `resourceScope=production`
  - `resourceType=codex`
- `resourceCredentials`：`error`
  - issue：`openai_refresh_token_candidate_missing`
  - `resourceList=true`
  - `resourceScope=production`
  - `resourceType=codex`
  - `resourceStatus=null`
  - `sub2Status=true`
- 资源列表口径：
  - `GET /api/admin/resources?page=1&pageSize=5&resourceType=codex&action=production`：`total=0`，`items=0`。
  - `GET /api/admin/resources?page=1&pageSize=5&resourceType=codex`：`total=1`，仍可看到内部 `admin-disabled-smoke-resource`。
- `openAiProxyContract`：`ok`
- `openAiProxyRuntime`：`ok`
- `payments`：`warning`，生产仍启用 mock 充值。
- `sub2` / `localProxySmoke` / `resourceCredentials` 仍为 error：上游 OpenAI/Sub2 refresh token 失效或无 active OpenAI 账号。

结论：从系统巡检进入共享资源修复时，管理员现在看到的是生产 Codex 资源范围，不会被内部 disabled smoke resource 误导；内部自检资源仍可通过普通共享资源列表审计。完整 `/v1/responses` 真实生成仍需要补充有效 OpenAI/Sub2 refresh token 并重新通过账号测试与端到端自检。

## 2026-06-12 03:00 Sub2 上游主问题直达修复账号发布

### 发布版本

- `7382eb4 fix: point sub2 health issues to repair accounts`

### 本轮修复

- 将 Sub2/OpenAI 上游巡检 issue 生成逻辑抽到 `sub2-upstream-health` helper。
- `sub2.detail.issues` 显式携带 `sub2Status=true`。
- 当阻断原因是 `openai_group_has_no_active_accounts` 时，主问题行会携带首个修复候选账号：
  - `sub2AccountId`
  - `sub2AccountName`
  - `accountStatus`
  - `credentialsStatus`
  - `schedulable`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- 管理后台现有 `打开反代状态` 操作会消费该 `sub2AccountId`，进入反代状态页后凭据应用表单预选该账号。
- 新增 `admin-sub2-upstream-health.test.ts`，覆盖失败账号样本、主问题修复候选字段和无候选账号时仍可打开反代状态。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：66/66 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=7382eb4`
  - `deployed_at=20260611T190032Z`
- HTTP：
  - `GET http://192.168.31.26:4100/health`：200
  - `GET http://192.168.31.26:4100/ready`：200
  - `GET http://192.168.31.26:3100/`：200
  - `GET http://192.168.31.26:3101/`：200
- 监听端口：
  - `4100`：API
  - `3100`：Web
  - `3101`：Admin
  - `8080`：Sub2API
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：66/66 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `sub2`：`error`
  - summary：`阻断：openai_group_has_no_active_accounts`
  - `gatewayReachable=true`
  - `defaultGroupId=2`
  - `openAiAccounts=2`
  - `activeOpenAiAccounts=0`
  - issue：`openai_group_has_no_active_accounts`
  - `sub2Status=true`
  - `sub2AccountId=2`
  - `sub2AccountName=1`
  - `accountStatus=error`
  - `credentialsStatus=configured(3)`
  - `schedulable=false`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `sub2.detail.samples` 继续列出两个失效账号：
  - `#2 / 1`：Token revoked / token invalidated。
  - `#1 / main`：token invalidated。
- `resourceCredentials` 主问题仍带同一个 repair candidate：
  - issue：`openai_refresh_token_candidate_missing`
  - `sub2Status=true`
  - `sub2AccountId=2`
  - `sub2AccountName=1`
  - `resourceList=true`
  - `resourceScope=production`

结论：系统巡检中的 Sub2 主问题行现在能直接定位优先修复账号，管理员从 `openai_group_has_no_active_accounts` 进入反代状态页时无需再从账号列表中二次判断。真实 `/v1/responses` 生成仍被失效 refresh token 阻断，需要粘贴有效 token 后运行账号测试和端到端自检。

## 2026-06-12 03:07 本地反代自检问题继承修复账号发布

### 发布版本

- `51b09f3 fix: link proxy smoke issues to repair accounts`

### 本轮修复

- `LocalProxySmokeEvidenceIssue` 新增可选修复账号字段：
  - `sub2AccountId`
  - `sub2AccountName`
  - `accountStatus`
  - `credentialsStatus`
  - `schedulable`
  - `repairAction`
- 新增 `attachLocalProxySmokeIssueRepairCandidate()`，复用 Sub2/OpenAI 上游巡检的账号候选样本。
- `localProxySmoke` 问题会保留代理请求定位字段，同时继承 Sub2 修复账号字段。
- Admin `可用性巡检` 中从 smoke 失败行点击 `打开反代状态` 时，可以直接预选修复账号。
- 新增单元测试 `local proxy smoke issues inherit Sub2 repair account candidates`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：67/67 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=51b09f3`
  - `deployed_at=20260611T190755Z`
- HTTP：
  - `GET http://192.168.31.26:4100/health`：200
  - `GET http://192.168.31.26:4100/ready`：200
  - `GET http://192.168.31.26:3100/`：200
  - `GET http://192.168.31.26:3101/`：200
- 监听端口：
  - `4100`：API
  - `3100`：Web
  - `3101`：Admin
  - `8080`：Sub2API
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：67/67 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `localProxySmoke`：`error`
  - summary：`Latest local OpenAI/Codex smoke test failed at /v1/responses.`
  - `model=gpt-5.3-codex`
  - `responsesOk=false`
  - `localProxyOk=false`
  - `proxyRequestLogCount=2`
  - issue：`local_proxy_smoke_failed`
  - `sub2Status=true`
  - `sub2AccountId=2`
  - `sub2AccountName=1`
  - `accountStatus=error`
  - `credentialsStatus=configured(3)`
  - `schedulable=false`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
  - `requestId=d5435936-acc1-41fe-88ed-c99850834d22`
  - `proxyRequestLogId=efd432c8-1b7e-4830-b4a6-67f216aa82e2`
  - `proxyRequestPath=/v1/responses`
  - `proxyRequestStatusCode=503`
  - `proxyRequestErrorCode=upstream_http_503`
- `sub2` 与 `resourceCredentials` 仍指向同一个修复账号 `sub2AccountId=2`。

结论：本地 `/v1/responses` 自检失败、Sub2 上游无 active 账号、资源凭据缺失三条巡检问题现在都指向同一个优先修复账号。管理员可以从任意一条问题进入反代状态页并预选账号 #2；真实生成仍需要补充有效 refresh token 并重新运行账号测试和端到端自检。

## 2026-06-12 03:15 巡检共享资源创建预填发布

### 发布版本

- `3982fd8 fix: prefill resource creation from health issues`

### 本轮修复

- Admin `可用性巡检 -> 打开共享资源` 现在会把问题样本中的 `sub2AccountId` 传入共享资源页。
- 共享资源创建表单会根据巡检上下文预填：
  - `resourceType`
  - `sub2AccountId`
- 普通进入共享资源页或清空资源筛选时，会清空巡检预填并恢复默认创建表单。
- 资源列表查询仍保留生产范围筛选：`resourceScope=production -> action=production`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=3982fd8`
  - `deployed_at=20260611T191501Z`
- HTTP：
  - `GET http://192.168.31.26:4100/health`：200
  - `GET http://192.168.31.26:4100/ready`：200
  - `GET http://192.168.31.26:3100/`：200
  - `GET http://192.168.31.26:3101/`：200
- 监听端口：
  - `4100`：API
  - `3100`：Web
  - `3101`：Admin
  - `8080`：Sub2API
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：67/67 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `resourceCredentials`：`error`
  - issue：`openai_refresh_token_candidate_missing`
  - `resourceList=true`
  - `resourceScope=production`
  - `resourceType=codex`
  - `sub2Status=true`
  - `sub2AccountId=2`
  - `sub2AccountName=1`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `resources`：`warning`
  - issue：`codex_online_resource_missing`
  - `resourceList=true`
  - `resourceScope=production`
  - `resourceType=codex`
- `localProxySmoke` 与 `sub2` 仍指向同一个修复账号 `sub2AccountId=2`。

结论：资源凭据巡检已经能把账号 #2 同时用于反代状态页预选和共享资源创建表单预填。管理员创建生产 Codex 资源时不再需要从巡检对象摘要里手工复制 Sub2 账号 ID；真实 `/v1/responses` 仍等待有效 refresh token。

## 2026-06-12 03:24 支付风险巡检直达售出情况发布

### 发布版本

- `74f8ce2 fix: link payment health to sales view`

### 本轮修复

- `payments.detail.issues` 新增 `salesList=true`。
- 支付配置问题现在同时提供：
  - `打开余额列表`
  - `打开余额流水`
  - `打开售出情况`
- 余额流水仍会通过 `walletTransactionType=recharge` 自动筛选充值类型。
- 管理员从生产 mock 充值 warning 可以直接联动复核余额、充值流水和售出收入视图。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：67/67 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=74f8ce2`
  - `deployed_at=20260611T192413Z`
- HTTP：
  - `GET http://192.168.31.26:4100/health`：200
  - `GET http://192.168.31.26:4100/ready`：200
  - `GET http://192.168.31.26:3100/`：200
  - `GET http://192.168.31.26:3101/`：200
- 监听端口：
  - `4100`：API
  - `3100`：Web
  - `3101`：Admin
  - `8080`：Sub2API
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：67/67 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `payments`：`warning`
  - issue：`production_mock_recharge`
  - `walletList=true`
  - `walletTransactionList=true`
  - `walletTransactionType=recharge`
  - `salesList=true`
  - `recentRechargeTransactions=0`
  - `recentRechargeAmount=0.000000`
- `GET /api/admin/sales?page=1&pageSize=5`：
  - status：200
  - total：1
  - summary 包含 `orderCount`、`paidAmount`、`supplierIncome`、`totalAmount`、`usageCharge`、`usageCount`

结论：生产 mock 充值 warning 现在能从巡检页直接进入余额、充值流水和售出情况三类运营视图。真实支付渠道仍需后续接入；当前线上没有最近 24 小时 mock 充值流水。

## 2026-06-12 03:35 共享资源缺失巡检继承修复账号发布

### 发布版本

- `41ea6cf fix: prefill missing resource repair account`

### 本轮修复

- `resources` 巡检生成 `codex_online_resource_missing` 问题时，会接收 Sub2/OpenAI 上游巡检的修复账号样本。
- 如果问题没有具体共享资源绑定，后端会继承首个修复候选账号字段：
  - `sub2AccountId`
  - `sub2AccountName`
  - `accountStatus`
  - `credentialsStatus`
  - `schedulable`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- 如果现有非 online Codex 资源本身已经绑定 `sub2AccountId`，系统保留真实资源绑定，不用候选账号覆盖。
- Admin `可用性巡检 -> 打开共享资源` 已可消费该字段，创建生产 Codex 资源时会直接预填候选 Sub2 账号 ID。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：69/69 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=41ea6cf`
  - `deployed_at=20260611T193504Z`
- HTTP：
  - `GET http://192.168.31.26:4100/health`：200
  - `GET http://192.168.31.26:4100/ready`：200
  - `GET http://192.168.31.26:3100/`：200
  - `GET http://192.168.31.26:3101/`：200
- 监听端口：
  - `4100`：API
  - `3100`：Web
  - `3101`：Admin
  - `8080`：Sub2API
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：69/69 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `resources`：`warning`
  - issue：`codex_online_resource_missing`
  - `resourceList=true`
  - `resourceScope=production`
  - `resourceType=codex`
  - `resourceStatus=null`
  - `sub2AccountId=2`
  - `sub2AccountName=1`
  - `accountStatus=error`
  - `credentialsStatus=configured(3)`
  - `schedulable=false`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `resourceCredentials`、`sub2` 与 `localProxySmoke` 仍指向同一个修复账号 `sub2AccountId=2`。
- `localProxySmoke` 仍失败在 `/v1/responses`，当前代理请求状态为 `503 upstream_http_503`。
- `payments` warning 仍带有 `walletList=true`、`walletTransactionList=true`、`walletTransactionType=recharge` 和 `salesList=true`。

结论：共享资源缺失 warning 现在与资源凭据、Sub2 上游、本地反代 smoke 三条巡检链路统一指向账号 #2。管理员从 `resources` 问题行进入共享资源页即可创建绑定账号 #2 的生产 Codex 资源；真实 `/v1/responses` 仍被上游 OpenAI/Sub2 refresh token 无效或不可调度状态阻断。

## 2026-06-12 03:46 共享资源缺失巡检预填供给方邮箱发布

### 发布版本

- `362f4f0 fix: prefill resource supplier from health issue`

### 本轮修复

- `resources` 巡检生成 `codex_online_resource_missing` 问题时，会查找 active 用户关联的供给方候选。
- 当系统恰好只有一个可用供给方候选，且问题没有具体共享资源行时，问题样本会附带该供给方的 `supplierEmail`。
- Admin `可用性巡检 -> 打开共享资源` 现在会传递 `supplierEmail`：
  - 共享资源列表使用该邮箱作为搜索条件。
  - 创建共享资源表单默认填入供给方邮箱。
  - 创建表单继续保留 `resourceType=codex` 和 `sub2AccountId=2` 预填。
- 多供给方候选时不自动选择默认供给方，避免把生产资源绑定到错误供应商。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：69/69 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=362f4f0`
  - `deployed_at=20260611T194645Z`
- HTTP：
  - `GET http://192.168.31.26:4100/health`：200
  - `GET http://192.168.31.26:4100/ready`：200
  - `GET http://192.168.31.26:3100/`：200
  - `GET http://192.168.31.26:3101/`：200
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：69/69 通过。
  - workspace build：通过。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `resources`：`warning`
  - issue：`codex_online_resource_missing`
  - `supplierEmail=admin@zhisuan.local`
  - `resourceList=true`
  - `resourceScope=production`
  - `resourceType=codex`
  - `resourceStatus=null`
  - `sub2AccountId=2`
  - `sub2AccountName=1`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `adminCapabilities`：`ok`
- `localProxySmoke` 仍为 `error`，真实 `/v1/responses` 仍被上游 OpenAI/Sub2 refresh token 无效或不可调度状态阻断。

结论：管理员现在从 `resources` warning 一键进入共享资源页时，生产 Codex 创建表单已经能预填供给方邮箱、资源类型和 Sub2 账号 ID。剩余阻断集中在有效 OpenAI refresh token / Sub2 上游账号修复。

## 2026-06-12 03:54 创建共享资源时保存初始凭据发布

### 发布版本

- `8672724 feat: save initial resource credential`

### 本轮修复

- `POST /api/admin/resources` 新增可选初始凭据字段：
  - `credentialType`
  - `credentialStatus`
  - `credentialSecret`
- 只有填写 `credentialSecret` 时才会在创建共享资源的同一事务内创建 `SupplierResourceCredential`。
- 初始凭据复用 `API_KEY_ENCRYPTION_SECRET` 和 `aes-256-gcm:v1` 加密格式；响应和审计日志只包含凭据摘要，不回显明文或密文。
- Admin `共享资源` 创建表单新增可选初始凭据输入，默认 `openai_refresh_token / active`。
- 创建成功后如果保存了初始凭据，前端提示“初始凭据已保存”，并打开资源详情继续执行“应用到 Sub2”、账号测试或端到端自检。
- 新增 `initialResourceCredentialCreateData()` helper 和单元测试，覆盖加密创建数据和空凭据省略。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：71/71 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=8672724`
  - `deployed_at=20260611T195448Z`
- HTTP：
  - `GET http://192.168.31.26:4100/health`：200
  - `GET http://192.168.31.26:4100/ready`：200
  - `GET http://192.168.31.26:3100/`：200
  - `GET http://192.168.31.26:3101/`：200
- 发布脚本在服务端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：71/71 通过。
  - workspace build：通过。
- 线上 Admin JS 资产包含 `credentialSecret` 和“初始凭据已保存”，确认创建表单与提交逻辑已发布。

### 线上复查

- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `resources`：`warning`
  - issue：`codex_online_resource_missing`
  - `supplierEmail=admin@zhisuan.local`
  - `resourceType=codex`
  - `sub2AccountId=2`
- `adminCapabilities`：`ok`
- `resourceCredentials` 与 `localProxySmoke` 仍为 `error`，原因仍是线上尚未提供有效 OpenAI refresh token 并完成 Sub2 应用/自检。

结论：管理员现在可以从 `resources` warning 打开共享资源页，并在同一个创建表单里完成“供给方邮箱 + Codex 类型 + Sub2 账号 #2 + 初始 OpenAI refresh token”的登记。系统仍要求显式应用凭据到 Sub2 并通过 `/v1/responses` 自检后，才能认为真实 OpenAI/Codex 反代恢复。
## 2026-06-12 04:13 创建后显式应用初始凭据发布与线上复查

### 发布版本

- `8a009d5 feat: apply initial credential during resource creation`

### 本轮修复

- `POST /api/admin/resources` 支持在创建共享资源时显式携带 `applyCredentialToSub2=true`。
- 创建资源时如果同时提交初始 `openai_refresh_token`，管理员可选择立即应用到绑定的 Sub2 账号。
- 应用流程复用独立资源详情页的安全逻辑：解密已保存凭据、写入 Sub2、测试账号、可选触发 `/v1/responses` 端到端自检，并写入不含明文凭据的审计记录。
- Admin 共享资源创建表单新增：
  - `创建后应用到 Sub2`
  - `client_id`
  - `proxy_id`
  - `应用后端到端自检`
  - `自检模型`
- 相关说明已同步到：
  - `docs/admin-resource-config.md`
  - `docs/supplier-resource-credential-encryption.md`
  - `docs/supplier-resource-credential-sub2-apply.md`
  - `docs/需求文档.md`

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：71/71 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=8a009d5`
  - `deployed_at=20260611T201042Z`
- 发布脚本在服务器端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：71/71 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听进程目录：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`
  - `3100`：`/opt/zhisuan-yizhan/user`
  - `3101`：`/opt/zhisuan-yizhan/user`
- 未发现残留 `user.new-*` staging 目录。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- 管理员总览：`GET /api/admin/dashboard` 200。
- 管理能力矩阵：`GET /api/admin/capabilities` 200。
  - `requiredAreas=5`
  - `coveredRequiredAreas=5`
  - `totalOperations=65`
  - `registeredOperations=65`
  - `missingRoutes=0`
- 生产 Admin JS 资源已包含 `创建后应用到 Sub2` / `applyCredentialToSub2`，确认新创建控件已上线。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`

### 最新 OpenAI/Codex 反代自检

- 触发入口：`POST /api/admin/sub2/proxy-smoke-test`
- 模型：`gpt-5.3-codex`
- 结果：`ok=false`
- `/v1/models`：
  - statusCode：`200`
  - modelCount：`10`
  - firstModel：`gpt-5.5`
- `/v1/responses`：
  - statusCode：`503`
  - errorType：`api_error`
  - errorMessage：`Service temporarily unavailable`
  - proxyRequestLogId：`2732cfa3-9df0-4488-96e2-c5a14df5d9fc`
  - requestId：`c3c3450f-5b06-4c72-aad4-449af98b6beb`
- 临时烟测资源清理：
  - `keyDisabled=true`
  - `apiKeyDeactivated=true`
  - `rentalClosed=true`
  - `orderClosed=true`
  - `walletReset=true`

### 仍未完成的阻断

- `payments`：warning，生产环境仍为 `PAYMENT_PROVIDER=mock`。
- `resources`：warning，没有 online 的生产 Codex 共享资源。
  - `supplierEmail=admin@zhisuan.local`
  - `sub2AccountId=2`
  - `accountStatus=error`
  - `credentialsStatus=configured(3)`
  - `schedulable=false`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `resourceCredentials`：error，当前没有可应用的 active OpenAI refresh token 资源凭据。
- `sub2`：error，`openai_group_has_no_active_accounts`。
  - Sub2 网关可达：`gatewayReachable=true`
  - 默认 OpenAI group：`2`
  - OpenAI accounts：`2`
  - active OpenAI accounts：`0`
  - 账号 #2：`Token revoked (401): Your authentication token has been invalidated. Please try signing in again.`
  - 账号 #1：`token_invalidated`
- `localProxySmoke`：error，最新证据已更新到本次部署后，失败点仍为 `/v1/responses` 上游 503。

### 结论

本轮已把“保存初始凭据”推进为“创建共享资源时可显式立即应用到 Sub2，并可触发账号测试和端到端反代自检”。管理员入口、能力矩阵、资源配置入口和本地 OpenAI/Codex `/v1/*` 反代框架均已在线验证；真实 Codex Responses 生成仍未恢复，原因不是当前部署缺失，而是 Sub2/OpenAI 上游没有 active 账号且现有 OAuth token 已失效。下一步需要在 Admin 共享资源创建页或 Sub2 状态页提交有效 OpenAI refresh token，应用到账号 #2 后重新运行 `/v1/responses` 烟测。
## 2026-06-12 04:22 资源凭据应用历史发布与线上复查

### 发布版本

- `610798e feat: show resource credential apply history`

### 本轮修复

- `GET /api/admin/resources/:id` 新增 `credentialApplyLogs` 字段。
- 该字段返回最近 5 条当前资源的 `admin.resource.credential_apply_sub2` 审计摘要。
- 返回内容只包含脱敏后的审计 `after` 摘要、操作者、时间和请求来源，不包含 OpenAI refresh token 明文或密文。
- Admin 共享资源详情页新增“最近凭据应用”区块，展示：
  - Sub2 账号。
  - 应用结果、`refreshed` / `applied` 状态或错误。
  - 账号测试结果。
  - 端到端 `/v1/responses` 烟测结果。
  - 关联代理请求路径、HTTP 状态、错误码和 requestId。
- 新增文档：`docs/admin-resource-credential-apply-history.md`。
- 总需求文档追加 `18.134 共享资源详情展示最近凭据应用历史`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：71/71 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=610798e`
  - `deployed_at=20260611T202235Z`
- 发布脚本在服务器端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：71/71 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听进程目录：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`
  - `3100`：`/opt/zhisuan-yizhan/user`
  - `3101`：`/opt/zhisuan-yizhan/user`
- 未发现残留 `user.new-*` staging 目录。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/resources?page=1&pageSize=10`：
  - total：`1`
  - resourceId：`8b7706ac-2ac6-4962-83e5-0ed6ae49e067`
- `GET /api/admin/resources/8b7706ac-2ac6-4962-83e5-0ed6ae49e067`：
  - `credentialApplyLogs` 字段存在。
  - 当前长度为 `0`，原因是线上尚无 `admin.resource.credential_apply_sub2` 审计记录。
- `GET /api/admin/audit-logs?action=admin.resource.credential_apply_sub2&page=1&pageSize=1`：
  - total：`0`
- 生产 Admin JS 资源包含 `credentialApplyLogs`，确认资源详情新增逻辑已发布。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`

### 结论

管理员共享资源详情现在可以直接展示“最近凭据应用到 Sub2”的历史证据。当前线上没有凭据应用审计记录，因此字段为空数组；一旦管理员提交有效 OpenAI refresh token 并应用到 Sub2，资源详情页会保留应用、账号测试、端到端烟测和 requestId 摘要。真实 `/v1/responses` 生成仍未恢复，剩余阻断仍是 Sub2/OpenAI 上游无 active 账号和生产支付 mock warning。
## 2026-06-12 04:37 Sub2 直接 Token 应用同步共享资源发布与线上复查

### 发布版本

- `b0e2733 feat: sync direct sub2 token apply to resources`

### 本轮修复

- `POST /api/admin/sub2/accounts/:id/apply-openai-refresh-token` 新增显式资源同步字段：
  - `saveToResource`
  - `resourceId`
  - `supplierEmail`
- 默认不保存 refresh token；只有管理员显式启用 `saveToResource` 时才同步保存。
- 如果填写 `resourceId`，系统会更新该 Codex 共享资源的 `sub2AccountId`、状态、`lastCheckedAt` 和加密凭据。
- 如果未填写 `resourceId`，但填写 `supplierEmail`，系统会为该供给方新建 Codex 共享资源并保存加密凭据。
- 只有 Sub2 应用成功后才保存本地资源凭据；Sub2 应用失败时返回 `resourceCredentialSync.saved=false`。
- 保存动作写入 `admin.sub2.account.save_refresh_token_resource` 审计日志。
- Admin “反代状态”页 Apply OpenAI Credentials 表单新增：
  - `保存为共享资源凭据`
  - `目标资源 ID`
  - `供给方邮箱，新建资源时必填`
- 新增文档：`docs/sub2-direct-token-resource-sync.md`。
- 总需求文档追加 `18.135 Sub2 直接应用 Token 后同步共享资源凭据`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：71/71 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=b0e2733`
  - `deployed_at=20260611T203717Z`
- 发布脚本在服务器端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：71/71 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听进程目录：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`
  - `3100`：`/opt/zhisuan-yizhan/user`
  - `3101`：`/opt/zhisuan-yizhan/user`
- 未发现残留 `user.new-*` staging 目录。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- Admin 生产 JS 资源包含：
  - `saveToResource`
  - `resourceCredentialSync`
- 本地预检验证：
  - 请求：`POST /api/admin/sub2/accounts/2/apply-openai-refresh-token`
  - body：`saveToResource=true`，但未提供 `resourceId` 和 `supplierEmail`
  - 结果：HTTP `400`
  - error code：`supplier_email_required`
  - 结论：保存目标参数缺失时会在本地预检阶段拦截，不会先调用 Sub2 或写入本地资源凭据。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`

### 结论

管理员现在可以从“反代状态”页直接完成“应用 OpenAI refresh token 到 Sub2 + 显式同步保存平台共享资源凭据”的闭环。该能力不会默认保存 token，必须由管理员勾选并通过二次确认；保存前会校验目标资源或供给方邮箱。真实 `/v1/responses` 仍未恢复，因为线上仍缺少有效 OpenAI refresh token / active Sub2 OpenAI 账号。
## 2026-06-12 04:49 Sub2 修复上下文预填发布与线上复查

### 发布版本

- `e86a6b1 feat: prefill sub2 repair resource context`
- `c4942a6 feat: enrich sub2 repair supplier context`

### 本轮修复

- Admin 系统健康页点击“打开反代状态”时，不再只传 `sub2AccountId`，会传递修复上下文：
  - `accountId`
  - `resourceId`
  - `supplierEmail`
  - `resourceType`
  - `resourceStatus`
- Admin “反代状态”页 Apply OpenAI Credentials 表单会使用该上下文：
  - 自动预选 Sub2 OpenAI 账号。
  - 自动预填目标资源 ID。
  - 自动预填供给方邮箱。
  - 如果存在资源 ID 或供给方邮箱，默认勾选“保存为共享资源凭据”。
  - 表单随修复上下文变化重新挂载，避免旧默认值残留。
- 后端系统健康报告新增修复上下文 enrichment：
  - 当 `repairAction=apply_openai_refresh_token_to_sub2_account` 的问题缺少 `supplierEmail`，且系统内恰好只有一个 active 供给方时，自动补入该供给方邮箱。
  - 当前线上候选为 `admin@zhisuan.local`。
- 新增文档：`docs/admin-sub2-repair-context-prefill.md`。
- 总需求文档追加 `18.136 系统健康到 Sub2 修复页的上下文预填`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：71/71 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 服务端发布验证

- release marker：
  - `commit=c4942a6`
  - `deployed_at=20260611T204838Z`
- 发布脚本在服务器端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：71/71 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听进程目录：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`
  - `3100`：`/opt/zhisuan-yizhan/user`
  - `3101`：`/opt/zhisuan-yizhan/user`
- 未发现残留 `user.new-*` staging 目录。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- Admin 生产 JS 资源包含：
  - `repairContext`
  - `credential-`
  - `saveToResource`
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- 当前线上所有 `repairAction=apply_openai_refresh_token_to_sub2_account` 问题均携带修复上下文：
  - `resource:codex-online-missing`：`sub2AccountId=2`，`supplierEmail=admin@zhisuan.local`，`resourceType=codex`
  - `openai-refresh-token-candidate-missing`：`sub2AccountId=2`，`supplierEmail=admin@zhisuan.local`，`resourceType=codex`
  - `sub2_upstream:openai_group_has_no_active_accounts`：`sub2AccountId=2`，`supplierEmail=admin@zhisuan.local`，`resourceType=codex`
  - `local_proxy_smoke_failed`：`sub2AccountId=2`，`supplierEmail=admin@zhisuan.local`，`resourceType=codex`

### 结论

管理员现在从系统健康页任一 OpenAI/Sub2 上游修复问题进入“反代状态”页时，表单会预选账号 #2 并预填供给方 `admin@zhisuan.local`，同时默认勾选保存为共享资源凭据。拿到有效 OpenAI refresh token 后，管理员只需粘贴 token 并确认，即可同时修复 Sub2 账号、沉淀平台 Codex 资源凭据并运行账号/端到端自检。真实 `/v1/responses` 仍未恢复，剩余条件仍是提供有效 OpenAI refresh token。

## 2026-06-12 04:55 资源凭据历史纳入 Sub2 直接保存记录发布与线上复查

### 发布版本

- `e085323 feat: include direct token sync in resource history`

### 本轮修复

- `GET /api/admin/resources/:id` 的 `credentialApplyLogs` 现在同时返回两类脱敏审计摘要：
  - `admin.resource.credential_apply_sub2`
  - `admin.sub2.account.save_refresh_token_resource`
- Admin 共享资源详情“最近凭据应用”表格新增“来源”列，用于区分：
  - 资源应用
  - Sub2 直接保存
- 对 Sub2 直接保存记录，前端会展示 `saved`、凭据状态和 fingerprint，不显示 refresh token 明文或密文。
- `docs/admin-resource-credential-apply-history.md` 与总需求文档已同步更新。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：71/71 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：无 whitespace 错误。

### 服务端发布验证

- release marker：
  - `commit=e085323`
  - `deployed_at=20260611T205546Z`
- 发布脚本在服务器端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：71/71 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听进程目录：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`
  - `3100`：`/opt/zhisuan-yizhan/user`
  - `3101`：`/opt/zhisuan-yizhan/user`
- 未发现残留 `user.new-*` staging 目录。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/resources?page=1&pageSize=5`：200，当前返回 1 条资源。
- `GET /api/admin/resources/:id`：200，响应包含 `credentialApplyLogs` 数组字段；当前线上该资源暂无最近凭据应用/保存记录。
- Admin 生产 JS 资源包含 `admin.sub2.account.save_refresh_token_resource`，确认新审计 action 已进入前端包。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`

### 结论

共享资源详情现在能同时覆盖“从资源应用到 Sub2”和“从反代状态页直接保存到资源”两条凭据修复路径的审计历史。真实 `/v1/responses` 仍未恢复，剩余条件仍是提供有效 OpenAI refresh token / active Sub2 OpenAI 账号。

## 2026-06-12 05:03 Sub2 直接应用 Token 自检证据纳入巡检发布与线上复查

### 发布版本

- `e40269a feat: include direct token apply smoke evidence`

### 本轮修复

- `localProxySmoke` 系统巡检新增读取 `admin.sub2.account.apply_openai_refresh_token` 审计日志。
- 该巡检现在统一识别三类端到端 smoke 证据：
  - `admin.sub2.proxy_smoke_test`
  - `admin.resource.credential_apply_sub2`
  - `admin.sub2.account.apply_openai_refresh_token`
- 直接应用 refresh token 的审计中会解析：
  - `smokeTest`
  - `smokeTestSkippedReason`
  - `resourceCredentialSync.resourceId`
  - Sub2 账号 ID
- `localProxySmoke` 问题样本现在可以携带直接 token 应用路径产生的 `sub2AccountId` 和可选 `resourceId`。
- 更新文档：
  - `docs/local-proxy-smoke-health-evidence.md`
  - `docs/system-health-check.md`
  - `docs/system-health-issue-samples.md`
  - `docs/需求文档.md`

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：72/72 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：无 whitespace 错误。

### 服务端发布验证

- release marker：
  - `commit=e40269a`
  - `deployed_at=20260611T210341Z`
- 发布脚本在服务器端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：72/72 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听进程目录：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`
  - `3100`：`/opt/zhisuan-yizhan/user`
  - `3101`：`/opt/zhisuan-yizhan/user`
- 未发现残留 `user.new-*` staging 目录。
- 生产 API dist 已包含新 action 扫描：
  - `routes.js` 包含 `where: { action: "admin.sub2.account.apply_openai_refresh_token" }`
  - `local-proxy-smoke-health.js` 包含 `admin.sub2.account.apply_openai_refresh_token` 解析逻辑

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- `localProxySmoke` 当前仍为 `error`：
  - summary：`Latest local OpenAI/Codex smoke test failed at /v1/responses.`
- 当前线上审计日志状态：
  - `admin.sub2.account.apply_openai_refresh_token`：暂无记录。
  - `admin.sub2.proxy_smoke_test`：已有 1 条最近记录。
  - `admin.resource.credential_apply_sub2`：暂无记录。

### 结论

从“反代状态”页直接应用 OpenAI refresh token 并运行端到端自检后，下一次系统巡检可以直接读取该审计产生的 `/v1/responses` 证据，并保留 Sub2 账号/资源上下文。当前真实可用性仍未恢复，剩余条件仍是提供有效 OpenAI refresh token / active Sub2 OpenAI 账号。

## 2026-06-12 05:13 管理后台前端入口覆盖发布与线上复查

### 发布版本

- `ba0e379 feat: verify admin frontend surface coverage`

### 本轮修复

- 新增 `apps/admin/src/app/admin-surfaces.ts`：
  - 集中声明 Admin 必需管理范围。
  - 集中声明侧边栏导航项。
  - 集中声明列表型管理页面。
  - 标记用户管理、共享资源、余额管理、售出情况、反代状态为目标关键入口。
- Admin 侧边栏改为从 `adminNavigationItems` 渲染，不再维护独立硬编码按钮清单。
- 新增 `apps/admin/tests/admin-surfaces.test.ts`，覆盖：
  - 必需管理范围：`users`、`sharing`、`wallets`、`sales`、`openaiProxy`。
  - 目标关键入口：用户管理、共享资源、余额管理、售出情况、反代状态、反代请求。
  - 所有列表型管理页面都能从侧边栏进入。
- `apps/admin/package.json` 的 `test` 脚本改为真实运行 Admin tests。
- `scripts/deploy-production.sh` 新增 `pnpm --filter @zyz/admin test`，后续生产部署会把 Admin 入口覆盖纳入门禁。
- 新增文档：`docs/admin-frontend-surface-coverage.md`。
- 总需求文档追加 `18.138 管理后台前端入口覆盖纳入发布门禁`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin test`：3/3 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：72/72 通过。
- `pnpm.cmd build`：通过。
- `pnpm.cmd -r test`：通过；Admin tests 已进入 workspace test 流。
- `git diff --check`：无 whitespace 错误。

### 服务端发布验证

- release marker：
  - `commit=ba0e379`
  - `deployed_at=20260611T211324Z`
- 发布脚本在服务器端完成：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：72/72 通过。
  - workspace build：通过。
- 本次部署启动时仍由旧 release 的部署脚本执行，因此 Admin test 未出现在部署日志中；发布完成后已确认当前 release 的脚本包含：
  - `pnpm --filter @zyz/admin test`
- 在当前 release 手动执行 `pnpm --filter @zyz/admin test`：3/3 通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听进程目录：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`
  - `3100`：`/opt/zhisuan-yizhan/user`
  - `3101`：`/opt/zhisuan-yizhan/user`
- 未发现残留 `user.new-*` staging 目录。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`28`
  - ok：`23`
  - warning：`2`
  - error：`3`
- Admin 静态入口：`GET http://192.168.31.26:3101/` 200。
- 当前 Admin 生产脚本为 `/assets/index-D4akrjVI.js`。

### 结论

管理员入口现在不仅有后端 API 能力矩阵，也有前端侧边栏入口覆盖测试。用户、共享资源、余额、售出和 Sub2/OpenAI 反代这五个目标核心范围已进入 Admin 测试和后续生产部署门禁。真实 `/v1/responses` 仍未恢复，剩余条件仍是提供有效 OpenAI refresh token / active Sub2 OpenAI 账号。

## 2026-06-12 05:33 管理前端入口巡检发布与线上复查

### 发布版本

- `0f80222 feat: surface admin frontend coverage in health`

### 本轮修复

- Admin surface 清单从 Admin 应用本地文件上移到 `packages/shared/src/index.ts`。
- `@zyz/shared` 改为输出 `dist/index.js` / `dist/index.d.ts`，并增加 `./admin-surfaces` 子路径导出，供 API 运行时读取。
- Admin 侧边栏和 Admin tests 改为消费共享 `adminNavigationItems` / `managedListViews`。
- `GET /api/admin/system-health` 新增 `adminSurfaceCoverage` / `管理前端入口` 检查项：
  - 校验用户、共享资源、余额、售出和 OpenAI/Codex 反代五个核心范围。
  - 校验 16 个列表型管理页面都能从侧边栏进入。
  - 校验侧边栏 view 不重复。
  - 异常时返回 `required_surface_area_missing`、`managed_list_view_missing` 或 `duplicate_navigation_view` 问题样本。
- API tests 新增共享 Admin surface 覆盖断言。
- API/Admin package scripts 增加 shared build 前置步骤，避免干净安装后单独运行 typecheck/test/build 时缺少 `@zyz/shared` dist。
- Windows 本地 `core.autocrlf=true` 下，普通 `git archive HEAD:user` 会把 shell 脚本归档为 CRLF；本次改用 `git -c core.autocrlf=false archive HEAD:user` 生成部署包，确保远端 `scripts/deploy-production.sh` 为 LF。

### 本地验证

- `pnpm.cmd --filter @zyz/shared run build`：通过。
- `pnpm.cmd --filter @zyz/shared run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：73/73 通过。
- `pnpm.cmd --filter @zyz/admin test`：3/3 通过。
- `pnpm.cmd build`：通过。
- `pnpm.cmd -r test`：通过。
- `git diff --check`：无 whitespace 错误。

### 服务端发布验证

- release marker：
  - `commit=0f80222`
  - `deployed_at=20260611T213328Z`
- 发布脚本在服务器端完成：
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：73/73 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听进程目录：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`
  - `3100`：`/opt/zhisuan-yizhan/user`
  - `3101`：`/opt/zhisuan-yizhan/user`
- 当前 release 的 `scripts/deploy-production.sh` CR 字符数为 `0`。
- 未发现残留 `user.new-*` staging 目录。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 新增检查项：
  - `adminSurfaceCoverage.status=ok`
  - `summary=管理前端入口覆盖 5/5 个核心管理范围`
  - metrics：`requiredAreas=5`、`coveredRequiredAreas=5`、`navigationItems=20`、`managedListViews=16`、`criticalViews=5`、`duplicateViews=0`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理后台入口现在由同一份共享矩阵驱动前端、测试和系统健康巡检。线上系统可以直接证明“后端管理员能力完整 + 前端核心入口完整 + Admin 静态入口可访问”。真实 OpenAI/Codex `/v1/responses` 仍未恢复，阻断继续集中在有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失。

## 2026-06-12 05:46 支付充值样本巡检发布与线上复查

### 发布版本

- `7234322 feat: surface recharge samples in health`

### 本轮修复

- `GET /api/admin/system-health` 的 `payments` / `支付充值` 检查在生产 mock 充值 warning 之外，新增最近 24 小时非 smoke 充值流水样本。
- `payments.metrics` 新增 `recentRechargeSamples`，用于标记本次巡检返回的最近充值样本数量。
- `payments.detail.samples` 新增 `recent_recharge_transaction` 样本，包含：
  - `walletTransactionId`
  - `userId`
  - `userEmail`
  - `amount`
  - `balanceAfter`
  - `currency`
  - `createdAt`
  - `walletLookup=true`
  - `walletList=true`
  - `walletTransactionList=true`
  - `walletTransactionType=recharge`
  - `salesList=true`
- Admin 巡检问题样本表新增支付样本操作入口：
  - 打开用户。
  - 打开余额列表。
  - 打开余额流水。
  - 打开售出情况。
  - 打开余额。
- 更新文档：
  - `docs/payment-provider-health.md`
  - `docs/system-health-check.md`
  - `docs/system-health-issue-samples.md`
  - `docs/需求文档.md`

### 本地验证

- `pnpm.cmd --filter @zyz/api test -- tests/admin-payment-provider-health.test.ts`：通过；当前脚本实际运行 API 全量测试，73/73 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd build`：通过。
- `pnpm.cmd -r test`：通过；API 73/73、Admin 3/3。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - `commit=7234322`
  - `deployed_at=20260611T214329Z`
- 部署包使用 `git -c core.autocrlf=false archive HEAD:user` 生成，避免 shell 脚本被本地 `core.autocrlf=true` 转为 CRLF。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 监听端口：
  - `4100`：API 已监听。
  - `3100`：Web 已监听。
  - `3101`：Admin 已监听。
  - `8080`：Sub2API 已监听。
- 未发现残留 `/opt/zhisuan-yizhan/user.new-*` staging 目录。
- `/tmp/sub2share-user-7234322.tar` 已不在服务器上。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 新增支付样本字段：
  - `payments.status=warning`
  - `payments.summary=生产环境仍启用 mock 充值`
  - `payments.metrics.provider=mock`
  - `payments.metrics.rechargeWindowHours=24`
  - `payments.metrics.recentRechargeTransactions=0`
  - `payments.metrics.recentRechargeAmount=0.000000`
  - `payments.metrics.latestRechargeAt=null`
  - `payments.metrics.recentRechargeSamples=0`
  - `payments.detail.issues=1`
  - `payments.detail.samples=[]`
- 当前线上最近 24 小时没有非 smoke 充值流水，所以样本数量为 `0`；若后续出现生产 mock 充值，管理员可直接从系统健康页跳转到用户、余额、余额流水和售出情况页面核查影响。
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

支付充值巡检现在不只提示“生产仍启用 mock 充值”，还会在存在真实充值影响时给出最近流水样本与后台跳转入口。当前线上系统基础入口与部署状态可用，真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍集中在有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失。

## 2026-06-12 06:01 反代上游 Request ID 追踪发布与线上复查

### 发布版本

- `e5f8fe4 feat: track upstream proxy request ids`

### 本轮修复

- `ProxyRequestLog` 新增 `upstreamRequestId` 字段。
- 新增 Prisma migration：`0015_proxy_request_log_upstream_request_id`。
- `/v1/*` 反代收到 Sub2API 响应后，按优先级提取上游 request id：
  - `x-request-id`
  - `openai-request-id`
  - `x-openai-request-id`
  - `request-id`
- CORS `Access-Control-Expose-Headers` 新增常见上游 request id 响应头。
- `GET /api/admin/proxy-requests` 支持按 `upstreamRequestId` 搜索。
- Admin `反代请求` 列表和 CSV 导出展示 `upstreamRequestId`。
- `GET /api/admin/system-health` 的 `proxy` 异常样本新增 `upstreamRequestId`。
- `openAiProxyContract.metrics` 新增：
  - `upstreamRequestIdHeaders=x-request-id,openai-request-id,x-openai-request-id,request-id`
  - `corsExposesUpstreamRequestIds=true`
  - `capturesUpstreamRequestId=true`
- 新增文档：`docs/proxy-request-upstream-request-id.md`，并同步更新 CORS、反代日志、系统健康、问题样本和总需求文档。

### 本地验证

- `pnpm.cmd db:generate`：通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test -- tests/openai-proxy-helpers.test.ts tests/api-cors.test.ts`：通过；当前脚本实际运行 API 全量测试，74/74 通过。
- `pnpm.cmd -r test`：通过；API 74/74、Admin 3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - `commit=e5f8fe4`
  - `deployed_at=20260611T215842Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：已应用 `0015_proxy_request_log_upstream_request_id`。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- 数据库列确认：
  - `ProxyRequestLog.upstreamRequestId:text`
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- CORS 探针：
  - `Access-Control-Expose-Headers=x-proxy-request-id, x-request-id, openai-request-id, x-openai-request-id, request-id`
  - `x-proxy-request-id` 可返回给浏览器端。
- 未发现残留 `/opt/zhisuan-yizhan/user.new-*` staging 目录。
- `/tmp/sub2share-user-e5f8fe4.tar` 已由部署脚本删除。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 新增契约字段：
  - `openAiProxyContract.status=ok`
  - `upstreamRequestIdHeaders=x-request-id,openai-request-id,x-openai-request-id,request-id`
  - `corsExposesUpstreamRequestIds=true`
  - `capturesUpstreamRequestId=true`
- CORS 巡检：
  - `corsPolicy.status=ok`
  - `exposesHeaders=x-proxy-request-id,x-request-id,openai-request-id,x-openai-request-id,request-id`
- 反代请求巡检：
  - `proxy.status=ok`
  - `proxyRecentTotal=0`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

OpenAI/Codex 反代现在能在本地日志、Admin 列表、CSV 和系统健康异常样本中携带上游 request id。后续 `/v1/responses` 若继续返回上游错误，管理员可以同时拿到本地 `x-proxy-request-id` 和 Sub2API/OpenAI 侧 request id 进行跨系统排障。真实 `/v1/responses` 仍未恢复，剩余条件仍是提供有效 OpenAI refresh token / active Sub2 OpenAI 账号。

## 2026-06-12 06:10 本地反代自检证据携带上游 Request ID 发布与线上复查

### 发布版本

- `afab975 feat: include upstream ids in smoke evidence`

### 本轮修复

- `Sub2ProxySmokeRequestLogSummary` 新增 `upstreamRequestId`。
- `runLocalOpenAiProxySmokeTest()` 读取 smoke 租赁关联 `ProxyRequestLog` 时同步选择 `upstreamRequestId`。
- `normalizeLocalProxySmokeAuditLog()` 解析 smoke 审计中的 `localProxy.proxyRequestLogs[].upstreamRequestId`。
- `localProxySmoke.detail.latest` 新增主代理请求的 `upstreamRequestId`。
- `localProxySmoke.detail.issues[]` 新增主代理请求的 `upstreamRequestId`。
- 单元测试覆盖：
  - 直接 smoke 审计解析上游 request id。
  - Sub2 直接应用 refresh token 后的 smoke 审计解析上游 request id。
  - smoke 失败问题样本携带上游 request id。
- 更新文档：
  - `docs/local-proxy-smoke-health-evidence.md`
  - `docs/local-proxy-smoke-request-log-links.md`
  - `docs/proxy-request-upstream-request-id.md`
  - `docs/system-health-check.md`
  - `docs/system-health-issue-samples.md`
  - `docs/需求文档.md`

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test -- tests/admin-local-proxy-smoke-health.test.ts`：通过；当前脚本实际运行 API 全量测试，74/74 通过。
- `pnpm.cmd -r test`：通过；API 74/74、Admin 3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - `commit=afab975`
  - `deployed_at=20260611T220830Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 生产 API dist 已包含 smoke 上游 request id 逻辑：
  - `local-proxy-smoke-health.js` 包含 `upstreamRequestId` 解析和 issue 输出。
  - `routes.js` 的 `listLocalProxySmokeLogs()` 已 select/map `upstreamRequestId`。
- 未发现残留 `/opt/zhisuan-yizhan/user.new-*` staging 目录。
- `/tmp/sub2share-user-afab975.tar` 已由部署脚本删除。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- `localProxySmoke`：
  - status：`error`
  - summary：`Latest local OpenAI/Codex smoke test failed at /v1/responses.`
  - `firstIssueHasUpstreamRequestIdKey=true`
  - `firstIssueUpstreamRequestId=null`
  - `latestUpstreamRequestId=null`
- 当前线上 latest smoke 审计产生于本次字段上线前，因此 `upstreamRequestId` 为空是预期行为；后续重新运行端到端 smoke 后，若 Sub2API/OpenAI 响应带上游 request id，系统健康 latest/issue 会直接展示。
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

本地反代自检证据现在与普通反代请求日志使用同一套上游 request id 线索。后续管理员从“反代状态”页运行 smoke，或在资源凭据应用/直接 token 应用时触发 smoke，系统健康页即可直接展示主失败请求的上游 request id。真实 `/v1/responses` 仍未恢复，剩余条件仍是提供有效 OpenAI refresh token / active Sub2 OpenAI 账号。

## 2026-06-12 06:25 管理员用户详情横向钻取发布与线上复查

### 发布版本

- `b52ca71 feat: add admin user detail cross links`

### 本轮修复

- 管理后台 `用户详情` 顶部新增 `打开余额` 操作。
- 用户详情中的最近钱包流水、订单、租赁、API Key、供给资源和提现记录新增行内 `打开` 操作。
- 行内操作复用既有列表筛选和详情打开函数：
  - 余额流水：按流水 ID 打开 `walletTransactions`。
  - 订单：打开 `orders` 并进入订单详情。
  - 租赁：打开 `rentals` 并进入租赁详情。
  - API Key：按 Key ID 打开 `apiKeys`。
  - 共享资源：打开 `resources` 并进入资源详情。
  - 提现：按提现 ID 打开 `withdrawals`。
- 新增文档：`docs/admin-user-detail-cross-links.md`。
- `docs/需求文档.md` 新增 `18.143 管理员用户详情支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd -r test`：通过，API 74/74，Admin 3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - `commit=b52ca71`
  - `deployed_at=20260611T222545Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-DoOQYvd0.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- 未发现残留 `/opt/zhisuan-yizhan/user.new-*` staging 目录。
- `/tmp/sub2share-user-b52ca71.tar` 已由部署脚本删除，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从单个用户详情页横向进入余额、余额流水、售出订单、租赁通道、API Key、共享资源和提现管理，用户维度排障路径更短。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 06:34 管理员订单详情横向钻取发布与线上复查

### 发布版本

- `ddb1c78 feat: add admin order detail cross links`

### 本轮修复

- 管理后台 `订单详情` 顶部新增 `打开用户` 操作。
- 订单详情中的钱包流水、最近反代请求、订单项、租赁交付、租赁限制和 API Key 新增行内 `打开` 操作。
- 行内操作复用既有列表筛选和详情打开函数：
  - 钱包流水：按流水 ID 打开 `walletTransactions`。
  - 反代请求：按 `requestId` 打开 `proxyRequests`。
  - 订单项：按商品 ID 打开 `products`。
  - 租赁交付：打开 `rentals` 并进入租赁详情。
  - 租赁限制：打开 `rentals` 并进入租赁详情。
  - API Key：按 Key ID 打开 `apiKeys`。
- 该能力同时覆盖 `售出情况` 与 `订单管理` 两个入口，因为它们共用订单详情组件。
- 新增文档：`docs/admin-order-detail-cross-links.md`。
- `docs/需求文档.md` 新增 `18.144 管理员订单详情支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd -r test`：通过，API 74/74，Admin 3/3。
- `pnpm.cmd build`：通过。
- `git diff --check` / `git diff --cached --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - `commit=ddb1c78`
  - `deployed_at=20260611T223418Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-Dw-a_3xv.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-ddb1c78.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从单个售出订单或订单详情页横向进入用户、余额流水、反代请求、商品、租赁通道和 API Key 管理，订单售后与交付排障路径更短。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 06:44 管理员反代请求横向钻取发布与线上复查

### 发布版本

- `9586ac9 feat: add admin proxy request cross links`

### 本轮修复

- `GET /api/admin/proxy-requests` 的租赁关联信息新增 `orderId` 与 `productId`。
- 订单详情中的最近反代请求数据也同步返回租赁关联 `orderId` 与 `productId`。
- 管理后台 `反代请求` 列表新增 `操作` 列。
- 行内操作可从单条 OpenAI/Codex 代理日志继续打开：
  - 用户管理并进入用户详情。
  - 订单管理并进入订单详情。
  - 租赁管理并进入租赁详情。
  - API Key 管理。
  - 商品配置。
  - 用量记录列表。
- 新增文档：`docs/admin-proxy-request-cross-links.md`。
- `docs/需求文档.md` 新增 `18.145 管理员反代请求支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，74/74。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check` / `git diff --cached --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - `commit=9586ac9`
  - `deployed_at=20260611T224445Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-B9Y-jEhm.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-9586ac9.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/proxy-requests?page=1&pageSize=5`：200。
  - 样本 request id：`c3c3450f-5b06-4c72-aad4-449af98b6beb`。
  - 样本 rental id：`c2804538-e863-4071-a1f2-2580a12f5948`。
  - 样本 order id：`9f6e77b9-087c-454b-acb5-843de1459519`。
  - 样本 product id：`91b79a4e-5977-4206-821d-009f37f4280a`。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从全局反代请求列表直接进入用户、订单、租赁、API Key、商品和用量管理，`系统健康 -> 反代请求 -> 业务对象/售后对象` 的排障链路更完整。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 06:54 管理员余额与流水横向钻取发布与线上复查

### 发布版本

- `0f0c42a feat: add admin wallet cross links`

### 本轮修复

- 管理后台 `余额管理` 列表行新增 `用户` 与 `流水` 操作。
- `余额详情` 顶部新增 `打开用户` 与 `打开流水` 操作。
- `余额详情` 的最近余额流水新增 `操作` 列。
- 全局 `余额流水` 列表新增 `操作` 列。
- 流水行内操作可继续打开：
  - 余额账户列表。
  - 用户管理并进入用户详情。
  - 余额流水列表。
  - `refType=order` 对应的订单管理与订单详情。
  - `refType=usage` 对应的用量记录列表。
  - `refType=withdrawal` 对应的提现管理列表。
- 新增文档：`docs/admin-wallet-cross-links.md`。
- `docs/需求文档.md` 新增 `18.146 管理员余额与流水支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check` / `git diff --cached --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - `commit=0f0c42a`
  - `deployed_at=20260611T225412Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-WpdVgBix.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-0f0c42a.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/wallet-transactions?page=1&pageSize=5`：200。
  - 样本流水 ID：`44687adf-ee98-4c27-9b29-66a9e7f68520`。
  - 样本 wallet ID：`c4fdd461-a056-49a6-89ec-bc28d280e9c7`。
  - 样本 user ID：`2154e9ba-76cb-4d8c-bb7f-731fb0fb92c8`。
  - 样本 user email：`admin@zhisuan.local`。
  - 样本引用：`refType=order`，`refId=f8822e5f-fce4-4fd2-b6fe-ac31b2383ba5`。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从余额账户和单条流水直接进入用户、订单、用量与提现管理，`余额情况 -> 售出/用量/提现证据` 的排障路径更完整。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 07:05 管理员共享资源横向钻取发布与线上复查

### 发布版本

- `0f9713b feat: add admin shared resource cross links`

### 本轮修复

- 管理后台 `供给方管理` 行新增用户、资源、提现直达操作。
- `供给方管理` 的最近资源行新增打开资源操作。
- `共享资源池` 行新增供给方、反代状态、用量、结算直达操作。
- `资源详情` 顶部新增供给方、反代状态、用量、结算和提现直达操作。
- `资源详情` 的供给方区块新增打开用户和提现操作。
- `资源详情` 的最近用量新增操作列，可打开用量、用户、租赁和反代请求。
- `资源详情` 的最近结算新增操作列，可打开结算和对应用量。
- `最近凭据应用` 新增操作列，可打开 Sub2 反代状态和关联反代请求。
- 新增文档：`docs/admin-shared-resource-cross-links.md`。
- `docs/需求文档.md` 新增 `18.147 管理员共享资源支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check` / `git diff --cached --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - `commit=0f9713b`
  - `deployed_at=20260611T230528Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-Ddu2G8vr.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-0f9713b.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/resources?page=1&pageSize=5`：200。
  - 样本资源 ID：`8b7706ac-2ac6-4962-83e5-0ed6ae49e067`。
  - 样本供给方：`admin@zhisuan.local` / `2154e9ba-76cb-4d8c-bb7f-731fb0fb92c8`。
  - 样本资源类型：`codex`。
  - 样本状态：`disabled`。
  - 样本 Sub2 账号：`admin-disabled-smoke-resource`。
- `GET /api/admin/resources/8b7706ac-2ac6-4962-83e5-0ed6ae49e067`：200。
  - usageSummary._count：`0`。
  - settlementSummary._count：`0`。
  - credentialApplyLogs：`0`。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从供给方和共享资源直接进入用户、Sub2/OpenAI 反代状态、用量、反代请求、结算和提现管理，`共享情况 -> 上游修复/结算证据` 的排障路径更完整。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 07:18 管理员租赁交付横向钻取发布与线上复查

### 发布版本

- `6386643 feat: add admin rental cross links`

### 本轮修复

- 管理后台 `租赁通道` 列表行新增用户、订单、商品、API Key、用量和反代请求直达操作。
- `租赁详情` 顶部新增打开用户、订单、商品、用量和反代请求操作。
- `租赁详情` 的 API Key 表新增操作列，可打开 API Key 管理。
- `租赁详情` 的最近用量新增操作列，可打开用量、反代请求和结算。
- `租赁详情` 的最近反代请求新增操作列，可打开反代请求、API Key 和用量记录。
- 新增文档：`docs/admin-rental-cross-links.md`。
- `docs/需求文档.md` 新增 `18.148 管理员租赁交付支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check` / `git diff --cached --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=6386643`
  - `deployed_at=20260611T231708Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-DNFSICjS.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-6386643.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/rentals?page=1&pageSize=5`：200。
  - 样本租赁 ID：`38b51a69-935d-4bad-8fd5-ca2aea3fcc65`。
  - 样本用户：`admin@zhisuan.local` / `2154e9ba-76cb-4d8c-bb7f-731fb0fb92c8`。
  - 样本订单：`f8822e5f-fce4-4fd2-b6fe-ac31b2383ba5`。
  - 样本商品：`Codex 标准租赁` / `00000000-0000-0000-0000-000000000101`。
  - 样本 API Key：`5b2f8bdd-7580-49db-980a-c8f6927b84e4` / `zyz_9020e046`。
- `GET /api/admin/rentals/38b51a69-935d-4bad-8fd5-ca2aea3fcc65`：200。
  - hasUser：`true`。
  - hasOrder：`true`。
  - hasProduct：`true`。
  - apiKeys：`1`。
  - usages：`0`。
  - proxyRequestLogs：`0`。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从租赁交付直接进入用户、订单、商品、API Key、用量、反代请求和结算上下文，`售出订单 -> 租赁交付 -> OpenAI/Codex 反代证据` 的排障路径更完整。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 07:26 管理员用量记录横向钻取发布与线上复查

### 发布版本

- `517dc8c feat: add admin usage cross links`

### 本轮修复

- 管理后台 `用量记录` 列表新增 `操作` 列。
- 每条用量可按已有关联 ID 打开用户、订单、租赁、商品、共享资源、反代请求和结算。
- `用量记录` 空列表状态补充占位行，避免只有表头时误判页面未加载。
- 新增文档：`docs/admin-usage-cross-links.md`。
- `docs/需求文档.md` 新增 `18.149 管理员用量记录支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check` / `git diff --cached --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=517dc8c`
  - `deployed_at=20260611T232545Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-Hs-KwDQB.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-517dc8c.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/usages?page=1&pageSize=5`：200。
  - total：`0`。
  - count：`0`。
  - 当前线上没有非 smoke 用量样本，因此本轮线上验证覆盖列表加载与空状态路径；真实行内钻取待产生有效用量后可直接复核。
- `GET /api/admin/proxy-requests?page=1&pageSize=1`：200。
  - total：`14`。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从单条用量串联用户、售出订单、租赁交付、商品、共享资源、反代请求和结算上下文，`余额扣费/分润争议 -> 用量 -> 反代与交付证据` 的排障路径更完整。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 07:33 管理员 API Key 横向钻取发布与线上复查

### 发布版本

- `5bc5f8a feat: add admin api key cross links`

### 本轮修复

- 管理后台 `API Key 管理` 列表行新增用户、订单、租赁、商品、反代请求和用量直达操作。
- 保留既有启用、停用和批量状态操作。
- 新增文档：`docs/admin-api-key-cross-links.md`。
- `docs/需求文档.md` 新增 `18.150 管理员 API Key 支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check` / `git diff --cached --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=5bc5f8a`
  - `deployed_at=20260611T233214Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-BknezHqU.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-5bc5f8a.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/api-keys?page=1&pageSize=5`：200。
  - total：`2`。
  - 样本 API Key ID：`5b2f8bdd-7580-49db-980a-c8f6927b84e4`。
  - 样本 Key 前缀：`zyz_9020e046`。
  - 样本状态：`inactive`。
  - 样本用户：`2154e9ba-76cb-4d8c-bb7f-731fb0fb92c8`。
  - 样本租赁：`38b51a69-935d-4bad-8fd5-ca2aea3fcc65`。
  - 样本订单：`f8822e5f-fce4-4fd2-b6fe-ac31b2383ba5`。
  - 样本商品：`00000000-0000-0000-0000-000000000101`。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从单个 API Key 直接进入用户、售出订单、租赁交付、商品配置、反代请求和用量上下文，`Key -> 本地 OpenAI/Codex 反代证据 -> 售出/用量证据` 的排障路径更完整。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 07:40 管理员结算提现横向钻取发布与线上复查

### 发布版本

- `f444ed0 feat: add admin settlement withdrawal cross links`

### 本轮修复

- 管理后台 `供给方结算` 列表新增用户、共享资源、用量和提现直达操作。
- `提现管理` 列表新增用户、共享资源、用量和结算直达操作。
- `GET /api/admin/withdrawals` 搜索新增支持提现分配 ID 和结算记录 ID。
- 结算和提现空列表补充占位行。
- 新增文档：`docs/admin-settlement-withdrawal-cross-links.md`。
- `docs/需求文档.md` 新增 `18.151 管理员结算提现支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，74/74。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check` / `git diff --cached --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=f444ed0`
  - `deployed_at=20260611T233953Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 生产 Admin 静态产物已更新：
  - `apps/admin/dist/assets/index-Dxl4Ajzs.js`
  - `apps/admin/dist/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-f444ed0.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/settlements?page=1&pageSize=5`：200。
  - total：`0`。
  - count：`0`。
  - 当前线上没有结算样本，因此本轮线上验证覆盖列表加载与空状态路径；真实行内钻取待产生结算后可直接复核。
- `GET /api/admin/withdrawals?page=1&pageSize=5`：200。
  - total：`2`。
  - count：`2`。
  - 样本提现 ID：`f22beffa-407b-40a6-808f-9f108193552d`。
  - 样本供给方：`d801e723-dcea-43bd-bf6d-54009d676309`。
  - 样本供给方用户：`2154e9ba-76cb-4d8c-bb7f-731fb0fb92c8`。
  - 样本状态：`paid`。
  - 样本结算分配数：`0`。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从共享收益尾端的结算和提现记录继续进入供给方用户、共享资源、用量和对应结算/提现上下文，`共享资源 -> 用量 -> 结算 -> 提现` 的排障路径更完整。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 08:52 管理员审计日志横向钻取发布与线上复查

### 发布版本

- `db03314 feat: add admin audit log cross links`

### 本轮修复

- 管理后台 `操作审计` 列表新增 `操作` 列。
- 审计日志可按操作者打开用户详情。
- 按 `objectType/objectId` 直达用户、余额、订单、租赁、API Key、商品、共享资源、结算、提现和 Sub2/OpenAI 反代状态。
- 从审计 `before/after` 载荷派生常见关联入口，覆盖用户、余额、订单、租赁、Key、商品、资源、用量、结算、提现、Sub2 账号和反代请求。
- 对 `product_price` 日志使用 `productId` 打开商品配置。
- 对 Sub2 本地反代自检日志解析 `localProxy.proxyRequestLogs[]`，优先打开失败的反代请求记录。
- 新增文档：`docs/admin-audit-log-cross-links.md`。
- `docs/需求文档.md` 新增 `18.152 管理员审计日志支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- 首次使用普通 `git archive HEAD:user` 打包时，远端 shell 脚本出现 CRLF 行尾导致 `set: pipefail` 失败；已清理失败临时包，并改用 `git -c core.autocrlf=false archive HEAD:user` 重新打包部署。
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=db03314`
  - `deployed_at=20260612T005212Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 生产 Admin 静态产物已更新：
  - `/assets/index-CJj4MnIb.js`
  - `/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-db03314.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/audit-logs?page=1&pageSize=5`：200。
  - itemCount：`5`。
  - 最新样本 action：`auth.login.success`。
  - 最新样本 objectType：`auth`。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=db03314`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从审计日志直接串联操作者、用户、余额、售出订单、租赁、API Key、共享资源、Sub2 状态、反代请求、用量、结算和提现上下文，`系统健康/审计 -> 具体对象 -> 修复入口` 的排障路径更完整。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 09:06 管理员商品售出横向钻取发布与线上复查

### 发布版本

- `d45d57f feat: add admin product sales cross links`

### 本轮修复

- `GET /api/admin/orders` 支持按订单项商品 ID、价格 ID、嵌套商品 ID 和商品名搜索。
- `GET /api/admin/sales` 支持按订单项商品 ID、价格 ID、嵌套商品 ID 和租赁商品 ID 搜索。
- `GET /api/admin/rentals` 支持按租赁商品 ID、嵌套商品 ID、订单项商品 ID 和价格 ID 搜索。
- `GET /api/admin/usages` 支持按租赁商品 ID、嵌套商品 ID、订单项商品 ID 和价格 ID 搜索。
- `GET /api/admin/proxy-requests` 支持按租赁订单 ID、租赁商品 ID、嵌套商品 ID、订单项商品 ID 和价格 ID 搜索。
- 管理后台 `商品与价格` 页在商品和价格行增加售出、订单、租赁、用量、反代横向入口。
- 管理后台 `销售概览` 的商品排行增加商品、售出、订单、租赁、用量入口。
- 新增文档：`docs/admin-product-sales-cross-links.md`。
- `docs/需求文档.md` 新增 `18.153 管理员商品售出支持横向钻取`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，74/74。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=d45d57f`
  - `deployed_at=20260612T010616Z`
- 发布脚本使用 `git -c core.autocrlf=false archive HEAD:user` 打包，避免 shell 脚本 CRLF 行尾问题。
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：74/74 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 生产 Admin 静态产物已更新：
  - `/assets/index-C8YdECXV.js`
  - `/assets/index-Dwk4HozA.css`
- `/tmp/sub2share-user-d45d57f.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=d45d57f`
- 样本商品：
  - productId：`00000000-0000-0000-0000-000000000101`
  - name：`Codex 标准租赁`
  - priceId：`d231fcef-2dc6-4317-b44e-a93cad3ab0ea`
  - orderCount：`9`
  - rentalCount：`9`
- 按商品 ID 搜索：
  - `GET /api/admin/sales?...q=00000000-0000-0000-0000-000000000101`：200，total `1`。
  - `GET /api/admin/orders?...q=00000000-0000-0000-0000-000000000101`：200，total `1`。
  - `GET /api/admin/rentals?...q=00000000-0000-0000-0000-000000000101`：200，total `1`。
  - `GET /api/admin/usages?...q=00000000-0000-0000-0000-000000000101`：200，total `0`。
  - `GET /api/admin/proxy-requests?...q=00000000-0000-0000-0000-000000000101`：200，total `0`。
- 按价格 ID 搜索：
  - `GET /api/admin/sales?...q=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`：200，total `1`。
  - `GET /api/admin/orders?...q=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`：200，total `1`。
  - `GET /api/admin/rentals?...q=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`：200，total `1`。
  - `GET /api/admin/usages?...q=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`：200，total `0`。
  - `GET /api/admin/proxy-requests?...q=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`：200，total `0`。
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

管理员现在可以从商品和价格配置直接进入售出、订单、租赁、用量和反代证据，也可以从销售概览的商品排行反向进入对应上下文。商品 ID 与价格 ID 已经能在线上命中售出、订单和租赁列表；用量和反代请求当前样本为 0，但接口和过滤路径返回正常。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 09:25 OpenAI/Codex 反代 CORS 方法契约发布与线上复查

### 发布版本

- `b548769 feat: align proxy cors methods`
- `13f9105 fix: expose proxy cors methods in health`

### 本轮修复

- API CORS 配置的 `methods` 显式复用本地 `/v1/*` 反代方法集合。
- `inspectApiCorsPolicy()` 摘要新增 `allowedMethods`。
- `GET /api/admin/system-health` 的 `corsPolicy.metrics` 透出 `allowedMethods`。
- 新增 OPTIONS preflight 测试，覆盖 `/v1/responses/:id` 的 `PATCH` 请求。
- 新增文档：`docs/openai-proxy-cors-methods.md`。
- 更新 `docs/api-cors-policy.md`、`docs/openai-proxy-test-coverage.md`、`docs/system-health-check.md` 和 `docs/需求文档.md`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，75/75。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=13f9105`
  - `deployed_at=20260612T012521Z`
- 发布脚本完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - Shared build：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：75/75 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/tmp/sub2share-user-13f9105.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- OPTIONS preflight：
  - URL：`http://192.168.31.26:4100/v1/responses/resp_123`
  - Origin：`http://192.168.31.26:3100`
  - `Access-Control-Request-Method: PATCH`
  - `Access-Control-Request-Headers: authorization, content-type`
  - status：`204`
  - `access-control-allow-origin=http://192.168.31.26:3100`
  - `access-control-allow-methods=GET, HEAD, POST, PUT, PATCH, DELETE`
  - `access-control-allow-headers=authorization, content-type`
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=13f9105`
  - `corsPolicy.status=ok`
  - `corsPolicy.metrics.allowedMethods=GET,HEAD,POST,PUT,PATCH,DELETE`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

浏览器端 OpenAI/Codex 兼容客户端现在可以用与本地 `/v1/*` 反代一致的方法集合完成 CORS 预检，`PATCH /v1/responses/:id` 等非 POST 场景不会在进入本地鉴权、余额、租赁、限流和 Sub2API 转发链路前被 CORS 默认值阻断。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 09:37 Sub2 用量同步恢复计数持久化发布与线上复查

### 发布版本

- `7455ce3 feat: persist billing sync recovery counts`

### 本轮修复

- 新增 Prisma migration：`0016_billing_sync_recovered_counts`。
- `BillingSyncRun` 新增 `recovered` 字段。
- `BillingSyncState` 新增 `lastRecovered` 字段。
- `syncSub2UsageOnce(cursor, { persistCursor: true })` 成功后持久化本批次恢复数量和最近恢复数量。
- `GET /api/admin/usages/sync-state` 返回 `recovered` / `lastRecovered`。
- `GET /api/admin/system-health` 的 `billingSync.metrics` 新增 `lastRecovered`。
- Admin `用量记录` 页面同步状态面板展示 `导入 / 恢复 / 跳过 / 未匹配`。
- 新增文档：`docs/billing-sync-recovered-counts.md`。
- 更新 `docs/billing-sync-state.md`、`docs/pending-usage-recovery.md`、`docs/system-health-check.md` 和 `docs/需求文档.md`。

### 本地验证

- `pnpm.cmd db:generate`：通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，75/75。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=7455ce3`
  - `deployed_at=20260612T013728Z`
- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 成功应用 `0016_billing_sync_recovered_counts`。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：75/75 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/tmp/sub2share-user-7455ce3.tar` 与提取目录已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/usages/sync-state`：200。
  - `state.id=sub2_usage`
  - `state.lastStatus=success`
  - `state.lastImported=0`
  - `state.lastRecovered=0`
  - `state.lastSkipped=0`
  - `state.lastUnmatched=0`
  - `runs[0].recovered=0`
  - `runCount=10`
- `GET /api/admin/system-health`：
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=7455ce3`
  - `billingSync.status=ok`
  - `billingSync.metrics.lastRecovered=0`
- 仍非 OK 检查：
  - `payments` warning：生产环境仍启用 mock 充值。
  - `resources` warning：没有 online production Codex shared resource。
  - `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2` error：`openai_group_has_no_active_accounts`。
  - `localProxySmoke` error：最新 `/v1/responses` smoke 仍失败。

### 结论

Sub2 usage 同步现在能把 pending usage 恢复入账数量长期沉淀到批次和最近状态中。管理员后续排查余额恢复、售出收入和供应商共享结算时，可以区分新导入 usage 与历史 pending usage 恢复，不再只能依赖当次同步 toast。生产服务发布成功，外部入口可用；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 14:20 管理员首页关键巡检项预览发布与线上复查

### 发布信息

- 发布 commit：`7c27560`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=7c27560`
  - `deployed_at=20260612T062007Z`
- 本次能力：管理员首页 `GET /api/admin/dashboard` 返回 `latestSystemHealth.criticalChecks`，Admin 首页直接展示最近巡检的关键阻断/证据项，并提供进入完整可用性巡检的入口。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，76/76。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：76/76 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/opt/zhisuan-yizhan/user.new-*-7c27560` staging 目录已清理。
- `/tmp/sub2share-user-7c27560.tar*` 已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `latestSystemHealth.criticalChecks.length=8`
  - `criticalChecks`：`sub2,localProxySmoke,resourceCredentials,resources,payments,openAiProxyContract,openAiProxyRuntime,proxy`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=7c27560`
  - `sub2.status=error`
  - `localProxySmoke.status=error`

### 结论

管理员现在进入后台首页即可看到最近巡检中的关键问题预览，不需要先打开完整巡检页才能定位 Sub2/OpenAI 上游、资源凭据、本地反代 smoke、共享资源、支付充值或反代运行态风险。当前生产入口与部署状态正常；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 14:29 管理员首页关键巡检直达入口发布与线上复查

### 发布信息

- 发布 commit：`6c9c45e`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=6c9c45e`
  - `deployed_at=20260612T062948Z`
- 本次能力：Admin 首页关键巡检项新增行内操作按钮，可按检查项直接进入反代状态、共享资源、反代请求、售出情况、API Key、用量记录、账务对账等管理入口。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：76/76 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/opt/zhisuan-yizhan/user.new-*-6c9c45e` staging 目录已清理。
- `/tmp/sub2share-user-6c9c45e.tar*` 已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `latestSystemHealth.criticalChecks.length=8`
  - `criticalChecks`：`sub2,localProxySmoke,resourceCredentials,resources,payments,openAiProxyContract,openAiProxyRuntime,proxy`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=6c9c45e`
  - `sub2.status=error`
  - `localProxySmoke.status=error`

### 结论

管理员首页现在不只是展示关键健康问题，还能从每条问题直接进入对应管理入口。对于当前线上 `sub2`、`localProxySmoke`、`resourceCredentials`、`resources`、`payments` 和 `proxy` 等信号，管理员可以更快到达反代状态、共享资源、售出情况和反代请求页面。真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 14:38 管理员首页核心指标直达入口发布与线上复查

### 发布信息

- 发布 commit：`9fa1f27`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=9fa1f27`
  - `deployed_at=20260612T063859Z`
- 本次能力：Admin 首页顶部经营指标和经营摘要数字升级为可点击入口，可直接进入用户、租赁、共享资源、售出、余额、余额流水、结算、提现、订单和用量管理页面。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：76/76 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/opt/zhisuan-yizhan/user.new-*-9fa1f27` staging 目录已清理。
- `/tmp/sub2share-user-9fa1f27.tar*` 已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/dashboard`：200。
  - `users=1`
  - `activeRentals=0`
  - `onlineResources=0`
  - `paidOrderAmount=0`
  - `latestSystemHealth.status=error`
  - `latestSystemHealth.criticalChecks.length=8`
  - `criticalChecks`：`sub2,localProxySmoke,resourceCredentials,resources,payments,openAiProxyContract,openAiProxyRuntime,proxy`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=9fa1f27`

### 结论

管理员首页核心经营指标已经从静态数字升级为运营入口。管理员可以从总览直接进入用户、共享资源、余额、售出、租赁、用量、结算和提现管理面，进一步补齐“完整管理员入口”的操作便利性。真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 14:46 管理员首页指标筛选直达发布与线上复查

### 发布信息

- 发布 commit：`e402d39`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=e402d39`
  - `deployed_at=20260612T064639Z`
- 本次能力：Admin 首页指标入口进一步对齐统计口径，`有效租赁`、`在线资源`、`累计充值`、`累计消费` 和 `待提现` 会带筛选条件打开对应列表。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：76/76 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/opt/zhisuan-yizhan/user.new-*-e402d39` staging 目录已清理。
- `/tmp/sub2share-user-e402d39.tar*` 已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/dashboard`：200。
  - `users=1`
  - `activeRentals=0`
  - `onlineResources=0`
  - `pendingWithdrawals=0`
  - `latestSystemHealth.status=error`
  - `latestSystemHealth.criticalChecks.length=8`
  - `criticalChecks`：`sub2,localProxySmoke,resourceCredentials,resources,payments,openAiProxyContract,openAiProxyRuntime,proxy`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=e402d39`

### 结论

管理员从 dashboard 指标进入列表时，默认能看到与指标统计口径一致的数据集。`active` 租赁、`online` 共享资源、`recharge/consume` 余额流水和 `pending` 提现不再需要二次筛选。真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 15:09 系统巡检 Sub2 绑定问题直达发布与线上复查

### 发布信息

- 发布 commit：`60eff0a`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=60eff0a`
  - `deployed_at=20260612T070941Z`
- 本次能力：`GET /api/admin/system-health` 的 `sub2Bindings` 检查项在存在本地 Sub2Binding 问题时返回 `detail.issues`，Admin 可用性巡检页可复用已有 `rentalId` 直达能力打开受影响租赁。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，77/77。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：77/77 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/opt/zhisuan-yizhan/user.new-*-60eff0a` staging 目录已清理。
- `/tmp/sub2share-user-60eff0a.tar*` 已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/dashboard`：200。
  - `users=1`
  - `activeRentals=0`
  - `onlineResources=0`
  - `pendingWithdrawals=0`
  - `latestSystemHealth.status=error`
  - `latestSystemHealth.criticalChecks.length=8`
  - `criticalChecks`：`sub2,localProxySmoke,resourceCredentials,resources,payments,openAiProxyContract,openAiProxyRuntime,proxy`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=60eff0a`
  - `sub2Bindings.status=ok`
  - `sub2Bindings.metrics.totalIssues=0`
  - `sub2Bindings.detail` 未返回，说明当前没有绑定问题样本噪声。
  - non-ok checks：`payments,resources,resourceCredentials,sub2,localProxySmoke`

### 结论

系统健康页现在能在 Sub2Binding 巡检发现问题时保留具体 issue，管理员可以从统一可用性巡检页直达受影响租赁。当前线上 Sub2Binding 一致性为 ok，没有新增噪声；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 15:34 系统巡检账务对账问题直达发布与线上复查

### 发布信息

- 发布 commit：`5f5c874`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=5f5c874`
  - `deployed_at=20260612T073439Z`
- 本次能力：`GET /api/admin/system-health` 的 `reconciliation` 检查项在存在账务对账问题时返回 `detail.issues`；Admin 可用性巡检页可按 `refType/refId` 直达用量、余额流水、结算、提现或订单管理入口。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，78/78。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：78/78 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/opt/zhisuan-yizhan/user.new-*-5f5c874` staging 目录已清理。
- `/tmp/sub2share-user-5f5c874.tar*` 已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/dashboard`：200。
  - `users=1`
  - `activeRentals=0`
  - `onlineResources=0`
  - `pendingWithdrawals=0`
  - `latestSystemHealth.status=error`
  - `latestSystemHealth.criticalChecks.length=8`
  - `criticalChecks`：`sub2,localProxySmoke,resourceCredentials,resources,payments,openAiProxyContract,openAiProxyRuntime,proxy`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=5f5c874`
  - `reconciliation.status=ok`
  - `reconciliation.metrics.totalIssues=0`
  - `reconciliation.detail` 未返回，说明当前没有账务对账问题样本噪声。
  - non-ok checks：`payments,resources,resourceCredentials,sub2,localProxySmoke`

### 结论

系统健康页现在能在账务对账发现问题时保留具体 issue，管理员可以从统一可用性巡检页直达用量、余额流水、结算、提现或订单管理对象。当前线上账务对账为 ok，没有新增噪声；真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 15:47 系统巡检负余额问题直达发布与线上复查

### 发布信息

- 发布 commit：`cf02dd7`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=cf02dd7`
  - `deployed_at=20260612T074729Z`
- 本次能力：`GET /api/admin/system-health` 的 `wallets` 检查项在发现可用余额或冻结余额为负数时返回 `detail.issues`，Admin 可用性巡检页可直接展示 `walletId`、`walletAccountId`、`userId`、`userEmail`、`availableBalance` 与 `frozenBalance`，并打开异常钱包或用户详情。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，79/79。
- `pnpm.cmd --filter @zyz/admin test`：通过，3/3。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：79/79 通过。
  - Admin tests：3/3 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/opt/zhisuan-yizhan/user.new-*-cf02dd7` staging 目录已清理。
- `/tmp/sub2share-user-cf02dd7.tar*` 已清理，本地归档已清理。

### 线上复查

- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/dashboard`：200。
  - `users=1`
  - `activeRentals=0`
  - `onlineResources=0`
  - `pendingWithdrawals=0`
  - `walletAvailable=999.99`
  - `latestSystemHealth.status=error`
  - `criticalChecks`：`sub2,localProxySmoke,resourceCredentials,resources,payments,openAiProxyContract,openAiProxyRuntime,proxy`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.status=ok`
  - `deploymentRuntime.metrics.commit=cf02dd7`
  - `wallets.status=ok`
  - `wallets.metrics.negativeWallets=0`
  - `wallets.metrics.issueSamples=0`
  - `wallets.detail` 未返回，说明当前没有负余额问题样本噪声。
  - `reconciliation.status=ok`
  - `reconciliation.metrics.totalIssues=0`
  - non-ok checks：`payments,resources,resourceCredentials,sub2,localProxySmoke`

### 结论

系统健康页现在能在负余额发生时保留具体钱包 issue，并让管理员从统一可用性巡检页直达异常余额账户或用户详情。当前线上余额账户巡检为 ok，没有负余额样本；账务对账也为 ok。真实 OpenAI/Codex `/v1/responses` 仍受有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断，需要补齐上游账号凭据后才能完成最终端到端可用性验收。

## 2026-06-12 15:58 系统巡检维修动作摘要发布与线上复查

### 发布信息

- 发布 commit：`2006512`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=2006512`
  - `deployed_at=20260612T075833Z`
- 本次能力：Admin 可用性巡检的问题样本与候选样本摘要会显式展示 `repairAction`，当前 Sub2/OpenAI 账号修复链路会显示 `apply_openai_refresh_token_to_sub2_account`。

### 本地验证

- `pnpm.cmd --filter @zyz/shared run build`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，4/4。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：79/79 通过。
  - Admin tests：4/4 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/tmp/sub2share-user-2006512.tar*` 已清理，本地归档已清理。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=2006512`
  - `resourceCredentials.detail.issues[0].repairAction=apply_openai_refresh_token_to_sub2_account`
  - `sub2.detail.issues[0].repairAction=apply_openai_refresh_token_to_sub2_account`
  - `resources.detail.issues[0].repairAction=apply_openai_refresh_token_to_sub2_account`
  - `localProxySmoke.detail.issues[0].repairAction=apply_openai_refresh_token_to_sub2_account`
  - `localProxySmoke.detail.issues[0].requestId=c3c3450f-5b06-4c72-aad4-449af98b6beb`

### 结论

管理员现在能在统一巡检页的问题摘要中直接看到推荐维修动作，不必只从 actionHint 文案推断。当前线上四个与 OpenAI/Codex 可用性相关的问题样本已经统一指向 `apply_openai_refresh_token_to_sub2_account`，下一步仍需要提供有效 OpenAI refresh token 或 active Sub2 OpenAI 账号，才能让真实 `/v1/responses` smoke 通过。

## 2026-06-12 16:18 管理员首页关键巡检项维修摘要发布与线上复查

### 发布信息

- 发布 commit：`22341a4`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=22341a4`
  - `deployed_at=20260612T081848Z`
- 本次能力：`GET /api/admin/dashboard` 的 `latestSystemHealth.criticalChecks[]` 返回 `primaryIssue` 与 `primarySample` 轻量摘要，Admin 首页关键巡检项可直接展示 `repairAction`、Sub2 账号、资源范围、供应方和失败请求定位字段。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：通过，5/5。
- `pnpm.cmd --filter @zyz/admin test`：通过，4/4。
- `pnpm.cmd --filter @zyz/api test`：通过，79/79。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：79/79 通过。
  - Admin tests：4/4 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/tmp/sub2share-user-22341a4.tar*` 已清理，本地归档已清理。

### 线上复查

- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `criticalChecks[0].id=sub2`
  - `criticalChecks[0].primaryIssue.repairAction=apply_openai_refresh_token_to_sub2_account`
  - `criticalChecks[0].primaryIssue.sub2AccountId=2`
  - `criticalChecks[1].id=localProxySmoke`
  - `criticalChecks[1].primaryIssue.requestId=c3c3450f-5b06-4c72-aad4-449af98b6beb`
  - `criticalChecks[1].primaryIssue.proxyRequestLogId=2732cfa3-9df0-4488-96e2-c5a14df5d9fc`
  - `criticalChecks[2].id=resourceCredentials`
  - `criticalChecks[2].primarySample.sampleType=sub2_account_repair_candidate`
  - `criticalChecks[3].id=resources`
  - `criticalChecks[3].primaryIssue.resourceScope=production`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=22341a4`

### 结论

管理员首页现在不仅能看到关键健康项和跳转入口，还能直接看到首个问题/候选样本的维修动作与定位对象。当前线上首页已明确显示 Sub2 账号 #2 需要执行 `apply_openai_refresh_token_to_sub2_account`，并能看到 `/v1/responses` 失败请求的 request id 与代理日志 id。真实 OpenAI/Codex `/v1/responses` 仍需有效 OpenAI refresh token 或 active Sub2 OpenAI 账号才能最终通过。

## 2026-06-12 16:33 管理员首页关键巡检项上下文跳转发布与线上复查

### 发布信息

- 发布 commit：`d6ea283`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=d6ea283`
  - `deployed_at=20260612T083313Z`
- 本次能力：Admin 首页关键巡检项按钮会读取 `primaryIssue` / `primarySample` 上下文，优先打开目标 Sub2/OpenAI 账号修复入口，其次打开代理请求或带筛选的共享资源列表；dashboard 预览字段补充 `resourceStatus`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：通过，5/5。
- `pnpm.cmd --filter @zyz/admin test`：通过，4/4。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：79/79 通过。
  - Admin tests：4/4 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- `/opt/zhisuan-yizhan/user.new-*` staging 目录已清理。
- `/tmp/sub2share-user-d6ea283.tar*` 已清理，本地归档已清理。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=d6ea283`
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `criticalChecks[0].id=sub2`
  - `criticalChecks[0].primaryIssue.repairAction=apply_openai_refresh_token_to_sub2_account`
  - `criticalChecks[0].primaryIssue.sub2AccountId=2`
  - `criticalChecks[1].id=localProxySmoke`
  - `criticalChecks[1].primaryIssue.repairAction=apply_openai_refresh_token_to_sub2_account`
  - `criticalChecks[1].primaryIssue.sub2AccountId=2`
  - `criticalChecks[1].primaryIssue.requestId=c3c3450f-5b06-4c72-aad4-449af98b6beb`
  - `criticalChecks[1].primaryIssue.proxyRequestLogId=2732cfa3-9df0-4488-96e2-c5a14df5d9fc`
  - `criticalChecks[2].id=resourceCredentials`
  - `criticalChecks[2].primarySample.sampleType=sub2_account_repair_candidate`
  - `criticalChecks[2].primarySample.sub2AccountId=2`
  - `criticalChecks[3].id=resources`
  - `criticalChecks[3].primaryIssue.repairAction=apply_openai_refresh_token_to_sub2_account`
  - `criticalChecks[3].primaryIssue.sub2AccountId=2`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员首页关键巡检按钮现在已经不只是模块级跳转，而是可以带着问题样本上下文进入目标账号、代理请求或资源筛选结果。当前线上仍未恢复真实 OpenAI/Codex `/v1/responses`，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 16:48 Sub2 修复上下文可视化发布与线上复查

### 发布信息

- 发布 commit：`a73a0c2`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=a73a0c2`
  - `deployed_at=20260612T084849Z`
- 本次能力：Admin `反代状态` 页在存在 Sub2 修复上下文时展示 `修复定位` 诊断块，明确来源检查项、推荐维修动作、目标账号、账号/凭据状态、资源、供给方和请求定位；首页和完整巡检页进入反代状态时都会携带更多上下文字段。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，4/4。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：79/79 通过。
  - Admin tests：4/4 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- Admin 静态资源：
  - 当前 bundle：`/assets/index-CXskslL6.js`
  - bundle 包含 `修复定位`：true
  - bundle 包含 `Repair Context`：true
- `/opt/zhisuan-yizhan/user.new-*` staging 目录已清理。
- `/tmp/sub2share-user-a73a0c2.tar*` 已清理，本地归档已清理。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=a73a0c2`
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `criticalChecks[0].id=sub2`
  - `criticalChecks[0].primaryIssue.repairAction=apply_openai_refresh_token_to_sub2_account`
  - `criticalChecks[0].primaryIssue.sub2AccountId=2`
  - `criticalChecks[1].id=localProxySmoke`
  - `criticalChecks[1].primaryIssue.repairAction=apply_openai_refresh_token_to_sub2_account`
  - `criticalChecks[1].primaryIssue.sub2AccountId=2`
  - `criticalChecks[1].primaryIssue.requestId=c3c3450f-5b06-4c72-aad4-449af98b6beb`
  - `criticalChecks[2].id=resourceCredentials`
  - `criticalChecks[2].primarySample.sub2AccountId=2`
  - `criticalChecks[3].id=resources`
  - `criticalChecks[3].primaryIssue.sub2AccountId=2`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员从首页或完整巡检页进入 `反代状态` 后，现在可以在应用 OpenAI refresh token 前看到修复定位上下文，降低目标账号或资源判断错误的风险。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 16:59 Sub2 修复上下文测试覆盖发布与线上复查

### 发布信息

- 发布 commit：`f01df5c`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=f01df5c`
  - `deployed_at=20260612T085900Z`
- 本次能力：将 Admin `反代状态` 页的修复上下文摘要抽为 `sub2-repair-context` helper，并新增 Admin 单元测试锁定来源、维修动作、目标账号、账号/凭据状态、资源、供给方和请求定位字段，避免后续重构丢失关键运维上下文。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，5/5。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma migrate deploy：
  - 识别 16 个 migrations。
  - 无待应用迁移。
- 发布脚本完成：
  - Prisma generate：通过。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：79/79 通过。
  - Admin tests：5/5 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- Admin 静态资源：
  - 当前 bundle：`/assets/index-BKDr7h2L.js`
  - bundle 包含 `修复定位`：true
  - bundle 包含 `Repair Context`：true
- `/opt/zhisuan-yizhan/user.new-*` staging 目录已清理。
- `/tmp/sub2share-user-f01df5c.tar*` 已清理，本地归档已清理。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - ok：`24`
  - warning：`2`
  - error：`3`
  - `deploymentRuntime.metrics.commit=f01df5c`
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `criticalChecks` 数量：`8`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

Sub2/OpenAI 修复入口现在不只具备页面展示，也有 Admin 单元测试锁定关键上下文字段。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 17:28 支付巡检充值流水直达发布与线上复查

### 发布信息

- 发布 commit：`4b4e466`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=4b4e466`
  - `deployed_at=20260612T092759Z`
- 本次能力：管理员首页 `payments` 关键巡检项保留充值流水定位字段；点击时优先打开 `余额流水` 并筛选 `recharge`，再回退到余额管理或售出情况。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：通过，5/5。
- `pnpm.cmd --filter @zyz/admin test`：通过，5/5。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- 第一次发布尝试在 Prisma 输出 `✔` 时被本地 Windows GBK 日志编码打断，远端未切换 release：
  - 当时 marker 仍为 `f01df5c`。
  - 4100、3100、3101 均为 active。
  - 残留 `/opt/zhisuan-yizhan/user.new-20260612T092653Z-4b4e466` staging 目录已按安全路径清理。
- 第二次使用 UTF-8 输出重新执行发布脚本并完成：
  - Prisma generate：通过。
  - Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：79/79 通过。
  - Admin tests：5/5 通过。
  - workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 运行目录与服务：
  - 4100 cwd：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100 cwd：`/opt/zhisuan-yizhan/user`
  - 3101 cwd：`/opt/zhisuan-yizhan/user`
  - `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。
- Admin 静态资源：
  - 当前 bundle：`/assets/index-Dddl1WV3.js`
  - bundle 包含 `打开充值流水`：true
  - bundle 包含 `walletTransactionType`：true
- `/opt/zhisuan-yizhan/user.new-*` staging 目录已清理。
- `/tmp/sub2share-user-4b4e466.tar*` 已由发布脚本清理，本地归档已清理。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - `deploymentRuntime.metrics.commit=4b4e466`
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `criticalChecks`：`sub2`、`localProxySmoke`、`resourceCredentials`、`resources`、`payments`、`openAiProxyContract`、`openAiProxyRuntime`、`proxy`
  - `payments.primaryIssue.id=production_mock_recharge`
  - `payments.primaryIssue.walletTransactionList=true`
  - `payments.primaryIssue.walletTransactionType=recharge`
  - `payments.primaryIssue.walletList=true`
  - `payments.primaryIssue.salesList=true`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员首页现在可以把支付充值 warning 从总览页直接带到充值余额流水，减少 mock/disabled 支付配置到余额入账复核之间的二次导航。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 17:40 Smoke 失败诊断穿透发布与线上复查

### 发布信息

- 发布 commit：`69b7de6`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=69b7de6`
  - `deployed_at=20260612T094036Z`
- 本次能力：管理员首页和 `反代状态 -> 修复定位` 诊断块现在保留 smoke 失败诊断字段，包括维修建议、失败路径、HTTP 状态码、代理错误码、自检模型和 smoke 分段结果。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：通过，5/5。
- `pnpm.cmd --filter @zyz/admin test`：通过，5/5。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：79/79 通过。
- Admin tests：5/5 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 运行目录与服务：
  - 4100 cwd：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100 cwd：`/opt/zhisuan-yizhan/user`
  - 3101 cwd：`/opt/zhisuan-yizhan/user`
  - `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。
- Admin 静态资源：
  - 当前 bundle：`/assets/index-kLcus68P.js`
  - bundle 包含 `维修建议`：true
  - bundle 包含 `Smoke`：true
  - bundle 包含 `失败请求`：true
  - bundle 包含 `proxyRequestPath`：true
  - bundle 包含 `responsesOk`：true
- `/opt/zhisuan-yizhan/user.new-*` staging 目录已清理。
- `/tmp/sub2share-user-69b7de6.tar*` 已由发布脚本清理，本地归档已清理。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - totalChecks：`29`
  - `deploymentRuntime.metrics.commit=69b7de6`
- `GET /api/admin/dashboard`：200。
  - `criticalChecks`：`sub2`、`localProxySmoke`、`resourceCredentials`、`resources`、`payments`、`openAiProxyContract`、`openAiProxyRuntime`、`proxy`
  - `sub2.primaryIssue.actionHint=Refresh/test existing OpenAI accounts or apply a valid refresh token, then run the local end-to-end proxy smoke test.`
  - `localProxySmoke.primaryIssue.actionHint=Repair the failing stage, then rerun the local end-to-end proxy smoke test.`
  - `localProxySmoke.primaryIssue.proxyRequestPath=/v1/responses`
  - `localProxySmoke.primaryIssue.proxyRequestStatusCode=503`
  - `localProxySmoke.primaryIssue.proxyRequestErrorCode=upstream_http_503`
  - `localProxySmoke.primaryIssue.model=gpt-5.3-codex`
  - `localProxySmoke.primaryIssue.modelsOk=true`
  - `localProxySmoke.primaryIssue.responsesOk=false`
  - `localProxySmoke.primaryIssue.localProxyOk=false`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员从首页或完整巡检页进入 `反代状态` 后，可以在同一个 `修复定位` 诊断块里看到维修建议、目标账号、资源上下文、请求 ID、`/v1/responses`、HTTP 503、`upstream_http_503` 和 smoke 分段结果。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 17:48 Sub2 修复后默认端到端自检发布与线上复查

### 发布信息

- 发布 commit：`889f6a7`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=889f6a7`
  - `deployed_at=20260612T094843Z`
- 本次能力：当管理员从 `localProxySmoke`、`responsesOk=false`、`localProxyOk=false` 或失败请求上下文进入 `反代状态` 并应用 OpenAI refresh token 时，表单默认勾选 `应用后端到端自检`，并预填上一次 smoke 使用的模型。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，6/6。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：79/79 通过。
- Admin tests：6/6 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 运行目录与服务：
  - 4100 cwd：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100 cwd：`/opt/zhisuan-yizhan/user`
  - 3101 cwd：`/opt/zhisuan-yizhan/user`
  - `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。
- Admin 静态资源：
  - 当前 bundle：`/assets/index-B8EJJR_S.js`
  - bundle 包含 `localProxySmoke`、`responsesOk` 和 `runSmokeTest`：true
  - bundle 包含 `smokeModel`：true
- `/opt/zhisuan-yizhan/user.new-*` staging 目录已清理。
- `/tmp/sub2share-user-889f6a7.tar*` 已由发布脚本清理，本地归档已清理。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - `deploymentRuntime.metrics.commit=889f6a7`
- `GET /api/admin/dashboard`：200。
  - `localProxySmoke.primaryIssue.model=gpt-5.3-codex`
  - `localProxySmoke.primaryIssue.responsesOk=false`
  - `localProxySmoke.primaryIssue.localProxyOk=false`
  - `localProxySmoke.primaryIssue.proxyRequestPath=/v1/responses`
  - `localProxySmoke.primaryIssue.proxyRequestStatusCode=503`
  - `localProxySmoke.primaryIssue.proxyRequestErrorCode=upstream_http_503`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员从 smoke 失败上下文应用新 OpenAI refresh token 时，默认会在提交后运行端到端自检并沿用失败时的模型，修复闭环更贴近真实 `/v1/responses` 可用性验证。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 17:59 multipart 模型日志提取发布与线上复查

### 发布信息

- 发布 commit：`45f2d35`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - path：`/opt/zhisuan-yizhan/user/.release-marker`
  - `commit=45f2d35`
  - `deployed_at=20260612T095916Z`
- 本次能力：`ProxyRequestLog.model` 除 JSON 顶层 `model` 外，也能从 multipart/form-data 的 `model` part 提取模型名，便于管理员按模型筛选上传类或混合输入类 Codex/Responses 请求。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：通过，19/19。
- `pnpm.cmd --filter @zyz/api test`：通过，79/79。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：79/79 通过。
- Admin tests：6/6 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://192.168.31.26:4100/health`：200。
  - `GET http://192.168.31.26:4100/ready`：200。
  - `GET http://192.168.31.26:3100/`：200。
  - `GET http://192.168.31.26:3101/`：200。
  - `GET http://192.168.31.26:8080/health`：200。
- 运行目录与服务：
  - 4100 cwd：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100 cwd：`/opt/zhisuan-yizhan/user`
  - 3101 cwd：`/opt/zhisuan-yizhan/user`
  - `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。
- `/opt/zhisuan-yizhan/user.new-*` staging 目录已清理。
- `/tmp/sub2share-user-45f2d35.tar*` 已由发布脚本清理，本地归档已清理。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - `deploymentRuntime.metrics.commit=45f2d35`
  - `openAiProxyContract.status=ok`
  - `openAiProxyContract.metrics.extractsMultipartModelForLogs=true`
  - `openAiProxyContract.metrics.routePath=/v1/*`
  - `openAiProxyContract.metrics.requestBodyMode=raw-buffer`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

本地 OpenAI/Codex 反代继续保持 raw-buffer 原样透传，同时 multipart 请求的模型名也能进入代理请求日志和管理员检索链路。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 18:13 共享资源巡检入口优先发布与线上复查

### 发布信息

- 发布 commit：`50ea35a`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=50ea35a`
  - `deploymentRuntime.metrics.deployedAt=20260612T101159Z`
- 本次能力：Admin 首页 `resources` 关键巡检项优先打开 `共享资源`，并继续带入供应方邮箱、资源类型、资源范围、资源状态和 Sub2 账号作为筛选与创建默认值；`sub2`、`resourceCredentials`、`localProxySmoke` 仍优先进入反代维修入口。

### 本地验证

- `pnpm.cmd --filter @zyz/admin test`：通过，6/6。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：79/79 通过。
- Admin tests：6/6 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://127.0.0.1:4100/health`：200。
  - `GET http://127.0.0.1:4100/ready`：200。
  - `GET http://127.0.0.1:3100/`：200。
  - `GET http://127.0.0.1:3101/`：200。
  - `GET http://127.0.0.1:8080/health`：200。
- 运行目录与服务：
  - 4100 cwd：`/opt/zhisuan-yizhan/user/apps/api`
  - 3100 cwd：`/opt/zhisuan-yizhan/user`
  - 3101 cwd：`/opt/zhisuan-yizhan/user`
  - `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `deploymentRuntime.status=ok`
  - `deploymentRuntime.metrics.commit=50ea35a`
  - `adminCapabilities.status=ok`，65/65 路由已注册。
  - `adminSurfaceCoverage.status=ok`，5/5 核心入口已覆盖。
  - `openAiProxyContract.status=ok`，`routePath=/v1/*`，`requestBodyMode=raw-buffer`，`extractsMultipartModelForLogs=true`。
- `GET /api/admin/dashboard`：200。
  - `criticalChecks` 仍为：`sub2`、`localProxySmoke`、`resourceCredentials`、`resources`、`payments`、`openAiProxyContract`、`openAiProxyRuntime`、`proxy`。
  - `resources.primaryIssue.resourceType=codex`
  - `resources.primaryIssue.resourceScope=production`
  - `resources.primaryIssue.sub2AccountId=2`
  - `resources.primaryIssue.repairAction=apply_openai_refresh_token_to_sub2_account`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员首页现在会把“没有线上 Codex 共享资源”的 `resources` warning 直接带到共享资源管理入口，而不是先进入反代状态页；这更贴近“共享情况”管理闭环。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 18:21 非 JSON 模型日志提取发布与线上复查

### 发布信息

- 发布 commit：`231a260`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=231a260`
  - `deploymentRuntime.metrics.deployedAt=20260612T102112Z`
- 本次能力：`ProxyRequestLog.model` 在 JSON 顶层字段和 multipart `model` part 之外，继续支持从 `application/x-www-form-urlencoded` 请求体、URL query `model` 参数和 `/v1/models/:model` 路径提取模型名。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：通过，19/19。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，79/79。
- `pnpm.cmd build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：79/79 通过。
- Admin tests：6/6 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://127.0.0.1:4100/health`：200。
  - `GET http://127.0.0.1:4100/ready`：200。
  - `GET http://127.0.0.1:3100/`：200。
  - `GET http://127.0.0.1:3101/`：200。
  - `GET http://127.0.0.1:8080/health`：200。
- `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `deploymentRuntime.status=ok`
  - `deploymentRuntime.metrics.commit=231a260`
  - `openAiProxyContract.status=ok`
  - `openAiProxyContract.metrics.extractsMultipartModelForLogs=true`
  - `openAiProxyContract.metrics.extractsFormUrlEncodedModelForLogs=true`
  - `openAiProxyContract.metrics.extractsUrlModelForLogs=true`
  - `openAiProxyContract.metrics.routePath=/v1/*`
  - `openAiProxyContract.metrics.requestBodyMode=raw-buffer`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

本地 OpenAI/Codex 反代日志现在能覆盖 JSON、multipart、form-urlencoded、query 和模型元数据路径中的模型名，管理员排查兼容客户端和模型元数据请求时可以继续按模型聚合。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 18:32 共享资源修复默认应用与自检发布复查

### 发布信息

- 发布 commit：`179a87c`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=179a87c`
  - `deploymentRuntime.metrics.deployedAt=20260612T103237Z`
- 本次能力：管理员从 `resources` 巡检 warning 进入共享资源修复创建表单时，会继承生产 Codex 资源、Sub2 账号、修复动作和 smoke 失败上下文；满足 OpenAI refresh token 应用场景时默认勾选 `创建后应用到 Sub2` 和 `应用后端到端自检`，并沿用失败 smoke 的模型作为自检模型默认值。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，7/7。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：79/79 通过。
- Admin tests：7/7 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://127.0.0.1:4100/health`：200。
  - `GET http://127.0.0.1:4100/ready`：200。
  - `GET http://127.0.0.1:3100/`：200。
  - `GET http://127.0.0.1:3101/`：200。
  - `GET http://127.0.0.1:8080/health`：200。
- `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `deploymentRuntime.status=ok`
  - `deploymentRuntime.metrics.commit=179a87c`
  - `deploymentRuntime.metrics.deployedAt=20260612T103237Z`
- `GET /api/admin/dashboard`：200。
  - `resources.primaryIssue.status=warning`
  - `resources.primaryIssue.repairAction=apply_openai_refresh_token_to_sub2_account`
  - `resources.primaryIssue.sub2AccountId=2`
  - `resources.primaryIssue.resourceType=codex`
  - `resources.primaryIssue.resourceScope=production`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

共享资源巡检修复入口已经进一步靠近真实维修动作：管理员补充有效 OpenAI refresh token 后，创建生产 Codex 共享资源会默认同步应用到 Sub2 并立即做端到端自检。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 18:44 OpenAI/Codex 精确 `/v1` 基路径发布与线上复查

### 发布信息

- 发布 commit：`c5ff54d`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=c5ff54d`
  - `deploymentRuntime.metrics.deployedAt=20260612T104251Z`
- 本次能力：本地 OpenAI/Codex 反代从只注册 `/v1/*` 扩展为同时注册 `/v1` 与 `/v1/*`，两个路径共用同一套本地售出 Key 鉴权、余额准入、租赁状态检查、限流、请求日志和 Sub2API 透传逻辑。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：通过，19/19。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，79/79。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd build`：在 `user/` workspace 下通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：79/79 通过。
- Admin tests：7/7 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://127.0.0.1:4100/health`：200。
  - `GET http://127.0.0.1:4100/ready`：200。
  - `GET http://127.0.0.1:3100/`：200。
  - `GET http://127.0.0.1:3101/`：200。
  - `GET http://127.0.0.1:8080/health`：200。
- `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。

### 线上复查

- 无鉴权探测 `GET http://127.0.0.1:4100/v1`：返回 `401 missing_api_key`，响应包含 `x-proxy-request-id`，证明该路径已进入本地 OpenAI/Codex 反代层，而不是 API 404。
- 无鉴权探测 `GET http://127.0.0.1:4100/v1/`：返回 `401 missing_api_key`，响应包含 `x-proxy-request-id`。
- 上述两条探针生成的 `missing_api_key` 反代日志为本次验证数据，复查后已删除，避免污染生产 `proxy` 健康口径。
- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `deploymentRuntime.status=ok`
  - `deploymentRuntime.metrics.commit=c5ff54d`
  - `deploymentRuntime.metrics.deployedAt=20260612T104251Z`
  - `openAiProxyContract.status=ok`
  - `openAiProxyContract.metrics.routePaths=/v1,/v1/*`
  - `openAiProxyContract.metrics.supportsV1BasePath=true`
  - `openAiProxyContract.metrics.routesV1BasePath=true`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

公开 endpoint 对应的精确 `/v1` 基路径现在也进入本地 OpenAI/Codex 反代门禁和审计链路，补齐了完整 v1 入口覆盖面。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 19:02 Smoke 失败证据过期提示与发布脚本 LF 修复复查

### 发布信息

- 功能 commit：`a7e0660`
- 发布链路修复 commit：`5e3bb20`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=5e3bb20`
  - `deploymentRuntime.metrics.deployedAt=20260612T110230Z`
- 本次能力：
  - `localProxySmoke` 失败问题新增结构化 `stale` 字段。
  - 失败 smoke 证据超过 freshness 窗口时，`message` 和 `actionHint` 会提示管理员修复后重新运行端到端自检刷新当前 `/v1/responses` 证据。
  - Admin 首页关键巡检预览和 `反代状态 -> 修复定位` 会展示 stale 证据上下文。
  - 新增 `.gitattributes` 与 `user/.gitattributes`，确保发布子树中的 shell 脚本使用 LF 行尾，避免 `deploy-production.sh` 在 Linux 上因 CRLF 的 `pipefail\r` 失败。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-local-proxy-smoke-health.test.ts tests/admin-capabilities.test.ts`：通过，12/12。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，80/80。
- `pnpm.cmd --filter @zyz/admin test`：通过，7/7。
- `pnpm.cmd build`：在 `user/` workspace 下通过。
- `git archive HEAD:user` 生成的 `scripts/deploy-production.sh`：`crlf=0`，`cr=0`，`lf=379`。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- 首次执行 `a7e0660` 发布包时，旧 release 中的部署脚本因 CRLF 行尾报错：`set: pipefail\r: invalid option name`。
- 已临时规范服务器当前部署脚本为 LF 后重跑发布。
- `a7e0660` 发布验证通过：
  - API tests：80/80 通过。
  - Admin tests：7/7 通过。
  - workspace build：通过。
- 为避免后续发布再次遇到同类问题，追加 `5e3bb20` 并重新部署。
- `5e3bb20` 发布验证通过：
  - Prisma generate：通过。
  - Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：80/80 通过。
  - Admin tests：7/7 通过。
  - workspace build：通过。
  - HTTP 探针：
    - `GET http://127.0.0.1:4100/health`：200。
    - `GET http://127.0.0.1:4100/ready`：200。
    - `GET http://127.0.0.1:3100/`：200。
    - `GET http://127.0.0.1:3101/`：200。
    - `GET http://127.0.0.1:8080/health`：200。
- `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。
- 当前 release 的 `scripts/deploy-production.sh` 行尾：`crlf=0`，`cr=0`，`lf=379`。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `deploymentRuntime.status=ok`
  - `deploymentRuntime.metrics.commit=5e3bb20`
  - `deploymentRuntime.metrics.deployedAt=20260612T110230Z`
  - `openAiProxyContract.status=ok`
  - `openAiProxyContract.metrics.routePaths=/v1,/v1/*`
  - `localProxySmoke.status=error`
  - `localProxySmoke.detail.latest.stale=false`
  - `localProxySmoke.detail.issues[0].stale=false`
  - `localProxySmoke.detail.issues[0].ageMinutes=891`
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.criticalChecks[].id=localProxySmoke`
  - `localProxySmoke.primaryIssue.stale=false`
  - `localProxySmoke.primaryIssue.proxyRequestPath=/v1/responses`
  - `localProxySmoke.primaryIssue.proxyRequestStatusCode=503`
  - `localProxySmoke.primaryIssue.proxyRequestErrorCode=upstream_http_503`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员现在能在系统巡检、首页关键巡检和反代修复上下文中看到 smoke 证据是否过期；当失败证据超过 freshness 窗口时，会明确提示修复后重新运行端到端自检刷新 `/v1/responses` live 证据。发布链路本身也已修复 shell 脚本 LF 行尾问题。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 19:16 巡检候选样本管理入口补齐部署复查

### 发布信息

- 功能 commit：`8159ab9`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=8159ab9`
  - `deploymentRuntime.metrics.deployedAt=20260612T111652Z`
- 本次能力：
  - `可用性巡检 -> 巡检候选样本` 支持打开反代请求、共享资源、Sub2/OpenAI 反代状态、用户、订单、租赁、钱包、售出、API Key、用量、商品、结算、提现和审计日志。
  - 候选样本支持 `refType/refId` 映射到订单、用量、钱包流水、结算和提现入口。
  - 候选样本打开 Sub2/OpenAI 反代状态时会携带请求定位、smoke 分段结果、模型、失败路径、状态码、`ageMinutes` 和 `stale`。
  - 共享摘要字段补齐候选样本常用的请求、订单、租赁、Key、用量、商品、钱包流水、结算、提现、审计和资源定位字段。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，7/7。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：通过，80/80。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd build`：在 `user/` workspace 下通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：80/80 通过。
- Admin tests：7/7 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://127.0.0.1:4100/health`：200。
  - `GET http://127.0.0.1:4100/ready`：200。
  - `GET http://127.0.0.1:3100/`：200。
  - `GET http://127.0.0.1:3101/`：200。
  - `GET http://127.0.0.1:8080/health`：200。
- `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。

### 线上复查

- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `adminSurfaceCoverage.status=ok`
  - `adminSurfaceCoverage.metrics.coveredRequiredAreas=5`
  - `adminSurfaceCoverage.metrics.managedListViews=16`
  - `adminCapabilities.status=ok`
  - `adminCapabilities.metrics.registeredOperations=65`
  - `adminCapabilities.metrics.missingRoutes=0`
  - `resourceCredentials.detail.samples.length=2`
  - `sub2.detail.samples.length=2`
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `latestSystemHealth.summary=24 ok / 2 warning / 3 error`
  - `localProxySmoke.primaryIssue.proxyRequestPath=/v1/responses`
  - `localProxySmoke.primaryIssue.proxyRequestStatusCode=503`
  - `localProxySmoke.primaryIssue.proxyRequestErrorCode=upstream_http_503`
  - `localProxySmoke.primaryIssue.stale=false`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

线上管理员入口继续保持用户、共享、余额、售出和 OpenAI/Codex 反代五个核心范围完整覆盖；巡检候选样本现在也能直接进入对应管理页面，补齐了 `detail.samples` 到实际运营入口的闭环。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 19:56 管理员能力矩阵入口部署复查

### 发布信息

- 功能 commit：`59c8174`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=59c8174`
  - `deploymentRuntime.metrics.deployedAt=20260612T115627Z`
- 本次能力：
  - 管理后台新增 `入口能力` 导航入口，展示用户、共享、余额、售出、OpenAI/Codex 反代和治理六类管理员能力。
  - `/api/admin/capabilities` 的覆盖结果在前端可视化，包含核心范围覆盖、声明操作数、关键操作数、已注册操作数和缺失路由数。
  - 缺失覆盖项会在页面上直接列出；当前线上覆盖完整，无缺失路由。

### 本地验证

- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：通过，7/7。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：通过，5/5。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd build`：在 `user/` workspace 下通过。
- `pnpm.cmd --filter @zyz/api test`：通过，80/80。

### 服务端发布验证

- Prisma generate：通过。
- Prisma migrate deploy：识别 16 个 migrations，无待应用迁移。
- API typecheck：通过。
- Admin typecheck：通过。
- API tests：80/80 通过。
- Admin tests：7/7 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://127.0.0.1:4100/health`：200。
  - `GET http://127.0.0.1:4100/ready`：200。
  - `GET http://127.0.0.1:3100/`：200。
  - `GET http://127.0.0.1:3101/`：200。
  - `GET http://127.0.0.1:8080/health`：200。
- `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。

### 线上复查

- `GET /api/admin/capabilities`：200。
  - `coverage.ok=true`
  - required areas：5/5。
  - total operations：65。
  - critical operations：45。
  - registered operations：65。
  - missing routes：0。
  - areas：`users`、`sharing`、`wallets`、`sales`、`openaiProxy`、`governance`。
- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `adminSurfaceCoverage.status=ok`
  - `adminSurfaceCoverage.metrics.navigationItems=21`
  - `adminSurfaceCoverage.metrics.managedListViews=16`
  - `adminCapabilities.status=ok`
  - `adminCapabilities.metrics.registeredOperations=65`
  - `adminCapabilities.metrics.missingRoutes=0`
- `GET /api/admin/dashboard`：200。
  - `latestSystemHealth.status=error`
  - `latestSystemHealth.summary=24 ok / 2 warning / 3 error`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员后台现在不仅有具体业务管理入口，也能直接查看入口能力矩阵，确认用户、共享、余额、售出和 OpenAI/Codex 反代五个核心范围均已覆盖，全部 65 个声明操作都有后端路由注册。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 20:16 管理员能力矩阵操作直达部署复查

### 发布信息

- 功能 commit：`ddca5fe`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=ddca5fe`
  - `deploymentRuntime.metrics.deployedAt=20260612T121602Z`
- 本次能力：
  - `入口能力` 页面每个能力操作新增对应 Admin 管理入口按钮。
  - 65 个后端声明能力操作均有前端跳转目标，缺失 0，冗余 0。
  - 跳转只打开对应管理页面，不直接执行 POST/PATCH/DELETE 等写操作。

### 本地验证

- `pnpm.cmd --filter @zyz/admin test`：通过，8/8。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- 能力操作映射校验：
  - 后端声明操作：65。
  - 前端跳转目标：65。
  - missing：0。
  - extra：0。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Admin tests：8/8 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://127.0.0.1:4100/health`：200。
  - `GET http://127.0.0.1:4100/ready`：200。
  - `GET http://127.0.0.1:3100/`：200。
  - `GET http://127.0.0.1:3101/`：200。
  - `GET http://127.0.0.1:8080/health`：200。
- `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。
- Admin 构建产物包含 `已打开能力项` 跳转提示，确认新前端 bundle 已上线。

### 线上复查

- `GET /api/admin/capabilities`：200。
  - `coverage.ok=true`
  - required areas：5/5。
  - total operations：65。
  - critical operations：45。
  - registered operations：65。
  - missing routes：0。
  - areas：`users`、`sharing`、`wallets`、`sales`、`openaiProxy`、`governance`。
- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `adminSurfaceCoverage.status=ok`
  - `adminSurfaceCoverage.metrics.navigationItems=21`
  - `adminSurfaceCoverage.metrics.managedListViews=16`
  - `adminCapabilities.status=ok`
  - `adminCapabilities.metrics.registeredOperations=65`
  - `adminCapabilities.metrics.missingRoutes=0`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员现在可以从能力矩阵直接进入用户、共享资源、余额、售出、反代请求、Sub2/OpenAI 反代状态和治理入口；能力矩阵不再只是覆盖证明，也能作为实际管理导航使用。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 20:29 管理员能力入口目标契约化部署复查

### 发布信息

- 功能 commit：`a6050d8`
- GitHub：`main` 已推送到 `github.com:carzygod/sub2share.git`
- release marker：
  - `deploymentRuntime.metrics.commit=a6050d8`
  - `deploymentRuntime.metrics.deployedAt=20260612T122906Z`
- 本次能力：
  - `GET /api/admin/capabilities` 的每个能力操作直接返回 `target.view` 与 `target.label`。
  - `adminCapabilities` 巡检新增 `operationsWithTargets` 与 `missingTargets`。
  - Admin `入口能力` 页面消费后端返回的 `operation.target`，不再维护前端本地映射表。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：通过，6/6。
- `pnpm.cmd --filter @zyz/api test`：通过，81/81。
- `pnpm.cmd --filter @zyz/admin test`：通过，7/7。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd build`：在 `user/` workspace 下通过。
- `git diff --check`：无 whitespace 错误；仅有 Windows LF/CRLF 工作区提示。

### 服务端发布验证

- Admin tests：7/7 通过。
- workspace build：通过。
- HTTP 探针：
  - `GET http://127.0.0.1:4100/health`：200。
  - `GET http://127.0.0.1:4100/ready`：200。
  - `GET http://127.0.0.1:3100/`：200。
  - `GET http://127.0.0.1:3101/`：200。
  - `GET http://127.0.0.1:8080/health`：200。
- `zyz-api.service`、`zyz-web.service`、`zyz-admin.service`：active。

### 线上复查

- `GET /api/admin/capabilities`：200。
  - `coverage.ok=true`
  - required areas：5/5。
  - total operations：65。
  - registered operations：65。
  - missing routes：0。
  - operations with targets：65。
  - missing targets：0。
  - 样例目标：
    - `users.updateRoles -> users / 打开用户`
    - `resources.applyCredential -> resources / 打开共享资源`
    - `wallets.adjust -> wallets / 打开余额`
    - `orders.retryProvision -> orders / 打开订单`
    - `sub2.applyOpenAiRefreshToken -> sub2 / 打开反代状态`
- `GET /api/admin/system-health`：200。
  - status：`error`
  - summary：24 ok / 2 warning / 3 error。
  - `adminCapabilities.status=ok`
  - `adminCapabilities.metrics.registeredOperations=65`
  - `adminCapabilities.metrics.missingRoutes=0`
  - `adminCapabilities.metrics.operationsWithTargets=65`
  - `adminCapabilities.metrics.missingTargets=0`
- 当前 non-ok checks 仍为：`payments`、`resources`、`resourceCredentials`、`sub2`、`localProxySmoke`。

### 结论

管理员入口能力现在由后端能力矩阵统一声明 API 路由和前端入口目标，并由系统巡检同时验证路由与入口目标完整性。真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断继续是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 20:49 生产 mock 充值安全闸发布与线上复查

### 变更

- 发布提交：`55e8898 fix: gate production mock recharge`
- 本次能力：
  - 新增 `ALLOW_PRODUCTION_MOCK_RECHARGE=false` 默认生产安全闸。
  - `POST /api/wallet/recharge` 在生产 `PAYMENT_PROVIDER=mock` 且未显式允许时返回 `503 recharge_unavailable`。
  - `payments.metrics` 新增 `allowProductionMockRecharge`、`rechargeEndpointEnabled`、`productionMockRechargeBlocked`。
  - 生产默认阻断 mock 充值且无近期充值流水时，`payments` 从 warning 收敛为 ok。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/admin-payment-provider-health.test.ts`：通过 5/5。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 87/87。
- `pnpm build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=55e8898`
  - `deployed_at=20260612T124701Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
  - `http://127.0.0.1:8080/health`：200
- 管理员登录：`POST /api/auth/login` 200。

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`25 ok / 1 warning / 3 error`
- `payments`：
  - status：`ok`
  - summary：`生产 mock 充值已禁用`
  - `provider=mock`
  - `allowProductionMockRecharge=false`
  - `rechargeEndpointEnabled=false`
  - `productionMockRechargeBlocked=true`
  - `recentRechargeTransactions=0`
  - `recentRechargeSamples=0`
- 直接调用 `POST /api/wallet/recharge`：
  - HTTP：503
  - error code：`recharge_unavailable`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：生产环境已经默认阻断 mock 充值入账，余额和售出收入不会继续因为公开充值入口写入伪收款流水；管理员系统健康页可以直接看到该阻断状态。完整 OpenAI/Codex 真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 21:04 共享资源创建修复上下文发布与线上复查

### 变更

- 发布提交：`4d212bf feat: show resource repair context in admin`
- 本次能力：
  - Admin `共享资源` 创建表单在由巡检问题打开并带有修复上下文时展示只读诊断条。
  - 诊断条展示来源检查项、推荐修复动作、供给方、资源类型/范围、目标 Sub2 账号、创建后应用凭据、应用后 smoke 和失败请求定位。
  - 新增 `resourceCreateDefaultsContextItems()` 纯 helper 和 Admin 单元测试。

### 本地验证

- `pnpm --filter @zyz/admin test`：通过 8/8。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm --filter @zyz/admin run build`：通过。
- `pnpm build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=4d212bf`
  - `deployed_at=20260612T130318Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
  - `http://127.0.0.1:8080/health`：200
- 当前 Admin bundle 已包含 `Credential apply` 修复上下文字段。

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`25 ok / 1 warning / 3 error`
- `payments` 保持 ok：
  - `rechargeEndpointEnabled=false`
  - `productionMockRechargeBlocked=true`
- `resources` 仍为 warning，但主问题带完整创建上下文：
  - `issue=codex_online_resource_missing`
  - `supplierEmail=admin@zhisuan.local`
  - `resourceType=codex`
  - `resourceScope=production`
  - `sub2AccountId=2`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：管理员现在从 `resources` warning 进入共享资源创建时，可以在表单内直接看到本次修复关联的巡检来源、Sub2 账号和 smoke 失败证据，减少创建生产 Codex 资源时的上下文丢失。真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 21:15 Ready online Codex 资源口径发布与线上复查

### 变更

- 发布提交：`18cf9e1 fix: require ready codex resources in health`
- 本次能力：
  - `resources.metrics` 新增 `readyOnlineCodexResources` 与 `incompleteOnlineCodexResources`。
  - 生产 Codex 资源只有同时满足 `status=online`、绑定 `sub2AccountId`、拥有 active `openai_refresh_token` 资源凭据时，才计入 ready online。
  - 若资源只是被手工标成 online 但缺少 Sub2 账号或 active OpenAI refresh token 凭据，`resources` 仍保持 warning，并返回 `codex_ready_resource_missing` 或 `codex_online_resource_incomplete`。
  - 资源样本新增 `credentialType` 与 `credentialStatus`，便于管理员判断资源不可交付原因。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/admin-supplier-resource-health.test.ts`：通过 6/6。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 88/88。
- `pnpm --filter @zyz/admin test`：通过 8/8。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=18cf9e1`
  - `deployed_at=20260612T131517Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
  - `http://127.0.0.1:8080/health`：200
- 管理员登录：`POST /api/auth/login` 200。

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`25 ok / 1 warning / 3 error`
- `resources`：
  - status：`warning`
  - summary：`No online production Codex shared resource`
  - `totalCodexResources=0`
  - `onlineCodexResources=0`
  - `readyOnlineCodexResources=0`
  - `incompleteOnlineCodexResources=0`
  - `ignoredInternalResources=1`
  - issue：`codex_online_resource_missing`
  - repair candidate：`supplierEmail=admin@zhisuan.local`、`sub2AccountId=2`、`repairAction=apply_openai_refresh_token_to_sub2_account`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online/ready production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：共享资源巡检现在不会被单纯 `status=online` 误导，必须同时看到 Sub2 账号绑定和 active OpenAI refresh token 资源凭据才把 Codex 资源视作 ready。真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 21:25 Codex 共享资源手动上线闸门发布与线上复查

### 变更

- 发布提交：`f5a0137 fix: gate manual codex resource online status`
- 本次能力：
  - 管理员通过 `PATCH /api/admin/resources/:id/status` 手动把 Codex 共享资源切为 `online` 时，后端会校验 Sub2 账号绑定和 active OpenAI refresh token 资源凭据。
  - 不满足条件时返回 `400 codex_resource_not_ready_for_online`，并在 `issues` 中返回 `sub2_account_missing` 或 `active_openai_refresh_token_missing`。
  - 非 Codex 资源和 Codex 非上线状态变更不受该闸门影响。
  - 资源状态审计载荷补充资源凭据摘要，便于追踪上线时的交付前提。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/admin-supplier-resource-health.test.ts`：通过 9/9。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 91/91。
- `pnpm --filter @zyz/admin test`：通过 8/8。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=f5a0137`
  - `deployed_at=20260612T132536Z`
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
  - `http://127.0.0.1:8080/health`：200
- 生产 API dist 已包含 `codex_resource_not_ready_for_online`。
- 管理员登录：`POST /api/auth/login` 200。

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`25 ok / 1 warning / 3 error`
- `resources`：
  - status：`warning`
  - summary：`No online production Codex shared resource`
  - `totalCodexResources=0`
  - `onlineCodexResources=0`
  - `readyOnlineCodexResources=0`
  - `incompleteOnlineCodexResources=0`
  - `ignoredInternalResources=1`
  - issue：`codex_online_resource_missing`
  - repair candidate：`supplierEmail=admin@zhisuan.local`、`sub2AccountId=2`、`repairAction=apply_openai_refresh_token_to_sub2_account`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online/ready production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：管理员现在不能把缺少 Sub2 账号或 active OpenAI refresh token 凭据的 Codex 共享资源手工切为 `online`。写入口保护已经与 ready online 巡检口径对齐；真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 21:35 Codex 共享资源测试自动上线闸门发布与线上复查

### 变更

- 发布提交：`0a7f36c fix: gate codex resource test auto-online`
- 本次能力：
  - `POST /api/admin/resources/:id/test` 在 Sub2 账号测试通过后，只有 ready 的 Codex 资源才会自动切为 `online`。
  - 目标状态为 `online` 时，会校验资源 `sub2AccountId` 与 active `openai_refresh_token` 资源凭据。
  - 不满足条件时保持原状态，并在响应/审计中返回 `statusTransition.blockedOnline=true` 与 `onlineReadiness.issues`。
  - 已存资源凭据应用到 Sub2 后的账号测试、以及从 `反代状态` 直接保存 refresh token 到共享资源后的状态收敛，也复用同一 helper。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/admin-supplier-resource-health.test.ts`：通过 12/12。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 94/94。
- `pnpm --filter @zyz/admin test`：通过 8/8。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=0a7f36c`
  - `deployed_at=20260612T133503Z`
- 部署脚本在服务器侧通过：
  - API typecheck。
  - Admin typecheck。
  - API tests 94/94。
  - Admin tests 8/8。
  - workspace build。
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
  - `http://127.0.0.1:8080/health`：200
- 生产 API dist 已包含 `blockedOnline` 状态转移逻辑。
- 管理员登录：`POST /api/auth/login` 200。

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`25 ok / 1 warning / 3 error`
- `resources`：
  - status：`warning`
  - summary：`No online production Codex shared resource`
  - `totalCodexResources=0`
  - `onlineCodexResources=0`
  - `readyOnlineCodexResources=0`
  - `incompleteOnlineCodexResources=0`
  - `ignoredInternalResources=1`
  - issue：`codex_online_resource_missing`
  - repair candidate：`supplierEmail=admin@zhisuan.local`、`sub2AccountId=2`、`repairAction=apply_openai_refresh_token_to_sub2_account`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online/ready production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：Codex 共享资源现在既不能被手动误切为 `online`，也不能仅凭 Sub2 账号测试通过自动误切为 `online`。测试自动收敛、凭据应用收敛、手动状态变更和系统巡检已经对齐到同一套 ready online 语义；真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 21:43 Codex 共享资源凭据失效降级发布与线上复查

### 变更

- 发布提交：`0393609 fix: demote codex resources when credentials stop being ready`
- 本次能力：
  - `PUT /api/admin/resources/:id/credential` 保存新凭据后，如果在线/忙碌 Codex 资源不再满足 ready 条件，会自动降级为 `abnormal`。
  - `DELETE /api/admin/resources/:id/credential` 删除凭据后，如果在线/忙碌 Codex 资源失去 active `openai_refresh_token`，会自动降级为 `abnormal`。
  - 降级时清空 `lastCheckedAt`，避免旧测试时间继续证明已经失效的交付状态。
  - 凭据 upsert/delete 审计载荷新增 `statusTransition.changed`、`statusTransition.reason=codex_resource_not_ready_after_credential_change` 和 `onlineReadiness.issues`。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/admin-supplier-resource-health.test.ts`：通过 15/15。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 97/97。
- `pnpm --filter @zyz/admin test`：通过 8/8。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=0393609`
  - `deployed_at=20260612T134350Z`
- 部署脚本在服务器侧通过：
  - API typecheck。
  - Admin typecheck。
  - API tests 97/97。
  - Admin tests 8/8。
  - workspace build。
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
  - `http://127.0.0.1:8080/health`：200
- 生产 API dist 已包含 `codex_resource_not_ready_after_credential_change`。
- 管理员登录：`POST /api/auth/login` 200。

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`25 ok / 1 warning / 3 error`
- `resources`：
  - status：`warning`
  - summary：`No online production Codex shared resource`
  - `totalCodexResources=0`
  - `onlineCodexResources=0`
  - `readyOnlineCodexResources=0`
  - `incompleteOnlineCodexResources=0`
  - `ignoredInternalResources=1`
  - issue：`codex_online_resource_missing`
  - repair candidate：`supplierEmail=admin@zhisuan.local`、`sub2AccountId=2`、`repairAction=apply_openai_refresh_token_to_sub2_account`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online/ready production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：Codex 共享资源的 ready 语义现在具备双向约束：进入 online 需要 Sub2 账号与 active OpenAI refresh token，凭据删除/禁用/改型后也会自动退出在线交付状态。真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 21:54 Codex 共享资源创建与配置 ready 闸门发布复查

### 变更

- 发布提交：`5e2459f fix: gate codex resource create and config readiness`
- 本次能力：
  - `POST /api/admin/resources` 创建 Codex 资源并请求初始 `status=online` 时，必须同时提供 `sub2AccountId` 和 active `openai_refresh_token` 初始凭据，否则返回 `400 codex_resource_not_ready_for_online`。
  - 创建资源时若请求 `busy` 等在线交付状态但不满足 ready 条件，会收敛为 `abnormal` 并记录 `statusTransition`。
  - `PATCH /api/admin/resources/:id` 显式把 Codex 资源改为 `online` 时执行同样 ready 校验。
  - 配置修改导致已有 `online` 或 `busy` Codex 资源失去 ready 条件时，资源状态自动收敛为 `abnormal` 并清空 `lastCheckedAt`。
  - readiness 降级原因统一为 `codex_resource_not_ready_after_readiness_change`，覆盖凭据变更和 Sub2 绑定变更。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/admin-supplier-resource-health.test.ts`：通过 17/17。
- `pnpm --filter @zyz/api run typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 99/99。
- `pnpm --filter @zyz/admin test`：通过 8/8。
- `pnpm --filter @zyz/admin run typecheck`：通过。
- `pnpm build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=5e2459f`
  - `deployed_at=20260612T135413Z`
- 部署脚本在服务器侧通过：
  - API typecheck。
  - Admin typecheck。
  - API tests 99/99。
  - Admin tests 8/8。
  - workspace build。
- systemd：
  - `zyz-api.service`：active
  - `zyz-web.service`：active
  - `zyz-admin.service`：active
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
  - `http://127.0.0.1:8080/health`：200
- 生产 API dist 已包含 `codex_resource_not_ready_after_readiness_change`，且创建、配置、凭据路径均调用 `inspectSupplierResourceReadinessMutationStatusTransition`。
- 管理员登录：`POST /api/auth/login` 200。

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`25 ok / 1 warning / 3 error`
- `resources`：
  - status：`warning`
  - summary：`No online production Codex shared resource`
  - `totalCodexResources=0`
  - `onlineCodexResources=0`
  - `readyOnlineCodexResources=0`
  - `incompleteOnlineCodexResources=0`
  - `ignoredInternalResources=1`
  - issue：`codex_online_resource_missing`
  - repair candidate：`supplierEmail=admin@zhisuan.local`、`sub2AccountId=2`、`repairAction=apply_openai_refresh_token_to_sub2_account`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online/ready production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：共享资源创建、配置维护、手动状态变更、资源测试、凭据维护和系统巡检已经对齐到同一套 Codex ready 条件。真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 22:10 Codex 售出交付 ready 资源准入发布复查

### 变更

- 发布提交：`06d8caa fix: gate codex delivery on ready resources`
- 本次能力：
  - 新增 `resource-delivery-readiness` 通用 helper。
  - `POST /api/orders` 在钱包扣款和订单/租赁写入前检查 ready production Codex shared resource。
  - `POST /api/admin/orders/:id/retry-provision` 在订单状态切换、钱包重新扣款和 Sub2 key 创建前检查 ready production Codex shared resource。
  - 租赁 API Key rotation 在创建新 Sub2 key 前检查 ready production Codex shared resource。
  - 没有 ready Codex 资源时返回 `503 codex_resource_not_ready_for_delivery`。
  - 下单与管理员重试的订单状态历史记录匹配到的 `supplierResourceId`，便于售出交付与共享资源审计交叉核查。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/resource-delivery-readiness.test.ts`：通过 4/4。
- `pnpm --filter @zyz/api typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 103/103。
- `pnpm --filter @zyz/api build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=06d8caa`
  - `deployed_at=20260612T140819Z`
- 部署脚本在服务器侧通过：
  - API typecheck。
  - Admin typecheck。
  - API tests 103/103。
  - Admin tests 8/8。
  - workspace build。
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
- 运行时：
  - `deploymentRuntime.status=ok`
  - `deploymentRuntime.summary=当前进程运行在 release 06d8caa`
  - `runningFromReplacedRelease=false`
  - `runningFromStagingRelease=false`

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`25 ok / 1 warning / 3 error`
- 关键 OK 项：
  - `adminCapabilities`：管理员入口覆盖 5/5 个核心管理范围，65/65 operations 均有 route 与 target。
  - `adminSurfaceCoverage`：管理前端入口覆盖 5/5 个核心管理范围。
  - `salesDelivery`：应交付订单未发现交付阻断。
  - `openAiProxyContract`：OpenAI/Codex 本地反代契约正常，覆盖 `/v1` 和 `/v1/*`。
  - `openAiProxyRuntime`：生产环境使用 Redis limiter，当前 Redis 可达。
  - `payments`：生产 mock 充值已禁用。
  - `reconciliation`：账务对账未发现问题。
- `resources`：
  - status：`warning`
  - summary：`No online production Codex shared resource`
  - `totalCodexResources=0`
  - `onlineCodexResources=0`
  - `readyOnlineCodexResources=0`
  - `ignoredInternalResources=1`
  - issue：`codex_online_resource_missing`
  - repair candidate：`supplierEmail=admin@zhisuan.local`、`sub2AccountId=2`、`repairAction=apply_openai_refresh_token_to_sub2_account`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online/ready production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：售出交付入口现在不会在缺少 ready Codex 资源时继续创建不可用租赁；管理员入口、售出交付巡检、反代契约、运行态限流、账务和支付安全项均已通过线上复查。真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 22:18 商品目录交付资源 readiness 巡检发布复查

### 变更

- 发布提交：`a1d88eb fix: surface codex catalog delivery readiness`
- 本次能力：
  - `productCatalog` 巡检新增 `readyCodexDeliveryResources` 与 `codexProductsWithoutReadyDeliveryResources`。
  - active Codex 商品存在可购买价格但没有 ready production Codex shared resource 时，`productCatalog.status=warning`。
  - 新增 issue type：`active_codex_product_without_ready_delivery_resource`。
  - issue 携带共享资源修复入口字段：`resourceType=codex`、`resourceList=true`、`resourceScope=production`、`resourceStatus=online`、`repairAction=apply_openai_refresh_token_to_sub2_account`。
  - 商品目录巡检与下单交付闸门 `codex_resource_not_ready_for_delivery` 对齐，管理员能在用户购买失败前看到商品可售但资源不可交付的风险。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/resource-delivery-readiness.test.ts`：通过 6/6。
- `pnpm --filter @zyz/api typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 105/105。
- `pnpm --filter @zyz/api build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=a1d88eb`
  - `deployed_at=20260612T141802Z`
- 部署脚本在服务器侧通过：
  - API typecheck。
  - Admin typecheck。
  - API tests 105/105。
  - Admin tests 8/8。
  - workspace build。
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
- 运行时：
  - `deploymentRuntime.status=ok`
  - `deploymentRuntime.summary=当前进程运行在 release a1d88eb`
  - `runningFromReplacedRelease=false`
  - `runningFromStagingRelease=false`

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`24 ok / 2 warning / 3 error`
- 新增/变化项：
  - `productCatalog.status=warning`
  - `productCatalog.summary=1 个商品目录可购买性问题`
  - `readyCodexDeliveryResources=0`
  - `codexProductsWithoutReadyDeliveryResources=1`
  - issue：`active_codex_product_without_ready_delivery_resource`
  - product：`Codex 标准租赁`
  - repairAction：`apply_openai_refresh_token_to_sub2_account`
- 仍保持 OK 的关键项：
  - `adminCapabilities`：管理员入口覆盖 5/5 个核心管理范围，65/65 operations 均有 route 与 target。
  - `salesDelivery`：应交付订单未发现交付阻断。
  - `openAiProxyContract`：OpenAI/Codex 本地反代契约正常。

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online/ready production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：系统健康现在能同时暴露“资源池缺 ready Codex 资源”和“仍有 Codex 商品可售但会因交付资源缺失而购买失败”两个风险。真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 22:27 买家商品目录交付状态发布复查

### 变更

- 发布提交：`d02ece8 fix: show buyer catalog delivery readiness`
- 本次能力：
  - `GET /api/products` 为每个商品返回 `deliveryRequired`、`deliveryReady`、`readyDeliveryResources` 和 `deliveryBlockedReason`。
  - Codex 商品复用 ready production Codex shared resource 口径。
  - 没有 ready Codex 资源时，Codex 商品返回 `deliveryReady=false` 与 `deliveryBlockedReason=codex_resource_not_ready_for_delivery`。
  - 买家 Web 套餐页在 `deliveryReady=false` 时展示资源池暂不可交付提示，并禁用开通按钮。
  - 非 Codex 商品不受 Codex ready 资源闸门影响。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/resource-delivery-readiness.test.ts`：通过 8/8。
- `pnpm --filter @zyz/api typecheck`：通过。
- `pnpm --filter @zyz/web typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 107/107。
- `pnpm --filter @zyz/web build`：通过。
- `pnpm --filter @zyz/api build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=d02ece8`
  - `deployed_at=20260612T142658Z`
- 部署脚本在服务器侧通过：
  - API tests 107/107。
  - Admin tests 8/8。
  - workspace build。
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
- `GET /api/products` 线上返回：
  - product：`Codex 标准租赁`
  - `deliveryRequired=true`
  - `deliveryReady=false`
  - `readyDeliveryResources=0`
  - `deliveryBlockedReason=codex_resource_not_ready_for_delivery`

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`24 ok / 2 warning / 3 error`
- `deploymentRuntime`：
  - status：`ok`
  - summary：`当前进程运行在 release d02ece8`
- `productCatalog`：
  - status：`warning`
  - summary：`1 个商品目录可购买性问题`
  - `readyCodexDeliveryResources=0`
  - `codexProductsWithoutReadyDeliveryResources=1`
  - issue：`active_codex_product_without_ready_delivery_resource`

### 仍未完成的真实可用性阻断

- `resources` warning：缺少 online/ready production Codex shared resource。
- `resourceCredentials` error：Sub2 上游无 active 账号，且没有可应用的资源凭据。
- `sub2` error：`openai_group_has_no_active_accounts`。
- `localProxySmoke` error：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：买家侧、公开商品接口、管理员商品目录巡检和下单交付闸门已经共享 ready Codex 资源语义。真实 `/v1/responses` 仍由有效 OpenAI refresh token / active Sub2 OpenAI 账号缺失阻断。

## 2026-06-12 22:38 管理员商品交付状态发布复查

### 变更

- 发布提交：`7b04d84 fix: show admin product delivery readiness`
- 本次能力：
  - `GET /api/admin/products`、`GET /api/admin/products/:id`、`POST /api/admin/products`、`PATCH /api/admin/products/:id` 为商品返回交付状态字段。
  - 管理员商品表新增“交付”列，展示 `active` / `blocked`、ready 资源数量和阻塞原因。
  - 商品 CSV 导出新增 `deliveryReady`、`readyDeliveryResources`、`deliveryBlockedReason`。
  - 新增文档 `docs/admin-product-delivery-readiness.md`，并同步更新需求文档和系统健康说明。

### 本地验证

- `pnpm --filter @zyz/api typecheck`：通过。
- `pnpm --filter @zyz/admin typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 107/107。
- `pnpm --filter @zyz/admin test`：通过 8/8。
- `pnpm --filter @zyz/admin build`：通过。
- `pnpm --filter @zyz/api build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=7b04d84`
  - `deployed_at=20260612T143848Z`
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
- 管理员登录：`POST /api/auth/login` 200。
- `GET /api/admin/products?resourceType=codex&limit=20` 线上返回：
  - product：`Codex 标准租赁`
  - `deliveryRequired=true`
  - `deliveryReady=false`
  - `readyDeliveryResources=0`
  - `deliveryBlockedReason=codex_resource_not_ready_for_delivery`

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`24 ok / 2 warning / 3 error`

### 仍未完成的真实可用性阻断

- 缺少 online/ready production Codex shared resource。
- Sub2 OpenAI group 仍没有 active accounts。
- `/v1/responses` smoke 仍由缺失有效 OpenAI refresh token / active Sub2 OpenAI 账号阻断。

结论：管理员商品管理、买家商品目录、商品目录健康巡检和下单交付闸门已经共享 Codex delivery readiness。真实 OpenAI/Codex 生成仍需要补充有效 OpenAI refresh token 并恢复 Sub2 active 上游账号。

## 2026-06-12 22:52 API 错误响应收敛发布复查

### 变更

- 发布提交：`7dced45 fix: preserve structured api client errors`
- 本次能力：
  - Fastify 框架级 4xx 错误保留原始 HTTP status，不再落入 `500 internal_error`。
  - Zod 参数校验错误统一返回 `400 validation_error`，并携带字段路径和校验 message。
  - `AppError` 的既有 status、code、message 和 details 保持不变。
  - 新增文档 `docs/api-error-handling.md`。

### 本地验证

- `pnpm --filter @zyz/api exec node --import tsx --test tests/api-error-handler.test.ts`：通过 3/3。
- `pnpm --filter @zyz/api typecheck`：通过。
- `pnpm --filter @zyz/api test`：通过 110/110。
- `pnpm --filter @zyz/api build`：通过。
- `git diff --check`：无空白错误，仅 Windows LF/CRLF 提示。

### 部署验证

- release marker：
  - `commit=7dced45`
  - `deployed_at=20260612T145252Z`
- 部署脚本在服务器侧通过：
  - API tests 110/110。
  - Admin tests 8/8。
  - workspace build。
- HTTP：
  - `http://127.0.0.1:4100/health`：200
  - `http://127.0.0.1:4100/ready`：200
  - `http://127.0.0.1:3100/`：200
  - `http://127.0.0.1:3101/`：200
- 空 JSON body 验证：
  - `POST /api/admin/sub2/accounts/2/test`
  - header：`content-type=application/json`
  - body：空
  - 返回：HTTP 400
  - error code：`fst_err_ctp_empty_json_body`
- 正常管理员维修动作验证：
  - `POST /api/admin/sub2/accounts/2/refresh` body `{}`：HTTP 200，业务结果 `ok=false`，错误为 `refresh_token_invalidated` / `OPENAI_OAUTH_TOKEN_REFRESH_FAILED`。
  - `POST /api/admin/sub2/accounts/2/test` body `{}`：HTTP 200，业务结果 `ok=false`，SSE 事件显示 OpenAI `token_invalidated`。

### 线上系统健康

- `GET /api/admin/system-health`：
  - status：`error`
  - summary：`24 ok / 2 warning / 3 error`
- 当前真实阻断未变化：
  - `resourceCredentials`：Sub2 上游无 active 账号，且没有可应用的资源凭据。
  - `sub2`：`openai_group_has_no_active_accounts`。
  - `localProxySmoke`：Latest local OpenAI/Codex smoke test failed at `/v1/responses`。

结论：管理员维修入口现在可以区分请求格式/参数错误与真实 Sub2/OpenAI 上游失效。真实 `/v1/responses` 仍由失效 refresh token 与无 active OpenAI 上游账号阻断，需要管理员提供新的有效 OpenAI refresh token。

## 2026-06-12 23:15 管理员首页商品目录巡检定位发布与线上复查

### 本次发布

- 代码提交：
  - `18857c2 fix: link dashboard product health issues`
  - `bf51e74 fix: prioritize product catalog health previews`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth.criticalChecks[].primaryIssue` 保留 `productId`、`productName` 和 `priceId`。
  - `productCatalog` warning 纳入首页关键巡检优先级，避免被普通 warning 挤出最多 8 条的首页列表。
  - Admin 首页点击带商品定位的 `productCatalog` 巡检项时，会按 `productId`、`priceId`、`productName` 优先级打开商品管理列表。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：8/8 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api build`：通过。
- `pnpm.cmd --filter @zyz/api test`：112/112 通过。
- `pnpm.cmd --filter @zyz/admin test`：8/8 通过。
- `pnpm.cmd --filter @zyz/admin typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-bf51e74.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-bf51e74.tar --commit bf51e74`
- 脚本内验证：
  - API tests：112/112 通过。
  - Admin tests：8/8 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=bf51e74`
  - `deployed_at=20260612T151559Z`

### 线上复查

- 管理员登录：200。
- `GET /api/admin/dashboard`：200。
- `GET /api/admin/system-health`：200。
- `latestSystemHealth.criticalChecks`：
  - `sub2`
  - `localProxySmoke`
  - `resourceCredentials`
  - `resources`
  - `productCatalog`
  - `payments`
  - `openAiProxyContract`
  - `openAiProxyRuntime`
- `productCatalog.primaryIssue`：
  - `type=active_codex_product_without_ready_delivery_resource`
  - `productId=00000000-0000-0000-0000-000000000101`
  - `productName=Codex 标准租赁`
  - `resourceType=codex`
  - `resourceScope=production`
  - `resourceStatus=online`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`
- `GET /api/admin/system-health` summary：`24 ok / 2 warning / 3 error`。

### 剩余真实阻断

- 当前生产服务入口可用，管理员首页已经能直接看到并定位商品目录交付资源风险。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，原因仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号：
  - `sub2`：`openai_group_has_no_active_accounts`
  - `resourceCredentials`：无可应用 active OpenAI credential
  - `localProxySmoke`：最新 `/v1/responses` smoke 失败

## 2026-06-12 23:30 管理员首页商品目录共享资源修复入口发布与线上复查

### 本次发布

- 代码提交：`6807a3a fix: route product health to resource repair`
- 本次能力：
  - `productCatalog` issue 会继承当前 Sub2/OpenAI 修复候选账号字段。
  - `GET /api/admin/dashboard` 的关键巡检预览保留 `resourceList`。
  - Admin 首页商品目录 warning 行除“打开商品”外，新增“打开共享资源”入口。
  - 共享资源入口会带入供给方、资源类型、生产范围、资源状态、目标 Sub2 账号和推荐维修动作。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：9/9 通过。
- `pnpm.cmd --filter @zyz/admin test`：8/8 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin typecheck`：通过。
- `pnpm.cmd --filter @zyz/api build`：通过。
- `pnpm.cmd --filter @zyz/admin build`：通过。
- `pnpm.cmd --filter @zyz/api test`：113/113 通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-6807a3a.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-6807a3a.tar --commit 6807a3a`
- 脚本内验证：
  - API/Admin typecheck：通过。
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=6807a3a`
  - `deployed_at=20260612T153034Z`

### 线上复查

- 管理员登录：200。
- `GET /api/admin/system-health`：200，并写入新快照。
- `GET /api/admin/dashboard`：200。
- dashboard 最新快照：`2026-06-12T15:31:36.274Z`。
- `productCatalog.primaryIssue` 已包含：
  - `sub2AccountId=2`
  - `sub2AccountName=1`
  - `accountStatus=error`
  - `credentialsStatus=configured(3)`
  - `schedulable=false`
  - `resourceList=true`
  - `resourceType=codex`
  - `resourceScope=production`
  - `resourceStatus=online`
  - `supplierEmail=admin@zhisuan.local`
  - `productId=00000000-0000-0000-0000-000000000101`
  - `productName=Codex 标准租赁`

### 剩余真实阻断

- 管理员首页现在可以从商品目录风险同时进入商品确认与共享资源修复路径。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 23:40 共享资源修复商品上下文发布与线上复查

### 本次发布

- 代码提交：`de66026 fix: show product context in resource repair`
- 本次能力：
  - `ResourceCreateDefaults` 新增 `productId`、`productName`、`priceId`。
  - Admin 首页和完整可用性巡检页从 `productCatalog` 点击“打开共享资源”时，会把商品定位带入共享资源创建默认值。
  - 共享资源创建表单的修复诊断条新增 `Product`，用于显示触发风险的商品名、商品 ID 和价格 ID。

### 本地验证

- `pnpm.cmd --filter @zyz/admin test`：9/9 通过。
- `pnpm.cmd --filter @zyz/admin typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin build`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：9/9 通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-de66026.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-de66026.tar --commit de66026`
- 脚本内验证：
  - API/Admin typecheck：通过。
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=de66026`
  - `deployed_at=20260612T153958Z`

### 线上复查

- 管理员登录：200。
- `GET /api/admin/system-health`：200，并写入新快照。
- `GET /api/admin/dashboard`：200。
- dashboard 最新快照：`2026-06-12T15:41:02.954Z`。
- `productCatalog.primaryIssue` 保持：
  - `sub2AccountId=2`
  - `resourceList=true`
  - `resourceType=codex`
  - `resourceScope=production`
  - `supplierEmail=admin@zhisuan.local`
  - `productId=00000000-0000-0000-0000-000000000101`
  - `productName=Codex 标准租赁`
- `GET /api/admin/system-health` summary：`24 ok / 2 warning / 3 error`。

### 剩余真实阻断

- 管理员进入共享资源创建表单后，已能在诊断条中看到触发风险的商品上下文。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-12 23:52 管理员首页巡检快照新鲜度发布与线上复查

### 本次发布

- 代码提交：`0825287 fix: surface dashboard health snapshot freshness`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth` 新增 `ageMinutes`、`stale`、`staleThresholdMinutes`。
  - dashboard 新鲜度阈值为 60 分钟，达到或超过阈值时标记 `stale=true`。
  - Admin 首页 `系统状态` 面板展示巡检相对年龄与快照状态，过期时提示“快照过期”，但不改写原始巡检状态。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：10/10 通过。
- `pnpm.cmd --filter @zyz/admin test`：9/9 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin typecheck`：通过。
- `pnpm.cmd --filter @zyz/api build`：通过。
- `pnpm.cmd --filter @zyz/admin build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-0825287.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-0825287.tar --commit 0825287`
- release marker：
  - `commit=0825287`
  - `deployed_at=20260612T155114Z`
- 部署后基础端点：
  - `/health`：200
  - `/ready`：200
  - Web：200
  - Admin：200

### 线上复查

- 管理员登录：200。
- `GET /api/admin/dashboard`：200。
- dashboard 最新快照：`2026-06-12T15:41:02.954Z`。
- dashboard 新鲜度字段：
  - `ageMinutes=12`
  - `stale=false`
  - `staleThresholdMinutes=60`
- 首页关键巡检项仍包含：
  - `sub2`
  - `localProxySmoke`
  - `resourceCredentials`
  - `resources`
  - `productCatalog`
  - `payments`
  - `openAiProxyContract`
  - `openAiProxyRuntime`

### 剩余真实阻断

- 管理员首页现在可以判断最近巡检快照是否过期，避免把历史巡检误判为当前状态。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 00:01 OpenAI 本地错误 payload 兼容发布与线上复查

### 本次发布

- 代码提交：`3f6f6cf fix: align proxy error payload shape`
- 本次能力：
  - `openAiProxyErrorPayload()` 生成的本地 OpenAI/Codex 反代拦截错误新增 `error.param=null`。
  - `inspectOpenAiProxyContract()` 摘要新增 `localErrorPayloadIncludesParam`。
  - 当本地错误 payload 缺少 `error.param` 时，系统健康会产生 `local_error_param_missing`。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：19/19 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：114/114 通过。
- `pnpm.cmd --filter @zyz/api build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-3f6f6cf.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-3f6f6cf.tar --commit 3f6f6cf`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=3f6f6cf`
  - `deployed_at=20260612T160124Z`

### 线上复查

- `GET /v1/models` 未携带 Bearer Key 时返回：
  - HTTP 401
  - `content-type=application/json; charset=utf-8`
  - `x-proxy-request-id` 已返回
  - `error.message=Missing bearer API key`
  - `error.type=invalid_request_error`
  - `error.param=null`
  - `error.code=missing_api_key`
- 管理员登录：200。
- `GET /api/admin/system-health`：200，并写入新快照。
- `openAiProxyContract.status=ok`。
- `openAiProxyContract.metrics.localErrorPayloadIncludesParam=true`。

### 剩余真实阻断

- 本地 OpenAI/Codex 反代错误结构已进一步对齐 OpenAI 客户端常见格式。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 00:16 反代 request id 搜索契约发布与线上复查

### 本次发布

- 代码提交：`34cca11 fix: normalize upstream request id searches`
- 本次能力：
  - `normalizeProxyRequestLookup()` 支持全部本地和上游 request id 响应头。
  - 新增 `proxyRequestLookupHeaderNames`，覆盖 `x-proxy-request-id`、`x-request-id`、`openai-request-id`、`x-openai-request-id` 和 `request-id`。
  - `openAiProxyContract` 巡检新增 `proxyRequestLookupHeaders` 与 `normalizesProxyRequestLookupHeaders`。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：19/19 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：114/114 通过。
- `pnpm.cmd --filter @zyz/api build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-34cca11.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-34cca11.tar --commit 34cca11`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=34cca11`
  - `deployed_at=20260612T161637Z`

### 线上复查

- `GET /v1/models` 未携带 Bearer Key 时返回 HTTP 401，并生成本地 `x-proxy-request-id=5a7874c2-2992-453c-b399-039ef28994cc`。
- 使用 `GET /api/admin/proxy-requests?q=openai-request-id%3A%205a7874c2-2992-453c-b399-039ef28994cc` 搜索：
  - HTTP 200
  - `total=1`
  - 首条 `requestId=5a7874c2-2992-453c-b399-039ef28994cc`
- `GET /api/admin/system-health`：200，并写入新快照。
- `openAiProxyContract.status=ok`。
- `openAiProxyContract.metrics.proxyRequestLookupHeaders=x-proxy-request-id,x-request-id,openai-request-id,x-openai-request-id,request-id`。
- `openAiProxyContract.metrics.normalizesProxyRequestLookupHeaders=true`。

### 剩余真实阻断

- 管理员现在可以直接粘贴任一种本地或上游 request id 响应头定位反代请求日志。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 00:28 共享资源修复确认商品上下文发布与线上复查

### 本次发布

- 代码提交：`afeba71 fix: include product context in resource repair confirmation`
- 本次能力：
  - `resourceCreateDefaultsProductText()` 统一格式化商品名、商品 ID 和价格 ID。
  - 从 `productCatalog` 风险进入共享资源修复入口后，创建表单诊断条和凭据应用确认弹窗共享同一商品上下文。
  - 勾选 `创建后应用到 Sub2` 时，确认弹窗会展示 `关联商品`，普通共享资源创建不受影响。

### 本地验证

- `pnpm.cmd --filter @zyz/admin test`：10/10 通过。
- `pnpm.cmd --filter @zyz/admin typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-afeba71.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-afeba71.tar --commit afeba71`
- release marker：
  - `commit=afeba71`
  - `deployed_at=20260612T162839Z`
- 部署后验证：
  - `GET /health`：200
  - `GET /ready`：200
  - Admin 首页：200
  - `/opt/zhisuan-yizhan/user/apps/admin/dist/assets` 中已包含 `关联商品` 文案。

### 剩余真实阻断

- 管理员高风险确认前的商品上下文更完整，能降低将 OpenAI refresh token 应用到错误修复对象的风险。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 00:38 商品目录可交付风险价格定位发布与线上复查

### 本次发布

- 代码提交：`5afd9dd fix: include price context in product readiness issues`
- 本次能力：
  - `codexCatalogDeliveryReadinessIssueFields()` 支持携带 `priceId`。
  - `productCatalog` 巡检在发现 active Codex 商品可购买但没有 ready production Codex shared resource 时，会把首个可购买价格 ID 写入 issue。
  - Dashboard 预览、商品管理搜索、共享资源修复默认值、诊断条和凭据应用确认弹窗可以继续复用该价格定位。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/resource-delivery-readiness.test.ts`：8/8 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：114/114 通过。
- `pnpm.cmd --filter @zyz/api build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-5afd9dd.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-5afd9dd.tar --commit 5afd9dd`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=5afd9dd`
  - `deployed_at=20260612T163709Z`

### 线上复查

- `GET /api/admin/system-health`：200，并写入新快照。
- `productCatalog.status=warning`，阻断仍是没有 ready production Codex shared resource。
- `productCatalog.firstIssue.priceId=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`。
- `productCatalog.firstIssue.id=active_codex_product_without_ready_delivery_resource:00000000-0000-0000-0000-000000000101:d231fcef-2dc6-4317-b44e-a93cad3ab0ea`。

### 剩余真实阻断

- 商品目录风险现在可以定位到具体可购买价格档位。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 00:46 Sub2 修复上下文商品价格继承发布与线上复查

### 本次发布

- 代码提交：`c5df9d7 fix: share product context across sub2 repair issues`
- 本次能力：
  - `enrichSub2RepairContextChecks()` 从 `productCatalog` ready delivery 风险提取 `productId`、`productName` 和 `priceId`。
  - `resources`、`resourceCredentials`、`sub2` 和 `localProxySmoke` 等同一 `apply_openai_refresh_token_to_sub2_account` 修复链路会继承商品价格上下文。
  - 已有商品字段不会被覆盖，非 Codex 资源类型不会被强行注入。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：11/11 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：115/115 通过。
- `pnpm.cmd --filter @zyz/api build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：10/10 通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-c5df9d7.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-c5df9d7.tar --commit c5df9d7`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=c5df9d7`
  - `deployed_at=20260612T164525Z`

### 线上复查

- `GET /api/admin/system-health`：200，并写入新快照。
- `productCatalog`、`resources`、`resourceCredentials`、`sub2` 和 `localProxySmoke` 的首条修复 issue 均携带：
  - `productId=00000000-0000-0000-0000-000000000101`
  - `productName=Codex 标准租赁`
  - `priceId=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`
  - `sub2AccountId=2`
  - `repairAction=apply_openai_refresh_token_to_sub2_account`

### 剩余真实阻断

- 管理员从任意相关巡检项进入 Sub2/OpenAI 或共享资源修复时，都能保留同一商品价格定位。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 00:55 浏览器端限流响应头发布与线上复查

### 本次发布

- 代码提交：`332ea9e fix: expose proxy rate limit headers to browsers`
- 本次能力：
  - `openAiProxyCorsExposedHeaders` 新增 `retry-after`、`retry-after-ms` 和常见 `x-ratelimit-*` 响应头。
  - `inspectOpenAiProxyContract()` 摘要新增 `rateLimitHeaders` 与 `corsExposesRateLimitHeaders`。
  - 当 CORS 没有暴露限流/重试头时，`openAiProxyContract` 会产生 `rate_limit_headers_not_exposed` error。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：19/19 通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/api-cors.test.ts`：4/4 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：115/115 通过。
- `pnpm.cmd --filter @zyz/api build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-332ea9e.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-332ea9e.tar --commit 332ea9e`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=332ea9e`
  - `deployed_at=20260612T165433Z`

### 线上复查

- 带 `Origin` 请求 `GET /v1/models` 未携带 Bearer Key 时返回 HTTP 401，并返回 `x-proxy-request-id`。
- `Access-Control-Expose-Headers` 已包含：
  - `x-proxy-request-id`
  - `x-request-id`
  - `openai-request-id`
  - `x-openai-request-id`
  - `request-id`
  - `retry-after`
  - `retry-after-ms`
  - `x-ratelimit-limit-requests`
  - `x-ratelimit-limit-tokens`
  - `x-ratelimit-remaining-requests`
  - `x-ratelimit-remaining-tokens`
  - `x-ratelimit-reset-requests`
  - `x-ratelimit-reset-tokens`
- `GET /api/admin/system-health`：200，并写入新快照。
- `openAiProxyContract.status=ok`。
- `openAiProxyContract.metrics.corsExposesRateLimitHeaders=true`。
- `corsPolicy.status=ok`，`corsPolicy.metrics.exposesHeaders` 同步包含上述限流/重试头。

### 剩余真实阻断

- 浏览器端 OpenAI/Codex 客户端现在可以读取 request id、retry-after 与 rate limit 余量头。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 01:07 本地限流响应头写出发布与线上复查

### 本次发布

- 代码提交：`d2936d3 fix: set local proxy rate limit headers`
- 本次能力：
  - 新增 `openAiProxyRateLimitHeaders()`，统一生成本地 429 限流响应头。
  - 本地 `concurrency_limit_exceeded` 会返回 `retry-after` 与 `retry-after-ms`。
  - 本地 `rpm_limit_exceeded` / `tpm_limit_exceeded` 会返回重试间隔、请求/Token 限制值、剩余额度和 reset 头。
  - 本地 `request_limit_exceeded` 会返回请求量限制与 `x-ratelimit-remaining-requests=0`，不伪造分钟级重试时间。
  - `inspectOpenAiProxyContract()` 新增 `setsLocalRateLimitHeaders`，用于确认本地 429 会实际写出兼容头。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：20/20 通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-limiter-store.test.ts`：5/5 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：116/116 通过。
- `pnpm.cmd --filter @zyz/api build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-d2936d3.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-d2936d3.tar --commit d2936d3`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=d2936d3`
  - `deployed_at=20260612T170727Z`

### 线上复查

- `GET /health`：200。
- `GET /ready`：200。
- Web：200。
- Admin：200。
- 带 `Origin` 请求 `GET /v1/models` 未携带 Bearer Key 时返回 HTTP 401，并返回 `x-proxy-request-id`。
- `Access-Control-Expose-Headers` 包含：
  - `x-proxy-request-id`
  - `x-request-id`
  - `openai-request-id`
  - `x-openai-request-id`
  - `request-id`
  - `retry-after`
  - `retry-after-ms`
  - `x-ratelimit-limit-requests`
  - `x-ratelimit-limit-tokens`
  - `x-ratelimit-remaining-requests`
  - `x-ratelimit-remaining-tokens`
  - `x-ratelimit-reset-requests`
  - `x-ratelimit-reset-tokens`
- `GET /api/admin/system-health`：200，并写入新快照。
- `openAiProxyContract.status=ok`。
- `openAiProxyContract.metrics.setsLocalRateLimitHeaders=true`。
- `openAiProxyContract.metrics.corsExposesRateLimitHeaders=true`。
- `corsPolicy.status=ok`，且 `corsPolicy.metrics.exposesHeaders` 覆盖限流/重试头。

### 剩余真实阻断

- 本地反代自身产生的 429 现在具备浏览器可读、OpenAI/Codex 兼容的限流响应头。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 01:15 巡检详情商品名称发布与线上复查

### 本次发布

- 代码提交：`ebc3c2a fix: show product names in health details`
- 本次能力：
  - `adminSystemHealthIssueRefFields` 新增 `productName`。
  - `adminSystemHealthSampleSummaryFields` 新增 `productName`。
  - 完整可用性巡检页展示 issue ref 和 sample summary 时，会保留商品名、商品 ID 和价格 ID。

### 本地验证

- `pnpm.cmd --filter @zyz/shared build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：10/10 通过。
- `pnpm.cmd --filter @zyz/admin build`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：11/11 通过。
- `pnpm.cmd --filter @zyz/api typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：116/116 通过。
- `pnpm.cmd --filter @zyz/api build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-ebc3c2a.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-ebc3c2a.tar --commit ebc3c2a`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=ebc3c2a`
  - `deployed_at=20260612T171559Z`

### 线上复查

- `GET /health`：200。
- `GET /ready`：200。
- Web：200。
- Admin：200。
- Admin bundle 包含 `productName` 字段。
- `GET /api/admin/system-health` 中以下关键阻断 issue 均携带：
  - `productName=Codex 标准租赁`
  - `productId=00000000-0000-0000-0000-000000000101`
  - `priceId=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`
- 已复查的 check：
  - `productCatalog`
  - `resources`
  - `resourceCredentials`
  - `sub2`
  - `localProxySmoke`

### 剩余真实阻断

- 管理员现在能在完整巡检详情里直接看到受影响商品名，减少只凭 UUID 排障的成本。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 01:25 巡检商品跳转兜底发布与线上复查

### 本次发布

- 代码提交：`985415a fix: use product names for health product lookup`
- 本次能力：
  - 共享包新增 `adminProductLookupCandidate()`。
  - 商品管理页搜索关键词统一按 `productId`、`priceId`、`productName` 选择。
  - Admin 首页关键巡检项和完整 `可用性巡检` issue/sample 行共用同一商品跳转规则。
  - 当线上巡检证据只携带 `productName` 时，行内“打开商品”仍可落到商品列表搜索入口。

### 本地验证

- `pnpm.cmd --filter @zyz/shared run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：11/11 通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：116/116 通过。
- `git diff --check`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-985415a.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-985415a.tar --commit 985415a`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=985415a`
  - `deployed_at=20260612T172522Z`

### 线上复查

- `GET /health`：200。
- `GET /ready`：200。
- Web：200。
- Admin：200。
- 生产源码包含 `adminProductLookupCandidate()`，并已在首页与完整巡检详情中调用。
- 生产环境 helper 实测：
  - 仅有 `productName` 时返回 `Codex`。
  - 同时有 `priceId` 与 `productName` 时优先返回 `price_1`。

### 剩余真实阻断

- 管理员现在能从首页和完整巡检页用商品名兜底打开商品列表，减少跨巡检项复制搜索的人工步骤。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 01:41 本地反代 smoke 阈值发布与线上复查

### 本次发布

- 代码提交：`4ebefff fix: expose local smoke stale threshold`
- 本次能力：
  - `localProxySmoke.detail.latest` 返回 `staleThresholdMinutes`。
  - `localProxySmoke.detail.issues[]` 返回 `staleThresholdMinutes`。
  - `localProxySmoke.summary` 返回 `staleThresholdMinutes`。
  - Dashboard 关键巡检预览、完整巡检 issue/sample 摘要和 `反代状态 -> 修复定位` 继续保留该阈值。

### 本地验证

- `pnpm.cmd --filter @zyz/shared run build`：通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-local-proxy-smoke-health.test.ts tests/admin-capabilities.test.ts`：18/18 通过。
- `pnpm.cmd --filter @zyz/admin test`：11/11 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api test`：116/116 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `git diff --check`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-4ebefff.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-4ebefff.tar --commit 4ebefff`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=4ebefff`
  - `deployed_at=20260612T174157Z`

### 线上复查

- `GET /health`：200。
- `GET /ready`：200。
- Web：200。
- Admin：200。
- `GET /api/admin/system-health`：
  - `status=error`。
  - `localProxySmoke.status=error`。
  - `localProxySmoke.summary=Latest local OpenAI/Codex smoke test failed at /v1/responses.`。
  - `localProxySmoke.metrics.staleThresholdMinutes=1440`。
  - `localProxySmoke.detail.latest.staleThresholdMinutes=1440`。
  - `localProxySmoke.detail.issues[0].staleThresholdMinutes=1440`。
  - 当前线上 issue 证据：`ageMinutes=1289`、`stale=false`。

### 剩余真实阻断

- 管理员现在能看到 smoke 证据年龄和 24 小时阈值，避免把旧但尚未过期的失败证据误判为没有阈值依据。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 01:57 反代请求健康分类发布与线上复查

### 本次发布

- 代码提交：`12ae624 fix: classify proxy health client rejections`
- 本次能力：
  - `proxy` 巡检新增本地准入拒绝分类。
  - `proxy.metrics` 新增 `proxyRecentClientRejections` 与 `proxyRecentActionableClientErrors`。
  - 缺少/无效 Key、余额不足、租赁不可用、请求量/RPM/TPM/并发限流等本地准入拒绝只进入指标，不单独触发 warning。
  - 5xx、本地可用性错误、上游流异常、客户端断开和需复查 4xx 继续进入健康问题样本。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-proxy-health.test.ts`：2/2 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：118/118 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `git diff --check`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-12ae624.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-12ae624.tar --commit 12ae624`
- 脚本内验证：
  - API tests：118/118 通过。
  - Admin tests：11/11 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=12ae624`
  - `deployed_at=20260612T175730Z`

### 线上复查

- `GET /api/admin/system-health`：
  - `status=error`。
  - `summary.totalChecks=29`、`ok=24`、`warning=2`、`error=3`。
  - `proxy.status=ok`。
  - `proxy.summary=1 次请求，0 次 5xx，1 次 4xx，1 次本地准入拒绝，0 次需复查 4xx，0 次客户端断开，0 次上游流异常`。
  - `proxy.metrics.proxyRecentClientRejections=1`。
  - `proxy.metrics.proxyRecentActionableClientErrors=0`。
  - `proxy.metrics.proxyRecentLocalErrors=0`。
  - `proxy.detail.issues` 当前为空。
  - `sub2.status=error`，阻断仍为 `openai_group_has_no_active_accounts`。
  - `localProxySmoke.status=error`，最近 `/v1/responses` smoke 仍失败，`ageMinutes=1305`、`stale=false`、`staleThresholdMinutes=1440`。

### 剩余真实阻断

- 管理员现在不会再因为未带 Key 的公网探测或客户本地准入失败而看到 `proxy` 误报 warning。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 02:10 Sub2 修复账号诊断发布与线上复查

### 本次发布

- 代码提交：`2f3bc56 feat: show sub2 account diagnostics in repair context`
- 本次能力：
  - `反代状态 -> 修复定位` 新增 `账号诊断` 行。
  - 首页关键巡检和完整 `可用性巡检` issue/sample 打开 `反代状态` 时，会携带 `schedulable`、`tempUnschedulableReason`、`updatedAt` 和账号失败 `message`。
  - Dashboard 关键巡检预览保留 `tempUnschedulableReason` 与 `updatedAt`。
  - 账号失败摘要在修复定位中截断到 240 字符，避免上游 JSON 撑开面板。

### 本地验证

- `pnpm.cmd --filter @zyz/admin test`：11/11 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：118/118 通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `git diff --check`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-2f3bc56.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-2f3bc56.tar --commit 2f3bc56`
- 脚本内验证：
  - API/Admin tests：通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=2f3bc56`
  - `deployed_at=20260612T181000Z`

### 线上复查

- `GET /api/admin/system-health`：
  - `status=error`。
  - `summary.totalChecks=29`、`ok=24`、`warning=2`、`error=3`。
  - `sub2.detail.issues[0]` 携带 `sub2AccountId=2`、`sub2AccountName=1`、`accountStatus=error`、`credentialsStatus=configured(3)`、`schedulable=false`。
  - `sub2.detail.samples[0]` 携带 `updatedAt=2026-06-12T22:53:59.925286+08:00` 和 OpenAI `token_invalidated` 失败摘要。
  - `resourceCredentials.detail.samples[0]` 同样携带上述账号诊断字段。
  - `localProxySmoke.detail.issues[0]` 继续携带目标账号、凭据状态和 `/v1/responses` 失败定位。
- Admin bundle：`/opt/zhisuan-yizhan/user/apps/admin/dist/assets/index-CZdc-PA0.js` 已包含 `账号诊断` 文案。

### 剩余真实阻断

- 管理员现在从首页或完整巡检页进入 `反代状态` 后，可以直接看到目标账号不可调度和 token invalidated 摘要，减少返回巡检样本查原因的步骤。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，剩余阻断仍是缺少有效 OpenAI refresh token 或 active Sub2 OpenAI 账号。

## 2026-06-13 02:21 Sub2 主修复问题账号诊断透传发布与线上复查

### 本次发布

- 代码提交：`72c11a0 fix: carry sub2 account diagnostics into repair issues`
- 本次能力：
  - `openai_group_has_no_active_accounts` 主 issue 继承首个可修复账号的 `accountMessage`、`tempUnschedulableReason` 和 `updatedAt`。
  - 主 issue 的 `message` 继续保留聚合阻断摘要，账号级失败原因独立放入 `accountMessage`。
  - Dashboard 关键巡检预览保留 `accountMessage`。
  - Admin 首页、完整巡检 issue 和 sample 打开 `反代状态` 时，账号诊断优先读取 `accountMessage`，旧数据再回退到 `message`。
  - 完整巡检候选样本摘要白名单补齐 `accountMessage`。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-resource-credential-health.test.ts tests/admin-sub2-upstream-health.test.ts`：7/7 通过。
- `pnpm.cmd --filter @zyz/api test`：118/118 通过。
- `pnpm.cmd --filter @zyz/admin test`：11/11 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-72c11a0.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-72c11a0.tar --commit 72c11a0`
- 脚本内验证：
  - API tests：118/118 通过。
  - Admin tests：11/11 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=72c11a0`
  - `deployed_at=20260612T182143Z`

### 线上复查

- 服务状态：
  - `zyz-api.service`、`zyz-web.service`、`zyz-admin.service` 均为 `active`。
  - `http://127.0.0.1:4100/health`、`/ready`、`http://127.0.0.1:3100/`、`http://127.0.0.1:3101/` 均返回 200。
- `GET /api/admin/system-health`：
  - `status=error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `sub2.status=error`，`metrics.gatewayReachable=true`、`ready=false`、`openAiAccounts=2`、`activeOpenAiAccounts=0`。
  - `sub2.detail.issues[0].message=oai #2 has 2 OpenAI account(s), but 0 active account(s).`
  - `sub2.detail.issues[0].accountMessage` 已携带 OpenAI `token_invalidated` 失败摘要。
  - `sub2.detail.issues[0].updatedAt=2026-06-12T22:53:59.925286+08:00`。
  - `localProxySmoke.detail.issues[0]` 已携带同一个 `accountMessage`，并继续定位 `/v1/responses`、HTTP 503、`upstream_http_503`。
  - `resourceCredentials.detail.issues[0]` 与 `resources.detail.issues[0]` 也继承 `accountMessage`，用于共享资源/凭据修复入口。
  - `proxy.status=ok`，最近 1 小时没有需复查代理异常样本。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.criticalChecks` 包含 `sub2`、`localProxySmoke`、`resourceCredentials`、`resources` 等关键项。
  - `sub2.primaryIssue.accountMessage` 已携带 OpenAI `token_invalidated` 失败摘要。
  - `sub2.primaryIssue.message` 仍保留聚合阻断摘要。
  - `localProxySmoke.primaryIssue.accountMessage`、`resourceCredentials.primaryIssue.accountMessage`、`resources.primaryIssue.accountMessage` 均可用于首页进入 `反代状态` 时的账号诊断。

### 剩余真实阻断

- 当前系统内核已经走 Sub2API/OpenAI 分组状态与本地 `/v1/*` 反代健康证据闭环，管理员入口也能直接从首页和完整巡检进入 Sub2 修复、共享资源、余额、售出等管理面。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组中 2 个账号均非 active，现有账号返回 `token_invalidated`。
- 下一步恢复真实可用性仍需要管理员提供有效 OpenAI refresh token，或在 Sub2API 中恢复 active OpenAI 账号，然后重新运行 `反代状态 -> 端到端自检` 验收 `/v1/models` 与 `/v1/responses`。

## 2026-06-13 02:33 Smoke 证据剩余新鲜时间发布与线上复查

### 本次发布

- 代码提交：`29495ca feat: expose smoke evidence freshness remaining`
- 本次能力：
  - `localProxySmoke.summary`、`detail.latest` 和 `detail.issues[]` 新增 `freshMinutesRemaining`。
  - Dashboard 关键巡检预览保留 `freshMinutesRemaining`。
  - 完整巡检 issue ref 与 sample summary 白名单保留 `freshMinutesRemaining`。
  - Admin 从首页、完整巡检 issue 或 sample 打开 `反代状态` 时，会把剩余新鲜时间带入 `修复定位`。
  - `反代状态 -> 修复定位 -> 失败请求` 会在证据尚未过期时显示 `剩余 X 分钟过期`，证据已过期时继续显示 `证据已过期`。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-local-proxy-smoke-health.test.ts tests/admin-capabilities.test.ts`：19/19 通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：119/119 通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-29495ca.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-29495ca.tar --commit 29495ca`
- 脚本内验证：
  - API tests：119/119 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=29495ca`
  - `deployed_at=20260612T183352Z`

### 线上复查

- `GET /api/admin/system-health`：
  - `status=error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `localProxySmoke.status=error`。
  - `localProxySmoke.metrics.ageMinutes=1341`。
  - `localProxySmoke.metrics.stale=false`。
  - `localProxySmoke.metrics.staleThresholdMinutes=1440`。
  - `localProxySmoke.metrics.freshMinutesRemaining=99`。
  - `localProxySmoke.detail.latest.freshMinutesRemaining=99`。
  - `localProxySmoke.detail.issues[0].freshMinutesRemaining=99`。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.criticalChecks` 仍包含 `sub2`、`localProxySmoke`、`resourceCredentials`、`resources`、`productCatalog`、`payments`、`openAiProxyContract` 和 `openAiProxyRuntime`。
  - `localProxySmoke.primaryIssue.freshMinutesRemaining=99`。
  - `sub2.primaryIssue.accountMessage` 仍携带 OpenAI `token_invalidated` 失败摘要。

### 剩余真实阻断

- 管理员现在可以直接看到当前失败 smoke 证据距离 24 小时 freshness 窗口还剩多少分钟，不再需要手工用 `1440-ageMinutes` 计算。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号；恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。

## 2026-06-13 02:54 smoke 证据绝对过期时间发布与线上复查

### 本次发布

- 代码提交：`f7e108b feat: expose smoke evidence expiry time`
- 本次能力：
  - `localProxySmoke.summary`、`detail.latest` 和 `detail.issues[]` 新增 `staleAt`。
  - Dashboard 关键巡检预览保留 `staleAt`。
  - 完整巡检 issue ref 与 sample summary 白名单保留 `staleAt`。
  - `反代状态 -> 修复定位 -> 失败请求` 与共享资源创建表单 `Failure` 项显示 `staleAt <ISO 时间>`。

### 本地验证

- `pnpm.cmd --filter @zyz/api test -- admin-local-proxy-smoke-health.test.ts admin-capabilities.test.ts`：119/119 通过。
- `pnpm.cmd --filter @zyz/admin test -- admin-surfaces.test.ts`：12/12 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-f7e108b.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-f7e108b.tar --commit f7e108b`
- 脚本内验证：
  - API tests：119/119 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=f7e108b`
  - `deployed_at=20260612T185448Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/system-health`：
  - `status=error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `localProxySmoke.metrics.latestAt=2026-06-11T20:13:33.340Z`。
  - `localProxySmoke.metrics.ageMinutes=1362`。
  - `localProxySmoke.metrics.stale=false`。
  - `localProxySmoke.metrics.staleThresholdMinutes=1440`。
  - `localProxySmoke.metrics.freshMinutesRemaining=78`。
  - `localProxySmoke.metrics.staleAt=2026-06-12T20:13:33.340Z`。
  - `localProxySmoke.detail.latest.staleAt=2026-06-12T20:13:33.340Z`。
  - `localProxySmoke.detail.issues[0].staleAt=2026-06-12T20:13:33.340Z`。
- `GET /api/admin/dashboard`：
  - `localProxySmoke.primaryIssue.staleAt=2026-06-12T20:13:33.340Z`。
  - `localProxySmoke.primaryIssue.freshMinutesRemaining=78`。
- Admin bundle：
  - `/opt/zhisuan-yizhan/user/apps/admin/dist/assets/index-B1BcB72R.js` 已包含 `staleAt`。

### 剩余真实阻断

- 管理员现在可以直接看到 `/v1/responses` 失败 smoke 证据的绝对过期时间，不需要再手工换算。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-f7e108b.tar` 与本地 `.deploy/sub2share-user-f7e108b.tar`。

## 2026-06-13 02:42 共享资源修复入口账号诊断发布与线上复查

### 本次发布

- 代码提交：`c05be41 feat: show account diagnostics in resource repair defaults`
- 本次能力：
  - 从首页 `resources` / `productCatalog` 或完整巡检页打开 `共享资源` 时，资源创建默认值会继续保留 Sub2 账号诊断。
  - 共享资源创建诊断条新增 `Account status` 与 `Account diagnostics`。
  - `Sub2 account` 会展示账号 ID 与账号名。
  - `Account diagnostics` 会展示 `schedulable`、临时不可调度原因、账号更新时间和 OpenAI/Sub2 失败摘要。
  - `Failure` 项继续展示 `/v1/responses` 路径、HTTP 状态、代理错误码、证据年龄、过期阈值和剩余新鲜时间。

### 本地验证

- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-c05be41.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-c05be41.tar --commit c05be41`
- 脚本内验证：
  - API tests：119/119 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=c05be41`
  - `deployed_at=20260612T184246Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- Admin bundle：
  - `/opt/zhisuan-yizhan/user/apps/admin/dist/assets/index-DOZ6vzbD.js` 已包含 `Account diagnostics`。

### 剩余真实阻断

- 管理员现在从共享资源创建入口也能看到与 `反代状态` 一致的账号根因，适合当前 `resources` / `productCatalog` 优先打开共享资源的维修路径。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号；恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。

## 2026-06-13 03:07 跨入口 smoke 失败证据继承发布与线上复查

### 本次发布

- 代码提交：`fae09d9 feat: carry smoke evidence into repair issues`
- 本次能力：
  - `productCatalog`、`resources`、`resourceCredentials` 和 `sub2` 的 `apply_openai_refresh_token_to_sub2_account` 修复问题会继承最新 `localProxySmoke` 失败证据。
  - 继承字段包括 `model`、`modelsOk`、`responsesOk`、`localProxyOk`、代理请求 ID、失败路径、HTTP 状态、代理错误码、证据年龄、剩余新鲜时间和 `staleAt`。
  - 原有商品、资源、账号、`message` 与 `actionHint` 不会被覆盖。
  - 管理员从首页、完整可用性巡检、共享资源或反代状态任一相关入口进入修复流程时，都能看到同一条 `/v1/responses` 失败证据。

### 本地验证

- `pnpm.cmd --filter @zyz/api test -- admin-capabilities.test.ts`：120/120 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test -- admin-surfaces.test.ts`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-fae09d9.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-fae09d9.tar --commit fae09d9`
- release marker：
  - `commit=fae09d9`
  - `deployed_at=20260612T190727Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/system-health`：
  - `status=error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `productCatalog.detail.issues[0].proxyRequestPath=/v1/responses`。
  - `resources.detail.issues[0].proxyRequestPath=/v1/responses`。
  - `resourceCredentials.detail.issues[0].proxyRequestPath=/v1/responses`。
  - `sub2.detail.issues[0].proxyRequestPath=/v1/responses`。
  - 上述四个修复问题均携带 `proxyRequestStatusCode=503`、`proxyRequestErrorCode=upstream_http_503`、`responsesOk=false`、`localProxyOk=false`、`freshMinutesRemaining=65` 和 `staleAt=2026-06-12T20:13:33.340Z`。
- `GET /api/admin/dashboard`：
  - `productCatalog.primaryIssue.proxyRequestPath=/v1/responses`。
  - `resources.primaryIssue.proxyRequestPath=/v1/responses`。
  - `resourceCredentials.primaryIssue.proxyRequestPath=/v1/responses`。
  - `sub2.primaryIssue.proxyRequestPath=/v1/responses`。
  - 上述首页关键巡检主问题均携带 `staleAt=2026-06-12T20:13:33.340Z`。

### 剩余真实阻断

- 本次修复已经确认所有相关管理员入口都能看到同一条 `/v1/responses` 失败证据，避免从共享资源或商品入口进入时丢失真实失败阶段。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-fae09d9.tar` 与本地 `.deploy/sub2share-user-fae09d9.tar`。

## 2026-06-13 03:16 共享修复 smoke 审计追溯发布与线上复查

### 本次发布

- 代码提交：`8770a40 feat: link repair smoke evidence to audit logs`
- 本次能力：
  - `productCatalog`、`resources`、`resourceCredentials` 和 `sub2` 的共享修复问题继续继承 `localProxySmoke` 的审计定位。
  - 继承字段新增 `auditLogId`、`auditAction`、`keyDisabled` 和 `proxyRequestLogCount`。
  - 管理员从商品、共享资源、资源凭据或 Sub2 问题看到 `/v1/responses` 失败后，可以继续打开同一条 smoke 审计记录。
  - 原有商品、账号、资源、失败路径、状态码、代理错误码、`message` 和 `actionHint` 均不被覆盖。

### 本地验证

- `pnpm.cmd --filter @zyz/api test -- admin-capabilities.test.ts`：120/120 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test -- admin-surfaces.test.ts`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-8770a40.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-8770a40.tar --commit 8770a40`
- 脚本内验证：
  - API tests：120/120 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=8770a40`
  - `deployed_at=20260612T191614Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/system-health`：
  - `status=error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `productCatalog.detail.issues[0].auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - `resources.detail.issues[0].auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - `resourceCredentials.detail.issues[0].auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - `sub2.detail.issues[0].auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - 上述四个修复问题均携带 `auditAction=admin.sub2.proxy_smoke_test`、`keyDisabled=true`、`proxyRequestLogCount=2`、`proxyRequestPath=/v1/responses`、`proxyRequestStatusCode=503` 和 `proxyRequestErrorCode=upstream_http_503`。
- `GET /api/admin/dashboard`：
  - `productCatalog.primaryIssue.auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - `resources.primaryIssue.auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - `resourceCredentials.primaryIssue.auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - `sub2.primaryIssue.auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。

### 剩余真实阻断

- 所有相关管理员修复入口现在都保留同一条 smoke 证据的失败路径、代理日志和审计日志定位。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-8770a40.tar` 与本地 `.deploy/sub2share-user-8770a40.tar`。

## 2026-06-13 03:24 Sub2 候选样本 smoke 上下文发布与线上复查

### 本次发布

- 代码提交：`1b756a3 feat: carry smoke context into sub2 samples`
- 本次能力：
  - `sub2.detail.samples[]` 中的账号候选样本会被识别为 OpenAI refresh token 修复候选。
  - 候选样本会补齐 `repairAction=apply_openai_refresh_token_to_sub2_account`、`sub2Status=true` 和 `resourceType=codex`。
  - 候选样本会继承最新 `localProxySmoke` 的失败路径、代理请求日志、审计记录、新鲜度和 `staleAt`。
  - 样本原有账号名、账号状态、凭据状态和调度状态不被覆盖。

### 本地验证

- `pnpm.cmd --filter @zyz/api test -- admin-capabilities.test.ts`：120/120 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test -- admin-surfaces.test.ts`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-1b756a3.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-1b756a3.tar --commit 1b756a3`
- 脚本内验证：
  - API tests：120/120 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=1b756a3`
  - `deployed_at=20260612T192416Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/system-health`：
  - `status=error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `sub2.detail.samples[0].repairAction=apply_openai_refresh_token_to_sub2_account`。
  - `sub2.detail.samples[0].sub2Status=true`。
  - `sub2.detail.samples[0].resourceType=codex`。
  - `sub2.detail.samples[0].auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - `sub2.detail.samples[0].proxyRequestPath=/v1/responses`。
  - `sub2.detail.samples[0].proxyRequestStatusCode=503`。
  - `sub2.detail.samples[0].proxyRequestErrorCode=upstream_http_503`。
  - `sub2.detail.samples[0].staleAt=2026-06-12T20:13:33.340Z`。
- `GET /api/admin/dashboard`：
  - `sub2.primarySample.repairAction=apply_openai_refresh_token_to_sub2_account`。
  - `sub2.primarySample.resourceType=codex`。
  - `sub2.primarySample.auditLogId=8f9e6cec-c8fd-458f-b1f7-736b705a2d3a`。
  - `sub2.primarySample.proxyRequestPath=/v1/responses`。
  - `sub2.primarySample.proxyRequestStatusCode=503`。
  - `sub2.primarySample.proxyRequestErrorCode=upstream_http_503`。
  - `sub2.primarySample.staleAt=2026-06-12T20:13:33.340Z`。

### 剩余真实阻断

- Sub2 主问题和候选账号样本现在都保留同一条 `/v1/responses` 失败证据、代理请求日志和审计定位。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-1b756a3.tar` 与本地 `.deploy/sub2share-user-1b756a3.tar`。

## 2026-06-13 03:31 Dashboard smoke 清理字段发布与线上复查

### 本次发布

- 代码提交：`7599857 feat: keep smoke cleanup fields in dashboard`
- 本次能力：
  - Dashboard 关键巡检预览保留 `sub2Status`、`auditAction`、`keyDisabled`、`proxyRequestLogCount`。
  - `primaryIssue` 与 `primarySample` 都保留 smoke 审计动作、临时 Key 清理状态和代理日志数量。
  - 首页摘要与完整 `可用性巡检` 对同一条 smoke 证据保持一致。

### 本地验证

- `pnpm.cmd --filter @zyz/api test -- admin-capabilities.test.ts`：120/120 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test -- admin-surfaces.test.ts`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-7599857.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-7599857.tar --commit 7599857`
- 脚本内验证：
  - API tests：120/120 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=7599857`
  - `deployed_at=20260612T193158Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/dashboard`：
  - `resourceCredentials.primaryIssue.sub2Status=true`。
  - `resourceCredentials.primarySample.sub2Status=true`。
  - `sub2.primaryIssue.sub2Status=true`。
  - `sub2.primarySample.sub2Status=true`。
  - `localProxySmoke.primaryIssue.sub2Status=true`。
  - 上述相关项均携带 `auditAction=admin.sub2.proxy_smoke_test`、`keyDisabled=true`、`proxyRequestLogCount=2`、`proxyRequestPath=/v1/responses`、`proxyRequestStatusCode=503`、`proxyRequestErrorCode=upstream_http_503`。
  - `productCatalog.primaryIssue` 与 `resources.primaryIssue` 也保留 `auditAction`、`keyDisabled` 和 `proxyRequestLogCount`，但不强行写入 `sub2Status`。

### 剩余真实阻断

- 首页关键巡检和完整巡检现在对 smoke 审计、临时 Key 清理、代理日志数量展示一致。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-7599857.tar` 与本地 `.deploy/sub2share-user-7599857.tar`。

## 2026-06-13 03:43 Sub2API path/query 透传契约发布与线上复查

### 本次发布

- 代码提交：`32f9f20 feat: expose sub2 proxy path forwarding contract`
- 本次能力：
  - 本地 OpenAI/Codex 反代新增 `buildSub2ProxyUrl()`，运行代码和测试共用同一套 Sub2API 上游 URL 构造规则。
  - `inspectOpenAiProxyContract()` 新增 `corePathSamples`、`routesCorePathSamples`、`preservesRawPathAndQuery`、`normalizesSub2BaseTrailingSlash`。
  - 核心样例覆盖 `/v1`、`/v1/models`、`/v1/responses`、`/v1/responses/:id/input_items`、`/v1/chat/completions`、`/v1/files`、`/v1/uploads`、`/v1/batches`。
  - 当样例路径无法路由或 Sub2API URL 拼接不能保留原始 path/query 时，系统健康会返回明确契约问题。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：21/21 通过。
- `pnpm.cmd --filter @zyz/api test`：121/121 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-32f9f20.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-32f9f20.tar --commit 32f9f20`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：121/121 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=32f9f20`
  - `deployed_at=20260612T194303Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/system-health`：
  - 系统总状态仍为 `error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `openAiProxyContract.status=ok`。
  - `openAiProxyContract.summary.routesCorePathSamples=true`。
  - `openAiProxyContract.summary.preservesRawPathAndQuery=true`。
  - `openAiProxyContract.summary.normalizesSub2BaseTrailingSlash=true`。
  - `openAiProxyContract.summary.routesResponsesItems=true`。
  - `openAiProxyContract.detail.issues=[]`。

### 剩余真实阻断

- 本地反代契约已经能证明核心 `/v1` 样例路径会进入同一条 Sub2API 转发链路，并保留原始 path/query。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-32f9f20.tar` 与本地 `.deploy/sub2share-user-32f9f20.tar`。

## 2026-06-13 03:50 Dashboard 关键 metrics 发布与线上复查

### 本次发布

- 代码提交：`cb3fe87 feat: surface critical health metrics on dashboard`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth.criticalChecks[]` 新增 `metrics` 预览。
  - 首页关键巡检在没有 issue/sample 上下文时，会展示 metrics 摘要。
  - `openAiProxyContract` 这种 ok 但关键的检查项现在可以在首页展示 Sub2API path/query 透传和核心 `/v1` 样例路径证据。
  - 预览只保留白名单标量字段，嵌套对象不会进入 dashboard 摘要。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：12/12 通过。
- `pnpm.cmd --filter @zyz/api test`：121/121 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-cb3fe87.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-cb3fe87.tar --commit cb3fe87`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：121/121 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=cb3fe87`
  - `deployed_at=20260612T195055Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.status=error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `criticalChecks` 包含 `openAiProxyContract`，其 `status=ok`。
  - `openAiProxyContract.metrics.routesCorePathSamples=true`。
  - `openAiProxyContract.metrics.preservesRawPathAndQuery=true`。
  - `openAiProxyContract.metrics.normalizesSub2BaseTrailingSlash=true`。
  - `openAiProxyContract.metrics.routesResponsesItems=true`。
  - `openAiProxyContract.metrics.corePathSamples` 覆盖 `/v1`、`/v1/models`、`/v1/responses`、`/v1/responses/:id/input_items`、`/v1/chat/completions`、`/v1/files`、`/v1/uploads`、`/v1/batches`。

### 剩余真实阻断

- 首页现在能直接区分“本地 OpenAI/Codex 反代契约 ok”和“Sub2/OpenAI 上游凭据 error”。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-cb3fe87.tar` 与本地 `.deploy/sub2share-user-cb3fe87.tar`。

## 2026-06-13 03:59 Dashboard 管理员入口覆盖摘要发布与线上复查

### 本次发布

- 代码提交：`34f2314 feat: pin admin entry coverage on dashboard`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth` 新增 `adminEntryCoverage`。
  - 该字段独立于 `criticalChecks` top 8 切片，稳定展示 API 能力矩阵与 Admin 前端入口覆盖。
  - Admin 首页系统状态表新增“管理员入口”行。
  - 单元测试覆盖：`adminCapabilities` 与 `adminSurfaceCoverage` 被 top 8 挤出时，`adminEntryCoverage` 仍返回完整摘要。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：13/13 通过。
- `pnpm.cmd --filter @zyz/api test`：122/122 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-34f2314.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-34f2314.tar --commit 34f2314`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：122/122 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=34f2314`
  - `deployed_at=20260612T195934Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.status=error`，真实阻断仍集中在 Sub2/OpenAI 上游账号不可用。
  - `criticalChecks` top 8 不包含 `adminCapabilities`。
  - `criticalChecks` top 8 不包含 `adminSurfaceCoverage`。
  - `adminEntryCoverage.ok=true`。
  - `adminEntryCoverage.summary=API 5/5 核心范围，65/65 路由，65/65 入口 / 前端 5/5 核心范围，16 个列表入口，5 个关键入口`。
  - `adminEntryCoverage.api.metrics.missingRoutes=0`。
  - `adminEntryCoverage.api.metrics.missingTargets=0`。
  - `adminEntryCoverage.frontend.metrics.duplicateViews=0`。

### 剩余真实阻断

- 首页现在能同时看到真实上游阻断和管理员维修入口完整性，避免把“入口不可见”误判为维修路径缺失。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-34f2314.tar` 与本地 `.deploy/sub2share-user-34f2314.tar`。

## 2026-06-13 04:11 Dashboard 上游阻断摘要发布与线上复查

### 本次发布

- 代码提交：`fa255fb feat: surface upstream blocker on dashboard`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth` 新增 `upstreamBlocker`。
  - `upstreamBlocker` 独立于 `criticalChecks` top 8，从 Sub2/OpenAI、local smoke、资源凭据、共享资源和商品目录风险中提炼最需要处理的上游阻断。
  - 同级错误优先展示带 `actionHint`、`repairAction`、Sub2 账号或资源定位的可操作记录。
  - Admin 首页系统状态新增“上游阻断”行，并在关键巡检列表前展示可点击的阻断摘要。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：14/14 通过。
- `pnpm.cmd --filter @zyz/api test`：123/123 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-fa255fb.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-fa255fb.tar --commit fa255fb`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：123/123 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=fa255fb`
  - `deployed_at=20260612T201102Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.status=error`，快照未过期。
  - `upstreamBlocker.blocked=true`。
  - `upstreamBlocker.checkId=sub2`。
  - `upstreamBlocker.summary=阻断：openai_group_has_no_active_accounts`。
  - `upstreamBlocker.repairAction=apply_openai_refresh_token_to_sub2_account`。
  - `upstreamBlocker.actionHint=Refresh/test existing OpenAI accounts or apply a valid refresh token, then run the local end-to-end proxy smoke test.`。
  - `upstreamBlocker.sub2AccountId=2`。
  - `upstreamBlocker.check.primaryIssue.proxyRequestPath=/v1/responses`。
  - `upstreamBlocker.check.primaryIssue.proxyRequestStatusCode=503`。
  - `upstreamBlocker.check.primaryIssue.proxyRequestErrorCode=upstream_http_503`。
  - `upstreamBlocker.check.primaryIssue.auditAction=admin.sub2.proxy_smoke_test`。
  - `adminEntryCoverage.ok=true`，管理员入口覆盖仍完整。

### 剩余真实阻断

- 首页现在能稳定展示真实上游阻断、修复动作、目标 Sub2 账号和最近 `/v1/responses` smoke 失败证据。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。

## 2026-06-13 04:20 OpenAI/Codex 反代请求头契约发布与线上复查

### 本次发布

- 代码提交：`aae4533 feat: verify openai proxy upstream headers`
- 本次能力：
  - 新增 `buildOpenAiProxyUpstreamHeaders()`，实际 `/v1` 反代路由与测试复用同一套上游请求头构造逻辑。
  - 本地 `authorization`、`host`、`content-length`、`connection` 和调用方 `accept-encoding` 不透传到 Sub2API。
  - 售出的 Sub2API Key 会重注入到上游 `authorization`。
  - `content-type`、`openai-beta`、trace header、`x-forwarded-*` 与 `x-request-id` 保留/补齐。
  - `inspectOpenAiProxyContract()` 新增 `forwardsUpstreamHeaders`，Dashboard metrics 白名单同步展示该字段。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts tests/admin-capabilities.test.ts`：36/36 通过。
- `pnpm.cmd --filter @zyz/api test`：124/124 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-aae4533.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-aae4533.tar --commit aae4533`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：124/124 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=aae4533`
  - `deployed_at=20260612T202036Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 手动刷新 `/api/admin/system-health` 后：
  - `openAiProxyContract.status=ok`。
  - `openAiProxyContract.metrics.forwardsUpstreamHeaders=true`。
  - `openAiProxyContract.detail.issues=[]`。
- `GET /api/admin/dashboard` 最新快照：
  - `latestSystemHealth.status=error`，快照未过期。
  - `openAiProxyContract.metrics.routesCorePathSamples=true`。
  - `openAiProxyContract.metrics.preservesRawPathAndQuery=true`。
  - `openAiProxyContract.metrics.normalizesSub2BaseTrailingSlash=true`。
  - `openAiProxyContract.metrics.forwardsUpstreamHeaders=true`。
  - `upstreamBlocker.checkId=sub2`，`upstreamBlocker.blocked=true`。
  - `adminEntryCoverage.ok=true`。

### 剩余真实阻断

- 反代契约现在同时证明路径覆盖、query 透传和上游请求头透传正常。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-aae4533.tar` 与本地 `.deploy/sub2share-user-aae4533.tar`。

## 2026-06-13 04:29 Dashboard 上游阻断 smoke 证据新鲜度发布与线上复查

### 本次发布

- 代码提交：`226970d feat: surface upstream smoke evidence freshness`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth.upstreamBlocker` 新增 smoke 证据字段。
  - Admin 首页“上游阻断”表格行和阻断卡片展示 smoke 路径、模型、证据是否过期、证据年龄、HTTP 状态和代理错误码。
  - API 单元测试锁定 `upstreamBlocker` 顶层直接返回 stale smoke 证据字段。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：14/14 通过。
- `pnpm.cmd --filter @zyz/api test`：124/124 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有仓库换行提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-226970d.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-226970d.tar --commit 226970d`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：124/124 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=226970d`
  - `deployed_at=20260612T202953Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 手动刷新 `/api/admin/system-health` 后：
  - `latestSystemHealth.status=error`，快照未过期。
  - `localProxySmoke.status=error`。
  - `localProxySmoke.summary=Latest local OpenAI/Codex smoke test failed at /v1/responses. Evidence is 1457 minutes old and may no longer describe current /v1/responses availability.`
- `GET /api/admin/dashboard` 最新快照：
  - `upstreamBlocker.checkId=sub2`。
  - `upstreamBlocker.blocked=true`。
  - `upstreamBlocker.repairAction=apply_openai_refresh_token_to_sub2_account`。
  - `upstreamBlocker.evidencePath=/v1/responses`。
  - `upstreamBlocker.evidenceStatusCode=503`。
  - `upstreamBlocker.evidenceErrorCode=upstream_http_503`。
  - `upstreamBlocker.evidenceModel=gpt-5.3-codex`。
  - `upstreamBlocker.evidenceResponsesOk=false`。
  - `upstreamBlocker.evidenceLocalProxyOk=false`。
  - `upstreamBlocker.evidenceAgeMinutes=1457`。
  - `upstreamBlocker.evidenceStale=true`。
  - `upstreamBlocker.evidenceStaleThresholdMinutes=1440`。
  - `upstreamBlocker.evidenceFreshMinutesRemaining=0`。
  - `upstreamBlocker.evidenceStaleAt=2026-06-12T20:13:33.340Z`。
  - `adminEntryCoverage.ok=true`。

### 剩余真实阻断

- 首页现在能同时展示真实上游阻断和支撑该判断的 smoke 证据是否过期。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，OpenAI 返回 `token_invalidated`。
- 恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除远端 `/tmp/sub2share-user-226970d.tar` 与本地 `.deploy/sub2share-user-226970d.tar`。

## 2026-06-13 04:40 Dashboard 上游阻断资源凭据可用性发布与线上复查

### 本次发布

- 代码提交：`fb13822 feat: surface credential readiness on upstream blocker`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth.upstreamBlocker` 新增 `credentialReadiness`。
  - 首页上游阻断摘要显示资源凭据 readiness、active OpenAI refresh token 数、可应用凭据数、缺 Sub2 账号数。
  - API 测试覆盖 `credentialReadiness.metrics` 的关键字段。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：14/14 通过。
- `pnpm.cmd --filter @zyz/api test`：124/124 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-fb13822.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-fb13822.tar --commit fb13822`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：124/124 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=fb13822`
  - `deployed_at=20260612T204012Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 手动刷新 `/api/admin/system-health` 后：
  - `latestSystemHealth.status=error`，快照未过期。
  - `adminEntryCoverage.ok=true`。
  - `upstreamBlocker.checkId=sub2`。
  - `upstreamBlocker.blocked=true`。
  - `upstreamBlocker.evidencePath=/v1/responses`。
  - `upstreamBlocker.evidenceStatusCode=503`。
  - `upstreamBlocker.evidenceErrorCode=upstream_http_503`。
  - `upstreamBlocker.evidenceStale=true`。
  - `upstreamBlocker.credentialReadiness.status=error`。
  - `upstreamBlocker.credentialReadiness.summary=Sub2 上游无 active 账号，且没有可应用的资源凭据`。
  - `upstreamBlocker.credentialReadiness.metrics.totalCredentials=0`。
  - `upstreamBlocker.credentialReadiness.metrics.activeOpenAiRefreshTokens=0`。
  - `upstreamBlocker.credentialReadiness.metrics.activeApplicableCredentials=0`。

### 剩余真实阻断

- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，现有 OpenAI 账号返回 `token_invalidated`。
- 生产目前没有可应用资源凭据；恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除本地 `.deploy/sub2share-user-fb13822.tar` 与远端 `/tmp/sub2share-user-fb13822.tar`。

## 2026-06-13 04:48 Dashboard 上游阻断 Sub2 账号诊断发布与线上复查

### 本次发布

- 代码提交：`8159c39 feat: surface sub2 account diagnosis on dashboard`
- 本次能力：
  - `latestSystemHealth.upstreamBlocker` 顶层新增 `sub2AccountName`、`accountStatus`、`credentialsStatus`、`schedulable`、`tempUnschedulableReason`、`accountMessage`、`accountUpdatedAt`。
  - Admin 首页“上游阻断”表格行和阻断卡片新增账号诊断摘要。
  - 前端会把长 OpenAI/Sub2 账号错误压缩为一行可扫描文本。
  - 文档补充 Dashboard 上游阻断账号诊断需求与设计说明。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：14/14 通过。
- `pnpm.cmd --filter @zyz/api test`：124/124 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-8159c39.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-8159c39.tar --commit 8159c39`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：124/124 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=8159c39`
  - `deployed_at=20260612T204848Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 手动刷新 `/api/admin/system-health` 后：
  - `latestSystemHealth.status=error`，快照未过期。
  - `adminEntryCoverage.ok=true`。
  - `upstreamBlocker.checkId=sub2`。
  - `upstreamBlocker.blocked=true`。
  - `upstreamBlocker.summary=阻断：openai_group_has_no_active_accounts`。
  - `upstreamBlocker.sub2AccountId=2`。
  - `upstreamBlocker.sub2AccountName=1`。
  - `upstreamBlocker.accountStatus=error`。
  - `upstreamBlocker.credentialsStatus=configured(3)`。
  - `upstreamBlocker.schedulable=false`。
  - `upstreamBlocker.accountMessage` 包含 `token_invalidated`。
  - `upstreamBlocker.accountUpdatedAt=2026-06-12T22:53:59.925286+08:00`。
  - `upstreamBlocker.evidencePath=/v1/responses`。
  - `upstreamBlocker.evidenceStatusCode=503`。
  - `upstreamBlocker.evidenceErrorCode=upstream_http_503`。
  - `upstreamBlocker.credentialReadiness.metrics.totalCredentials=0`。

### 剩余真实阻断

- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，具体账号已在 Dashboard 顶层暴露为 Sub2 #2、`accountStatus=error`、`token_invalidated`。
- 生产目前没有可应用资源凭据；恢复仍需要有效 OpenAI refresh token 或恢复 active Sub2 OpenAI 账号后重新运行端到端自检。
- 已删除本地 `.deploy/sub2share-user-8159c39.tar` 与远端 `/tmp/sub2share-user-8159c39.tar`。

## 2026-06-13 04:57 Dashboard 完整 OpenAI/Codex 反代契约指标发布与线上复查

### 本次发布

- 代码提交：`22529ce feat: expose full proxy contract metrics on dashboard`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `openAiProxyContract.metrics` 保留完整反代契约字段。
  - Dashboard preview 现在能展示 request id、upstream request id、rate limit headers、CORS 暴露、raw body 模式、body limit、上游超时、stream idle timeout、stream 日志、OpenAI 兼容错误类型。
  - `openAiProxyRuntime.metrics` 补齐 Redis rate window、清理周期和 token event 指标。
  - API 单元测试从 124/124 增至 125/125，新增 runtime limiter preview 指标测试。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：15/15 通过。
- `pnpm.cmd --filter @zyz/api test`：125/125 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `git diff --check`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-22529ce.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-22529ce.tar --commit 22529ce`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：125/125 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=22529ce`
  - `deployed_at=20260612T205718Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 手动刷新 `/api/admin/system-health` 后，`GET /api/admin/dashboard` 返回：
  - `openAiProxyContract.status=ok`。
  - `openAiProxyContract.metrics.routesCorePathSamples=true`。
  - `openAiProxyContract.metrics.requestIdHeader=x-proxy-request-id`。
  - `openAiProxyContract.metrics.upstreamRequestIdHeaders=x-request-id,openai-request-id,x-openai-request-id,request-id`。
  - `openAiProxyContract.metrics.corsExposesRequestId=true`。
  - `openAiProxyContract.metrics.corsExposesUpstreamRequestIds=true`。
  - `openAiProxyContract.metrics.corsExposesRateLimitHeaders=true`。
  - `openAiProxyContract.metrics.requestBodyMode=raw-buffer`。
  - `openAiProxyContract.metrics.bodyLimitBytes=52428800`。
  - `openAiProxyContract.metrics.upstreamTimeoutMs=300000`。
  - `openAiProxyContract.metrics.streamIdleTimeoutMs=300000`。
  - `openAiProxyContract.metrics.extractsMultipartModelForLogs=true`。
  - `openAiProxyContract.metrics.extractsFormUrlEncodedModelForLogs=true`。
  - `openAiProxyContract.metrics.extractsUrlModelForLogs=true`。
  - `openAiProxyContract.metrics.abortsUpstreamOnClientClose=true`。
  - `openAiProxyContract.metrics.logsStreamCompletion=true`。
  - `openAiProxyContract.metrics.logsStreamErrors=true`。
  - `openAiProxyContract.metrics.hasStreamIdleTimeout=true`。
  - `openAiProxyContract.metrics.insufficientQuotaErrorType=insufficient_quota`。
  - `openAiProxyContract.metrics.rateLimitErrorType=rate_limit_error`。
  - `openAiProxyContract.metrics.apiErrorType=api_error`。
  - `openAiProxyContract.metrics.localErrorPayloadIncludesParam=true`。
  - `openAiProxyRuntime.status=ok`。
  - `openAiProxyRuntime.metrics.storeMode=redis`。
  - `openAiProxyRuntime.metrics.limiterScope=redis`。
  - `openAiProxyRuntime.metrics.redisReachable=true`。
  - `openAiProxyRuntime.metrics.rateWindowMs=60000`。
  - `openAiProxyRuntime.metrics.rateWindowCleanupIntervalMs=60000`。

### 剩余真实阻断

- 反代契约和运行态均为 `ok`，本地 OpenAI/Codex 反代能力证据已进入 Dashboard。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复，根因仍是 Sub2 默认 OpenAI 分组无 active 账号，具体账号返回 `token_invalidated`。
- 已删除本地 `.deploy/sub2share-user-22529ce.tar` 与远端 `/tmp/sub2share-user-22529ce.tar`。

## 2026-06-13 05:10 Dashboard 交付阻断发布与线上复查

### 本次发布

- 代码提交：`1f67bac feat: surface delivery blocker on dashboard`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth` 顶层新增 `deliveryBlocker`。
  - `deliveryBlocker` 会优先从 `salesDelivery`、`productCatalog`、`resources` 中选择最关键的交付阻断或告警。
  - Dashboard 首页新增“交付阻断”表格行与卡片，稳定展示商品、价格、资源、供给方、Sub2 账号和维修动作。
  - API 管理能力测试新增 `dashboard latest system health preview exposes actionable delivery blocker`，覆盖商品目录缺少可交付资源时的顶层摘要。

### 本地验证

- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：16/16 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-1f67bac.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-1f67bac.tar --commit 1f67bac`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：126/126 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=1f67bac`
  - `deployed_at=20260612T211038Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 手动刷新 `/api/admin/system-health` 后，`GET /api/admin/dashboard` 返回：
  - `latestSystemHealth.status=error`。
  - `upstreamBlocker.checkId=sub2`。
  - `upstreamBlocker.blocked=true`。
  - `upstreamBlocker.summary=阻断：openai_group_has_no_active_accounts`。
  - `upstreamBlocker.sub2AccountId=2`。
  - `upstreamBlocker.credentialsStatus=configured(3)`。
  - `upstreamBlocker.schedulable=false`。
  - `deliveryBlocker.checkId=productCatalog`。
  - `deliveryBlocker.blocked=true`。
  - `deliveryBlocker.status=warning`。
  - `deliveryBlocker.summary=1 个商品目录可购买性问题`。
  - `deliveryBlocker.productId=00000000-0000-0000-0000-000000000101`。
  - `deliveryBlocker.productName=Codex 标准租赁`。
  - `deliveryBlocker.priceId=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`。
  - `deliveryBlocker.supplierEmail=admin@zhisuan.local`。
  - `deliveryBlocker.resourceType=codex`。
  - `deliveryBlocker.resourceStatus=online`。
  - `deliveryBlocker.resourceScope=production`。
  - `deliveryBlocker.sub2AccountId=2`。
  - `deliveryBlocker.sub2AccountName=1`。
  - `deliveryBlocker.accountStatus=error`。
  - `deliveryBlocker.credentialsStatus=configured(3)`。
  - `deliveryBlocker.schedulable=false`。
  - `deliveryBlocker.repairAction=apply_openai_refresh_token_to_sub2_account`。

### 剩余真实阻断

- 管理员首页现在能同时看见上游阻断和交付阻断，不再需要进入系统巡检详情页才知道 Codex 商品为什么不可稳定交付。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前阻断仍是 Sub2 #2 的 OpenAI 账号 `accountStatus=error`，可调度状态为 `false`，已有凭据状态为 `configured(3)` 但仍无法提供 active 上游。
- 恢复仍需要给 Sub2 #2 应用有效 OpenAI refresh token，或恢复一个 active 且可调度的 Sub2 OpenAI 账号，然后重新运行系统巡检和端到端 smoke。
- 已删除本地 `.deploy/sub2share-user-1f67bac.tar` 与远端 `/tmp/sub2share-user-1f67bac.tar`。

## 2026-06-13 05:27 Dashboard 核心管理摘要发布与线上复查

### 本次发布

- 代码提交：`6667a97 feat: add dashboard management overview`
- 本次能力：
  - `GET /api/admin/dashboard` 新增 `managementOverview`。
  - 首页新增“核心管理摘要”，覆盖用户、余额、售出订单、租赁通道和共享资源状态分布。
  - 钱包列表新增 `negative`、`frozen`、`available`、`spent` 运营筛选。
  - API 测试新增 Dashboard 管理摘要归一化用例，覆盖状态补 0、未知状态保留、金额保留和钱包风险计数。

### 本地验证

- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：17/17 通过。
- `pnpm.cmd --filter @zyz/api test`：127/127 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：12/12 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-6667a97.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-6667a97.tar --commit 6667a97`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：127/127 通过。
  - Admin tests：12/12 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=6667a97`
  - `deployed_at=20260612T212718Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/dashboard` 返回：
  - `managementOverview.users.total=1`。
  - `managementOverview.users.statuses[active].count=1`。
  - `managementOverview.wallets.total=1`。
  - `managementOverview.wallets.negative=0`。
  - `managementOverview.wallets.frozen=0`。
  - `managementOverview.wallets.available=1`。
  - `managementOverview.wallets.spent=1`。
  - `managementOverview.sales.total=1`。
  - `managementOverview.sales.statuses[refunded].count=1`。
  - `managementOverview.sales.statuses[refunded].totalAmount=20`。
  - `managementOverview.sales.statuses[refunded].paidAmount=20`。
  - `managementOverview.rentals.total=1`。
  - `managementOverview.rentals.statuses[refunded].count=1`。
  - `managementOverview.sharing.total=0`。
- 钱包筛选接口验证：
  - `GET /api/admin/wallets?status=negative&pageSize=1`：`total=0`。
  - `GET /api/admin/wallets?status=frozen&pageSize=1`：`total=0`。
  - `GET /api/admin/wallets?status=available&pageSize=1`：`total=1`。
  - `GET /api/admin/wallets?status=spent&pageSize=1`：`total=1`。

### 剩余真实阻断

- 管理员首页已能直接查看用户、余额、售出订单、租赁通道、共享资源五类核心对象的状态分布，并可进入对应筛选列表。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前仍需修复 Sub2/OpenAI 账号凭据后重新运行系统巡检和端到端 smoke。
- 已删除本地 `.deploy/sub2share-user-6667a97.tar` 与远端 `/tmp/sub2share-user-6667a97.tar`。

## 2026-06-13 05:35 Dashboard 交付阻断共享资源直达修复发布与线上复查

### 本次发布

- 代码提交：`7d053e1 feat: add delivery blocker resource repair action`
- 本次能力：
  - `deliveryBlocker` 卡片在原有主操作外，针对 `productCatalog` 修复上下文额外展示“打开共享资源”。
  - 前端修复判断支持 `resourceList=true`，即使只有资源列表指示也能给出共享资源入口。
  - `dashboardHealthHasResourceFilter()` 与 `dashboardHealthCanOpenResourceRepair()` 复用同一套可测试判断。
  - Admin 测试新增 `product catalog repair action exposes shared resource drilldown`。

### 本地验证

- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。
- `pnpm.cmd --filter @zyz/admin test`：13/13 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-7d053e1.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-7d053e1.tar --commit 7d053e1`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：127/127 通过。
  - Admin tests：13/13 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=7d053e1`
  - `deployed_at=20260612T213557Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `GET /api/admin/dashboard` 返回：
  - `deliveryBlocker.checkId=productCatalog`。
  - `deliveryBlocker.productName=Codex 标准租赁`。
  - `deliveryBlocker.resourceList=true`。
  - `deliveryBlocker.resourceType=codex`。
  - `deliveryBlocker.resourceStatus=online`。
  - `deliveryBlocker.resourceScope=production`。
  - `deliveryBlocker.sub2AccountId=2`。
  - `deliveryBlocker.repairAction=apply_openai_refresh_token_to_sub2_account`。
  - `deliveryBlocker.check.primaryIssue.resourceList=true`。
  - `deliveryBlocker.check.primaryIssue.priceId=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`。
- Admin 生产构建包：
  - `/opt/zhisuan-yizhan/user/apps/admin/dist/assets/index-CU52mSEw.js` 包含 `打开共享资源` 文案。

### 剩余真实阻断

- 首页交付阻断现在能同时给出商品定位和共享资源修复入口，管理员可以直接进入 Codex 资源创建/凭据应用/smoke 验收链路。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前仍需要修复 Sub2/OpenAI 账号凭据后重新运行系统巡检和端到端 smoke。
- 已删除本地 `.deploy/sub2share-user-7d053e1.tar` 与远端 `/tmp/sub2share-user-7d053e1.tar`。

## 2026-06-13 05:45 反代请求失败类别筛选发布与线上复查

### 本次发布

- 代码提交：`547d9e7 feat: add proxy request failure filters`
- 本次能力：
  - `GET /api/admin/proxy-requests` 的 `status` 参数新增运维类别筛选：`failed`、`client_error`、`server_error`、`upstream_error`、`local_rejection`、`local_availability`、`stream_error`。
  - 原有精确 HTTP 状态码筛选仍保留，例如 `status=503`。
  - 多条件查询改为 `AND` 组合，避免失败类别、错误码和关键字检索之间互相覆盖。
  - Admin 请求日志页面下拉框同步暴露上述筛选值，便于直接定位本地拒绝、上游错误和流式异常。
  - API 测试新增 `proxy request status filters expose operational failure buckets`，覆盖所有新增筛选桶。

### 本地验证

- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：18/18 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin test`：13/13 通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-547d9e7.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-547d9e7.tar --commit 547d9e7`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：128/128 通过。
  - Admin tests：13/13 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=547d9e7`
  - `deployed_at=20260612T214458Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 管理员登录：
  - `POST /api/auth/login`：200。
  - 登录账号：`admin@zhisuan.local`。
- 反代请求日志筛选：
  - `GET /api/admin/proxy-requests?status=failed&pageSize=1`：200，`total=11`，首条 `errorCode=missing_api_key`、`statusCode=401`。
  - `GET /api/admin/proxy-requests?status=upstream_error&pageSize=1`：200，`total=7`，首条 `errorCode=upstream_http_503`、`statusCode=503`、`upstreamStatusCode=503`。
  - `GET /api/admin/proxy-requests?status=local_rejection&pageSize=1`：200，`total=4`，首条 `errorCode=missing_api_key`、`statusCode=401`。
  - `GET /api/admin/proxy-requests?status=stream_error&pageSize=1`：200，`total=0`，分页结构正常。
  - `GET /api/admin/proxy-requests?status=client_error&pageSize=1`：200，`total=4`，首条 `statusCode=401`。
  - `GET /api/admin/proxy-requests?status=server_error&pageSize=1`：200，`total=7`，首条 `statusCode=503`。
- Admin 生产构建包：
  - `/opt/zhisuan-yizhan/user/apps/admin/dist/assets` 包含 `upstream_error`。
  - `/opt/zhisuan-yizhan/user/apps/admin/dist/assets` 包含 `stream_error`。

### 剩余真实阻断

- 管理员现在可以直接按失败类别查看本地拒绝、上游错误和流式异常，请求日志排障入口已进一步细化。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前主要阻断仍是 Sub2/OpenAI 凭据或可调度账号不可用，线上可见上游 `503 upstream_http_503`。
- 已删除本地 `.deploy/sub2share-user-547d9e7.tar` 与远端 `/tmp/sub2share-user-547d9e7.tar`。

## 2026-06-13 06:00 Dashboard 阻断直达反代失败日志发布与线上复查

### 本次发布

- 代码提交：`a3ee2f3 feat: link dashboard blockers to proxy failures`
- 本次能力：
  - `GET /api/admin/dashboard` 的 `latestSystemHealth.upstreamBlocker` 与 `deliveryBlocker` 新增 `proxyRequestFilterStatus`、`proxyRequestFilterLookup`。
  - Dashboard 预览白名单补齐 `proxyRequestLookup` 与 `upstreamStatusCode`。
  - 首页上游阻断和交付阻断卡片新增“打开失败日志”按钮。
  - 前端按钮优先使用精确 lookup，缺少 lookup 时按 `upstream_error`、`local_rejection`、`local_availability`、`stream_error` 等失败类别打开反代请求列表。

### 本地验证

- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：19/19 通过。
- `pnpm.cmd --filter @zyz/admin test`：14/14 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api test`：129/129 通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-a3ee2f3.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-a3ee2f3.tar --commit a3ee2f3`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：129/129 通过。
  - Admin tests：14/14 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=a3ee2f3`
  - `deployed_at=20260612T220028Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- Admin 生产构建包：
  - 包含 `打开失败日志`。
  - 包含 `proxyRequestFilterStatus`。
- `POST /api/auth/login`：200，登录账号 `admin@zhisuan.local`。
- `GET /api/admin/dashboard`：200，返回：
  - `latestSystemHealth.status=error`。
  - `upstreamBlocker.checkId=sub2`。
  - `upstreamBlocker.summary=阻断：openai_group_has_no_active_accounts`。
  - `upstreamBlocker.proxyRequestFilterStatus=upstream_error`。
  - `upstreamBlocker.proxyRequestFilterLookup=c3c3450f-5b06-4c72-aad4-449af98b6beb`。
  - `upstreamBlocker.sub2AccountId=2`。
  - `deliveryBlocker.checkId=productCatalog`。
  - `deliveryBlocker.productName=Codex 标准租赁`。
  - `deliveryBlocker.proxyRequestFilterStatus=upstream_error`。
  - `deliveryBlocker.proxyRequestFilterLookup=c3c3450f-5b06-4c72-aad4-449af98b6beb`。
- `GET /api/admin/proxy-requests?status=upstream_error&pageSize=1`：200，`total=7`，首条：
  - `statusCode=503`
  - `upstreamStatusCode=503`
  - `errorCode=upstream_http_503`
  - `path=/v1/responses`
- `GET /api/admin/proxy-requests?q=c3c3450f-5b06-4c72-aad4-449af98b6beb&pageSize=3`：200，`total=1`，命中同一条 `/v1/responses` 上游 503 日志。

### 剩余真实阻断

- 管理员首页现在可以从上游阻断和交付阻断直接打开相关反代失败日志，再继续进入用户、租赁、订单、API Key 或用量排障。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前主要阻断仍是 Sub2/OpenAI 可调度账号或凭据不可用，线上证据仍为 `upstream_http_503`。
- 已删除本地 `.deploy/sub2share-user-a3ee2f3.tar` 与远端 `/tmp/sub2share-user-a3ee2f3.tar`。

## 2026-06-13 06:10 反代请求日志行直达 Sub2 修复发布与线上复查

### 本次发布

- 代码提交：`1099ff8 feat: link proxy request rows to sub2 repair`
- 本次能力：
  - Admin `反代请求` 列表行新增条件动作 `反代状态`。
  - 上游 HTTP 错误、`upstream_*` 错误、上游超时/不可达和 stream 异常会显示该动作。
  - 点击后打开 `反代状态` 页，并带入 request id、日志 id、上游 request id、路径、状态码、错误码、模型和 `/v1/responses` 失败标记。
  - `missing_api_key` 等本地准入拒绝不会显示该动作，避免误导到 Sub2/OpenAI 凭据修复。

### 本地验证

- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。
- `pnpm.cmd --filter @zyz/admin test`：15/15 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-1099ff8.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-1099ff8.tar --commit 1099ff8`
- 脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：129/129 通过。
  - Admin tests：15/15 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=1099ff8`
  - `deployed_at=20260612T221033Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- Admin 生产构建包：
  - 包含 `反代请求日志`。
  - 包含 `Review Sub2/OpenAI upstream status`。
- `POST /api/auth/login`：200，登录账号 `admin@zhisuan.local`。
- `GET /api/admin/proxy-requests?status=upstream_error&pageSize=1`：200，`total=7`，首条：
  - `id=2732cfa3-9df0-4488-96e2-c5a14df5d9fc`
  - `requestId=c3c3450f-5b06-4c72-aad4-449af98b6beb`
  - `statusCode=503`
  - `upstreamStatusCode=503`
  - `errorCode=upstream_http_503`
  - `path=/v1/responses`
  - `model=gpt-5.3-codex`
  - 前端判定会显示 `反代状态` 修复入口。
- `GET /api/admin/proxy-requests?status=local_rejection&pageSize=1`：200，`total=4`，首条：
  - `statusCode=401`
  - `upstreamStatusCode=null`
  - `errorCode=missing_api_key`
  - `path=/v1/models`
  - 前端判定不会显示 Sub2/OpenAI 修复入口。

### 剩余真实阻断

- 管理员现在可以从首页阻断卡片进入失败日志，再从具体上游失败日志行进入 Sub2/OpenAI 修复面板。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前主要阻断仍是 Sub2/OpenAI 可调度账号或凭据不可用，线上证据仍为 `upstream_http_503`。
- 已删除本地 `.deploy/sub2share-user-1099ff8.tar` 与远端 `/tmp/sub2share-user-1099ff8.tar`。

## 2026-06-13 06:21 反代失败日志携带租赁 Sub2 上下文发布与线上复查

### 本次发布

- 代码提交：`dd90595 feat: expose rental sub2 context on proxy logs`
- 本次能力：
  - `GET /api/admin/proxy-requests` 的租赁关联返回新增 `sub2UserId`、`sub2KeyId` 和 `endpointUrl`。
  - 反代请求搜索新增覆盖 Sub2 User ID、Sub2 Key ID 和 endpoint URL。
  - Admin `反代请求` 列表的“租赁 / Key”列展示 Sub2 Key 或 endpoint 低敏线索。
  - CSV 导出新增 `sub2UserId`、`sub2KeyId` 和 `endpointUrl`。
  - 上游失败日志打开 `反代状态` 时，修复定位新增租赁 ID、资源类型、Sub2 用户、Sub2 Key 和 endpoint。

### 本地验证

- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：15/15 通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `pnpm.cmd --filter @zyz/api test`：129/129 通过。

### 生产部署

- 部署归档：`/tmp/sub2share-user-dd90595.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-dd90595.tar --commit dd90595`
- release marker：
  - `commit=dd90595`
  - `deployed_at=20260612T222122Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- Admin 生产构建包：
  - 包含 `Sub2 Key`。
  - 包含 `租赁通道`。
- `POST /api/auth/login`：200，登录账号 `admin@zhisuan.local`。
- `GET /api/admin/proxy-requests?status=upstream_error&pageSize=1`：200，`total=7`，首条：
  - `id=2732cfa3-9df0-4488-96e2-c5a14df5d9fc`
  - `requestId=c3c3450f-5b06-4c72-aad4-449af98b6beb`
  - `statusCode=503`
  - `upstreamStatusCode=503`
  - `errorCode=upstream_http_503`
  - `path=/v1/responses`
  - `model=gpt-5.3-codex`
  - `rentalId=c2804538-e863-4071-a1f2-2580a12f5948`
  - `rental.resourceType=codex`
  - `rental.sub2UserId=9`
  - `rental.sub2KeyId=16`
  - `rental.endpointUrl=http://192.168.31.26:4100/v1`
- `GET /api/admin/proxy-requests?q=16&status=upstream_error&pageSize=3`：200，`total=7`，首条返回 `rental.sub2KeyId=16` 和 endpoint。

### 剩余真实阻断

- 管理员现在可以从首页阻断卡片进入失败日志，再从具体上游失败日志确认租赁通道、Sub2 Key 和 endpoint，最后进入 Sub2/OpenAI 修复面板。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前主要阻断仍是 Sub2/OpenAI 可调度账号或凭据不可用，线上证据仍为 `upstream_http_503`。
- 远端 `/tmp/sub2share-user-dd90595.tar` 已由部署脚本清理。

## 2026-06-13 06:41 租赁持久化共享资源归因发布与线上复查

### 本次发布

- 代码提交：`d6f421c feat: track supplier resource on rentals`
- 本次能力：
  - `Rental` 新增 `supplierResourceId`，关联 `SupplierResource`。
  - 迁移 `0017_rental_supplier_resource` 会从 `OrderStatusHistory.meta.supplierResourceId` 尽力回填历史租赁。
  - 用户下单、管理员重试开通和租赁 API Key 轮换都会保存当前选中的共享资源。
  - Admin 租赁列表、租赁详情、订单详情和售出详情新增共享资源展示/直达。
  - Admin 反代请求日志返回并搜索共享资源 ID、Sub2 Account ID 和供给方邮箱。
  - 上游失败日志打开 `反代状态` 时会带入共享资源、Sub2 Account、资源状态和供给方邮箱。
  - 租赁 CSV 与反代请求 CSV 导出新增共享资源归因字段。

### 本地验证

- `pnpm.cmd exec prisma format --schema prisma/schema.prisma`：通过。
- `pnpm.cmd exec prisma generate --schema prisma/schema.prisma`：通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin test`：15/15 通过。
- `pnpm.cmd --filter @zyz/api test`：129/129 通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-d6f421c.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-d6f421c.tar --commit d6f421c`
- 脚本内验证：
  - Prisma generate：通过。
  - Prisma migrate deploy：已应用 `0017_rental_supplier_resource`。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：129/129 通过。
  - Admin tests：15/15 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=d6f421c`
  - `deployed_at=20260612T224112Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- Admin 生产构建包：
  - 包含 `Shared resource`。
  - 包含 `supplierResourceId`。
  - 包含 `打开资源`。
- `POST /api/auth/login`：200，登录账号 `admin@zhisuan.local`。
- `GET /api/admin/proxy-requests?status=upstream_error&pageSize=1`：200，`total=7`，首条仍为历史 `/v1/responses` 503：
  - `id=2732cfa3-9df0-4488-96e2-c5a14df5d9fc`
  - `requestId=c3c3450f-5b06-4c72-aad4-449af98b6beb`
  - `rentalId=c2804538-e863-4071-a1f2-2580a12f5948`
  - `rental.supplierResourceId=null`
  - `rental.supplierResource=null`
- `GET /api/admin/resources?resourceType=codex&pageSize=20`：200，当前 `total=1`，该资源为 `disabled`，`sub2AccountId=admin-disabled-smoke-resource`，供给方 `admin@zhisuan.local`。

### 剩余真实阻断

- 新数据链路已经具备“售出订单 -> 租赁 -> 共享资源 -> Sub2/OpenAI 账号 -> 反代请求”的持久归因。
- 当前历史失败日志没有可回填的生产共享资源 ID；线上也没有 ready/online 的生产 Codex 共享资源，因此没有执行人工猜测回填。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前主要阻断仍是缺少可用生产 Codex 共享资源、有效 OpenAI/Sub2 上游账号或有效 refresh token，线上证据仍为 `upstream_http_503`。
- 远端 `/tmp/sub2share-user-d6f421c.tar` 已由部署脚本清理。

## 2026-06-13 06:56 售出交付巡检覆盖租赁共享资源归因发布与线上复查

### 本次发布

- 代码提交：`36255ce feat: flag rental resource attribution gaps`
- 本次能力：
  - `salesDelivery` 巡检新增 Codex 租赁共享资源归因检查。
  - 缺少 `supplierResourceId` 或关联资源缺失时返回 `rental_missing_supplier_resource`。
  - 已关联共享资源但资源不是 `online` 或缺少 `sub2AccountId` 时返回 `rental_supplier_resource_not_ready`。
  - Dashboard `deliveryBlocker` 保留 `orderId`、`rentalId`、`userId`、`userEmail`，并可从 `salesDelivery` 问题优先打开共享资源修复入口。
  - Admin 共享资源修复动作判断从 `productCatalog` 扩展到 `salesDelivery`。

### 本地验证

- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：129/129 通过。
- `pnpm.cmd --filter @zyz/admin test`：15/15 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-36255ce.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-36255ce.tar --commit 36255ce32d81651494fed927a229c97a300a719d`
- 部署脚本在服务器侧通过：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：129/129 通过。
  - Admin tests：15/15 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=36255ce32d81651494fed927a229c97a300a719d`
  - `deployed_at=20260612T225630Z`

### 线上复查

- 服务状态：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 进程 cwd：
  - `4100`：`/opt/zhisuan-yizhan/user/apps/api`。
  - `3100`：`/opt/zhisuan-yizhan/user`。
  - `3101`：`/opt/zhisuan-yizhan/user`。
- `POST /api/auth/login`：200，管理员账号 `admin@zhisuan.local` 可登录。
- 管理员核心入口 API：
  - `GET /api/admin/users?pageSize=1`：200，`total=1`。
  - `GET /api/admin/resources?pageSize=1`：200，`total=1`，首条资源 `resourceType=codex`、`status=disabled`。
  - `GET /api/admin/wallets?pageSize=1`：200，`total=1`。
  - `GET /api/admin/sales?pageSize=1`：200，`total=1`，返回销售汇总字段。
  - `GET /api/admin/capabilities?pageSize=1`：200。
- `GET /api/admin/system-health`：200，当前返回：
  - `status=error`。
  - `totalChecks=29`。
  - `salesDelivery.status=ok`。
  - `salesDelivery.summary=应交付订单未发现交付阻断`。
  - `resources.status=warning`，`summary=No online production Codex shared resource`。
  - `proxy.status=ok`，`summary=最近 1 小时无反代请求`。
- 刷新后的 `GET /api/admin/dashboard`：200，当前返回：
  - `latestSystemHealth.stale=false`。
  - `latestSystemHealth.ageMinutes=0`。
  - `deliveryBlocker.checkId=productCatalog`。
  - `deliveryBlocker.repairAction=apply_openai_refresh_token_to_sub2_account`。
  - `deliveryBlocker.resourceList=true`。
  - `deliveryBlocker.resourceType=codex`。
  - `deliveryBlocker.orderId=null`、`rentalId=null`，因为当前实时 `salesDelivery` 没有租赁交付阻断。
- 远端 `/tmp/sub2share-user-36255ce.tar` 已由部署脚本清理。

### 剩余真实阻断

- 当前生产系统基础服务、Dashboard、完整系统巡检、用户/共享资源/余额/售出管理员入口均可用。
- 实时 `salesDelivery` 巡检已运行且为 ok，说明当前没有应交付订单触发租赁共享资源归因缺失。
- 真实 OpenAI/Codex `/v1/responses` 仍未恢复；当前主要阻断仍是 `sub2=openai_group_has_no_active_accounts`、`resourceCredentials=openai_refresh_token_candidate_missing`、没有 online production Codex shared resource。
- 下一步恢复真实 Codex 生成仍需要管理员提供有效 OpenAI refresh token 或恢复可调度 Sub2/OpenAI 账号，并创建/修复生产 Codex 共享资源后重新运行端到端 smoke。

## 2026-06-13 07:15 租赁共享资源归因修复入口发布与线上复查

### 本次发布

- 代码提交：`d37f7ec feat: assign rental supplier resources`
- 本次能力：
  - 新增 `PATCH /api/admin/rentals/:id/supplier-resource`。
  - 管理员可以为租赁绑定或清空 `supplierResourceId`。
  - Codex 租赁默认要求目标共享资源 ready：online、生产可交付、存在 Sub2 Account，并具备 active OpenAI refresh token 凭据。
  - 租赁列表和租赁详情新增共享资源归因表单，支持 ready 校验与清空归因。
  - 能力矩阵新增 `rentals.assignSupplierResource`，管理员入口覆盖从 65 个操作扩展到 66 个操作。
  - `docs/需求文档.md`、售出交付巡检、Dashboard 健康快照和能力覆盖文档均已补充该修复链路。

### 本地验证

- `pnpm.cmd --filter @zyz/api test`：129/129 通过。
- `pnpm.cmd --filter @zyz/admin test`：15/15 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。

### 生产部署

- 部署前 release marker：
  - `commit=36255ce32d81651494fed927a229c97a300a719d`
  - `deployed_at=20260612T225630Z`
- 部署归档：`/tmp/sub2share-user-d37f7ec.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-d37f7ec.tar --commit d37f7eccdcb9d69f545f238cb53f8a956510eca9`
- 部署脚本在服务器侧通过：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：129/129 通过。
  - Admin tests：15/15 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=d37f7eccdcb9d69f545f238cb53f8a956510eca9`
  - `deployed_at=20260612T231535Z`

### 线上复查

- 服务入口：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `POST /api/auth/login`：管理员账号 `admin@zhisuan.local` 登录成功。
- `GET /api/admin/capabilities`：
  - `coverage.ok=true`。
  - `totalOperations=66`。
  - `registeredOperations=66`。
  - `operationsWithTargets=66`。
  - `missingRoutes=0`。
  - `missingTargets=0`。
  - 能力项 `rentals.assignSupplierResource` 已存在，路径为 `PATCH /api/admin/rentals/:id/supplier-resource`，入口目标为 `rentals`。
- 新路由无侵入探测：
  - `PATCH /api/admin/rentals/nonexistent/supplier-resource`，请求体 `{"supplierResourceId":null,"requireReady":false}`。
  - 返回 `404`，错误码 `rental_not_found`。
  - 该探测证明路由和鉴权已上线，且没有修改任何真实租赁数据。
- `GET /api/admin/system-health`：
  - 总体 `status=error`。
  - `deploymentRuntime.status=ok`，当前进程运行在 release `d37f7eccdcb9d69f545f238cb53f8a956510eca9`。
  - `frontendRuntime.status=ok`，Web/Admin frontend endpoints reachable `2/2`。
  - `adminCapabilities.status=ok`，5/5 核心管理范围，66/66 路由，66/66 入口。
  - `openAiProxyContract.status=ok`，本地 OpenAI/Codex 反代契约正常；覆盖 `/v1`、`/v1/*`、`/v1/models`、`/v1/responses`、`/v1/chat/completions`、`/v1/files`、`/v1/uploads`、`/v1/batches`，并保留 raw body、上游 header、request id、rate limit header、stream idle timeout 和 CORS 暴露契约。
  - `salesDelivery.status=ok`，应交付订单未发现交付阻断；`rentalsMissingSupplierResource=0`，`rentalsWithUnavailableSupplierResource=0`。
  - `payments.status=ok`，生产 mock 充值已禁用。
  - `wallets.status=ok`，余额账户未发现负数。
  - `proxy.status=ok`，最近 1 小时无反代请求。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.stale=false`。
  - `adminEntryCoverage.ok=true`。
  - 摘要：`API 5/5 核心范围，66/66 路由，66/66 入口 / 前端 5/5 核心范围，16 个列表入口，5 个关键入口`。
  - `deliveryBlocker.checkId=productCatalog`，当前阻断来自 Codex 商品缺少 ready production shared resource，不是 `salesDelivery` 租赁归因缺口。

### 端到端 smoke 刷新

- 已执行 `POST /api/admin/sub2/proxy-smoke-test` 刷新当前发布后的 live 证据。
- 返回结果：
  - `ok=false`。
  - `model=gpt-5.3-codex`。
  - `provisioning.ok=true`。
  - `models.ok=true`，`statusCode=200`，`modelCount=10`，`firstModel=gpt-5.5`。
  - `responses.ok=false`，`statusCode=503`，`errorType=api_error`，`errorMessage=Service temporarily unavailable`。
  - `localProxy.proxyRequestLogCount=2`。
  - `keyDisabled=true`。
  - `apiKeyDeactivated=true`。
  - `rentalClosed=true`。
  - `orderClosed=true`。
  - `walletReset=true`。
  - `cleanupError=null`。
- 刷新后的 `localProxySmoke`：
  - `status=error`。
  - `summary=Latest local OpenAI/Codex smoke test failed at /v1/responses.`
  - `latestAuditLogId=38e3fc85-a98e-4541-b8fe-fa076972e097`。
  - `ageMinutes=0`。
  - `stale=false`。
  - `modelsOk=true`。
  - `responsesOk=false`。
  - `localProxyOk=false`。
  - `freshMinutesRemaining=1440`。
  - `staleAt=2026-06-13T23:22:37.617Z`。

### 剩余真实阻断

- `productCatalog.status=warning`：1 个 Codex 商品可购买性问题，`readyCodexDeliveryResources=0`，`codexProductsWithoutReadyDeliveryResources=1`。
- `resources.status=warning`：`No online production Codex shared resource`，当前没有 online production Codex 共享资源。
- `resourceCredentials.status=error`：没有 active OpenAI refresh token 凭据，也没有可应用到 Sub2 的资源凭据。
- `sub2.status=error`：`openai_group_has_no_active_accounts`，Sub2 网关可达，但默认 OpenAI 分组 active 账号数为 0。
- 这说明程序内核的本地 OpenAI/Codex 反代契约已经在线，`/v1/models` 可通过当前链路；真实 `/v1/responses` 仍需要恢复有效 OpenAI refresh token、active Sub2 OpenAI 账号和 ready production Codex shared resource。

### 清理

- 远端 `/tmp/sub2share-user-d37f7ec.tar` 已删除。
- 本地 `.deploy/sub2share-user-d37f7ec.tar` 已删除，空 `.deploy` 目录已清理。

## 2026-06-13 07:29 临时下线不可交付 Codex 商品

### 背景

- 最新发布后，本地 OpenAI/Codex 反代契约、管理员入口、销售交付、支付和余额均已复查。
- 生产仍没有 ready production Codex shared resource：
  - `resources.status=warning`，`readyOnlineCodexResources=0`。
  - `resourceCredentials.status=error`，没有 active OpenAI refresh token。
  - `sub2.status=error`，`openai_group_has_no_active_accounts`。
- 公开商品目录仍返回 active 商品 `Codex 标准租赁`，但 `deliveryReady=false`、`deliveryBlockedReason=codex_resource_not_ready_for_delivery`。
- 买家端按钮会禁用购买，但系统健康仍正确标记该状态为 `productCatalog.warning`：active Codex 商品有 active 价格，却没有 ready 交付资源。

### 执行的运营修复

- 通过现有管理员接口临时下线不可交付 Codex 商品：
  - `PATCH /api/admin/products/00000000-0000-0000-0000-000000000101`
  - 请求体：`{"status":"offline"}`
- 变更对象：
  - 商品 ID：`00000000-0000-0000-0000-000000000101`
  - 商品名：`Codex 标准租赁`
  - 价格 ID：`d231fcef-2dc6-4317-b44e-a93cad3ab0ea`
  - 价格状态保持 `active`，仅商品状态从 `active` 改为 `offline`。
- 审计记录：
  - `auditLogId=e2c0251c-dd0f-474b-a9a2-2fb185bf46bd`
  - `action=admin.product.update`
  - before：`status=active`
  - after：`status=offline`

### 验证结果

- 公开商品目录：
  - `GET /api/products` 返回 `count=0`。
  - 当前不会继续对外展示不可交付的 Codex 套餐。
- `GET /api/admin/system-health`：
  - 总体仍为 `status=error`，因为真实 Sub2/OpenAI 上游仍阻断。
  - `productCatalog.status=ok`。
  - `productCatalog.summary=公开商品目录可购买性正常`。
  - `matched=0`，`returnedIssues=0`。
  - `readyCodexDeliveryResources=0`。
  - `codexProductsWithoutReadyDeliveryResources=0`。
  - `salesDelivery.status=ok`，没有应交付订单阻断。
  - `adminCapabilities.status=ok`，66/66 路由与入口仍完整。
  - `openAiProxyContract.status=ok`，本地 OpenAI/Codex 反代契约仍正常。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.stale=false`。
  - `productCatalog.status=ok`。
  - 首页 `deliveryBlocker` 从 `productCatalog` 切换为 `resources`，说明当前交付阻断已收敛到真正剩余的生产共享资源缺失。

### 剩余真实阻断与恢复条件

- 这次修复只消除了“无 ready 资源仍对外展示可开通商品”的运营风险，没有恢复真实 `/v1/responses`。
- 剩余阻断仍是：
  - 没有 online production Codex shared resource。
  - 没有 active OpenAI refresh token resource credential。
  - Sub2 默认 OpenAI 分组没有 active account。
  - `localProxySmoke` 刷新后仍显示 `/v1/models` 通过、`/v1/responses` 返回 503。
- 恢复销售前需要：
  - 提供并应用有效 OpenAI refresh token。
  - 恢复或创建 active Sub2 OpenAI account。
  - 创建/修复 ready production Codex shared resource。
  - 重新运行 `POST /api/admin/sub2/proxy-smoke-test`，确认 `/v1/responses` 通过。
  - 再将 `Codex 标准租赁` 从 `offline` 调回 `active`。

## 2026-06-13 07:40 Codex 商品上架交付就绪闸门发布与线上复查

### 本次发布

- 代码提交：`c7f06a2 feat: gate codex catalog activation`
- 本次能力：
  - `POST /api/admin/products` 创建 active Codex 商品时默认要求 ready production Codex shared resource。
  - `PATCH /api/admin/products/:id` 把 Codex 商品上架为 active 时默认要求 ready production Codex shared resource。
  - `POST /api/admin/products/:id/prices` 在 active Codex 商品下创建 active 可购买价格时默认要求 ready production Codex shared resource。
  - `PATCH /api/admin/product-prices/:id` 把 active Codex 商品的可购买价格启用为 active 时默认要求 ready production Codex shared resource。
  - Admin 商品和价格表单新增 `override delivery`，显式传入 `allowUnavailableDelivery=true` 时才允许覆盖该闸门。

### 本地验证

- `pnpm.cmd --filter @zyz/api test`：131/131 通过。
- `pnpm.cmd --filter @zyz/admin test`：15/15 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-c7f06a2.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-c7f06a2.tar --commit c7f06a2e11b5ad213e9f77795d69011a1f467eaa`
- 部署脚本在服务器侧通过：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：131/131 通过。
  - Admin tests：15/15 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=c7f06a2e11b5ad213e9f77795d69011a1f467eaa`
  - `deployed_at=20260612T234025Z`

### 线上复查

- 服务入口：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- 当前商品状态：
  - `Codex 标准租赁` 仍为 `status=offline`。
  - `deliveryReady=false`。
  - `readyDeliveryResources=0`。
  - `deliveryBlockedReason=codex_resource_not_ready_for_delivery`。
- 无覆盖上架探测：
  - `PATCH /api/admin/products/00000000-0000-0000-0000-000000000101`
  - 请求体：`{"status":"active"}`
  - 返回：`409 codex_resource_not_ready_for_product_activation`。
  - 返回上下文包含 `requiredStatus=online`、`requiredCredentialType=openai_refresh_token`、`requiredCredentialStatus=active`、`readyCodexDeliveryResources=0`、`allowUnavailableDelivery=true`。
  - 探测后商品仍为 `status=offline`。
- 公开商品目录：
  - `GET /api/products` 返回 `count=0`。
- `GET /api/admin/system-health`：
  - 总体仍为 `status=error`。
  - `productCatalog.status=ok`，`summary=公开商品目录可购买性正常`。
  - `salesDelivery.status=ok`，没有应交付订单阻断。
  - `adminCapabilities.status=ok`，66/66 路由与入口。
  - `openAiProxyContract.status=ok`，本地 OpenAI/Codex 反代契约正常。

### 剩余真实阻断

- 该发布固化了“不可交付 Codex 商品默认不能重新上架”的程序护栏。
- 真实 `/v1/responses` 仍未恢复，剩余阻断仍是：
  - 没有 online production Codex shared resource。
  - 没有 active OpenAI refresh token resource credential。
  - Sub2 默认 OpenAI 分组没有 active account。
  - 最新 `localProxySmoke` 仍显示 `/v1/models` 通过、`/v1/responses` 返回 503。

### 清理

- 远端 `/tmp/sub2share-user-c7f06a2.tar` 已删除。
- 本地 `.deploy/sub2share-user-c7f06a2.tar` 已删除，空 `.deploy` 目录已清理。

## 2026-06-13 07:51 前端构建资产巡检发布与线上复查

### 本次发布

- 代码提交：`6518ca9 feat: check frontend assets in health`
- GitHub：`main` 已推送到 `git@github.com:carzygod/sub2share.git`
- 本次能力：
  - `frontendRuntime` 系统健康检查从 HTML 可达性扩展到页面引用的构建资产。
  - 对 Web/Admin 的 `script` 与 `stylesheet` 资产执行真实 HTTP 探测。
  - 新增 `totalAssets`、`okAssets`、`failedAssets`、`endpointsWithoutAssets` 指标。
  - 对缺失构建资产、资产 4xx/5xx、JS/CSS MIME 异常和资产扫描异常给出明确错误项。
  - `docs/frontend-runtime-health-check.md`、`docs/system-health-check.md` 与 `docs/需求文档.md` 已同步扩展口径。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-frontend-runtime-health.test.ts`：7/7 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：134/134 通过。
- `pnpm.cmd --filter @zyz/admin test`：15/15 通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有 Windows 工作区 LF/CRLF 提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-6518ca9.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-6518ca9.tar --commit 6518ca908beb1a31f802abe4bda3dcc32b13a2a2`
- 部署脚本在服务器侧通过：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：134/134 通过。
  - Admin tests：15/15 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=6518ca908beb1a31f802abe4bda3dcc32b13a2a2`
  - `deployed_at=20260612T235111Z`

### 线上复查

- 服务入口：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200，`text/html; charset=utf-8`。
  - `http://127.0.0.1:3101/`：200，`text/html; charset=utf-8`。
- `POST /api/auth/login`：管理员账号 `admin@zhisuan.local` 登录成功。
- `GET /api/admin/system-health`：
  - 总体仍为 `status=error`，原因是上游真实 Codex/OpenAI 资源仍未恢复。
  - `frontendRuntime.status=ok`。
  - `frontendRuntime.metrics.totalEndpoints=2`、`okEndpoints=2`、`totalAssets=4`、`okAssets=4`、`failedAssets=0`、`endpointsWithoutAssets=0`。
  - Web：HTML 200，引用资产 2 个；JS `text/javascript; charset=utf-8` 200，CSS `text/css; charset=utf-8` 200。
  - Admin：HTML 200，引用资产 2 个；JS `text/javascript; charset=utf-8` 200，CSS `text/css; charset=utf-8` 200。
  - `adminCapabilities.status=ok`，66/66 路由和入口仍完整。
  - `openAiProxyContract.status=ok`，本地 OpenAI/Codex 反代契约仍覆盖 `/v1`、`/v1/*`、`/v1/responses` 等核心路径。
  - `productCatalog.status=ok`，公开商品目录当前无不可交付可购商品。
  - `salesDelivery.status=ok`，当前无应交付订单阻塞。

### 剩余真实阻断

- `resources.status=warning`：仍没有 online production Codex shared resource。
- `resourceCredentials.status=error`：仍没有 active OpenAI refresh token resource credential。
- `sub2.status=error`：`openai_group_has_no_active_accounts`，Sub2 默认 OpenAI 分组没有 active account。
- `localProxySmoke.status=error`：最新 `/v1/models` 可用，但 `/v1/responses` 仍返回 503。
- 结论：本次发布完成了前端运行时可用性巡检的细化和线上验证；真实 `/v1/responses` 恢复仍依赖有效 OpenAI refresh token、active Sub2 OpenAI account 和 ready production Codex shared resource。

### 清理

- 远端 `/tmp/sub2share-user-6518ca9.tar` 已删除。
- 本地 `.deploy/sub2share-user-6518ca9.tar` 已删除，空 `.deploy` 目录已清理。

## 2026-06-13 08:09 OpenAI v1 反代契约扩展发布与线上复查

### 本次发布

- 代码提交：`7e48844 feat: expand openai proxy contract samples`
- GitHub：`main` 已推送到 `git@github.com:carzygod/sub2share.git`
- 本次能力：
  - `openAiProxyContract` 静态契约样本扩展到更完整的 OpenAI v1 代表面。
  - 在 Responses、Chat Completions、files、uploads、batches 之外，新增 embeddings、Assistants、Threads/Runs、Vector Stores、Audio transcription、Image generation 和 fine-tuning jobs 样本。
  - 系统健康新增 `routesEmbeddings`、`routesAssistantsApi`、`routesThreadsRuns`、`routesVectorStores`、`routesFileUploadApis`、`routesBatchApis`、`routesAudioImageApis` 和 `routesFineTuningJobs` 指标。
  - Dashboard 健康预览白名单保留这些新指标，首页关键巡检也能看到扩展后的反代覆盖证据。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`：22/22 通过。
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`：19/19 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：134/134 通过。
- `pnpm.cmd --filter @zyz/admin test`：15/15 通过。
- `pnpm.cmd --filter @zyz/admin run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api run build`：通过。
- `pnpm.cmd --filter @zyz/admin run build`：通过。
- `git diff --check`：通过，仅有 Windows 工作区 LF/CRLF 提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-7e48844.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-7e48844.tar --commit 7e4884416636cb585147d4c0ca71fb74738d877f`
- 部署脚本在服务器侧通过：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：134/134 通过。
  - Admin tests：15/15 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
- release marker：
  - `commit=7e4884416636cb585147d4c0ca71fb74738d877f`
  - `deployed_at=20260613T000900Z`

### 线上复查

- 服务入口：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200，`text/html; charset=utf-8`。
  - `http://127.0.0.1:3101/`：200，`text/html; charset=utf-8`。
- `POST /api/auth/login`：管理员账号 `admin@zhisuan.local` 登录成功。
- `GET /api/admin/system-health`：
  - 总体仍为 `status=error`，原因仍是上游真实 Codex/OpenAI 资源未恢复。
  - `openAiProxyContract.status=ok`。
  - `routesCorePathSamples=true`。
  - `routesEmbeddings=true`。
  - `routesAssistantsApi=true`。
  - `routesThreadsRuns=true`。
  - `routesVectorStores=true`。
  - `routesFileUploadApis=true`。
  - `routesBatchApis=true`。
  - `routesAudioImageApis=true`。
  - `routesFineTuningJobs=true`。
  - `openAiProxyContract` 无 issues。
  - `frontendRuntime.status=ok`，`totalAssets=4`、`okAssets=4`、`failedAssets=0`。
  - `adminCapabilities.status=ok`，66/66 路由和入口仍完整。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.status=error`。
  - `openAiProxyContract` 关键巡检预览保留新增指标，所有新增路径指标均为 true。
  - `adminEntryCoverage.ok=true`，摘要为 API 5/5 核心范围、66/66 路由、66/66 入口；前端 5/5 核心范围、16 个列表入口、5 个关键入口。
  - `upstreamBlocker` 仍指向 `sub2`，并保留 `/v1/responses` 503 smoke 证据、代理请求 lookup 和修复动作。

### 剩余真实阻断

- `resources.status=warning`：仍没有 online production Codex shared resource。
- `resourceCredentials.status=error`：仍没有 active OpenAI refresh token resource credential。
- `sub2.status=error`：`openai_group_has_no_active_accounts`，Sub2 默认 OpenAI 分组没有 active account。
- `localProxySmoke.status=error`：最新 `/v1/models` 可用，但 `/v1/responses` 仍返回 503。
- 结论：本次发布证明本地 `/v1/*` Sub2API 反代契约覆盖面更完整；真实 `/v1/responses` 恢复仍依赖有效 OpenAI refresh token、active Sub2 OpenAI account 和 ready production Codex shared resource。

### 清理

- 远端 `/tmp/sub2share-user-7e48844.tar` 已删除。
- 本地 `.deploy/sub2share-user-7e48844.tar` 已删除，空 `.deploy` 目录已清理。

## 2026-06-13 08:24 Sub2 修复候选排序发布与线上复查

### 本次发布

- 代码提交：`bee3674 feat: prioritize sub2 repair accounts`
- GitHub：`main` 已推送到 `git@github.com:carzygod/sub2share.git`
- 本次能力：
  - `sub2AccountHealthSamples` 在截取候选前稳定排序。
  - token/auth/credential 失效类账号优先成为 `openai_group_has_no_active_accounts` 的修复候选。
  - 同优先级候选按 `updatedAt` 新近程度倒序排列，再按账号 ID 稳定排序。
  - Dashboard 与完整巡检继续通过 `repairAction=apply_openai_refresh_token_to_sub2_account` 指向管理员修复入口。

### 本地验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-sub2-upstream-health.test.ts`：4/4 通过。
- `pnpm.cmd --filter @zyz/api run typecheck`：通过。
- `pnpm.cmd --filter @zyz/api test`：135/135 通过。
- `git diff --check`：通过，仅有 Windows 工作区 LF/CRLF 提示。

### 生产部署

- 部署归档：`/tmp/sub2share-user-bee3674.tar`
- 部署脚本：`bash /opt/zhisuan-yizhan/user/scripts/deploy-production.sh --archive /tmp/sub2share-user-bee3674.tar --commit bee36743ce5353f27b6c9302f709433f788f2497`
- 部署脚本在服务器侧通过：
  - Prisma generate：通过。
  - Prisma migrate deploy：无待应用迁移。
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：135/135 通过。
  - Admin tests：15/15 通过。
  - workspace build：通过。
  - `/health`、`/ready`、Web、Admin：均 200。
  - 端口 cwd 校验：4100、3100、3101 均运行在 `/opt/zhisuan-yizhan/user` 当前 release 下。
- release marker：
  - `commit=bee36743ce5353f27b6c9302f709433f788f2497`
  - `deployed_at=20260613T002112Z`

### 线上复查

- 服务入口：
  - `http://127.0.0.1:4100/health`：200。
  - `http://127.0.0.1:4100/ready`：200。
  - `http://127.0.0.1:3100/`：200。
  - `http://127.0.0.1:3101/`：200。
- `POST /api/auth/login`：管理员账号 `admin@zhisuan.local` 登录成功。
- `POST /api/admin/sub2/proxy-smoke-test`：
  - `model=gpt-5.3-codex`。
  - `models.ok=true`，HTTP 200，返回 10 个模型。
  - `responses.ok=false`，HTTP 503，`errorType=api_error`，`errorMessage=Service temporarily unavailable`。
  - `keyDisabled=true`。
  - `proxyRequestLogCount=2`。
  - 临时租赁、订单、钱包和本地 API Key 清理均完成。
- `GET /api/admin/system-health`：
  - 总体 `status=error`，摘要为 29 项检查：25 ok、1 warning、3 error。
  - `openAiProxyContract.status=ok`，扩展 OpenAI v1 代表路径指标仍全部为 true。
  - `adminCapabilities.status=ok`，5/5 核心范围、66/66 路由、66/66 入口。
  - `adminSurfaceCoverage.status=ok`，5/5 核心范围、16 个列表入口、5 个关键入口。
  - `frontendRuntime.status=ok`，Web/Admin 共 2 个入口、4 个构建资产均可达。
  - `productCatalog.status=ok`，当前无不可交付可购 Codex 商品。
  - `salesDelivery.status=ok`，当前无应交付订单阻塞。
  - `proxy.status=ok`，最近 1 小时无真实用户反代请求。
  - `wallets.status=ok`，无负余额账户。
  - `payments.status=ok`，生产 mock 充值已禁用。
- `GET /api/admin/dashboard`：
  - `latestSystemHealth.status=error`，`stale=false`。
  - `upstreamBlocker.checkId=sub2`。
  - `repairAction=apply_openai_refresh_token_to_sub2_account`。
  - `sub2AccountId=2`、`sub2AccountName=1`、`accountStatus=error`、`credentialsStatus=configured(3)`、`schedulable=false`。
  - `accountMessage` 明确为 OpenAI token invalidated / 401。
  - 最新 smoke 证据 `ageMinutes=0`，`proxyRequestFilterStatus=upstream_error`，lookup 为 `9f725728-665a-4059-aade-23ca872d6df2`。
  - `adminEntryCoverage.ok=true`，摘要为 API 5/5 核心范围、66/66 路由、66/66 入口；前端 5/5 核心范围、16 个列表入口、5 个关键入口。

### 剩余真实阻断

- `resources.status=warning`：仍没有 online production Codex shared resource。
- `resourceCredentials.status=error`：仍没有 active OpenAI refresh token resource credential。
- `sub2.status=error`：`openai_group_has_no_active_accounts`，Sub2 默认 OpenAI 分组有 2 个 OpenAI account，但 active account 为 0。
- `localProxySmoke.status=error`：当前 release 下 `/v1/models` 可用，但 `/v1/responses` 仍返回 503。
- 结论：本次发布已让 Sub2/OpenAI 修复入口稳定指向 token invalidated 的 Sub2 账号 #2；真实 `/v1/responses` 恢复仍依赖有效 OpenAI refresh token、active Sub2 OpenAI account 和 ready production Codex shared resource。
