# 内部 Smoke 数据运营口径隔离

实现日期：2026-06-10

## 背景

本地 OpenAI/Codex 反代端到端自检会真实创建临时 Sub2 Key，并在本地创建 smoke 用户、订单、租赁、API Key 和 Sub2Binding。保留这些对象有利于审计、`ProxyRequestLog` 回溯以及后续 Sub2 usage 归因，但如果它们进入默认运营统计，会污染管理员对真实用户、余额、售出、租赁和 Sub2 绑定健康的判断。

## 内部对象标识

系统统一使用以下内部标识：

- smoke buyer id：`admin-openai-proxy-smoke`
- smoke 用户：`admin-openai-proxy-smoke@local.invalid`
- smoke 商品：`Admin OpenAI proxy smoke`
- smoke 订单项和 Sub2Binding `meta.smokeTest=true`

这些常量集中在：

```text
user/apps/api/src/common/internal-records.ts
```

## 默认运营口径隔离

以下管理员默认视图和统计会排除内部 smoke 数据：

- 后台 dashboard 用户数、有效租赁、余额汇总、订单汇总和 usage 汇总。
- `用户管理` 列表。
- `订单` 列表。
- `租赁` 列表。
- `余额管理` 和 `余额流水`。
- `售出情况` 订单列表与汇总。
- `用量` 列表与汇总。
- `商品` 列表。
- `可用性巡检` 中的用户、订单、租赁和钱包统计。
- `账务对账` 中的 usage 扣费与钱包流水扫描。
- `Sub2 绑定巡检` 和 `Sub2 绑定修复` 的扫描对象。

反代请求日志仍保留 smoke 请求，因为它们是代理链路健康证据；管理员可以在 `反代请求` 页面通过租赁 ID、Key 前缀、路径或 request id 回溯自检请求。

## Sub2 Usage 入账规则

当 Sub2 usage 同步遇到本地 smoke 租赁时：

- 仍创建 `UsageRecord`，用于幂等去重和审计。
- `status` 写为 `ignored`。
- `buyerCharge=0`。
- `supplierIncome=0`。
- 不扣减 smoke 钱包余额。
- 不更新租赁剩余额度或请求限制状态。
- 不创建供应商结算。
- 不把已关闭的 smoke 租赁改为 `low_balance` 或 `limited`。

## 保留 Sub2Binding 的原因

自检完成后不会删除 smoke `api_key` 绑定。原因是 Sub2 usage 可能晚于自检完成同步回来，保留绑定可以让同步任务找到对应本地 smoke 租赁，并将该 usage 正确标记为 `ignored`，避免产生 unmatched usage。

## Stale 数据清理

系统维护入口 `POST /api/admin/system-maintenance/run` 默认会清理超过 30 分钟或已过期的 stale smoke 资源：

- 停用本地 smoke API Key。
- 关闭本地 smoke 租赁。
- 关闭本地 smoke 订单。
- 将 smoke 钱包余额归零。
- 尽力停用对应 Sub2 Key。

清理动作不会删除 smoke Sub2Binding，以保留延迟 usage 归因能力。详细规则见 `docs/stale-smoke-maintenance.md`。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/api run build`

线上验证建议：

1. 连续运行多次后台 `反代状态 -> 端到端自检`。
2. 确认 `Sub2 绑定巡检` 的 `rentalsScanned` 不被 smoke 租赁占满。
3. 确认 `售出情况`、dashboard 订单数、余额汇总不随 smoke 自检增加。
4. 触发 Sub2 usage 同步后，确认 smoke usage 为 `ignored`，且不产生钱包扣费和供应商结算。

## 2026-06-12 Update: Supplier Resource Health Scope

The admin-disabled internal supplier resource is now identified by:

- `sub2AccountId=admin-disabled-smoke-resource`

Production-facing resource health and dashboard resource counts exclude this record. The admin resource list still shows it, so operators can audit or clean it explicitly, but `GET /api/admin/system-health` no longer treats it as a real Codex resource that should be opened and moved online.

Affected health metrics:

- `resources.metrics.totalCodexResources` counts production Codex resources only.
- `resources.metrics.onlineCodexResources` counts production online Codex resources only.
- `resources.metrics.ignoredInternalResources` reports how many internal supplier resources were ignored.
- `resourceCredentials` only treats credentials on production Codex resources as applicable repair candidates.
