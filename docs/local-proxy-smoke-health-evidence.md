# 本地反代自检巡检证据

实现日期：2026-06-11

## 背景

`POST /api/admin/sub2/proxy-smoke-test` 已经能真实穿过本地租赁、钱包、API Key、`/v1/*` 反代、ProxyRequestLog 和 Sub2API 上游。但系统巡检此前不会读取最近一次自检结果，管理员只能在当前页面状态或审计日志里手动确认 `/v1/responses` 是否曾经真实通过。

## 已实现范围

- `GET /api/admin/system-health` 新增 `localProxySmoke` / `本地反代自检` 检查项。
- 巡检只读取最近审计日志，不会在刷新系统健康时主动触发真实 OpenAI/Codex 请求。
- 巡检会独立读取最新一条 `admin.sub2.proxy_smoke_test`，并扫描最近 100 条资源凭据应用审计，筛选其中的 `smokeTest` 或 `smokeTestSkippedReason` 证据，再按时间选择最新证据。
- 默认把 24 小时内的成功端到端自检视为新鲜证据。
- 最近自检失败时标记 `error`。
- 最近自检超过 24 小时时标记 `warning`。
- 没有找到自检证据时标记 `warning`。
- 如果资源凭据应用请求了端到端自检但因凭据应用失败或 Sub2 账号测试失败而跳过，自检证据会标记为 `error`，并携带 `smokeTestSkippedReason`。
- 问题样本包含 `auditLogId`、`auditAction`、模型、`smokeTestSkippedReason`、`modelsOk`、`responsesOk`、`localProxyOk`、`keyDisabled`、代理日志数量、发生时间、证据年龄和维修建议。
- Admin `可用性巡检` 问题样本支持从 smoke 问题一键打开对应审计记录。

## 证据来源

- `admin.sub2.proxy_smoke_test`
- `admin.resource.credential_apply_sub2` 中携带的 `smokeTest`
- `admin.resource.credential_apply_sub2` 中携带的 `smokeTestSkippedReason`

## 管理员价值

- 管理员刷新系统巡检时，可以直接看到真实 `/v1/responses` 是否在最近 24 小时内被端到端证明过。
- 当最新自检失败或被跳过时，巡检页会明确失败阶段，例如凭据应用失败、Sub2 账号测试失败、`/v1/models`、`/v1/responses`、本地代理清理、临时 Sub2 Key 禁用或日志证据不足。
- 管理员可以从巡检问题样本打开审计记录，查看当次自检的完整脱敏结果。

## 设计边界

- 该检查不替代实时 smoke test；它只把最近一次人工/维修动作产生的证据纳入系统巡检。
- 审计日志只保存脱敏结果，不返回明文 API Key、refresh token 或请求体。
- 如果要证明当前瞬时可用性，仍应在 `反代状态` 页面点击端到端自检。

## 验证方式

- `npm.cmd --prefix user/apps/api run typecheck`
- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/api test`
