# 反代请求健康分类

实现日期：2026-06-13

## 背景

`GET /api/admin/system-health` 的 `proxy` 检查会统计最近 1 小时本地 OpenAI/Codex `/v1/*` 反代请求。此前缺少 Bearer Key、无效 Key、租赁不可用、余额不足或限流等本地准入拒绝，会和真正的平台可用性故障一起推高 warning，导致未认证探测请求也可能让健康面板显示反代异常。

## 已实现范围

- 新增本地客户端准入拒绝分类：`missing_api_key`、`invalid_api_key`、`user_not_active`、`insufficient_balance`、`rental_not_active`、`rental_expired`、`key_rental_mismatch`、`unsupported_resource_type`、`spend_limit_exhausted`、`request_limit_exceeded`、`rpm_limit_exceeded`、`tpm_limit_exceeded`、`concurrency_limit_exceeded`。
- `proxy.metrics` 新增：
  - `proxyRecentClientRejections`：最近 1 小时本地准入拒绝数量。
  - `proxyRecentActionableClientErrors`：最近 1 小时需要管理员复查的 4xx 数量，不包含上述本地准入拒绝。
- `proxyRecentLocalErrors` 改为只统计本地可用性错误：`proxy_limiter_unavailable`、`upstream_timeout`、`upstream_unavailable`。
- `proxy.summary` 同时展示总请求、5xx、全部 4xx、本地准入拒绝、需复查 4xx、客户端断开和上游流异常。
- `proxy.status` 判定：
  - 只有本地准入拒绝时保持 `ok`。
  - 存在需复查 4xx 或客户端断开时标记 `warning`。
  - 存在 5xx、本地可用性错误或上游流异常时标记 `error`。
- `proxy.detail.issues` 只返回真正需要排查的样本：5xx、本地可用性错误、上游流异常、客户端断开和需复查 4xx。

## 管理价值

- 运维面板不再因为公网未带 Key 的 `/v1/models` 探测而误报反代 warning。
- 管理员仍能看到本地准入拒绝数量，用于观察调用噪音、客户 Key 使用错误或限额触发情况。
- 真正影响平台交付的上游不可用、限流器不可用、上游流异常和非准入类 4xx 仍会进入问题样本，可一键打开对应反代请求日志。

## 验收方式

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-proxy-health.test.ts`
- `pnpm.cmd --filter @zyz/api run typecheck`
