# 本地反代自检巡检证据

实现日期：2026-06-11

## 背景

`POST /api/admin/sub2/proxy-smoke-test` 已经能真实穿过本地租赁、钱包、API Key、`/v1/*` 反代、ProxyRequestLog 和 Sub2API 上游。但系统巡检此前不会读取最近一次自检结果，管理员只能在当前页面状态或审计日志里手动确认 `/v1/responses` 是否曾经真实通过。

## 已实现范围

- `GET /api/admin/system-health` 新增 `localProxySmoke` / `本地反代自检` 检查项。
- 巡检只读取最近审计日志，不会在刷新系统健康时主动触发真实 OpenAI/Codex 请求。
- 巡检会独立读取最新一条 `admin.sub2.proxy_smoke_test`，并扫描最近 100 条资源凭据应用审计和最近 100 条 Sub2 直接应用 refresh token 审计，筛选其中的 `smokeTest` 或 `smokeTestSkippedReason` 证据，再按时间选择最新证据。
- 默认把 24 小时内的成功端到端自检视为新鲜证据。
- 最近自检失败时标记 `error`。
- 最近自检超过 24 小时时标记 `warning`。
- 最近自检失败且证据超过 24 小时时仍标记 `error`，但问题样本会额外携带 `stale=true`，并提示管理员修复后重新运行端到端自检以刷新当前 `/v1/responses` 证据。
- 最新证据、问题样本和检查摘要都会返回 `staleThresholdMinutes=1440` 与 `freshMinutesRemaining`，管理员可以直接判断 `ageMinutes` 距离 24 小时证据窗口还有多远。
- 没有找到自检证据时标记 `warning`。
- 如果资源凭据应用请求了端到端自检但因凭据应用失败或 Sub2 账号测试失败而跳过，自检证据会标记为 `error`，并携带 `smokeTestSkippedReason`。
- 问题样本包含 `auditLogId`、`auditAction`、`resourceId`、`sub2AccountId`、模型、`smokeTestSkippedReason`、`modelsOk`、`responsesOk`、`localProxyOk`、`keyDisabled`、代理日志数量、主代理请求日志、上游 request id、发生时间、证据年龄和维修建议。
- Dashboard 关键巡检预览会保留 `stale`、`staleThresholdMinutes` 与 `freshMinutesRemaining` 字段，Admin `反代状态 -> 修复定位` 会显示证据年龄、过期阈值、剩余新鲜时间和“证据已过期”状态。
- 当 Sub2/OpenAI 上游巡检已经发现非 active 或不可调度的 OpenAI 账号时，本地反代自检问题会继承首个修复候选账号字段：`sub2AccountId`、`sub2AccountName`、`accountStatus`、`credentialsStatus`、`schedulable` 和 `repairAction`。
- Admin `可用性巡检` 问题样本支持从 smoke 问题一键打开对应审计记录。
- Admin `可用性巡检` 问题样本支持从 smoke 问题一键打开反代状态页；如果问题携带 `sub2AccountId`，凭据应用表单会预选该账号。

## 证据来源

- `admin.sub2.proxy_smoke_test`
- `admin.resource.credential_apply_sub2` 中携带的 `smokeTest`
- `admin.resource.credential_apply_sub2` 中携带的 `smokeTestSkippedReason`
- `admin.sub2.account.apply_openai_refresh_token` 中携带的 `smokeTest`
- `admin.sub2.account.apply_openai_refresh_token` 中携带的 `smokeTestSkippedReason`

## 管理员价值

- 管理员刷新系统巡检时，可以直接看到真实 `/v1/responses` 是否在最近 24 小时内被端到端证明过。
- 当最新自检失败或被跳过时，巡检页会明确失败阶段，例如凭据应用失败、Sub2 账号测试失败、`/v1/models`、`/v1/responses`、本地代理清理、临时 Sub2 Key 禁用或日志证据不足。
- 如果失败指向上游账号不可用，管理员可以从同一条 smoke 问题进入反代状态页，并直接看到优先修复账号。
- 如果 smoke 来自“反代状态”页直接应用 refresh token，问题样本会携带 Sub2 账号 ID；如果该次操作同步保存了共享资源凭据，还会携带对应资源 ID。
- 如果 smoke 关联的 `/v1/models` 或 `/v1/responses` 代理日志记录了 `upstreamRequestId`，巡检 latest 证据和问题样本会一并返回，便于管理员把 smoke 失败与 Sub2API/OpenAI 上游日志关联。
- 管理员可以从巡检问题样本打开审计记录，查看当次自检的完整脱敏结果。

