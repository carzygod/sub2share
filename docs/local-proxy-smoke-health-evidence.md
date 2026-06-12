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
- 最新证据、问题样本和检查摘要都会返回 `staleThresholdMinutes=1440`，管理员可以直接判断 `ageMinutes` 距离 24 小时证据窗口还有多远。
- 没有找到自检证据时标记 `warning`。
- 如果资源凭据应用请求了端到端自检但因凭据应用失败或 Sub2 账号测试失败而跳过，自检证据会标记为 `error`，并携带 `smokeTestSkippedReason`。
- 问题样本包含 `auditLogId`、`auditAction`、`resourceId`、`sub2AccountId`、模型、`smokeTestSkippedReason`、`modelsOk`、`responsesOk`、`localProxyOk`、`keyDisabled`、代理日志数量、主代理请求日志、上游 request id、发生时间、证据年龄和维修建议。
- Dashboard 关键巡检预览会保留 `stale` 与 `staleThresholdMinutes` 字段，Admin `反代状态 -> 修复定位` 会显示证据年龄、过期阈值和“证据已过期”状态。
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

## 验证方式

- `npm.cmd --prefix user/apps/api run typecheck`
- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/api test`
