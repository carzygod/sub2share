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