## 设计边界

- 该检查不替代实时 smoke test；它只把最近一次人工/维修动作产生的证据纳入系统巡检。
- 审计日志只保存脱敏结果，不返回明文 API Key、refresh token 或请求体。
- 如果要证明当前瞬时可用性，仍应在 `反代状态` 页面点击端到端自检。

## 2026-06-13 扩展：绝对过期时间

- `localProxySmoke.summary`、`localProxySmoke.detail.latest` 和 `localProxySmoke.detail.issues[]` 新增 `staleAt`。
- `staleAt` 按 smoke 审计证据的 `createdAt + 24 小时 freshness 窗口` 计算。
- 缺少 smoke 证据时 `staleAt=null`。
- Dashboard 关键巡检预览、完整巡检 issue/sample 摘要、`反代状态` 修复定位和共享资源创建诊断都会保留该字段。
- 该字段只帮助管理员确认 smoke 证据什么时候过期，不触发新的 OpenAI/Codex 请求，也不改变 stale 判定。

## 2026-06-13 扩展：作为共享修复证据源

- 最新 `localProxySmoke` 可修复失败 issue 会作为共享修复证据源，补齐相关 `apply_openai_refresh_token_to_sub2_account` 问题缺失的 smoke 字段。
- `productCatalog`、`resources`、`resourceCredentials` 和 `sub2` 等巡检项可以继承 `/v1/responses` 失败路径、状态码、代理错误码、请求 ID、证据年龄、剩余新鲜时间和 `staleAt`。
- 原问题已有字段不会被覆盖，因此各巡检项仍保留自己的商品、资源、账号、消息和修复建议。
- 该扩展只复用最近一次审计证据，不主动运行 live smoke，也不写入 Sub2API 或业务数据。

## 2026-06-13 扩展：共享修复证据保留审计追溯

- `localProxySmoke` 作为共享修复证据源时，会继续把 `auditLogId`、`auditAction`、`keyDisabled` 和 `proxyRequestLogCount` 补入相关修复问题。
- 完整 `可用性巡检` issue/sample 行已有 `打开审计` 能力；继承 `auditLogId` 后，管理员从商品、共享资源、资源凭据或 Sub2 问题也能跳到同一条 smoke 审计记录。
- `keyDisabled` 与 `proxyRequestLogCount` 用于保留临时 Key 清理和代理日志数量证据，帮助判断 smoke 是否完整跑完本地清理阶段。
- 该扩展只透传脱敏审计定位，不暴露明文 API Key、Sub2 Key 或 OpenAI refresh token。

## 2026-06-13 扩展：覆盖 Sub2 账号候选样本

- `sub2.detail.samples[]` 的账号候选样本也会继承最新 `localProxySmoke` 失败证据。
- 继承后样本行可携带 `repairAction`、`sub2Status`、`resourceType=codex`、失败路径、代理请求日志、新鲜度、`staleAt` 和 `auditLogId`。
- 管理员从 Sub2 候选账号样本打开维修入口时，可以保留与主问题一致的 smoke 证据链。
- 该扩展不触发 live smoke，只复用最近审计证据。

## 2026-06-13 扩展：Dashboard 保留清理证据字段

- Dashboard 关键巡检预览不再只保留 `auditLogId`，还会保留 `auditAction`、`keyDisabled`、`proxyRequestLogCount` 和 `sub2Status`。
- 首页可以直接看到 smoke 审计动作、临时 Key 清理状态、代理日志数量和 Sub2 修复标记。
- 该扩展不改变 smoke 证据来源，也不触发新的 `/v1/models` 或 `/v1/responses` 请求。

## 验证方式

- `npm.cmd --prefix user/apps/api run typecheck`
- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/api test`
